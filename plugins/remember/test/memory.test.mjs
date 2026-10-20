import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { apply } from '../index.js'
import { INDEX, INDEX_LINES, deleteMemory, indexText, listMemories, memoryDir, memoryProjectRoot, projectRootOf, saveMemory } from '../memory.js'

let base, home, project, dir

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'memory-'))
  home = path.join(base, 'home')
  project = path.join(base, 'project')
  await mkdir(path.join(project, 'src'), { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: project })
  dir = memoryDir(home, project)
})

afterEach(async () => { await rm(base, { recursive: true, force: true }) })

const memo = (over = {}) => ({ name: 'run-tests', description: 'Run tests with pnpm test, not npm', type: 'project', body: 'Use pnpm test.\nWhy: npm misses the workspace.\nHow to apply: in every package.', ...over })

test('one folder per project, found from any folder inside it', () => {
  assert.equal(projectRootOf(path.join(project, 'src')), project)
  assert.equal(memoryDir(home, project), memoryDir(home, path.join(project, '.')))
  assert.notEqual(memoryDir(home, project), memoryDir(home, path.join(base, 'other')))
})

test('folder names never collide on punctuation or non-ASCII letters, and long paths stay under the name limit', () => {
  const names = ['/w/my-app', '/w/my_app', '/w/my.app', '/w/mé-app', '/w/mü-app'].map(root => path.basename(memoryDir(home, root)))
  assert.equal(new Set(names).size, names.length, names.join(' '))
  const long = path.basename(memoryDir(home, '/' + 'deep/'.repeat(80) + 'project'))
  assert.ok(long.length <= 89, `${long.length} characters`)
  assert.match(long, /-[0-9a-f]{8}$/)
})

test('an old-style memory folder is moved to the new name once', async () => {
  const root = path.join(base, 'legacy-project')
  const legacy = path.join(home, 'memory', path.resolve(root).replace(/[^A-Za-z0-9]/g, '-'))
  await mkdir(legacy, { recursive: true })
  await writeFile(path.join(legacy, INDEX), '- [old](old.md) — kept\n')
  const moved = memoryDir(home, root)
  assert.notEqual(moved, legacy)
  assert.equal(await readFile(path.join(moved, INDEX), 'utf8'), '- [old](old.md) — kept\n')
  assert.equal(existsSync(legacy), false)
  // A later old-style folder (another project that used to collide) is left alone once the new one exists.
  await mkdir(legacy, { recursive: true })
  assert.equal(memoryDir(home, root), moved)
  assert.equal(existsSync(legacy), true)
})

test('a git worktree shares its main repository\'s memory folder', async () => {
  const repo = await realpath(project)
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'first'])
  const worktree = path.join(base, 'wt')
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'side', worktree])
  await mkdir(path.join(worktree, 'src'), { recursive: true })
  assert.equal(memoryProjectRoot(path.join(worktree, 'src')), repo)
  assert.equal(memoryProjectRoot(path.join(project, 'src')), repo)
  await mkdir(path.join(base, 'not-a-repo'))
  assert.equal(memoryProjectRoot(path.join(base, 'not-a-repo')), path.join(await realpath(base), 'not-a-repo'))

  // The tools run in the worktree, the index is read from the stored folder (the repository): one memory folder.
  const tools = new Map()
  const prompts = []
  apply({
    get: name => (name === 'profileContext' ? { home } : undefined),
    effect: fn => fn(),
    on: () => () => {},
    tools: { register: tool => { tools.set(tool.name, tool); return () => {} } },
    workingDirectory: { ensure: async () => path.join(worktree, 'src') },
    systemPrompt: { context: entry => prompts.push(entry) },
  })
  await tools.get('memory_save').execute(memo(), { agent: { session: { id: 'w1', header: { cwd: repo } } } })
  const prompt = prompts.find(p => p.name === 'remember').text({ agent: { session: { id: 'w2', header: { cwd: repo } } } })
  assert.match(prompt, /- \[run-tests\]\(run-tests\.md\)/)
})

test('parallel saves keep every index line, and no temporary file is left', async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => saveMemory(dir, memo({ name: `fact-${i}`, description: `Fact ${i}` }))))
  const lines = (await readFile(path.join(dir, INDEX), 'utf8')).trim().split('\n')
  assert.equal(lines.length, 20)
  assert.deepEqual((await readdir(dir)).filter(f => f.endsWith('.tmp')), [])
})

