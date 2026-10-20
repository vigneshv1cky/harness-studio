import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { createInstructionsService } from '../instructions.js'
import { SYSTEM_PROMPT_SECTION, createSystemPromptAdditions, systemPromptPath } from '../system-prompt.js'
import { createSectionCopies, sectionFileName } from '../section-copies.js'

let home
beforeEach(async () => { home = await mkdtemp(path.join(tmpdir(), 'section-copies-')) })
afterEach(async () => { await rm(home, { recursive: true, force: true }) })

const harness = () => ({
  sections: [
    { name: 'identity', text: '# Role\nYou are a coding agent powered by {{model}}.' },
    { name: 'tool-fs/read', text: 'Read files with the read tool.' },
    { name: 'plan-mode', text: 'Plan before acting.' },
  ],
  variables: { model: 'flash' },
  tools: [{ name: 'read' }],
})

/** The plugin's two listeners around Harness's assembly, in the order the plugin registers them. */
function setup() {
  const promptAdditions = createSystemPromptAdditions({ home })
  const sectionCopies = createSectionCopies({ home, skip: name => name === SYSTEM_PROMPT_SECTION })
  const state = { source: harness }
  const assemble = (context = {}) => sectionCopies.apply(state.source(), context, () => promptAdditions.apply(state.source(), context, async () => state.source()))
  const opened = []
  const { actions } = createInstructionsService({
    home, workspaces: () => [], assemble, promptAdditions, sectionCopies, openFile: async file => { opened.push(file) },
  })
  return { actions, assemble, sectionCopies, opened, state }
}

test('Open makes a copy of Harness\'s text for one section and opens it; a second Open keeps the copy', async () => {
  const t = setup()
  const view = await t.actions.systemPrompt()
  assert.deepEqual(view.sections.map(s => [s.name, s.edited, s.firstLine]), [
    ['identity', false, 'Role'], ['tool-fs/read', false, 'Read files with the read tool.'], ['plan-mode', false, 'Plan before acting.'],
  ])
  await t.actions.openSection({ name: 'tool-fs/read' })
  const copy = path.join(home, 'harness-studio', 'system-prompt', 'tool-fs--read.md')
  assert.deepEqual(t.opened, [copy])
  assert.equal(await readFile(copy, 'utf8'), 'Read files with the read tool.')
  assert.equal(await readFile(path.join(home, 'harness-studio', 'system-prompt', '.harness', 'tool-fs--read.md'), 'utf8'), 'Read files with the read tool.', 'Harness\'s text is recorded beside the copy')
  await writeFile(copy, 'Read whole files when they are short.')
  await t.actions.openSection({ name: 'tool-fs/read' })
  assert.equal(await readFile(copy, 'utf8'), 'Read whole files when they are short.', 'opening again never overwrites the copy')
})

test('opening a section without changing it is not an edit, and Open refreshes an unedited copy', async () => {
  const t = setup()
  await t.actions.systemPrompt()
  await t.actions.openSection({ name: 'plan-mode' })
  const view = await t.actions.systemPrompt()
  assert.deepEqual(view.sections.map(s => s.edited), [false, false, false], 'an unchanged copy is not shown as yours')
  assert.equal(view.text, '# Role\nYou are a coding agent powered by flash.\n\nRead files with the read tool.\n\nPlan before acting.')
  // Harness changes the section later: the unedited copy is not sent, and the next Open brings the new text.
  t.state.source = () => ({ ...harness(), sections: harness().sections.map(s => (s.name === 'plan-mode' ? { ...s, text: 'Plan, then act.' } : s)) })
  assert.ok((await t.actions.systemPrompt()).text.endsWith('Plan, then act.'), 'the unedited copy does not hold back Harness\'s new text')
  await t.actions.openSection({ name: 'plan-mode' })
  assert.equal(await readFile(t.sectionCopies.fileFor('plan-mode'), 'utf8'), 'Plan, then act.')
})

test('a copy replaces only its section, keeps its place and variables, and Reset brings Harness\'s text back', async () => {
  const t = setup()
  await t.actions.systemPrompt()
  await t.actions.openSection({ name: 'identity' })
  await writeFile(t.sectionCopies.fileFor('identity'), 'You are a careful agent on {{model}}.')
  const view = await t.actions.systemPrompt()
  assert.equal(view.text, 'You are a careful agent on flash.\n\nRead files with the read tool.\n\nPlan before acting.')
  assert.deepEqual(view.sections.map(s => s.edited), [true, false, false])
  await t.actions.resetSection({ name: 'identity' })
  assert.equal((await t.actions.systemPrompt()).text, '# Role\nYou are a coding agent powered by flash.\n\nRead files with the read tool.\n\nPlan before acting.')
  await assert.rejects(readFile(t.sectionCopies.fileFor('identity'), 'utf8'), /ENOENT/)
})

test('a subagent keeps Harness\'s sections; Your additions appear once and are not a section to copy', async () => {
  const t = setup()
  await t.actions.systemPrompt()
  await t.actions.openSection({ name: 'plan-mode' })
  await writeFile(t.sectionCopies.fileFor('plan-mode'), 'My planning rules.')
  await writeFile(systemPromptPath(home), 'Extra rule.')
  const sub = await t.assemble({ agent: { session: { header: { origin: 'subagent' } } } })
  assert.equal(sub.sections.find(s => s.name === 'plan-mode').text, 'Plan before acting.')
  const view = await t.actions.systemPrompt()
  assert.equal(view.text.split('Extra rule.').length - 1, 1, 'the additions are counted once')
  assert.ok(view.text.endsWith('My planning rules.\n\nExtra rule.'))
  assert.ok(!view.sections.some(s => s.name === SYSTEM_PROMPT_SECTION))
  await assert.rejects(t.actions.openSection({ name: SYSTEM_PROMPT_SECTION }), /not in the system prompt/)
  await assert.rejects(t.actions.openSection({ name: 'no-such-section' }), /not in the system prompt/)
})

test('section names become safe file names', () => {
  assert.equal(sectionFileName('tool-fs/read'), 'tool-fs--read.md')
  assert.equal(sectionFileName('browser-use:stagehand-native'), 'browser-use:stagehand-native.md')
  assert.equal(sectionFileName('../../etc'), '..--..--etc.md')
})
