// End-to-end check of the Connectors host half with a stand-in Harness context.
// Starts the plugin, drives its helper API like the Client does, and checks tool registration per
// Session, OAuth sign-in (the bin/open stand-in browser follows the authorize redirect), token
// refresh and persistence across a restart, plus the security checks: the helper key, masked
// secrets, id collisions, refresh failures, OAuth endpoint and metadata validation, the legacy SSE
// endpoint origin, the stdio environment allowlist and a corrupt settings file. See README.md → Tests.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { discover, authorizationRequest, pollDeviceToken } from '../oauth.js'
import { McpConnection, serverEnv } from '../mcp-connection.js'
import { MASK } from '../store.js'
const PLUGIN = new URL('../index.js', import.meta.url).href
const here = path.dirname(new URL(import.meta.url).pathname)
const home = mkdtempSync(path.join(tmpdir(), 'conn-home-'))
const wait = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (label, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`) }
const HTTP_TEST = 'http://127.0.0.1:47700'
const serverStats = async () => (await fetch(`${HTTP_TEST}/test/stats`)).json()

function makeAgent(id) {
  const tools = new Map()
  return { session: { id }, tools, ctx: { tools: { register(def) { if (tools.has(def.name)) throw new Error('dup ' + def.name); tools.set(def.name, def); return () => tools.delete(def.name) } } } }
}
const agents = [makeAgent('s1'), makeAgent('s2')]
// Stand-in for Harness's credential store; it outlives plugin restarts, as the real one does.
const records = new Map()
const credentials = {
  async readRecord(key) { return records.get(key) },
  async modifyRecord(key, mutate) { const next = await mutate(records.get(key)); if (next === undefined) records.delete(key); else records.set(key, JSON.parse(JSON.stringify(next))); return next },
  async deleteRecord(key) { records.delete(key) },
}

/** The helper's port and key, as the Client gets them from the `harnessStudioConnectors/helper` Remote. */
let conn
async function boot(homeDir = home) {
  const plugin = await import(PLUGIN + '?v=' + Math.random())
  const handlers = {}; const cleanups = []; const provided = {}
  const self = { handlers, fullAccess: false, imageModel: true }
  const sandboxPolicy = { resolve: () => ({ mode: self.fullAccess ? 'danger-full-access' : 'workspace-write' }) }
  // Stand-ins for Harness's attachment store and model catalog, for images in tool results.
  const attachments = { saveImages: async images => images.map((image, n) => ({ attachmentId: `att-${n}`, mediaType: image.mediaType, bytes: image.data.byteLength, width: 1, height: 1 })) }
  const llm = { resolveModelInfo: async () => ({ inputModalities: self.imageModel ? ['text', 'image'] : ['text'] }) }
  const services = { profileContext: { home: homeDir }, credentials, sandboxPolicy, attachments, llm }
  const ctx = {
    get: n => services[n],
    on: (e, f) => { handlers[e] = f }, effect: f => { cleanups.push(f()) }, agents: { list: () => agents },
    provide: (name, value) => { provided[name] = value },
  }
  plugin.apply(ctx)
  for (const a of agents) handlers['agent/created']({ agent: a })
  const access = provided[plugin.HELPER_SERVICE]
  const facts = await until(() => { const f = access?.helper(); return f?.port ? f : undefined }, 10000)
  conn = facts
  return Object.assign(self, { access, facts, stop: async () => { for (const c of cleanups) await c?.() } })
}
const api = async (method, route, body, { key = conn.key, origin = 'dsh-app://app' } = {}) => {
  const headers = { ...(origin ? { origin } : {}), ...(key ? { 'x-connectors-key': key } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }
  const res = await fetch(`http://127.0.0.1:${conn.port}` + route, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, body: await res.json() }
}
async function until(fn, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(150) } return undefined }
const status = async (id, session = 's1') => (await api('GET', '/connectors?session=' + session)).body.connectors.find(c => c.id === id)
const grantOf = id => records.get(`harness-studio-connectors/${id}`)?.payload

let app = await boot()
check('helper facts come from the Remote method', Number.isInteger(app.facts.port) && typeof app.facts.key === 'string' && app.facts.key.length >= 40)
check('helper answers with the key', (await api('GET', '/hello')).body.service === 'harness-studio-connectors')
const noOrigin = await fetch(`http://127.0.0.1:${conn.port}/connectors`, { headers: { 'x-connectors-key': conn.key } })
check('request without the app origin is refused', noOrigin.status === 403)
const noKey = await api('GET', '/connectors', undefined, { key: null })
check('request with the app origin but no key is refused', noKey.status === 401 && !('connectors' in noKey.body), JSON.stringify(noKey))
const wrongKey = await api('POST', '/connectors', { name: 'Evil', transport: 'stdio', command: 'touch', args: ['/tmp/pwned'] }, { key: 'x'.repeat(43) })
check('add with a wrong key is refused', wrongKey.status === 401)

