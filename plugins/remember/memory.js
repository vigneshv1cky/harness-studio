/**
 * Auto memory, like Claude Code's: a folder per project in the Harness home, one small Markdown file per fact
 * and a `MEMORY.md` index with one line per file. The agent saves, updates and deletes memories on its own
 * with the memory tools; the index is read into each new session of that project.
 *
 *   <harness home>/memory/<project key>/
 *     MEMORY.md      - [run-tests](run-tests.md) — Run tests with pnpm test, not npm
 *     run-tests.md   ---
 *                    name: run-tests
 *                    description: Run tests with pnpm test, not npm
 *                    type: project
 *                    updated: 2026-10-17
 *                    ---
 *                    The fact, then Why: and How to apply: lines.
 *
 * Everything here is plain files the user can read, edit or delete; the Instructions page lists them.
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, renameSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { localDate, looksSecret } from './logic.js'

export const INDEX = 'MEMORY.md'
export const TYPES = ['user', 'feedback', 'project', 'reference']
export const MAX_BODY_CHARS = 4000
export const MAX_DESCRIPTION_CHARS = 200
export const MAX_MEMORIES = 200
/** Index lines read into a session, as Claude Code reads the first 200 lines of its index. */
export const INDEX_LINES = 200
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAX_DIR_NAME_CHARS = 80

/** The folder name used before 2026-10-18: the root path alone, which collided and could exceed the name limit. */
const legacyDirName = root => root.replace(/[^A-Za-z0-9]/g, '-')

/**
 * The folder for a project's memories: its root path with every character but letters and digits as `-`, cut to
 * 80 characters, then `-` and the first 8 hex characters of the full path's SHA-256, so roots that differ only in
 * punctuation or non-ASCII letters never share a folder and a long path never exceeds the file-name limit. A folder
 * under the old name (the path alone) is renamed to the new name the first time it is looked up; synchronous
 * because the system prompt is built synchronously.
 */
export function memoryDir(home, projectRoot) {
  const root = path.resolve(projectRoot)
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 8)
  const dir = path.join(home, 'memory', `${legacyDirName(root).slice(0, MAX_DIR_NAME_CHARS)}-${hash}`)
  if (!existsSync(dir)) {
    try {
      const legacy = path.join(home, 'memory', legacyDirName(root))
      if (statSync(legacy).isDirectory()) renameSync(legacy, dir)
    } catch { /* no old folder (or its name was too long to exist), or another process moved it first */ }
  }
  return dir
}

/**
 * The nearest folder at or above `dir` holding `.git` (a folder in a checkout, a file in a worktree), or
 * `dir` itself, as the instruction loader decides. Synchronous because the system prompt is built synchronously.
 */
export function projectRootOf(dir) {
  let current = path.resolve(dir)
  for (;;) {
    if (existsSync(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(dir)
    current = parent
  }
}

/**
 * The project folder memories belong to, used by both the memory tools and the index read into a session: the
 * real path of the project root of `dir`, except that a linked git worktree maps to its main repository's root, so
 * a session working in a worktree shares the repository's memories. A worktree's `.git` is a file whose `gitdir:`
 * line points at `<repo>/.git/worktrees/<name>`; any other `.git` file (a submodule) keeps its own root.
 */
export function memoryProjectRoot(dir) {
  const root = projectRootOf(dir)
  let real = root
  try { real = realpathSync(root) } catch { /* keep the path as given */ }
  try {
    const dotGit = path.join(real, '.git')
    if (!statSync(dotGit).isFile()) return real
    const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))
    if (!match) return real
    const worktrees = path.dirname(path.resolve(real, match[1].trim()))
    const common = path.dirname(worktrees)
    if (path.basename(worktrees) === 'worktrees' && path.basename(common) === '.git') {
      const repo = path.dirname(common)
      try { return realpathSync(repo) } catch { return repo }
    }
  } catch { /* no .git here, or it cannot be read */ }
  return real
}

/** Per file: the tail of its write queue. */
const fileQueues = new Map()

/**
 * Run `task` once every earlier task queued for the same file in this process has settled, so read-modify-writes
 * of one file never interleave. The memory index, the remember tool and the Instructions page all write through it.
 * @template T
 * @param {string} file
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
export function queueFileWrite(file, task) {
  const key = path.resolve(file)
  const previous = fileQueues.get(key) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(task)
  fileQueues.set(key, next)
  next.finally(() => { if (fileQueues.get(key) === next) fileQueues.delete(key) }).catch(() => {})
  return next
}

/** Replace a file in one step: write a temporary file with a random name beside it, then rename it over the file. */
export async function writeFileAtomic(file, content) {
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, content, 'utf8')
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

