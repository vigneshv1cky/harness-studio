/**
 * Local git helper for the Changes and Details panes.
 *
 * Harness gives out-of-tree plugins no way to add Host functions the Client can call, and every
 * slash command is logged into the conversation, so a refreshing pane cannot use one. Instead the
 * Host half serves a tiny read-only HTTP endpoint on 127.0.0.1:
 *
 *   GET /hello?nonce=<hex>          → { service, version, proof }     (proves this launch's secret)
 *   GET /status?cwd=<abs dir>       → branch, changed files with line counts and modification times, totals
 *   GET /diff?cwd=<abs dir>&path=<repo-relative file> → that file's diff against HEAD
 *   GET /files?cwd=<abs dir>       → every non-ignored file in the folder (for the Files filter)
 *   GET /search?cwd=<abs dir>&q=<text> → matching lines in text files (the Files "?" search)
 *   GET /overview?cwd=<abs dir>     → branch, upstream, commits ahead and behind, uncommitted count, last commit
 *   GET /log?cwd=<abs dir>&skip=<n>[&all=1][&q=<text>&by=message|author|code] → one page of commits
 *   GET /commit?cwd=<abs dir>&hash=<id> → a commit's details and the files it changed, with counts
 *   GET /commit-diff?cwd=<abs dir>&hash=<id>&path=<file> → one file's diff in that commit
 *   GET /blame?cwd=<abs dir>&hash=<id>&path=<file> → who last changed each line of the file at that commit
 *   GET /branches?cwd=<abs dir>     → the local branches, the current one, and which are checked out elsewhere
 *   POST /switch { cwd, branch }    → switch the work tree to another local branch (JSON; see below)
 *   GET /browser/next?session=<id>  → the next Browser pane command for that Session (long poll)
 *   POST /browser/result            → a command's result, { id, ok, value | error } (JSON)
 *
 * The two /browser routes relay the agent's browser tools to the Browser pane (browser-bridge.js).
 *
 * Safety:
 *   - binds 127.0.0.1 only;
 *   - every route except /hello requires the `x-hs-helper-key` header to equal this launch's
 *     random secret (32 bytes, hex). The Host half hands it to the Harness window through the
 *     `harnessStudioDevPreview/helper` Remote method (index.js), over Harness's authenticated
 *     Client↔Host channel, so no other local process or web page has it.
 *     /hello never needs it: it answers HMAC-SHA256(secret, "hello:<port>:<nonce>") so the window
 *     can check it reached its own Host's helper before sending the secret;
 *   - answers only requests whose Origin is the Harness app (Desktop `dsh-app://app`, or the
 *     configured Web origins); a page on any other site — including the app shown in the
 *     Browser pane — gets 403, and browsers withhold the response anyway without CORS headers;
 *   - runs fixed git commands with execFile (no shell); request values are passed only as the
 *     working directory and as a path after `--`;
 *   - git is read-only: status, diff, diff-tree, log, show, blame, rev-list, ls-files, grep, config reads
 *     and rev-parse; output, diffs and results are size-capped. Commit ids must be hexadecimal and paths
 *     repository-relative and after `--`, so neither can be read as an option;
 *   - git runs outside the agent's sandbox, so no repository setting may make it start a program: every
 *     call turns off fsmonitor, hooks, the pager and external diff commands (and diff drivers and textconv
 *     on diffs), skips looking inside submodules, and blanks every clean/smudge/process filter the
 *     repository configures (see `filterOverrides`);
 *   - a status request is shared by every caller asking about the same folder while it runs, and git
 *     processes are killed once no request is waiting for them;
 *   - two requests write, and both must be JSON (forcing a browser preflight that other origins fail):
 *     POST /browser/result, which can only settle a command this process issued, and POST /switch, which
 *     changes a repository's checked-out branch only to an existing local branch, and refuses while the
 *     work tree has any uncommitted change (untracked files included) or while the repository configures a
 *     content filter (Git LFS, git-crypt): filters are switched off for every call here, so a checkout
 *     would write their raw stored form. Hooks stay off too, so a post-checkout hook does not run.
 */
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

export const SERVICE = 'harness-studio-git'
export const VERSION = 1
/** First port tried; the next few are used when it is taken (for example by a second Harness). */
export const BASE_PORT = 47613
export const PORT_ATTEMPTS = 5
const DEFAULT_ORIGINS = ['dsh-app://app', 'http://127.0.0.1:3080', 'http://localhost:3080']
const GIT_TIMEOUT_MS = 10000
// Every command here only reads. Optional locks off: `git status` would otherwise take the index lock to
// refresh it, and a poll landing during the user's own commit fails that commit with "index.lock exists".
// No prompts: nothing here may stop to ask for credentials. No system-wide config, and no external diff
// program or pager from the environment either.
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' }
delete GIT_ENV.GIT_EXTERNAL_DIFF
delete GIT_ENV.GIT_PAGER
/**
 * Settings given to every git call. Command-line settings win over the repository's own config, and each
 * of these switches off a way that config could start a program: the fsmonitor hook, hooks, the pager
 * and an external diff command.
 */
