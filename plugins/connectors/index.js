/**
 * Host half of Connectors: MCP servers the user adds from the Connectors settings page, with live
 * status, OAuth sign-in and per-session on/off.
 *
 *   - Each connector is one McpConnection (mcp-connection.js), started when the connector is on.
 *   - Its tools are registered on each Session's Agent scope (`agent.ctx.tools`), only for Sessions
 *     where the connector is on, under the same `mcp__<connector>__<tool>` names Harness's built-in
 *     MCP client uses. Turning a connector off for a Session disposes those registrations; the next
 *     model request no longer lists the tools.
 *   - The Client reaches this half through a small HTTP helper on 127.0.0.1 (helper.js), which also
 *     receives the OAuth redirect. Every helper request must carry a random key made at each launch;
 *     the Client gets the key and the port from the `harnessStudioConnectors/helper` Remote method
 *     (see "helper access" below), i.e. over Harness's own authenticated Client↔Host channel.
 *   - Header values, environment values and the OAuth client secret never leave this half: the
 *     Client sees their names with a mask, and edits that send the mask back keep the stored value.
 */
import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { McpConnection } from './mcp-connection.js'
import { authorizationRequest, canonicalResource, discover, exchangeCode, expired, grantRevoked, isSecureUrl, pollDeviceToken, refreshTokens, registerClient, requestDeviceCode } from './oauth.js'
import { MASK, cleanSpec, createStore, mergeSecrets } from './store.js'
import { SERVICE, VERSION, startHelper } from './helper.js'

export const name = 'harness-studio-connectors'
export const inject = ['tools', 'agents']

const TOOL_CALL_TIMEOUT_MS = 120000
const LOGIN_TTL_MS = 10 * 60 * 1000
const REFRESH_RETRY_MS = 30000
const MAX_PUBLIC_NAME_LENGTH = 64
const MAX_RESULT_CHARS = 100000
/** Image types a tool result may hand the model, and their decoded size per result (the store has its own limits too). */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_RESULT_IMAGE_BYTES = 10 * 1024 * 1024
/**
 * A connector with more tools than this has them held back, like Claude Code's deferred tools: the model
 * sees their names in one `connector_tools` tool and loads the ones it needs, instead of every schema
 * riding along on every request (GitHub's server alone adds about 12,000 tokens).
 */
const DEFER_ABOVE = 10
const LOADER_TOOL = 'connector_tools'
const MAX_LOAD = 15

/**
 * Servers whose authorization server does not register clients, signed in with an OAuth app that
 * ships with this plugin. They use the device flow (RFC 8628), which needs no client secret: Harness
 * shows a code, the user approves it on the provider's page, and Harness polls for the token. A
 * connector with its own client ID uses that instead.
 */
const BUILT_IN_APPS = [
  {
    hosts: ['api.githubcopilot.com'],
    clientId: 'Ov23liKlRfRPz1digqkA', // GitHub OAuth app "Harness Studio" (device flow, non-expiring tokens)
    deviceEndpoint: 'https://github.com/login/device/code',
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
  },
]

function builtInApp(spec) {
  if (spec.transport !== 'http' || spec.clientId) return undefined
  const host = new URL(spec.url).hostname
  return BUILT_IN_APPS.find(app => app.hosts.includes(host))
}

/** Same public naming as Harness's MCP client: `mcp__<server>__<tool>`, hashed when it must be shortened or cleaned. */
export function publicToolName(serverName, rawName) {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, 12)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - 13)}_${hash}`
}

/**
 * MCP tool result → the text the model reads. Images that were stored for the model (see storeImages)
 * are noted as attached; other images, and audio, become short notes that say why they are not shown.
 * @param {object} result @param {{ shown: Map<number, object>, reason?: string }} [images]
 */
function resultText(result, images) {
  const parts = []
  const content = Array.isArray(result?.content) ? result.content : []
  for (const [index, block] of content.entries()) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block?.type === 'resource_link') parts.push(`Resource link: ${block.name ?? ''} (${block.uri ?? ''})`)
    else if (block?.type === 'resource' && typeof block.resource?.text === 'string') parts.push(block.resource.text)
    else if (block?.type === 'image' && images?.shown.has(index)) parts.push(`[image ${block.mimeType}: attached below]`)
    else if (block?.type) parts.push(`[${block.type} content${block.mimeType ? ' ' + block.mimeType : ''} not shown${block.type === 'image' && images?.reason ? ': ' + images.reason : ''}]`)
  }
  if (parts.length === 0 && result?.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent, null, 2))
  let text = parts.join('\n') || '(the tool returned no content)'
  if (text.length > MAX_RESULT_CHARS) text = text.slice(0, MAX_RESULT_CHARS) + `\n… [truncated ${text.length - MAX_RESULT_CHARS} characters]`
  return text
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
/** A tool name that starts with a lookup verb, as a word: `get_issue`, `listRepos`, `search` (not `getaway`). */
const LOOKUP_NAME = /^(get|list|read|search|fetch|find|query|describe|show|view)/i

/** Whether a URL connector's server runs somewhere other than this computer. */
export function remoteServer(spec) {
  if (spec.transport !== 'http') return false
  try { return !LOOPBACK_HOSTS.has(new URL(spec.url).hostname) } catch { return true }
}

/**
 * Whether "Ask before calls that can change things" lets a tool through without asking: its server marks
 * it read-only and, for a server not on this computer, its name also reads as a lookup.
 */
export function treatedReadOnly(spec, tool) {
  if (!tool.readOnly) return false
  if (!remoteServer(spec)) return true
  const match = LOOKUP_NAME.exec(tool.name)
  // The verb must end where a lowercase letter does not follow: `getIssue` and `get_issue`, not `getaway`.
  return Boolean(match) && !/^[a-z]/.test(tool.name.slice(match[0].length))
}

/**
 * Open a sign-in page in the user's browser. Only https:// pages (http:// on a loopback host) are
 * handed to the OS opener: a server-chosen `file:`, `smb:` or app-scheme URL is refused.
 */
export function openInBrowser(url) {
  if (!isSecureUrl(url)) throw Object.assign(new Error(`Harness will not open the sign-in page ${String(url).slice(0, 200)}: it is not an https:// URL.`), { status: 400 })
  const [command, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : ['xdg-open', [url]]
  execFile(command, args, () => { /* the page also offers the link when the browser does not open */ })
}

