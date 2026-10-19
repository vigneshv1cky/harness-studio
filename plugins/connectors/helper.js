/**
 * Local helper for the Connectors Client half and the OAuth redirect.
 *
 * Harness gives out-of-tree plugins no generated Remote namespace for their own API, so the Host half
 * serves a small HTTP API on 127.0.0.1:
 *
 *   GET    /hello                          → { service, version }
 *   GET    /connectors?session=<id>        → every connector with status, tools and this Session's choice
 *   POST   /connectors                     → add one (JSON body: name, transport, url | command, …)
 *   PUT    /connectors/<id>                → replace its settings (reconnects)
 *   DELETE /connectors/<id>                → remove it and its sign-in
 *   POST   /connectors/<id>/enabled        → { enabled } — connect at all
 *   POST   /connectors/<id>/session        → { session, enabled } — tools on or off for one Session
 *   POST   /connectors/<id>/reconnect
 *   POST   /connectors/<id>/login          → opens the browser; returns { url }
 *   POST   /connectors/<id>/logout
 *   GET    /chrome-bridge-link            → { port, key } of the connected Harness Studio Chrome bridge, or {}
 *   GET    /oauth/callback?code&state      → the authorization server's redirect (an HTML page)
 *
 * Safety:
 *   - binds 127.0.0.1 only and requires the Host header to name it, so a rebinding DNS name cannot reach it;
 *   - every API route requires the per-launch secret in the `x-connectors-key` header. The Host half
 *     makes a new random secret each time it starts and hands it, with the port, only to its own
 *     Client half over Harness's authenticated Client↔Host channel (see index.js → "helper access"),
 *     so another local process, or another Harness instance's Client, cannot call this API;
 *   - every API route also requires an Origin of the Harness app (Desktop `dsh-app://app`, or the Web
 *     origins); writes must be JSON, which browsers cannot send cross-site without a preflight;
 *   - the OAuth callback carries neither; it only completes a login this process started, matched by
 *     its unguessable `state`, within ten minutes.
 */
import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

export const SERVICE = 'harness-studio-connectors'
export const VERSION = 1
export const BASE_PORT = 47620
export const PORT_ATTEMPTS = 5
const DEFAULT_ORIGINS = ['dsh-app://app', 'http://127.0.0.1:3080', 'http://localhost:3080']
const MAX_BODY_BYTES = 64 * 1024
/** Request header that carries the per-launch secret. */
export const KEY_HEADER = 'x-connectors-key'

/** Constant-time comparison of the presented key with the secret. */
function keyMatches(presented, secret) {
  if (typeof presented !== 'string') return false
  const a = Buffer.from(presented)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function page(ok, message) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Harness connectors</title>
<style>body{font:15px/22px -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#1f2328;background:#f6f7f9}
main{max-width:420px;padding:28px 32px;background:#fff;border-radius:14px;box-shadow:0 0 0 .5px #d0d4da,0 6px 24px rgba(0,0,0,.06)}
h1{font-size:17px;margin:0 0 8px}p{margin:0;color:#59636e}@media(prefers-color-scheme:dark){body{background:#16181c;color:#e6e8eb}main{background:#1f2227;box-shadow:0 0 0 .5px #3a3f47}p{color:#a2a9b3}}</style>
<main><h1>${ok ? 'Signed in' : 'Sign-in did not finish'}</h1><p>${escapeHtml(message)}</p></main>`
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('Request too large'), { status: 413 })); request.destroy(); return }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try { resolve(JSON.parse(text)) } catch { reject(Object.assign(new Error('Body must be JSON'), { status: 400 })) }
    })
    request.on('error', reject)
  })
}

/**
 * @param {{ routes: object, secret: string, origins?: string[] }} options - `secret` is the per-launch
 *   key every API request must present.
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export async function startHelper({ routes, secret, origins: allowed = DEFAULT_ORIGINS }) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('startHelper needs a random secret of at least 32 characters')
  const origins = new Set(allowed)
  let port = 0
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin
    const corsHeaders = origin && origins.has(origin)
      ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, PUT, DELETE', 'access-control-allow-headers': `content-type, ${KEY_HEADER}`, 'access-control-max-age': '600' }
      : {}
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Origin', ...corsHeaders })
      response.end(JSON.stringify(body))
    }
    const host = request.headers.host ?? ''
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(421, { error: 'wrong host' })
    const url = new URL(request.url, `http://127.0.0.1:${port}`)

    if (url.pathname === '/oauth/callback' && request.method === 'GET') {
      const result = await routes.callback(url.searchParams).catch(error => ({ ok: false, message: String(error.message ?? error) }))
      response.writeHead(result.ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
      response.end(page(result.ok, result.message))
      return
    }

    if (!origin || !origins.has(origin)) return send(403, { error: 'origin not allowed' })
    // A CORS preflight cannot carry the key; it answers only the CORS headers and reaches no route.
    if (request.method === 'OPTIONS') { response.writeHead(204, { ...corsHeaders, vary: 'Origin' }); response.end(); return }
    if (!keyMatches(request.headers[KEY_HEADER], secret)) return send(401, { error: 'missing or wrong helper key' })
    if (request.method !== 'GET' && request.method !== 'DELETE' && !(request.headers['content-type'] ?? '').startsWith('application/json')) {
      return send(415, { error: 'JSON only' })
    }
    try {
      const parts = url.pathname.split('/').filter(Boolean)
      if (url.pathname === '/hello') return send(200, { service: SERVICE, version: VERSION })
      if (url.pathname === '/chrome-bridge-link' && request.method === 'GET') return send(200, await routes.chromeBridgeLink())
      if (parts[0] !== 'connectors') return send(404, { error: 'not found' })
      const id = parts[1] ? decodeURIComponent(parts[1]) : undefined
      const action = parts[2]
      if (!id && request.method === 'GET') return send(200, await routes.list({ session: url.searchParams.get('session') ?? undefined }))
      if (!id && request.method === 'POST') return send(200, await routes.add(await readBody(request)))
      if (id && !action && request.method === 'PUT') return send(200, await routes.edit(id, await readBody(request)))
      if (id && !action && request.method === 'DELETE') return send(200, await routes.remove(id))
      if (id && request.method === 'POST' && ['enabled', 'session', 'reconnect', 'login', 'logout'].includes(action)) {
        return send(200, await routes[action](id, await readBody(request)))
      }
      return send(404, { error: 'not found' })
    } catch (error) {
      return send(error.status ?? 400, { error: String(error.message ?? error) })
    }
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
      return { port, close: () => new Promise(resolve => server.close(() => resolve())) }
    }
  }
  throw new Error(`no free port in ${BASE_PORT}-${BASE_PORT + PORT_ATTEMPTS - 1}`)
}
