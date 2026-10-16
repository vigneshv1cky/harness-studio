/**
 * Every process the Sessions plugin starts goes through one runner, which owns it until it exits:
 *
 *   - each process gets a timeout and an optional abort signal;
 *   - on POSIX it starts as the leader of its own process group (`detached`), so stopping it signals the
 *     whole group (`kill(-pid)`), grandchildren included: SIGTERM, then SIGKILL after a grace period;
 *     on Windows the tree is ended with `taskkill /T /F`, as plugins/connectors/mcp-connection.js does;
 *   - the runner stops every live process on timeout, abort, `dispose()` (plugin disposal or Host
 *     shutdown), and synchronously on the Node process's `exit`, so none outlives Harness.
 */
import { execFileSync, spawn } from 'node:child_process'

const KILL_GRACE_MS = 2000
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const isWindows = process.platform === 'win32'

/** Signal a process tree. Errors mean the tree is already gone. */
function signalTree(pid, signal) {
  if (isWindows) {
    try { execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* already exited */ }
    return
  }
  try { process.kill(-pid, signal) } catch { /* the group already exited */ }
}

/**
 * @returns {{
 *   run(file: string, args: string[], options?: { cwd?: string, timeoutMs?: number, signal?: AbortSignal }): Promise<string>,
 *   live(): number[],
 *   dispose(): Promise<void>,
 * }}
 */
export function createRunner({ defaultTimeoutMs = 60000 } = {}) {
  /** pid → { done: Promise<void>, stop(reason): void } */
  const children = new Map()
  let disposed = false

  const onExit = () => { for (const pid of children.keys()) signalTree(pid, 'SIGKILL') }
  process.on('exit', onExit)

  function run(file, args, { cwd, timeoutMs = defaultTimeoutMs, signal } = {}) {
    if (disposed) return Promise.reject(new Error('The Sessions plugin is shutting down'))
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'))
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, { cwd, detached: !isWindows, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let stopReason
      let killTimer
      const take = (current, chunk) => (current.length < MAX_OUTPUT_BYTES ? current + chunk : current)
      child.stdout.setEncoding('utf8').on('data', chunk => { stdout = take(stdout, chunk) })
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr = take(stderr, chunk) })

      const stop = reason => {
        if (stopReason !== undefined || child.pid === undefined) return
        stopReason = reason
        signalTree(child.pid, 'SIGTERM')
        killTimer = setTimeout(() => signalTree(child.pid, 'SIGKILL'), KILL_GRACE_MS)
        killTimer.unref()
      }
      const timer = setTimeout(() => stop(new Error(`${file} ${args[0] ?? ''} timed out after ${timeoutMs} ms`)), timeoutMs)
      timer.unref()
      const onAbort = () => stop(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
      signal?.addEventListener('abort', onAbort, { once: true })

      let settle
      const done = new Promise(r => { settle = r })
      const finish = (error, value) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (child.pid !== undefined) {
          children.delete(child.pid)
          // The leader exited, but anything it left in its group is ended too.
          if (stopReason !== undefined) signalTree(child.pid, 'SIGKILL')
        }
        clearTimeout(killTimer)
        settle()
        if (error) reject(error)
        else resolve(value)
      }
      child.on('error', error => finish(error))
      child.on('close', (code, sig) => {
        if (stopReason !== undefined) return finish(stopReason)
        if (code === 0) return finish(undefined, stdout.trim())
        const detail = String(stderr || stdout || `exit ${code ?? sig}`).trim().split('\n').slice(-3).join(' ')
        finish(Object.assign(new Error(detail), { code, signal: sig }))
      })
      if (child.pid !== undefined) children.set(child.pid, { done, stop })
    })
  }

  return {
    run,
    live: () => [...children.keys()],
    async dispose() {
      disposed = true
      const waiting = [...children.values()].map(entry => { entry.stop(new Error('The Sessions plugin is shutting down')); return entry.done })
      await Promise.all(waiting)
      process.off('exit', onExit)
    },
  }
}