const SAFE_CONFIG = ['core.quotepath=off', 'core.fsmonitor=false', 'core.hooksPath=/dev/null', 'core.pager=cat', 'diff.external=', 'log.showSignature=false']
/** Added to every `git diff`: no per-file diff drivers (diff.<driver>.command) and no textconv programs. */
const SAFE_DIFF = ['--no-ext-diff', '--no-textconv']
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const MAX_DIFF_CHARS = 400000
const MAX_FILES = 500
/** Untracked files whose lines are counted (one git process each); the rest are listed without counts. */
const MAX_COUNTED_UNTRACKED = 100
const KEY_HEADER = 'x-hs-helper-key'
const MAX_RESULT_BYTES = 2000000

/** Error with an HTTP status for the response. */
const httpError = (status, message) => Object.assign(new Error(message), { status })

/** The `/hello` proof for a nonce: binds the secret to this port, so a relay on another port fails. */
export function helloProof(secret, port, nonce) {
  return createHmac('sha256', secret).update(`hello:${port}:${nonce}`).digest('hex')
}

/** Whether a request carries this launch's secret (constant-time comparison). */
function hasKey(request, secret) {
  const given = request.headers[KEY_HEADER]
  if (typeof given !== 'string' || !/^[0-9a-f]{64}$/.test(given)) return false
  const bytes = Buffer.from(given, 'hex')
  return bytes.length === secret.length && timingSafeEqual(bytes, secret)
}

/**
 * Read a JSON request body of at most MAX_RESULT_BYTES. Chunks are kept as bytes and decoded once, so a
 * character split across two chunks stays whole, and the limit counts bytes rather than characters.
 */
function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let refused = false
    request.on('data', (chunk) => {
      if (refused) return
      size += chunk.length
      if (size > MAX_RESULT_BYTES) {
        // Refuse now but keep reading and dropping the rest, so the client can finish sending, receive
        // the refusal and use the connection again.
        refused = true
        chunks.length = 0
        reject(httpError(413, 'too large'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (refused) return
      try { resolve(JSON.parse(Buffer.concat(chunks, size).toString('utf8'))) } catch { reject(httpError(400, 'body must be JSON')) }
    })
    request.on('error', reject)
  })
}

/**
 * Run one git command in `cwd`, with SAFE_CONFIG ahead of the arguments.
 * @param {string} cwd - working directory.
 * @param {string[]} args - git arguments.
 * @param {{ config?: string[], signal?: AbortSignal, exitOne?: boolean }} [options] - `config`: more
 *   `name=value` settings (the filter overrides); `signal` kills the process when aborted; `exitOne`
 *   accepts exit status 1 (commands that use it for "nothing found").
 * @returns {Promise<string>} stdout.
 */