// stdio
const added = await api('POST', '/connectors', { name: 'Stdio Test', transport: 'stdio', command: process.execPath, args: [path.join(here, 'stdio-server.mjs')], env: { STDIO_SECRET: 'env-sekret-123' } })
check('add stdio connector', added.status === 200, added.body.id)
const sid = added.body.id
check('environment values are masked in the answer', added.body.env?.STDIO_SECRET === MASK && !JSON.stringify(added.body).includes('env-sekret-123'), JSON.stringify(added.body.env))
const conn1 = await until(async () => { const c = await status(sid); return c?.status === 'connected' && c })
check('stdio connects', !!conn1, conn1 ? conn1.tools.map(t => t.publicName).join(', ') : JSON.stringify(await status(sid)))
check('tools registered for s1 and s2', agents[0].tools.has(`mcp__${sid}__echo`) && agents[1].tools.has(`mcp__${sid}__add`))
const echo = await agents[0].tools.get(`mcp__${sid}__echo`).execute({ text: 'hi' }, { signal: new AbortController().signal })
check('tool call returns text', echo === 'echo: hi', echo)

// The Chrome bridge's link key reaches only this plugin's own window, read over the bridge's stdio pipe.
{
  const noBridge = await api('GET', '/chrome-bridge-link')
  check('without a Chrome bridge connector the link is empty', noBridge.status === 200 && Object.keys(noBridge.body).length === 0, JSON.stringify(noBridge.body))
  const bridgeServer = path.resolve(here, '..', '..', '..', 'chrome-bridge', 'server.mjs')
  const bridge = await api('POST', '/connectors', { name: 'Chrome Test', transport: 'stdio', command: process.execPath, args: [bridgeServer], env: { HS_CHROME_PORT: '47698', HS_CHROME_PAIRING_CODE: 'TEST1-TEST2-TEST3-TEST4' } })
  const bridgeId = bridge.body.id
  await until(async () => (await status(bridgeId))?.status === 'connected')
  const link = await until(async () => { const r = await api('GET', '/chrome-bridge-link'); return r.body?.key ? r.body : undefined })
  check('the connected bridge\'s link key is handed to the window', link?.port === 47698 && /^[0-9a-f]{64}$/.test(link?.key ?? ''), JSON.stringify(link ?? {}).slice(0, 40))
  const keyless = await api('GET', '/chrome-bridge-link', undefined, { key: 'x'.repeat(43) })
  check('the link needs the helper key like every other route', keyless.status === 401, String(keyless.status))
  await api('DELETE', `/connectors/${bridgeId}`)
}

// Images in a result reach the model as attachments when the session's model accepts images.
{
  const picture = agents[0].tools.get(`mcp__${sid}__picture`)
  const agent = { session: { id: 's1' }, options: { provider: 'test', model: 'vision-model' } }
  const exec = { signal: new AbortController().signal, agent }
  const shownText = await picture.execute({}, exec)
  const projected = picture.projectContent(exec, { isError: false, value: shownText, content: [{ type: 'text', text: shownText }] })
  check('an image result is attached for a model that accepts images', /attached below/.test(shownText) && /A dot\./.test(shownText) && projected?.[1]?.type === 'image' && projected[1].attachment.mediaType === 'image/png', JSON.stringify(projected))
  const replaced = { signal: new AbortController().signal, agent }
  const again = await picture.execute({}, replaced)
  check('…but not when a policy replaced the result', picture.projectContent(replaced, { isError: false, value: 'something else', content: [{ type: 'text', text: 'something else' }] }) === undefined && /attached below/.test(again))
  app.imageModel = false
  const plainExec = { signal: new AbortController().signal, agent }
  const plain = await picture.execute({}, plainExec)
  check('…and noted, with the reason, for a model without image input', /not shown: the current model \(vision-model\) does not accept images/.test(plain) && picture.projectContent(plainExec, { isError: false, value: plain, content: [{ type: 'text', text: plain }] }) === undefined, plain)
  app.imageModel = true
}

