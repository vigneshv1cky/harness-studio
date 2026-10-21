// The Host half against a fake Harness: the services it calls are stand-ins that record what happened.
// Covers starting (both initiations), reports and the wake budget, orphaned parents, archive clean-up,
// stop_session, restart reconciliation and disposal. The real Harness services are exercised by the
// manual run described in the README.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import test from 'node:test'
import { apply } from '../index.js'

class FakeAgent {
  constructor(id, cwd) {
    this.id = id
    this.status = 'idle'
    this.cwd = cwd
    this.session = { id, header: { cwd }, title: undefined }
    this.followed = []
    this.injected = []
    this.cancelled = []
  }
  followup(message) { this.followed.push(message); this.status = 'running' }
  inject(message) { this.injected.push(message) }
  cancel(cause) { this.cancelled.push(cause); this.status = 'idle' }
}

async function harness(t, { answer, home: givenHome, listed } = {}) {
  const home = givenHome ?? await realpath(await mkdtemp(path.join(os.tmpdir(), 'hs-sessions-host-')))
  if (!givenHome) t.after(() => rm(home, { recursive: true, force: true }))
  const listeners = new Map()
  const disposers = []
  const tools = new Map()
  const agents = new Map()
  const archived = []
  const questionsAsked = []
  let next = 0
  const presets = new Map()
  /** Background jobs by id: { id, owner, status }. */
  const jobs = new Map()
  /** System prompt sections by name. */
  const prompts = new Map()
  const ctx = {
    get: name => ({
      profileContext: { home },
      permissionPresets: { current: s => presets.get(s.id) ?? 'ask', set: (s, n) => presets.set(s.id, n) },
      userQuestions: { ask: async request => { questionsAsked.push(request); return answer(request) } },
      jobs: {
        list: owner => [...jobs.values()].filter(j => j.owner === owner),
        kill: (id, owner, reason) => { const j = jobs.get(id); assert.equal(j.owner, owner); j.status = 'killed'; j.reason = reason; return 'requested' },
      },
    })[name],
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    on: (name, fn) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn) },
    tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
    systemPrompt: { context: section => { prompts.set(section.name, section) } },
    agents: { get: id => agents.get(id), withoutInitiator: fn => fn() },
    sessions: { flush: async () => true },
    sessionController: {
      create: async ({ workspaceId }) => {
        const id = `session-${++next}`
        agents.set(id, new FakeAgent(id, workspaceId.slice(3)))
        return { sessionId: id }
      },
      resolveAgent: async id => (agents.has(id) ? { agent: agents.get(id) } : { error: new Error(`session "${id}" not found`) }),
      list: async () => ({ items: (listed ?? [...agents.keys()]).map(sessionId => ({ sessionId })) }),
    },
    sessionTitle: { rename: (s, title) => { s.title = title }, get: s => ({ title: s.title }) },
    workspaceRegistry: {
      create: async p => ({ id: `ws:${p}` }),
      archivedSessionIds: archived,
      archiveSession: async id => { archived.push(id) },
    },
    workingDirectory: { ensure: async a => a.cwd, set: async (a, p) => { a.cwd = p } },
  }
  const plugin = apply(ctx, {})
  const emit = async (name, ...args) => { for (const fn of listeners.get(name) ?? []) await fn(...args) }
  const parent = new FakeAgent('parent-1', home)
  parent.session.title = 'Main'
  agents.set(parent.id, parent)
  const call = (name, args, agent = parent) => tools.get(name).execute(args, { agent, signal: new AbortController().signal })
  /** Play one finished turn of a Session: the triggering message, an answer, the end. */
  const turn = async (agent, { text = 'done', source = 'harness-studio-brief', reason = { kind: 'completed' }, n = 1 } = {}) => {
    await emit('session/event', agent.session, { type: 'user/message', data: { source: { kind: source } } })
    await emit('session/event', agent.session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } })
    agent.status = 'idle'
    await emit('session/event', agent.session, { type: 'turn/end', data: { turn: n, reason } })
    await sleep(20)
  }
  const dispose = async () => { for (const d of disposers.reverse()) await d() }
  t.after(dispose)
  return { home, ctx, agents, archived, presets, jobs, prompts, questionsAsked, parent, call, emit, turn, dispose, actions: plugin.actions }
}

