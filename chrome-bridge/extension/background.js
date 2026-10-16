// Harness Studio Chrome bridge — extension service worker.
//
// Connects to the local bridge server (chrome-bridge/server.mjs) at ws://127.0.0.1:47630, proves it
// holds the pairing code and checks that the server does too, then runs the server's commands in
// Chrome's tabs. Reading uses chrome.scripting; clicks and typing use chrome.debugger for real input,
// falling back to page-level events when the debugger permission is blocked (some managed Chromes).

const SERVER = 'ws://127.0.0.1:47630'
const RECONNECT_MS = 3000
const KEEPALIVE_MS = 20000
const DEBUGGER_IDLE_MS = 8000

let socket = null
let pairedSocket = null // the connection that proved the pairing code; selections go only here

// ---------------------------------------------------------------- pairing code and status ----

async function pairingCode() {
  const { code } = await chrome.storage.local.get('code')
  if (code) return code
  return newPairingCode()
}

async function newPairingCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  const raw = [...bytes].map(b => alphabet[b % alphabet.length]).join('')
  const code = raw.match(/.{5}/g).join('-')
  await chrome.storage.local.set({ code })
  return code
}

const setStatus = (status, detail = '') => chrome.storage.session.set({ status, detail, at: Date.now() })

async function hmacHex(key, message) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

const randomHex = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')

// ------------------------------------------------------------------------- connection ----

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  let ws
  try { ws = new WebSocket(SERVER) } catch { return scheduleReconnect() }
  socket = ws
  let myNonce = null
  let paired = false
  let keepalive = null // this connection's own, so an older socket closing late cannot stop a newer one's
  ws.onmessage = async (event) => {
    let msg
    try { msg = JSON.parse(event.data) } catch { return }
    if (msg === null || typeof msg !== 'object') return
    if (msg.type === 'hello') {
      const code = await pairingCode()
      myNonce = randomHex()
      ws.send(JSON.stringify({ type: 'auth', proof: await hmacHex(code, msg.nonce), nonce: myNonce }))
    } else if (msg.type === 'ok') {
      // The server must prove it knows the code too; otherwise it could be an impostor.
      const expected = await hmacHex(await pairingCode(), myNonce)
      if (msg.proof !== expected) { setStatus('denied', 'The server did not prove the pairing code.'); ws.close(); return }
      if (socket !== ws || ws.readyState !== WebSocket.OPEN) { ws.close(); return } // superseded while proving the code
      paired = true
      pairedSocket = ws
      setStatus('connected', `Bridge ${String(msg.version ?? '').slice(0, 20)}`.trim())
      clearInterval(keepalive)
      keepalive = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' })) }, KEEPALIVE_MS)
    } else if (msg.type === 'denied') {
      if (socket === ws) setStatus('denied', typeof msg.reason === 'string' ? msg.reason.slice(0, 200) : 'Pairing refused.')
    } else if (msg.type === 'command' && paired) {
      let reply
      try { reply = { type: 'result', id: msg.id, ok: true, value: await run(msg.op, msg.args || {}) } }
      catch (error) { reply = { type: 'result', id: msg.id, ok: false, error: String(error?.message || error) } }
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply))
    }
  }
  ws.onclose = () => {
    clearInterval(keepalive)
    if (pairedSocket === ws) pairedSocket = null
    // A socket replaced by a newer one (Reconnect, New code) closes late: the newer one owns status and retries.
    if (socket !== ws) return
    socket = null
    chrome.storage.session.get('status').then(({ status }) => { if (socket === null && status !== 'denied') setStatus('waiting', 'Bridge not running; retrying.') })
    scheduleReconnect()
  }
  ws.onerror = () => {}
}

let reconnectTimer = null
function scheduleReconnect() {
  clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(connect, RECONNECT_MS)
}

