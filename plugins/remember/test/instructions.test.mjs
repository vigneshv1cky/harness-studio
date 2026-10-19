import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { DEFAULT_LIMIT, createInstructionsService, notesIn, readLimit, renderSystemPrompt } from '../instructions.js'

let base, home, project, outside, service

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'instructions-'))
  home = path.join(base, 'home')
  project = path.join(base, 'project')
  outside = path.join(base, 'outside')
  for (const dir of [home, path.join(project, '.git'), path.join(project, 'web'), outside]) await mkdir(dir, { recursive: true })
  service = createInstructionsService({ home, workspaces: () => [{ path: path.join(project, 'web'), title: 'web' }] }).actions
})

afterEach(async () => { await rm(base, { recursive: true, force: true }) })

test('lists what a workspace loads: AGENTS.md per folder, the personal file, notes; CLAUDE.md is not read', async () => {
  await writeFile(path.join(home, 'AGENTS.md'), 'Personal.\n\n## Remembered\n\n- Use pnpm (2026-10-17)\n')
  await writeFile(path.join(project, 'AGENTS.md'), 'Root rules.\n')
  await writeFile(path.join(project, 'CLAUDE.md'), 'Claude rules.\n')
  await writeFile(path.join(project, 'web', 'CLAUDE.md'), 'Web rules.\n')
  const view = await service.overview({})
  const status = Object.fromEntries(view.files.map(f => [f.path, f.status]))
  assert.equal(view.folder, path.join(project, 'web'))
  assert.equal(status['AGENTS.md'], 'loaded')
  assert.ok(!view.files.some(f => /CLAUDE/.test(f.path)), 'files for other agent tools are not listed')
  assert.equal(view.sentBytes, Buffer.byteLength('Personal.\n\n## Remembered\n\n- Use pnpm (2026-10-17)\n') + Buffer.byteLength('Root rules.\n'), 'CLAUDE.md is not counted')
  assert.ok(!view.files.some(f => f.kind === 'shared'), 'no file shared with other agent tools is read')
  assert.equal(view.limit, DEFAULT_LIMIT)
  assert.deepEqual(view.notes.map(n => n.text), ['Use pnpm'])
})

test('over the limit, broader files are left out first and the most specific is shortened', async () => {
  await writeFile(path.join(home, 'AGENTS.md'), 'p'.repeat(3000))
  await writeFile(path.join(project, 'AGENTS.md'), 'r'.repeat(6000))
  await writeFile(path.join(project, 'web', 'AGENTS.md'), 'w'.repeat(5000))
  await service.setLimit({ maxBytes: 4096 })
  const view = await service.overview({})
  const status = Object.fromEntries(view.files.map(f => [f.kind === 'personal' ? 'personal' : f.path, f.status]))
  assert.equal(status.personal, 'left-out')
  assert.equal(status['AGENTS.md'], 'left-out')
  assert.equal(status[path.join('web', 'AGENTS.md')], 'cut')
  assert.equal(view.sentBytes, 4096)
})

test('the limit is saved for the loader, 0 meaning no limit, and nonsense is refused', async () => {
  assert.equal(await readLimit(home), DEFAULT_LIMIT)
  await service.setLimit({ maxBytes: 262144 })
  assert.equal(await readLimit(home), 262144)
  assert.deepEqual(JSON.parse(await readFile(path.join(home, 'harness-studio', 'instructions.json'), 'utf8')), { maxBytes: 262144 })
  await service.setLimit({ maxBytes: 0 })
  assert.equal(await readLimit(home), 0)
  await assert.rejects(service.setLimit({ maxBytes: 12 }), /at least 4 KB/)
})

test('only instruction files in the personal or workspace folders can be read or written', async () => {
  await writeFile(path.join(outside, 'AGENTS.md'), 'secret')
  await writeFile(path.join(outside, 'notes.txt'), 'secret')
  await assert.rejects(service.read({ file: path.join(outside, 'AGENTS.md') }), /not in your personal folder/)
  await assert.rejects(service.read({ file: path.join(project, 'web', 'notes.txt') }), /Only instruction files/)
  await assert.rejects(service.write({ file: path.join(project, '..', 'outside', 'AGENTS.md'), content: 'x' }), /not in your personal folder/)
  await symlink(path.join(outside, 'AGENTS.md'), path.join(project, 'web', 'AGENTS.local.md'))
  await assert.rejects(service.read({ file: path.join(project, 'web', 'AGENTS.local.md') }), /links outside/)
  const { hash } = await service.read({ file: path.join(home, 'AGENTS.md') })
  await service.write({ file: path.join(home, 'AGENTS.md'), content: 'Be brief.\n', hash })
  assert.equal((await service.read({ file: path.join(home, 'AGENTS.md') })).content, 'Be brief.\n')
})