function git(cwd, args, { config = [], signal, exitOne = false } = {}) {
  const settings = [...SAFE_CONFIG, ...config].flatMap(setting => ['-c', setting])
  return new Promise((resolve, reject) => {
    execFile('git', [...settings, ...args], { cwd, env: GIT_ENV, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8', signal },
      (error, stdout, stderr) => {
        // `git diff --no-index` exits 1 when the files differ, which is the normal case here.
        if (error && !(error.code === 1 && (exitOne || args.includes('--no-index')))) reject(new Error((stderr || error.message).trim()))
        else resolve(stdout)
      })
  })
}

/**
 * Settings that blank every filter driver the repository configures. A `.gitattributes` line such as
 * `* filter=x` makes status and diff run `filter.x.clean` on work-tree files, so each configured driver's
 * clean, smudge and process commands are set to empty (git then runs nothing) and marked not required.
 * Reading config runs nothing. A driver name that `-c` cannot express (one containing "=") is refused.
 * Read again for every request, so a driver added since the last poll is covered too.
 * @param {string} cwd - directory inside the repository.
 * @param {AbortSignal} [signal]
 * @returns {Promise<string[]>} `name=value` settings for git's `config` option.
 */
async function filterOverrides(cwd, signal) {
  // Exit status 1: no filter is configured.
  const out = await git(cwd, ['config', '-z', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$'], { signal, exitOne: true })
  const names = new Set()
  // With -z each entry is "<key>\n<value>".
  for (const entry of out.split('\0')) {
    const match = /^filter\.(.+)\.(?:clean|smudge|process)$/s.exec(entry.split('\n')[0])
    if (match) names.add(match[1])
  }
  const settings = []
  for (const name of names) {
    if (name.includes('=')) throw new Error(`the repository configures a filter that cannot be safely skipped ("${name}")`)
    settings.push(`filter.${name}.clean=`, `filter.${name}.smudge=`, `filter.${name}.process=`, `filter.${name}.required=false`)
  }
  return settings
}

/**
 * Validate the requested working directory: absolute and an existing directory.
 * @param {string | null} cwd - from the query string.
 * @returns {Promise<string>} the normalized directory.
 */
async function directory(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw Object.assign(new Error('cwd must be an absolute path'), { status: 400 })
  const resolved = path.resolve(cwd)
  const info = await stat(resolved).catch(() => undefined)
  if (info === undefined || !info.isDirectory()) throw Object.assign(new Error('cwd is not a directory'), { status: 400 })
  return resolved
}

/** Parse `git status --porcelain=v1 -z` into { path, status }. */
function parseStatus(output) {
  const parts = output.split('\0')
  const files = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry.length < 4) continue
    const code = entry.slice(0, 2)
    const file = entry.slice(3)
    // Renames and copies carry the original path as the next NUL-separated field.
    if (code[0] === 'R' || code[0] === 'C') i++
    const status = code === '??' ? 'untracked' : code.includes('D') ? 'deleted' : code.includes('A') ? 'added' : code[0] === 'R' ? 'renamed' : 'modified'
    files.push({ path: file, status })
  }
  return files
}

/** Parse `git diff --numstat -z` into a map of path → { added, deleted } (binary files have null counts). */
function parseNumstat(output) {
  const counts = new Map()
  const parts = output.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]
    if (line === '') continue
    const [added, deleted, file] = line.split('\t')
    // A rename prints an empty path and then the old and new paths as separate fields.
    const target = file === '' ? parts[i + 2] : file
    if (file === '') i += 2
    counts.set(target, { added: added === '-' ? null : Number(added), deleted: deleted === '-' ? null : Number(deleted) })
  }
  return counts
}

/** Count lines in an untracked text file (its whole content is an addition). */
async function untrackedLines(root, file, options) {
  const out = await git(root, ['diff', ...SAFE_DIFF, '--no-index', '--numstat', '--', '/dev/null', file], options).catch(() => '')
  const [added] = out.split('\t')
  return added === '-' || added === undefined || added === '' ? null : Number(added)
}

async function status(cwd, signal) {
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'], { signal }).catch(() => '')
  if (inside.trim() !== 'true') return { repo: false, cwd }
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'], { signal })).trim()
  const options = { signal, config: await filterOverrides(root, signal) }
  const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], options).catch(() => 'HEAD')).trim()
  const hasHead = await git(root, ['rev-parse', '--verify', '-q', 'HEAD'], options).then(() => true, () => false)
  // Submodules count only by their recorded commit: looking inside one runs git under its own config.
  const files = parseStatus(await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=dirty'], options))
  const counts = hasHead ? parseNumstat(await git(root, ['diff', ...SAFE_DIFF, '--ignore-submodules=dirty', 'HEAD', '--numstat', '-z'], options)) : new Map()
  const listed = files.slice(0, MAX_FILES)
  let counted = 0
  for (const file of listed) {
    signal?.throwIfAborted()
    const count = counts.get(file.path)
    if (count) Object.assign(file, count)
    else if (file.status === 'untracked' || !hasHead) {
      // One git process per file, so past the cap a file is listed without a count (null, like a binary file).
      file.added = counted++ < MAX_COUNTED_UNTRACKED ? await untrackedLines(root, file.path, options) : null
      file.deleted = 0
    }
  }
  // Modification time and size, so the window reloads an open diff after an edit that keeps the line counts
  // (null for a deleted file). Read from the file system: no git process.
  await Promise.all(listed.map(async (file) => {
    const info = await lstat(path.join(root, file.path)).catch(() => undefined)
    file.mtime = info ? info.mtimeMs : null
    file.size = info ? info.size : null
  }))
  const totals = listed.reduce((sum, f) => ({ added: sum.added + (f.added ?? 0), deleted: sum.deleted + (f.deleted ?? 0) }), { added: 0, deleted: 0 })
  return { repo: true, cwd, root, folder: path.basename(root), branch, files: listed, fileCount: files.length, truncated: files.length > listed.length, totals }
}