chrome.runtime.onStartup.addListener(connect)
chrome.runtime.onInstalled.addListener(() => { pairingCode().then(connect) })
chrome.alarms.create('reconnect', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'reconnect') connect() })
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === 'new-code') { newPairingCode().then((code) => { socket?.close(); setStatus('waiting', 'New code; update the bridge.'); respond({ code }) }); return true }
  if (message?.type === 'reconnect') { setStatus('waiting', 'Reconnecting…'); socket?.close(); connect(); respond({}); return false }
  if (message?.type === 'pick') { pickOnActiveTab(); respond({}); return false }
  return false
})
connect()
chrome.commands.onCommand.addListener((command) => { if (command === 'select-element') pickOnActiveTab() })

// ------------------------------------------------------------------------- commands ----

async function targetTab(tabId) {
  if (Number.isInteger(tabId)) return chrome.tabs.get(tabId)
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab) throw new Error('No active tab')
  return tab
}

const where = tab => ({ tabId: tab.id, title: tab.title, url: tab.url })

async function settle(tabId, ms = 15000) {
  await new Promise(r => setTimeout(r, 300))
  const end = Date.now() + ms
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId)
    if (tab.status === 'complete') return tab
    await new Promise(r => setTimeout(r, 150))
  }
  return chrome.tabs.get(tabId)
}

// After an action: the tab's load, then a short wait until the page stops changing, so pages that update
// in place (search results, menus) are drawn before the next read. Capped, since some pages never stop.
async function settled(tabId) {
  const tab = await settle(tabId)
  try { await inPage(tabId, pageQuiet, [2500, 350]) } catch { /* a page extensions can't enter: the load wait is all there is */ }
  return chrome.tabs.get(tabId).catch(() => tab)
}

const NAMED_KEYS = {
  Enter: [13, 'Enter', '\r'], Escape: [27, 'Escape'], Esc: [27, 'Escape'], Tab: [9, 'Tab'], Space: [32, 'Space', ' '],
  Backspace: [8, 'Backspace'], Delete: [46, 'Delete'], Home: [36, 'Home'], End: [35, 'End'], PageUp: [33, 'PageUp'], PageDown: [34, 'PageDown'],
  ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'], ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'],
}
/** "Enter", "Shift+Tab", "ArrowDown", "k", "Ctrl+a" → the fields a key event needs. */
function keyFor(spec) {
  const parts = spec.split('+').map(p => p.trim()).filter(Boolean)
  const name = parts.pop()
  if (!name) throw new Error('Name a key, such as Enter, Escape, Tab, ArrowDown or a single character')
  const bits = { Alt: 1, Ctrl: 2, Control: 2, Meta: 4, Cmd: 4, Command: 4, Shift: 8 }
  let modifiers = 0
  for (const m of parts) { if (!(m in bits)) throw new Error(`Unknown modifier ${m}; use Shift, Ctrl, Alt or Meta`); modifiers |= bits[m] }
  if (name === ' ' ) return { key: ' ', code: 'Space', keyCode: 32, text: ' ', modifiers }
  const named = NAMED_KEYS[name]
  if (named) return { key: named[1] === 'Space' ? ' ' : named[1], code: named[1], keyCode: named[0], text: modifiers & 7 ? undefined : named[2], modifiers }
  if ([...name].length !== 1) throw new Error(`Unknown key ${name}; use Enter, Escape, Tab, Space, Backspace, Delete, Home, End, PageUp, PageDown, an arrow key, or one character`)
  const upper = name.toUpperCase()
  const code = /[A-Z]/.test(upper) ? 'Key' + upper : /[0-9]/.test(name) ? 'Digit' + name : ''
  const key = modifiers & 8 ? upper : name
  return { key, code, keyCode: upper.charCodeAt(0), text: modifiers & 7 ? undefined : key, modifiers }
}

async function inPage(tabId, func, args = []) {
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func, args })
    return result?.result
  } catch (error) {
    throw new Error(`Chrome does not let extensions into this page (${String(error.message || error)})`)
  }
}