const recordFile = home => path.join(home, 'harness-studio', 'sessions.json')
const childOf = (h, result) => h.agents.get(/\((session-\d+)\)/.exec(result)[1])

test('user_asked start creates a titled Session with the parent preset and sends the brief', async t => {
  const h = await harness(t)
  h.presets.set(h.parent.id, 'read-only')
  const result = await h.call('start_session', { title: 'Write docs', prompt: 'Document the API.', background: 'Use English.', initiation: 'user_asked' })
  const child = childOf(h, result)
  assert.equal(child.session.title, 'Write docs')
  assert.equal(h.presets.get(child.id), 'read-only')
  assert.equal(child.followed.length, 1)
  const brief = child.followed[0]
  assert.equal(brief.source.kind, 'harness-studio-brief')
  assert.equal(brief.source.senderSessionId, h.parent.id)
  assert.match(brief.content[0].text, /Use English\.[\s\S]*Document the API\./)
  assert.equal(h.questionsAsked.length, 0, 'no card for a user request')
  const saved = JSON.parse(await readFile(recordFile(h.home), 'utf8'))
  assert.equal(saved.children[child.id].parentId, h.parent.id)
})

test('the sidebar\'s parent links list each started Session under its parent, oldest first', async t => {
  const h = await harness(t)
  const first = childOf(h, await h.call('start_session', { title: 'One', prompt: 'a', background: 'b', initiation: 'user_asked' }))
  const second = childOf(h, await h.call('start_session', { title: 'Two', prompt: 'a', background: 'b', initiation: 'user_asked' }))
  assert.deepEqual(await h.actions.parentLinks(), [
    { id: first.id, parentId: h.parent.id },
    { id: second.id, parentId: h.parent.id },
  ])
})

test('offer: the card question carries the short context; "Do it here" creates nothing; "New session" starts it', async t => {
  let choice = 'Do it here'
  const h = await harness(t, { answer: () => ({ answers: [{ id: 'harness-studio/start-session', selected: [choice] }] }) })
  const declined = await h.call('start_session', { title: 'Refactor', prompt: 'p', initiation: 'offer' })
  assert.match(declined, /chose to do this here/)
  assert.equal(h.agents.size, 1, 'only the parent exists')
  const question = h.questionsAsked[0].questions[0]
  assert.equal(question.id, 'harness-studio/start-session')
  assert.equal(question.header, 'New session')
  assert.equal(question.question, 'Refactor')
  assert.equal(question.options.map(o => o.label).join('|'), 'New session|Do it here')
  assert.ok(!question.detail.split('\n\n')[0].includes(h.home), 'the context line never shows a temporary folder in full')
  choice = 'New session'
  const started = await h.call('start_session', { title: 'Refactor', prompt: 'p', initiation: 'proposal' })
  assert.match(started, /Started session "Refactor"/)
})

test('offer: the worktree switch in the card\'s Options is honoured', async t => {
  const h = await harness(t, { answer: () => ({ answers: [{ id: 'harness-studio/start-session', selected: ['New session'], custom: '{"worktree":true}' }] }) })
  const repo = path.join(h.home, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'first'])
  const result = await h.call('start_session', { title: 'Switched on', prompt: 'p', folder: repo, initiation: 'offer' })
  assert.match(result, /branch harness\/switched-on/)
  assert.equal(execFileSync('git', ['-C', childOf(h, result).cwd, 'branch', '--show-current'], { encoding: 'utf8' }).trim(), 'harness/switched-on')
})