/**
 * One status run per folder, shared by every request that arrives while it runs (two panes poll the same
 * folder every few seconds). Its git processes are killed once every request waiting on it has gone away.
 * @type {Map<string, { controller: AbortController, waiting: number, promise: Promise<object> }>}
 */
const statusRuns = new Map()

function sharedStatus(cwd, signal) {
  let run = statusRuns.get(cwd)
  if (run === undefined) {
    const controller = new AbortController()
    const created = { controller, waiting: 0, promise: undefined }
    created.promise = status(cwd, controller.signal).finally(() => { if (statusRuns.get(cwd) === created) statusRuns.delete(cwd) })
    // Settled through the waiters below; this keeps an abandoned run's rejection from going unhandled.
    created.promise.catch(() => {})
    statusRuns.set(cwd, run = created)
  }
  run.waiting++
  return new Promise((resolve, reject) => {
    let left = false
    const leave = () => {
      if (left) return false
      left = true
      signal?.removeEventListener('abort', onAbort)
      run.waiting--
      return true
    }
    const onAbort = () => {
      if (!leave()) return
      if (run.waiting === 0) { if (statusRuns.get(cwd) === run) statusRuns.delete(cwd); run.controller.abort() }
      reject(httpError(499, 'request closed'))
    }
    if (signal?.aborted) { onAbort(); return }
    signal?.addEventListener('abort', onAbort, { once: true })
    run.promise.then(value => { if (leave()) resolve(value) }, error => { if (leave()) reject(error) })
  })
}

async function diff(cwd, file, signal) {
  if (typeof file !== 'string' || file === '' || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
    throw Object.assign(new Error('path must be a repository-relative file'), { status: 400 })
  }
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'], { signal })).trim()
  const options = { signal, config: await filterOverrides(root, signal) }
  const tracked = await git(root, ['ls-files', '--error-unmatch', '--', file], options).then(() => true, () => false)
  const hasHead = await git(root, ['rev-parse', '--verify', '-q', 'HEAD'], options).then(() => true, () => false)
  let text = tracked && hasHead
    ? await git(root, ['diff', ...SAFE_DIFF, '--ignore-submodules=dirty', 'HEAD', '--no-color', '--', file], options)
    : await git(root, ['diff', ...SAFE_DIFF, '--no-index', '--no-color', '--', '/dev/null', file], options)
  const truncated = text.length > MAX_DIFF_CHARS
  if (truncated) text = text.slice(0, MAX_DIFF_CHARS)
  return { path: file, diff: text, truncated }
}

const MAX_LIST_FILES = 20000
const MAX_SEARCH_RESULTS = 300

/** Every file git knows in the folder (tracked plus untracked, minus ignored), relative to `cwd`. */
async function files(cwd, signal) {
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'], { signal }).catch(() => '')
  if (inside.trim() !== 'true') return { repo: false, files: [] }
  const out = await git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { signal, config: await filterOverrides(cwd, signal) })
  const all = [...new Set(out.split('\0').filter(Boolean))]
  return { repo: true, files: all.slice(0, MAX_LIST_FILES), truncated: all.length > MAX_LIST_FILES }
}

/** Case-insensitive fixed-string search of text files (tracked and untracked), relative to `cwd`. */
async function search(cwd, query, signal) {
  if (typeof query !== 'string' || query.trim() === '') return { results: [] }
  if (query.length > 200) throw Object.assign(new Error('query too long'), { status: 400 })
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'], { signal }).catch(() => '')
  if (inside.trim() !== 'true') return { repo: false, results: [] }
  // git grep exits 1 when nothing matches.
  const out = await git(cwd, ['grep', '--no-textconv', '-n', '-I', '-i', '-F', '--untracked', '--max-count=20', '-e', query, '--', '.'],
    { signal, exitOne: true, config: await filterOverrides(cwd, signal) })
  const results = []
  for (const line of out.split('\n')) {
    if (results.length >= MAX_SEARCH_RESULTS) break
    const match = /^(.*?):(\d+):(.*)$/.exec(line)
    if (match) results.push({ path: match[1], line: Number(match[2]), text: match[3].slice(0, 300) })
  }
  return { repo: true, results, truncated: results.length >= MAX_SEARCH_RESULTS }
}

// ---- history: the Git page ---------------------------------------------------------------------------
const COMMIT_ID = /^[0-9a-f]{7,64}$/
const LOG_PAGE = 100
const MAX_SKIP = 100000
const MAX_COMMIT_FILES = 2000
const MAX_BLAME_LINES = 20000
const MAX_BODY_CHARS = 20000
/** Separates fields in git's --format output (a control character that never appears in them). */
const FS = '\x1f'