// Debugger sessions are attached on demand and released after a short idle, so Chrome's
// "being debugged" bar only shows while the agent is acting.
const attached = new Map() // tabId → idle timer
async function debuggerFor(tabId) {
  if (!attached.has(tabId)) {
    await chrome.debugger.attach({ tabId }, '1.3')
    attached.set(tabId, null)
  }
  clearTimeout(attached.get(tabId))
  attached.set(tabId, setTimeout(() => { chrome.debugger.detach({ tabId }).catch(() => {}); attached.delete(tabId) }, DEBUGGER_IDLE_MS))
  return (method, params) => chrome.debugger.sendCommand({ tabId }, method, params)
}
chrome.debugger.onDetach.addListener(({ tabId }) => { clearTimeout(attached.get(tabId)); attached.delete(tabId) })

// Tabs the agent opens or acts in join one "Harness Studio" tab group per window, so the user can see which
// tabs it is using. A tab already in one of the user's own groups stays where it is. Grouping is a
// visual aid only: a failure never fails the command.
const GROUP_TITLE = 'Harness Studio'
// Returns where the tab ended up, or why it could not be grouped, for the command's reply.
async function intoGroup(tab) {
  try {
    if (!chrome.tabGroups) return 'not grouped: this Chrome gave the extension no tab-group access (reload the extension)'
    if (!tab) return 'not grouped: no tab'
    if (tab.pinned) return 'not grouped: pinned tab'
    const [ours] = await chrome.tabGroups.query({ windowId: tab.windowId, title: GROUP_TITLE })
    if (ours && tab.groupId === ours.id) return GROUP_TITLE
    if (tab.groupId !== undefined && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return 'not grouped: already in one of your groups'
    const groupId = await chrome.tabs.group(ours ? { groupId: ours.id, tabIds: [tab.id] } : { tabIds: [tab.id], createProperties: { windowId: tab.windowId } })
    if (!ours) await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: 'blue', collapsed: false })
    return GROUP_TITLE
  } catch (error) {
    return 'not grouped: ' + String(error.message || error)
  }
}

async function run(op, args) {
  if (op === 'tabs') {
    const [current] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    const tabs = await chrome.tabs.query({})
    const titles = new Map((chrome.tabGroups ? await chrome.tabGroups.query({}) : []).map(g => [g.id, g.title]))
    return { tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.id === current?.id, group: titles.get(t.groupId) })) }
  }
  if (op === 'open') {
    const tab = Number.isInteger(args.tabId)
      ? await chrome.tabs.update(args.tabId, { url: args.url, active: true })
      : await chrome.tabs.create({ url: args.url, active: true })
    const group = await intoGroup(tab)
    return { ...where(await settle(tab.id, 30000)), group }
  }
  if (op === 'activate') {
    const tab = await chrome.tabs.update(args.tabId, { active: true })
    const group = await intoGroup(tab)
    await chrome.windows.update(tab.windowId, { focused: true })
    return { ...where(tab), group }
  }
  if (op === 'close') { await chrome.tabs.remove(args.tabId); return {} }
  if (op === 'screenshot') {
    const tab = await targetTab()
    return { tabId: tab.id, dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 }) }
  }
  const tab = await targetTab(args.tabId)
  if (op === 'read') return { tabId: tab.id, ...(await inPage(tab.id, readPage)) }
  if (op === 'click') {
    const group = await intoGroup(tab)
    const point = await inPage(tab.id, clickPoint, [args.ref])
    if (!point) throw new Error(`No element [${args.ref}] on the page; call chrome_read again for current numbers.`)
    let note
    if (point.covered) {
      // Something else is on top of every part of it (a clipped menu, an overlay): a real click there would
      // hit the other element, so click it from the page instead.
      await inPage(tab.id, clickFromPage, [args.ref])
      note = 'the element was covered on screen, so it was clicked from the page'
    } else {
      try {
        const send = await debuggerFor(tab.id)
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
      } catch {
        await inPage(tab.id, clickFromPage, [args.ref])
      }
    }
    return { ...where(await settled(tab.id)), group, note }
  }
  if (op === 'press') {
    const group = await intoGroup(tab)
    const key = keyFor(String(args.key ?? ''))
    try {
      const send = await debuggerFor(tab.id)
      const base = { key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, modifiers: key.modifiers }
      await send('Input.dispatchKeyEvent', { ...base, type: key.text ? 'keyDown' : 'rawKeyDown', ...(key.text ? { text: key.text } : {}) })
      await send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' })
    } catch {
      await inPage(tab.id, pressWithoutDebugger, [key])
    }
    return { ...where(await settled(tab.id)), group }
  }
  if (op === 'type') {
    const group = await intoGroup(tab)
    const ok = await inPage(tab.id, focusField, [args.ref])
    if (!ok) throw new Error(`Element [${args.ref}] cannot take text; call chrome_read again for current numbers.`)
    try {
      const send = await debuggerFor(tab.id)
      await send('Input.insertText', { text: args.text })
      if (args.submit) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      }
    } catch {
      await inPage(tab.id, typeWithoutDebugger, [args.ref, args.text, args.submit === true])
    }
    return { ...where(await settled(tab.id)), group }
  }
  throw new Error(`Unknown command ${op}`)
}

