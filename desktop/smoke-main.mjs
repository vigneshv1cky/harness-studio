// Smoke-test checks that need the app's main process (desktop/smoke-mac.sh, desktop/smoke-linux.sh): connects to
// the app started with --inspect=<port>, measures the welcome window's content size, then clicks "Check for
// Updates…" in the application menu with the browser-opening and dialog functions replaced by recorders and any new
// window recorded and closed, so nothing stays open. Writes main.json to the output directory and fails unless the
// welcome window has the size the patches set and the menu item opens the releases page without a dialog or window.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
const port = process.argv[2] ?? '9229'
const out = process.argv[3] ?? '.'
// The welcome window's size as the desktop patches set it, or HARNESS_STUDIO_WELCOME_SIZE ("440x400") when testing
// packages built from another commit.
const patches = new URL('./patches/', import.meta.url)
const patched = readdirSync(patches).sort().map(name => readFileSync(new URL(name, patches), 'utf8'))
  .map(text => text.split(/^diff --git /mu).find(part => part.startsWith('a/apps/desktop/src/welcome-window.ts')))
  .filter(Boolean).at(-1)?.match(/^\+\s+width: (\d+),\n\+\s+height: (\d+),/mu)
const [width, height] = ((process.env.HARNESS_STUDIO_WELCOME_SIZE || undefined)?.split('x') ?? patched?.slice(1, 3) ?? []).map(Number)
const RELEASES = 'https://github.com/vigneshv1cky/harness-studio/releases'
const wait = ms => new Promise(r => setTimeout(r, ms))

let target
for (let i = 0; i < 90 && target === undefined; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())[0] } catch { /* not up yet */ }
  if (target === undefined) await wait(1000)
}
if (target === undefined) { console.error('smoke-main: no main-process inspector'); process.exit(1) }

const evaluate = expression => new Promise((resolve, reject) => {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
    params: { expression, includeCommandLineAPI: true, awaitPromise: true, returnByValue: true } }))
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data)
    if (m.id !== 1) return
    ws.close()
    if (m.result?.exceptionDetails) reject(new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text))
    else resolve(m.result?.result?.value)
  }
  ws.onerror = () => reject(new Error('main-process inspector connection failed'))
  setTimeout(() => reject(new Error('main-process inspector timed out')), 20_000).unref()
})

const report = {}
for (let i = 0; i < 60 && report.welcome === undefined; i++) {
  report.welcome = await evaluate(`require('electron').BrowserWindow.getAllWindows()
    .filter(w => w.webContents.getURL().startsWith('file:')).map(w => w.getContentBounds())[0]`).catch(() => undefined)
  if (report.welcome === undefined) await wait(1000)
}
report.updateMenu = await evaluate(`(async () => {
  const { BrowserWindow, Menu, shell, dialog } = require('electron')
  const find = items => { for (const item of items) { if (item.label === 'Check for Updates…') return item; const inner = item.submenu && find(item.submenu.items); if (inner) return inner } }
  const item = find(Menu.getApplicationMenu()?.items ?? [])
  if (item === undefined) return { exists: false, calls: [] }
  const calls = []
  const saved = { openExternal: shell.openExternal, showMessageBox: dialog.showMessageBox, showMessageBoxSync: dialog.showMessageBoxSync }
  shell.openExternal = async url => { calls.push({ open: url }) }
  dialog.showMessageBox = async (...args) => { calls.push({ dialog: (args.at(-1) ?? {}).message ?? '' }); return { response: 0, checkboxChecked: false } }
  dialog.showMessageBoxSync = (...args) => { calls.push({ dialog: (args.at(-1) ?? {}).message ?? '' }); return 0 }
  const before = new Set(BrowserWindow.getAllWindows().map(w => w.id))
  try {
    item.click(); await new Promise(r => setTimeout(r, 8000))
    for (const w of BrowserWindow.getAllWindows().filter(w => before.has(w.id))) {
      const text = await w.webContents.executeJavaScript('document.body?.innerText ?? ""').catch(() => '')
      if (/up to date|已是最新/i.test(text)) calls.push({ window: 'in-window prompt: ' + text.match(/.{0,40}(up to date|已是最新).{0,40}/is)[0] })
    }
    // The upstream update prompt is a window of its own, not a system dialog.
    for (const w of BrowserWindow.getAllWindows().filter(w => !before.has(w.id))) {
      calls.push({ window: w.getTitle() + ' ' + w.webContents.getURL().slice(0, 60) + ' ' + (await w.webContents.executeJavaScript('document.body?.innerText.slice(0, 120) ?? ""').catch(() => '')) })
      w.destroy()
    }
  } finally { Object.assign(shell, { openExternal: saved.openExternal }); Object.assign(dialog, { showMessageBox: saved.showMessageBox, showMessageBoxSync: saved.showMessageBoxSync }) }
  return { exists: true, calls }
})()`).catch(error => ({ error: String(error) }))

console.log(JSON.stringify(report, null, 1))
writeFileSync(`${out}/main.json`, `${JSON.stringify(report, null, 1)}\n`)
const calls = report.updateMenu?.calls ?? []
const problems = [
  !(width > 0 && height > 0) && 'no welcome window size in the desktop patches',
  !(report.welcome?.width === width && report.welcome?.height === height) && `welcome window is ${JSON.stringify(report.welcome)}, not ${width} by ${height}`,
  !report.updateMenu?.exists && 'no Check for Updates… menu item',
  report.updateMenu?.exists && !calls.some(call => call.open === RELEASES) && `Check for Updates… did not open ${RELEASES}`,
  calls.some(call => 'dialog' in call || 'window' in call) && `Check for Updates… showed a dialog or window: ${calls.filter(call => !('open' in call)).map(call => call.dialog ?? call.window).join('; ')}`,
].filter(Boolean)
if (problems.length > 0) { console.error(`smoke-main: ${problems.join('; ')}`); process.exit(1) }
console.log(`smoke-main: welcome window ${width} by ${height}; Check for Updates… opens the releases page without a dialog`)
process.exit(0)