test('a save over a file that changed since it was opened is refused, and nothing is lost', async () => {
  const file = path.join(home, 'AGENTS.md')
  await writeFile(file, 'Rules.\n')
  const opened = await service.read({ file })
  // The remember tool saves a note while the editor is open.
  await writeFile(file, 'Rules.\n\n## Remembered\n\n- Use pnpm (2026-10-18)\n')
  await assert.rejects(service.write({ file, content: 'Rules, edited.\n', hash: opened.hash }), /changed since you opened it/)
  assert.match(await readFile(file, 'utf8'), /Use pnpm/)
  await assert.rejects(service.write({ file, content: 'x' }), /Reopen the file/)
  const fresh = await service.read({ file })
  await service.write({ file, content: 'Rules, edited.\n', hash: fresh.hash })
  assert.equal(await readFile(file, 'utf8'), 'Rules, edited.\n')
})

test('page writes wait for the remember tool\'s queued write to the same file', async () => {
  const { queueFileWrite } = await import('../memory.js')
  const file = path.join(home, 'AGENTS.md')
  await writeFile(file, 'one\n')
  const { hash } = await service.read({ file })
  let release
  const held = queueFileWrite(file, () => new Promise(resolve => { release = resolve }))
  const saving = service.write({ file, content: 'two\n', hash })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(await readFile(file, 'utf8'), 'one\n', 'the page write waits its turn')
  release()
  await held
  await saving
  assert.equal(await readFile(file, 'utf8'), 'two\n')
})

test('deleting a note removes only its line, and only inside the Remembered section', async () => {
  await writeFile(path.join(home, 'AGENTS.md'), '## Remembered\n\n- Use pnpm (2026-10-17)\n- Prefer tabs (2026-10-17)\n')
  await service.deleteNote({ file: path.join(home, 'AGENTS.md'), line: '- Use pnpm (2026-10-17)' })
  assert.deepEqual(notesIn(await readFile(path.join(home, 'AGENTS.md'), 'utf8')).map(n => n.text), ['Prefer tabs'])
  await assert.rejects(service.deleteNote({ file: path.join(home, 'AGENTS.md'), line: '- Use pnpm (2026-10-17)' }), /no longer in the file/)

  const file = path.join(home, 'AGENTS.md')
  await writeFile(file, '# Rules\n\n- Prefer tabs\n\n## Remembered\n\n- Prefer tabs\n\n## Later\n\n- Prefer tabs\n')
  await service.deleteNote({ file, line: '- Prefer tabs' })
  assert.equal(await readFile(file, 'utf8'), '# Rules\n\n- Prefer tabs\n\n## Remembered\n\n\n## Later\n\n- Prefer tabs\n')
  await assert.rejects(service.deleteNote({ file, line: '- Prefer tabs' }), /no longer in the file/, 'lines outside the section are never deleted')
})

test('a CLAUDE.md is never listed; a folder with only one still gets a Create row for AGENTS.md', async () => {
  await writeFile(path.join(project, 'CLAUDE.md'), 'Claude rules.\n')
  const view = await service.overview({})
  assert.equal(view.files.find(f => f.path === 'AGENTS.md').status, 'missing')
  assert.ok(!view.files.some(f => /CLAUDE/.test(f.path)))
  assert.equal(view.sentBytes, 0)
})

test('the page cannot read, change or open a CLAUDE.md', async () => {
  const claude = path.join(project, 'CLAUDE.md')
  await writeFile(claude, 'Claude rules.\n')
  await assert.rejects(service.read({ file: claude }), /Only instruction files/)
  await assert.rejects(service.write({ file: claude, content: 'x', hash: 'h' }), /Only instruction files/)
  await assert.rejects(service.open({ file: claude }), /Only instruction files/)
})

test('the system prompt view renders sections in order, fills known variables and keeps literal sections literal', async () => {
  const assembly = {
    sections: [
      { name: 'identity', text: 'You are a coding agent powered by the {{model}} model on {{os}}.' },
      { name: 'empty', text: '' },
      { name: 'literal', text: 'Write {{this}} as is.', interpolate: false },
    ],
    variables: { os: 'macOS', model: undefined },
    tools: [{ name: 'bash' }, { name: 'read' }],
  }
  const rendered = renderSystemPrompt(assembly)
  assert.equal(rendered.text, 'You are a coding agent powered by the {{model}} model on macOS.\n\nWrite {{this}} as is.')
  assert.deepEqual(rendered.sections.map(s => s.name), ['identity', 'literal'])
  assert.equal(rendered.bytes, Buffer.byteLength(rendered.text))
  assert.equal(rendered.tools, 2)
  const { actions } = createInstructionsService({ home: '/nowhere', workspaces: () => [], assemble: async () => assembly })
  assert.equal((await actions.systemPrompt()).text, rendered.text)
  assert.equal(await createInstructionsService({ home: '/nowhere', workspaces: () => [] }).actions.systemPrompt(), null)
})
