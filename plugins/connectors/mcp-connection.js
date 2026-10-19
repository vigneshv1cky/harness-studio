/**
 * One MCP server connection, owned by the Connectors plugin instead of Harness's built-in client so
 * its state can be observed (status, error, tools) and its HTTP requests can carry OAuth tokens.
 *
 * Transports:
 *   - stdio: a child process speaking newline-delimited JSON-RPC on stdin/stdout;
 *   - Streamable HTTP (MCP 2025-03-26 and later): JSON-RPC POSTs answered with JSON or an SSE stream,
 *     plus an optional GET stream for server notifications;
 *   - legacy HTTP+SSE (MCP 2024-11-05): a GET event stream that names a POST endpoint. Used when the
 *     URL ends in `/sse`, or when a Streamable HTTP initialize is refused with 404/405.
 *
 * A stdio server gets only a small allowlist of Harness's environment (see `serverEnv`) plus the
 * connector's own variables. On Windows a `.cmd`/`.bat` command (npx, …) runs through cmd.exe with
 * every argument quoted and escaped, an `.exe` runs directly, and stopping kills the whole process
 * tree. The legacy SSE transport only posts to a message endpoint on the server's own origin.
 *
 * Status: disabled → connecting → connected | needs-auth | failed. A failed connection retries with
 * exponential backoff a few times, then stays failed until `restart()`. `needs-auth` never retries:
 * it waits for a sign-in.
 */