function commitId(value) {
  if (typeof value !== 'string' || !COMMIT_ID.test(value)) throw httpError(400, 'hash must be a commit id (hexadecimal)')
  return value
}

function repoPath(file) {
  if (typeof file !== 'string' || file === '' || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) throw httpError(400, 'path must be a repository-relative file')
  return file
}

/** The repository root containing `cwd` with the call options (filters blanked), or undefined outside one. */
async function repository(cwd, signal) {
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'], { signal }).catch(() => '')
  if (inside.trim() !== 'true') return undefined
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'], { signal })).trim()
  return { root, options: { signal, config: await filterOverrides(root, signal) } }
}

const hasHead = (repo) => git(repo.root, ['rev-parse', '--verify', '-q', 'HEAD'], repo.options).then(() => true, () => false)

/** Branch, upstream, commits ahead and behind it (as git last saw it; nothing is fetched), uncommitted files and the last commit. */
async function overview(cwd, signal) {
  const repo = await repository(cwd, signal)
  if (repo === undefined) return { repo: false, cwd }
  const out = await git(repo.root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal', '--ignore-submodules=dirty'], repo.options)
  const result = { repo: true, cwd, root: repo.root, branch: null, upstream: null, ahead: 0, behind: 0, changed: 0, last: null }
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry.startsWith('# branch.head ')) result.branch = entry.slice(14)
    else if (entry.startsWith('# branch.upstream ')) result.upstream = entry.slice(18)
    else if (entry.startsWith('# branch.ab ')) {
      const match = /^\+(\d+) -(\d+)$/.exec(entry.slice(12))
      if (match) { result.ahead = Number(match[1]); result.behind = Number(match[2]) }
    } else if (/^[12u?] /.test(entry)) {
      result.changed++
      if (entry.startsWith('2 ')) i++ // a rename's original path is the next field
    }
  }
  if (await hasHead(repo)) {
    const [hash, subject, time] = (await git(repo.root, ['log', '-1', '--no-color', `--format=%h${FS}%s${FS}%at`, 'HEAD', '--'], repo.options)).replace(/\n$/, '').split(FS)
    result.last = { hash, subject, time: Number(time) * 1000 }
  }
  return result
}

/** Parse commits printed with LOG_FORMAT and -z. */
const LOG_FORMAT = ['%H', '%h', '%P', '%an', '%ae', '%at', '%D', '%s'].join(FS)
function parseLog(out) {
  return out.split('\0').map(record => record.replace(/^\n/, '')).filter(Boolean).map((record) => {
    const [hash, short, parents, author, email, time, refs, subject] = record.split(FS)
    return { hash, short, parents: parents ? parents.split(' ') : [], author, email, time: Number(time) * 1000, refs: refs ? refs.split(', ') : [], subject }
  })
}

/**
 * One page of commits, newest first: the current branch, or every branch with `all`. A search keeps the
 * commits whose message or author contains the text (ignoring case), or whose changes add or remove it.
 */
async function log(cwd, query, signal) {
  const repo = await repository(cwd, signal)
  if (repo === undefined) return { repo: false, commits: [], more: false }
  if (!(await hasHead(repo))) return { repo: true, commits: [], more: false }
  const skip = Math.min(Math.max(0, Number.parseInt(query.get('skip') ?? '0', 10) || 0), MAX_SKIP)
  const args = ['log', '--no-color', '-z', '--topo-order', `--format=${LOG_FORMAT}`, `--max-count=${LOG_PAGE + 1}`, `--skip=${skip}`]
  const text = query.get('q')
  if (typeof text === 'string' && text.trim() !== '') {
    if (text.length > 200) throw httpError(400, 'search too long')
    const by = query.get('by') ?? 'message'
    if (by === 'message') args.push('--regexp-ignore-case', '--fixed-strings', `--grep=${text}`)
    else if (by === 'author') args.push('--regexp-ignore-case', '--fixed-strings', `--author=${text}`)
    else if (by === 'code') args.push(...SAFE_DIFF, `-S${text}`)
    else throw httpError(400, 'by must be message, author or code')
  }
  args.push(query.get('all') === '1' ? '--all' : 'HEAD', '--')
  const commits = parseLog(await git(repo.root, args, repo.options))
  return { repo: true, commits: commits.slice(0, LOG_PAGE), more: commits.length > LOG_PAGE, skip }
}

