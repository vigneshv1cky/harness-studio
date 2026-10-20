import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { DEFAULT_LIMIT, createInstructionsService, notesIn, readLimit, renderSystemPrompt } from '../instructions.js'
import { applySystemPromptAdditions, createSystemPromptAdditions, systemPromptPath } from '../system-prompt.js'

let base, home, project, outside, service, opened

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'instructions-'))
  home = path.join(base, 'home')
  project = path.join(base, 'project')
  outside = path.join(base, 'outside')
  for (const dir of [home, path.join(project, '.git'), path.join(project, 'web'), outside]) await mkdir(dir, { recursive: true })
  opened = []
  service = createInstructionsService({
    home,
    workspaces: () => [{ path: path.join(project, 'web'), title: 'web' }],
    openFile: async file => { opened.push(file) },
  }).actions
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

test('only instruction files in the personal or workspace folders can be opened', async () => {
  await writeFile(path.join(outside, 'AGENTS.md'), 'secret')
  await writeFile(path.join(outside, 'notes.txt'), 'secret')
  await assert.rejects(service.open({ file: path.join(outside, 'AGENTS.md') }), /not in your personal folder/)
  await assert.rejects(service.open({ file: path.join(project, 'web', 'notes.txt') }), /Only instruction files/)
  await symlink(path.join(outside, 'AGENTS.md'), path.join(project, 'web', 'AGENTS.local.md'))
  await assert.rejects(service.open({ file: path.join(project, 'web', 'AGENTS.local.md') }), /links outside/)
  await service.open({ file: path.join(home, 'AGENTS.md') })
  assert.equal(await readFile(path.join(home, 'AGENTS.md'), 'utf8'), '', 'a missing file is created empty before it opens')
  assert.deepEqual(opened, [path.join(home, 'AGENTS.md')])
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

test('the page cannot open a CLAUDE.md', async () => {
  const claude = path.join(project, 'CLAUDE.md')
  await writeFile(claude, 'Claude rules.\n')
  await assert.rejects(service.open({ file: claude }), /Only instruction files/)
  assert.deepEqual(opened, [], 'nothing was opened')
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

test('additions are appended after every section, kept literal, and leave tools, contexts and variables alone', () => {
  const assembly = {
    sections: [{ name: 'identity', text: 'Harness.' }, { name: 'plan-policy', text: 'Plan mode is on.' }],
    contexts: [{ name: 'directory', text: '/work' }],
    tools: [{ name: 'bash' }],
    variables: { model: 'x' },
  }
  const added = applySystemPromptAdditions(assembly, 'Be terse. {{not a variable}}')
  assert.deepEqual(added.sections, [...assembly.sections, { name: 'harness-studio/system-prompt-additions', text: 'Be terse. {{not a variable}}', interpolate: false }])
  assert.equal(added.contexts, assembly.contexts)
  assert.equal(added.tools, assembly.tools)
  assert.equal(added.variables, assembly.variables)
  assert.equal(applySystemPromptAdditions(assembly, '  \n'), assembly, 'blank text adds nothing')
  assert.equal(applySystemPromptAdditions(assembly, undefined), assembly)
})

test('the additions file opens in the text editor, is read from disk, and can be removed', async () => {
  const assembly = { sections: [{ name: 'identity', text: 'Harness prompt.' }], variables: {}, tools: [] }
  const openedFiles = []
  const actions = createInstructionsService({
    home, workspaces: () => [], assemble: async () => assembly, openFile: async file => { openedFiles.push(file) },
  }).actions

  const initial = await actions.systemPrompt()
  assert.equal(initial.additions, false)
  assert.equal(initial.text, 'Harness prompt.')

  await actions.openPromptAdditions()
  assert.deepEqual(openedFiles, [systemPromptPath(home)], 'the additions file opens in the text editor')
  assert.equal(await readFile(systemPromptPath(home), 'utf8'), '', 'a missing additions file is created empty')

  await writeFile(systemPromptPath(home), 'My rules.')
  const saved = await actions.systemPrompt()
  assert.equal(saved.additions, true)
  assert.equal(saved.text, 'Harness prompt.\n\nMy rules.', 'Harness\'s prompt stays, the additions follow it')
  assert.equal(saved.additionsBytes, Buffer.byteLength('My rules.'))

  await actions.removePromptAdditions()
  assert.equal((await actions.systemPrompt()).text, 'Harness prompt.')
  await assert.rejects(readFile(systemPromptPath(home), 'utf8'), /ENOENT/)
})

test('a subagent keeps its own prompt; every other session gets the additions at the end', async () => {
  const additions = createSystemPromptAdditions({ home })
  await additions.write('Mine.', null)
  const subagentAssembly = { sections: [{ name: 'subagent', text: 'Delegated role.' }] }
  const subagent = await additions.apply(subagentAssembly, { agent: { session: { header: { origin: 'subagent' } } } }, async () => subagentAssembly)
  assert.deepEqual(subagent.sections, subagentAssembly.sections)
  const main = await additions.apply({ sections: [{ name: 'identity', text: 'Harness.' }] }, {}, async () => ({ sections: [{ name: 'identity', text: 'Harness.' }] }))
  assert.deepEqual(main.sections, [{ name: 'identity', text: 'Harness.' }, { name: 'harness-studio/system-prompt-additions', text: 'Mine.', interpolate: false }])
})