// ---- helper access ------------------------------------------------------------------------------
/**
 * The Client half learns the helper's port and key from one Remote method, `harnessStudioConnectors/
 * helper`, served by Harness's API Gateway. That channel is authenticated by Harness itself (the
 * Desktop carrier, or the Web launch token), so a local process that can reach 127.0.0.1 still cannot
 * read the key, and each Harness instance's Client reaches only its own helper.
 *
 * Out-of-tree plugins have no generated Remote declarations, so this Service uses the Gateway's
 * source-mode discovery: a Service with a `typertRemote` binding and the versioned Remote-method marker
 * that `@Remote` writes on the prototype. The method takes no arguments, so the Client needs no
 * generated codec and calls it through `ctx.connection.rpc`. Non-owner Peers (shared remote access)
 * are refused by the Gateway's access policy, which grants nothing for this action.
 */
export const HELPER_SERVICE = 'harnessStudioConnectors'
/** The Harness Studio Chrome bridge (chrome-bridge/server.mjs): its MCP server name and its link-key resource. */
const CHROME_BRIDGE_SERVER = 'harness-studio-chrome-bridge'
const CHROME_BRIDGE_LINK = 'harness-studio://chrome-bridge/link'
const REMOTE_METHODS_MARKER = '@deepseek-ai/dsh-typert-protocol/remote-methods'

class HelperAccess {
  /** @param {() => object} read - the current helper facts. */
  constructor(read) {
    this.read = read
    this.typertRemote = Object.freeze({ service: this, serviceKey: HELPER_SERVICE, namespace: HELPER_SERVICE })
  }

  /** @returns {{ service: string, version: number, port: number, key: string } | { service: string, version: number, starting: true }} */
  helper() {
    return this.read()
  }
}
Object.defineProperty(HelperAccess.prototype, REMOTE_METHODS_MARKER, {
  configurable: true,
  value: Object.freeze({ version: 1, methods: Object.freeze([Object.freeze({ method: 'helper', invocation: Object.freeze({ kind: 'direct' }) })]) }),
})

const httpError = (status, message) => Object.assign(new Error(message), { status })
const masked = record => Object.fromEntries(Object.keys(record ?? {}).map(key => [key, MASK]))

