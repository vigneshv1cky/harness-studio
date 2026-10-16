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

/** MCP tool result → the text the model reads. Images and audio become short notes. */
function resultText(result) {
  const parts = []
  for (const block of Array.isArray(result?.content) ? result.content : []) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block?.type === 'resource_link') parts.push(`Resource link: ${block.name ?? ''} (${block.uri ?? ''})`)
    else if (block?.type === 'resource' && typeof block.resource?.text === 'string') parts.push(block.resource.text)
    else if (block?.type) parts.push(`[${block.type} content${block.mimeType ? ' ' + block.mimeType : ''} not shown]`)
  }
  if (parts.length === 0 && result?.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent, null, 2))
  let text = parts.join('\n') || '(the tool returned no content)'
  if (text.length > MAX_RESULT_CHARS) text = text.slice(0, MAX_RESULT_CHARS) + `\n… [truncated ${text.length - MAX_RESULT_CHARS} characters]`
  return text
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
          const text = resultText(result)
          if (result?.isError === true) throw new Error(text)
          return text
        },
      })
    }
    return definitions
  }

  function syncAgent(agent) {
    let perAgent = mounted.get(agent)
    if (!perAgent) mounted.set(agent, perAgent = new Map())
    const sessionId = agent.session?.id
    for (const [id, current] of perAgent) {
      const entry = entries.get(id)
      const want = entry && entry.spec.enabled && entry.connection.status === 'connected' && enabledFor(sessionId, id)
      if (!want || current.version !== entry.toolsVersion || current.entry !== entry) {
        for (const dispose of current.disposers) dispose()
        perAgent.delete(id)
      }
    }
    for (const [id, entry] of entries) {
      if (perAgent.has(id)) continue
      if (!entry.spec.enabled || entry.connection.status !== 'connected' || !enabledFor(sessionId, id)) continue
      const disposers = []
      const definitions = toolDefinitions(entry)
      for (const definition of definitions) {
        try {
          disposers.push(agent.ctx.tools.register(definition))
        } catch (error) {
          entry.toolErrors[definition.name] = String(error.message ?? error)
        }
      }
      perAgent.set(id, { entry, version: entry.toolsVersion, disposers })
    }
  }

  function unmountAgent(agent) {
    for (const current of mounted.get(agent)?.values() ?? []) for (const dispose of current.disposers) dispose()
    mounted.delete(agent)
  }

  const syncAll = () => { if (!disposed) for (const agent of ctx.agents.list()) syncAgent(agent) }

  // ---- connections ------------------------------------------------------------------------------
  async function authHeaders(entry) {
    const grant = entry.grant
    if (!grant?.tokens?.access_token) return {}
    if (expired(grant.tokens) && grant.tokens.refresh_token) await refresh(entry)
    return entry.grant?.tokens?.access_token ? { authorization: `Bearer ${entry.grant.tokens.access_token}` } : {}
  }

  /**
   * Refresh once at a time per connector. Only a refused grant (`invalid_grant`, or a bare 400/401
   * from the token endpoint) drops the tokens so sign-in is offered; a network error, timeout or
   * server error keeps them and tries again in 30 seconds. A sign-out, edit or removal while the
   * request is out wins: the result is discarded and nothing is written.
   * @returns {Promise<boolean>} whether new tokens were stored.
   */
  function refresh(entry) {
    if (entry.refreshing) return entry.refreshing
    const run = (async () => {
      const grant = entry.grant
      const generation = entry.authGeneration
      let tokens
      let failure
      try {
        tokens = await refreshTokens({ metadata: grant.metadata, client: grant.client, tokens: grant.tokens, resource: grant.resource })
      } catch (error) {
        failure = error
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
    run.finally(() => { if (entry.refreshing === run) entry.refreshing = undefined }).catch(() => {})
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
      authHeaders: () => authHeaders(entry),
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
    entry.grant = { ...entry.grant, client, issuer: discovery.issuer, metadata: discovery.metadata, resource: discovery.resource, scope: discovery.scope }
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
      const spec = cleanSpec({ ...mergeSecrets(body, entry.spec), id, enabled: entry.spec.enabled }, new Set())
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
      return view(next)
    },
    async remove(id) {
      writable()
      need(id)
      removeEntry(id)
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
  }

  function need(id) {
    const entry = entries.get(id)
    if (!entry) throw httpError(404, 'No such connector')
    return entry
  }

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