import { execFile, spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import path from 'node:path'

export const PROTOCOL_VERSION = '2025-06-18'
const SUPPORTED_VERSIONS = new Set(['2025-06-18', '2025-03-26', '2024-11-05'])
const CLIENT_INFO = { name: 'harness-studio-connectors', title: 'Harness Studio Connectors', version: '0.1.0' }
const REQUEST_TIMEOUT_MS = 30000
const STDERR_TAIL_CHARS = 4000
const RETRY_DELAYS_MS = [1000, 3000, 10000, 30000]
/**
 * The most a server can make Harness hold for one message: a JSON body (bytes), or one SSE event's data,
 * one SSE line or one stdio line (characters). A line carries a whole message in both transports, so it
 * shares the cap. Past it, the request fails (a body, a POST's event stream) or the connection does
 * (a stdio line, the legacy event stream).
 */
const MAX_MESSAGE_SIZE = 16 * 1024 * 1024
const MAX_ERROR_BODY = 64 * 1024

/** The server (or its authorization server) wants a bearer token we do not have or that was refused. */
export class AuthRequiredError extends Error {
  /** @param {string | null} wwwAuthenticate - the response's WWW-Authenticate header, if any. */
  constructor(wwwAuthenticate) {
    super('The server requires sign-in')
    this.name = 'AuthRequiredError'
    this.wwwAuthenticate = wwwAuthenticate
  }
}

/** HTTP status error that is not an authorization problem. */
class HttpStatusError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}${body ? ': ' + body.slice(0, 300) : ''}`)
    this.status = status
  }
}

/** A server sent more than MAX_MESSAGE_SIZE for one message or line. */
class TooLargeError extends Error {
  constructor() {
    super(`The server sent a message larger than ${MAX_MESSAGE_SIZE / 1024 / 1024} MB; Harness stopped reading it.`)
    this.name = 'TooLargeError'
  }
}

/**
 * Split text that arrives in chunks into lines (LF or CRLF). Only each new chunk is searched for a line
 * end, so a long line is not rescanned as it grows. A line longer than `maxChars` throws TooLargeError.
 * @param {number} maxChars @param {(line: string) => void} onLine
 * @returns {(text: string) => void} feeds one chunk.
 */
function lineSplitter(maxChars, onLine) {
  let pieces = []
  let size = 0
  return (text) => {
    let start = 0
    let newline
    while ((newline = text.indexOf('\n', start)) !== -1) {
      if (size + newline - start > maxChars) throw new TooLargeError()
      pieces.push(text.slice(start, newline))
      const line = pieces.length === 1 ? pieces[0] : pieces.join('')
      pieces = []
      size = 0
      start = newline + 1
      onLine(line.endsWith('\r') ? line.slice(0, -1) : line)
    }
    if (start < text.length) {
      size += text.length - start
      if (size > maxChars) throw new TooLargeError()
      pieces.push(text.slice(start))
    }
  }
}

/**
 * Parse an SSE byte stream into events. A line, or one event's data, past MAX_MESSAGE_SIZE rejects
 * with TooLargeError.
 * @param {ReadableStream<Uint8Array>} body
 * @param {(event: { event: string, data: string }) => void} onEvent
 * @returns {Promise<void>} resolves when the stream ends.
 */
async function readSse(body, onEvent) {
  const decoder = new TextDecoder()
  let event = 'message'
  let data = []
  let dataSize = 0
  const dispatch = () => {
    if (data.length > 0) onEvent({ event, data: data.join('\n') })
    event = 'message'
    data = []
    dataSize = 0
  }
  const feed = lineSplitter(MAX_MESSAGE_SIZE, (line) => {
    if (line === '') { dispatch(); return }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') {
      dataSize += value.length + 1
      if (dataSize > MAX_MESSAGE_SIZE) throw new TooLargeError()
      data.push(value)
    }
  })
  for await (const chunk of body) feed(decoder.decode(chunk, { stream: true }))
  dispatch()
}

/**
 * A response body as text, refused past `maxBytes`: first by its Content-Length, then as it arrives
 * (leaving the loop early cancels the rest of the body).
 * @param {Response} response @param {number} [maxBytes]
 */
async function boundedText(response, maxBytes = MAX_MESSAGE_SIZE) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw new TooLargeError()
  }
  if (!response.body) return ''
  const decoder = new TextDecoder()
  const parts = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > maxBytes) throw new TooLargeError()
    parts.push(decoder.decode(chunk, { stream: true }))
  }
  parts.push(decoder.decode())
  return parts.join('')
}

/** The start of an error response's body, for the error message; the rest of a large one is not read. */
async function errorBody(response) {
  const decoder = new TextDecoder()
  let text = ''
  try {
    for await (const chunk of response.body ?? []) {
      text += decoder.decode(chunk, { stream: true })
      if (text.length >= MAX_ERROR_BODY) break
    }
  } catch { /* the message is optional */ }
  return text
}

/** Parse a JSON-RPC payload that may be one message or a batch. */
function messagesOf(text) {
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : [parsed]
}

/** Variables a stdio server inherits from Harness; everything else must be set on the connector. */
const POSIX_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'TMPDIR', 'LANG']
const WINDOWS_ENV = ['PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'USERNAME',
  'USERDOMAIN', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432',
  'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'LANG']

/**
 * The environment for a stdio server: the allowlist above and `LC_*` from Harness's own environment,
 * then the connector's variables on top. Windows names compare case-insensitively.
 * @param {Record<string,string>} own - the connector's environment.
 * @param {NodeJS.ProcessEnv} [from] @param {string} [platform]
 */
export function serverEnv(own = {}, from = process.env, platform = process.platform) {
  const windows = platform === 'win32'
  const allowed = new Set((windows ? WINDOWS_ENV : POSIX_ENV).map(name => (windows ? name.toUpperCase() : name)))
  const env = {}
  for (const [name, value] of Object.entries(from)) {
    if (value === undefined) continue
    const key = windows ? name.toUpperCase() : name
    if (allowed.has(key) || /^LC_/.test(key)) env[name] = value
  }
  return { ...env, ...own }
}

// ---- Windows command lines (the same rules as the cross-spawn package) ----------------------------
const CMD_META = /([()\][%!^"`<>&|;, *?])/g

/** Quote one argument for CreateProcess, then escape cmd.exe's metacharacters. */
function cmdArgument(arg, doubleEscape) {
  let quoted = String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')
  quoted = `"${quoted}"`.replace(CMD_META, '^$1')
  return doubleEscape ? quoted.replace(CMD_META, '^$1') : quoted
}