// Asking before calls: off by default; `changes` asks for tools the server does not mark read-only
// (`add` is marked read-only, `echo` is not); `always` asks for every call; full access lifts it.
{
  const gate = handlers => handlers['tools/pre-execute']
  const decide = (tool, { session = { id: 's1' }, before = { kind: 'allow' } } = {}) =>
    gate(app.handlers)({ name: `mcp__${sid}__${tool}`, arguments: {}, agent: { session } }, async () => before)
  const editAsk = ask => api('PUT', `/connectors/${sid}`, { name: 'Stdio Test', transport: 'stdio', command: process.execPath, args: [path.join(here, 'stdio-server.mjs')], env: { STDIO_SECRET: MASK }, ask })
  check('calls do not ask by default', (await decide('echo')).kind === 'allow' && (await status(sid)).ask === undefined)
  check('an unknown ask value is refused', (await editAsk('sometimes')).status === 400)
  await editAsk('changes')
  await until(async () => (await status(sid))?.status === 'connected')
  const asked = await decide('echo')
  check('"changes" asks before a tool not marked read-only', asked.kind === 'ask' && /Stdio Test/.test(asked.displayReason.en) && /change things/.test(asked.reason), JSON.stringify(asked))
  check('"changes" lets a read-only tool through', (await decide('add')).kind === 'allow')
  check('the list shows the setting', (await status(sid)).ask === 'changes')
  await editAsk('always')
  await until(async () => (await status(sid))?.status === 'connected')
  check('"always" asks before every call', (await decide('add')).kind === 'ask')
  const denied = { kind: 'deny', reason: 'a hook said no' }
  check('an earlier denial stands', (await decide('add', { before: denied })) === denied)
  check('other tools are not affected', (await gate(app.handlers)({ name: 'web_fetch', arguments: {}, agent: { session: { id: 's1' } } }, async () => ({ kind: 'allow' }))).kind === 'allow')
  app.fullAccess = true
  check('full access lifts it', (await decide('echo')).kind === 'allow')
  app.fullAccess = false
  await editAsk('never')
  await until(async () => (await status(sid))?.status === 'connected')
  check('"never" stops asking and is not stored', (await decide('echo')).kind === 'allow' && (await status(sid)).ask === undefined)
  check('the stored environment value survives the edits', (await status(sid)).env?.STDIO_SECRET === MASK)
  // Read-only labels are the server's own hints: for a server not on this computer they count only on a
  // tool whose name reads as a lookup.
  const { treatedReadOnly } = await import(PLUGIN)
  const remote = { transport: 'http', url: 'https://mcp.example.com/mcp' }
  const ro = name => ({ name, readOnly: true })
  check('"changes" trusts a read-only label from a server on this computer', treatedReadOnly({ transport: 'stdio' }, ro('delete_all')) && treatedReadOnly({ transport: 'http', url: 'http://127.0.0.1:9/mcp' }, ro('send')))
  check('for a remote server a read-only label counts only on a lookup name', treatedReadOnly(remote, ro('get_issue')) && treatedReadOnly(remote, ro('listRepos')) && treatedReadOnly(remote, ro('search'))
    && !treatedReadOnly(remote, ro('delete_issue')) && !treatedReadOnly(remote, ro('getaway')) && !treatedReadOnly(remote, ro('send_message')))
  check('a tool without the label always asks', !treatedReadOnly({ transport: 'stdio' }, { name: 'get_issue', readOnly: false }))
}

// A connector with more than 10 tools has them held back behind connector_tools until the model loads them.
const many = await api('POST', '/connectors', { name: 'Many Tools', transport: 'stdio', command: process.execPath, args: [path.join(here, 'stdio-server.mjs')], env: { STDIO_MANY_TOOLS: '12' } })
const mid = many.body.id
const manyUp = await until(async () => { const c = await status(mid); return c?.status === 'connected' && c })
check('a large connector connects', !!manyUp, JSON.stringify(await status(mid)))
const loader = await until(() => agents[0].tools.get('connector_tools'))
check('its tools are held back behind connector_tools', !!loader && !agents[0].tools.has(`mcp__${mid}__extra_7`) && loader.description.includes(`mcp__${mid}__extra_7`),
  loader ? loader.description.slice(0, 160) : 'no loader')
check('small connectors still register their tools directly', agents[0].tools.has(`mcp__${sid}__echo`))
const loadedText = await loader.execute({ query: 'issue tracker' }, { agent: agents[0], signal: new AbortController().signal })
check('a query loads the matching tool', agents[0].tools.has(`mcp__${mid}__extra_7`) && loadedText.includes(`mcp__${mid}__extra_7`), loadedText)
check('loading is per session', !agents[1].tools.has(`mcp__${mid}__extra_7`))
const ran = await agents[0].tools.get(`mcp__${mid}__extra_7`).execute({}, { signal: new AbortController().signal })
check('a loaded tool runs', ran === 'ran extra_7', ran)
await loader.execute({ names: ['extra_1', 'extra_2'] }, { agent: agents[0], signal: new AbortController().signal })
check('loading by short name works and keeps earlier loads', agents[0].tools.has(`mcp__${mid}__extra_1`) && agents[0].tools.has(`mcp__${mid}__extra_7`))
check('connector_tools lists only what is still held back', !agents[0].tools.get('connector_tools').description.includes(`mcp__${mid}__extra_7`))
await api('DELETE', `/connectors/${mid}`)
check('removing the connector removes connector_tools', await until(() => !agents[0].tools.has('connector_tools') && !agents[0].tools.has(`mcp__${mid}__extra_7`)))
await api('POST', `/connectors/${sid}/session`, { session: 's1', enabled: false })
check('off for s1 removes only s1 tools', !agents[0].tools.has(`mcp__${sid}__echo`) && agents[1].tools.has(`mcp__${sid}__echo`))
check('list reports s1 off', (await status(sid)).onInSession === false)
await api('POST', `/connectors/${sid}/session`, { session: 's1', enabled: true })
check('on again restores s1 tools', agents[0].tools.has(`mcp__${sid}__echo`))
await api('POST', `/connectors/${sid}/enabled`, { enabled: false })
check('turning connector off disconnects and removes tools', (await status(sid)).status === 'disabled' && !agents[1].tools.has(`mcp__${sid}__echo`))
await api('POST', `/connectors/${sid}/enabled`, { enabled: true })
check('turning it on reconnects', !!await until(async () => (await status(sid))?.status === 'connected'))

