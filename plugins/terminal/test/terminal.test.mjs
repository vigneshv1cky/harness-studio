import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { createTerminals } from '../index.js'
import { keysToBytes, readScreen, screenText } from '../screen.js'

const HEADLESS = new URL('../../../harness/node_modules/.pnpm/@xterm+headless@6.0.0/node_modules/@xterm/headless/lib-headless/xterm-headless.js', import.meta.url)
const headless = await import(HEADLESS)
const Terminal = headless.Terminal ?? headless.default.Terminal

/** A stand-in PTY: records what is written and lets the test print output and end the program. */
function fakePty() {
  const output = new EventEmitter()
  let finish
  const handle = {
    output,
    written: [],
    terminated: false,
    done: new Promise(resolve => { finish = resolve }),
    write: async (data) => { handle.written.push(data) },
    terminate: async () => { handle.terminated = true; finish({ exitCode: null, signal: 'SIGTERM' }) },
    print: data => output.emit('data', Buffer.from(data)),
    exit: code => finish({ exitCode: code, signal: null }),
  }
  return handle
}

function setup({ policy = { mode: 'workspace-write' }, confine, spawn, rootOf } = {}) {
  const ptys = []
  const state = { policy, confined: [], policyReads: 0 }
  const terminals = createTerminals({
    spawn: async (spec) => { const pty = spawn ? spawn() : fakePty(); pty.spec = spec; ptys.push(pty); return pty },
    rootOf,
    policyOf: () => { state.policyReads++; return state.policy },
    confine: confine ?? (async (argv, p) => { state.confined.push({ argv, mode: p.mode }); return ['sandbox-exec', '--', ...argv] }),
    cwdOf: async () => '/work',
    Terminal: async () => Terminal,
  })
  return { terminals, ptys, state, agent: {} }
}

test('named keys become the bytes terminals expect, including application cursor mode', () => {
  assert.equal(keysToBytes(['Enter', 'Tab', 'Escape', 'Backspace']), '\r\t\x1b\x7f')
  assert.equal(keysToBytes(['Up', 'Left']), '\x1b[A\x1b[D')
  assert.equal(keysToBytes(['up'], { applicationCursor: true }), '\x1bOA')
  assert.equal(keysToBytes(['Ctrl-C', 'ctrl-d', 'Ctrl-[']), '\x03\x04\x1b')
  assert.equal(keysToBytes(['Alt-x', 'F1', 'F12', 'PageDown']), '\x1bx\x1bOP\x1b[24~\x1b[6~')
  assert.equal(keysToBytes([':', 'W', ' ']), ':W ')
  assert.throws(() => keysToBytes(['Hyper-Q']), /unknown key "Hyper-Q"/)
})

test('the screen is read from the emulator, with the cursor and without trailing blanks', async () => {
  const term = new Terminal({ cols: 20, rows: 5, allowProposedApi: true })
  await new Promise(resolve => term.write('\x1b[2J\x1b[Htop line\r\n\x1b[3;5Hmiddle', resolve))
  const screen = readScreen(term)
  assert.deepEqual(screen.lines, ['top line', '', '    middle'])
  assert.deepEqual(screen.cursor, { row: 3, column: 11 })
  assert.match(screenText({ id: 't1', command: 'top', cols: 20, rows: 5, status: 'running', ...screen }), /^Terminal t1 · top · 20×5 · running\nCursor: row 3, column 11\n──── screen ────\ntop line\n\n    middle\n────────────────$/)
})

test('a program starts confined in the session folder, and keys reach it', async () => {
  const { terminals, ptys, state, agent } = setup()
  const started = terminals.start(agent, { command: 'vim notes.txt', cols: 40, rows: 10, wait_ms: 0 })
  const shown = await started
  assert.deepEqual(state.confined, [{ argv: ['bash', '-c', 'vim notes.txt'], mode: 'workspace-write' }])
  assert.deepEqual(ptys[0].spec.argv, ['sandbox-exec', '--', 'bash', '-c', 'vim notes.txt'])
  assert.equal(ptys[0].spec.cwd, '/work')
  assert.equal(ptys[0].spec.cols, 40)
  assert.match(shown, /^Terminal t1 · vim notes\.txt · 40×10 · running/)

  ptys[0].print('\x1b[2J\x1b[H~\r\n~\r\n"notes.txt" [New]')
  const screen = await terminals.screen(agent, { id: 't1' })
  assert.match(screen, /──── screen ────\n~\n~\n"notes\.txt" \[New\]\n────/)

  await terminals.send(agent, { id: 't1', text: 'ihello', keys: ['Escape', ':', 'w', 'q', 'Enter'], wait_ms: 0 })
  assert.equal(ptys[0].written.join(''), 'ihello\x1b:wq\r')
})