test('a folder outside the parent\'s folder needs the user\'s yes on a card naming it, even for user_asked', async t => {
  let choice = 'Do not start'
  const h = await harness(t, { answer: () => ({ answers: [{ id: 'harness-studio/start-session-folder', selected: [choice] }] }) })
  const other = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hs-sessions-other-')))
  t.after(() => rm(other, { recursive: true, force: true }))
  const declined = await h.call('start_session', { title: 'Elsewhere', prompt: 'p', folder: other, initiation: 'user_asked' })
  assert.match(declined, /^Nothing was started/)
  assert.equal(h.agents.size, 1, 'only the parent exists')
  const question = h.questionsAsked[0].questions[0]
  assert.equal(question.id, 'harness-studio/start-session-folder')
  assert.ok(question.question.includes(other), 'the question names the folder in full')
  choice = 'Start in that folder'
  const started = await h.call('start_session', { title: 'Elsewhere', prompt: 'p', folder: other, initiation: 'offer' })
  assert.match(started, /Started session "Elsewhere".*approved it on the card/)
  assert.equal(h.questionsAsked.length, 2, 'one card per start, also for an offer')
  // A folder inside the parent's own folder starts without a card.
  await h.call('start_session', { title: 'Inside', prompt: 'p', folder: path.join(h.home, 'harness-studio'), initiation: 'user_asked' })
  assert.equal(h.questionsAsked.length, 2)
})

test('the home folder, the filesystem root and the Harness home are refused outright', async t => {
  const h = await harness(t, { answer: () => assert.fail('no card for a refused folder') })
  const other = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hs-sessions-other-')))
  t.after(() => rm(other, { recursive: true, force: true }))
  await assert.rejects(h.call('start_session', { title: 't', prompt: 'p', folder: os.homedir(), initiation: 'user_asked' }), /never started in/)
  await assert.rejects(h.call('start_session', { title: 't', prompt: 'p', folder: '/', initiation: 'own_initiative' }), /never started in/)
  const elsewhere = new FakeAgent('parent-2', other)
  h.agents.set(elsewhere.id, elsewhere)
  await assert.rejects(h.call('start_session', { title: 't', prompt: 'p', folder: h.home, initiation: 'user_asked' }, elsewhere), /never started in/)
  assert.equal(h.agents.size, 2, 'nothing was created')
})

test('own_initiative saves a card without asking or waiting; Start later creates the session from the saved brief', async t => {
  const h = await harness(t, { answer: () => assert.fail('a proposal asks nothing while the turn runs') })
  const result = await h.call('start_session', { title: 'Tidy logs', prompt: 'Remove the debug logging.', background: 'Found while fixing login.', initiation: 'own_initiative' })
  const id = /\((proposal-[^)]+)\)/.exec(result)[1]
  assert.match(result, /^Proposed session "Tidy logs"/)
  assert.equal(h.agents.size, 1, 'nothing was created')
  const card = await h.actions.proposal({ id })
  assert.equal(card.state, 'pending')
  assert.equal(card.title, 'Tidy logs')
  const saved = JSON.parse(await readFile(recordFile(h.home), 'utf8'))
  assert.equal(saved.proposals[id].parentId, h.parent.id, 'the proposal is kept across restarts')
  assert.deepEqual(await h.actions.sessionProposals({ sessionId: h.parent.id }), [], 'shown under its turn only once that turn ends')
  await h.emit('session/event', h.parent.session, { type: 'turn/end', data: { turn: 4, reason: { kind: 'completed' } } })
  const listed = await h.actions.sessionProposals({ sessionId: h.parent.id })
  assert.deepEqual(listed.map(p => [p.id, p.turn, p.state]), [[id, 4, 'pending']])
  // Start, a while later, from the card: the brief is the saved one and the parent hears of it without waking.
  h.parent.status = 'idle'
  const [first, second] = await Promise.allSettled([h.actions.startProposal({ id }), h.actions.startProposal({ id })])
  assert.equal(first.status, 'fulfilled')
  assert.equal(second.status, 'rejected', 'a second click does not start it twice')
  assert.equal(first.value.state, 'started')
  const child = h.agents.get(first.value.sessionId)
  assert.equal(child.session.title, 'Tidy logs')
  assert.match(child.followed[0].content[0].text, /Found while fixing login\.[\s\S]*Remove the debug logging\./)
  assert.equal(h.parent.followed.length, 0, 'the parent is not woken')
  assert.match(h.parent.injected.at(-1).content[0].text, /started your proposed session "Tidy logs"/)
  assert.deepEqual(await h.actions.parentLinks(), [{ id: child.id, parentId: h.parent.id }])
})