export function apply(ctx) {
  const profile = ctx.get('profileContext')
  const home = profile?.home ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const store = createStore({ home, credentials: () => ctx.get('credentials') })
  /** A new key at every launch; only the Client half receives it (see "helper access"). */
  const helperKey = randomBytes(32).toString('base64url')
  /** @type {{ connectors: object[], sessions: Record<string, Record<string, boolean>> }} */
  let state = { connectors: [], sessions: {} }
  /**
   * id → { spec, connection, grant, toolsVersion, toolErrors, login, refreshTried, authGeneration, removed }.
   * `authGeneration` changes on sign-out, edit and removal; a refresh, code exchange or device poll
   * that started under an older generation discards its result instead of writing a grant.
   */
  const entries = new Map()
  /** Agent → Map(connector id → { version, disposers }) */
  const mounted = new Map()
  /** OAuth state → pending login */
  const logins = new Map()
  let helper
  let loadError
  let disposed = false

  /** Whether a connector may still be (re)started: not removed, and the plugin not stopped. */
  const live = entry => !disposed && !entry.removed
  const save = () => store.save(state).catch(error => console.warn('[connectors] could not save:', error.message))
  const enabledFor = (sessionId, id) => state.sessions[sessionId]?.[id] ?? true
  /** Connectors that could not be read are never overwritten: changes are refused until a restart. */
  const writable = () => {
    if (loadError) throw httpError(503, `Connectors could not be read (${loadError}). Fix that file and restart Harness; changes are not saved until then.`)
  }

  if (typeof ctx.provide === 'function') {
    ctx.provide(HELPER_SERVICE, new HelperAccess(() => (helper
      ? { service: SERVICE, version: VERSION, port: helper.port, key: helperKey }
      : { service: SERVICE, version: VERSION, starting: true })))
  }

  // ---- tools on Agent scopes ------------------------------------------------------------------
  function toolDefinitions(entry) {
    const { spec, connection } = entry
    const definitions = []
    const seen = new Set()
    for (const tool of connection.tools) {
      const publicName = publicToolName(spec.id, tool.name)
      if (seen.has(publicName)) continue
      seen.add(publicName)
      definitions.push({
        name: publicName,
        description: tool.description || tool.title || `${tool.name} from ${spec.name}`,
        parameters: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object' },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        async execute(args, exec) {
          const result = await entry.connection.callTool(tool.name, args && typeof args === 'object' ? args : {}, exec.signal, TOOL_CALL_TIMEOUT_MS)
          if (result?.isError === true) throw new Error(resultText(result))
          const images = await storeImages(result, exec)
          const text = resultText(result, images)
          if (images.shown.size > 0) {
            projections.set(exec, { text, content: [{ type: 'text', text }, ...[...images.shown.values()].map(attachment => ({ type: 'image', attachment }))] })
          }
          return text
        },
        // The model gets the stored images with the text, unless a policy replaced the result meanwhile.
        projectContent(exec, result) {
          const projection = projections.get(exec)
          if (!projection) return undefined
          projections.delete(exec)
          if (result.isError || result.value !== projection.text) return undefined
          if (!isDeepStrictEqual(result.content, [{ type: 'text', text: projection.text }])) return undefined
          return projection.content
        },
      })
    }
    return definitions
  }

  /** Tool execution → the content (text, then stored images) prepared for it during execute. */
  const projections = new WeakMap()

  /**
   * Store a result's images for the model, the way Harness's own MCP client does: only PNG, JPEG, WebP or
   * GIF, at most MAX_RESULT_IMAGE_BYTES in all, and only when the session's current model accepts images.
   * Anything else leaves every image as a note, with the reason.
   * @returns {Promise<{ shown: Map<number, object>, reason?: string }>} content index → image attachment.
   */
  async function storeImages(result, exec) {
    const shown = new Map()
    const content = Array.isArray(result?.content) ? result.content : []
    const indexes = [...content.keys()].filter(index => content[index]?.type === 'image')
    if (indexes.length === 0) return { shown }
    const refuse = reason => ({ shown, reason })
    const decoded = []
    let bytes = 0
    for (const index of indexes) {
      const { mimeType, data } = content[index]
      if (!IMAGE_TYPES.has(mimeType) || typeof data !== 'string' || data === '') return refuse('it is not a PNG, JPEG, WebP or GIF image')
      bytes += Math.floor(data.length * 3 / 4)
      if (bytes > MAX_RESULT_IMAGE_BYTES) return refuse(`the images are larger than ${MAX_RESULT_IMAGE_BYTES / 1024 / 1024} MB`)
      decoded.push({ data: Buffer.from(data, 'base64'), mediaType: mimeType })
    }
    const attachments = ctx.get('attachments')
    const llm = ctx.get('llm')
    if (!attachments || !llm) return refuse('this Harness cannot store images')
    const routed = exec?.agent?.session?.requestHeader?.()?.config
    const provider = routed?.provider ?? exec?.agent?.options?.provider
    const model = routed?.model ?? exec?.agent?.options?.model
    if (provider === undefined || model === undefined) return refuse('the current model could not be determined')
    try {
      const info = await llm.resolveModelInfo(provider, model, exec.signal)
      if (!info?.inputModalities?.includes('image')) return refuse(`the current model (${model}) does not accept images`)
      const refs = await attachments.saveImages(decoded)
      indexes.forEach((index, n) => { if (refs[n]) shown.set(index, refs[n]) })
      return { shown }
    } catch (error) {
      return refuse(`it could not be stored (${String(error?.message ?? error)})`)
    }
  }

  /** Per Agent: the held-back tools it has loaded, and a counter bumped on each load. */
  const loaded = new WeakMap()
  const loadedOf = agent => {
    let state = loaded.get(agent)
    if (!state) loaded.set(agent, state = { names: new Set(), version: 0 })
    return state
  }

  function syncAgent(agent) {
    let perAgent = mounted.get(agent)
    if (!perAgent) mounted.set(agent, perAgent = new Map())
    const sessionId = agent.session?.id
    const loads = loadedOf(agent)
    for (const [id, current] of perAgent) {
      if (id === LOADER_TOOL) continue
      const entry = entries.get(id)
      const want = entry && entry.spec.enabled && entry.connection.status === 'connected' && enabledFor(sessionId, id)
      const stale = current.deferred.length > 0 && current.loadVersion !== loads.version
      if (!want || current.version !== entry.toolsVersion || current.entry !== entry || stale) {
        for (const dispose of current.disposers) dispose()
        perAgent.delete(id)
      }
    }
    for (const [id, entry] of entries) {
      if (perAgent.has(id)) continue
      if (!entry.spec.enabled || entry.connection.status !== 'connected' || !enabledFor(sessionId, id)) continue
      const disposers = []
      const definitions = toolDefinitions(entry)
      const defer = definitions.length > DEFER_ABOVE
      const deferred = []
      for (const definition of definitions) {
        if (defer && !loads.names.has(definition.name)) { deferred.push(definition); continue }
        try {
          disposers.push(agent.ctx.tools.register(definition))
        } catch (error) {
          entry.toolErrors[definition.name] = String(error.message ?? error)
        }
      }
      perAgent.set(id, { entry, version: entry.toolsVersion, disposers, deferred, loadVersion: loads.version })
    }
    syncLoader(agent, perAgent)
  }

  /** The one tool that lists held-back tools by name and loads them; absent when nothing is held back. */
  function syncLoader(agent, perAgent) {
    const held = []
    for (const [id, current] of perAgent) if (id !== LOADER_TOOL) for (const definition of current.deferred) held.push({ connector: current.entry.spec.name, definition })
    const signature = held.map(h => h.definition.name).join(',')
    const current = perAgent.get(LOADER_TOOL)
    if (current?.signature === signature) return
    for (const dispose of current?.disposers ?? []) dispose()
    perAgent.delete(LOADER_TOOL)
    if (held.length === 0) return
    const byConnector = new Map()
    for (const { connector, definition } of held) {
      const names = byConnector.get(connector) ?? []
      names.push(definition.name)
      byConnector.set(connector, names)
    }
    const catalog = [...byConnector].map(([connector, names]) => `${connector} (${names.length}): ${names.join(', ')}`).join('\n')
    const definition = {
      name: LOADER_TOOL,
      description: 'Load tools from connected MCP servers before using them. These tools are held back to keep requests small; ' +
        `load the ones a task needs by exact name, or by a search query, and call them from your next step (at most ${MAX_LOAD} per call).\n\n${catalog}`,
      parameters: {
        type: 'object',
        properties: {
          names: { type: 'array', items: { type: 'string' }, description: 'Exact tool names from the list to load.' },
          query: { type: 'string', description: 'Words to search tool names and descriptions for, when you do not know the name.' },
        },
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async (args, exec) => loadTools(exec?.agent ?? agent, args ?? {}),
    }
    try {
      perAgent.set(LOADER_TOOL, { signature, disposers: [agent.ctx.tools.register(definition)], deferred: [] })
    } catch (error) {
      console.warn('[connectors] could not register the tool loader:', error?.message ?? error)
    }
  }

  function loadTools(agent, { names, query }) {
    const perAgent = mounted.get(agent)
    const held = []
    for (const [id, current] of perAgent ?? []) if (id !== LOADER_TOOL) held.push(...current.deferred)
    let picked = []
    if (Array.isArray(names) && names.length > 0) {
      const wanted = new Set(names.map(String))
      picked = held.filter(d => wanted.has(d.name) || [...wanted].some(w => d.name.endsWith(`__${w}`)))
    } else if (typeof query === 'string' && query.trim() !== '') {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean)
      const score = d => words.filter(w => d.name.toLowerCase().includes(w) || d.description.toLowerCase().includes(w)).length
      picked = held.map(d => [d, score(d)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([d]) => d)
    } else {
      throw new Error('Pass names from the list, or a query.')
    }
    picked = picked.slice(0, MAX_LOAD)
    if (picked.length === 0) return 'No held-back tool matched; check the names in this tool\'s description.'
    const loads = loadedOf(agent)
    for (const d of picked) loads.names.add(d.name)
    loads.version += 1
    syncAgent(agent)
    return `Loaded ${picked.length} tool(s); call them from your next step:\n` +
      picked.map(d => `- ${d.name}: ${d.description.split('\n')[0].slice(0, 200)}`).join('\n')
  }

  function unmountAgent(agent) {
    for (const current of mounted.get(agent)?.values() ?? []) for (const dispose of current.disposers) dispose()
    mounted.delete(agent)
  }

  const syncAll = () => { if (!disposed) for (const agent of ctx.agents.list()) syncAgent(agent) }

  // ---- connections ------------------------------------------------------------------------------
  /**
   * The bearer header for a connector's requests. A token that is expired, or about to be, is refreshed
   * first, unless `refresh` is false (the session-end request of a closing connection): then the token
   * is sent as it is while it still works, and past its expiry null says there is none and that request
   * is skipped.
   */
  async function authHeaders(entry, { refresh: mayRefresh = true } = {}) {
    const grant = entry.grant
    if (!grant?.tokens?.access_token) return {}
    if (!mayRefresh) {
      const gone = grant.tokens.expires_at !== undefined && grant.tokens.expires_at <= Date.now()
      return gone ? null : { authorization: `Bearer ${grant.tokens.access_token}` }
    }
    if (expired(grant.tokens) && grant.tokens.refresh_token) await refresh(entry)
    return entry.grant?.tokens?.access_token ? { authorization: `Bearer ${entry.grant.tokens.access_token}` } : {}
  }

  /**
   * Connector id → the refresh in flight for it, whichever entry started it. An edit replaces a
   * connector's entry, and both can hold the same refresh token; under refresh-token rotation a second
   * use is refused (`invalid_grant`) and would sign the user out, so refreshes for one id run in turn.
   */
  const refreshLocks = new Map()
  /** Connector id → the last refresh that succeeded: the refresh token it spent and the tokens it got. */
  const rotations = new Map()

  /**
   * Refresh once at a time per connector id, across entries. A refresh waits for the one before it; if
   * that one already spent this entry's refresh token, its tokens are taken over instead of spending the
   * token again. Only a refused grant (`invalid_grant`, or a bare 400/401 from the token endpoint) drops
   * the tokens so sign-in is offered; a network error, timeout or server error keeps them and tries again
   * in 30 seconds. A sign-out, edit or removal while the request is out wins: the result is discarded and
   * nothing is written. New tokens are saved before the next refresh for the id may start.
   * @returns {Promise<boolean>} whether new tokens were stored.
   */
  function refresh(entry) {
    if (entry.refreshing) return entry.refreshing
    const id = entry.spec.id
    const before = refreshLocks.get(id)
    const run = (async () => {
      if (before) await before.catch(() => {})
      const grant = entry.grant
      const generation = entry.authGeneration
      if (entry.removed || !grant?.tokens?.refresh_token) return false
      // Taken over only when they are newer than this entry's and still valid; a server that does not
      // rotate keeps the same refresh token, and its own last result must not be reused.
      const spent = rotations.get(id)
      const takeOver = spent && spent.from === grant.tokens.refresh_token && spent.tokens.access_token !== grant.tokens.access_token
        && !(spent.tokens.expires_at !== undefined && spent.tokens.expires_at <= Date.now())
      let tokens
      let failure
      if (takeOver) {
        tokens = spent.tokens
      } else {
        try {
          tokens = await refreshTokens({ metadata: grant.metadata, client: grant.client, tokens: grant.tokens, resource: grant.resource })
          rotations.set(id, { from: grant.tokens.refresh_token, tokens })
        } catch (error) {
          failure = error
        }
      }
      if (entry.removed || entry.authGeneration !== generation || entry.grant !== grant) return false
      if (tokens) {
        entry.grant = { ...grant, tokens }
        await store.writeGrant(entry.spec.id, entry.grant).catch(error => console.warn(`[connectors] ${entry.spec.name}: could not save refreshed tokens: ${error.message}`))
        return true
      }
      if (grantRevoked(failure)) {
        console.warn(`[connectors] ${entry.spec.name}: the sign-in was refused (${failure.message}); sign in again`)
        entry.grant = { ...grant, tokens: undefined }
        await store.writeGrant(entry.spec.id, entry.grant).catch(() => {})
        return false
      }
      console.warn(`[connectors] ${entry.spec.name}: token refresh failed (${failure?.message}); keeping the sign-in and retrying in ${REFRESH_RETRY_MS / 1000} s`)
      scheduleRefreshRetry(entry)
      return false
    })()
    entry.refreshing = run
    refreshLocks.set(id, run)
    run.finally(() => {
      if (entry.refreshing === run) entry.refreshing = undefined
      if (refreshLocks.get(id) === run) refreshLocks.delete(id)
    }).catch(() => {})
    return run
  }

  function scheduleRefreshRetry(entry) {
    clearTimeout(entry.refreshRetry)
    entry.refreshRetry = setTimeout(() => {
      entry.refreshRetry = undefined
      if (disposed || entry.removed || !entry.spec.enabled || !entry.grant?.tokens) return
      entry.refreshTried = false
      if (entry.connection.status !== 'connected') entry.connection.restart()
    }, REFRESH_RETRY_MS)
    entry.refreshRetry.unref?.()
  }

  /** Cancel everything in flight for a connector's sign-in: device polling, refreshes, pending redirects. */
  function bumpAuth(entry) {
    entry.authGeneration++
    entry.devicePoll?.abort()
    entry.devicePoll = undefined
    entry.device = undefined
    entry.refreshing = undefined
    clearTimeout(entry.refreshRetry)
    entry.refreshRetry = undefined
    entry.authorizing = false
    for (const [key, pending] of logins) if (pending.entry === entry) logins.delete(key)
  }

  function onConnectionChange(entry) {
    const { connection } = entry
    const toolKey = connection.status === 'connected' ? JSON.stringify(connection.tools.map(t => [t.name, t.description, t.inputSchema])) : ''
    if (toolKey !== entry.toolKey) {
      entry.toolKey = toolKey
      entry.toolsVersion++
      entry.toolErrors = {}
    }
    if (connection.status === 'connected') entry.refreshTried = false
    // A refused token: try one refresh before asking the user to sign in again.
    if (connection.status === 'needs-auth' && entry.spec.enabled && live(entry) && entry.grant?.tokens?.refresh_token && !entry.refreshTried) {
      entry.refreshTried = true
      refresh(entry).then((refreshed) => { if (refreshed && entry.spec.enabled && live(entry)) entry.connection.restart() })
    }
    syncAll()
  }

  /** Create a connector's entry synchronously, so its id is taken before any await. */
  function createEntry(spec, grant) {
    if (entries.has(spec.id)) throw httpError(409, `A connector with id "${spec.id}" already exists`)
    const entry = { spec, grant, toolsVersion: 0, toolErrors: {}, toolKey: '', authGeneration: 0, removed: false }
    entry.connection = new McpConnection({
      spec: spec.transport === 'http' ? { transport: 'http', url: spec.url, headers: spec.headers } : spec,
      authHeaders: options => authHeaders(entry, options),
      onChange: () => onConnectionChange(entry),
    })
    entries.set(spec.id, entry)
    return entry
  }

  function removeEntry(id) {
    const entry = entries.get(id)
    if (!entry) return
    entries.delete(id)
    entry.removed = true
    bumpAuth(entry)
    entry.connection.stop()
    syncAll()
  }

  // ---- sign-in ------------------------------------------------------------------------------------
  async function startLogin(entry) {
    if (entry.spec.transport !== 'http') throw httpError(400, 'Only URL connectors sign in')
    if (!helper) throw new Error('The connectors helper is not running')
    const app = builtInApp(entry.spec)
    if (app) {
      // The device flow uses the app's own endpoints; discovery only supplies scope and resource.
      const discovery = await discover(entry.spec.url, entry.connection.wwwAuthenticate ?? undefined).catch((error) => {
        console.warn(`[connectors] ${entry.spec.name}: discovery failed (${error.message}); signing in with the built-in app's defaults`)
        return { resource: canonicalResource(entry.spec.url), scope: undefined }
      })
      return startDeviceLogin(entry, app, discovery)
    }
    const discovery = await discover(entry.spec.url, entry.connection.wwwAuthenticate ?? undefined)
    const redirectUri = `http://127.0.0.1:${helper.port}/oauth/callback`
    if (!entry.spec.clientId && !discovery.metadata.registration_endpoint) {
      throw httpError(400, `This server needs an OAuth app. Create one with the callback URL ${redirectUri}, then expand this connector, choose Edit and add its client ID and secret.`)
    }
    let client
    if (entry.spec.clientId) client = { client_id: entry.spec.clientId, client_secret: entry.spec.clientSecret, redirect_uri: redirectUri }
    else if (entry.grant?.client && entry.grant.client.redirect_uri === redirectUri && entry.grant.issuer === discovery.issuer) client = entry.grant.client
    else client = await registerClient(discovery.metadata, redirectUri)
    if (entry.removed) throw httpError(404, 'The connector was removed')
    const request = authorizationRequest({ metadata: discovery.metadata, client, scope: discovery.scope, resource: discovery.resource })
    // Tokens from another authorization server (or token endpoint) are dropped here, not when this sign-in
    // finishes: one abandoned halfway must not leave the next refresh sending the old refresh token, and
    // the client secret, to the new token endpoint.
    const moved = entry.grant?.issuer !== discovery.issuer || entry.grant?.metadata?.token_endpoint !== discovery.metadata.token_endpoint
    entry.grant = { ...entry.grant, client, issuer: discovery.issuer, metadata: discovery.metadata, resource: discovery.resource, scope: discovery.scope, ...(moved ? { tokens: undefined } : {}) }
    await store.writeGrant(entry.spec.id, entry.grant)
    if (entry.removed) throw httpError(404, 'The connector was removed')
    for (const [key, pending] of logins) if (pending.entry === entry || pending.expires < Date.now()) logins.delete(key)
    logins.set(request.state, { entry, generation: entry.authGeneration, verifier: request.verifier, expires: Date.now() + LOGIN_TTL_MS })
    entry.loginError = undefined
    entry.authorizing = true
    openInBrowser(request.url)
    return { url: request.url }
  }

  /** Device-flow sign-in with a built-in OAuth app; the token arrives in the background. */
  async function startDeviceLogin(entry, app, discovery) {
    entry.devicePoll?.abort()
    const generation = entry.authGeneration
    const device = await requestDeviceCode({ endpoint: app.deviceEndpoint, clientId: app.clientId, scope: discovery.scope })
    if (entry.removed || entry.authGeneration !== generation) throw httpError(409, 'Sign-in was cancelled')
    const verificationPage = device.verification_uri_complete ?? device.verification_uri
    openInBrowser(verificationPage)
    entry.devicePoll?.abort()
    const poll = new AbortController()
    entry.devicePoll = poll
    entry.device = { userCode: device.user_code, verificationUri: device.verification_uri, expiresAt: Date.now() + device.expires_in * 1000 }
    entry.loginError = undefined
    entry.authorizing = true
    pollDeviceToken({ tokenEndpoint: app.tokenEndpoint, clientId: app.clientId, device, signal: poll.signal }).then(async (tokens) => {
      // A poll that was cancelled (new code, sign-out, removal) never revives the connector.
      if (poll.signal.aborted || entry.removed || entry.authGeneration !== generation) return
      entry.grant = { flow: 'device', client: { client_id: app.clientId }, metadata: { token_endpoint: app.tokenEndpoint }, resource: discovery.resource, scope: discovery.scope, tokens }
      await store.writeGrant(entry.spec.id, entry.grant)
      if (entry.spec.enabled && live(entry)) entry.connection.restart()
    }, (error) => {
      if (!poll.signal.aborted) entry.loginError = String(error.message ?? error)
    }).finally(() => {
      if (entry.devicePoll !== poll) return
      entry.devicePoll = undefined
      entry.device = undefined
      entry.authorizing = false
    })
    return { device: { userCode: entry.device.userCode, verificationUri: entry.device.verificationUri } }
  }

  /** The browser's redirect back to the helper. @returns {Promise<{ ok: boolean, message: string }>} */
  async function finishLogin(params) {
    const pending = logins.get(params.get('state') ?? '')
    if (!pending || pending.expires < Date.now()) return { ok: false, message: 'This sign-in link has expired. Start again from Harness.' }
    logins.delete(params.get('state'))
    const entry = pending.entry
    if (entry.removed || entries.get(entry.spec.id) !== entry) return { ok: false, message: 'The connector was removed.' }
    if (entry.authGeneration !== pending.generation || !entry.grant?.client) return { ok: false, message: 'This sign-in was cancelled. Start again from Harness.' }
    entry.authorizing = false
    if (params.get('error')) {
      entry.loginError = `${params.get('error')}${params.get('error_description') ? ': ' + params.get('error_description') : ''}`
      return { ok: false, message: `Sign-in was not completed (${entry.loginError}).` }
    }
    try {
      const tokens = await exchangeCode({ metadata: entry.grant.metadata, client: entry.grant.client, code: params.get('code') ?? '', verifier: pending.verifier, resource: entry.grant.resource })
      if (entry.removed || entry.authGeneration !== pending.generation) return { ok: false, message: 'The connector was signed out or removed while signing in.' }
      entry.grant = { ...entry.grant, tokens }
      await store.writeGrant(entry.spec.id, entry.grant)
      if (entry.spec.enabled && live(entry)) entry.connection.restart()
      return { ok: true, message: `${entry.spec.name} is connected. You can close this tab and return to Harness.` }
    } catch (error) {
      entry.loginError = String(error.message ?? error)
      return { ok: false, message: entry.loginError }
    }
  }

  // ---- what the Client sees ---------------------------------------------------------------------
  /** A connector as the Client sees it: header and environment names with masked values, no client secret. */
  function view(entry, sessionId) {
    const { spec, connection } = entry
    const { headers, env, clientSecret, ...visible } = spec
    return {
      ...visible,
      ...(headers ? { headers: masked(headers) } : {}),
      ...(env ? { env: masked(env) } : {}),
      ...(spec.transport === 'http' ? { clientSecretSet: Boolean(clientSecret) } : {}),
      status: spec.enabled ? connection.status : 'disabled',
      error: spec.enabled ? connection.error : undefined,
      server: connection.serverInfo ? { name: connection.serverInfo.name, version: connection.serverInfo.version } : undefined,
      tools: connection.status === 'connected' ? connection.tools.map(t => ({ name: t.name, title: t.title, description: t.description, publicName: publicToolName(spec.id, t.name) })) : [],
      toolErrors: entry.toolErrors,
      signedIn: Boolean(entry.grant?.tokens?.access_token),
      authorizing: Boolean(entry.authorizing),
      loginError: entry.loginError,
      device: entry.device ? { userCode: entry.device.userCode, verificationUri: entry.device.verificationUri } : undefined,
      builtInSignIn: Boolean(builtInApp(spec)),
      onInSession: sessionId ? enabledFor(sessionId, spec.id) : undefined,
    }
  }

  const routes = {
    list: ({ session }) => ({ connectors: [...entries.values()].map(e => view(e, session)), file: store.file, ...(loadError ? { loadError } : {}) }),
    async add(body) {
      writable()
      // A taken id is replaced by a fresh one, and the entry exists before any await, so two adds
      // cannot claim the same id. A grant left under this id by an earlier connector is deleted.
      const spec = cleanSpec(body, new Set(entries.keys()))
      const entry = createEntry(spec, undefined)
      state.connectors.push(spec)
      await store.writeGrant(spec.id, undefined).catch(() => {})
      await save()
      if (spec.enabled && live(entry)) entry.connection.restart()
      return view(entry)
    },
    async edit(id, body) {
      writable()
      const entry = need(id)
      // Saved secrets stay with the server they were given for: pointing the connector at another origin
      // drops the ones not typed again (mergeSecrets), and the answer says which.
      const merged = mergeSecrets(body, entry.spec)
      const spec = cleanSpec({ ...merged, id, enabled: entry.spec.enabled }, new Set())
      // Let a refresh in flight settle so the new entry starts from the latest tokens.
      await entry.refreshing?.catch(() => {})
      if (entries.get(id) !== entry) throw httpError(409, 'The connector changed while saving; try again')
      const urlChanged = spec.transport !== entry.spec.transport || spec.url !== entry.spec.url
      const grant = urlChanged ? undefined : entry.grant
      state.connectors = state.connectors.map(c => (c.id === id ? spec : c))
      removeEntry(id)
      const next = createEntry(spec, grant)
      if (urlChanged) await store.writeGrant(id, undefined)
      await save()
      if (spec.enabled && live(next)) next.connection.restart()
      const dropped = merged?.droppedSecrets ?? []
      if (dropped.length === 0) return view(next)
      return { ...view(next), droppedSecrets: dropped, notice: `The connector now points at another server, so the saved ${dropped.join(', ')} ${dropped.length === 1 ? 'was' : 'were'} not carried over. Enter ${dropped.length === 1 ? 'it' : 'them'} again if this server needs ${dropped.length === 1 ? 'it' : 'them'}.` }
    },
    async remove(id) {
      writable()
      need(id)
      removeEntry(id)
      rotations.delete(id)
      state.connectors = state.connectors.filter(c => c.id !== id)
      for (const choices of Object.values(state.sessions)) delete choices[id]
      await store.writeGrant(id, undefined).catch(() => {})
      await save()
      return { removed: id }
    },
    async enabled(id, { enabled }) {
      writable()
      const entry = need(id)
      entry.spec.enabled = enabled === true
      state.connectors = state.connectors.map(c => (c.id === id ? entry.spec : c))
      await save()
      if (entry.removed) return view(entry)
      if (entry.spec.enabled) entry.connection.restart()
      else entry.connection.stop()
      syncAll()
      return view(entry)
    },
    async session(id, { session, enabled }) {
      writable()
      const entry = need(id)
      if (typeof session !== 'string' || !session) throw httpError(400, 'session is required')
      state.sessions[session] = { ...state.sessions[session], [id]: enabled === true }
      await save()
      syncAll()
      return view(entry, session)
    },
    async reconnect(id) {
      const entry = need(id)
      if (!entry.spec.enabled) {
        writable()
        entry.spec.enabled = true
        state.connectors = state.connectors.map(c => (c.id === id ? entry.spec : c))
        await save()
      }
      if (!entry.removed) entry.connection.restart()
      return view(entry)
    },
    login: id => startLogin(need(id)),
    async logout(id) {
      const entry = need(id)
      bumpAuth(entry)
      entry.grant = undefined
      entry.loginError = undefined
      await store.writeGrant(id, undefined)
      // A connector the user switched off stays off.
      if (entry.spec.enabled && live(entry)) entry.connection.restart()
      return view(entry)
    },
    callback: params => finishLogin(params),
    /**
     * The link key of the Harness Studio Chrome bridge, read over its stdio pipe, for the window's pick
     * polling (the devpreview plugin). Only a connected bridge that is listening on its port answers.
     */
    async chromeBridgeLink() {
      for (const entry of entries.values()) {
        const { connection } = entry
        if (entry.removed || connection?.status !== 'connected' || connection.serverInfo?.name !== CHROME_BRIDGE_SERVER) continue
        try {
          const result = await connection.readResource(CHROME_BRIDGE_LINK)
          const link = JSON.parse(result?.contents?.[0]?.text ?? 'null')
          if (link?.listening === true && Number.isInteger(link.port) && /^[0-9a-f]{64}$/.test(link.key ?? '')) return { port: link.port, key: link.key }
        } catch { /* an older bridge without a link key: no picks reach the window */ }
      }
      return {}
    },
  }

  function need(id) {
    const entry = entries.get(id)
    if (!entry) throw httpError(404, 'No such connector')
    return entry
  }

  // ---- asking before calls ----------------------------------------------------------------------
  // A connector set to ask holds its tool calls for the user's approval in Harness's approval prompt:
  // every call, or only calls to tools its server does not mark read-only. Other listeners decide first.
  // Full access turns approval prompts off (each would be refused), so it lifts this as well.
  //
  // MCP calls the read-only label an untrusted hint, and "changes" relies on it. For a server that is
  // not on this computer (a URL off loopback) the label alone is not enough: the tool's name must also
  // read as a lookup (get, list, read, search, …), or the call asks.
  function askingTool(name) {
    if (!name.startsWith('mcp__')) return undefined
    for (const entry of entries.values()) {
      if (!entry.spec.ask) continue
      const tool = entry.connection.tools.find(t => publicToolName(entry.spec.id, t.name) === name)
      if (tool) return entry.spec.ask === 'changes' && treatedReadOnly(entry.spec, tool) ? undefined : { spec: entry.spec, tool }
    }
    return undefined
  }
  const fullAccess = session => {
    try { return ctx.get('sandboxPolicy')?.resolve({ session }).mode === 'danger-full-access' } catch { return false }
  }
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (decision?.kind !== 'allow') return decision
    const found = askingTool(exec.name)
    if (!found || (exec.agent?.session && fullAccess(exec.agent.session))) return decision
    const { spec, tool } = found
    const when = spec.ask === 'always' ? 'every call' : 'calls that can change things'
    return {
      kind: 'ask',
      reason: `Connector ${spec.name} asks before ${when}`,
      displayReason: { en: `Let the agent use ${tool.title || tool.name} on ${spec.name}? This connector is set to ask before ${when}.` },
    }
  })

  // ---- lifecycle --------------------------------------------------------------------------------
  ctx.on('agent/created', ({ agent }) => { syncAgent(agent) })
  ctx.on('agent/disposed', ({ agent }) => { unmountAgent(agent) })

  ctx.effect(() => {
    // The helper starts only after the saved connectors are loaded, so no request can add a
    // connector whose id the file already uses, or be overwritten by the load.
    ;(async () => {
      try {
        const loaded = await store.load()
        if (disposed) return
        state = loaded
        const created = []
        for (const spec of state.connectors) {
          try { created.push(createEntry(spec, undefined)) } catch (error) { console.warn(`[connectors] skipping connector ${spec.id}: ${error.message}`) }
        }
        await Promise.all(created.map(async (entry) => { entry.grant = await store.readGrant(entry.spec.id).catch(() => undefined) }))
        if (disposed) return
        for (const entry of created) if (entry.spec.enabled && live(entry)) entry.connection.restart()
        syncAll()
      } catch (error) {
        loadError = error.message
        console.warn('[connectors] could not load connectors:', error.message)
      }
      if (disposed) return
      const started = await startHelper({ routes, secret: helperKey })
      if (disposed) started.close(); else helper = started
    })().catch(error => console.warn('[connectors] helper not started:', error.message))
    return () => {
      disposed = true
      for (const agent of [...mounted.keys()]) unmountAgent(agent)
      // Stopping is not a sign-out: a refresh still in flight saves its rotated tokens, but nothing
      // restarts (see `live`). Device polls and pending redirects end with the plugin.
      for (const entry of entries.values()) { entry.devicePoll?.abort(); clearTimeout(entry.refreshRetry); entry.connection.stop() }
      entries.clear()
      logins.clear()
      const closing = helper?.close()
      helper = undefined
      return closing
    }
  }, 'connectors')
}