// id collision: a supplied id that is taken gets a fresh one, and the first connector keeps running
const clash = await api('POST', '/connectors', { id: sid, name: 'Clash', transport: 'stdio', command: process.execPath, args: [path.join(here, 'stdio-server.mjs')] })
check('adding with a taken id gets a new id', clash.status === 200 && clash.body.id !== sid, clash.body.id)
check('the original connector is untouched by the clash', (await status(sid))?.name === 'Stdio Test' && (await status(sid))?.status === 'connected')
await api('DELETE', `/connectors/${clash.body.id}`)
// a grant left under an id by an earlier connector is never picked up by a new one
records.set('harness-studio-connectors/stale-one', { kind: 'grant', payload: { tokens: { access_token: 'old-token' } } })
const stale = await api('POST', '/connectors', { name: 'Stale One', transport: 'http', url: 'http://127.0.0.1:1/mcp' })
check('a new connector does not inherit a leftover grant', stale.body.id === 'stale-one' && stale.body.signedIn === false && !records.has('harness-studio-connectors/stale-one'), JSON.stringify({ id: stale.body.id, signedIn: stale.body.signedIn }))
await api('DELETE', `/connectors/${stale.body.id}`)

// bad command
const bad = (await api('POST', '/connectors', { name: 'Broken', transport: 'stdio', command: 'definitely-not-a-command-xyz' })).body
const badState = await until(async () => { const c = await status(bad.id); return c?.status === 'failed' && c })
check('missing command shows failed with a reason', !!badState, badState?.error)
await api('DELETE', `/connectors/${bad.id}`)

// http + oauth, with a header and a client secret that must never come back
const hadd = await api('POST', '/connectors', { name: 'HTTP Test', transport: 'http', url: `${HTTP_TEST}/mcp`, headers: { 'X-Api-Key': 'hdr-sekret-456' } })
const hid = hadd.body.id
check('header values are masked in the answer', hadd.body.headers?.['X-Api-Key'] === MASK && !JSON.stringify(hadd.body).includes('hdr-sekret-456'))
const needs = await until(async () => { const c = await status(hid); return c?.status === 'needs-auth' && c })
check('protected server asks for sign-in', !!needs, needs?.error)
const login = await api('POST', `/connectors/${hid}/login`, {})
check('login returns an authorize URL', login.status === 200 && /\/authorize\?/.test(login.body.url ?? ''), login.body.error ?? '')
const signed = await until(async () => { const c = await status(hid); return c?.status === 'connected' && c }, 10000)
check('browser redirect completes sign-in and connects', !!signed, JSON.stringify(await status(hid)))
const who = agents[0].tools.get(`mcp__${hid}__whoami`)
check('http tool registered', !!who)
if (who) check('http tool call over SSE', /^signed in with at-/.test(await who.execute({}, { signal: new AbortController().signal })))
await wait(4500)
if (who) {
  const again = await who.execute({}, { signal: new AbortController().signal }).catch(e => 'ERR ' + e.message)
  check('expired token is refreshed transparently', /^signed in with at-/.test(again), again)
}
// Editing a connector whose token has expired: the closing connection must not refresh it just to end its
// session, or both connections would spend the same refresh token and the server, which rotates them,
// would refuse one and sign the user out.
await wait(4500)
const beforeEdit = await serverStats()
await api('PUT', `/connectors/${hid}`, { name: 'HTTP Test', transport: 'http', url: `${HTTP_TEST}/mcp`, headers: { 'X-Api-Key': MASK } })
const editedUp = await until(async () => { const c = await status(hid); return c?.status === 'connected' && c }, 10000)
const afterEdit = await serverStats()
check('an edit with an expired token spends no refresh token twice and stays signed in', !!editedUp?.signedIn && afterEdit.refused === beforeEdit.refused && afterEdit.refreshes > beforeEdit.refreshes, JSON.stringify({ beforeEdit, afterEdit }))
check('…and the closing connection sends no session-end request with the expired token', afterEdit.deletes === beforeEdit.deletes)
await api('PUT', `/connectors/${hid}`, { name: 'HTTP Test', transport: 'http', url: `${HTTP_TEST}/mcp`, headers: { 'X-Api-Key': MASK } })
await until(async () => (await status(hid))?.status === 'connected', 10000)
check('a closing connection with a valid token still ends its session', !!await until(async () => (await serverStats()).deletes === afterEdit.deletes + 1, 3000))

