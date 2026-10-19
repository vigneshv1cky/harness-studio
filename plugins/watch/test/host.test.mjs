// The Host half against a fake Harness, with a clock the tests move: creating, checking, waking only on
// change and only when idle, the turn-end baseline, cooldown merging, the notice limit, the sandbox policy,
// archive removal, saving and resuming, and the header list's actions.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import { apply } from '../index.js'

class FakeAgent {
  constructor(id, cwd, origin) {
    this.id = id
    this.status = 'idle'
    this.session = { id, header: { cwd, ...origin ? { origin } : {} } }
    this.followed = []
    this.injected = []
  }
  followup(message) { this.followed.push(message); this.status = 'running' }
  inject(message) { this.injected.push(message) }
}

/** Let the work a clock step started finish, including real disk writes (the clock is mocked, real time is not). */
const settle = async () => {
  const end = performance.now() + 25
  while (performance.now() < end) await new Promise(resolve => setImmediate(resolve))
}

async function harness(t, { home: givenHome, outputs, readDeny } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 })
  const home = givenHome ?? await realpath(await mkdtemp(path.join(os.tmpdir(), 'hs-watch-host-')))
  if (!givenHome) t.after(() => rm(home, { recursive: true, force: true }))
  const listeners = new Map()
  const disposers = []
  const tools = new Map()
  const agents = new Map()
  const archived = []
  /** What each command prints now: command → { exitCode, stdout }. */
  const out = outputs ?? new Map()
  const ran = []
  const policies = []
  const ctx = {
    get: name => ({
      profileContext: { home },
      shell: {
        resolve: request => request,
        execute: async spec => {
          ran.push(spec)
          const now = out.get(spec.command) ?? { exitCode: 0, stdout: '' }
          if (now.throws) throw new Error(now.throws)
          return { result: async () => ({ exitCode: now.exitCode, timedOut: false, stdout: { text: now.stdout }, stderr: { text: '' } }) }
        },
      },
      sandboxPolicy: { resolve: ({ session }) => { const p = { mode: 'workspace-write', workspaceRoot: session.header.cwd, sessionId: session.id, network: { mode: 'off' }, ...readDeny ? { readDeny: { paths: readDeny, except: [] } } : {} }; policies.push(p); return p } },
      sessions: { flush: async () => true },
      workspaceRegistry: { archivedSessionIds: archived },
      sessionController: { resolveAgent: async id => (agents.has(id) ? { agent: agents.get(id) } : { error: new Error(`session "${id}" not found`) }) },
    })[name],
    effect: fn => { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    on: (name, fn) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn) },
    tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
    systemPrompt: { context: () => {} },
    agents: { get: id => agents.get(id), withoutInitiator: fn => fn() },
    logger: { info: () => {}, warn: () => {} },
  }
  const plugin = apply(ctx, {})
  await plugin.ready
  const emit = async (name, ...args) => { for (const fn of listeners.get(name) ?? []) await fn(...args) }
  const agent = new FakeAgent('session-1', home)
  agents.set(agent.id, agent)
  const call = (name, args, who = agent) => tools.get(name).execute(args, { agent: who, signal: new AbortController().signal })
  /** Move the clock and let the checks it starts finish. */
  const advance = async ms => {
    // Checks run at least 5 s apart, so long jumps can move in 5 s steps.
    const step = ms > 60_000 ? 5_000 : 1_000
    for (let left = ms; left > 0; left -= step) {
      t.mock.timers.tick(Math.min(step, left))
      await settle()
    }
  }
  const endTurn = async (who = agent) => {
    who.status = 'idle'
    await emit('session/event', who.session, { type: 'turn/end', data: { turn: 1 } })
    await settle()
  }
  let disposed = false
  const dispose = async () => { if (disposed) return; disposed = true; for (const d of disposers.reverse()) await d() }
  t.after(dispose)
  return { home, ctx, plugin, agents, agent, archived, out, ran, policies, tools, call, emit, advance, endTurn, dispose }
}

const watchesFile = home => path.join(home, 'harness-studio', 'watches.json')
const idOf = text => /Created watch (watch-[0-9a-f]+)/.exec(text)[1]