/** Windows environment names are case-insensitive. */
const envValue = (env, name) => Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1]

/** Find a command on PATH with PATHEXT, as cmd.exe would; undefined when it is not found. */
function whichWindows(command, env, cwd) {
  const base = cwd || process.cwd()
  const extensions = (envValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  const hasExt = path.extname(command) !== ''
  const names = hasExt ? [command] : [command, ...extensions.map(ext => command + ext)]
  const dirs = /[\\/]/.test(command) ? [base] : [base, ...String(envValue(env, 'PATH') ?? '').split(';').filter(Boolean)]
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.win32.resolve(dir, name)
      try { if (statSync(candidate).isFile()) return candidate } catch { /* keep looking */ }
    }
  }
  return undefined
}

/**
 * How to start `command args` on Windows without a shell interpreting the arguments: an `.exe` (or
 * `.com`) runs directly; anything else (`npx.cmd`, a `.bat`) runs as `cmd.exe /d /s /c "<line>"`
 * with each argument quoted and its metacharacters escaped, and `windowsVerbatimArguments` so Node
 * adds no quoting of its own.
 */
export function windowsSpawn(command, args, env, cwd) {
  const resolved = whichWindows(command, env, cwd)
  if (resolved && /\.(exe|com)$/i.test(resolved)) return { file: resolved, args, options: {} }
  const doubleEscape = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(resolved ?? '')
  const line = [path.win32.normalize(resolved ?? command).replace(CMD_META, '^$1'), ...args.map(a => cmdArgument(a, doubleEscape))].join(' ')
  return { file: envValue(env, 'COMSPEC') ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true } }
}

/** stdio transport: one child process. */
/**
 * Send `signal` to a POSIX server's whole process group (it leads one, see StdioTransport.start), so
 * whatever it started goes too: an npx or shell wrapper runs the real server as its child. Falls back
 * to the one process when the group is already gone.
 */
function signalGroup(child, signal) {
  try { process.kill(-child.pid, signal) } catch { try { child.kill(signal) } catch { /* already gone */ } }
}

// POSIX servers still running, ended as a group if the Host exits without stopping them (a crash
// skips this; then each server sees its input close and is expected to exit on its own).
const liveGroups = new Set()
let exitHookInstalled = false
function trackGroup(child) {
  liveGroups.add(child)
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.once('exit', () => { for (const live of liveGroups) signalGroup(live, 'SIGKILL') })
}

export class StdioTransport {
  /** @param {{ command: string, args?: string[], env?: Record<string,string>, cwd?: string }} spec */
  constructor(spec) {
    this.spec = spec
    this.stderr = ''
  }

