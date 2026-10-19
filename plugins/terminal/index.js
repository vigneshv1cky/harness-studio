/**
 * A real terminal for the agent. Harness's own shells are line-based: a command goes in and its text comes
 * back, so full-screen programs (editors, pagers, interactive installers and prompts) hang or fail. These
 * tools run a program in a real pseudo-terminal, keep its screen in an emulator, and let the agent read the
 * screen as text and send keys, the way a person at a terminal would.
 *
 * Programs run under the session's sandbox (file and network limits), like every other command. Each session,
 * together with its helper agents, can have a few programs running at a time; they end when the session ends,
 * when the sandbox mode changes, or after 30 minutes without use, and ending one ends its whole process group.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { KEY_NAMES, keysToBytes, readScreen, screenText } from './screen.js'

export const name = 'harness-studio-terminal'
export const inject = ['tools', 'subprocess', 'workingDirectory']

const MAX_TERMINALS = 4
const IDLE_MS = 30 * 60 * 1000
const DEFAULT_SIZE = { cols: 120, rows: 32 }
const QUIET_MS = 300
const DEFAULT_WAIT_MS = 1500
const MAX_WAIT_MS = 15000
const GRACE_MS = 2000
/** How long a stopped program's process group has after SIGHUP and SIGTERM, and again after SIGKILL. */
const KILL_GRACE_MS = 1000
const POLICY_CHECK_MS = 2000
const POLICY_CHANGED = 'the session\'s sandbox setting changed'

const text = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] }
const clamp = (value, low, high, fallback) => (Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : fallback)

/**
 * The emulator class: `@xterm/headless`, which Harness's own terminal backend (`dsh-terminal-bash`) depends on.
 * A plugin cannot import it by name, since it is not among the plugin's own dependencies, so it is found
 * through that package, which is resolvable from the running Harness entry point.
 */
async function loadEmulator() {
  const pick = module => module?.Terminal ?? module?.default?.Terminal
  try {
    const Terminal = pick(await import('@xterm/headless'))
    if (typeof Terminal === 'function') return Terminal
  } catch { /* not resolvable from the plugin's folder; look through Harness below */ }
  const anchors = [process.argv[1], path.join(process.cwd(), 'package.json'), fileURLToPath(import.meta.url)].filter(Boolean)
  for (const anchor of anchors) {
    try {
      const backend = createRequire(anchor).resolve('@deepseek-ai/dsh-terminal-bash')
      const Terminal = pick(createRequire(backend)('@xterm/headless'))
      if (typeof Terminal === 'function') return Terminal
    } catch { /* try the next anchor */ }
  }
  throw new Error('the terminal emulator (@xterm/headless, shipped with Harness\'s terminal backend) could not be found')
}

/** The Remote service the Session pane lists and stops this plugin's terminals through. */
export const TERMINAL_SERVICE = 'harnessStudioTerminal'
const REMOTE_METHODS_MARKER = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/**
 * The terminal tools, given the services they use; `apply` wires Harness's, and tests pass stand-ins.
 * @param {{ spawn: (spec: object) => Promise<object>, policyOf: (agent: object) => object, confine: (argv: string[], policy: object, signal?: AbortSignal) => Promise<string[]>, cwdOf: (agent: object, signal?: AbortSignal) => Promise<string>, Terminal: () => Promise<Function>, rootOf?: (agent: object) => unknown, signalGroup?: (pgid: number, signal: NodeJS.Signals | 0) => void, now?: () => number }} services
 *   `rootOf` names the top-level session an agent belongs to (helper agents share their parent's), which the
 *   limit is counted by; `signalGroup` signals a process group (signal 0 only checks that it exists).
 */