/** A commit's first parent, or undefined for a root commit. */
async function firstParent(repo, hash) {
  const line = (await git(repo.root, ['rev-list', '--parents', '-n', '1', hash, '--'], repo.options)).trim()
  return line.split(' ')[1]
}

/** A commit's details and the files it changed against its first parent, with line counts. */
async function commit(cwd, hash, signal) {
  commitId(hash)
  const repo = await repository(cwd, signal)
  if (repo === undefined) throw httpError(400, 'not a git repository')
  const meta = await git(repo.root, ['show', '-s', '--no-color', `--format=%H${FS}%h${FS}%P${FS}%an${FS}%ae${FS}%at${FS}%cn${FS}%ct${FS}%D${FS}%B`, hash, '--'], repo.options)
  const [full, short, parents, author, email, time, committer, committed, refs, ...body] = meta.split(FS)
  const parentList = parents ? parents.split(' ') : []
  const range = parentList.length ? [parentList[0], full] : ['--root', full]
  const counts = parseNumstat(await git(repo.root, ['diff-tree', '-r', '-z', '-M', ...SAFE_DIFF, '--numstat', ...range], repo.options))
  const names = (await git(repo.root, ['diff-tree', '-r', '-z', '-M', ...SAFE_DIFF, '--name-status', ...range], repo.options)).split('\0')
  const files = []
  for (let i = 0; i < names.length; i++) {
    const code = names[i]
    if (!/^[A-Z]/.test(code)) continue
    const renamed = code[0] === 'R' || code[0] === 'C'
    const file = renamed ? names[i + 2] : names[i + 1]
    const from = renamed ? names[i + 1] : undefined
    i += renamed ? 2 : 1
    if (files.length >= MAX_COMMIT_FILES) continue
    const status = code[0] === 'A' ? 'added' : code[0] === 'D' ? 'deleted' : renamed ? 'renamed' : 'modified'
    files.push({ path: file, ...(from ? { from } : {}), status, ...(counts.get(file) ?? { added: null, deleted: null }) })
  }
  const message = body.join(FS).replace(/\n+$/, '')
  return {
    hash: full, short, parents: parentList, author, email, time: Number(time) * 1000, committer, committed: Number(committed) * 1000,
    refs: refs ? refs.split(', ') : [], message: message.slice(0, MAX_BODY_CHARS), files, truncated: files.length >= MAX_COMMIT_FILES,
  }
}

/** One file's diff in a commit, against the commit's first parent. */
async function commitDiff(cwd, hash, file, signal) {
  commitId(hash)
  repoPath(file)
  const repo = await repository(cwd, signal)
  if (repo === undefined) throw httpError(400, 'not a git repository')
  const parent = await firstParent(repo, hash)
  let text = parent
    ? await git(repo.root, ['diff', ...SAFE_DIFF, '--no-color', parent, hash, '--', file], repo.options)
    : await git(repo.root, ['show', ...SAFE_DIFF, '--no-color', '--format=', hash, '--', file], repo.options)
  const truncated = text.length > MAX_DIFF_CHARS
  if (truncated) text = text.slice(0, MAX_DIFF_CHARS)
  return { path: file, diff: text, truncated }
}

/** Who last changed each line of a file as it was at a commit (git blame --porcelain). */
async function blame(cwd, hash, file, signal) {
  commitId(hash)
  repoPath(file)
  const repo = await repository(cwd, signal)
  if (repo === undefined) throw httpError(400, 'not a git repository')
  const out = await git(repo.root, ['blame', '--porcelain', '--no-textconv', hash, '--', file], repo.options)
  const commits = {}
  const lines = []
  let current
  for (const line of out.split('\n')) {
    if (line.startsWith('\t')) {
      if (lines.length < MAX_BLAME_LINES) lines.push({ hash: current, text: line.slice(1) })
      continue
    }
    const header = /^([0-9a-f]{40,64}) \d+ \d+/.exec(line)
    if (header) { current = header[1]; commits[current] ??= {}; continue }
    const space = line.indexOf(' ')
    const key = space === -1 ? line : line.slice(0, space)
    const value = space === -1 ? '' : line.slice(space + 1)
    if (current === undefined) continue
    if (key === 'author') commits[current].author = value
    else if (key === 'author-time') commits[current].time = Number(value) * 1000
    else if (key === 'summary') commits[current].summary = value
  }
  return { path: file, hash, lines, commits, truncated: lines.length >= MAX_BLAME_LINES }
}

