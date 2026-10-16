/**
 * Local git helper for the Changes and Details panes.
 *
 * Harness gives out-of-tree plugins no way to add Host functions the Client can call, and every
 * slash command is logged into the conversation, so a refreshing pane cannot use one. Instead the
 * Host half serves a tiny read-only HTTP endpoint on 127.0.0.1:
 *
 *   GET /hello?nonce=<hex>          → { service, version, proof }     (proves this launch's secret)
 *   GET /status?cwd=<abs dir>       → branch, changed files with line counts, totals
 *   GET /diff?cwd=<abs dir>&path=<repo-relative file> → that file's diff against HEAD
 *   GET /files?cwd=<abs dir>       → every non-ignored file in the folder (for the Files filter)
 *   GET /search?cwd=<abs dir>&q=<text> → matching lines in text files (the Files "?" search)
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
 *   - git is read-only: status, diff, ls-files, grep and rev-parse; output, diffs and results are size-capped;
 *   - the only write is POST /browser/result, which must be JSON (forcing a browser preflight that
 *     other origins fail) and can only settle a command this process issued.
 */
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { stat } from 'node:fs/promises'
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
// No prompts: nothing here may stop to ask for credentials.
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const MAX_DIFF_CHARS = 400000
const MAX_FILES = 500
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

/** Read a JSON request body of at most MAX_RESULT_BYTES. */
async function readJson(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > MAX_RESULT_BYTES) throw httpError(413, 'too large')
  }
  try { return JSON.parse(body) } catch { throw httpError(400, 'body must be JSON') }
}

/**
 * Run one git command in `cwd`.
 * @param {string} cwd - working directory.
 * @param {string[]} args - git arguments.
 * @returns {Promise<string>} stdout.
 */
function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=off', ...args], { cwd, env: GIT_ENV, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8' },
      (error, stdout, stderr) => {
        // `git diff --no-index` exits 1 when the files differ, which is the normal case here.
        if (error && !(error.code === 1 && args.includes('--no-index'))) reject(new Error((stderr || error.message).trim()))
        else resolve(stdout)
      })
  })
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
async function untrackedLines(root, file) {
  const out = await git(root, ['diff', '--no-index', '--numstat', '--', '/dev/null', file]).catch(() => '')
  const [added] = out.split('\t')
  return added === '-' || added === undefined || added === '' ? null : Number(added)
}

async function status(cwd) {
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree']).catch(() => '')
  if (inside.trim() !== 'true') return { repo: false, cwd }
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
  const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'HEAD')).trim()
  const hasHead = await git(root, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false)
  const files = parseStatus(await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']))
  const counts = hasHead ? parseNumstat(await git(root, ['diff', 'HEAD', '--numstat', '-z'])) : new Map()
  const listed = files.slice(0, MAX_FILES)
  for (const file of listed) {
    const count = counts.get(file.path)
    if (count) Object.assign(file, count)
    else if (file.status === 'untracked' || !hasHead) { file.added = await untrackedLines(root, file.path); file.deleted = 0 }
  }
  const totals = listed.reduce((sum, f) => ({ added: sum.added + (f.added ?? 0), deleted: sum.deleted + (f.deleted ?? 0) }), { added: 0, deleted: 0 })
  return { repo: true, cwd, root, folder: path.basename(root), branch, files: listed, fileCount: files.length, truncated: files.length > listed.length, totals }
}

async function diff(cwd, file) {
  if (typeof file !== 'string' || file === '' || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
    throw Object.assign(new Error('path must be a repository-relative file'), { status: 400 })
  }
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
  const tracked = await git(root, ['ls-files', '--error-unmatch', '--', file]).then(() => true, () => false)
  const hasHead = await git(root, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false)
  let text = tracked && hasHead
    ? await git(root, ['diff', 'HEAD', '--no-color', '--no-ext-diff', '--', file])
    : await git(root, ['diff', '--no-index', '--no-color', '--', '/dev/null', file])
  const truncated = text.length > MAX_DIFF_CHARS
  if (truncated) text = text.slice(0, MAX_DIFF_CHARS)
  return { path: file, diff: text, truncated }
}

const MAX_LIST_FILES = 20000
const MAX_SEARCH_RESULTS = 300

/** Every file git knows in the folder (tracked plus untracked, minus ignored), relative to `cwd`. */
async function files(cwd) {
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree']).catch(() => '')
  if (inside.trim() !== 'true') return { repo: false, files: [] }
  const out = await git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  const all = [...new Set(out.split('\0').filter(Boolean))]
  return { repo: true, files: all.slice(0, MAX_LIST_FILES), truncated: all.length > MAX_LIST_FILES }
}

/** Case-insensitive fixed-string search of text files (tracked and untracked), relative to `cwd`. */
async function search(cwd, query) {
  if (typeof query !== 'string' || query.trim() === '') return { results: [] }
  if (query.length > 200) throw Object.assign(new Error('query too long'), { status: 400 })
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree']).catch(() => '')
  if (inside.trim() !== 'true') return { repo: false, results: [] }
  const out = await new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=off', 'grep', '-n', '-I', '-i', '-F', '--untracked', '--max-count=20', '-e', query, '--', '.'],
      { cwd, env: GIT_ENV, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8' },
      // git grep exits 1 when nothing matches.
      (error, stdout, stderr) => (error && error.code !== 1 ? reject(new Error((stderr || error.message).trim())) : resolve(stdout || '')))
  })
  const results = []
  for (const line of out.split('\n')) {
    if (results.length >= MAX_SEARCH_RESULTS) break
    const match = /^(.*?):(\d+):(.*)$/.exec(line)
    if (match) results.push({ path: match[1], line: Number(match[2]), text: match[3].slice(0, 300) })
  }
  return { repo: true, results, truncated: results.length >= MAX_SEARCH_RESULTS }
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
      if (request.method !== 'GET') return send(405, { error: 'GET only' })
      if (url.pathname === '/status') return send(200, await status(await directory(url.searchParams.get('cwd'))))
      if (url.pathname === '/diff') return send(200, await diff(await directory(url.searchParams.get('cwd')), url.searchParams.get('path')))
      if (url.pathname === '/files') return send(200, await files(await directory(url.searchParams.get('cwd'))))
      if (url.pathname === '/search') return send(200, await search(await directory(url.searchParams.get('cwd')), url.searchParams.get('q')))
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
