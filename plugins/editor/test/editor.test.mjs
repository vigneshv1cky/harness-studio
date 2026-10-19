import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { MAX_BYTES, createEditorFiles } from '../index.js'

let base, work, files

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'editor-'))
  work = path.join(base, 'work')
  await mkdir(path.join(work, 'src'), { recursive: true })
  files = createEditorFiles(() => [work])
})
afterEach(async () => { await rm(base, { recursive: true, force: true }) })

test('opens a workspace file with its version, and saves when nothing changed on disk', async () => {
  const file = path.join(work, 'src', 'app.js')
  await writeFile(file, 'const a = 1\n', { mode: 0o640 })
  const opened = await files.open({ path: file })
  assert.equal(opened.content, 'const a = 1\n')
  assert.match(opened.version.hash, /^[0-9a-f]{64}$/)
  const saved = await files.save({ path: file, content: 'const a = 2\n', expected: opened.version.hash })
  assert.equal(saved.conflict, false)
  assert.equal(await readFile(file, 'utf8'), 'const a = 2\n')
  assert.equal((await stat(file)).mode & 0o777, 0o640, 'permissions are kept')
  assert.deepEqual(Object.keys(await files.stat({ path: file })), ['mtimeMs', 'size'])
})

test('refuses to overwrite a file that changed on disk since it was opened', async () => {
  const file = path.join(work, 'notes.md')
  await writeFile(file, 'first\n')
  const opened = await files.open({ path: file })
  await writeFile(file, 'changed by the agent\n')
  const result = await files.save({ path: file, content: 'my edit\n', expected: opened.version.hash })
  assert.equal(result.conflict, true)
  assert.equal(result.content, 'changed by the agent\n')
  assert.equal(await readFile(file, 'utf8'), 'changed by the agent\n')
  const forced = await files.save({ path: file, content: 'my edit\n', expected: result.version.hash })
  assert.equal(forced.conflict, false)
  assert.equal(await readFile(file, 'utf8'), 'my edit\n')
})

test('only regular text files inside workspace folders, checked on the real path', async () => {
  const outside = path.join(base, 'secret.txt')
  await writeFile(outside, 'no')
  await assert.rejects(files.open({ path: outside }), /only opens files inside your workspace folders/)
  await symlink(outside, path.join(work, 'link.txt'))
  await assert.rejects(files.open({ path: path.join(work, 'link.txt') }), /only opens files inside your workspace folders/)
  await assert.rejects(files.open({ path: 'relative.txt' }), /absolute file path/)
  await assert.rejects(files.open({ path: path.join(work, 'missing.txt') }), /does not exist/)
  await assert.rejects(files.open({ path: path.join(work, 'src') }), /only regular files/)
  await writeFile(path.join(work, 'image.png'), Buffer.from([0x89, 0x50, 0x00, 0x47]))
  await assert.rejects(files.open({ path: path.join(work, 'image.png') }), /binary/)
  await writeFile(path.join(work, 'big.txt'), Buffer.alloc(MAX_BYTES + 1, 97))
  await assert.rejects(files.open({ path: path.join(work, 'big.txt') }), /larger than 2 MB/)
})

test('keeps CRLF and CR line breaks and a byte order mark through open and save', async () => {
  const crlf = path.join(work, 'windows.txt')
  await writeFile(crlf, Buffer.from('﻿one\r\ntwo\r\n'))
  const opened = await files.open({ path: crlf })
  assert.equal(opened.content, 'one\r\ntwo\r\n', 'line breaks come through as they are; the byte order mark is held back')
  await files.save({ path: crlf, content: 'one\r\ntwo\r\nthree\r\n', expected: opened.version.hash })
  assert.deepEqual(await readFile(crlf), Buffer.from('﻿one\r\ntwo\r\nthree\r\n'), 'the byte order mark is written back')
  const reopened = await files.open({ path: crlf })
  assert.equal((await files.save({ path: crlf, content: reopened.content, expected: reopened.version.hash })).conflict, false)

  const cr = path.join(work, 'classic.txt')
  await writeFile(cr, 'a\rb\r')
  const classic = await files.open({ path: cr })
  assert.equal(classic.content, 'a\rb\r')
  await files.save({ path: cr, content: 'a\rb\rc\r', expected: classic.version.hash })
  assert.equal(await readFile(cr, 'utf8'), 'a\rb\rc\r')
})

test('refuses a file that is not UTF-8 instead of replacing its bytes', async () => {
  const latin1 = path.join(work, 'latin1.txt')
  await writeFile(latin1, Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])) // "café" in Latin-1
  await assert.rejects(files.open({ path: latin1 }), /not UTF-8 text/)
  await assert.rejects(files.save({ path: latin1, content: 'café\n' }), /not UTF-8 text/)
  assert.deepEqual(await readFile(latin1), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))
})

test('a save does not write through a link planted under a temporary name', async () => {
  const file = path.join(work, 'app.js')
  const victim = path.join(base, 'victim.txt')
  await writeFile(file, 'before\n')
  await writeFile(victim, 'untouched\n')
  // The name the editor used to write to: predictable from the process id.
  await symlink(victim, path.join(work, `.app.js.hs-edit-${process.pid}`))
  const opened = await files.open({ path: file })
  assert.equal((await files.save({ path: file, content: 'after\n', expected: opened.version.hash })).conflict, false)
  assert.equal(await readFile(file, 'utf8'), 'after\n')
  assert.equal(await readFile(victim, 'utf8'), 'untouched\n')
  assert.deepEqual((await readdir(work)).filter(name => name.includes('hs-edit') && name !== `.app.js.hs-edit-${process.pid}`), [], 'no temporary file is left behind')
})
