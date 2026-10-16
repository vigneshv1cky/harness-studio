// MCP Streamable HTTP server that is also its own OAuth authorization server (tests only).
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
const PORT = Number(process.argv[2] ?? 47700)
const ORIGIN = `http://127.0.0.1:${PORT}`
const clients = new Map(), codes = new Map(), tokens = new Map(), refresh = new Map()
const log = (...a) => console.log('[http-server]', ...a)
// Test switches for the token endpoint: 'up', 'down' (drops the connection: a network error) or 'revoked' (invalid_grant).
let tokenMode = 'up'
const b64u = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
const body = req => new Promise(r => { let s = ''; req.on('data', c => s += c); req.on('end', () => r(s)) })
const issue = () => { const access = 'at-' + b64u(randomBytes(9)); const rt = 'rt-' + b64u(randomBytes(9)); tokens.set(access, Date.now() + 4000); refresh.set(rt, true); return { access_token: access, token_type: 'Bearer', expires_in: 4, refresh_token: rt } }
createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN)
  if (url.pathname === '/.well-known/oauth-protected-resource/mcp' || url.pathname === '/.well-known/oauth-protected-resource') return json(res, 200, { resource: ORIGIN + '/mcp', authorization_servers: [ORIGIN], scopes_supported: ['tools'] })
  if (url.pathname === '/.well-known/oauth-authorization-server') return json(res, 200, { issuer: ORIGIN, authorization_endpoint: ORIGIN + '/authorize', token_endpoint: ORIGIN + '/token', registration_endpoint: ORIGIN + '/register', code_challenge_methods_supported: ['S256'] })
  if (url.pathname === '/register') { const reg = JSON.parse(await body(req)); const id = 'client-' + b64u(randomBytes(6)); clients.set(id, reg); log('registered', id, reg.redirect_uris); return json(res, 201, { client_id: id, ...reg }) }
  if (url.pathname === '/authorize') {
    const p = url.searchParams
    const reg = clients.get(p.get('client_id'))
    if (!reg || !reg.redirect_uris.includes(p.get('redirect_uri')) || p.get('code_challenge_method') !== 'S256' || p.get('resource') !== ORIGIN + '/mcp') { res.writeHead(400); return res.end('bad authorize request ' + url.search) }
    const code = 'code-' + b64u(randomBytes(9)); codes.set(code, { challenge: p.get('code_challenge'), client: p.get('client_id'), redirect: p.get('redirect_uri') })
    log('authorize ok, scope=', p.get('scope'))
    res.writeHead(302, { location: `${p.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(p.get('state'))}` }); return res.end()
  }
  if (url.pathname === '/test/token-mode') { tokenMode = url.searchParams.get('mode') ?? 'up'; log('token endpoint', tokenMode); return json(res, 200, { tokenMode }) }
  if (url.pathname === '/token') {
    const p = new URLSearchParams(await body(req))
    if (p.get('grant_type') === 'refresh_token' && tokenMode === 'down') { log('token endpoint down'); return req.socket.destroy() }
    if (p.get('grant_type') === 'refresh_token' && tokenMode === 'revoked') { refresh.delete(p.get('refresh_token')); return json(res, 400, { error: 'invalid_grant' }) }
    if (p.get('grant_type') === 'authorization_code') {
      const c = codes.get(p.get('code')); codes.delete(p.get('code'))
      if (!c || b64u(createHash('sha256').update(p.get('code_verifier') ?? '').digest()) !== c.challenge || c.redirect !== p.get('redirect_uri')) return json(res, 400, { error: 'invalid_grant' })
      log('token issued via code'); return json(res, 200, issue())
    }
    if (p.get('grant_type') === 'refresh_token' && refresh.has(p.get('refresh_token'))) { refresh.delete(p.get('refresh_token')); log('token refreshed'); return json(res, 200, issue()) }
    return json(res, 400, { error: 'invalid_grant' })
  }
  if (url.pathname === '/mcp') {
    const auth = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    const exp = tokens.get(auth)
    if (!exp || exp < Date.now()) { log('401 for', auth ? 'expired/unknown token' : 'no token'); return json(res, 401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="tools"` }) }
    if (req.method === 'GET') { res.writeHead(405); return res.end() }
    if (req.method === 'DELETE') { res.writeHead(200); return res.end() }
    const m = JSON.parse(await body(req))
    if (!('id' in m)) { res.writeHead(202); return res.end() }
    let result
    if (m.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'http-test', version: '2.0.0' } }
    else if (m.method === 'tools/list') result = { tools: [{ name: 'whoami', description: 'Say who is signed in.', inputSchema: { type: 'object', properties: {} } }] }
    else if (m.method === 'tools/call') result = { content: [{ type: 'text', text: 'signed in with ' + auth.slice(0, 6) }] }
    else return json(res, 200, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'nope' } })
    if (m.method === 'tools/call') { // answer over SSE to exercise that path
      res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' })
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n\n`); return res.end()
    }
    return json(res, 200, { jsonrpc: '2.0', id: m.id, result }, { 'mcp-session-id': 'sess-1' })
  }
  res.writeHead(404); res.end()
}).listen(PORT, '127.0.0.1', () => log('listening', PORT))