  start(onMessage, onClose) {
    const { command, args = [], env = {}, cwd } = this.spec
    const childEnv = serverEnv(env)
    // POSIX: the server leads its own process group, so stopping it ends everything it started.
    const launch = process.platform === 'win32' ? windowsSpawn(command, args, childEnv, cwd) : { file: command, args, options: { detached: true } }
    this.child = spawn(launch.file, launch.args, {
      cwd: cwd || undefined,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...launch.options,
    })
    if (process.platform !== 'win32' && this.child.pid) trackGroup(this.child)
    let closed = false
    const close = (error) => { if (!closed) { closed = true; onClose(error) } }
    let overflowed = false
    const feed = lineSplitter(MAX_MESSAGE_SIZE, (raw) => {
      const line = raw.trim()
      if (line === '') return
      try { for (const message of messagesOf(line)) onMessage(message) } catch { /* a non-JSON line is server log noise on stdout; ignore it */ }
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => {
      if (overflowed) return
      try { feed(chunk) } catch (error) {
        // A line past the cap is not buffered without end: the server is stopped and the connection fails.
        overflowed = true
        close(error)
        this.close()
      }
    })
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk) => { this.stderr = (this.stderr + chunk).slice(-STDERR_TAIL_CHARS) })
    this.child.on('error', error => close(new Error(error.code === 'ENOENT' ? `Command not found: ${command}` : error.message)))
    const child = this.child
    this.child.on('exit', (code, signal) => {
      // A server that exits on its own may leave what it started; that goes with it.
      if (process.platform !== 'win32') { signalGroup(child, 'SIGTERM'); liveGroups.delete(child) }
      const tail = this.stderr.trim().split('\n').slice(-3).join('\n')
      close(new Error(`The server process exited (${signal ?? 'code ' + code})${tail ? ': ' + tail : ''}`))
    })
    this.child.stdin.on('error', () => { /* the exit handler above reports the failure */ })
    return Promise.resolve()
  }

  async send(message) {
    if (!this.child || this.child.exitCode !== null) throw new Error('The server process is not running')
    this.child.stdin.write(JSON.stringify(message) + '\n')
  }

  close() {
    const child = this.child
    if (!child || child.exitCode !== null) return
    child.stdin.end()
    if (process.platform === 'win32' && child.pid) {
      // cmd.exe (and npx) start the real server as a child; killing only the first process would leave
      // it running, so end the whole tree.
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
      return
    }
    signalGroup(child, 'SIGTERM')
    // Whatever ignores the request is ended two seconds later, the server's own children included.
    setTimeout(() => { signalGroup(child, 'SIGKILL'); liveGroups.delete(child) }, 2000).unref()
  }
}

/** Streamable HTTP transport. */
class StreamableHttpTransport {
  /** @param {{ url: string, headers?: Record<string,string> }} spec @param {(options?: { refresh?: boolean }) => Promise<Record<string,string> | null>} authHeaders */
  constructor(spec, authHeaders) {
    this.spec = spec
    this.authHeaders = authHeaders
    this.sessionId = undefined
    this.protocolVersion = undefined
    this.controllers = new Set()
  }

  start(onMessage, onClose) {
    this.onMessage = onMessage
    this.onClose = onClose
    return Promise.resolve()
  }

  /** @param {Record<string,string>} [extra] @param {Record<string,string>} [auth] - auth headers already in hand. */
  async headers(extra, auth) {
    const headers = { ...this.spec.headers, ...(auth ?? await this.authHeaders()), ...extra }
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId
    if (this.protocolVersion) headers['mcp-protocol-version'] = this.protocolVersion
    return headers
  }

