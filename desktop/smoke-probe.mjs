// Smoke-test probe for the installed app (desktop/smoke-linux.sh, desktop/smoke-windows.sh): reads the running
// app through its debugging port, records window titles, visible text and screenshots, chooses a model provider
// on the welcome screen, opens the Connectors page and the Session and Browser panes, and fails unless the
// workspace shows Harness Studio with its three plugins, a default workspace, those pages, and no DeepSeek
// account, feedback or sign-in.
import { writeFileSync } from 'node:fs'
const port = process.argv[2] ?? '9222'
const out = process.argv[3] ?? '/a'
const call = (url, method, params = {}) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url)
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }))
  ws.onmessage = (event) => { const m = JSON.parse(event.data); if (m.id === 1) { ws.close(); resolve(m.result) } }
  ws.onerror = () => reject(new Error(`debugging connection failed: ${method}`))
  ws.onclose = () => reject(new Error(`debugging connection closed: ${method}`))
  setTimeout(() => { ws.close(); reject(new Error(`debugging call timed out: ${method}`)) }, 20_000).unref()
})
const wait = ms => new Promise(r => setTimeout(r, ms))
let targets = []
for (let i = 0; i < 90 && !targets.some(t => t.type === 'page'); i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json() } catch { /* not up yet */ }
  await wait(1000)
}
await wait(5000)
targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const report = {}
for (const [i, t] of targets.filter(t => t.type === 'page').entries()) {
  const text = await call(t.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: 'document.body.innerText.slice(0, 600)', returnByValue: true })
  const shot = await call(t.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${out}/page-${i}.png`, Buffer.from(shot.data, 'base64'))
  report[`page-${i}`] = { title: t.title, url: t.url.slice(0, 60), text: text.result.value }
  if (t.url.startsWith('file://')) {
    // Welcome window: choose a model provider, which should open the workspace on Settings → Models.
    // The click closes this window, which can drop the connection before the reply; that is expected. The click
    // is not deferred with a timer: Windows puts the main window in front, and a hidden window's timers stall.
    await call(t.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: "document.getElementById('choose-provider')?.click()" })
      .catch(() => undefined)
  }
}
await wait(8000)
targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const main = targets.find(t => t.type === 'page' && t.url.startsWith('dsh-app://'))
if (main) {
  const probe = await call(main.webSocketDebuggerUrl, 'Runtime.evaluate', { returnByValue: true, expression: `({
    title: document.title,
    sidebar: document.body.innerText.slice(0, 200),
    settings: document.querySelector('[role=dialog]')?.innerText.slice(0, 300) ?? null,
    plugins: (JSON.stringify(window.__DSH_BOOT__).match(/@harness-studio\\/[a-z]+/g) || []).filter((v, i, a) => a.indexOf(v) === i),
    accountUi: JSON.stringify(window.__DSH_BOOT__).includes('ui-settings-account'),
    feedbackUi: JSON.stringify(window.__DSH_BOOT__).includes('ui-message-feedback'),
    signInText: /Sign in to DeepSeek|登录 DeepSeek/.test(document.body.innerText),
  })` })
  const shot = await call(main.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${out}/workspace.png`, Buffer.from(shot.data, 'base64'))
  report.workspace = probe.result.value
  // The plugin pages: close Settings, then open Connectors, a new session, and the Session and Browser panes.
  const run = async expression => (await call(main.webSocketDebuggerUrl, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value
  const click = label => run(`(() => { const b = [...document.querySelectorAll('button,[role=button],a')].find(e => (e.getAttribute('aria-label') ?? e.textContent.trim()) === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`)
  const text = () => run('document.body.innerText')
  await run(`[...document.querySelectorAll('[role=dialog] button')].find(b => b.getAttribute('aria-label') === 'Close' || b.textContent.trim() === 'Close')?.click()`)
  await wait(1000)
  report.pages = { defaultWorkspace: (await text()).includes('Default workspace') }
  // Settings → Models must still be open: an early choice must survive the plugins finishing loading.
  report.pages.settingsModels = report.workspace.settings?.includes('Add model provider') ?? false
  await click('Connectors'); await wait(1500)
  report.pages.connectors = (await text()).includes('MCP servers')
  await click('New session'); await wait(2000)
  await click('Session details'); await wait(2000)
  report.pages.session = (await text()).includes('Environment')
  report.pages.sessionFolder = await run(`/default-workspace[\\s\\S]*Documents[\\\\/]Harness Studio/.test(document.querySelector('[data-testid=studio-details]')?.innerText ?? '')`)
  await click('Browser'); await wait(2500)
  report.pages.browser = (await text()).includes('Browse with the agent')
  const panes = await call(main.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${out}/panes.png`, Buffer.from(panes.data, 'base64'))
}
console.log(JSON.stringify(report, null, 1))
writeFileSync(`${out}/report.json`, `${JSON.stringify(report, null, 1)}\n`)
const w = report.workspace
const problems = [
  w === undefined && 'no workspace window',
  w && !w.title.includes('Harness Studio') && `title is ${JSON.stringify(w.title)}`,
  w && w.plugins.length !== 3 && `plugins loaded: ${w.plugins.join(', ') || 'none'}`,
  w && w.accountUi && 'the DeepSeek account interface is loaded',
  w && w.feedbackUi && 'the feedback interface is loaded',
  w && w.signInText && 'a DeepSeek sign-in prompt is visible',
  ...Object.entries(report.pages ?? {}).filter(([, shown]) => !shown).map(([page]) => `${page} did not appear`),
].filter(Boolean)
if (problems.length > 0) { console.error(`smoke: ${problems.join('; ')}`); process.exit(1) }
console.log('smoke: passed')
process.exit(0)
