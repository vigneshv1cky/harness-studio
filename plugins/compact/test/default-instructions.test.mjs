import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DEFAULT_INSTRUCTIONS, writeDefaultInstructions } from '../default-instructions.js'

async function home(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hs-default-instructions-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('the first start writes the reply style as the global AGENTS.md, once', async t => {
  const dir = await home(t)
  assert.equal(await writeDefaultInstructions(dir), 'written')
  const text = await readFile(path.join(dir, 'AGENTS.md'), 'utf8')
  assert.equal(text, await readFile(DEFAULT_INSTRUCTIONS, 'utf8'))
  assert.match(text, /^# How to reply/)
  // Edited, or deleted, it is never written again.
  await writeFile(path.join(dir, 'AGENTS.md'), 'my rules\n')
  assert.equal(await writeDefaultInstructions(dir), 'done-before')
  assert.equal(await readFile(path.join(dir, 'AGENTS.md'), 'utf8'), 'my rules\n')
  await rm(path.join(dir, 'AGENTS.md'))
  assert.equal(await writeDefaultInstructions(dir), 'done-before')
  await assert.rejects(readFile(path.join(dir, 'AGENTS.md')), { code: 'ENOENT' })
})

test('an existing global AGENTS.md is kept as it is', async t => {
  const dir = await home(t)
  await writeFile(path.join(dir, 'AGENTS.md'), 'already mine\n')
  assert.equal(await writeDefaultInstructions(dir), 'kept')
  assert.equal(await readFile(path.join(dir, 'AGENTS.md'), 'utf8'), 'already mine\n')
  assert.equal(await writeDefaultInstructions(dir), 'done-before')
})

test('two starts at once write the file only once', async t => {
  const dir = await home(t)
  const results = await Promise.all([writeDefaultInstructions(dir), writeDefaultInstructions(dir)])
  assert.deepEqual(results.sort(), ['done-before', 'written'])
})

test('the default text covers length, format, progress and faithful reports, and has no template variables', async () => {
  const text = await readFile(DEFAULT_INSTRUCTIONS, 'utf8')
  for (const topic of ['Lead with the answer', 'Markdown', 'code blocks', 'one short line', 'faithfully', 'No emojis', 'This file is yours']) assert.ok(text.includes(topic), topic)
  assert.ok(!text.includes('{{'))
})
