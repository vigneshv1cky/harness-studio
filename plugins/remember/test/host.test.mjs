import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { apply } from '../index.js'
import { HEADING, PERSONAL, PROJECT, SKIP } from '../logic.js'

let base
let project
let home
let asked

/** A Harness double: the tool registry, working directory, question card and system prompt this plugin uses. */
function harness(answer) {
  const tools = new Map()
  const prompts = []
  asked = []
  const ctx = {
    get: name => name === 'profileContext' ? { home } : name === 'userQuestions' ? {
      ask: async ({ questions }) => {
        asked.push(questions[0])
        return { answers: [{ id: questions[0].id, ...answer }] }
      },
    } : undefined,
    effect: (fn) => fn(),
    tools: { register: tool => { tools.set(tool.name, tool); return () => {} } },
    workingDirectory: { ensure: async () => path.join(project, 'src') },
    systemPrompt: { context: entry => prompts.push(entry) },
  }
  apply(ctx)
  const run = args => tools.get('remember').execute(args, { agent: { session: {} }, signal: undefined })
  return { run, prompts }
}

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'remember-'))
  project = path.join(base, 'project')
  home = path.join(base, 'home')
  await mkdir(path.join(project, 'src'), { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: project })
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

test('a project note goes to AGENTS.local.md at the project root, with a git warning when not ignored', async () => {
  const { run } = harness({ selected: [PROJECT] })
  const result = await run({ note: 'Run the tests with pnpm test', scope: 'project' })
  assert.equal(asked[0].question, 'Run the tests with pnpm test')
  assert.deepEqual(asked[0].options.map(o => o.label), [PROJECT, PERSONAL, SKIP])
  const saved = await readFile(path.join(project, 'AGENTS.local.md'), 'utf8')
  assert.match(saved, new RegExp(`^${HEADING}\\n\\n- Run the tests with pnpm test \\(\\d{4}-\\d{2}-\\d{2}\\)\\n$`))
  assert.match(result, /Saved to .*AGENTS\.local\.md/)
  assert.match(result, /not ignored by git/)
})

test('no git warning when AGENTS.local.md is ignored', async () => {
  await writeFile(path.join(project, '.gitignore'), 'AGENTS.local.md\n')
  const { run } = harness({ selected: [PROJECT] })
  const result = await run({ note: 'Use tabs' })
  assert.doesNotMatch(result, /not ignored by git/)
})

test('a personal note goes to AGENTS.md in the Harness home', async () => {
  const { run } = harness({ selected: [PERSONAL] })
  await run({ note: 'Explain in prose, not code identifiers', scope: 'personal' })
  assert.deepEqual(asked[0].options.map(o => o.label), [PERSONAL, PROJECT, SKIP])
  assert.match(await readFile(path.join(home, 'AGENTS.md'), 'utf8'), /- Explain in prose, not code identifiers \(/)
})

test("Don't save and typed answers write nothing", async () => {
  const skipped = await harness({ selected: [SKIP] }).run({ note: 'Use tabs' })
  assert.match(skipped, /chose not to save/)
  const typed = await harness({ selected: [], custom: 'only for the web folder' }).run({ note: 'Use tabs' })
  assert.match(typed, /Nothing was saved\. The user answered: only for the web folder/)
  await assert.rejects(readFile(path.join(project, 'AGENTS.local.md'), 'utf8'), { code: 'ENOENT' })
})

test('a secret-looking note is refused before the user is asked', async () => {
  const { run } = harness({ selected: [PROJECT] })
  // Assembled at run time so the repository holds nothing that looks like a real token.
  await assert.rejects(run({ note: `Deploy with token ${'gh' + 'p_'}${'f'.repeat(32)}` }), /secrets are never saved/)
  assert.equal(asked.length, 0)
})

test('saving the same note twice changes nothing the second time', async () => {
  const { run } = harness({ selected: [PROJECT] })
  await run({ note: 'Use pnpm' })
  const again = await run({ note: 'Use pnpm' })
  assert.match(again, /already has this note/)
  const saved = await readFile(path.join(project, 'AGENTS.local.md'), 'utf8')
  assert.equal(saved.match(/Use pnpm/g).length, 1)
})

test('the guidance is given to top-level sessions only', () => {
  const { prompts } = harness({ selected: [] })
  assert.match(prompts[0].text({ agent: { session: { header: {} } } }), /call remember/)
  assert.equal(prompts[0].text({ agent: { session: { header: { origin: 'subagent' } } } }), '')
})