const settings = JSON.parse(readFileSync(path.join(home, 'harness-studio', 'connectors.json'), 'utf8'))
check('settings file saved with owner-only permissions', settings.connectors.length === 2 && (statSync(path.join(home, 'harness-studio', 'connectors.json')).mode & 0o777) === 0o600)

// the list never carries secret values
const listText = JSON.stringify((await api('GET', '/connectors')).body)
check('list carries no header, environment or token values', !listText.includes('hdr-sekret-456') && !listText.includes('env-sekret-123') && !/at-[A-Za-z0-9_-]{6}/.test(listText))

// edits: a masked value keeps the stored one, a new value replaces it, a blank secret keeps the saved one
const edited = await api('PUT', `/connectors/${sid}`, { name: 'Stdio Test', transport: 'stdio', command: process.execPath, args: [path.join(here, 'stdio-server.mjs')], env: { STDIO_SECRET: MASK, ADDED: 'new-value' } })
const storedEnv = JSON.parse(readFileSync(path.join(home, 'harness-studio', 'connectors.json'), 'utf8')).connectors.find(c => c.id === sid).env
check('edit with masked env keeps the stored value', edited.status === 200 && storedEnv.STDIO_SECRET === 'env-sekret-123' && storedEnv.ADDED === 'new-value', JSON.stringify(storedEnv))
await until(async () => (await status(sid))?.status === 'connected')
const secretAdd = await api('POST', '/connectors', { name: 'Secret App', transport: 'http', url: 'http://127.0.0.1:1/mcp', clientId: 'cid', clientSecret: 'client-sekret-789' })
check('client secret is reported only as set', secretAdd.body.clientSecretSet === true && !JSON.stringify(secretAdd.body).includes('client-sekret-789'))
await api('PUT', `/connectors/${secretAdd.body.id}`, { name: 'Secret App', transport: 'http', url: 'http://127.0.0.1:1/mcp', clientId: 'cid', clientSecret: '' })
const keptSecret = JSON.parse(readFileSync(path.join(home, 'harness-studio', 'connectors.json'), 'utf8')).connectors.find(c => c.id === secretAdd.body.id)
check('edit with a blank secret keeps the saved one', keptSecret.clientSecret === 'client-sekret-789')
// Saved secrets stay with their server: another path on the same origin keeps them, another origin drops them.
const storedSpec = id => JSON.parse(readFileSync(path.join(home, 'harness-studio', 'connectors.json'), 'utf8')).connectors.find(c => c.id === id)
await api('PUT', `/connectors/${secretAdd.body.id}`, { name: 'Secret App', transport: 'http', url: 'http://127.0.0.1:1/mcp', headers: { 'X-Api-Key': 'hdr-for-old-host' }, clientId: 'cid', clientSecret: '' })
const samePlace = await api('PUT', `/connectors/${secretAdd.body.id}`, { name: 'Secret App', transport: 'http', url: 'http://127.0.0.1:1/v2/mcp', headers: { 'X-Api-Key': MASK }, clientId: 'cid', clientSecret: '' })
check('an edit on the same origin keeps the saved header and client secret', samePlace.body.notice === undefined && storedSpec(secretAdd.body.id).headers['X-Api-Key'] === 'hdr-for-old-host' && storedSpec(secretAdd.body.id).clientSecret === 'client-sekret-789')
const moved = await api('PUT', `/connectors/${secretAdd.body.id}`, { name: 'Secret App', transport: 'http', url: 'http://localhost:1/v2/mcp', headers: { 'X-Api-Key': MASK }, clientId: 'cid', clientSecret: '' })
const movedSpec = storedSpec(secretAdd.body.id)
check('an edit to another origin drops the saved header and client secret, and says so', moved.status === 200 && movedSpec.clientSecret === undefined && !('X-Api-Key' in movedSpec.headers)
  && /another server/.test(moved.body.notice ?? '') && moved.body.droppedSecrets?.includes('header X-Api-Key') && moved.body.droppedSecrets?.includes('client secret'), JSON.stringify({ notice: moved.body.notice, headers: movedSpec.headers }))
await api('DELETE', `/connectors/${secretAdd.body.id}`)

// refresh: a network failure keeps the sign-in; invalid_grant drops it
await fetch(`${HTTP_TEST}/test/token-mode?mode=down`)
await wait(4500)
if (who) await agents[0].tools.get(`mcp__${hid}__whoami`)?.execute({}, { signal: new AbortController().signal }).catch(() => {})
await until(async () => (await status(hid))?.status === 'needs-auth', 6000)
check('refresh network error keeps the tokens', Boolean(grantOf(hid)?.tokens?.refresh_token) && (await status(hid)).signedIn === true, JSON.stringify((await status(hid))?.status))
await fetch(`${HTTP_TEST}/test/token-mode?mode=up`)
await api('POST', `/connectors/${hid}/reconnect`, {})
check('with the token endpoint back, the kept sign-in reconnects', !!await until(async () => (await status(hid))?.status === 'connected', 8000))