/** The local branches, newest commit first, with which one is checked out here and which in another worktree. */
async function branches(cwd, signal) {
  const repo = await repository(cwd, signal)
  if (repo === undefined) return { repo: false, branches: [] }
  const format = ['%(refname:short)', '%(HEAD)', '%(worktreepath)', '%(upstream:short)', '%(upstream:track,nobracket)', '%(committerdate:unix)', '%(contents:subject)'].join(FS)
  const out = await git(repo.root, ['for-each-ref', '--sort=-committerdate', `--format=${format}`, 'refs/heads/'], repo.options)
  const realRoot = await realpath(repo.root).catch(() => repo.root)
  const list = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [name, head, worktree, upstream, track, time, subject] = line.split(FS)
    const elsewhere = worktree && head !== '*' && path.resolve(worktree) !== realRoot && path.resolve(worktree) !== repo.root ? worktree : null
    list.push({ name, current: head === '*', elsewhere, upstream: upstream || null, track: track || null, time: Number(time) * 1000, subject })
  }
  return { repo: true, root: repo.root, current: list.find(b => b.current)?.name ?? null, branches: list }
}

/**
 * Whether a checkout here would need a content filter: a filter driver is configured (in any git config,
 * Git LFS adds one globally) and the repository asks for one in an attributes file, on the current branch,
 * on `branch`, or in its own info/attributes.
 */
async function usesFilters(repo, branch) {
  if (repo.options.config.length === 0) return false
  const named = await git(repo.root, ['grep', '-l', '-I', '-e', 'filter=', 'HEAD', branch, '--', ':(glob)**/.gitattributes'], { ...repo.options, exitOne: true })
  if (named.trim() !== '') return true
  const info = (await git(repo.root, ['rev-parse', '--git-path', 'info/attributes'], repo.options)).trim()
  const text = await readFile(path.resolve(repo.root, info), 'utf8').catch(() => '')
  return /filter=/.test(text)
}