function checkName(name) {
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new Error('name must be lowercase letters, digits and dashes, starting with a letter or digit, at most 64 characters, such as "run-tests"')
  }
  return name
}

function frontmatter(content) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(content)
  if (!match) return {}
  const fields = {}
  for (const line of match[1].split('\n')) {
    const at = line.indexOf(':')
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return fields
}

const indexLine = (name, description) => `- [${name}](${name}.md) — ${description}`

/** Read, change and write the index as one queued step, written atomically, so parallel saves lose no line. */
function rewriteIndex(dir, mutate) {
  const file = path.join(dir, INDEX)
  return queueFileWrite(file, async () => {
    const existing = await readFile(file, 'utf8').catch(() => '')
    const next = mutate(existing.split('\n').filter(line => line.trim() !== ''))
    await writeFileAtomic(file, next.length ? next.join('\n') + '\n' : '')
  })
}

/**
 * Save a memory, creating it or replacing the one with the same name, and keep its index line current.
 * @returns {Promise<'created' | 'updated'>}
 */
export async function saveMemory(dir, { name, description, type, body }) {
  checkName(name)
  const line = typeof description === 'string' ? description.replace(/\s+/g, ' ').trim() : ''
  if (line === '') throw new Error('description is required: one line saying what the memory is about')
  if (line.length > MAX_DESCRIPTION_CHARS) throw new Error(`keep the description under ${MAX_DESCRIPTION_CHARS} characters`)
  if (!TYPES.includes(type)) throw new Error(`type must be one of ${TYPES.join(', ')}`)
  if (typeof body !== 'string' || body.trim() === '') throw new Error('body is required')
  if (body.length > MAX_BODY_CHARS) throw new Error(`keep a memory under ${MAX_BODY_CHARS} characters; split it into separate memories`)
  if (looksSecret(line) || looksSecret(body)) throw new Error('this looks like it contains a password, key or token; secrets are never saved')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${name}.md`)
  const exists = await stat(file).then(() => true, () => false)
  if (!exists) {
    const count = (await readdir(dir)).filter(f => f.endsWith('.md') && f !== INDEX).length
    if (count >= MAX_MEMORIES) throw new Error(`this project already has ${MAX_MEMORIES} memories; delete or merge some first`)
  }
  const date = localDate()
  await writeFile(file, `---\nname: ${name}\ndescription: ${line}\ntype: ${type}\nupdated: ${date}\n---\n\n${body.trim()}\n`, 'utf8')
  await rewriteIndex(dir, lines => {
    const at = lines.findIndex(l => l.includes(`](${name}.md)`))
    if (at === -1) return [...lines, indexLine(name, line)]
    const next = [...lines]
    next[at] = indexLine(name, line)
    return next
  })
  return exists ? 'updated' : 'created'
}

export async function readMemory(dir, name) {
  checkName(name)
  return readFile(path.join(dir, `${name}.md`), 'utf8').catch(error => {
    if (error.code === 'ENOENT') throw new Error(`there is no memory named ${name}; the index lists them`)
    throw error
  })
}

/** @returns {Promise<boolean>} whether the memory existed. */
export async function deleteMemory(dir, name) {
  checkName(name)
  const file = path.join(dir, `${name}.md`)
  const existed = await stat(file).then(() => true, () => false)
  await rm(file, { force: true })
  if (existsSync(path.join(dir, INDEX))) await rewriteIndex(dir, lines => lines.filter(l => !l.includes(`](${name}.md)`)))
  return existed
}

/** The index as read into a session: its first {@link INDEX_LINES} lines, or '' when there is none. */
export function indexText(dir) {
  try {
    const lines = readFileSync(path.join(dir, INDEX), 'utf8').split('\n').filter(l => l.trim() !== '')
    if (lines.length <= INDEX_LINES) return lines.join('\n')
    return [...lines.slice(0, INDEX_LINES), `(${lines.length - INDEX_LINES} more index lines were not loaded; keep the index short)`].join('\n')
  } catch {
    return ''
  }
}

/** Every memory in a project's folder, for the Instructions page. */
export async function listMemories(dir) {
  const names = await readdir(dir).catch(() => [])
  const out = []
  for (const file of names.filter(f => f.endsWith('.md') && f !== INDEX).sort()) {
    const content = await readFile(path.join(dir, file), 'utf8').catch(() => '')
    const fields = frontmatter(content)
    out.push({ name: file.slice(0, -3), description: fields.description ?? '', type: fields.type ?? '', updated: fields.updated ?? '', bytes: Buffer.byteLength(content) })
  }
  return out
}