// restart: grant persists. The token has expired by now; stopping must not refresh it to end the session.
await wait(4500)
const beforeQuit = await serverStats()
await app.stop()
for (const a of agents) a.tools.clear()
await wait(300)
const oldKey = conn.key
app = await boot()
check('a restart makes a new helper key', conn.key !== oldKey && (await api('GET', '/connectors', undefined, { key: oldKey })).status === 401)
const back = await until(async () => { try { const c = await status(hid); return c?.status === 'connected' && c } catch { return undefined } }, 10000)
check('after restart the signed-in connector reconnects without sign-in', !!back, back ? '' : JSON.stringify(await status(hid).catch(e => e.message)))
check('quitting with an expired token spends no refresh token twice', (await serverStats()).refused === beforeQuit.refused, JSON.stringify({ beforeQuit, now: await serverStats() }))
check('after restart s1 still has both connectors', !!await until(async () => agents[0].tools.has(`mcp__${sid}__echo`) && agents[0].tools.has(`mcp__${hid}__whoami`)))
check('sign-in is kept in the credential store', records.has(`harness-studio-connectors/${hid}`))

await fetch(`${HTTP_TEST}/test/token-mode?mode=revoked`)
await wait(4500)
await agents[0].tools.get(`mcp__${hid}__whoami`)?.execute({}, { signal: new AbortController().signal }).catch(() => {})
check('a revoked refresh token (invalid_grant) drops the tokens', !!await until(async () => { const c = await status(hid); return c?.status === 'needs-auth' && !c.signedIn && !grantOf(hid)?.tokens }, 6000))
await fetch(`${HTTP_TEST}/test/token-mode?mode=up`)

// sign out of a connector that is switched off: it stays off
await api('POST', `/connectors/${hid}/enabled`, { enabled: false })
await api('POST', `/connectors/${hid}/logout`, {})
await wait(300)
check('sign out keeps a switched-off connector off', (await status(hid))?.status === 'disabled')
await api('POST', `/connectors/${hid}/enabled`, { enabled: true })
check('sign out returns to needs sign-in', !!await until(async () => (await status(hid))?.status === 'needs-auth'))
await api('DELETE', `/connectors/${hid}`); await api('DELETE', `/connectors/${sid}`)
check('remove deletes connectors and their tools', (await api('GET', '/connectors')).body.connectors.length === 0 && agents[0].tools.size === 0)
await app.stop()

// ---- OAuth discovery and endpoint checks against a small metadata server ----------------------------
const meta = {}
const metaServer = createServer((req, res) => {
  const body = meta[new URL(req.url, 'http://x').pathname]
  if (!body) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(typeof body === 'function' ? body() : body))
})
await new Promise(r => metaServer.listen(0, '127.0.0.1', r))
const M = `http://127.0.0.1:${metaServer.address().port}`
const asMeta = (issuer, extra = {}) => ({ issuer, authorization_endpoint: `${M}/authorize`, token_endpoint: `${M}/token`, code_challenge_methods_supported: ['S256'], ...extra })
const refused = async (label, promise, pattern) => {
  const error = await promise.then(() => undefined, e => e)
  check(label, !!error && pattern.test(error.message), error ? error.message : 'no error')
}
meta['/.well-known/oauth-protected-resource/good/mcp'] = { resource: `${M}/good`, authorization_servers: [M] }
meta['/.well-known/oauth-authorization-server'] = asMeta(M)
const good = await discover(`${M}/good/mcp`).catch(e => e)
check('discovery accepts a resource that is a path prefix on the same origin', good?.issuer === M && good.resource === `${M}/good`, good?.message ?? '')
meta['/.well-known/oauth-protected-resource/other/mcp'] = { resource: 'https://elsewhere.example/mcp', authorization_servers: [M] }
await refused('protected-resource metadata for another resource is refused', discover(`${M}/other/mcp`), /is for https:\/\/elsewhere\.example/)
meta['/.well-known/oauth-protected-resource/sibling/mcp'] = { resource: `${M}/sib`, authorization_servers: [M] }
await refused('a resource that is only a string prefix (not a path prefix) is refused', discover(`${M}/sibling/mcp`), /is for/)
meta['/.well-known/oauth-protected-resource/iss/mcp'] = { resource: `${M}/iss/mcp`, authorization_servers: [`${M}/tenant`] }
meta['/.well-known/oauth-authorization-server/tenant'] = asMeta('https://attacker.example')
await refused('authorization-server metadata with another issuer is refused', discover(`${M}/iss/mcp`), /does not match/)
meta['/.well-known/oauth-protected-resource/plain/mcp'] = { resource: `${M}/plain/mcp`, authorization_servers: [`${M}/plain-as`] }
meta['/.well-known/oauth-authorization-server/plain-as'] = asMeta(`${M}/plain-as`, { token_endpoint: 'http://tokens.example/token' })
await refused('a plain-http token endpoint on a remote host is refused', discover(`${M}/plain/mcp`), /token endpoint .* not an https/)
meta['/.well-known/oauth-protected-resource/fileauth/mcp'] = { resource: `${M}/fileauth/mcp`, authorization_servers: [`${M}/file-as`] }
meta['/.well-known/oauth-authorization-server/file-as'] = asMeta(`${M}/file-as`, { authorization_endpoint: 'file:///Applications/Calculator.app' })
await refused('a non-https authorization endpoint is refused', discover(`${M}/fileauth/mcp`), /authorization endpoint .* not an https/)
meta['/.well-known/oauth-protected-resource/nos256/mcp'] = { resource: `${M}/nos256/mcp`, authorization_servers: [`${M}/plain-pkce`] }
meta['/.well-known/oauth-authorization-server/plain-pkce'] = asMeta(`${M}/plain-pkce`, { code_challenge_methods_supported: ['plain'] })
await refused('a server without S256 PKCE is refused', discover(`${M}/nos256/mcp`), /S256/)
await refused('an authorize URL that is not https is never built', Promise.resolve().then(() => authorizationRequest({ metadata: { authorization_endpoint: 'smb://host/share' }, client: { client_id: 'c', redirect_uri: 'http://127.0.0.1/cb' }, resource: 'x' })), /not an https/)
const { openInBrowser } = await import(PLUGIN)
await refused('the OS opener refuses non-https URLs', Promise.resolve().then(() => openInBrowser('file:///etc/passwd')), /not an https/)
const aborted = new AbortController(); aborted.abort()
const pollStart = Date.now()
await refused('device polling with an aborted signal stops at once', pollDeviceToken({ tokenEndpoint: `${M}/token`, clientId: 'c', device: { device_code: 'd', interval: 5, expires_in: 60 }, signal: aborted.signal }), /cancelled/)
check('…without waiting for the poll interval', Date.now() - pollStart < 1000)