// ------------------------------------------------------------------- element picker ----
// The user picks an element on the active tab; it goes, with a cropped screenshot, to the bridge, which
// hands it to Harness's message box, as the Browser pane's Pick does for local previews.

async function flashBadge(text, title, color = '#2563eb') {
  await chrome.action.setBadgeBackgroundColor({ color })
  await chrome.action.setBadgeText({ text })
  if (title) await chrome.action.setTitle({ title })
  setTimeout(() => { chrome.action.setBadgeText({ text: '' }); chrome.action.setTitle({ title: 'Harness Studio Chrome bridge' }) }, 2500)
}

async function pickOnActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id || !/^(https?|file):/.test(tab.url || '')) return flashBadge('×', "Chrome doesn't let extensions pick on this page", '#dc2626')
  if (!pairedSocket) return flashBadge('off', 'Harness Studio is not connected: start it, or check the pairing code', '#d97706')
  let picked
  try {
    // The isolated world: the page's scripts can neither see the picker nor forge what it reports.
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pickerInPage })
    picked = injection?.result
  } catch (error) {
    return flashBadge('×', 'Could not pick on this page: ' + String(error?.message || error), '#dc2626')
  }
  if (!picked) return // cancelled with Esc, or picking was switched off
  let image
  try { image = await croppedShot(tab.windowId, picked.rect, picked.viewport) } catch { /* sent without a picture */ }
  // React component names live on the page's own JavaScript objects, out of the isolated world's sight, so
  // they come from one small call in the page's world. The page controls that world: the names are page
  // data like the element's text, kept only if they look like plain identifiers.
  let components = []
  try {
    const [names] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: componentNamesInPage, args: [picked.token] })
    components = plainNames(names?.result)
  } catch { /* names are optional */ }
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: unmarkPicked }) } catch { /* the page went away */ }
  if (!pairedSocket) return flashBadge('off', 'Harness Studio disconnected before the selection could be sent', '#d97706')
  pairedSocket.send(JSON.stringify({ type: 'selection', selection: { ...picked.selection, components }, image }))
  flashBadge('✓', 'Sent to Harness Studio', '#16a34a')
}

/** At most four distinct plain identifiers (React component names) from untrusted page data. */
function plainNames(value) {
  if (!Array.isArray(value)) return []
  const names = []
  for (const name of value.slice(0, 16)) {
    if (typeof name === 'string' && /^[A-Za-z_$][\w$]{0,63}$/.test(name) && !names.includes(name)) names.push(name)
    if (names.length === 4) break
  }
  return names
}

