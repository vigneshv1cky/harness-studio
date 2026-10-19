// Git worktrees: created only under the dedicated folder, never overwriting, never touching the main
// checkout, and removed only when clean — with no forcing or destructive git command in the plugin.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createRunner } from '../process.js'
import { createWorktrees } from '../worktree.js'

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()

async function setup(t) {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hs-sessions-wt-')))
  const repo = path.join(base, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  await writeFile(path.join(repo, 'a.txt'), 'one\n')
  git(repo, 'add', 'a.txt')
  git(repo, 'commit', '-q', '-m', 'first')
  const runner = createRunner()
  const worktrees = createWorktrees(runner, path.join(base, 'home', 'harness-studio', 'worktrees'))
  t.after(async () => { await runner.dispose(); await rm(base, { recursive: true, force: true }) })
  return { base, repo, worktrees }
}

/** Everything a worktree could disturb in the main checkout. */
async function checkoutState(repo) {
  const exclude = await readFile(path.join(repo, '.git', 'info', 'exclude'), 'utf8').catch(() => '')
  return { status: git(repo, 'status', '--porcelain', '--untracked-files=all'), head: git(repo, 'rev-parse', 'HEAD'), branch: git(repo, 'branch', '--show-current'), exclude, files: (await readdir(repo)).sort() }
}

test('worktree is created under the dedicated folder and leaves the main checkout untouched', async t => {
  const { base, repo, worktrees } = await setup(t)
  const before = await checkoutState(repo)
  const plan = await worktrees.plan({ folder: repo, slug: 'fix-login', prefix: 'harness/' })
  assert.ok(plan.path.startsWith(path.join(base, 'home', 'harness-studio', 'worktrees') + path.sep), plan.path)
  assert.equal(plan.branch, 'harness/fix-login')
  await worktrees.add(plan)
  assert.equal(git(plan.path, 'branch', '--show-current'), 'harness/fix-login')
  assert.deepEqual(await checkoutState(repo), before)
})

test('taken names get the next free suffix instead of being overwritten', async t => {
  const { repo, worktrees } = await setup(t)
  const first = await worktrees.plan({ folder: repo, slug: 'task', prefix: 'harness/' })
  await worktrees.add(first)
  git(repo, 'branch', 'harness/task-2')
  const second = await worktrees.plan({ folder: repo, slug: 'task', prefix: 'harness/' })
  assert.equal(second.branch, 'harness/task-3')
  assert.notEqual(second.path, first.path)
  await worktrees.add(second)
  assert.equal(git(first.path, 'branch', '--show-current'), 'harness/task')
})

test('a subfolder maps to the same subfolder in the worktree', async t => {
  const { repo, worktrees } = await setup(t)
  execFileSync('mkdir', ['-p', path.join(repo, 'pkg', 'web')])
  const plan = await worktrees.plan({ folder: path.join(repo, 'pkg', 'web'), slug: 'sub', prefix: 'h/' })
  assert.equal(plan.workDir, path.join(plan.path, 'pkg', 'web'))
})

test('a folder outside git is refused', async t => {
  const { base, worktrees } = await setup(t)
  await assert.rejects(worktrees.plan({ folder: base, slug: 'x', prefix: 'h/' }), /not inside a git repository/)
})

test('removal is refused for uncommitted, untracked or unpushed unmerged work', async t => {
  const { repo, worktrees } = await setup(t)
  const plan = await worktrees.plan({ folder: repo, slug: 'work', prefix: 'harness/' })
  await worktrees.add(plan)

  await writeFile(path.join(plan.path, 'new.txt'), 'draft\n')
  await assert.rejects(worktrees.remove(plan), /uncommitted or untracked/)

  git(plan.path, 'add', 'new.txt')
  await assert.rejects(worktrees.remove(plan), /uncommitted or untracked/)

  git(plan.path, 'commit', '-q', '-m', 'work')
  await assert.rejects(worktrees.remove(plan), /not pushed and not merged/)
  assert.equal(git(plan.path, 'log', '-1', '--format=%s'), 'work', 'the commit is still there')

  // Once merged into the main checkout, the worktree may go; the branch stays.
  git(repo, 'merge', '-q', '--ff-only', plan.branch)
  assert.match(await worktrees.remove(plan), /branch harness\/work is kept/)
  assert.equal(git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${plan.branch}`).length > 0, true)
})

test('removal is refused for ignored files git would delete, but not for regenerable folders', async t => {
  const { repo, worktrees } = await setup(t)
  await writeFile(path.join(repo, '.gitignore'), 'node_modules/\ndist/\n.env\n*.db\n')
  git(repo, 'add', '.gitignore')
  git(repo, 'commit', '-q', '-m', 'ignore')
  const plan = await worktrees.plan({ folder: repo, slug: 'ignored', prefix: 'harness/' })
  await worktrees.add(plan)
  execFileSync('mkdir', ['-p', path.join(plan.path, 'node_modules', 'pkg'), path.join(plan.path, 'dist')])
  await writeFile(path.join(plan.path, 'node_modules', 'pkg', 'index.js'), '')
  await writeFile(path.join(plan.path, 'dist', 'app.js'), '')
  assert.equal(await worktrees.removalBlocker(plan), undefined, 'only regenerable folders are ignored')

  await writeFile(path.join(plan.path, '.env'), 'LOCAL=1\n')
  await writeFile(path.join(plan.path, 'local.db'), '')
  const blocker = await worktrees.removalBlocker(plan)
  assert.match(blocker, /ignored files that removing it would delete/)
  assert.match(blocker, /\.env/)
  assert.match(blocker, /local\.db/)
  assert.doesNotMatch(blocker, /node_modules|dist/)
  await assert.rejects(worktrees.remove(plan), /ignored files/)
  assert.equal(await readFile(path.join(plan.path, '.env'), 'utf8'), 'LOCAL=1\n', 'the ignored file is still there')

  for (let i = 0; i < 12; i++) await writeFile(path.join(plan.path, `extra-${i}.db`), '')
  assert.match(await worktrees.removalBlocker(plan), /and 4 more$/)
})

test('rollback of a fresh worktree leaves one that gained work in place', async t => {
  const { repo, worktrees } = await setup(t)
  const clean = await worktrees.plan({ folder: repo, slug: 'clean', prefix: 'harness/' })
  await worktrees.add(clean)
  assert.equal(await worktrees.discardFresh(clean), true)
  assert.equal(git(repo, 'branch', '--list', clean.branch), '')

  const dirty = await worktrees.plan({ folder: repo, slug: 'dirty', prefix: 'harness/' })
  await worktrees.add(dirty)
  await writeFile(path.join(dirty.path, 'keep.txt'), 'user work\n')
  assert.equal(await worktrees.discardFresh(dirty), false)
  assert.equal(await readFile(path.join(dirty.path, 'keep.txt'), 'utf8'), 'user work\n')
})

test('no plugin source runs a forcing or destructive git command', async () => {
  const dir = fileURLToPath(new URL('..', import.meta.url))
  const banned = [/['"]--force['"]/, /['"]-f['"]/, /['"]reset['"]/, /['"]checkout['"]/, /['"]clean['"]/, /['"]prune['"]/, /['"]-D['"]/, /['"]--hard['"]/]
  for (const file of (await readdir(dir)).filter(f => f.endsWith('.js'))) {
    const source = await readFile(path.join(dir, file), 'utf8')
    for (const pattern of banned) assert.doesNotMatch(source, pattern, `${file} contains ${pattern}`)
  }
})