test('own_initiative: at most three per turn, never the same twice, and Dismiss keeps it from starting', async t => {
  const h = await harness(t, { answer: () => assert.fail('no card questions') })
  const propose = title => h.call('start_session', { title, prompt: `Do ${title}.`, initiation: 'own_initiative' })
  const ids = []
  for (const title of ['One', 'Two', 'Three']) ids.push(/\((proposal-[^)]+)\)/.exec(await propose(title))[1])
  await assert.rejects(propose('Four'), /already proposed 3 sessions in this turn/)
  await h.emit('session/event', h.parent.session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  await assert.rejects(propose('one'), /already proposed from this session/)
  await propose('Four')
  assert.equal((await h.actions.dismissProposal({ id: ids[0] })).state, 'dismissed')
  await assert.rejects(h.actions.startProposal({ id: ids[0] }), /already dismissed/)
  await assert.rejects(h.actions.proposal({ id: 'proposal-gone' }), /no longer kept/)
  h.archived.push(h.parent.id)
  await assert.rejects(h.actions.startProposal({ id: ids[1] }), /was archived/)
  assert.equal((await h.actions.proposal({ id: ids[1] })).state, 'pending', 'a refused start leaves it startable')
  assert.equal(h.agents.size, 1, 'nothing was created')
})

test('a subagent cannot start sessions', async t => {
  const h = await harness(t)
  const sub = new FakeAgent('sub-1', h.home)
  sub.session.header.origin = 'subagent'
  await assert.rejects(h.call('start_session', { title: 't', prompt: 'p', initiation: 'user_asked' }, sub), /Only a top-level session/)
})

test('top-level sessions get the separate-session and helper-agent guidance; helpers get neither', async t => {
  const h = await harness(t)
  const sub = new FakeAgent('sub-1', h.home)
  sub.session.header.origin = 'subagent'
  const helpers = h.prompts.get('helper-agents').text({ agent: h.parent })
  assert.match(helpers, /subagent tool/)
  assert.match(helpers, /one quick lookup/)
  assert.match(helpers, /subagent_fork copies this whole conversation/)
  assert.match(h.prompts.get('side-sessions').text({ agent: h.parent }), /start_session/)
  for (const name of ['helper-agents', 'side-sessions']) assert.equal(h.prompts.get(name).text({ agent: sub }), '')
})

test('a finished turn wakes the idle parent with a fenced report; a busy parent gets it at its next step', async t => {
  const h = await harness(t)
  const child = childOf(h, await h.call('start_session', { title: 'Tests', prompt: 'p', initiation: 'user_asked' }))
  await h.turn(child, { text: 'All 12 tests pass.' })
  assert.equal(h.parent.followed.length, 1)
  const report = h.parent.followed[0]
  assert.equal(report.source.kind, 'harness-studio-report')
  assert.equal(report.source.form, 'notice')
  assert.match(report.content[0].text, /All 12 tests pass\./)
  h.parent.status = 'running'
  await h.turn(child, { text: 'Second.', n: 2 })
  assert.equal(h.parent.injected.length, 1)
  await h.turn(child, { text: 'Again.', n: 2 })
  assert.equal(h.parent.injected.length, 1, 'a turn is reported once')
})

