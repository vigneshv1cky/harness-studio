/*!
 * Harness Studio Dev Preview companion — DEVELOPMENT ONLY.
 *
 * Add this script to your app while it runs in development. It lets the Harness
 * Browser pane put the page into pick mode: hovering outlines elements, clicking one
 * sends a description of it (tag, selector, text, styles, HTML, React component names,
 * and the nearest data-src source location) back to the Browser pane.
 *
 * Transport:
 *   - Inside an iframe (Harness Web): window.postMessage with the parent window. Only a
 *     parent on a Harness origin is obeyed or answered: dsh-app://app,
 *     http://localhost:3080, http://127.0.0.1:3080, plus any origins listed (space
 *     separated) in the script tag's data-harness-origins attribute. Nothing is ever
 *     posted to '*', so a site that frames your dev app gets no pick mode and no data.
 *   - As a top-level page (Harness Desktop <webview>): the Browser pane calls
 *     window.__hsDevPreview.command(...) and reads replies from tagged console messages.
 *
 * The script does nothing until the Browser pane talks to it.
 */
(function () {
  'use strict'
  if (window.__hsDevPreview !== undefined) return

  var VERSION = 1
  var FROM_TAB = 'harness-studio-devpreview'
  var FROM_PAGE = 'harness-studio-companion'
  var CONSOLE_PREFIX = '__HS_DEVPREVIEW__'
  var framed = window.parent !== window
  var HARNESS_ORIGINS = ['dsh-app://app', 'http://localhost:3080', 'http://127.0.0.1:3080']
  var script = document.currentScript
  var extraOrigins = script && script.getAttribute('data-harness-origins')
  if (extraOrigins) HARNESS_ORIGINS = HARNESS_ORIGINS.concat(extraOrigins.split(/\s+/).filter(Boolean))
  var parentOrigin = undefined // a Harness origin, learned from its hello; every message goes only there
  var picking = false
  var hovered = undefined
  var overlay = undefined
  var label = undefined

  // ---------- transport ----------

  function send(message) {
    message.source = FROM_PAGE
    message.version = VERSION
    if (framed) {
      // Nothing goes out before a Harness parent has said hello, and then only to its origin.
      if (parentOrigin !== undefined) window.parent.postMessage(message, parentOrigin)
    } else {
      console.debug(CONSOLE_PREFIX + JSON.stringify(message))
    }
  }

  function command(cmd) {
    if (cmd === null || typeof cmd !== 'object') return
    if (cmd.type === 'hello') send({ type: 'ready', url: location.href })
    else if (cmd.type === 'pick:on') setPicking(true)
    else if (cmd.type === 'pick:off') setPicking(false)
  }

  if (framed) {
    window.addEventListener('message', function (event) {
      if (event.source !== window.parent) return
      var data = event.data
      if (data === null || typeof data !== 'object' || data.source !== FROM_TAB) return
      if (HARNESS_ORIGINS.indexOf(event.origin) === -1) return
      if (data.type === 'hello') parentOrigin = event.origin
      if (event.origin !== parentOrigin) return
      command(data)
    })
  }

  window.__hsDevPreview = { version: VERSION, command: command }

  // ---------- pick mode ----------

  function ensureOverlay() {
    if (overlay !== undefined) return
    overlay = document.createElement('div')
    overlay.setAttribute('data-hs-devpreview', 'overlay')
    overlay.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;box-sizing:border-box;' +
      'border:2px solid #3b82f6;background:rgba(59,130,246,.12);border-radius:3px;transition:all 40ms linear;display:none'
    label = document.createElement('div')
    label.setAttribute('data-hs-devpreview', 'label')
    label.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;padding:2px 6px;border-radius:4px;' +
      'background:#3b82f6;color:#fff;font:600 11px/16px ui-monospace,Menlo,monospace;white-space:nowrap;display:none'
    document.documentElement.appendChild(overlay)
    document.documentElement.appendChild(label)
  }

  function isOwn(node) {
    return node instanceof Element && node.hasAttribute('data-hs-devpreview')
  }

  function setPicking(on) {
    if (picking === on) return
    picking = on
    if (on) {
      ensureOverlay()
      document.addEventListener('mousemove', onMove, true)
      document.addEventListener('click', onClick, true)
      document.addEventListener('mousedown', swallow, true)
      document.addEventListener('mouseup', swallow, true)
      document.addEventListener('keydown', onKey, true)
      document.documentElement.style.cursor = 'crosshair'
    } else {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('mousedown', swallow, true)
      document.removeEventListener('mouseup', swallow, true)
      document.removeEventListener('keydown', onKey, true)
      document.documentElement.style.cursor = ''
      hovered = undefined
      if (overlay !== undefined) { overlay.style.display = 'none'; label.style.display = 'none' }
    }
    send({ type: 'pick:state', picking: on })
  }

  function swallow(event) {
    event.preventDefault()
    event.stopPropagation()
  }

  function onMove(event) {
    var el = event.target
    if (!(el instanceof Element) || isOwn(el)) return
    hovered = el
    var r = el.getBoundingClientRect()
    overlay.style.display = 'block'
    overlay.style.left = r.left + 'px'
    overlay.style.top = r.top + 'px'
    overlay.style.width = r.width + 'px'
    overlay.style.height = r.height + 'px'
    var names = reactComponents(el)
    label.textContent = (names[0] ? names[0] + ' · ' : '') + shortName(el) + '  ' + Math.round(r.width) + '×' + Math.round(r.height)
    label.style.display = 'block'
    label.style.left = Math.max(2, r.left) + 'px'
    label.style.top = (r.top >= 20 ? r.top - 20 : r.bottom + 2) + 'px'
  }

  function onClick(event) {
    swallow(event)
    var el = hovered || event.target
    if (!(el instanceof Element) || isOwn(el)) return
    var payload = describe(el)
    setPicking(false)
    send({ type: 'selection', selection: payload })
  }

  function onKey(event) {
    if (event.key === 'Escape') { swallow(event); setPicking(false); send({ type: 'pick:cancelled' }) }
  }

  // ---------- describing an element ----------

  var STYLE_KEYS = ['display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color',
    'font-family', 'font-size', 'font-weight', 'line-height', 'border', 'border-radius', 'gap', 'flex-direction',
    'justify-content', 'align-items', 'opacity', 'box-shadow']

  function shortName(el) {
    var s = el.tagName.toLowerCase()
    if (el.id) s += '#' + el.id
    var cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    if (cls.length) s += '.' + cls.join('.')
    return s
  }

  function cssPath(el) {
    var parts = []
    while (el instanceof Element && el !== document.documentElement && parts.length < 8) {
      if (el.id) { parts.unshift('#' + CSS.escape(el.id)); break }
      var part = el.tagName.toLowerCase()
      var parent = el.parentElement
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === el.tagName })
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(el) + 1) + ')'
      }
      parts.unshift(part)
      el = parent
    }
    return parts.join(' > ')
  }

  // Framework-internal components that say nothing about the user's code.
  var INTERNAL_COMPONENT = /^(SegmentViewNode|SegmentStateProvider|LayoutRouterContext|InnerLayoutRouter|OuterLayoutRouter|RenderFromTemplateContext|ScrollAndFocusHandler|InnerScrollAndFocusHandler|InnerScrollHandler|ScrollHandler|RedirectBoundary|RedirectErrorBoundary|HTTPAccessFallbackBoundary|HTTPAccessFallbackErrorBoundary|LoadingBoundary|ErrorBoundary|ErrorBoundaryHandler|DevRootHTTPAccessFallbackBoundary|AppDevOverlayErrorBoundary|HotReload|Router|AppRouter|ServerRoot|Root|ClientPageRoot|ClientSegmentRoot|MetadataBoundary|ViewportBoundary|OutletBoundary|Suspense|Fragment|StrictMode|Provider|Consumer)$|Context$|Provider$/

  function reactComponents(el) {
    var key = Object.keys(el).find(function (k) { return k.indexOf('__reactFiber$') === 0 })
    if (key === undefined) return []
    var names = []
    var fiber = el[key]
    while (fiber && names.length < 4) {
      var type = fiber.type
      var name = typeof type === 'function' ? (type.displayName || type.name)
        : (type && typeof type === 'object' ? (type.displayName || (type.render && (type.render.displayName || type.render.name))) : undefined)
      if (name && !INTERNAL_COMPONENT.test(name) && names.indexOf(name) === -1) names.push(name)
      fiber = fiber.return
    }
    return names
  }

  function nearestSource(el) {
    for (var node = el; node instanceof Element; node = node.parentElement) {
      var src = node.getAttribute('data-src') || node.getAttribute('data-inspector-relative-path')
      if (src) return { location: src, exact: node === el }
    }
    return undefined
  }

  function describe(el) {
    var r = el.getBoundingClientRect()
    var computed = getComputedStyle(el)
    var styles = {}
    STYLE_KEYS.forEach(function (k) { styles[k] = computed.getPropertyValue(k) })
    var html = el.outerHTML
    var text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
    return {
      pageUrl: location.href,
      tag: el.tagName.toLowerCase(),
      name: shortName(el),
      selector: cssPath(el),
      id: el.id || undefined,
      classes: (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean),
      text: text.length > 300 ? text.slice(0, 300) + '…' : text,
      rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      styles: styles,
      html: html.length > 3000 ? html.slice(0, 3000) + '…' : html,
      components: reactComponents(el),
      source: nearestSource(el),
    }
  }

  // Desktop: announce presence on the console the Browser pane reads. In an iframe the page stays
  // silent until a Harness parent says hello, and answers that with 'ready'.
  if (!framed) send({ type: 'ready', url: location.href })
})()