// legacy SSE: a message endpoint on another origin is refused
meta['/sse'] = undefined
const sseServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.write('event: endpoint\ndata: http://evil.localhost:9/messages\n\n')
})
await new Promise(r => sseServer.listen(0, '127.0.0.1', r))
const sse = new McpConnection({ spec: { transport: 'http', url: `http://127.0.0.1:${sseServer.address().port}/sse`, headers: { authorization: 'Bearer secret' } }, onChange: () => {} })
sse.restart()
const sseFailed = await until(() => sse.status === 'failed' && sse.error, 5000)
check('legacy SSE endpoint on another origin is refused', !!sseFailed && /another origin/.test(sse.error), sse.error)
sse.stop()
sseServer.closeAllConnections?.(); sseServer.close(); metaServer.close()

// stdio environment allowlist
const env = serverEnv({ OWN: '1' }, { PATH: '/bin', HOME: '/h', LANG: 'C', LC_CTYPE: 'UTF-8', GITHUB_TOKEN: 'leak', AWS_SECRET_ACCESS_KEY: 'leak', DSH_HOME: '/x' }, 'darwin')
check('stdio servers get only allowlisted variables plus their own', env.PATH === '/bin' && env.LC_CTYPE === 'UTF-8' && env.OWN === '1' && !('GITHUB_TOKEN' in env) && !('AWS_SECRET_ACCESS_KEY' in env) && !('DSH_HOME' in env), Object.keys(env).join(','))

// corrupt settings file: moved aside, never overwritten
const home2 = mkdtempSync(path.join(tmpdir(), 'conn-home-'))
mkdirSync(path.join(home2, 'harness-studio'), { recursive: true })
writeFileSync(path.join(home2, 'harness-studio', 'connectors.json'), '{ "connectors": [ { "id": "keep-me", ')
const errors = []; const originalError = console.error; console.error = (...a) => { errors.push(a.join(' ')) }
app = await boot(home2)
console.error = originalError
const aside = readdirSync(path.join(home2, 'harness-studio')).find(f => f.startsWith('connectors.json.corrupt-'))
check('a corrupt connectors.json is moved aside and logged', !!aside && readFileSync(path.join(home2, 'harness-studio', aside), 'utf8').includes('keep-me') && errors.some(e => e.includes('moved to')), aside ?? 'not moved')
await api('POST', '/connectors', { name: 'After Corrupt', transport: 'stdio', command: 'true' })
check('saving afterwards does not touch the moved file', existsSync(path.join(home2, 'harness-studio', aside)))
await app.stop()