test('a turn the user drove in the child does not wake the parent; the wake budget stops ping-pong', async t => {
  const h = await harness(t)
  const child = childOf(h, await h.call('start_session', { title: 'Loop', prompt: 'p', initiation: 'user_asked' }))
  await h.turn(child, { source: 'user', n: 1 })
  assert.equal(h.parent.followed.length, 0)
  assert.equal(h.parent.injected.length, 1)
  for (let n = 2; n <= 8; n++) { h.parent.status = 'idle'; await h.turn(child, { n }) }
  assert.equal(h.parent.followed.length, 5, 'woken at most maxConsecutiveWakes times')
  // The user speaking in the parent resets the budget.
  await h.emit('session/event', h.parent.session, { type: 'user/message', data: { source: { kind: 'user' } } })
  await sleep(20)
  h.parent.status = 'idle'
  await h.turn(child, { n: 9 })
  assert.equal(h.parent.followed.length, 6)
})

test('a child that finishes after its parent is gone records the turn without crashing', async t => {
  const h = await harness(t)
  const child = childOf(h, await h.call('start_session', { title: 'Orphan', prompt: 'p', initiation: 'user_asked' }))
  h.agents.delete(h.parent.id)
  await h.turn(child, { text: 'finished late' })
  const saved = JSON.parse(await readFile(recordFile(h.home), 'utf8'))
  assert.equal(saved.children[child.id].orphaned, true)
  assert.equal(saved.children[child.id].lastReportedTurn, 1)
})

test('archiving the parent cancels its children\'s running turns through Harness cancellation', async t => {
  const h = await harness(t)
  const child = childOf(h, await h.call('start_session', { title: 'Long', prompt: 'p', initiation: 'user_asked' }))
  assert.equal(child.status, 'running')
  h.jobs.set('job-bg', { id: 'job-bg', owner: child.id, status: 'running' })
  await h.emit('workspace/session-stop', { sessionId: h.parent.id })
  assert.deepEqual(child.cancelled, [{ kind: 'parent' }])
  assert.equal(h.jobs.get('job-bg').status, 'killed', 'the child\'s background job is killed too')
  await h.turn(child, { reason: { kind: 'aborted', reason: { kind: 'parent' } } })
  assert.equal(h.parent.followed.length + h.parent.injected.length, 0, 'no report to a parent that is gone')
})

test('a parent archived while idle ends the child\'s turn at its next step', async t => {
  const h = await harness(t)
  const child = childOf(h, await h.call('start_session', { title: 'Step', prompt: 'p', initiation: 'user_asked' }))
  h.archived.push(h.parent.id)
  await h.emit('session/event', child.session, { type: 'step/start', data: { turn: 1, step: 2 } })
  await sleep(20)
  assert.deepEqual(child.cancelled, [{ kind: 'parent' }])
})

test('archiving a child releases its turn state and closes its record', async t => {
  const h = await harness(t)
  const child = childOf(h, await h.call('start_session', { title: 'Close', prompt: 'p', initiation: 'user_asked' }))
  await h.emit('session/event', child.session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'half' }] } } })
  await h.emit('workspace/session-stop', { sessionId: child.id })
  await h.emit('session/event', child.session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } })
  await sleep(20)
  assert.equal(h.parent.followed.length + h.parent.injected.length, 0)
  const saved = JSON.parse(await readFile(recordFile(h.home), 'utf8'))
  assert.equal(saved.children[child.id].closed, true)
  await assert.rejects(h.call('message_session', { session_id: child.id, message: 'more' }), /archived/)
})

