/**
 * Watch for Harness Studio: cheap checks that run on their own and wake the agent only when something
 * changes. A scheduled check costs a full model turn every time it runs; a watch costs nothing while its
 * result stays the same.
 *
 *   - Three kinds: a shell command run every few seconds (compared on exit code and output), a port on this
 *     computer (up or down), and files or folders (changes reported by the operating system).
 *   - Commands run through Harness's own command runner under the session's sandbox mode and network policy,
 *     resolved at every run, so a watch never has more access than the session's own commands.
 *   - Only an idle agent is woken, with a short notice. While the agent works, checks run but report nothing;
 *     when any turn ends, each watch takes the state then as its new baseline, so the agent's own edits,
 *     commits or server restarts never wake it.
 *   - Each watch has a cooldown between notices (changes inside it are merged) and a notice limit, after
 *     which it stops; it expires after its lifetime and is removed when its session is archived.
 *
 * The agent manages watches with watch_create, watch_list and watch_remove; the user sees and removes them,
 * or adds one, from the eye button in the session header (client.js), through `harnessStudioWatch/call`.
 * Watches are saved in `<home>/harness-studio/watches.json` (store.js) and resume when the app starts.
 */
import os from 'node:os'
import path from 'node:path'
import {
  LIMITS, afterDelivery, compilePattern, deliveryDecision, describe, foldCheck, foldFiles, initialState, isWantedPath, newWatchId,
  noticeMessage, noticeText, normalizeSpec, publicWatch, rebaseline, resultPreview,
} from './logic.js'
import { confinePaths, probePort, runCommand, watchFiles } from './run.js'
import { createStore } from './store.js'

export const name = 'harness-studio-watch'
export const inject = ['tools', 'agents', 'systemPrompt']

export const WATCH_SERVICE = 'harnessStudioWatch'
/** The Preview plugin's dashboards (plugins/devpreview/dashboards.js), for dashboard watches. */
export const DASHBOARDS_SERVICE = 'harnessStudioDashboards'
const REMOTE_METHODS_MARKER = '@deepseek-ai/dsh-typert-protocol/remote-methods'
/** How often every watch is checked against archived sessions and its lifetime. */
const SWEEP_MS = 30_000

const GUIDANCE = [
  'Watches: to learn about something that happens outside your turn — a dev server coming up or going down, git status or a linter\'s output changing, files changing — create a watch with watch_create instead of polling, sleeping in a loop or scheduling repeated checks.',
  'A watch runs on this computer without using the model and wakes you with a short notice only when its result changes or its condition becomes true; changes made while you are working, including your own, never wake you.',
  'Any difference in a command\'s output counts as a change, so keep the output stable (leave out timestamps, timings and counters). Remove watches that stopped mattering with watch_remove.',
].join(' ')

const text = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] }
const isSubagent = agent => agent?.session?.header?.origin === 'subagent'

