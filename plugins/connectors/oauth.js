/**
 * OAuth 2.1 sign-in for remote MCP servers, following the MCP authorization spec:
 *
 *   1. Discovery: the server's 401 names its protected-resource metadata (RFC 9728), or it is found at
 *      the well-known path; that metadata names the authorization server, whose metadata (RFC 8414,
 *      or OpenID discovery) gives the endpoints. Servers from before RFC 9728 are their own
 *      authorization server, with the spec's default endpoint paths as a last resort.
 *   2. Client: dynamic client registration (RFC 7591) as a public client with the loopback redirect,
 *      or a client id the user typed when the server does not register clients.
 *   3. Authorization code with PKCE (S256) and the `resource` indicator (RFC 8707), in the user's
 *      browser; the loopback helper receives the redirect.
 *   4. Token exchange, and refresh when the access token expires or is refused.
 *
 * What discovery accepts:
 *   - protected-resource metadata only when its `resource` is the connector's URL, or a path prefix
 *     of it on the same origin (RFC 9728 §3.3); one that names another resource is refused;
 *   - authorization-server metadata only when its `issuer` is the issuer it was fetched for
 *     (RFC 8414 §3.3, OpenID Discovery §4.3);
 *   - endpoints (authorization, token, registration, device) only over https, or http on
 *     localhost / 127.0.0.1 / [::1];
 *   - servers that list `code_challenge_methods_supported` must include S256.
 *
 * Nothing here stores anything: callers persist the returned grant.
 */
import { createHash, randomBytes } from 'node:crypto'

const FETCH_TIMEOUT_MS = 15000
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const base64url = buffer => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Fetch JSON with a timeout; undefined for a non-2xx answer or non-JSON body. */
async function getJson(url) {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json', 'mcp-protocol-version': '2025-06-18' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) { await response.body?.cancel(); return undefined }
    return await response.json()
  } catch {
    return undefined
  }
}

/** Whether `url` is https, or http on a loopback host. */
export function isSecureUrl(url) {
  let parsed
  try { parsed = new URL(url) } catch { return false }
  return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname))
}

/** Throw unless `url` is an https (or loopback http) URL; `label` names it in the message. */
export function requireSecureUrl(url, label) {
  if (typeof url !== 'string' || !isSecureUrl(url)) {
    throw new Error(`The server's ${label} (${String(url).slice(0, 200)}) is not an https:// URL, so Harness will not use it.`)
  }
  return url
}

/** Check one authorization server's metadata before any of it is used. */
function checkMetadata(metadata) {
  requireSecureUrl(metadata.authorization_endpoint, 'authorization endpoint')
  requireSecureUrl(metadata.token_endpoint, 'token endpoint')
  if (metadata.registration_endpoint !== undefined) requireSecureUrl(metadata.registration_endpoint, 'client registration endpoint')
  const methods = metadata.code_challenge_methods_supported
  if (methods !== undefined && !(Array.isArray(methods) && methods.includes('S256'))) {
    throw new Error('The authorization server does not support PKCE with S256, which MCP sign-in requires.')
  }
  return metadata
}

/** Issuer identifiers compare exactly, except that one trailing slash is not significant. */
const sameIssuer = (a, b) => typeof a === 'string' && typeof b === 'string' && a.replace(/\/$/, '') === b.replace(/\/$/, '')

/**
 * Whether protected-resource metadata may describe `serverUrl`: its `resource` is the same URL, or a
 * path prefix of it (ending at a segment boundary) on the same origin.
 */
export function resourceCovers(resource, serverUrl) {
  let claimed, server
  try { claimed = new URL(resource); server = new URL(serverUrl) } catch { return false }
  if (claimed.origin !== server.origin || claimed.search || claimed.hash) {
    return canonicalResource(resource) === canonicalResource(serverUrl)
  }
  const prefix = claimed.pathname.replace(/\/$/, '')
  const path = server.pathname
  return prefix === '' || path === prefix || path.startsWith(prefix + '/')
}