test('stop_session ends a running child turn; only the parent\'s own children are reachable', async t => {
  const h = await harness(t)
  const child = childOf(h, await h.call('start_session', { title: 'Stop me', prompt: 'p', initiation: 'user_asked' }))
  h.jobs.set('job-1', { id: 'job-1', owner: child.id, status: 'running' })
  h.jobs.set('job-2', { id: 'job-2', owner: child.id, status: 'completed' })
  assert.match(await h.call('stop_session', { session_id: child.id }), /its running turn \(queued messages dropped\) and 1 background job/)
  assert.deepEqual(child.cancelled, [{ kind: 'parent' }])
  assert.equal(h.jobs.get('job-1').status, 'killed')
  assert.equal(h.jobs.get('job-2').status, 'completed', 'finished jobs are left alone')
  assert.match(await h.call('stop_session', { session_id: child.id }), /not running a turn or background jobs/)
  const stranger = new FakeAgent('other-1', h.home)
  h.agents.set(stranger.id, stranger)
  await assert.rejects(h.call('stop_session', { session_id: child.id }, stranger), /not a session this session started/)
})

test('restart reconciliation drops records of vanished Sessions and marks missing worktrees, deleting nothing', async t => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hs-sessions-rec-')))
  t.after(() => rm(home, { recursive: true, force: true }))
  const keptWorktree = path.join(home, 'wt-present')
  execFileSync('mkdir', ['-p', keptWorktree])
  await writeFile(path.join(keptWorktree, 'work.txt'), 'user work\n')
  execFileSync('mkdir', ['-p', path.join(home, 'harness-studio')])
  await writeFile(recordFile(home), JSON.stringify({
    version: 1,
    wakeStreak: { 'parent-1': 3 },
    children: {
      'session-a': { id: 'session-a', parentId: 'parent-1', title: 'A', folder: home, depth: 1, createdAt: 'x', worktreePath: keptWorktree, branch: 'h/a', repoRoot: home },
      'session-b': { id: 'session-b', parentId: 'parent-1', title: 'B', folder: home, depth: 1, createdAt: 'x', worktreePath: path.join(home, 'wt-gone'), branch: 'h/b', repoRoot: home },
      'session-gone': { id: 'session-gone', parentId: 'parent-1', title: 'G', folder: home, depth: 1, createdAt: 'x' },
    },
  }))
  const h = await harness(t, { home, listed: ['parent-1', 'session-a', 'session-b'] })
  await h.call('list_sessions', {})
  const once = JSON.parse(await readFile(recordFile(home), 'utf8'))
  assert.deepEqual(Object.keys(once.children).sort(), ['session-a', 'session-b'])
  assert.equal(once.children['session-a'].worktreeMissing, undefined)
  assert.equal(once.children['session-b'].worktreeMissing, true)
  assert.equal(await readFile(path.join(keptWorktree, 'work.txt'), 'utf8'), 'user work\n', 'worktree content untouched')
  await h.dispose()
  // A second start finds nothing more to change.
  const again = await harness(t, { home, listed: ['parent-1', 'session-a', 'session-b'] })
  await again.call('list_sessions', {})
  assert.deepEqual(JSON.parse(await readFile(recordFile(home), 'utf8')), once)
})

test('after disposal no listener acts and no report is delivered', async t => {
  const h = await harness(t)
  const child = childOf(h, await h.call('start_session', { title: 'Late', prompt: 'p', initiation: 'user_asked' }))
  await h.dispose()
  await h.turn(child)
  assert.equal(h.parent.followed.length + h.parent.injected.length, 0)
})