test('a command watch stays silent while its output is the same and wakes an idle agent once it changes', async t => {
  const h = await harness(t)
  h.out.set('git status --porcelain', { exitCode: 0, stdout: '' })
  const created = await h.call('watch_create', { kind: 'command', command: 'git status --porcelain', label: 'git', interval_seconds: 5 })
  assert.match(created, /Created watch watch-[0-9a-f]+ "git"/)
  assert.match(created, /Current result \(the baseline\): exit code 0, no output/)
  await h.advance(30_000)
  assert.ok(h.ran.length >= 6, `checked ${h.ran.length} times`)
  assert.equal(h.agent.followed.length + h.agent.injected.length, 0, 'nothing reached the agent')

  h.out.set('git status --porcelain', { exitCode: 0, stdout: ' M index.html' })
  await h.advance(5_000)
  assert.equal(h.agent.followed.length, 1)
  const notice = h.agent.followed[0]
  assert.equal(notice.source.kind, 'harness-studio-watch')
  assert.equal(notice.source.form, 'notice')
  assert.match(notice.content[0].text, /Watch "git" \(watch-[0-9a-f]+\)/)
  assert.match(notice.content[0].text, /\+  M index\.html/)
  // Commands ran in the session folder under the session's resolved sandbox and network policy.
  const spec = h.ran.at(-1)
  assert.equal(spec.workdir, h.home)
  assert.deepEqual(spec.sandboxPolicy.network, { mode: 'off' })
  assert.equal(spec.sandboxPolicy.sessionId, 'session-1')
})

test('while the agent works nothing is sent, and its own changes become the baseline when the turn ends', async t => {
  const h = await harness(t)
  h.out.set('lint', { exitCode: 0, stdout: 'clean' })
  await h.call('watch_create', { kind: 'command', command: 'lint', interval_seconds: 5 })
  h.agent.status = 'running'
  h.out.set('lint', { exitCode: 1, stdout: 'a.js: error' })
  await h.advance(20_000)
  assert.equal(h.agent.followed.length + h.agent.injected.length, 0)
  await h.endTurn()
  await h.advance(20_000)
  assert.equal(h.agent.followed.length, 0, 'the agent is not told about its own change')
  h.out.set('lint', { exitCode: 0, stdout: 'clean' })
  await h.advance(5_000)
  assert.equal(h.agent.followed.length, 1, 'a later change still wakes it')
  assert.match(h.agent.followed[0].content[0].text, /Before: exit code 1\. Now: exit code 0\./)
})

test('changes inside the cooldown are merged into one notice, and the last allowed notice stops the watch', async t => {
  const h = await harness(t)
  h.out.set('n', { exitCode: 0, stdout: '0' })
  const id = idOf(await h.call('watch_create', { kind: 'command', command: 'n', interval_seconds: 5, cooldown_seconds: 60, max_wakes: 2 }))
  h.out.set('n', { exitCode: 0, stdout: '1' })
  await h.advance(5_000)
  assert.equal(h.agent.followed.length, 1)
  await h.endTurn()
  // The turn's end took '1' as the baseline; these changes come later.
  h.out.set('n', { exitCode: 0, stdout: '2' })
  await h.advance(10_000)
  h.out.set('n', { exitCode: 0, stdout: '3' })
  await h.advance(10_000)
  assert.equal(h.agent.followed.length, 1, 'held by the cooldown')
  await h.advance(45_000)
  assert.equal(h.agent.followed.length, 2)
  const text = h.agent.followed[1].content[0].text
  assert.match(text, /changed 2 times since the last notice/)
  assert.match(text, /\+ 3/)
  assert.match(text, /last notice this watch may send/)
  assert.match(await h.call('watch_list', {}), /no watches/)
  const saved = JSON.parse(await readFile(watchesFile(h.home), 'utf8'))
  assert.equal(saved.watches[id], undefined)
})

test('a condition notifies when it becomes true; a busy agent gets news from an idle moment at its next step', async t => {
  const h = await harness(t)
  h.out.set('build', { exitCode: 0, stdout: 'ok' })
  await h.call('watch_create', { kind: 'command', command: 'build', when: 'fails', interval_seconds: 5, cooldown_seconds: 30 })
  h.out.set('build', { exitCode: 0, stdout: 'ok again' })
  await h.advance(10_000)
  assert.equal(h.agent.followed.length, 0, 'still succeeding: no notice')
  h.out.set('build', { exitCode: 1, stdout: 'broken' })
  await h.advance(5_000)
  assert.equal(h.agent.followed.length, 1)
  assert.match(h.agent.followed[0].content[0].text, /condition "fails" now holds/)
  await h.endTurn()
  h.out.set('build', { exitCode: 0, stdout: 'ok' })
  await h.advance(5_000)
  h.out.set('build', { exitCode: 1, stdout: 'broken again' })
  await h.advance(5_000)
  // Held by the cooldown; the user starts a turn before it ends.
  h.agent.status = 'running'
  await h.advance(30_000)
  assert.equal(h.agent.followed.length, 1)
  assert.equal(h.agent.injected.length, 1, 'injected into the running turn instead of waking it')
})