export function apply(ctx) {
  const profile = ctx.get('profileContext')
  const home = profile?.home ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const store = createStore({ home })

  /** Per watch: its timers, file watcher and the chain its checks run on, one at a time. */
  const runtime = new Map()
  /** Per session: when its latest turn ended. */
  const turnEndedAt = new Map()
  let disposed = false
  const now = () => Date.now()

  const ready = store.load().then(async watches => {
    for (const watch of watches) {
      if (archived(watch.sessionId) || watch.spec.expiresAt <= now()) await store.remove(watch.id)
      else await start(watch).catch(error => stopWatch(watch.id, `could not resume: ${error.message}`))
    }
  }).catch(error => {
    console.warn('[harness-studio] watch: saved watches not loaded:', error?.message ?? error)
  })

  const sweep = setInterval(() => { sweepAll().catch(() => {}) }, SWEEP_MS)
  sweep.unref?.()
  ctx.effect(() => async () => {
    disposed = true
    clearInterval(sweep)
    for (const id of [...runtime.keys()]) stopRuntime(id)
    await store.settled().catch(() => {})
  }, 'watch runtime')

  // ---- sessions -------------------------------------------------------------------------------------
  const archived = id => ctx.get('workspaceRegistry')?.archivedSessionIds?.includes(id) === true

  /** The agent of a session, loading the session when it is not loaded (after a restart). */
  async function agentOf(sessionId) {
    const loaded = ctx.agents.get(sessionId)
    if (loaded) return loaded
    const controller = ctx.get('sessionController')
    if (!controller) throw new Error(`session ${sessionId} is not loaded`)
    const resolve = () => controller.resolveAgent(sessionId)
    const resolved = await (ctx.agents.withoutInitiator ? ctx.agents.withoutInitiator(resolve) : resolve())
    if ('error' in resolved) throw Object.assign(resolved.error ?? new Error(`session ${sessionId} not found`), { gone: true })
    return resolved.agent
  }

  async function folderOf(agent) {
    const workingDirectory = ctx.get('workingDirectory')
    if (workingDirectory) {
      try { return await workingDirectory.ensure(agent) } catch { /* fall back to the session's folder */ }
    }
    return agent.session?.header?.cwd ?? process.cwd()
  }

  const busy = agent => agent.status !== undefined && agent.status !== 'idle'

  // ---- one check --------------------------------------------------------------------------------------
  async function check(watch, agent) {
    if (watch.spec.kind === 'port') return probePort(watch.spec)
    if (watch.spec.kind === 'dashboard') return refreshDashboard(watch.spec, agent)
    const shell = ctx.get('shell')
    if (!shell) return { exitCode: null, output: '', error: 'Harness\'s command runner is not available' }
    const policy = ctx.get('sandboxPolicy')?.resolve({ session: agent.session })
    const rt = runtime.get(watch.id)
    return runCommand(shell, watch.spec, { cwd: await folderOf(agent), sandboxPolicy: policy, signal: rt?.abort.signal })
  }

  /**
   * Refresh a dashboard through the Preview plugin (its dashboards.js), which runs only the refresh scripts the
   * person approved at their current content. The result lists each source as ok or failed, without times, so it
   * stays the same while nothing changes.
   */
  async function refreshDashboard(spec, agent) {
    const dashboards = ctx.get(DASHBOARDS_SERVICE)
    if (!dashboards) return { exitCode: null, output: '', error: 'dashboards need Harness Studio\'s Preview plugin' }
    try {
      const summary = await dashboards.refreshFor({ agent, name: spec.dashboard })
      const failed = Object.entries(summary.errors ?? {})
      const lines = [`${summary.saved} of ${summary.sources} sources refreshed`, ...failed.map(([id, error]) => `${id}: ${String(error).split('\n')[0]}`)]
      return { exitCode: failed.length === 0 ? 0 : 1, output: lines.join('\n') }
    } catch (error) {
      return { exitCode: null, output: '', error: String(error?.message ?? error).split('\n')[0] }
    }
  }

  /** Run `fn` after the watch's earlier work, so its state is never folded twice at once. */
  function queue(id, fn) {
    const rt = runtime.get(id)
    if (!rt) return Promise.resolve()
    rt.chain = rt.chain.then(() => (runtime.get(id) === rt && !disposed ? fn(rt) : undefined)).catch(error => {
      if (!disposed) console.warn(`[harness-studio] watch: ${id}:`, error?.message ?? error)
    })
    return rt.chain
  }

  async function start(watch) {
    // A saved watch may predate the checks on patterns and paths; it stops rather than run unchecked.
    if (watch.spec.pattern !== undefined) compilePattern(watch.spec.pattern)
    if (watch.spec.kind === 'files') {
      if (watch.spec.root === undefined) throw new Error('it was made before file watches were kept to the session folder; create it again')
      await confinePaths(watch.spec.paths, { root: watch.spec.root })
    }
    const rt = { chain: Promise.resolve(), abort: new AbortController(), timer: undefined, delivery: undefined, stopFiles: undefined, ignoreUntil: 0, note: undefined }
    runtime.set(watch.id, rt)
    if (watch.spec.kind === 'files') {
      rt.stopFiles = await watchFiles(watch.spec.paths, paths => queue(watch.id, () => onFiles(watch.id, paths)), {
        accept: file => isWantedPath(watch.spec, file),
        onError: error => ctx.logger?.warn?.('watch: %s: %s', watch.id, error.message),
        onNote: message => {
          rt.note = message
          ctx.logger?.warn?.('watch: %s: %s', watch.id, message)
        },
      })
    } else {
      schedule(watch.id)
    }
  }

  function schedule(id) {
    const rt = runtime.get(id)
    const watch = store.get(id)
    if (!rt || !watch || disposed) return
    clearTimeout(rt.timer)
    rt.timer = setTimeout(() => { queue(id, () => tick(id)) }, watch.spec.interval * 1000)
    rt.timer.unref?.()
  }

  async function tick(id) {
    const watch = store.get(id)
    if (!watch) return
    try {
      if (await gone(watch)) return
      let agent
      try {
        agent = await agentOf(watch.sessionId)
      } catch (error) {
        if (error.gone) return stopWatch(id, 'its session is gone')
        throw error
      }
      const startedAt = now()
      const result = await check(watch, agent)
      if (!store.get(id)) return
      // A turn that ended while this check ran may have caused what it saw.
      const working = busy(agent) || (turnEndedAt.get(watch.sessionId) ?? 0) >= startedAt
      const before = watch.state
      watch.state = foldCheck(watch.spec, before, result, { now: now(), busy: working })
      if ((before.pending === undefined) !== (watch.state.pending === undefined) || before.baselineHolds !== watch.state.baselineHolds) await store.save()
      await deliver(id, agent)
    } finally {
      schedule(id)
    }
  }

  async function onFiles(id, paths) {
    const watch = store.get(id)
    const rt = runtime.get(id)
    if (!watch || !rt || await gone(watch)) return
    const agent = ctx.agents.get(watch.sessionId)
    const working = (agent !== undefined && busy(agent)) || now() < rt.ignoreUntil
    const before = watch.state
    watch.state = foldFiles(watch.spec, before, paths, { now: now(), busy: working })
    if (watch.state.pending !== before.pending) await store.save()
    await deliver(id)
  }

  /** Stop a watch whose session was archived or whose lifetime is over; true when it was stopped. */
  async function gone(watch) {
    if (archived(watch.sessionId)) {
      await stopWatch(watch.id, 'its session was archived')
      return true
    }
    if (watch.spec.expiresAt <= now()) {
      await stopWatch(watch.id, 'its lifetime ended')
      return true
    }
    return false
  }

  // ---- delivery -------------------------------------------------------------------------------------
  async function deliver(id, knownAgent) {
    const watch = store.get(id)
    const rt = runtime.get(id)
    if (!watch || !rt || !watch.state.pending) return
    const decision = deliveryDecision(watch.spec, watch.state, now())
    if (!decision.deliver) {
      if (decision.at !== undefined && rt.delivery === undefined) {
        rt.delivery = setTimeout(() => { rt.delivery = undefined; queue(id, () => deliver(id)) }, Math.max(0, decision.at - now()))
        rt.delivery.unref?.()
      }
      return
    }
    const agent = knownAgent ?? await agentOf(watch.sessionId)
    const last = watch.state.wakes + 1 >= watch.spec.maxWakes
    const { text: body, summary } = noticeText(watch, watch.state, { now: now(), last })
    const message = noticeMessage(body, summary)
    // An idle agent is woken; one that is already working gets the notice at its next step.
    if (busy(agent)) agent.inject(message)
    else agent.followup(message)
    await ctx.get('sessions')?.flush?.(agent.session)
    watch.state = afterDelivery(watch.spec, watch.state, now())
    await store.save()
    if (last) await stopWatch(id, 'it used its last notice')
  }

  // When a turn ends, what the agent could have seen becomes each watch's baseline.
  function onTurnEnd(sessionId) {
    turnEndedAt.set(sessionId, now())
    for (const watch of store.of(sessionId)) {
      queue(watch.id, async rt => {
        const current = store.get(watch.id)
        if (!current) return
        if (current.spec.kind === 'dashboard') {
          // Its refresh runs the dashboard's scripts; a turn ending is no reason to run them again.
          current.state = rebaseline(current.spec, current.state)
        } else if (current.spec.kind === 'files') {
          rt.ignoreUntil = now() + LIMITS.filesTurnGraceMs
          current.state = rebaseline(current.spec, current.state)
        } else {
          const agent = ctx.agents.get(sessionId)
          const result = agent ? await check(current, agent) : undefined
          if (!store.get(watch.id)) return
          current.state = rebaseline(current.spec, current.state, result)
          // The fresh check stands in for the next scheduled one.
          schedule(watch.id)
        }
        await store.save()
      })
    }
  }

  ctx.on('session/event', (session, event) => {
    if (!disposed && event?.type === 'turn/end' && store.of(session.id).length) onTurnEnd(session.id)
  }, { global: true })

  // Harness asks every plugin to stop a session's activity when it is archived with its work stopped.
  ctx.on('workspace/session-stop', async ({ sessionId }) => {
    await ready
    for (const watch of store.of(sessionId)) await stopWatch(watch.id, 'its session was archived')
  })

  async function sweepAll() {
    await ready
    for (const watch of store.all()) await gone(watch)
  }

  // ---- create, list, remove -------------------------------------------------------------------------
  function stopRuntime(id) {
    const rt = runtime.get(id)
    if (!rt) return
    runtime.delete(id)
    clearTimeout(rt.timer)
    clearTimeout(rt.delivery)
    rt.abort.abort()
    rt.stopFiles?.()
  }

  async function stopWatch(id, reason) {
    stopRuntime(id)
    if (store.get(id)) {
      await store.remove(id)
      if (reason) ctx.logger?.info?.('watch: stopped %s: %s', id, reason)
    }
  }

  /**
   * Create a watch for a session, run its first check (the silent baseline) and start it.
   * @param {{ agent: object, args: object, createdBy: 'agent' | 'user' }} request
   * @returns {Promise<{ watch: object, preview: string }>}
   */
  async function createWatch({ agent, args, createdBy }) {
    await ready
    const sessionId = agent.session.id
    if (store.of(sessionId).length >= LIMITS.perSession) throw new Error(`this session already has ${LIMITS.perSession} watches; remove one first`)
    if (store.all().length >= LIMITS.total) throw new Error(`there are already ${LIMITS.total} watches across all sessions; remove some first`)
    const cwd = await folderOf(agent)
    const spec = normalizeSpec(args, { cwd, now: now() })
    if (spec.kind === 'files') {
      let policy
      try { policy = ctx.get('sandboxPolicy')?.resolve({ session: agent.session }) } catch { /* no read-deny list to apply */ }
      spec.root = await confinePaths(spec.paths, { root: cwd, deny: policy?.readDeny?.paths ?? [] })
    }
    const watch = { id: newWatchId(), sessionId, spec, createdBy, createdAt: now(), state: undefined }
    let result = { exitCode: 0, output: '' }
    if (spec.kind !== 'files') {
      runtime.set(watch.id, { chain: Promise.resolve(), abort: new AbortController() })
      try {
        result = await check(watch, agent)
      } finally {
        runtime.delete(watch.id)
      }
      if (result.error) throw new Error(`the first check could not run, so the watch was not created: ${result.error}`)
    }
    watch.state = initialState(spec, result, now())
    if (spec.kind === 'files') watch.state.baselineHolds = undefined
    await store.put(watch)
    try {
      await start(watch)
    } catch (error) {
      await stopWatch(watch.id)
      throw error
    }
    return { watch, preview: resultPreview(spec, result), note: runtime.get(watch.id)?.note }
  }

  function createdText({ watch, preview, note }) {
    const { spec } = watch
    const condition = spec.when === 'change' ? 'when the result changes' : `when "${spec.when}${spec.pattern ? ` /${spec.pattern}/` : ''}" becomes true`
    const holdsNow = spec.when !== 'change' && watch.state.baselineHolds ? ' It holds right now, so it notifies the next time it becomes true after not holding.' : ''
    return [
      `Created watch ${watch.id} "${spec.label}": ${describe(spec)}. It notifies ${condition}, at most once every ${spec.cooldown}s and ${spec.maxWakes} times, and expires ${new Date(spec.expiresAt).toLocaleString()}.${holdsNow}`,
      spec.kind === 'files' ? 'Changes from now on are reported.' : `Current result (the baseline): ${preview}`,
      ...note ? [note] : [],
    ].join('\n')
  }

  function listText(sessionId) {
    const watches = store.of(sessionId)
    if (!watches.length) return '(no watches in this session)'
    return watches.map(w => {
      const p = publicWatch(w, now())
      const notices = p.lastNoticeAt ? `last notice ${new Date(p.lastNoticeAt).toLocaleTimeString()}` : 'no notice yet'
      return `${p.id} "${p.label}" — ${p.what}; notifies on ${p.when}${p.pattern ? ` /${p.pattern}/` : ''}; ${notices}; notices ${p.wakes}/${p.maxWakes}; now: ${p.current.split('\n')[0]}`
    }).join('\n')
  }

  async function removeWatches(sessionId, { id, all }) {
    await ready
    const targets = all ? store.of(sessionId) : store.of(sessionId).filter(w => w.id === id)
    if (!all && targets.length === 0) throw new Error(`${id} is not a watch of this session; watch_list shows them`)
    for (const watch of targets) await stopWatch(watch.id, 'removed')
    return targets
  }

  const ownSession = exec => {
    if (!exec.agent) throw new Error('watches belong to a session')
    if (isSubagent(exec.agent)) throw new Error('watches belong to the top-level session; a helper agent cannot create or remove them')
    return exec.agent
  }

  const tools = [
    {
      name: 'watch_create',
      description: 'Watch something cheaply on this computer and be woken with a short notice only when it changes or a condition becomes true; nothing reaches you while the result stays the same, and changes made while you are working never wake you. Kinds: "command" (a shell command run every interval_seconds under this session\'s sandbox, compared on exit code and output), "port" (whether a port on this computer is accepting connections), "files" (changes to files or folders, reported by the operating system). The first check runs now and is returned as the baseline.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['command', 'port', 'files', 'dashboard'], description: 'What to watch. "dashboard" keeps a dashboard\'s data fresh while it is closed: it runs the dashboard\'s approved refresh scripts every interval_seconds (default 15 minutes, at least 60) and never notifies you.' },
          dashboard: { type: 'string', description: 'For kind dashboard: the dashboard\'s folder name in dashboards/. Its refresh scripts must already be approved by the user in the Dashboards pane.' },
          label: { type: 'string', description: 'A short name shown in notices and in the user\'s list, e.g. "dev server" or "lint".' },
          command: { type: 'string', description: 'For kind command: the shell command. Keep its output stable (no timestamps or timings), since any difference counts as a change; e.g. "git status --porcelain" or "npm run lint --silent 2>&1 | tail -n 30".' },
          port: { type: 'integer', description: 'For kind port: the port number.' },
          host: { type: 'string', enum: ['localhost', '127.0.0.1', '::1'], description: 'For kind port: localhost (default), 127.0.0.1 or ::1. Only this computer can be checked.' },
          paths: { type: 'array', items: { type: 'string' }, description: 'For kind files: files or folders inside the session folder, relative to it; folders include everything under them except .git and node_modules.' },
          when: { type: 'string', enum: ['change', 'match', 'no_match', 'fails', 'succeeds'], description: 'When to notify: change (default; any different result), match / no_match (output starts or stops matching pattern), fails / succeeds (exit code becomes non-zero / zero; for a port: goes down / comes up). Conditions notify when they become true, not on every check while true.' },
          pattern: { type: 'string', description: 'A regular expression: the output to look for with match / no_match; for kind files, which changed paths count.' },
          interval_seconds: { type: 'integer', description: `Seconds between checks for command and port (at least ${LIMITS.minInterval}; default ${LIMITS.defaultInterval.command} for a command, ${LIMITS.defaultInterval.port} for a port). The next check starts after the previous one ends.` },
          timeout_seconds: { type: 'integer', description: `Time limit of one command run (default ${LIMITS.defaultTimeout}, at most ${LIMITS.maxTimeout}).` },
          cooldown_seconds: { type: 'integer', description: `Least time between two notices (at least ${LIMITS.minCooldown}, default ${LIMITS.defaultCooldown}); changes inside it are merged into one notice.` },
          max_wakes: { type: 'integer', description: `Notices this watch may send before it stops (default ${LIMITS.defaultMaxWakes}).` },
          lifetime_minutes: { type: 'integer', description: `Minutes until the watch ends by itself (default ${LIMITS.defaultLifetimeMinutes}, at most ${LIMITS.maxLifetimeMinutes}).` },
        },
        required: ['kind'],
        additionalProperties: false,
      },
      async execute(args, exec) {
        return createdText(await createWatch({ agent: ownSession(exec), args, createdBy: 'agent' }))
      },
    },
    {
      name: 'watch_list',
      description: 'List this session\'s watches: id, what each checks, its condition, its latest result and how many notices it has sent.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async execute(_args, exec) {
        await ready
        return listText(ownSession(exec).session.id)
      },
    },
    {
      name: 'watch_remove',
      description: 'Remove one of this session\'s watches by id, or all of them with all: true.',
      parameters: {
        type: 'object',
        properties: {
          watch_id: { type: 'string', description: 'Id of a watch of this session (from watch_create or watch_list).' },
          all: { type: 'boolean', description: 'Remove every watch of this session.' },
        },
        additionalProperties: false,
      },
      async execute(args, exec) {
        const agent = ownSession(exec)
        if (!args.all && typeof args.watch_id !== 'string') throw new Error('give watch_id, or all: true')
        const removed = await removeWatches(agent.session.id, { id: args.watch_id, all: args.all === true })
        return removed.length ? `Removed ${removed.map(w => `${w.id} "${w.spec.label}"`).join(', ')}.` : 'This session had no watches.'
      },
    },
  ]
  for (const tool of tools) ctx.effect(() => ctx.tools.register({ output: text, ...tool }), `tool ${tool.name}`)

  ctx.systemPrompt.context({
    name: 'harness-studio-watch',
    order: 296,
    interpolate: false,
    text: context => (isSubagent(context.agent) ? '' : GUIDANCE),
  })

  // ---- the header list (client.js) ------------------------------------------------------------------
  const tellAgent = (sessionId, line, summary) => {
    const agent = ctx.agents.get(sessionId)
    if (agent) agent.inject(noticeMessage(line, summary))
  }

  const actions = {
    async list({ sessionId }) {
      await ready
      return store.of(sessionId).map(w => publicWatch(w, now()))
    },
    async remove({ sessionId, id }) {
      const removed = await removeWatches(sessionId, { id })
      tellAgent(sessionId, `The user removed watch ${id} "${removed[0].spec.label}".`, `You removed watch "${removed[0].spec.label}"`)
      return { removed: removed.length }
    },
    async removeAll({ sessionId }) {
      const removed = await removeWatches(sessionId, { all: true })
      if (removed.length) tellAgent(sessionId, `The user removed every watch of this session: ${removed.map(w => `${w.id} "${w.spec.label}"`).join(', ')}.`, 'You removed all watches')
      return { removed: removed.length }
    },
    async create({ sessionId, spec }) {
      const agent = await agentOf(sessionId)
      const created = await createWatch({ agent, args: spec, createdBy: 'user' })
      tellAgent(sessionId, `The user added a watch. ${createdText(created)}`, `You added watch "${created.watch.spec.label}"`)
      return publicWatch(created.watch, now())
    },
  }

  class WatchAccess {
    constructor() {
      this.typertRemote = Object.freeze({ service: this, serviceKey: WATCH_SERVICE, namespace: WATCH_SERVICE })
    }

    /** @param {{ action: string, sessionId: string }} request */
    async call(request) {
      const action = actions[request?.action]
      if (!action) throw new Error(`Unknown action ${request?.action}`)
      if (typeof request.sessionId !== 'string' || request.sessionId === '') throw new Error('sessionId is required')
      return action(request)
    }
  }
  Object.defineProperty(WatchAccess.prototype, REMOTE_METHODS_MARKER, {
    configurable: true,
    value: Object.freeze({ version: 1, methods: Object.freeze([Object.freeze({ method: 'call', invocation: Object.freeze({ kind: 'direct' }) })]) }),
  })
  if (typeof ctx.provide === 'function') ctx.provide(WATCH_SERVICE, new WatchAccess())
  return { actions, ready, sweepAll }
}