/** The visible tab, cropped to the picked element with a little margin, as a PNG data URL. */
async function croppedShot(windowId, rect, viewport) {
  const shot = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
  const bitmap = await createImageBitmap(await (await fetch(shot)).blob())
  const scale = bitmap.width / viewport.width
  const margin = 8
  const x = Math.max(0, (rect.x - margin) * scale)
  const y = Math.max(0, (rect.y - margin) * scale)
  const width = Math.min(bitmap.width - x, (rect.width + margin * 2) * scale)
  const height = Math.min(bitmap.height - y, (rect.height + margin * 2) * scale)
  if (width < 2 || height < 2) return undefined
  const fit = Math.min(1, 1600 / Math.max(width, height))
  const canvas = new OffscreenCanvas(Math.round(width * fit), Math.round(height * fit))
  canvas.getContext('2d').drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height)
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return 'data:image/png;base64,' + btoa(binary)
}

/**
 * Runs in the extension's isolated world: highlights the element under the pointer, and on click resolves
 * with the same description the Dev Preview companion produces (component names are added afterwards, see
 * componentNamesInPage). Only real input counts, so a page cannot pick for the user with synthetic events.
 * Esc, or starting it again, cancels. Self-contained: injected by chrome.scripting.
 */
function pickerInPage() {
  if (globalThis.__hsChromePick) { globalThis.__hsChromePick(); return null }
  return new Promise((resolve) => {
    const box = document.createElement('div')
    box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;box-sizing:border-box;border:2px solid #3b82f6;background:rgba(59,130,246,.12);border-radius:3px;display:none'
    const label = document.createElement('div')
    label.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;padding:2px 6px;border-radius:4px;background:#3b82f6;color:#fff;font:600 11px/16px ui-monospace,Menlo,monospace;white-space:nowrap;display:none'
    const banner = document.createElement('div')
    banner.textContent = 'Click an element to send it to Harness Studio · Esc to cancel'
    banner.style.cssText = 'position:fixed;z-index:2147483647;top:10px;left:50%;transform:translateX(-50%);pointer-events:none;padding:6px 12px;border-radius:8px;background:#111827;color:#fff;font:500 13px/18px -apple-system,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3)'
    const ours = el => el === box || el === label || el === banner
    document.documentElement.append(box, label, banner)
    const cursor = document.documentElement.style.cursor
    document.documentElement.style.cursor = 'crosshair'
    let hovered
    const STYLE_KEYS = ['display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color', 'font-family', 'font-size',
      'font-weight', 'line-height', 'border', 'border-radius', 'gap', 'flex-direction', 'justify-content', 'align-items', 'opacity', 'box-shadow']
    const shortName = (el) => {
      let s = el.tagName.toLowerCase()
      if (el.id) s += '#' + el.id
      const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
      return cls.length ? s + '.' + cls.join('.') : s
    }
    const cssPath = (start) => {
      const parts = []
      let el = start
      while (el instanceof Element && el !== document.documentElement && parts.length < 8) {
        if (el.id) { parts.unshift('#' + CSS.escape(el.id)); break }
        let part = el.tagName.toLowerCase()
        const parent = el.parentElement
        if (parent) {
          const same = [...parent.children].filter(c => c.tagName === el.tagName)
          if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(el) + 1) + ')'
        }
        parts.unshift(part)
        el = parent
      }
      return parts.join(' > ')
    }
    const source = (el) => {
      for (let node = el; node instanceof Element; node = node.parentElement) {
        const src = node.getAttribute('data-src') || node.getAttribute('data-inspector-relative-path')
        if (src) return { location: src.slice(0, 500), exact: node === el }
      }
      return undefined
    }
    const describe = (el) => {
      const r = el.getBoundingClientRect()
      const computed = getComputedStyle(el)
      const styles = {}
      for (const k of STYLE_KEYS) styles[k] = computed.getPropertyValue(k)
      const html = el.outerHTML
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
      return {
        pageUrl: location.href, tag: el.tagName.toLowerCase(), name: shortName(el), selector: cssPath(el),
        text: text.length > 300 ? text.slice(0, 300) + '…' : text,
        rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
        styles, html: html.length > 3000 ? html.slice(0, 3000) + '…' : html, components: [], source: source(el),
      }
    }
    const swallow = (event) => { event.preventDefault(); event.stopPropagation() }
    const onMove = (event) => {
      const el = event.target
      if (!event.isTrusted || !(el instanceof Element) || ours(el)) return
      hovered = el
      const r = el.getBoundingClientRect()
      Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' })
      label.textContent = shortName(el) + '  ' + Math.round(r.width) + '×' + Math.round(r.height)
      Object.assign(label.style, { display: 'block', left: Math.max(2, r.left) + 'px', top: (r.top >= 20 ? r.top - 20 : r.bottom + 2) + 'px' })
    }
    const finish = (value) => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('mousedown', swallow, true)
      document.removeEventListener('mouseup', swallow, true)
      document.removeEventListener('keydown', onKey, true)
      document.documentElement.style.cursor = cursor
      box.remove(); label.remove(); banner.remove()
      delete globalThis.__hsChromePick
      // Two frames, so the highlight is gone from the screen before the screenshot.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(value)))
    }
    const onClick = (event) => {
      if (!event.isTrusted) return
      swallow(event)
      const el = hovered || event.target
      if (!(el instanceof Element) || ours(el)) return
      const selection = describe(el)
      // A one-off mark so the page-world call can find the same element for its component names.
      const token = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('') // randomUUID needs https
      el.setAttribute('data-hs-pick', token)
      globalThis.__hsPicked = el
      finish({ selection, token, rect: selection.rect, viewport: { width: innerWidth, height: innerHeight } })
    }
    const onKey = (event) => { if (event.isTrusted && event.key === 'Escape') { swallow(event); finish(null) } }
    globalThis.__hsChromePick = () => finish(null)
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('mousedown', swallow, true)
    document.addEventListener('mouseup', swallow, true)
    document.addEventListener('keydown', onKey, true)
  })
}