test('helper agents cannot create watches, and a command that cannot run is refused', async t => {
  const h = await harness(t)
  const helper = new FakeAgent('sub-1', h.home, 'subagent')
  await assert.rejects(h.call('watch_create', { kind: 'command', command: 'x' }, helper), /top-level session/)
  h.out.set('nope', { throws: 'sandbox mode "read-only" is requested but no sandbox backend is usable' })
  await assert.rejects(h.call('watch_create', { kind: 'command', command: 'nope' }), /first check could not run.*no sandbox backend/)
  assert.match(await h.call('watch_list', {}), /no watches/)
})

test('archiving the session removes its watches; a sweep catches an archive without the stop event', async t => {
  const h = await harness(t)
  await h.call('watch_create', { kind: 'command', command: 'a', interval_seconds: 5 })
  await h.emit('workspace/session-stop', { sessionId: 'session-1' })
  assert.match(await h.call('watch_list', {}), /no watches/)
  await h.call('watch_create', { kind: 'command', command: 'b', interval_seconds: 600 })
  h.archived.push('session-1')
  await h.advance(31_000)
  assert.match(await h.call('watch_list', {}), /no watches/)
  const before = h.ran.length
  await h.advance(600_000)
  assert.equal(h.ran.length, before, 'no more checks')
})

test('watches are saved and resume after a restart, and expire at the end of their lifetime', async t => {
  const outputs = new Map([['s', { exitCode: 0, stdout: 'one' }]])
  const first = await harness(t, { outputs })
  const id = idOf(await first.call('watch_create', { kind: 'command', command: 's', interval_seconds: 5, lifetime_minutes: 10 }))
  await first.dispose()
  const saved = JSON.parse(await readFile(watchesFile(first.home), 'utf8'))
  assert.equal(saved.watches[id].spec.command, 's')
  t.mock.timers.reset()

  const second = await harness(t, { home: first.home, outputs })
  assert.match(await second.call('watch_list', {}), new RegExp(id))
  outputs.set('s', { exitCode: 0, stdout: 'two' })
  await second.advance(5_000)
  assert.equal(second.agent.followed.length, 1, 'the resumed watch compares against the saved baseline')
  await second.advance(10 * 60_000)
  assert.match(await second.call('watch_list', {}), /no watches/)
})

test('the header list: list, add, remove and remove all, telling the agent what the user did', async t => {
  const h = await harness(t)
  await h.call('watch_create', { kind: 'command', command: 'a', label: 'first' })
  const { actions } = h.plugin
  const added = await actions.create({ sessionId: 'session-1', spec: { kind: 'command', command: 'b', interval_seconds: 10 } })
  assert.equal(added.createdBy, 'user')
  assert.match(h.agent.injected.at(-1).content[0].text, /The user added a watch/)
  const listed = await actions.list({ sessionId: 'session-1' })
  assert.deepEqual(listed.map(w => w.label), ['first', 'b'])
  await actions.remove({ sessionId: 'session-1', id: listed[0].id })
  assert.match(h.agent.injected.at(-1).content[0].text, /The user removed watch .* "first"/)
  assert.equal((await actions.list({ sessionId: 'session-1' })).length, 1)
  await actions.removeAll({ sessionId: 'session-1' })
  assert.equal((await actions.list({ sessionId: 'session-1' })).length, 0)
  await assert.rejects(actions.remove({ sessionId: 'session-1', id: 'watch-missing' }), /not a watch of this session/)
  assert.equal(h.agent.followed.length, 0, 'the user\'s changes never wake the agent')
})

test('a session may hold ten watches at most', async t => {
  const h = await harness(t)
  for (let i = 0; i < 10; i++) await h.call('watch_create', { kind: 'command', command: `c${i}`, interval_seconds: 600 })
  await assert.rejects(h.call('watch_create', { kind: 'command', command: 'c10' }), /already has 10 watches/)
  assert.match(await h.call('watch_remove', { all: true }), /Removed watch-/)
})

