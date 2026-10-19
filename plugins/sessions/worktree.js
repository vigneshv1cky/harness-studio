/**
 * Git worktrees for started Sessions — non-destructive by construction:
 *
 *   - Worktrees are created only under a dedicated folder outside the repository,
 *     `<home>/harness-studio/worktrees/<repository name>-<hash>/<name>`, each on a new branch
 *     `<prefix><name>` from the repository's current HEAD. The user's main checkout (its files, index,
 *     HEAD and exclude file) is never written; git records the worktree in its own administrative folder.
 *   - When the folder or branch name is taken, the next free name (`<name>-2`, `<name>-3`, …) is used;
 *     nothing existing is overwritten.
 *   - The only removals are `git worktree remove` without the force flag (git itself refuses a worktree
 *     with modified or untracked files) and `git branch -d` (git refuses an unmerged branch). No command
 *     here forces, resets, checks out, cleans, prunes or force-deletes a branch; test/worktree.test.mjs
 *     checks the source for those.
 *   - Removing a worktree on request (`remove`) additionally refuses when it has uncommitted or untracked
 *     files, ignored files outside regenerable folders (git deletes ignored files with the worktree), or
 *     commits that are neither on a remote nor merged into the main checkout's HEAD, and keeps the branch.
 *
 * Every git process runs through the plugin's process runner (process.js): timeout, process-group kill.
 */
import { createHash } from 'node:crypto'
import { access } from 'node:fs/promises'
import path from 'node:path'

const MAX_NAME_ATTEMPTS = 50
const exists = p => access(p).then(() => true, () => false)

/** Ignored folders a build or install recreates; removing a worktree may delete these without asking. */
export const REGENERABLE = new Set(['node_modules', 'dist', 'build', '.next', 'out', 'target', '__pycache__', '.venv', 'venv', '.cache', 'coverage', '.turbo', '.parcel-cache'])

/** Whether an ignored path from `git status` lies in (or is) a regenerable folder. */
export const regenerable = file => file.replace(/^"|"$/g, '').split('/').some(part => REGENERABLE.has(part))

/**
 * @param {{ run: (file: string, args: string[], options?: object) => Promise<string> }} runner
 * @param {string} root - `<home>/harness-studio/worktrees`.
 */
export function createWorktrees(runner, root) {
  const git = (cwd, args, signal) => runner.run('git', ['-C', cwd, ...args], { signal })
  const succeeds = (cwd, args, signal) => git(cwd, args, signal).then(() => true, () => false)

  /**
   * Choose a free folder and branch for a new worktree, without creating anything.
   * @param {{ folder: string, slug: string, prefix: string, signal?: AbortSignal }} input
   * @returns {Promise<{ repoRoot: string, path: string, branch: string, workDir: string }>}
   *   `workDir` is the worktree's counterpart of `folder` (same path below the repository root).
   */
  async function plan({ folder, slug, prefix, signal }) {
    let repoRoot
    try {
      repoRoot = await git(folder, ['rev-parse', '--show-toplevel'], signal)
    } catch {
      throw new Error(`${folder} is not inside a git repository, so it cannot have a worktree`)
    }
    if (!(await succeeds(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD'], signal))) {
      throw new Error(`${repoRoot} has no commits yet, so a worktree cannot branch from it`)
    }
    const hash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 8)
    const parent = path.join(root, `${path.basename(repoRoot).replace(/[^A-Za-z0-9._-]/g, '-')}-${hash}`)
    for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
      const name = attempt === 1 ? slug : `${slug}-${attempt}`
      const branch = `${prefix}${name}`
      if (!(await succeeds(repoRoot, ['check-ref-format', '--branch', branch], signal))) throw new Error(`"${branch}" is not a valid branch name`)
      const branchTaken = await succeeds(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], signal)
      const worktreePath = path.join(parent, name)
      if (branchTaken || await exists(worktreePath)) continue
      const relative = path.relative(repoRoot, folder)
      return { repoRoot, path: worktreePath, branch, workDir: relative === '' ? worktreePath : path.join(worktreePath, relative) }
    }
    throw new Error(`No free worktree name found for "${slug}"; choose another branch_name`)
  }

  /** Create the planned worktree on its new branch from HEAD. */
  async function add(planned, signal) {
    await git(planned.repoRoot, ['worktree', 'add', '-b', planned.branch, planned.path, 'HEAD'], signal)
  }

  /**
   * Undo `add` after a start failed: the worktree was created a moment ago from HEAD and is clean. Uses
   * only the refusing forms, so if anything was written to it in between, it is left in place.
   * @returns {Promise<boolean>} whether the worktree folder was removed.
   */
  async function discardFresh(planned) {
    const removed = await succeeds(planned.repoRoot, ['worktree', 'remove', planned.path])
    if (removed) await succeeds(planned.repoRoot, ['branch', '-d', planned.branch])
    return removed
  }

  /**
   * Why a worktree must not be removed, or undefined when it may be.
   * @param {{ repoRoot: string, path: string, branch: string }} target
   * @param {AbortSignal} [signal]
   */
  async function removalBlocker(target, signal) {
    if (!(await exists(target.path))) return `${target.path} no longer exists`
    // Ignored files are listed too, since `git worktree remove` deletes them (a .env, a local database).
    // "matching" shows an ignored folder as one line instead of every file in it, so node_modules stays short.
    const status = await git(target.path, ['status', '--porcelain', '--ignored=matching', '--untracked-files=all'], signal)
    const lines = status === '' ? [] : status.split('\n')
    const changed = lines.filter(line => !line.startsWith('!! '))
    if (changed.length > 0) return `it has uncommitted or untracked files:\n${changed.slice(0, 10).join('\n')}`
    const ignored = lines.filter(line => line.startsWith('!! ') && !regenerable(line.slice(3)))
    if (ignored.length > 0) {
      const more = ignored.length > 10 ? `\n… and ${ignored.length - 10} more` : ''
      return `it has ignored files that removing it would delete:\n${ignored.slice(0, 10).map(line => line.slice(3)).join('\n')}${more}`
    }
    const unpushed = Number(await git(target.repoRoot, ['rev-list', '--count', target.branch, '--not', '--remotes'], signal))
    if (unpushed > 0 && !(await succeeds(target.repoRoot, ['merge-base', '--is-ancestor', target.branch, 'HEAD'], signal))) {
      return `branch ${target.branch} has ${unpushed} commit(s) that are not pushed and not merged into the current branch of ${target.repoRoot}`
    }
    return undefined
  }

  /**
   * Remove a clean worktree folder on the user's request; the branch is kept.
   * @param {{ repoRoot: string, path: string, branch: string }} target
   * @param {AbortSignal} [signal]
   * @returns {Promise<string>} what was done.
   * @throws when the worktree has work in it (see `removalBlocker`).
   */
  async function remove(target, signal) {
    const blocker = await removalBlocker(target, signal)
    if (blocker) throw new Error(`Not removing ${target.path}: ${blocker}`)
    await git(target.repoRoot, ['worktree', 'remove', target.path], signal)
    return `Removed the worktree ${target.path}. The branch ${target.branch} is kept.`
  }

  return { plan, add, discardFresh, removalBlocker, remove }
}