  /** @param {object} message @param {AbortSignal} [signal] - aborts this request (a timed-out or cancelled call). */
  async send(message, signal) {
    const controller = new AbortController()
    if (signal?.aborted) controller.abort()
    else signal?.addEventListener('abort', () => controller.abort(), { once: true })
    this.controllers.add(controller)
    let streaming = false
    try {
      const response = await fetch(this.spec.url, {
        method: 'POST',
        headers: await this.headers({ 'content-type': 'application/json', accept: 'application/json, text/event-stream' }),
        body: JSON.stringify(message),
        signal: controller.signal,
      })
      if (response.status === 401 || response.status === 403 && /invalid_token|insufficient_scope/.test(response.headers.get('www-authenticate') ?? '')) {
        await response.body?.cancel()
        throw new AuthRequiredError(response.headers.get('www-authenticate'))
      }
      if (response.status === 404 && this.sessionId) {
        await response.body?.cancel()
        // The server forgot our session; the connection restarts and initializes a new one.
        this.onClose(new Error('The server ended the session'))
        throw new Error('The server ended the session')
      }
      if (!response.ok) throw new HttpStatusError(response.status, await errorBody(response))
      const sessionId = response.headers.get('mcp-session-id')
      if (sessionId) this.sessionId = sessionId
      if (response.status === 202 || response.body === null) return
      const type = response.headers.get('content-type') ?? ''
      if (type.includes('text/event-stream')) {
        // Read in the background: the caller's response arrives through onMessage.
        streaming = true
        readSse(response.body, ({ data }) => { try { for (const m of messagesOf(data)) this.onMessage(m) } catch { /* skip a malformed event */ } })
          .catch((error) => {
            // A stream past the size cap fails its request now, with the reason; a dropped stream fails it
            // through its timeout.
            if (error instanceof TooLargeError && 'id' in message) this.onMessage({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error.message } })
          })
          .finally(() => this.controllers.delete(controller))
        return
      }
      const text = await boundedText(response)
      if (text.trim()) for (const m of messagesOf(text)) this.onMessage(m)
    } finally {
      if (!streaming) this.controllers.delete(controller)
    }
  }

  /** Open the optional GET stream for server-initiated notifications; servers that lack one answer 405. */
  async listen() {
    const controller = new AbortController()
    this.controllers.add(controller)
    try {
      const response = await fetch(this.spec.url, { method: 'GET', headers: await this.headers({ accept: 'text/event-stream' }), signal: controller.signal })
      if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/event-stream')) { await response.body?.cancel(); return }
      await readSse(response.body, ({ data }) => { try { for (const m of messagesOf(data)) this.onMessage(m) } catch { /* skip a malformed event */ } })
    } catch { /* the notification stream is optional */ } finally { this.controllers.delete(controller) }
  }

  close() {
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
    if (this.sessionId) {
      // Tell the server the session is over; failures do not matter. This never refreshes a token: the
      // connection may belong to a connector being edited, removed or shut down, and a refresh here would
      // spend the refresh token its replacement needs. With an expired token the request is skipped.
      Promise.resolve(this.authHeaders({ refresh: false }))
        .then(auth => (auth ? this.headers(undefined, auth) : null))
        .then(headers => headers && fetch(this.spec.url, { method: 'DELETE', headers }))
        .catch(() => {})
    }
  }
}

/** Legacy HTTP+SSE transport (MCP 2024-11-05). */
class LegacySseTransport {
  constructor(spec, authHeaders) {
    this.spec = spec
    this.authHeaders = authHeaders
    this.controller = new AbortController()
  }

  async start(onMessage, onClose) {
    const response = await fetch(this.spec.url, {
      headers: { ...this.spec.headers, ...await this.authHeaders(), accept: 'text/event-stream' },
      signal: this.controller.signal,
    })
    if (response.status === 401) { await response.body?.cancel(); throw new AuthRequiredError(response.headers.get('www-authenticate')) }
    if (!response.ok) throw new HttpStatusError(response.status, await errorBody(response))
    let resolveEndpoint
    const endpoint = new Promise((resolve, reject) => {
      resolveEndpoint = resolve
      setTimeout(() => reject(new Error('The server did not announce its message endpoint')), 10000).unref()
    })
    let rejectEndpoint
    endpoint.catch(() => {})
    const announced = new Promise((resolve, reject) => { rejectEndpoint = reject; endpoint.then(resolve, reject) })
    readSse(response.body, ({ event, data }) => {
      if (event === 'endpoint') {
        // Headers and the bearer token go to this endpoint, so it must be on the server's own origin.
        let url
        try { url = new URL(data, this.spec.url) } catch { url = undefined }
        if (url && url.origin === new URL(this.spec.url).origin) resolveEndpoint(url.toString())
        else rejectEndpoint(new Error(`The server announced a message endpoint on another origin (${String(data).slice(0, 200)}); Harness will not send requests there.`))
      } else { try { for (const m of messagesOf(data)) onMessage(m) } catch { /* skip a malformed event */ } }
    }).then(() => onClose(new Error('The server closed the event stream')), error => onClose(error))
    this.endpoint = await announced
  }

  async send(message, signal) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { ...this.spec.headers, ...await this.authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(message),
      signal: signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal,
    })
    if (response.status === 401) throw new AuthRequiredError(response.headers.get('www-authenticate'))
    if (!response.ok) throw new HttpStatusError(response.status, await errorBody(response))
    await response.body?.cancel()
  }

  close() { this.controller.abort() }
}

/**
 * One connector's live MCP connection.
 */