/** Isolated world: removes the picked element's one-off mark. */
function unmarkPicked() {
  globalThis.__hsPicked?.removeAttribute('data-hs-pick')
  delete globalThis.__hsPicked
}

/**
 * Runs in the page's own world, the only place React's fiber expandos are visible: names of the components
 * around the marked element. The page controls this world, so the caller treats the result as untrusted.
 */
function componentNamesInPage(token) {
  const el = document.querySelector('[data-hs-pick="' + String(token).replace(/[^\w-]/g, '') + '"]')
  if (!el) return []
  const INTERNAL = /^(SegmentViewNode|SegmentStateProvider|LayoutRouterContext|InnerLayoutRouter|OuterLayoutRouter|RenderFromTemplateContext|ScrollAndFocusHandler|InnerScrollAndFocusHandler|InnerScrollHandler|ScrollHandler|RedirectBoundary|RedirectErrorBoundary|HTTPAccessFallbackBoundary|HTTPAccessFallbackErrorBoundary|LoadingBoundary|ErrorBoundary|ErrorBoundaryHandler|DevRootHTTPAccessFallbackBoundary|AppDevOverlayErrorBoundary|HotReload|Router|AppRouter|ServerRoot|Root|ClientPageRoot|ClientSegmentRoot|MetadataBoundary|ViewportBoundary|OutletBoundary|Suspense|Fragment|StrictMode|Provider|Consumer)$|Context$|Provider$/
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
  const names = []
  for (let fiber = key ? el[key] : undefined, steps = 0; fiber && names.length < 4 && steps < 200; fiber = fiber.return, steps++) {
    const type = fiber.type
    const name = typeof type === 'function' ? (type.displayName || type.name)
      : type && typeof type === 'object' ? (type.displayName || (type.render && (type.render.displayName || type.render.name))) : undefined
    if (typeof name === 'string' && name && !INTERNAL.test(name) && !names.includes(name)) names.push(name)
  }
  return names
}

// ---------------------------------------------- functions injected into pages (self-contained) ----