test('a files watch reports changes made while the agent is idle, not those of its own turn', async t => {
  const h = await harness(t)
  const { mkdir, writeFile } = await import('node:fs/promises')
  /** Let real file events arrive (the clock is mocked, so wait on real time). */
  const events = async () => { const end = performance.now() + 400; while (performance.now() < end) await new Promise(resolve => setImmediate(resolve)) }
  await mkdir(path.join(h.home, 'src'))
  await h.call('watch_create', { kind: 'files', paths: ['src'], label: 'sources' })
  await events()
  // The agent's own edit during its turn.
  h.agent.status = 'running'
  await writeFile(path.join(h.home, 'src', 'mine.js'), 'x')
  await events()
  await h.advance(3_000)
  await h.endTurn()
  await h.advance(3_000)
  assert.equal(h.agent.followed.length + h.agent.injected.length, 0)
  // Someone else's edit afterwards.
  await writeFile(path.join(h.home, 'src', 'theirs.js'), 'y')
  await events()
  await h.advance(3_000)
  assert.equal(h.agent.followed.length, 1)
  const text = h.agent.followed[0].content[0].text
  assert.match(text, /theirs\.js/)
  assert.doesNotMatch(text, /mine\.js/)
})

test('a files watch is kept inside the session folder and away from paths the sandbox keeps from being read', async t => {
  const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hs-watch-outside-')))
  t.after(() => rm(outside, { recursive: true, force: true }))
  const { mkdir } = await import('node:fs/promises')
  const readDeny = [outside]
  const h = await harness(t, { readDeny })
  readDeny.push(path.join(h.home, 'secrets'))
  await mkdir(path.join(h.home, 'src'))
  await mkdir(path.join(h.home, 'secrets'))
  await assert.rejects(h.call('watch_create', { kind: 'files', paths: [outside] }), /outside this session's folder/)
  await assert.rejects(h.call('watch_create', { kind: 'files', paths: ['../'] }), /outside this session's folder/)
  await assert.rejects(h.call('watch_create', { kind: 'files', paths: [path.join(h.home, 'secrets')] }), /keeps from being read/)
  assert.match(await h.call('watch_create', { kind: 'files', paths: ['src'] }), /Created watch/)
  const saved = JSON.parse(await readFile(watchesFile(h.home), 'utf8'))
  assert.equal(Object.values(saved.watches)[0].spec.root, h.home)
})

test('watches.json is readable only by this user', { skip: process.platform === 'win32' }, async t => {
  const { stat } = await import('node:fs/promises')
  const h = await harness(t)
  await h.call('watch_create', { kind: 'command', command: 'secret-ish', interval_seconds: 600 })
  assert.equal((await stat(watchesFile(h.home))).mode & 0o777, 0o600)
  assert.equal((await stat(path.dirname(watchesFile(h.home)))).mode & 0o777, 0o700)
  const { readdir } = await import('node:fs/promises')
  assert.deepEqual(await readdir(path.dirname(watchesFile(h.home))), ['watches.json'])
})

test('saved watches from before the checks on paths and patterns stop instead of resuming unchecked', async t => {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hs-watch-old-')))
  t.after(() => rm(home, { recursive: true, force: true }))
  await mkdir(path.join(home, 'harness-studio'))
  const common = { sessionId: 'session-1', createdBy: 'agent', createdAt: 0, state: { baseline: { exitCode: 0, output: '' }, last: { exitCode: 0, output: '' }, wakes: 0, checks: 1 } }
  const spec = { interval: 600, cooldown: 60, maxWakes: 20, expiresAt: 10 ** 13, label: 'old' }
  const watches = {
    'watch-files001': { id: 'watch-files001', ...common, spec: { ...spec, kind: 'files', paths: [path.join(os.homedir(), '.ssh')], when: 'change', interval: 0 } },
    'watch-regex001': { id: 'watch-regex001', ...common, spec: { ...spec, kind: 'command', command: 'x', timeout: 30, when: 'match', pattern: '(a+)+$' } },
  }
  await writeFile(watchesFile(home), JSON.stringify({ version: 1, watches }))
  const h = await harness(t, { home })
  assert.match(await h.call('watch_list', {}), /no watches/)
  assert.deepEqual(JSON.parse(await readFile(watchesFile(home), 'utf8')).watches, {})
})