export class McpConnection {
  /**
   * @param {object} options
   * @param {object} options.spec - connector spec: { transport: 'stdio' | 'http', url, headers, command, args, env, cwd }.
   * @param {(options?: { refresh?: boolean }) => Promise<Record<string,string> | null>} [options.authHeaders] - extra HTTP
   *   headers (the bearer token). With `refresh: false` it must not refresh an expired token, and answers null
   *   when it has no usable one; only the session-end request asks that way.
   * @param {(connection: McpConnection) => void} options.onChange - called on every status or tool-list change.
   */
  constructor({ spec, authHeaders = async () => ({}), onChange }) {
    this.spec = spec
    this.authHeaders = authHeaders
    this.onChange = onChange
    this.status = 'disabled'
    this.error = undefined
    this.wwwAuthenticate = undefined
    this.tools = []
    this.serverInfo = undefined
    this.instructions = undefined
    this.nextId = 1
    this.pending = new Map()
    this.attempt = 0
    this.generation = 0
  }

  set(fields) {
    Object.assign(this, fields)
    this.onChange(this)
  }

  /** Connect (or reconnect from scratch). */
  restart() {
    this.attempt = 0
    this.stop()
    this.connect()
  }

  /** Disconnect and stop retrying. */
  stop(status = 'disabled') {
    this.generation++
    clearTimeout(this.retryTimer)
    this.transport?.close()
    this.transport = undefined
    this.rejectPending(new Error('The connection was closed'))
    this.set({ status, tools: [], error: status === 'disabled' ? undefined : this.error })
  }