// These run in the extension's isolated world (chrome.scripting's default), which the page's scripts cannot
// see. It lasts as long as the document, so one call can leave state there for the next.

function readPage() {
  const MAX_TEXT = 6000, MAX_ELEMENTS = 150
  // Element numbers live here, in the isolated world, and never in the page's DOM: a page that could read
  // them could move a number onto another element between a read and the agent's click or typing.
  const refs = globalThis.__hsRefs = new Map() // number → WeakRef(element)
  // Fields whose value must not reach the model: passwords, one-time codes and card details.
  const SECRET_AUTOCOMPLETE = /(^|\s)(one-time-code|cc-number|cc-csc|cc-exp|cc-exp-month|cc-exp-year|new-password|current-password)(\s|$)/
  const SECRET_WORDS = new Set(['password', 'passwd', 'passcode', 'pwd', 'otp', 'totp', 'pin', 'cvv', 'cvc', 'csc', 'cvn', 'ssn', 'secret'])
  const SECRET_PHRASE = /password|passcode|-one-?time-|-card-?(number|num|no)-|-cc-?(num|number|csc|cvv|exp)|-security-?code-/
  const secretName = (el) => {
    // name and id split into words: "cardNumber", "card_number" and "card-number" all read card, number.
    const words = ((el.getAttribute('name') || '') + ' ' + (el.id || '')).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    return words.some(w => SECRET_WORDS.has(w)) || SECRET_PHRASE.test('-' + words.join('-') + '-')
  }
  const secret = el => el.type === 'password' || SECRET_AUTOCOMPLETE.test((el.getAttribute('autocomplete') || '').toLowerCase()) || secretName(el)
  const visible = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const c = getComputedStyle(el); return c.visibility !== 'hidden' && c.display !== 'none' && c.opacity !== '0' }
  const clean = t => (t || '').replace(/\s+/g, ' ').trim()
  const nameOf = el => clean(el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || (el.tagName === 'INPUT' && /button|submit|reset/.test(el.type) ? el.value : '')).slice(0, 100)
  const kindOf = el => {
    const role = el.getAttribute('role'); const tag = el.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'input') return 'input[' + (el.type || 'text') + ']'
    if (tag === 'select' || tag === 'textarea') return tag
    if (tag === 'button' || tag === 'summary') return 'button'
    if (role) return role
    if (el.isContentEditable) return 'editable'
    return tag
  }
  const selector = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=switch], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=option], [role=combobox], [role=treeitem], [role=slider], [role=spinbutton], [role=searchbox], [role=textbox], [contenteditable=""], [contenteditable=true], [onclick], [tabindex]:not([tabindex="-1"])'
  const CONTROLS = 'a[href], button, [role=button], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=option], [role=tab], [role=link]'
  const rank = el => {
    if (el.closest('[role=menu], [role=menubar], [role=listbox], [role=dialog], [role=alertdialog], dialog[open]')) return 0
    const r = el.getBoundingClientRect()
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth ? 1 : 2
  }
  const all = [...document.querySelectorAll(selector)].filter(el => !el.parentElement?.closest(CONTROLS)).filter(visible)
    .map((el, i) => ({ el, i, r: rank(el) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.el)
  const elements = []
  for (const el of all.slice(0, MAX_ELEMENTS)) {
    const ref = elements.length + 1
    refs.set(ref, new WeakRef(el))
    const item = { ref, kind: kindOf(el), name: nameOf(el) }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') item.value = secret(el) ? (el.value ? '••••' : '') : String(el.value).slice(0, 100)
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) item.value = el.checked ? 'checked' : 'unchecked'
    if (el.getAttribute('aria-checked') !== null) item.value = el.getAttribute('aria-checked') === 'true' ? 'checked' : 'unchecked'
    if (el.getAttribute('aria-selected') === 'true') item.value = 'selected'
    if (el.tagName === 'A' && el.getAttribute('href')) item.href = el.getAttribute('href').slice(0, 200)
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') item.disabled = true
    elements.push(item)
  }
  let text = (document.body ? document.body.innerText : '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '\n… [text truncated]'
  // Playing state of the page's videos and audio: what text alone can't show (paused or not, position, resolution).
  const media = [...document.querySelectorAll('video, audio')].filter(m => m.duration > 0 || m.currentTime > 0).slice(0, 3).map(m => ({
    kind: m.tagName.toLowerCase(), playing: !m.paused && !m.ended, time: Math.round(m.currentTime),
    duration: Number.isFinite(m.duration) ? Math.round(m.duration) : null, muted: m.muted,
    ...(m.tagName === 'VIDEO' && m.videoHeight ? { resolution: `${m.videoWidth}x${m.videoHeight}` } : {}),
  }))
  return { url: location.href, title: document.title, text, elements, media, moreElements: Math.max(0, all.length - MAX_ELEMENTS) }
}

/** A point inside the element that a real click would land on, after scrolling it into view; `covered` when
 *  every sampled point hits something else (a clipped menu, an overlay). Async: waits for the scroll. */
async function clickPoint(ref) {
  const el = globalThis.__hsRefs?.get(Number(ref))?.deref()
  if (!el || !el.isConnected) return null
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  await new Promise(r => setTimeout(r, 120))
  const r = el.getBoundingClientRect()
  const left = Math.max(r.left, 0), right = Math.min(r.right, innerWidth), top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight)
  const cx = (left + right) / 2, cy = (top + bottom) / 2
  if (right > left && bottom > top) {
    const xs = [cx, left + (right - left) * 0.25, left + (right - left) * 0.75]
    const ys = [cy, top + (bottom - top) * 0.25, top + (bottom - top) * 0.75]
    for (const y of ys) for (const x of xs) {
      const hit = document.elementFromPoint(x, y)
      if (hit && (hit === el || el.contains(hit))) return { x: Math.round(x), y: Math.round(y) }
    }
  }
  return { x: Math.round(cx), y: Math.round(cy), covered: true }
}