/** Switch the work tree to another local branch; refused while anything is uncommitted or filters are configured. */
async function switchBranch(cwd, branch) {
  if (typeof branch !== 'string' || branch === '' || branch.startsWith('-') || branch.length > 250) throw httpError(400, 'branch must be a local branch name')
  const repo = await repository(cwd)
  if (repo === undefined) throw httpError(400, 'not a git repository')
  const { branches: list } = await branches(cwd)
  const target = list.find(b => b.name === branch)
  if (!target) throw httpError(400, `There is no local branch named "${branch}"`)
  if (await usesFilters(repo, branch)) {
    throw httpError(409, 'This repository uses content filters (such as Git LFS or git-crypt), which Harness Studio keeps switched off, so it does not switch branches here. Switch from a terminal or ask the agent.')
  }
  if (target.current) return { switched: false, branch }
  if (target.elsewhere) throw httpError(409, `"${branch}" is checked out in another worktree (${target.elsewhere}), so git will not check it out here too.`)
  const changed = (await git(repo.root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules=dirty'], repo.options)).split('\0').filter(Boolean).length
  if (changed > 0) {
    throw httpError(409, `${changed.toLocaleString()} uncommitted ${changed === 1 ? 'file' : 'files'} here. Commit, stash or discard ${changed === 1 ? 'it' : 'them'} first, so switching cannot carry ${changed === 1 ? 'it' : 'them'} to another branch or lose ${changed === 1 ? 'it' : 'them'}.`)
  }
  // No abort signal: a switch stopped part-way would leave a half-switched work tree.
  await git(repo.root, ['switch', '--no-guess', branch], repo.options)
  return { switched: true, branch }
}

/**
 * Start the helper on the first free port in [BASE_PORT, BASE_PORT + PORT_ATTEMPTS).
 * @param {{ secret: Buffer, origins?: string[], browser?: object, log?: (message: string) => void }} options
 *   `secret` is required: every request but /hello must carry it.
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export async function startGitHelper(options) {
  const secret = options?.secret
  if (!Buffer.isBuffer(secret) || secret.length !== 32) throw new Error('startGitHelper needs a 32-byte secret')
  const origins = new Set(options.origins ?? DEFAULT_ORIGINS)
  let port
  const browserRoute = async (request, response, url, send) => {
    if (url.pathname === '/browser/next' && request.method === 'GET') {
      const session = url.searchParams.get('session')
      if (!session || session.length > 200) return send(400, { error: 'session is required' })
      let closed = false
      response.on('close', () => { closed = true })
      const command = await options.browser.next(session, cancel => response.on('close', cancel))
      // The window went away while the command was on its way: give it to the next poll.
      if (closed || response.writableEnded || response.destroyed) { if (command) options.browser.requeue(session, command); return }
      return send(200, { command })
    }
    if (url.pathname === '/browser/result' && request.method === 'POST') {
      if (!(request.headers['content-type'] ?? '').startsWith('application/json')) return send(415, { error: 'JSON only' })
      const parsed = await readJson(request)
      const valid = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        && (typeof parsed.id === 'string' || typeof parsed.id === 'number') && typeof parsed.ok === 'boolean'
        && typeof parsed.session === 'string'
      if (!valid) return send(400, { error: 'body must be { session, id, ok, value | error }' })
      return send(200, { accepted: options.browser.result(parsed) })
    }
    return send(404, { error: 'not found' })
  }
  const handle = async (request, response) => {
    const origin = request.headers.origin
    const allowed = typeof origin === 'string' && origins.has(origin)
    const send = (status, body) => {
      if (response.headersSent || response.destroyed) return
      const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Origin' }
      if (allowed) headers['access-control-allow-origin'] = origin
      response.writeHead(status, headers)
      response.end(JSON.stringify(body))
    }
    if (!allowed) return send(403, { error: 'origin not allowed' })
    if (request.method === 'OPTIONS') {
      // The key header (and JSON bodies) make browsers ask first.
      response.writeHead(204, {
        'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers': `content-type, ${KEY_HEADER}`, 'access-control-max-age': '600', vary: 'Origin',
      })
      return response.end()
    }
    let url
    try { url = new URL(request.url ?? '/', 'http://127.0.0.1') } catch { return send(400, { error: 'bad request URL' }) }
    try {
      if (url.pathname === '/hello' && request.method === 'GET') {
        const nonce = url.searchParams.get('nonce')
        if (nonce === null || !/^[0-9a-f]{32,128}$/.test(nonce)) return send(400, { error: 'nonce must be 32-128 hex digits' })
        return send(200, { service: SERVICE, version: VERSION, proof: helloProof(secret, port, nonce) })
      }
      if (!hasKey(request, secret)) return send(401, { error: 'missing or wrong helper key' })
      if (options.browser && url.pathname.startsWith('/browser/')) return await browserRoute(request, response, url, send)
      if (url.pathname === '/switch' && request.method === 'POST') {
        if (!(request.headers['content-type'] ?? '').startsWith('application/json')) return send(415, { error: 'JSON only' })
        const body = await readJson(request)
        return send(200, await switchBranch(await directory(body?.cwd), body?.branch))
      }
      if (request.method !== 'GET') return send(405, { error: 'GET only' })
      // The window aborts a request it no longer needs (a newer poll, a closed pane): stop its git work.
      const aborted = new AbortController()
      response.on('close', () => { if (!response.writableEnded) aborted.abort() })
      const signal = aborted.signal
      const cwd = () => directory(url.searchParams.get('cwd'))
      if (url.pathname === '/status') return send(200, await sharedStatus(await cwd(), signal))
      if (url.pathname === '/diff') return send(200, await diff(await cwd(), url.searchParams.get('path'), signal))
      if (url.pathname === '/files') return send(200, await files(await cwd(), signal))
      if (url.pathname === '/search') return send(200, await search(await cwd(), url.searchParams.get('q'), signal))
      if (url.pathname === '/overview') return send(200, await overview(await cwd(), signal))
      if (url.pathname === '/log') return send(200, await log(await cwd(), url.searchParams, signal))
      if (url.pathname === '/commit') return send(200, await commit(await cwd(), url.searchParams.get('hash'), signal))
      if (url.pathname === '/commit-diff') return send(200, await commitDiff(await cwd(), url.searchParams.get('hash'), url.searchParams.get('path'), signal))
      if (url.pathname === '/branches') return send(200, await branches(await cwd(), signal))
      if (url.pathname === '/blame') return send(200, await blame(await cwd(), url.searchParams.get('hash'), url.searchParams.get('path'), signal))
      return send(404, { error: 'not found' })
    } catch (error) {
      return send(error?.status ?? 500, { error: String(error?.message ?? error) })
    }
  }
  const server = createServer((request, response) => {
    handle(request, response).catch(() => { if (!response.headersSent) { response.writeHead(500); response.end() } })
  })
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    const candidate = BASE_PORT + attempt
    const listening = await new Promise((resolve) => {
      const onError = () => resolve(false)
      server.once('error', onError)
      server.listen(candidate, '127.0.0.1', () => { server.off('error', onError); resolve(true) })
    })
    if (listening) {
      port = candidate
      options.log?.(`git helper listening on 127.0.0.1:${port}`)
      return { port, close: () => new Promise(resolve => server.close(() => resolve())) }
    }
  }
  throw new Error(`no free port in ${BASE_PORT}-${BASE_PORT + PORT_ATTEMPTS - 1}`)
}
