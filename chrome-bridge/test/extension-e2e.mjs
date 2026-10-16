// End-to-end check with a real Chrome: loads the extension into a throwaway Chrome profile, starts the
// bridge server with the extension's pairing code, and drives a test form through the MCP tools.
// See README.md → Tests for how to start the throwaway Chrome (port 9444) and the form page (3010).
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const wait = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (label, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`)
setTimeout(() => { console.log(results.join('\n') + '\nFAIL timed out'); process.exit(1) }, 150000).unref()

// Browser-level CDP session; kept open, since the extension unloads when it closes.
const v = await (await fetch('http://127.0.0.1:9444/json/version')).json()
const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r))
let n = 0; const pendingCdp = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pendingCdp.has(m.id)) { pendingCdp.get(m.id)(m); pendingCdp.delete(m.id) } })
const cdp = (method, params = {}, sessionId) => new Promise(r => { const id = ++n; pendingCdp.set(id, r); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })) })

const loaded = await cdp('Extensions.loadUnpacked', { path: ROOT + '/extension' })
const extId = loaded.result?.id
check('extension loads', !!extId, extId ?? JSON.stringify(loaded.error))

// Read the pairing code from the extension's worker.
let code
for (let i = 0; i < 40 && !code; i++) {
  const { result } = await cdp('Target.getTargets')
  const sw = result.targetInfos.find(t => t.type === 'service_worker' && t.url.includes(extId))
  if (sw) {
    const { result: att } = await cdp('Target.attachToTarget', { targetId: sw.targetId, flatten: true })
    const r = await cdp('Runtime.evaluate', { expression: `chrome.storage.local.get('code').then(x => x.code || '')`, awaitPromise: true, returnByValue: true }, att.sessionId)
    code = r.result?.result?.value || undefined
  }
  if (!code) await wait(500)
}
check('extension created a pairing code', /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/.test(code ?? ''), code ? code.slice(0, 5) + '-…' : 'none')

// Bridge server as an MCP client would run it.
const proc = spawn(process.execPath, [ROOT + '/server.mjs'], { env: { ...process.env, HS_CHROME_PAIRING_CODE: code }, stdio: ['pipe', 'pipe', 'pipe'] })
let stderr = ''; proc.stderr.on('data', d => { stderr += d })
let buf = ''; const waiting = new Map(); let id = 1
proc.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) !== -1) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); waiting.delete(m.id) } })
const rpc = (method, params) => new Promise(r => { const k = id++; waiting.set(k, r); proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: k, method, params }) + '\n') })
const call = async (name, args = {}) => { const r = await rpc('tools/call', { name, arguments: args }); return { error: r.result?.isError, text: r.result?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? '', content: r.result?.content ?? [] } }
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } })

// The extension reconnects every 3 s while awake and on a 30 s alarm otherwise.
let tabs
for (let i = 0; i < 40; i++) { tabs = await call('chrome_tabs'); if (!tabs.error) break; await wait(1000) }
check('extension pairs with the server and lists tabs', !tabs.error, tabs.text.split('\n')[0])
check('server log shows the pairing', /extension paired/.test(stderr))

const opened = await call('chrome_open', { url: 'http://127.0.0.1:3010/form.html' })
check('opens a page in a new tab', /Form test/.test(opened.text), opened.text)
const tabId = Number(/Tab (\d+)/.exec(opened.text)?.[1])
const ref = (text, pattern) => Number(new RegExp(`\\[(\\d+)\\] ${pattern}`).exec(text)?.[1])
let page = await call('chrome_read', { tabId })
check('reads the page with numbered elements', /Greeting form/.test(page.text) && /input\[text\]/.test(page.text), page.text.split('\n').slice(0, 3).join(' | '))
await call('chrome_type', { tabId, ref: ref(page.text, 'input\\[text\\]'), text: 'Ada' })
page = await call('chrome_read', { tabId })
const clicked = await call('chrome_click', { tabId, ref: ref(page.text, 'button "Greet"') })
page = await call('chrome_read', { tabId })
check('types into a field and clicks a button (real input)', /Hello, Ada!/.test(page.text), clicked.text + ' | ' + (/Hello[^\n]*|No greeting yet\./.exec(page.text)?.[0]))
await call('chrome_type', { tabId, ref: ref(page.text, 'input\\[text\\]'), text: 'Ada', submit: true })
page = await call('chrome_read', { tabId })
check('typing with Enter submits the form', /Hello, Ada!/.test(page.text), /Hello[^\n]*|No greeting yet\./.exec(page.text)?.[0])
const shot = await call('chrome_screenshot')
check('screenshot returns an image', shot.content.some(c => c.type === 'image' && c.data?.length > 1000), shot.content.map(c => c.type).join(','))
const closed = await call('chrome_close', { tabId })
check('closes the tab', !closed.error, closed.text)

proc.kill()
console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0)