/** The fallback click, from the page, on a numbered element. */
function clickFromPage(ref) {
  const el = globalThis.__hsRefs?.get(Number(ref))?.deref()
  if (el && el.isConnected) el.click()
}

/** Resolves once the page has gone `idleMs` without changes, or after `maxMs`. */
function pageQuiet(maxMs, idleMs) {
  return new Promise((resolve) => {
    let idle
    const done = () => { observer.disconnect(); clearTimeout(idle); clearTimeout(cap); resolve(true) }
    const observer = new MutationObserver(() => { clearTimeout(idle); idle = setTimeout(done, idleMs) })
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true })
    idle = setTimeout(done, idleMs)
    const cap = setTimeout(done, maxMs)
  })
}

function pressWithoutDebugger(key) {
  const target = document.activeElement || document.body
  const init = { key: key.key, code: key.code, keyCode: key.keyCode, bubbles: true, cancelable: true, shiftKey: !!(key.modifiers & 8), ctrlKey: !!(key.modifiers & 2), altKey: !!(key.modifiers & 1), metaKey: !!(key.modifiers & 4) }
  target.dispatchEvent(new KeyboardEvent('keydown', init))
  target.dispatchEvent(new KeyboardEvent('keyup', init))
  return true
}

function focusField(ref) {
  const el = globalThis.__hsRefs?.get(Number(ref))?.deref()
  if (!el || !el.isConnected) return false
  el.scrollIntoView({ block: 'center' })
  el.focus()
  if (typeof el.select === 'function') el.select()
  else if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r) }
  return document.activeElement === el || el.contains(document.activeElement)
}

function typeWithoutDebugger(ref, text, submit) {
  const el = globalThis.__hsRefs?.get(Number(ref))?.deref()
  if (!el || !el.isConnected) return false
  if ('value' in el) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } else if (el.isContentEditable) {
    document.execCommand('insertText', false, text)
  }
  if (submit) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    el.form?.requestSubmit?.()
  }
  return true
}