test('saving writes one file per fact and keeps one index line per file', async () => {
  assert.equal(await saveMemory(dir, memo()), 'created')
  assert.equal(await saveMemory(dir, memo({ name: 'prose', type: 'feedback', description: 'Explain in prose, not identifiers' })), 'created')
  const file = await readFile(path.join(dir, 'run-tests.md'), 'utf8')
  assert.match(file, /^---\nname: run-tests\ndescription: Run tests with pnpm test, not npm\ntype: project\nupdated: \d{4}-\d{2}-\d{2}\n---\n\nUse pnpm test\./)
  assert.equal(await readFile(path.join(dir, INDEX), 'utf8'),
    '- [run-tests](run-tests.md) — Run tests with pnpm test, not npm\n- [prose](prose.md) — Explain in prose, not identifiers\n')
  assert.equal(await saveMemory(dir, memo({ description: 'Run tests with pnpm -r test' })), 'updated')
  assert.match(await readFile(path.join(dir, INDEX), 'utf8'), /^- \[run-tests\]\(run-tests\.md\) — Run tests with pnpm -r test\n- \[prose\]/)
  assert.deepEqual((await listMemories(dir)).map(m => [m.name, m.type]), [['prose', 'feedback'], ['run-tests', 'project']])
})

test('deleting removes the file and its index line', async () => {
  await saveMemory(dir, memo())
  await saveMemory(dir, memo({ name: 'prose' }))
  assert.equal(await deleteMemory(dir, 'run-tests'), true)
  assert.equal(await readFile(path.join(dir, INDEX), 'utf8'), '- [prose](prose.md) — Run tests with pnpm test, not npm\n')
  assert.equal(await deleteMemory(dir, 'run-tests'), false)
})

test('bad names, types, sizes and secret-looking text are refused', async () => {
  await assert.rejects(saveMemory(dir, memo({ name: '../escape' })), /lowercase letters/)
  await assert.rejects(saveMemory(dir, memo({ name: 'Run Tests' })), /lowercase letters/)
  await assert.rejects(saveMemory(dir, memo({ type: 'secret' })), /type must be one of/)
  await assert.rejects(saveMemory(dir, memo({ body: 'x'.repeat(4001) })), /under 4000/)
  await assert.rejects(saveMemory(dir, memo({ description: '' })), /description is required/)
  // Assembled at run time so the repository holds nothing that looks like a real token.
  await assert.rejects(saveMemory(dir, memo({ body: `Deploy with ${'gh' + 'p_'}${'f'.repeat(32)}` })), /secrets are never saved/)
})

test('a session reads at most the first 200 index lines', async () => {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, INDEX), Array.from({ length: INDEX_LINES + 5 }, (_, i) => `- [m${i}](m${i}.md) — note ${i}`).join('\n'))
  const text = indexText(dir)
  assert.equal(text.split('\n').length, INDEX_LINES + 1)
  assert.match(text, /5 more index lines were not loaded/)
  assert.equal(indexText(path.join(base, 'none')), '')
})

test('the agent saves, reads and deletes through its tools, and new sessions see the index', async () => {
  const tools = new Map()
  const prompts = []
  apply({
    get: name => (name === 'profileContext' ? { home } : undefined),
    effect: fn => fn(),
    on: () => () => {},
    tools: { register: tool => { tools.set(tool.name, tool); return () => {} } },
    workingDirectory: { ensure: async () => path.join(project, 'src') },
    systemPrompt: { context: entry => prompts.push(entry) },
  })
  const exec = { agent: { session: { id: 's1', header: { cwd: path.join(project, 'src') } } } }
  const prompt = prompts.find(p => p.name === 'remember')
  const before = prompt.text({ agent: exec.agent })
  assert.match(before, /No memories saved for this project yet/)

  assert.match(await tools.get('memory_save').execute(memo(), exec), /Saved memory "run-tests"/)
  assert.match(await tools.get('memory_read').execute({ name: 'run-tests' }, exec), /Use pnpm test/)
  assert.equal(prompt.text({ agent: exec.agent }), before, 'the prompt stays the same for the rest of the session')
  const next = prompt.text({ agent: { session: { id: 's2', header: { cwd: project } } } })
  assert.match(next, /- \[run-tests\]\(run-tests\.md\) — Run tests with pnpm test, not npm/)
  assert.match(await tools.get('memory_delete').execute({ name: 'run-tests' }, exec), /Deleted memory/)
  assert.equal(prompt.text({ agent: { session: { id: 's3', header: { origin: 'subagent', cwd: project } } } }), '')
})