test('exits, limits, sandbox changes and stopping are reported', async () => {
  const { terminals, ptys, state, agent } = setup()
  await terminals.start(agent, { command: 'true', wait_ms: 0 })
  ptys[0].exit(0)
  await new Promise(resolve => setImmediate(resolve))
  assert.match(await terminals.screen(agent, { id: 't1' }), /exited with code 0/)
  assert.match(await terminals.send(agent, { id: 't1', keys: ['Enter'] }), /nothing was sent/)

  // The exited terminal stays readable but holds no slot: four more programs can run.
  for (let i = 0; i < 4; i++) await terminals.start(agent, { command: `sleep ${i}`, wait_ms: 0 })
  await assert.rejects(terminals.start(agent, { command: 'one more', wait_ms: 0 }), /already have 4 terminals running \(t2, t3, t4, t5\)/)

  state.policy = { mode: 'read-only' }
  await assert.rejects(terminals.screen(agent, { id: 't2' }), /sandbox setting changed/)
  assert.equal(ptys[1].terminated, true)
  state.policy = { mode: 'workspace-write' }

  const stopped = await terminals.stop(agent, { id: 't3' })
  assert.match(stopped, /^Stopped terminal t3\. Its last screen:/)
  assert.equal(ptys[2].terminated, true)
  // t1, exited, was dropped when t5 needed the room.
  await assert.rejects(terminals.screen(agent, { id: 't3' }), /there is no terminal "t3"; open terminals: t4, t5/)
  assert.match(terminals.list(agent), /^t4 · sleep 2 · running\nt5 · sleep 3 · running$/)

  await terminals.closeAll()
  assert.equal(ptys[3].terminated, true)
  assert.equal(ptys[4].terminated, true)
  assert.equal(terminals.list(agent), 'No terminals are open in this session.')
  await assert.rejects(terminals.start(agent, { command: '  ' }), /command is required/)
})

test('an open terminal is closed within 2 seconds of the session\'s sandbox setting changing', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const { terminals, ptys, state, agent } = setup({ policy: { mode: 'danger-full-access' } })
  await terminals.start(agent, { command: 'sleep 100', wait_ms: 0 })
  await terminals.start(agent, { command: 'sleep 200', wait_ms: 0 })
  t.mock.timers.tick(2000)
  assert.equal(ptys[0].terminated, false, 'an unchanged setting leaves terminals running')

  state.policy = { mode: 'workspace-write' }
  t.mock.timers.tick(2000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ptys[0].terminated, true)
  assert.equal(ptys[1].terminated, true)
  await assert.rejects(terminals.screen(agent, { id: 't1' }), /terminal t1 was closed because the session's sandbox setting changed; start it again/)
  assert.equal(terminals.list(agent), 'No terminals are open in this session.')

  const reads = state.policyReads
  t.mock.timers.tick(10000)
  assert.equal(state.policyReads, reads, 'the check stops once no terminals are open')
})

test('starts made at the same time stay within the limit, and a start that outlives its session is ended', async () => {
  const { terminals, ptys, agent } = setup()
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => terminals.start(agent, { command: `sleep ${i}`, wait_ms: 0 })))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 4)
  assert.equal(results.filter(r => r.status === 'rejected').length, 2)
  assert.match(results.find(r => r.status === 'rejected').reason.message, /already have 4 terminals running/)
  assert.equal(ptys.length, 4)
  await terminals.closeAll()

  let release
  const slow = setup({ confine: argv => new Promise(resolve => { release = () => resolve(argv) }) })
  const started = slow.terminals.start(slow.agent, { command: 'less notes.txt', wait_ms: 0 })
  await new Promise(resolve => setImmediate(resolve))
  await slow.terminals.closeAll(slow.agent)
  release()
  await assert.rejects(started, /the session ended while the terminal was starting/)
  assert.equal(slow.ptys.length, 1)
  assert.equal(slow.ptys[0].terminated, true)
  assert.equal(slow.terminals.list(slow.agent), 'No terminals are open in this session.')
})

test('exited terminals free their slot, and the oldest are dropped to make room', async () => {
  const { terminals, ptys, agent } = setup()
  for (let i = 0; i < 4; i++) { await terminals.start(agent, { command: `job ${i}`, wait_ms: 0 }); ptys[i].exit(0) }
  await new Promise(resolve => setImmediate(resolve))
  await terminals.start(agent, { command: 'next', wait_ms: 0 })
  assert.match(terminals.list(agent), /^t2 · job 1 · exited\nt3 · job 2 · exited\nt4 · job 3 · exited\nt5 · next · running$/)
  await assert.rejects(terminals.screen(agent, { id: 't1' }), /terminal t1 was closed because its program had exited and a new terminal needed the room/)
  await terminals.closeAll()
})

