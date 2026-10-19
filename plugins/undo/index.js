/**
 * Undo for Harness Studio, like Claude Code's rewind for file edits: before the agent first changes a file in
 * a turn, a copy of the file is kept; the Undo row under a turn puts every file changed in that turn and later
 * back the way it was before that turn.
 *
 * What is covered: changes made through the agent's file tools (write and edit). Changes made by shell
 * commands are not, as in Claude Code, because a command can touch any file without saying which.
 */
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createStore } from './store.js'

export const name = 'harness-studio-undo'

export const UNDO_SERVICE = 'harnessStudioUndo'
const REMOTE_METHODS_MARKER = '@deepseek-ai/dsh-typert-protocol/remote-methods'
const SOURCE = 'harness-studio-undo'

/**
 * The file a mutating tool call is about to change, or undefined for any other call.
 * @param {string} name - tool name.
 * @param {any} args - its arguments.
 */
export function targetOf(name, args) {
  if ((name === 'write' || name === 'edit') && typeof args?.file_path === 'string') return args.file_path
  if (name === 'str_replace_editor' && ['create', 'str_replace', 'insert'].includes(args?.command) && typeof args?.path === 'string') return args.path
  return undefined
}

function notice(text, summary) {
  const message = { content: [{ type: 'text', text }], source: { kind: SOURCE, form: 'notice', summary }, role: 'user', id: randomUUID() }
  Object.freeze(message.content[0])
  Object.freeze(message.content)
  Object.freeze(message.source)
  return Object.freeze(message)
}

export function apply(ctx) {
  const profile = ctx.get('profileContext')
  const home = profile?.home ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const store = createStore(path.join(home, 'harness-studio', 'undo'))

  /** The turn each session is in, from the step about to run, by session id. */
  const turns = new Map()
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'reject') turns.set(String(payload.agent.session.id), payload.turn)
    return decision
  })

  /**
   * The conversation a change belongs to: a helper agent's edits count towards the turn of the session the
   * user is talking to (the root of its parent chain), so Undo under that turn puts them back too.
   */
  function rootSessionId(session) {
    let id = String(session.id)
    let header = session.header
    for (let depth = 0; header?.parentSession !== undefined && depth < 16; depth++) {
      id = String(header.parentSession)
      header = ctx.get('agents')?.get(id)?.session?.header
    }
    return id
  }

  // The copy is taken as the call runs, after every check and approval, so a change the user approved on an
  // "ask" card is covered too, and a call that was refused leaves nothing behind.
  ctx.on('tools/execute', async (exec, next) => {
    const target = exec.agent === undefined ? undefined : targetOf(exec.name, exec.arguments)
    const sessionId = target === undefined ? undefined : rootSessionId(exec.agent.session)
    const turn = sessionId === undefined ? undefined : turns.get(sessionId)
    if (target !== undefined && turn !== undefined) {
      try {
        let base = exec.agent.session.header?.cwd ?? process.cwd()
        const workingDirectory = ctx.get('workingDirectory')
        if (workingDirectory !== undefined) base = await workingDirectory.ensure(exec.agent, exec.signal).catch(() => base)
        await store.capture(sessionId, turn, path.resolve(base, target))
      } catch (error) {
        // A missing snapshot only means this change cannot be undone; the edit itself goes ahead.
        ctx.logger.warn('undo: could not keep a copy of %s before it changed: %s', target, error.message)
      }
    }
    return next()
  })

  const actions = {
    list: ({ sessionId }) => store.list(sessionId),
    async restore({ sessionId, turn }) {
      if (!Number.isInteger(turn)) throw new Error('turn must be a whole number')
      const result = await store.restore(sessionId, turn)
      const changed = [...result.restored, ...result.removed]
      // The agent's picture of these files is now out of date; tell it before its next step.
      const agent = changed.length ? ctx.get('agents')?.get(sessionId) : undefined
      if (agent !== undefined) {
        const lines = [
          `The user undid file changes from turn ${turn} onward. These files are back to how they were before that turn; read them again before relying on their content:`,
          ...result.restored.map(file => `- ${file} (restored)`),
          ...result.removed.map(file => `- ${file} (removed: it did not exist before)`),
        ]
        agent.inject(notice(lines.join('\n'), `Undid file changes from turn ${turn} onward`))
      }
      return result
    },
  }

  class UndoAccess {
    constructor() {
      this.typertRemote = Object.freeze({ service: this, serviceKey: UNDO_SERVICE, namespace: UNDO_SERVICE })
    }

    /** @param {{ action: string }} request */
    async call(request) {
      const action = actions[request?.action]
      if (!action) throw new Error(`Unknown action ${request?.action}`)
      return action(request)
    }
  }
  Object.defineProperty(UndoAccess.prototype, REMOTE_METHODS_MARKER, {
    configurable: true,
    value: Object.freeze({ version: 1, methods: Object.freeze([Object.freeze({ method: 'call', invocation: Object.freeze({ kind: 'direct' }) })]) }),
  })
  if (typeof ctx.provide === 'function') ctx.provide(UNDO_SERVICE, new UndoAccess())
  return { actions }
}
