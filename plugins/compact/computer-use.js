/**
 * Computer use, the parts Harness Studio adds around Harness's macOS provider (the `cua` tool):
 *
 * - the macOS permissions it needs (Accessibility, Screen Recording), read from its helper without opening a
 *   system dialog, with a way to open the right System Settings page;
 * - the applications approved with "Always allow", which can be removed, and the list of refused
 *   applications, which can be edited (both live in the provider's own settings);
 * - which sessions are controlling an application right now, for the Stop bar, and stopping one.
 *
 * Everything is reached through the Settings service's Remote channel (index.js), like the other cards.
 */
import { execFile } from 'node:child_process'

/** The provider's profile entry id (the cordis entry that mounts Harness's macOS computer-use provider). */
export const CUA_ENTRY = 'cua'
/** After a computer-use call ends, the session still counts as controlling its application for this long. */
export const ACTIVE_GRACE_MS = 8000
/** Why the Stop bar cancels a turn: the user stopped it, in the agent loop's own cancel-cause shape. */
export const USER_STOP = Object.freeze({ kind: 'user' })

const PANES = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
}

const run = (file, args, timeout = 5000) => new Promise((resolve, reject) => {
  execFile(file, args, { timeout, encoding: 'utf8' }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
})

/**
 * @param {{
 *   platform?: string,
 *   helperPath: () => string | undefined,
 *   settings: () => any,
 *   agents: () => any,
 *   now?: () => number,
 *   exec?: (file: string, args: string[]) => Promise<string>,
 * }} options
 */
export function createComputerUse(options) {
  const platform = options.platform ?? process.platform
  const now = options.now ?? Date.now
  const exec = options.exec ?? run
  /** sessionId → { app, calls (in flight), lastAt } */
  const activity = new Map()
  /** appHandle → application name, from getApp results. */
  const handles = new Map()

  function entry() {
    const settings = options.settings()
    if (!settings) return undefined
    const descriptor = settings.describe().find(row => row.ns === CUA_ENTRY)
    return descriptor ? { settings, descriptor } : undefined
  }

  const actions = {
    /** Whether computer use is set up here, and its two macOS permissions. */
    async computerStatus() {
      if (platform !== 'darwin') return { supported: false, reason: 'Computer use is available on macOS only.' }
      const found = entry()
      if (!found) return { supported: true, enabled: false }
      const value = found.descriptor.value ?? {}
      const helper = options.helperPath()
      let permissions = null
      let permissionError
      if (helper) {
        try { permissions = JSON.parse((await exec(helper, ['--permissions'])).trim()) } catch (error) { permissionError = String(error?.message ?? error) }
      } else permissionError = 'The computer-use helper is not installed.'
      return {
        supported: true, enabled: true, permissions, permissionError,
        allowedApps: (value.allowedApps ?? []).map(app => ({ id: app.id, name: app.name, path: app.executablePath })),
        refusedApps: value.refusedApps ?? [],
        taskOnlyApps: value.taskOnlyApps ?? [],
      }
    },
    /** Open System Settings at the page for one permission. */
    async openPermission({ permission }) {
      const url = PANES[permission]
      if (!url) throw new Error('permission must be accessibility or screenRecording')
      await exec('open', [url])
      return { opened: true }
    },
    /** Remove an application saved with "Always allow". */
    async forgetApp({ id }) {
      const found = entry()
      if (!found) throw new Error('Computer use is not set up')
      const apps = found.descriptor.value?.allowedApps ?? []
      const next = apps.filter(app => app.id !== id)
      if (next.length === apps.length) return { removed: false }
      await found.settings.mutate(CUA_ENTRY, [{ op: 'set', path: ['allowedApps'], value: next }], found.descriptor.revision)
      return { removed: true }
    },
    /** Replace the list of refused applications. */
    async setRefusedApps({ apps }) {
      if (!Array.isArray(apps) || apps.some(app => typeof app !== 'string')) throw new Error('apps must be a list of names')
      const clean = [...new Set(apps.map(app => app.trim()).filter(Boolean))].slice(0, 200)
      const found = entry()
      if (!found) throw new Error('Computer use is not set up')
      await found.settings.mutate(CUA_ENTRY, [{ op: 'set', path: ['refusedApps'], value: clean }], found.descriptor.revision)
      return { refusedApps: clean }
    },
    /** Sessions controlling an application now (a call in flight, or one that ended moments ago). */
    async computerActivity() {
      const t = now()
      const sessions = []
      for (const [sessionId, state] of activity) {
        if (state.calls > 0 || t - state.lastAt < ACTIVE_GRACE_MS) sessions.push({ sessionId, app: state.app ?? null })
        else if (state.calls === 0) activity.delete(sessionId)
      }
      return { sessions }
    },
    /** Stop a session's turn, which aborts its computer-use call in progress. */
    async stopComputer({ sessionId }) {
      if (typeof sessionId !== 'string' || !sessionId) throw new Error('sessionId is required')
      const agent = options.agents()?.get(sessionId)
      activity.delete(sessionId)
      // Cancelling the turn aborts the computer-use call in flight; input already sent stays done.
      if (!agent || agent.status !== 'running') return { stopped: false }
      // The cause is the loop's structured cancel cause, recorded as the turn's end reason; anything else
      // (a plain sentence) left the turn end without a reason and blanked the session's chat.
      agent.cancel(USER_STOP)
      return { stopped: true }
    },
  }

  /** `tools/execute` listener: follow computer-use calls per session. */
  async function execute(exec, next) {
    if (exec.name !== 'cua') return next()
    const sessionId = exec.agent?.session?.id
    const key = sessionId === undefined ? undefined : String(sessionId)
    const args = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {}
    const params = args.params && typeof args.params === 'object' ? args.params : {}
    let state
    if (key !== undefined) {
      state = activity.get(key) ?? { app: null, calls: 0, lastAt: 0 }
      if (typeof params.appHandle === 'string' && handles.has(params.appHandle)) state.app = handles.get(params.appHandle)
      state.calls++
      activity.set(key, state)
    }
    try {
      const result = await next()
      const value = result && typeof result === 'object' && 'value' in result ? result.value : result
      if (args.method === 'getApp' && value && typeof value === 'object' && typeof value.appHandle === 'string') {
        const name = typeof value.name === 'string' ? value.name : typeof params.selector === 'string' ? params.selector : null
        if (name) { handles.set(value.appHandle, name); if (state) state.app = name }
      }
      return result
    } finally {
      if (state) { state.calls--; state.lastAt = now() }
    }
  }

  return { actions, execute }
}

/**
 * Wire computer use into the Host: the activity listener and the actions the Settings service exposes.
 * @param {object} ctx - the Host plugin context.
 * @returns the actions, merged into the Settings service by index.js.
 */
export function applyComputerUse(ctx) {
  const computer = createComputerUse({
    helperPath: () => process.env.DSH_CUA_HELPER || undefined,
    settings: () => ctx.get('settings'),
    agents: () => ctx.get('agents'),
  })
  if (typeof ctx.on === 'function') ctx.on('tools/execute', (exec, next) => computer.execute(exec, next))
  return computer.actions
}