  rejectPending(error) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error) }
    this.pending.clear()
  }

  async connect(preferLegacy = this.spec.transport === 'http' && /\/sse\/?$/.test(new URL(this.spec.url).pathname)) {
    const generation = ++this.generation
    this.set({ status: 'connecting', error: undefined })
    const transport = this.spec.transport === 'stdio'
      ? new StdioTransport(this.spec)
      : preferLegacy ? new LegacySseTransport(this.spec, this.authHeaders) : new StreamableHttpTransport(this.spec, this.authHeaders)
    this.transport = transport
    const live = () => generation === this.generation
    try {
      await transport.start(message => live() && this.receive(message), (error) => {
        if (!live()) return
        this.rejectPending(error)
        if (this.status === 'connected' || this.status === 'connecting') this.fail(error)
      })
      const init = await this.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO })
      if (!live()) return
      if (!SUPPORTED_VERSIONS.has(init.protocolVersion)) throw new Error(`Unsupported MCP protocol version ${init.protocolVersion}`)
      transport.protocolVersion = init.protocolVersion
      this.capabilities = init.capabilities ?? {}
      this.serverInfo = init.serverInfo
      this.instructions = typeof init.instructions === 'string' ? init.instructions : undefined
      await this.notify('notifications/initialized')
      if (transport instanceof StreamableHttpTransport) transport.listen()
      const tools = await this.listTools()
      if (!live()) return
      this.attempt = 0
      this.set({ status: 'connected', tools, error: undefined, wwwAuthenticate: undefined })
    } catch (error) {
      if (!live()) return
      if (!preferLegacy && this.spec.transport === 'http' && error instanceof HttpStatusError && (error.status === 404 || error.status === 405)) {
        transport.close()
        return this.connect(true)
      }
      this.fail(error)
    }
  }

  fail(error) {
    this.generation++
    this.transport?.close()
    this.transport = undefined
    this.rejectPending(error)
    if (error instanceof AuthRequiredError) {
      this.set({ status: 'needs-auth', tools: [], error: 'Sign in to connect', wwwAuthenticate: error.wwwAuthenticate })
      return
    }
    const delay = RETRY_DELAYS_MS[this.attempt]
    this.attempt++
    this.set({ status: 'failed', tools: [], error: String(error.message ?? error) })
    if (delay !== undefined) this.retryTimer = setTimeout(() => this.connect(), delay)
  }

  async listTools() {
    if (this.capabilities && this.capabilities.tools === undefined) return []
    const tools = []
    let cursor
    for (let page = 0; page < 50; page++) {
      const result = await this.request('tools/list', cursor ? { cursor } : {})
      for (const tool of result.tools ?? []) {
        if (typeof tool?.name !== 'string') continue
        tools.push({ name: tool.name, title: tool.title ?? tool.annotations?.title, description: tool.description ?? '', inputSchema: tool.inputSchema ?? { type: 'object' }, readOnly: tool.annotations?.readOnlyHint === true })
      }
      cursor = result.nextCursor
      if (!cursor) break
    }
    return tools
  }

  /** Handle one incoming JSON-RPC message. */
  receive(message) {
    if (message === null || typeof message !== 'object') return
    if ('id' in message && ('result' in message || 'error' in message)) {
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) entry.reject(Object.assign(new Error(message.error.message ?? 'MCP error'), { code: message.error.code }))
      else entry.resolve(message.result ?? {})
      return
    }
    if (typeof message.method !== 'string') return
    if ('id' in message) {
      // Server → client requests. Only ping is supported; sampling, roots and elicitation are declined.
      const reply = message.method === 'ping'
        ? { jsonrpc: '2.0', id: message.id, result: {} }
        : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not supported: ${message.method}` } }
      this.transport?.send(reply).catch(() => {})
      return
    }
    if (message.method === 'notifications/tools/list_changed' && this.status === 'connected') {
      const generation = this.generation
      this.listTools().then(tools => { if (generation === this.generation) this.set({ tools }) }, () => {})
    }
  }

  /**
   * Send one JSON-RPC request.
   * @param {string} method
   * @param {object} params
   * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
   */
  request(method, params, { signal, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    const transport = this.transport
    if (!transport) return Promise.reject(new Error('Not connected'))
    const id = this.nextId++
    // Aborts this request's own HTTP exchange when the call times out or is cancelled.
    const http = new AbortController()
    return new Promise((resolve, reject) => {
      const finish = () => { this.pending.delete(id); clearTimeout(entry.timer); signal?.removeEventListener('abort', onAbort) }
      const entry = {
        resolve: value => { finish(); resolve(value) },
        reject: error => { finish(); reject(error) },
        timer: setTimeout(() => {
          entry.reject(new Error(`The server did not answer ${method} within ${Math.round(timeoutMs / 1000)}s`))
          http.abort()
          this.notify('notifications/cancelled', { requestId: id, reason: 'timeout' }).catch(() => {})
        }, timeoutMs),
      }
      const onAbort = () => {
        entry.reject(new Error('Cancelled'))
        http.abort()
        this.notify('notifications/cancelled', { requestId: id, reason: 'cancelled' }).catch(() => {})
      }
      if (signal?.aborted) { clearTimeout(entry.timer); reject(new Error('Cancelled')); return }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, entry)
      transport.send({ jsonrpc: '2.0', id, method, params }, http.signal).catch(error => entry.reject(error))
    })
  }

  notify(method, params) {
    return this.transport ? this.transport.send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) : Promise.resolve()
  }

  /**
   * Read one resource by its address (MCP resources/read).
   * @returns {Promise<object>} the ReadResourceResult.
   */
  async readResource(uri, signal) {
    if (this.status !== 'connected') throw new Error(`The connector is ${this.status}`)
    return this.request('resources/read', { uri }, { signal, timeoutMs: 5000 })
  }

  /**
   * Call one tool. A 401 during the call moves the connection to needs-auth.
   * @returns {Promise<object>} the MCP CallToolResult.
   */
  async callTool(name, args, signal, timeoutMs) {
    if (this.status !== 'connected') throw new Error(`The connector is ${this.status === 'needs-auth' ? 'waiting for sign-in' : this.status}`)
    try {
      return await this.request('tools/call', { name, arguments: args }, { signal, timeoutMs })
    } catch (error) {
      if (error instanceof AuthRequiredError) this.fail(error)
      throw error
    }
  }
}
