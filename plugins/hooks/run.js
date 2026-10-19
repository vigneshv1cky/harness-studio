/**
 * Runs one hook command the way Claude Code does: through the user's shell in the project folder, with the
 * event as JSON on standard input, a time limit, and its exit code and output collected.
 *
 * Hooks are the user's own commands, so they run outside the agent's sandbox, as they do in Claude Code.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

/** Bytes of standard output or standard error kept from one hook. */
export const OUTPUT_LIMIT = 64 * 1024
const KILL_GRACE_MS = 2000

const shell = () => (existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh')

/**
 * @param {{ command: string, cwd: string, input: object, timeoutMs: number, env?: Record<string, string>, signal?: AbortSignal }} options
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string, timedOut: boolean, error?: string }>}
 */
export function runHook({ command, cwd, input, timeoutMs, env = {}, signal }) {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(shell(), ['-c', command], { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, error: error.message })
      return
    }
    const out = { stdout: '', stderr: '' }
    let timedOut = false
    let settled = false
    const collect = key => chunk => {
      if (out[key].length < OUTPUT_LIMIT) out[key] += chunk.toString('utf8').slice(0, OUTPUT_LIMIT - out[key].length)
    }
    child.stdout.on('data', collect('stdout'))
    child.stderr.on('data', collect('stderr'))
    // Kill the whole process group, so a hook that starts its own children does not leave them running.
    const kill = sig => {
      try {
        if (child.pid !== undefined && process.platform !== 'win32') process.kill(-child.pid, sig)
        else child.kill(sig)
      } catch { /* the process already exited */ }
    }
    const stop = () => {
      kill('SIGTERM')
      setTimeout(() => kill('SIGKILL'), KILL_GRACE_MS).unref()
    }
    const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
    const onAbort = () => stop()
    signal?.addEventListener('abort', onAbort, { once: true })
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }
    child.on('error', error => finish({ code: null, ...out, timedOut, error: error.message }))
    child.on('close', code => finish({ code, ...out, timedOut }))
    // A hook that never reads its input closes the pipe early; that is not an error.
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(input))
  })
}
