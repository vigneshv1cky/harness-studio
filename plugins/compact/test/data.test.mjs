import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { appDataFolder, createDataInventory } from '../data.js'

let base, home

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'data-'))
  home = path.join(base, 'home')
  const put = async (rel, text) => { await mkdir(path.dirname(path.join(home, rel)), { recursive: true }); await writeFile(path.join(home, rel), text) }
  await put('sessions/ws/session-1/log.jsonl', 'x'.repeat(1000))
  await put('memory/proj/MEMORY.md', 'note')
  await put('harness-studio/undo/s1/copy', 'y'.repeat(50))
  await put('harness-studio/connectors.json', '{"token":"secret"}')
  await put('harness-studio/watches.json', '[]')
  await put('.credentials.yaml', 'key: secret')
  await put('settings.yaml', 'a: 1')
  await put('storages/workspace.json', '{}')
})

afterEach(async () => { await rm(base, { recursive: true, force: true }) })

const inventory = (over = {}) => createDataInventory({ home, appData: path.join(base, 'appdata'), ...over })

test('each location is listed with its size, and missing ones as not present', async () => {
  const rows = await inventory().list()
  const by = Object.fromEntries(rows.map(r => [r.id, r]))
  assert.equal(by.sessions.bytes, 1000)
  assert.equal(by.sessions.files, 1)
  assert.equal(by.undo.bytes, 50)
  assert.equal(by.credentials.present, true)
  assert.equal(by.credentials.bytes, 'key: secret'.length)
  assert.equal(by.worktrees.present, false)
  assert.equal(by.appdata.present, false)
  assert.equal(by.studio.bytes, '{"token":"secret"}'.length + 2, 'single files are summed')
})

test('revealing a folder opens it with the platform\'s file manager', async () => {
  const calls = []
  const data = inventory({ platform: 'linux', run: async (file, args) => { calls.push([file, ...args]) } })
  await data.reveal({ id: 'memory' })
  assert.deepEqual(calls, [['xdg-open', path.join(home, 'memory')]])
  await assert.rejects(data.reveal({ id: 'worktrees' }), /does not exist yet/)
})

test('the window data folder follows each platform\'s convention', () => {
  assert.equal(appDataFolder('darwin', '/Users/me'), '/Users/me/Library/Application Support/Harness Studio')
  assert.equal(appDataFolder('linux', '/home/me', {}), '/home/me/.config/Harness Studio')
  assert.equal(appDataFolder('linux', '/home/me', { XDG_CONFIG_HOME: '/cfg' }), '/cfg/Harness Studio')
})