test('worktree start moves only the working directory; a failed start archives the Session and discards the fresh worktree', async t => {
  const h = await harness(t)
  const repo = path.join(h.home, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'first'])
  const result = await h.call('start_session', { title: 'Parallel fix', prompt: 'p', folder: repo, worktree: true, initiation: 'user_asked' })
  const child = childOf(h, result)
  assert.equal(child.session.header.cwd, repo, 'the stored folder stays the repository')
  assert.ok(child.cwd.startsWith(path.join(h.home, 'harness-studio', 'worktrees') + path.sep), child.cwd)
  assert.equal(execFileSync('git', ['-C', child.cwd, 'branch', '--show-current'], { encoding: 'utf8' }).trim(), 'harness/parallel-fix')
  assert.equal(execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }), '', 'main checkout untouched')

  h.ctx.sessionTitle.rename = () => { throw new Error('title service failed') }
  await assert.rejects(h.call('start_session', { title: 'Broken', prompt: 'p', folder: repo, worktree: true, initiation: 'user_asked' }), /title service failed/)
  const failedId = `session-${h.agents.size - 1}` // the parent is not a numbered Session
  assert.ok(h.archived.includes(failedId), 'the blank Session is archived')
  assert.equal(execFileSync('git', ['-C', repo, 'branch', '--list', 'harness/broken'], { encoding: 'utf8' }), '', 'the fresh branch is gone')
})

test('an idle parent archived without stopping work stops its children right after the archive', async t => {
  const h = await harness(t)
  const child = childOf(h, await h.call('start_session', { title: 'Idle archive', prompt: 'p', initiation: 'user_asked' }))
  h.jobs.set('job-sleep', { id: 'job-sleep', owner: child.id, status: 'running' })
  // Harness asks for the parent's activity, then writes the archive.
  const ctxOn = []
  await h.emit('workspace/session-activity', { sessionId: h.parent.id }, async () => ctxOn)
  h.archived.push(h.parent.id)
  const orphaned = async () => JSON.parse(await readFile(recordFile(h.home), 'utf8')).children[child.id].orphaned === true
  for (let i = 0; i < 100 && !(await orphaned()); i++) await sleep(50)
  assert.deepEqual(child.cancelled, [{ kind: 'parent' }])
  assert.equal(h.jobs.get('job-sleep').status, 'killed')
  assert.equal(await orphaned(), true)
})

test('an archive that was refused stops nothing', async t => {
  const h = await harness(t)
  const child = childOf(h, await h.call('start_session', { title: 'Still wanted', prompt: 'p', initiation: 'user_asked' }))
  await h.emit('workspace/session-activity', { sessionId: h.parent.id }, async () => [{ kind: 'turn', items: [] }])
  await sleep(1700)
  assert.deepEqual(child.cancelled, [])
})

test('a fresh New Session can move into a new worktree before its first message; others cannot', async t => {
  const h = await harness(t)
  const repo = path.join(h.home, 'project')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  await writeFile(path.join(repo, 'a.txt'), 'a\n')
  execFileSync('git', ['-C', repo, 'add', '.'])
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first'])
  const fresh = new FakeAgent('fresh-1', repo)
  fresh.session.messageProjections = []
  h.agents.set(fresh.id, fresh)
  assert.deepEqual(await h.actions.worktreeOption({ sessionId: fresh.id }), { available: true, repo: 'project' })
  const made = await h.actions.startInWorktree({ sessionId: fresh.id, title: 'Fix the login page so remembered emails work again' })
  assert.equal(made.branch, 'harness/fix-the-login-page-so', 'named after the first five words')
  assert.equal(fresh.cwd, made.path, 'the session now works in the worktree')
  assert.match(execFileSync('git', ['-C', repo, 'worktree', 'list']).toString(), /fix-the-login-page/)
  const started = new FakeAgent('started-1', repo)
  started.session.messageProjections = [{}]
  h.agents.set(started.id, started)
  await assert.rejects(h.actions.startInWorktree({ sessionId: started.id, title: 'x' }), /already started/)
  assert.equal(started.cwd, repo)
  const plain = new FakeAgent('plain-1', h.home)
  plain.session.messageProjections = []
  h.agents.set(plain.id, plain)
  assert.equal((await h.actions.worktreeOption({ sessionId: plain.id })).available, false)
  execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', made.path])
})
