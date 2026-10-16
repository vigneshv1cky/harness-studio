/**
 * Relay between the agent's browser tools (Host) and the Browser pane (Client).
 *
 * The pane lives in the Harness window; the tools run in the Host process. The window's Dev Preview
 * client long-polls the local helper for the next command addressed to its Session, runs it in that
 * Session's Browser pane, and posts the result back. A command waits at most `timeoutMs`. While it is
 * still queued it also fails once no window has been serving the Session for NO_WINDOW_MS — no poll
 * held open, no command being run, no poll or result seen recently — because only a Session shown in
 * a window has a Browser pane to drive. A window busy with an earlier command keeps later ones queued.
 */

const POLL_HOLD_MS = 25000
const NO_WINDOW_MS = 4000
const WATCH_MS = 500

export function createBrowserBridge() {
  /** sessionId → { queue: command[], waiters: resolve[], lastSeen: number, inFlight: Set<id> } */
  const sessions = new Map()
  /** command id → { sessionId, resolve, reject } */
  const pending = new Map()
  let nextId = 1

  const entry = (sessionId) => {
    let s = sessions.get(sessionId)
    if (!s) sessions.set(sessionId, s = { queue: [], waiters: [], lastSeen: 0, inFlight: new Set() })
    return s
  }
  /** Hand a command to a window: from now on it counts as being run. */
  const dispatch = (s, command) => { s.inFlight.add(command.id); s.lastSeen = Date.now(); return command }

  return {
    /**
     * Send one command to the Session's Browser pane and wait for its result.
     * @param {string} sessionId
     * @param {string} op - open | back | forward | reload | read | click | type | console
     * @param {object} args
     * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
     * @returns {Promise<object>} the pane's result.
     */
    request(sessionId, op, args, { timeoutMs = 45000, signal } = {}) {
      const s = entry(sessionId)
      const id = String(nextId++)
      const created = Date.now()
      return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('Cancelled')); return }
        const finish = () => {
          pending.delete(id)
          s.inFlight.delete(id)
          s.queue = s.queue.filter(c => c.id !== id)
          clearTimeout(timer)
          clearInterval(watch)
          signal?.removeEventListener('abort', onAbort)
        }
        const fail = message => { finish(); reject(new Error(message)) }
        const timer = setTimeout(() => fail(`The Browser pane did not finish "${op}" within ${Math.round(timeoutMs / 1000)}s`), timeoutMs)
        // Nobody is picking the command up: no window shows this Session.
        const watch = setInterval(() => {
          if (!s.queue.some(c => c.id === id)) return
          if (s.waiters.length > 0 || s.inFlight.size > 0) return
          if (Date.now() - Math.max(created, s.lastSeen) > NO_WINDOW_MS) {
            fail('The Browser pane is only available while this session is open in a Harness window. Ask the user to open the session.')
          }
        }, WATCH_MS)
        const onAbort = () => fail('Cancelled')
        signal?.addEventListener('abort', onAbort, { once: true })
        pending.set(id, { sessionId, resolve: value => { finish(); resolve(value) }, reject: error => { finish(); reject(error) } })
        const command = { id, op, args }
        const waiter = s.waiters.shift()
        if (waiter) waiter(dispatch(s, command))
        else s.queue.push(command)
      })
    },

    /** A window asks for the next command for its Session; resolves with a command or null after a hold. */
    next(sessionId, closed) {
      const s = entry(sessionId)
      s.lastSeen = Date.now()
      if (s.queue.length > 0) return Promise.resolve(dispatch(s, s.queue.shift()))
      return new Promise((resolve) => {
        const done = (command) => { clearTimeout(timer); s.lastSeen = Date.now(); resolve(command ?? null) }
        const timer = setTimeout(() => { s.waiters = s.waiters.filter(w => w !== done); done(null) }, POLL_HOLD_MS)
        closed?.(() => {
          if (!s.waiters.includes(done)) return
          s.waiters = s.waiters.filter(w => w !== done)
          clearTimeout(timer)
          s.lastSeen = Date.now()
        })
        s.waiters.push(done)
      })
    },

    /** A command could not be delivered (its poll closed first): queue it again, at the front. */
    requeue(sessionId, command) {
      const s = sessions.get(sessionId)
      if (!s || !pending.has(command.id)) return
      s.inFlight.delete(command.id)
      const waiter = s.waiters.shift()
      if (waiter) waiter(dispatch(s, command))
      else s.queue.unshift(command)
    },

    /** A window reports a command's result; only the Session the command was sent to can settle it. */
    result(message) {
      if (message === null || typeof message !== 'object') return false
      const { session, id, ok, value, error } = message
      const p = pending.get(String(id))
      if (!p || p.sessionId !== session) return false
      const s = sessions.get(p.sessionId)
      if (s) s.lastSeen = Date.now()
      if (ok === true) p.resolve(value !== null && typeof value === 'object' ? value : {})
      else p.reject(new Error(typeof error === 'string' && error ? error.slice(0, 2000) : 'The Browser pane reported an error'))
      return true
    },

    dispose() {
      for (const p of [...pending.values()]) p.reject(new Error('Harness is shutting down the browser bridge'))
      pending.clear()
      for (const s of sessions.values()) for (const w of s.waiters) w(null)
      sessions.clear()
    },
  }
}
