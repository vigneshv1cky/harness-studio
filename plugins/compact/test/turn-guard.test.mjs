import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createTurnBudgetSetting, createTurnGuard } from '../turn-guard.js'

const allow = async () => ({ kind: 'allow' })
const done = async () => ({ kind: 'continue' })
const userMessage = { source: { kind: 'user' } }

function setup(budget = 60) {
  const cancelled = []
  const guard = createTurnGuard({ readBudget: async () => budget, cancel: agent => cancelled.push(agent) })
  const agent = { session: { header: {} } }
  // A user message starts a new turn unless it is sent while the agent works (`steered`), as Harness numbers turns.
  let turnNumber = 0
  let stepNumber = 0
  const step = async (messages = [], { steered = false } = {}) => {
    if (!steered && messages.some(message => message.source?.kind === 'user')) { turnNumber++; stepNumber = 0 }
    stepNumber++
    return guard.preStep({ agent, messages, turn: turnNumber, step: stepNumber }, async () => ({ kind: 'enter', messages }))
  }
  let n = 0
  /** One tool call in the current step; `approve` answers an approval card. */
  const call = async ({ name = 'bash', result = { output: `r${n++}` }, approve = true, on = agent } = {}) => {
    const exec = { name, agent: on, arguments: {} }
    const decision = await guard.preExecute(exec, allow)
    if (decision.kind === 'ask' && !approve) return { decision, post: await guard.postExecute(exec, { error: 'rejected' }, done) }
    await guard.execute(exec, async () => result)
    return { decision, post: await guard.postExecute(exec, result, done) }
  }
  return { guard, agent, step, call, cancelled }
}
const notesOf = post => (post.additionalContexts ?? []).map(m => m.content[0].text)

test('a turn is reminded at half the budget, pauses at it, and an allowed pause grants another budget', async () => {
  const t = setup(60)
  await t.step([userMessage])
  const seen = []
  for (let s = 1; s <= 130; s++) {
    if (s > 1) await t.step()
    const { decision, post } = await t.call()
    if (decision.kind === 'ask') seen.push(`ask@${s}`)
    for (const text of notesOf(post)) if (text.startsWith('This turn has taken')) seen.push(`remind@${s}`)
  }
  assert.deepEqual(seen, ['remind@30', 'ask@60', 'remind@90', 'ask@120'])
  const { decision } = await (async () => { await t.step(); return t.call() })()
  assert.equal(decision.kind, 'allow')
})

test('the pause asks once per step, and rejecting it ends the turn', async () => {
  const t = setup(2)
  await t.step([userMessage])
  await t.call()
  await t.step()
  const first = await t.call({ approve: false })
  assert.equal(first.decision.kind, 'ask')
  assert.match(first.decision.displayReason.en, /taken 2 steps.*Reject stops it here/)
  const second = await t.call()
  assert.equal(second.decision.kind, 'allow', 'a second call in the same step is not asked again')
  await new Promise(r => setTimeout(r, 5))
  assert.deepEqual(t.cancelled, [t.agent])
})

test('a new turn starts the count again', async () => {
  const t = setup(3)
  await t.step([userMessage])
  for (let s = 0; s < 2; s++) { await t.call(); await t.step() }
  assert.equal((await t.call()).decision.kind, 'ask')
  await t.step([userMessage])
  assert.equal((await t.call()).decision.kind, 'allow')
})

test('a message sent while the agent works joins the turn and keeps its count', async () => {
  const t = setup(60)
  await t.step([userMessage])
  const seen = []
  for (let s = 1; s <= 60; s++) {
    if (s > 1) await t.step(s === 25 ? [userMessage] : [], { steered: s === 25 })
    const { decision, post } = await t.call()
    if (decision.kind === 'ask') seen.push(`ask@${s}`)
    for (const text of notesOf(post)) if (text.startsWith('This turn has taken')) seen.push(`remind@${s}`)
  }
  assert.deepEqual(seen, ['remind@30', 'ask@60'])
})

test('with the budget off, or for a subagent, nothing asks and no budget reminder is added', async () => {
  const off = setup(0)
  await off.step([userMessage])
  for (let s = 0; s < 70; s++) { await off.step(); const { decision, post } = await off.call(); assert.equal(decision.kind, 'allow'); assert.deepEqual(notesOf(post), []) }
  const t = setup(2)
  const sub = { session: { header: { origin: 'subagent' } } }
  await t.guard.preStep({ agent: sub, messages: [userMessage], turn: 1, step: 1 }, async () => ({}))
  for (let s = 0; s < 5; s++) { await t.guard.preStep({ agent: sub, messages: [], turn: 1, step: s + 2 }, async () => ({})); const { decision, post } = await t.call({ on: sub }); assert.equal(decision.kind, 'allow'); assert.deepEqual(notesOf(post), []) }
})

test('the same result from one tool three and five times in a turn is called out; waiting tools and new results are not', async () => {
  const t = setup(0)
  await t.step([userMessage])
  const same = { output: 'no such process' }
  const notes = []
  for (let i = 1; i <= 6; i++) {
    const { post } = await t.call({ name: 'bash', result: same })
    if (notesOf(post).length) notes.push(`${i}: ${notesOf(post)[0].slice(0, 46)}`)
    await t.call({ name: 'bash' })
    await t.call({ name: 'job_wait', result: same })
  }
  assert.deepEqual(notes, [
    '3: The last 3 calls to bash in this turn returned',
    '5: The last 5 calls to bash in this turn returned',
  ])
})

test('the budget setting keeps one of the offered values, written atomically', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hs-turn-budget-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'harness-studio', 'turn-budget.json')
  const setting = createTurnBudgetSetting(file, { readFile, writeFile, rename, mkdir, rm, dirname: path.dirname, randomSuffix: () => 'x' })
  assert.deepEqual(await setting.get(), { pauseAfter: 60, saved: false })
  assert.deepEqual(await setting.set({ pauseAfter: 120 }), { pauseAfter: 120, saved: true })
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { pauseAfter: 120 })
  assert.deepEqual(await setting.set({ pauseAfter: 0 }), { pauseAfter: 0, saved: true })
  await assert.rejects(setting.set({ pauseAfter: 7 }), /one of 60, 120, 200, 0/)
  await writeFile(file, '{"pauseAfter": 999}')
  assert.equal((await setting.get()).pauseAfter, 60)
})