/** Read one parameter (`resource_metadata`, `scope`, …) from a WWW-Authenticate Bearer challenge. */
export function challengeParam(header, name) {
  if (!header) return undefined
  const match = new RegExp(`${name}="([^"]*)"|${name}=([^,\\s]*)`, 'i').exec(header)
  return match ? (match[1] ?? match[2]) : undefined
}

/** The canonical resource URI for the MCP server: no fragment, no trailing slash on a bare path. */
export function canonicalResource(serverUrl) {
  const url = new URL(serverUrl)
  url.hash = ''
  let text = url.toString()
  if (url.pathname === '/' && !url.search) text = text.replace(/\/$/, '')
  return text
}

/** Candidate well-known URLs with the issuer's path inserted after the well-known segment, then at the root. */
function wellKnown(base, suffix) {
  const url = new URL(base)
  const path = url.pathname.replace(/\/$/, '')
  const list = []
  if (path) list.push(`${url.origin}/.well-known/${suffix}${path}`)
  list.push(`${url.origin}/.well-known/${suffix}`)
  return list
}

/**
 * Find the authorization server and its endpoints for one MCP server.
 * @param {string} serverUrl - the MCP endpoint.
 * @param {string | undefined} wwwAuthenticate - the 401 challenge, if one was seen.
 * @returns {Promise<{ issuer: string, metadata: object, scope?: string, resource: string }>}
 */
export async function discover(serverUrl, wwwAuthenticate) {
  const resource = canonicalResource(serverUrl)
  // Protected-resource metadata: the challenge's hint first, then the well-known paths. A document
  // that names another resource is refused outright (it would send tokens for this server to an
  // authorization server chosen by someone else); one without a `resource` is skipped.
  const accept = (candidate, from) => {
    if (!candidate || typeof candidate !== 'object') return undefined
    if (typeof candidate.resource !== 'string') return undefined
    if (!resourceCovers(candidate.resource, serverUrl)) {
      throw new Error(`The protected-resource metadata at ${from} is for ${candidate.resource}, not ${resource}. Harness will not sign in with it.`)
    }
    return candidate
  }
  let protectedResource
  const hinted = challengeParam(wwwAuthenticate, 'resource_metadata')
  if (hinted) {
    let hintUrl
    try { hintUrl = new URL(hinted, serverUrl) } catch { hintUrl = undefined }
    if (hintUrl && isSecureUrl(hintUrl)) protectedResource = accept(await getJson(hintUrl), hintUrl.toString())
  }
  if (!protectedResource) {
    for (const candidate of wellKnown(serverUrl, 'oauth-protected-resource')) {
      protectedResource = accept(await getJson(candidate), candidate)
      if (protectedResource) break
    }
  }
  const named = protectedResource?.authorization_servers?.[0]
  const issuer = typeof named === 'string' ? named : new URL(serverUrl).origin
  requireSecureUrl(issuer, 'authorization server')
  // Authorization-server metadata must name the issuer it was fetched for.
  let metadata
  let mismatch
  for (const candidate of [...wellKnown(issuer, 'oauth-authorization-server'), ...wellKnown(issuer, 'openid-configuration')]) {
    const found = await getJson(candidate)
    if (!found?.authorization_endpoint || !found?.token_endpoint) continue
    if (!sameIssuer(found.issuer, issuer)) { mismatch ??= `${candidate} names issuer ${String(found.issuer)}`; continue }
    metadata = found
    break
  }
  if (!metadata && mismatch) throw new Error(`The authorization server's metadata does not match ${issuer} (${mismatch}). Harness will not sign in with it.`)
  if (!metadata) {
    // Pre-discovery servers: the spec's default endpoint paths on the server's own origin.
    const origin = new URL(issuer).origin
    metadata = { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register` }
  }
  checkMetadata(metadata)
  const scope = challengeParam(wwwAuthenticate, 'scope') ?? protectedResource?.scopes_supported?.join(' ')
  return { issuer, metadata, scope: scope || undefined, resource: protectedResource?.resource ?? resource }
}

/**
 * Register a public client for the loopback redirect.
 * @returns {Promise<{ client_id: string, client_secret?: string, redirect_uri: string }>}
 */
export async function registerClient(metadata, redirectUri) {
  if (!metadata.registration_endpoint) {
    throw new Error('This server does not register clients automatically. Add an OAuth client ID to the connector.')
  }
  requireSecureUrl(metadata.registration_endpoint, 'client registration endpoint')
  const response = await fetch(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Harness Studio',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Client registration failed (HTTP ${response.status}): ${(await response.text().catch(() => '')).slice(0, 300)}`)
  const client = await response.json()
  if (typeof client.client_id !== 'string') throw new Error('Client registration returned no client_id')
  return { client_id: client.client_id, client_secret: client.client_secret, redirect_uri: redirectUri }
}

/**
 * Build the browser URL and the secrets the callback needs.
 * @returns {{ url: string, state: string, verifier: string }}
 */
export function authorizationRequest({ metadata, client, scope, resource }) {
  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(24))
  const url = new URL(requireSecureUrl(metadata.authorization_endpoint, 'authorization endpoint'))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', client.client_id)
  url.searchParams.set('redirect_uri', client.redirect_uri)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('resource', resource)
  if (scope) url.searchParams.set('scope', scope)
  return { url: url.toString(), state, verifier }
}