export function createTerminals(services) {
  const now = services.now ?? Date.now
  const rootOf = services.rootOf ?? (agent => agent)
  const signalGroup = services.signalGroup ?? ((pgid, signal) => process.kill(-pgid, signal))
  /** Terminals by agent, then by id. */
  const byAgent = new Map()
  /** Terminals still starting, by root session; they count toward the limit. */
  const starting = new Map()
  /** Why terminals the agent did not stop itself were closed, by agent, then by id. */
  const closedBy = new Map()
  let counter = 0
  let policyTimer

  const policyKey = policy => JSON.stringify({ mode: policy.mode, network: policy.network ?? { mode: 'on' } })

  function terminalsOf(agent) {
    let map = byAgent.get(agent)
    if (map === undefined) { map = new Map(); byAgent.set(agent, map) }
    return map
  }

  function find(agent, id) {
    const entry = terminalsOf(agent).get(String(id ?? ''))
    if (entry === undefined) {
      const reason = closedBy.get(agent)?.get(String(id ?? ''))
      if (reason !== undefined) throw new Error(`terminal ${id} was closed because ${reason}; start it again`)
      const ids = [...terminalsOf(agent).keys()]
      throw new Error(`there is no terminal "${id}"${ids.length ? `; open terminals: ${ids.join(', ')}` : '; start one with terminal_start'}`)
    }
    return entry
  }

  /**
   * End a still-running program's whole process group: SIGHUP and SIGTERM, then SIGKILL if it is still there
   * after a short grace. Harness's own teardown alone signals the processes it finds one at a time, which a
   * looping shell outruns by starting new children. Resolves whether the group is gone.
   */
  async function endGroup(entry) {
    const pgid = entry.handle.pid
    // The program is the leader of its own process group (the terminal starts it in a new session). A group
    // id is only signalled while its leader has not been seen to exit, so the id cannot have been reused.
    if (!Number.isInteger(pgid) || pgid <= 1 || pgid === process.pid || entry.exited) return true
    const send = (signal) => {
      try { signalGroup(pgid, signal); return true } catch (error) { return error?.code === 'EPERM' }
    }
    const goneWithin = async (ms) => {
      const deadline = Date.now() + ms
      while (send(0)) {
        if (Date.now() >= deadline) return false
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      return true
    }
    send('SIGHUP')
    send('SIGTERM')
    if (await goneWithin(KILL_GRACE_MS)) return true
    send('SIGKILL')
    return goneWithin(KILL_GRACE_MS)
  }

  /** Close a terminal and end its program. Never rejects; resolves whether the program's process group is gone. */
  async function stop(agent, entry, reason) {
    byAgent.get(agent)?.delete(entry.id)
    clearTimeout(entry.idleTimer)
    entry.stopReason = reason
    if (reason !== 'the agent stopped it' && byAgent.has(agent)) {
      if (!closedBy.has(agent)) closedBy.set(agent, new Map())
      closedBy.get(agent).set(entry.id, reason)
    }
    if (![...byAgent.values()].some(open => open.size > 0)) { clearInterval(policyTimer); policyTimer = undefined }
    const ended = await endGroup(entry)
    // Harness's teardown then ends anything the program left outside its group and releases the terminal.
    try { await entry.handle.terminate() } catch { /* the group check above is what stop reports */ }
    entry.term.dispose?.()
    return ended
  }

  /**
   * Close every terminal whose session's sandbox policy changed since it started, so a program started under
   * a looser setting does not keep running after the session is tightened. A policy that cannot be read
   * counts as changed.
   */
  function checkPolicies() {
    for (const [agent, open] of byAgent) {
      if (open.size === 0) continue
      let key
      try { key = policyKey(services.policyOf(agent)) } catch { key = undefined }
      for (const entry of [...open.values()]) if (entry.policyKey !== key) void stop(agent, entry, POLICY_CHANGED)
    }
  }

  /** While any terminal is open, check the sandbox policies every 2 seconds. */
  function watchPolicies() {
    if (policyTimer !== undefined) return
    policyTimer = setInterval(checkPolicies, POLICY_CHECK_MS)
    policyTimer.unref?.()
  }

  function touch(agent, entry) {
    entry.lastUsed = now()
    clearTimeout(entry.idleTimer)
    entry.idleTimer = setTimeout(() => { void stop(agent, entry, 'it was unused for 30 minutes') }, IDLE_MS)
    entry.idleTimer.unref?.()
  }

  /** Wait until the program has been quiet for a moment, it exited, or the wait runs out. */
  async function settle(entry, waitMs, signal) {
    const deadline = now() + waitMs
    for (;;) {
      await entry.parsed
      if (entry.exited || signal?.aborted) return
      const quietFor = now() - entry.lastOutput
      if (quietFor >= QUIET_MS && now() - entry.lastInput >= QUIET_MS) return
      if (now() >= deadline) return
      await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(1, deadline - now()))))
    }
  }

  function view(entry, note) {
    const { lines, cursor } = readScreen(entry.term)
    const status = !entry.exited ? 'running'
      : entry.exitCode !== undefined ? `exited with code ${entry.exitCode}`
        : entry.exitSignal !== undefined ? `ended by ${entry.exitSignal}` : 'exited'
    return screenText({ id: entry.id, command: entry.command, cols: entry.term.cols, rows: entry.term.rows, status, lines, cursor, note })
  }

  /** Refuse to keep using a terminal confined under a sandbox policy that no longer applies. */
  async function checkPolicy(agent, entry) {
    if (policyKey(services.policyOf(agent)) === entry.policyKey) return
    await stop(agent, entry, POLICY_CHANGED)
    throw new Error(`terminal ${entry.id} was closed because the session's sandbox setting changed since it started; start it again`)
  }

  return {
    async start(agent, args, signal) {
      const command = typeof args?.command === 'string' ? args.command.trim() : ''
      if (command === '') throw new Error('command is required, for example "less README.md" or "vim notes.txt"')
      const open = terminalsOf(agent)
      // The limit counts running programs across the whole session, its helper agents included. The slot is
      // taken before the first wait, so starts made at the same time cannot pass the limit together.
      let root
      try { root = rootOf(agent) } catch { root = agent }
      const running = [...byAgent.values()].flatMap(map => [...map.values()]).filter(e => e.root === root && !e.exited)
      const pending = starting.get(root) ?? 0
      if (running.length + pending >= MAX_TERMINALS) {
        const busy = [...running.map(e => e.id), ...(pending ? [`${pending} starting`] : [])]
        throw new Error(`this session and its helper agents already have ${MAX_TERMINALS} terminals running (${busy.join(', ')}); stop one with terminal_stop first`)
      }
      starting.set(root, pending + 1)
      let term, handle, policy
      try {
        const cols = clamp(args.cols, 40, 300, DEFAULT_SIZE.cols)
        const rows = clamp(args.rows, 10, 100, DEFAULT_SIZE.rows)
        policy = services.policyOf(agent)
        const argv = await services.confine(['bash', '-c', command], policy, signal)
        const Terminal = await services.Terminal()
        term = new Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true })
        handle = await services.spawn({
          argv, cwd: await services.cwdOf(agent, signal), rows, cols, terminalType: 'xterm-256color', graceMs: GRACE_MS,
          env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' },
        })
      } catch (error) {
        term?.dispose?.()
        throw error
      } finally {
        const left = (starting.get(root) ?? 1) - 1
        if (left > 0) starting.set(root, left); else starting.delete(root)
      }
      // The session ended (or the plugin closed) while the program was starting: end it rather than leave it running.
      if (byAgent.get(agent) !== open) {
        await endGroup({ handle, exited: false })
        try { await handle.terminate() } catch { /* the group was ended above */ }
        term.dispose?.()
        throw new Error('the session ended while the terminal was starting')
      }
      // Exited terminals stay readable but hold no slot; the oldest are dropped so an agent keeps at most the limit.
      for (const old of [...open.values()]) {
        if (open.size < MAX_TERMINALS) break
        if (old.exited) void stop(agent, old, 'its program had exited and a new terminal needed the room')
      }
      const id = `t${++counter}`
      const entry = { id, command, root, term, handle, policyKey: policyKey(policy), startedAt: now(), lastOutput: now(), lastInput: 0, parsed: Promise.resolve(), exited: false }
      handle.output.on('data', (chunk) => {
        entry.lastOutput = now()
        const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        entry.parsed = entry.parsed.then(() => new Promise(resolve => term.write(data, resolve)))
      })
      handle.done.then((outcome) => {
        entry.exitedAt = now()
        entry.exited = true
        entry.exitCode = outcome?.exitCode ?? undefined
        entry.exitSignal = outcome?.signal ?? undefined
      }, () => { entry.exited = true })
      open.set(id, entry)
      touch(agent, entry)
      watchPolicies()
      await settle(entry, clamp(args.wait_ms, 0, MAX_WAIT_MS, DEFAULT_WAIT_MS), signal)
      return view(entry)
    },

    async send(agent, args, signal) {
      const entry = find(agent, args?.id)
      await checkPolicy(agent, entry)
      if (entry.exited) return view(entry, 'The program has exited; nothing was sent.')
      const keys = Array.isArray(args.keys) ? args.keys : []
      const typed = typeof args.text === 'string' ? args.text : ''
      if (typed === '' && keys.length === 0) throw new Error('give text to type, keys to press, or both')
      const bytes = typed + keysToBytes(keys, { applicationCursor: entry.term.modes?.applicationCursorKeysMode === true })
      entry.lastInput = now()
      await entry.handle.write(bytes)
      touch(agent, entry)
      await settle(entry, clamp(args.wait_ms, 0, MAX_WAIT_MS, DEFAULT_WAIT_MS), signal)
      return view(entry)
    },

    async screen(agent, args, signal) {
      const entry = find(agent, args?.id)
      await checkPolicy(agent, entry)
      touch(agent, entry)
      if (Number.isFinite(args.wait_ms) && args.wait_ms > 0) await settle(entry, clamp(args.wait_ms, 0, MAX_WAIT_MS, 0), signal)
      else await entry.parsed
      return view(entry)
    },

    async stop(agent, args) {
      const entry = find(agent, args?.id)
      const last = view(entry)
      if (!(await stop(agent, entry, 'the agent stopped it'))) {
        throw new Error(`terminal ${entry.id} was closed, but its program (process group ${entry.handle.pid}) was still running after SIGHUP, SIGTERM and SIGKILL`)
      }
      return `Stopped terminal ${entry.id}. Its last screen:\n${last}`
    },

    list(agent) {
      const open = [...terminalsOf(agent).values()]
      if (open.length === 0) return 'No terminals are open in this session.'
      return open.map(e => `${e.id} · ${e.command} · ${e.exited ? 'exited' : 'running'}`).join('\n')
    },

    /**
     * The terminals one session's agent has open, for the Session pane's Background tasks: each with its
     * command, when it started and whether its program is still running.
     * @param {string} sessionId
     */
    sessionList(sessionId) {
      const out = []
      for (const [agent, open] of byAgent) {
        if (String(agent.session?.id) !== sessionId) continue
        for (const e of open.values()) out.push({ id: e.id, command: e.command, startedAt: e.startedAt, running: !e.exited, ...(e.exited ? { finishedAt: e.exitedAt, exitCode: e.exitCode } : {}) })
      }
      return out
    },

    /** The user stops one terminal from the Session pane; the agent learns why when it next uses that id. */
    async userStop(sessionId, id) {
      for (const [agent, open] of byAgent) {
        if (String(agent.session?.id) !== sessionId) continue
        const entry = open.get(String(id))
        if (entry !== undefined) return { stopped: await stop(agent, entry, 'the user stopped it') }
      }
      return { stopped: false }
    },

    /** End every terminal of one agent, or of all agents. */
    async closeAll(agent) {
      const agents = agent === undefined ? [...byAgent.keys()] : [agent]
      for (const a of agents) {
        const open = byAgent.get(a)
        byAgent.delete(a)
        closedBy.delete(a)
        for (const entry of [...(open?.values() ?? [])]) await stop(a, entry, 'the session ended')
      }
      if (agent === undefined) { clearInterval(policyTimer); policyTimer = undefined }
    },

    checkPolicies,
  }
}