test('the limit is shared by a session and its helper agents', async () => {
  const { terminals, agent } = setup({ rootOf: a => a.root })
  const lead = { root: 's1' }
  const helpers = [{ root: 's1' }, { root: 's1' }]
  await terminals.start(lead, { command: 'a', wait_ms: 0 })
  for (const helper of helpers) await terminals.start(helper, { command: 'b', wait_ms: 0 })
  await terminals.start(helpers[0], { command: 'c', wait_ms: 0 })
  await assert.rejects(terminals.start(helpers[1], { command: 'd', wait_ms: 0 }), /this session and its helper agents already have 4 terminals running \(t1, t2, t4, t3\)/)
  await terminals.start({ root: 's2' }, { command: 'other session', wait_ms: 0 })
  assert.equal(agent.root, undefined)
  await terminals.closeAll()
})

/** A real looping shell in its own process group, whose teardown gives up the way Harness's does against a shell that keeps starting children. */
function loopingShell() {
  const child = spawn('bash', ['-c', 'while true; do sleep 0.1; done'], { detached: true, stdio: ['pipe', 'pipe', 'ignore'] })
  const output = new EventEmitter()
  child.stdout.on('data', chunk => output.emit('data', chunk))
  const handle = {
    pid: child.pid,
    output,
    terminated: false,
    done: new Promise(resolve => child.on('exit', (code, signal) => resolve({ exitCode: code, signal }))),
    write: async (data) => { child.stdin.write(data) },
    terminate: async () => { handle.terminated = true; throw new Error('terminal cleanup failed; surviving pids: 1') },
  }
  return handle
}
const groupAlive = (pgid) => { try { process.kill(-pgid, 0); return true } catch (error) { return error.code === 'EPERM' } }
const killGroup = (pgid) => { try { process.kill(-pgid, 'SIGKILL') } catch { /* already gone */ } }

test('stopping a terminal ends a looping program\'s whole process group', async (t) => {
  const { terminals, ptys, agent } = setup({ spawn: loopingShell })
  await terminals.start(agent, { command: 'while true; do sleep 0.1; done', wait_ms: 0 })
  const pgid = ptys[0].pid
  t.after(() => killGroup(pgid))
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(groupAlive(pgid), true)
  assert.match(await terminals.stop(agent, { id: 't1' }), /^Stopped terminal t1\./)
  assert.equal(groupAlive(pgid), false, 'no process of the program is left')
})

test('the 30-minute idle close ends a looping program too', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { terminals, ptys, agent } = setup({ spawn: loopingShell })
  await terminals.start(agent, { command: 'while true; do sleep 0.1; done', wait_ms: 0 })
  const pgid = ptys[0].pid
  t.after(() => killGroup(pgid))
  t.mock.timers.tick(30 * 60 * 1000)
  const deadline = Date.now() + 5000
  while (!ptys[0].terminated && Date.now() < deadline) { t.mock.timers.tick(25); await new Promise(resolve => setImmediate(resolve)) }
  assert.equal(groupAlive(pgid), false, 'no process of the program is left')
  await assert.rejects(terminals.screen(agent, { id: 't1' }), /was closed because it was unused for 30 minutes/)
})

test('the Session pane lists a session\'s terminals and the user can stop one; the agent is told why', async () => {
  const { terminals, ptys } = setup()
  const agent = { session: { id: 's1' } }
  const other = { session: { id: 's2' } }
  await terminals.start(agent, { command: 'less README.md', wait_ms: 0 })
  await terminals.start(other, { command: 'vim x', wait_ms: 0 })
  const listed = terminals.sessionList('s1')
  assert.equal(listed.length, 1)
  assert.equal(listed[0].command, 'less README.md')
  assert.equal(listed[0].running, true)
  assert.equal(typeof listed[0].startedAt, 'number')
  ptys[0].exit(0)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(terminals.sessionList('s1')[0].running, false, 'an exited program shows as finished')
  assert.deepEqual(await terminals.userStop('s2', 't1'), { stopped: false }, 'another session\'s id stops nothing')
  assert.deepEqual(await terminals.userStop('s1', 't1'), { stopped: true })
  assert.deepEqual(terminals.sessionList('s1'), [])
  await assert.rejects(terminals.screen(agent, { id: 't1' }), /closed because the user stopped it/)
  await terminals.closeAll()
})