/** The token endpoint answered and refused; `status` and `error` say how. Network failures stay plain errors. */
export class TokenError extends Error {
  constructor(status, error, message) {
    super(message)
    this.name = 'TokenError'
    this.status = status
    this.error = error
  }
}

/**
 * Whether a failed refresh means the grant is gone (revoked, expired or unknown refresh token), so
 * the tokens should be dropped and sign-in offered. Network errors, timeouts and server errors are
 * not: the tokens are kept and the refresh is retried later.
 */
export function grantRevoked(error) {
  return error instanceof TokenError && (error.error === 'invalid_grant' || (error.error === undefined && (error.status === 400 || error.status === 401)))
}

const CLIENT_AUTH_ERRORS = new Set(['invalid_client', 'unauthorized_client', 'incorrect_client_credentials'])

/** POST one token request; `secretIn` says where a client secret goes (HTTP Basic or the form body). */
async function postToken(metadata, client, fields, secretIn) {
  const body = new URLSearchParams({ ...fields, client_id: client.client_id })
  const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }
  if (client.client_secret && secretIn === 'basic') {
    headers.authorization = 'Basic ' + Buffer.from(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`).toString('base64')
  } else if (client.client_secret) {
    body.set('client_secret', client.client_secret)
  }
  const response = await fetch(requireSecureUrl(metadata.token_endpoint, 'token endpoint'), { method: 'POST', headers, body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  const text = await response.text()
  let json
  try { json = JSON.parse(text) } catch { json = Object.fromEntries(new URLSearchParams(text)) }
  return { response, json }
}

/**
 * POST a token request and turn the answer into a stored token set. A confidential client uses
 * HTTP Basic unless the server lists only `client_secret_post`; when Basic is refused as a client
 * error (some servers, GitHub among them, read the secret only from the body), it retries once
 * with the secret in the body.
 */
async function tokenRequest(metadata, client, fields) {
  const methods = metadata.token_endpoint_auth_methods_supported
  let secretIn = Array.isArray(methods) && methods.includes('client_secret_post') && !methods.includes('client_secret_basic') ? 'post' : 'basic'
  let { response, json } = await postToken(metadata, client, fields, secretIn)
  if (client.client_secret && secretIn === 'basic' && typeof json.access_token !== 'string' && CLIENT_AUTH_ERRORS.has(json.error)) {
    secretIn = 'post'
    ;({ response, json } = await postToken(metadata, client, fields, secretIn))
  }
  if (!response.ok || typeof json.access_token !== 'string') {
    throw new TokenError(response.status, typeof json.error === 'string' ? json.error : undefined,
      `Token request failed (HTTP ${response.status})${json.error ? ': ' + json.error + (json.error_description ? ' — ' + json.error_description : '') : ''}`)
  }
  return {
    access_token: json.access_token,
    token_type: json.token_type ?? 'Bearer',
    refresh_token: json.refresh_token ?? fields.refresh_token,
    scope: json.scope,
    expires_at: typeof json.expires_in === 'number' ? Date.now() + json.expires_in * 1000 : typeof json.expires_in === 'string' && /^\d+$/.test(json.expires_in) ? Date.now() + Number(json.expires_in) * 1000 : undefined,
  }
}

/** Exchange the authorization code from the redirect. */
export function exchangeCode({ metadata, client, code, verifier, resource }) {
  return tokenRequest(metadata, client, { grant_type: 'authorization_code', code, redirect_uri: client.redirect_uri, code_verifier: verifier, resource })
}

/** Refresh an access token. */
export function refreshTokens({ metadata, client, tokens, resource }) {
  if (!tokens?.refresh_token) return Promise.reject(new Error('No refresh token'))
  return tokenRequest(metadata, client, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource })
}

/** Whether a token set is expired or about to be (one minute of slack). */
export function expired(tokens) {
  return tokens?.expires_at !== undefined && tokens.expires_at - 60000 < Date.now()
}

const cancelled = () => new Error('Sign-in was cancelled')

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(cancelled()); return }
  const onAbort = () => { clearTimeout(timer); reject(cancelled()) }
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
  signal?.addEventListener('abort', onAbort, { once: true })
})

/**
 * Start a device authorization (RFC 8628): the user enters `user_code` at `verification_uri`.
 * @returns {Promise<{ device_code: string, user_code: string, verification_uri: string, verification_uri_complete?: string, expires_in: number, interval?: number }>}
 */
export async function requestDeviceCode({ endpoint, clientId, scope }) {
  requireSecureUrl(endpoint, 'device authorization endpoint')
  const body = new URLSearchParams({ client_id: clientId })
  if (scope) body.set('scope', scope)
  const response = await fetch(endpoint, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  const json = await response.json().catch(() => ({}))
  if (!response.ok || typeof json.device_code !== 'string' || typeof json.user_code !== 'string') {
    throw new Error(`Could not start sign-in (HTTP ${response.status})${json.error ? ': ' + (json.error_description ?? json.error) : ''}`)
  }
  return json
}

/**
 * Poll the token endpoint until the user approves the device code, it expires, or `signal` aborts.
 * @returns {Promise<object>} a token set as stored for the connector.
 */
export async function pollDeviceToken({ tokenEndpoint, clientId, device, signal }) {
  let interval = Math.max(5, device.interval ?? 5) * 1000
  const deadline = Date.now() + (device.expires_in ?? 900) * 1000
  requireSecureUrl(tokenEndpoint, 'token endpoint')
  while (Date.now() < deadline) {
    await sleep(interval, signal)
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, device_code: device.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const json = await response.json().catch(() => ({}))
    // A token that arrives after cancellation is not handed back.
    if (signal?.aborted) throw cancelled()
    if (typeof json.access_token === 'string') {
      return {
        access_token: json.access_token,
        token_type: json.token_type ?? 'Bearer',
        refresh_token: json.refresh_token,
        scope: json.scope,
        expires_at: typeof json.expires_in === 'number' ? Date.now() + json.expires_in * 1000 : undefined,
      }
    }
    if (json.error === 'authorization_pending') continue
    if (json.error === 'slow_down') { interval = (typeof json.interval === 'number' ? json.interval * 1000 : interval + 5000); continue }
    if (json.error === 'expired_token') break
    if (json.error === 'access_denied') throw new Error('Sign-in was declined')
    throw new Error(`Sign-in failed${json.error ? ': ' + (json.error_description ?? json.error) : ` (HTTP ${response.status})`}`)
  }
  throw new Error('The sign-in code expired. Start again.')
}
