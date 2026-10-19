import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { apply, targetOf } from '../index.js'
import { MAX_FILE_BYTES, createStore } from '../store.js'

let base, home, work

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'undo-'))
  home = path.join(base, 'home')
  work = path.join(base, 'work')
  await mkdir(work, { recursive: true })
})
afterEach(async () => { await rm(base, { recursive: true, force: true }) })

const read = file => readFile(path.join(work, file), 'utf8')
const exists = file => stat(path.join(work, file)).then(() => true, () => false)

test('the file tools that change files are recognised, and nothing else', () => {
  assert.equal(targetOf('write', { file_path: 'a.txt' }), 'a.txt')
  assert.equal(targetOf('edit', { file_path: '/x/b.js' }), '/x/b.js')
  assert.equal(targetOf('str_replace_editor', { command: 'insert', path: 'c' }), 'c')
  assert.equal(targetOf('str_replace_editor', { command: 'view', path: 'c' }), undefined)
  assert.equal(targetOf('read', { file_path: 'a' }), undefined)
  assert.equal(targetOf('bash', { command: 'rm a' }), undefined)
})

test('only the first change in a turn is kept, and undo goes back to before the earliest turn', async () => {
  const store = createStore(path.join(home, 'undo'))
  const a = path.join(work, 'a.txt')
  await writeFile(a, 'v1')
  assert.equal(await store.capture('s1', 1, a), 'taken')
  await writeFile(a, 'v2')
  assert.equal(await store.capture('s1', 1, a), 'already')
  await writeFile(a, 'v3')
  assert.equal(await store.capture('s1', 2, a), 'taken')
  const b = path.join(work, 'new.txt')
  assert.equal(await store.capture('s1', 2, b), 'taken')
  await writeFile(b, 'created')
  await writeFile(a, 'v4')

  assert.deepEqual((await store.list('s1')).map(t => [t.turn, t.files.map(f => [path.basename(f.path), f.existed])]),
    [[1, [['a.txt', true]]], [2, [['a.txt', true], ['new.txt', false]]]])

  const fromTwo = await store.restore('s1', 2)
  assert.deepEqual(fromTwo, { restored: [a], removed: [b], failed: [] })
  assert.equal(await read('a.txt'), 'v3')
  assert.equal(await exists('new.txt'), false)
  assert.deepEqual((await store.list('s1')).map(t => t.turn), [1])

  await store.restore('s1', 1)
  assert.equal(await read('a.txt'), 'v1')
  assert.deepEqual(await store.list('s1'), [])
})

test('large files and folders are noted but not kept, and say why on undo', async () => {
  const store = createStore(path.join(home, 'undo'))
  const big = path.join(work, 'big.bin')
  await writeFile(big, Buffer.alloc(MAX_FILE_BYTES + 1))
  await store.capture('s1', 1, big)
  const [turn] = await store.list('s1')
  assert.deepEqual(turn.files.map(f => f.restorable), [false])
  const result = await store.restore('s1', 1)
  assert.match(result.failed[0].reason, /larger than 10 MB/)
  await assert.rejects(store.list('../escape'), /invalid session id/)
  assert.throws(() => store.restore('a/b', 1), /invalid session id/)
})

test('the plugin keeps a copy before an allowed file change, and undo tells the agent', async () => {
  const listeners = {}
  const injected = []
  const session = { id: 's9', header: { cwd: work } }
  const agent = { session, inject: m => injected.push(m) }
  const { actions } = apply({
    get: name => ({ profileContext: { home }, agents: { get: id => (id === 's9' ? agent : undefined) } })[name],
    logger: { warn: () => {} },
    on: (event, fn) => { listeners[event] = fn },
  })
  await writeFile(path.join(work, 'notes.md'), 'before')
  await listeners['agent/pre-step']({ agent, turn: 3 }, async () => ({ kind: 'enter' }))
  const exec = { name: 'edit', arguments: { file_path: 'notes.md' }, agent, signal: new AbortController().signal }
  assert.equal(listeners['tools/pre-execute'], undefined, 'a refused call never reaches the copy step')
  await listeners['tools/execute'](exec, async () => {
    await writeFile(path.join(work, 'notes.md'), 'after')
    return { content: [] }
  })

  const [turn] = await actions.list({ sessionId: 's9' })
  assert.equal(turn.turn, 3)
  const result = await actions.restore({ sessionId: 's9', turn: 3 })
  assert.deepEqual(result.restored, [path.join(work, 'notes.md')])
  assert.equal(await read('notes.md'), 'before')
  assert.equal(injected.length, 1)
  assert.match(injected[0].content[0].text, /undid file changes from turn 3 onward[\s\S]*notes\.md \(restored\)/)
  await assert.rejects(actions.restore({ sessionId: 's9', turn: 'x' }), /whole number/)
})

test('a helper agent\'s edits count towards the main conversation\'s turn, and restore replaces a planted link', async () => {
  const listeners = {}
  const root = { id: 'root1', header: { cwd: work } }
  const rootAgent = { session: root, inject: () => {} }
  const child = { session: { id: 'child1', header: { cwd: work, origin: 'subagent', parentSession: 'root1' } } }
  const { actions } = apply({
    get: name => ({ profileContext: { home }, agents: { get: id => (id === 'root1' ? rootAgent : id === 'child1' ? child : undefined) } })[name],
    logger: { warn: () => {} },
    on: (event, fn) => { listeners[event] = fn },
  })
  await writeFile(path.join(work, 'shared.md'), 'original')
  await writeFile(path.join(work, 'outside.txt'), 'must not change')
  await listeners['agent/pre-step']({ agent: rootAgent, turn: 5 }, async () => ({ kind: 'enter' }))
  const exec = { name: 'write', arguments: { file_path: 'shared.md', content: 'x' }, agent: child, signal: new AbortController().signal }
  await listeners['tools/execute'](exec, async () => { await writeFile(path.join(work, 'shared.md'), 'by helper'); return { content: [] } })
  const [turn] = await actions.list({ sessionId: 'root1' })
  assert.equal(turn.turn, 5)
  // The file is swapped for a link to another file before Undo.
  await rm(path.join(work, 'shared.md'))
  await symlink(path.join(work, 'outside.txt'), path.join(work, 'shared.md'))
  await actions.restore({ sessionId: 'root1', turn: 5 })
  assert.equal(await read('shared.md'), 'original')
  assert.equal(await read('outside.txt'), 'must not change')
  assert.equal((await lstat(path.join(work, 'shared.md'))).isSymbolicLink(), false)
})