export function apply(ctx) {
  let Terminal
  const terminals = createTerminals({
    spawn: spec => ctx.subprocess.spawnTerminal(spec),
    policyOf: (agent) => {
      const policy = ctx.get('sandboxPolicy')
      if (policy === undefined) throw new Error('no sandbox policy is composed, so terminals are unavailable')
      return policy.resolve({ session: agent.session })
    },
    confine: async (argv, policy, signal) => {
      if (policy.mode === 'danger-full-access') return argv
      const sandbox = ctx.get('sandbox')
      if (sandbox === undefined) throw new Error(`sandbox mode "${policy.mode}" needs a sandbox provider, and none is composed`)
      return (await sandbox.confine(argv, { ...policy, mode: policy.mode }, signal)).argv
    },
    cwdOf: (agent, signal) => ctx.workingDirectory.ensure(agent, signal),
    // Helper agents run in child sessions; follow the parent links up to the top-level session.
    rootOf: (agent) => {
      let id = String(agent.session.id)
      let header = agent.session.header
      for (let depth = 0; header?.parentSession !== undefined && depth < 16; depth++) {
        id = String(header.parentSession)
        header = ctx.get('agents')?.get(header.parentSession)?.session?.header
      }
      return id
    },
    Terminal: async () => (Terminal ??= await loadEmulator()),
  })
  ctx.effect(() => () => { void terminals.closeAll() }, 'close agent terminals')
  ctx.on('agent/disposed', ({ agent }) => { void terminals.closeAll(agent) })

  const tool = definition => ctx.effect(() => ctx.tools.register({ output: text, ...definition }), `tool ${definition.name}`)
  const needAgent = (exec) => {
    if (exec.agent === undefined) throw new Error('terminals belong to a session; call this from an agent')
    return exec.agent
  }
  const waitParam = { type: 'integer', minimum: 0, maximum: MAX_WAIT_MS, description: `Milliseconds to wait for the screen to settle before returning (default ${DEFAULT_WAIT_MS}).` }

  tool({
    name: 'terminal_start',
    description: `Run a program in a real terminal and return its screen as text. Use it for full-screen or interactive programs that the bash tool cannot drive: editors (vim, nano), pagers (less), interactive prompts, installers and REPLs. For ordinary commands use bash. The program runs in the session's folder under the same sandbox as bash, so programs that inspect other processes, such as top and htop, may be refused. A session and its helper agents can have ${MAX_TERMINALS} programs running at once; stop terminals you no longer need.`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command line to run, for example "less README.md" or "vim src/app.js".' },
        cols: { type: 'integer', minimum: 40, maximum: 300, description: `Screen width in columns (default ${DEFAULT_SIZE.cols}).` },
        rows: { type: 'integer', minimum: 10, maximum: 100, description: `Screen height in rows (default ${DEFAULT_SIZE.rows}).` },
        wait_ms: waitParam,
      },
      required: ['command'],
      additionalProperties: false,
    },
    execute: (args, exec) => terminals.start(needAgent(exec), args, exec.signal),
  })
  tool({
    name: 'terminal_send',
    description: `Type text and/or press keys in a terminal started with terminal_start, then return its screen. Text is typed first, then the keys in order. Key names: ${KEY_NAMES.join(', ')}.`,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The terminal id terminal_start returned, such as "t1".' },
        text: { type: 'string', description: 'Plain text to type, exactly as given.' },
        keys: { type: 'array', items: { type: 'string' }, description: 'Keys to press after the text, for example ["Enter"] or ["Escape", ":", "w", "q", "Enter"].' },
        wait_ms: waitParam,
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: (args, exec) => terminals.send(needAgent(exec), args, exec.signal),
  })
  tool({
    name: 'terminal_screen',
    description: 'Return the current screen of a terminal started with terminal_start, optionally after waiting for it to settle.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The terminal id, such as "t1".' }, wait_ms: waitParam },
      required: ['id'],
      additionalProperties: false,
    },
    execute: (args, exec) => terminals.screen(needAgent(exec), args, exec.signal),
  })
  tool({
    name: 'terminal_stop',
    description: 'End a terminal started with terminal_start and the program in it, returning its last screen. Stop terminals you no longer need.',
    parameters: { type: 'object', properties: { id: { type: 'string', description: 'The terminal id, such as "t1".' } }, required: ['id'], additionalProperties: false },
    execute: (args, exec) => terminals.stop(needAgent(exec), args),
  })
  tool({
    name: 'terminal_list',
    description: 'List the terminals open in this session.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_args, exec) => terminals.list(needAgent(exec)),
  })

  // The Session pane's Background tasks list reads and stops this session's terminals through Harness's
  // authenticated Remote channel, as Watch's header list does.
  class TerminalAccess {
    constructor() {
      this.typertRemote = Object.freeze({ service: this, serviceKey: TERMINAL_SERVICE, namespace: TERMINAL_SERVICE })
    }

    /** @param {{ action: 'list' | 'stop', sessionId: string, id?: string }} request */
    async call(request) {
      if (typeof request?.sessionId !== 'string' || request.sessionId === '') throw new Error('sessionId is required')
      if (request.action === 'list') return terminals.sessionList(request.sessionId)
      if (request.action === 'stop') return terminals.userStop(request.sessionId, request.id)
      throw new Error(`Unknown action ${request?.action}`)
    }
  }
  Object.defineProperty(TerminalAccess.prototype, REMOTE_METHODS_MARKER, {
    configurable: true,
    value: Object.freeze({ version: 1, methods: Object.freeze([Object.freeze({ method: 'call', invocation: Object.freeze({ kind: 'direct' }) })]) }),
  })
  if (typeof ctx.provide === 'function') ctx.provide(TERMINAL_SERVICE, new TerminalAccess())
  return { terminals }
}