// A new sign-in that finds another authorization server drops the old tokens at once, so an abandoned
// sign-in cannot leave the old refresh token (and client secret) to be sent to the new token endpoint.
{
  const asServer = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    const A = `http://127.0.0.1:${asServer.address().port}`
    const docs = {
      '/.well-known/oauth-authorization-server': { issuer: A, authorization_endpoint: `${A}/authorize`, token_endpoint: `${A}/token`, registration_endpoint: `${A}/register`, code_challenge_methods_supported: ['S256'] },
      '/register': { client_id: 'new-client' },
    }
    const doc = docs[new URL(req.url, A).pathname]
    res.writeHead(doc ? 200 : 404, { 'content-type': 'application/json' }); res.end(doc ? JSON.stringify(doc) : '{}')
  })
  await new Promise(r => asServer.listen(0, '127.0.0.1', r))
  const A = `http://127.0.0.1:${asServer.address().port}`
  const home3 = mkdtempSync(path.join(tmpdir(), 'conn-home-'))
  app = await boot(home3)
  const movedAuth = (await api('POST', '/connectors', { name: 'Moved Auth', transport: 'http', url: `${A}/mcp`, enabled: false })).body.id
  const keptAuth = (await api('POST', '/connectors', { name: 'Kept Auth', transport: 'http', url: `${A}/mcp`, enabled: false })).body.id
  await app.stop()
  const oldGrant = issuer => ({ kind: 'grant', payload: { issuer, metadata: { token_endpoint: `${issuer}/token` }, client: { client_id: 'old-client', redirect_uri: 'http://127.0.0.1:1/oauth/callback' }, tokens: { access_token: 'old-at', refresh_token: 'old-rt' } } })
  records.set(`harness-studio-connectors/${movedAuth}`, oldGrant('https://old-issuer.example'))
  records.set(`harness-studio-connectors/${keptAuth}`, oldGrant(A))
  app = await boot(home3)
  await until(async () => (await status(movedAuth))?.signedIn === true)
  const started = await api('POST', `/connectors/${movedAuth}/login`, {})
  check('a sign-in with another authorization server drops the old tokens when it starts', started.status === 200 && grantOf(movedAuth)?.issuer === A && grantOf(movedAuth)?.tokens === undefined && (await status(movedAuth)).signedIn === false,
    JSON.stringify({ status: started.status, error: started.body.error, grant: grantOf(movedAuth) }))
  await api('POST', `/connectors/${keptAuth}/login`, {})
  check('…and keeps them when the authorization server is the same', grantOf(keptAuth)?.tokens?.refresh_token === 'old-rt')
  await app.stop()
  asServer.closeAllConnections?.(); asServer.close()
}

// A server cannot make Harness hold an unbounded answer: a JSON body, an event-stream line and a stdio
// line past 16 MB fail with that reason instead of being buffered.
{
  const big = 17 * 1024 * 1024
  const bigServer = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    if (req.url === '/json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('"' + 'x'.repeat(big) + '"'); return }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: ')
    for (let i = 0; i < 17; i++) res.write('x'.repeat(1024 * 1024)) // one line that never ends
  })
  await new Promise(r => bigServer.listen(0, '127.0.0.1', r))
  const B = `http://127.0.0.1:${bigServer.address().port}`
  const failsWith = async (spec) => {
    const connection = new McpConnection({ spec, onChange: () => {} })
    connection.restart()
    const failed = await until(() => connection.status === 'failed' && connection.error, 15000)
    connection.stop()
    return failed || `status ${connection.status}`
  }
  const jsonError = await failsWith({ transport: 'http', url: `${B}/json` })
  check('a JSON answer over 16 MB fails the request', /larger than 16 MB/.test(jsonError), String(jsonError).slice(0, 200))
  const sseError = await failsWith({ transport: 'http', url: `${B}/stream` })
  check('an event-stream line over 16 MB fails the request at once', /larger than 16 MB/.test(sseError), String(sseError).slice(0, 200))
  const stdioError = await failsWith({ transport: 'stdio', command: process.execPath, args: ['-e', `process.stdout.write('x'.repeat(${big})); setInterval(() => {}, 1000)`] })
  check('a stdio line over 16 MB fails the connection', /larger than 16 MB/.test(stdioError), String(stdioError).slice(0, 200))
  bigServer.closeAllConnections?.(); bigServer.close()
}

// Stopping a stdio server ends what it started too: here a shell wrapper leaves a background process
// running beside the real server, as npx-style launchers do.
if (process.platform !== 'win32') {
  const { StdioTransport } = await import('../mcp-connection.js')
  const pidFile = path.join(mkdtempSync(path.join(tmpdir(), 'conn-group-')), 'pid')
  const transport = new StdioTransport({ command: '/bin/sh', args: ['-c', `sleep 300 & echo $! > "${pidFile}"; exec "${process.execPath}" "${path.join(here, 'stdio-server.mjs')}"`] })
  await transport.start(() => {}, () => {})
  const pid = await until(() => { try { return Number(readFileSync(pidFile, 'utf8').trim()) || undefined } catch { return undefined } })
  const alive = (p) => { try { process.kill(p, 0); return true } catch { return false } }
  const startedAlive = pid !== undefined && alive(pid)
  transport.close()
  const ended = await until(() => !alive(pid), 5000)
  check('stopping a stdio server also ends what its launcher started', startedAlive && ended === true, `background pid ${pid}`)
}

console.log(results.join('\n'))
console.log(`\n${results.filter(r => r.startsWith('PASS')).length} passed, ${results.filter(r => r.startsWith('FAIL')).length} failed`)
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0)
