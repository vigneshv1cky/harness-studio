// Child processes: timeout, abort and disposal end the whole process group; nothing outlives the Host.
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createRunner } from '../process.js'

const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }

async function gone(pid, ms = 5000) {
  const until = Date.now() + ms
  while (Date.now() < until) { if (!alive(pid)) return true; await sleep(50) }
  return !alive(pid)
}

// A leader that starts a grandchild in its own group and reports both pids, then waits.
const TREE = ['-c', 'sleep 60 & echo "$$ $!"; wait']

/** Start TREE through the runner and return its promise plus the leader and grandchild pids. */
async function startTree(runner, options = {}) {
  const result = runner.run('sh', TREE, options)
  result.catch(() => {})
  let leader
  for (let i = 0; i < 100 && leader === undefined; i++) { [leader] = runner.live(); await sleep(20) }
  assert.ok(leader, 'process started')
  // The grandchild is the leader's only child.
  let grandchild
  for (let i = 0; i < 100 && !grandchild; i++) {
    const out = await new Promise(r => { const p = spawn('pgrep', ['-P', String(leader)]); let s = ''; p.stdout.on('data', d => { s += d }); p.on('close', () => r(s.trim())) })
    grandchild = Number(out.split('\n')[0]) || undefined
    if (!grandchild) await sleep(20)
  }
  assert.ok(grandchild, 'grandchild started')
  return { result, leader, grandchild }
}

test('dispose mid-spawn kills the process and its grandchildren', { skip: process.platform === 'win32' }, async () => {
  const runner = createRunner()
  const { result, leader, grandchild } = await startTree(runner)
  await runner.dispose()
  await assert.rejects(result, /shutting down/)
  assert.ok(await gone(leader), 'leader is gone')
  assert.ok(await gone(grandchild), 'grandchild is gone')
  assert.deepEqual(runner.live(), [])
  await assert.rejects(runner.run('true', []), /shutting down/)
})

test('timeout kills the whole process group', { skip: process.platform === 'win32' }, async () => {
  const runner = createRunner()
  const { result, leader, grandchild } = await startTree(runner, { timeoutMs: 300 })
  await assert.rejects(result, /timed out/)
  assert.ok(await gone(leader))
  assert.ok(await gone(grandchild))
  await runner.dispose()
})

test('abort signal kills the whole process group', { skip: process.platform === 'win32' }, async () => {
  const runner = createRunner()
  const controller = new AbortController()
  const { result, leader, grandchild } = await startTree(runner, { signal: controller.signal })
  controller.abort(new Error('cancelled by test'))
  await assert.rejects(result, /cancelled by test/)
  assert.ok(await gone(leader))
  assert.ok(await gone(grandchild))
  await runner.dispose()
})

test('a process does not outlive the Node process that started it', { skip: process.platform === 'win32' }, async () => {
  const fixture = fileURLToPath(new URL('./fixtures/exit-mid-spawn.mjs', import.meta.url))
  const host = spawn(process.execPath, [fixture], { stdio: ['ignore', 'pipe', 'inherit'] })
  let out = ''
  host.stdout.on('data', d => { out += d })
  await new Promise(r => host.on('close', r))
  const pid = Number(out.trim())
  assert.ok(pid > 0, `fixture reported a pid (${out})`)
  assert.ok(await gone(pid), 'the child was killed when its Host exited')
})

test('output and failures are reported', async () => {
  const runner = createRunner()
  assert.equal(await runner.run('sh', ['-c', 'echo hello']), 'hello')
  await assert.rejects(runner.run('sh', ['-c', 'echo broken >&2; exit 3']), /broken/)
  await runner.dispose()
})
