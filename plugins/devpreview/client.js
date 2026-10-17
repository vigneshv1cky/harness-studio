// Client half of the Dev Preview bundle (hand-written loader format, no build step).
// Makes Harness's right sidebar work like Claude Code desktop's: a pane toolbar in the
// conversation header, Changes / Session / Files panes, and Browser-pane extras — pick an element
// for the agent, annotate the page, a dev-servers menu and a ⋮ menu.
// Picking talks to the dev-only companion script in the page:
//   Desktop -> the browser pane's <webview>: commands via executeJavaScript, replies via tagged
//              console messages (the companion is injected when the page lacks it)
//   Web     -> the browser pane's <iframe>: postMessage with the page's own companion
window.__ModuleLoader__.load({
  id: '@harness-studio/devpreview',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState, useCallback } = React

    const FROM_TAB = 'harness-studio-devpreview'
    const FROM_PAGE = 'harness-studio-companion'
    const CONSOLE_PREFIX = '__HS_DEVPREVIEW__'
    // Copy of plugins/devpreview-companion/companion.js (kept in sync by scripts/embed-companion.mjs).
    // Desktop injects it into pages that do not load it themselves, such as live websites.
    const COMPANION_SOURCE = /*@companion-start*/"/*!\n * Harness Studio Dev Preview companion — DEVELOPMENT ONLY.\n *\n * Add this script to your app while it runs in development. It lets the Harness\n * Browser pane put the page into pick mode: hovering outlines elements, clicking one\n * sends a description of it (tag, selector, text, styles, HTML, React component names,\n * and the nearest data-src source location) back to the Browser pane.\n *\n * Transport:\n *   - Inside an iframe (Harness Web): window.postMessage with the parent window. Only a\n *     parent on a Harness origin is obeyed or answered: dsh-app://app,\n *     http://localhost:3080, http://127.0.0.1:3080, plus any origins listed (space\n *     separated) in the script tag's data-harness-origins attribute. Nothing is ever\n *     posted to '*', so a site that frames your dev app gets no pick mode and no data.\n *   - As a top-level page (Harness Desktop <webview>): the Browser pane calls\n *     window.__hsDevPreview.command(...) and reads replies from tagged console messages.\n *\n * The script does nothing until the Browser pane talks to it.\n */\n(function () {\n  'use strict'\n  if (window.__hsDevPreview !== undefined) return\n\n  var VERSION = 1\n  var FROM_TAB = 'harness-studio-devpreview'\n  var FROM_PAGE = 'harness-studio-companion'\n  var CONSOLE_PREFIX = '__HS_DEVPREVIEW__'\n  var framed = window.parent !== window\n  var HARNESS_ORIGINS = ['dsh-app://app', 'http://localhost:3080', 'http://127.0.0.1:3080']\n  var script = document.currentScript\n  var extraOrigins = script && script.getAttribute('data-harness-origins')\n  if (extraOrigins) HARNESS_ORIGINS = HARNESS_ORIGINS.concat(extraOrigins.split(/\\s+/).filter(Boolean))\n  var parentOrigin = undefined // a Harness origin, learned from its hello; every message goes only there\n  var picking = false\n  var hovered = undefined\n  var overlay = undefined\n  var label = undefined\n\n  // ---------- transport ----------\n\n  function send(message) {\n    message.source = FROM_PAGE\n    message.version = VERSION\n    if (framed) {\n      // Nothing goes out before a Harness parent has said hello, and then only to its origin.\n      if (parentOrigin !== undefined) window.parent.postMessage(message, parentOrigin)\n    } else {\n      console.debug(CONSOLE_PREFIX + JSON.stringify(message))\n    }\n  }\n\n  function command(cmd) {\n    if (cmd === null || typeof cmd !== 'object') return\n    if (cmd.type === 'hello') send({ type: 'ready', url: location.href })\n    else if (cmd.type === 'pick:on') setPicking(true)\n    else if (cmd.type === 'pick:off') setPicking(false)\n  }\n\n  if (framed) {\n    window.addEventListener('message', function (event) {\n      if (event.source !== window.parent) return\n      var data = event.data\n      if (data === null || typeof data !== 'object' || data.source !== FROM_TAB) return\n      if (HARNESS_ORIGINS.indexOf(event.origin) === -1) return\n      if (data.type === 'hello') parentOrigin = event.origin\n      if (event.origin !== parentOrigin) return\n      command(data)\n    })\n  }\n\n  window.__hsDevPreview = { version: VERSION, command: command }\n\n  // ---------- pick mode ----------\n\n  function ensureOverlay() {\n    if (overlay !== undefined) return\n    overlay = document.createElement('div')\n    overlay.setAttribute('data-hs-devpreview', 'overlay')\n    overlay.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;box-sizing:border-box;' +\n      'border:2px solid #3b82f6;background:rgba(59,130,246,.12);border-radius:3px;transition:all 40ms linear;display:none'\n    label = document.createElement('div')\n    label.setAttribute('data-hs-devpreview', 'label')\n    label.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;padding:2px 6px;border-radius:4px;' +\n      'background:#3b82f6;color:#fff;font:600 11px/16px ui-monospace,Menlo,monospace;white-space:nowrap;display:none'\n    document.documentElement.appendChild(overlay)\n    document.documentElement.appendChild(label)\n  }\n\n  function isOwn(node) {\n    return node instanceof Element && node.hasAttribute('data-hs-devpreview')\n  }\n\n  function setPicking(on) {\n    if (picking === on) return\n    picking = on\n    if (on) {\n      ensureOverlay()\n      document.addEventListener('mousemove', onMove, true)\n      document.addEventListener('click', onClick, true)\n      document.addEventListener('mousedown', swallow, true)\n      document.addEventListener('mouseup', swallow, true)\n      document.addEventListener('keydown', onKey, true)\n      document.documentElement.style.cursor = 'crosshair'\n    } else {\n      document.removeEventListener('mousemove', onMove, true)\n      document.removeEventListener('click', onClick, true)\n      document.removeEventListener('mousedown', swallow, true)\n      document.removeEventListener('mouseup', swallow, true)\n      document.removeEventListener('keydown', onKey, true)\n      document.documentElement.style.cursor = ''\n      hovered = undefined\n      if (overlay !== undefined) { overlay.style.display = 'none'; label.style.display = 'none' }\n    }\n    send({ type: 'pick:state', picking: on })\n  }\n\n  function swallow(event) {\n    event.preventDefault()\n    event.stopPropagation()\n  }\n\n  function onMove(event) {\n    var el = event.target\n    if (!(el instanceof Element) || isOwn(el)) return\n    hovered = el\n    var r = el.getBoundingClientRect()\n    overlay.style.display = 'block'\n    overlay.style.left = r.left + 'px'\n    overlay.style.top = r.top + 'px'\n    overlay.style.width = r.width + 'px'\n    overlay.style.height = r.height + 'px'\n    var names = reactComponents(el)\n    label.textContent = (names[0] ? names[0] + ' · ' : '') + shortName(el) + '  ' + Math.round(r.width) + '×' + Math.round(r.height)\n    label.style.display = 'block'\n    label.style.left = Math.max(2, r.left) + 'px'\n    label.style.top = (r.top >= 20 ? r.top - 20 : r.bottom + 2) + 'px'\n  }\n\n  function onClick(event) {\n    swallow(event)\n    var el = hovered || event.target\n    if (!(el instanceof Element) || isOwn(el)) return\n    var payload = describe(el)\n    setPicking(false)\n    send({ type: 'selection', selection: payload })\n  }\n\n  function onKey(event) {\n    if (event.key === 'Escape') { swallow(event); setPicking(false); send({ type: 'pick:cancelled' }) }\n  }\n\n  // ---------- describing an element ----------\n\n  var STYLE_KEYS = ['display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color',\n    'font-family', 'font-size', 'font-weight', 'line-height', 'border', 'border-radius', 'gap', 'flex-direction',\n    'justify-content', 'align-items', 'opacity', 'box-shadow']\n\n  function shortName(el) {\n    var s = el.tagName.toLowerCase()\n    if (el.id) s += '#' + el.id\n    var cls = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2)\n    if (cls.length) s += '.' + cls.join('.')\n    return s\n  }\n\n  function cssPath(el) {\n    var parts = []\n    while (el instanceof Element && el !== document.documentElement && parts.length < 8) {\n      if (el.id) { parts.unshift('#' + CSS.escape(el.id)); break }\n      var part = el.tagName.toLowerCase()\n      var parent = el.parentElement\n      if (parent) {\n        var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === el.tagName })\n        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(el) + 1) + ')'\n      }\n      parts.unshift(part)\n      el = parent\n    }\n    return parts.join(' > ')\n  }\n\n  // Framework-internal components that say nothing about the user's code.\n  var INTERNAL_COMPONENT = /^(SegmentViewNode|SegmentStateProvider|LayoutRouterContext|InnerLayoutRouter|OuterLayoutRouter|RenderFromTemplateContext|ScrollAndFocusHandler|InnerScrollAndFocusHandler|InnerScrollHandler|ScrollHandler|RedirectBoundary|RedirectErrorBoundary|HTTPAccessFallbackBoundary|HTTPAccessFallbackErrorBoundary|LoadingBoundary|ErrorBoundary|ErrorBoundaryHandler|DevRootHTTPAccessFallbackBoundary|AppDevOverlayErrorBoundary|HotReload|Router|AppRouter|ServerRoot|Root|ClientPageRoot|ClientSegmentRoot|MetadataBoundary|ViewportBoundary|OutletBoundary|Suspense|Fragment|StrictMode|Provider|Consumer)$|Context$|Provider$/\n\n  function reactComponents(el) {\n    var key = Object.keys(el).find(function (k) { return k.indexOf('__reactFiber$') === 0 })\n    if (key === undefined) return []\n    var names = []\n    var fiber = el[key]\n    while (fiber && names.length < 4) {\n      var type = fiber.type\n      var name = typeof type === 'function' ? (type.displayName || type.name)\n        : (type && typeof type === 'object' ? (type.displayName || (type.render && (type.render.displayName || type.render.name))) : undefined)\n      if (name && !INTERNAL_COMPONENT.test(name) && names.indexOf(name) === -1) names.push(name)\n      fiber = fiber.return\n    }\n    return names\n  }\n\n  function nearestSource(el) {\n    for (var node = el; node instanceof Element; node = node.parentElement) {\n      var src = node.getAttribute('data-src') || node.getAttribute('data-inspector-relative-path')\n      if (src) return { location: src, exact: node === el }\n    }\n    return undefined\n  }\n\n  function describe(el) {\n    var r = el.getBoundingClientRect()\n    var computed = getComputedStyle(el)\n    var styles = {}\n    STYLE_KEYS.forEach(function (k) { styles[k] = computed.getPropertyValue(k) })\n    var html = el.outerHTML\n    var text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()\n    return {\n      pageUrl: location.href,\n      tag: el.tagName.toLowerCase(),\n      name: shortName(el),\n      selector: cssPath(el),\n      id: el.id || undefined,\n      classes: (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean),\n      text: text.length > 300 ? text.slice(0, 300) + '…' : text,\n      rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },\n      styles: styles,\n      html: html.length > 3000 ? html.slice(0, 3000) + '…' : html,\n      components: reactComponents(el),\n      source: nearestSource(el),\n    }\n  }\n\n  // Desktop: announce presence on the console the Browser pane reads. In an iframe the page stays\n  // silent until a Harness parent says hello, and answers that with 'ready'.\n  if (!framed) send({ type: 'ready', url: location.href })\n})()\n"/*@companion-end*/


    // Ports the common dev servers default to: Next/CRA/Remix, Vite, Angular, Astro, Django/Rails-ish, generic.
    const DEV_PORTS = [3000, 3001, 5173, 5174, 4200, 4321, 8000, 8080, 8888]
    const PROBE_TIMEOUT_MS = 900

    /** First local dev server that answers, in port order, or undefined. */
    async function detectDevServer() {
      const probe = async (port) => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
        try {
          // An opaque no-cors response still proves something is listening; a refused port rejects.
          await fetch('http://localhost:' + port + '/', { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
          return true
        } catch { return false } finally { clearTimeout(timer) } // refused, timed out or blocked: not a server
      }
      const results = await Promise.all(DEV_PORTS.map(probe))
      const index = results.indexOf(true)
      return index === -1 ? undefined : 'http://localhost:' + DEV_PORTS[index] + '/'
    }

    /** Accept only http(s) addresses; bare "localhost:3000" gains http://. */
    function normalizeUrl(input) {
      const text = input.trim()
      if (text === '') return undefined
      const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : 'http://' + text
      try {
        const url = new URL(withScheme)
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
      } catch {
        return undefined
      }
    }



    /** A message from the companion, or undefined for anything else. Its contents are still page data. */
    function companionMessage(data) {
      return data !== null && typeof data === 'object' && !Array.isArray(data) && data.source === FROM_PAGE && typeof data.type === 'string' ? data : undefined
    }

    /**
     * Validate and trim a picked element, from the page or from Chrome. Same rules as cleanSelection in
     * index.js, so whatever the card shows is exactly what the Host accepts.
     * @param {unknown} value - the page's selection payload.
     * @returns {object | undefined} the normalised selection, or undefined when it is not one.
     */
    function normalizeSelection(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
      const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined)
      const tag = text(value.tag, 40)
      if (tag === undefined || tag === '') return undefined
      const rect = value.rect !== null && typeof value.rect === 'object' ? value.rect : {}
      const num = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined)
      const styles = {}
      if (value.styles !== null && typeof value.styles === 'object' && !Array.isArray(value.styles)) {
        for (const [k, v] of Object.entries(value.styles).slice(0, 40)) if (typeof v === 'string') styles[k.slice(0, 40)] = v.slice(0, 200)
      }
      const source = value.source !== null && typeof value.source === 'object' && typeof value.source.location === 'string'
        ? { location: value.source.location.slice(0, 300), exact: value.source.exact === true }
        : undefined
      return {
        pageUrl: text(value.pageUrl, 500),
        tag,
        name: text(value.name, 200),
        selector: text(value.selector, 500),
        text: text(value.text, 400),
        components: Array.isArray(value.components) ? value.components.filter(c => typeof c === 'string').slice(0, 4).map(c => c.slice(0, 80)) : [],
        source,
        rect: { x: num(rect.x), y: num(rect.y), width: num(rect.width), height: num(rect.height) },
        styles,
        html: text(value.html, 4000),
      }
    }

    /** Keeps one failing part of the plugin's UI from taking the rest of its slot down with it. */
    class SafeBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false, resetKey: props.resetKey }
      }
      static getDerivedStateFromError() { return { failed: true } }
      static getDerivedStateFromProps(props, state) {
        return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null
      }
      componentDidCatch(error) { console.warn('[harness-studio] ' + (this.props.label || 'Dev Preview') + ' failed to render:', error) }
      render() { return this.state.failed ? (this.props.fallback ?? null) : this.props.children }
    }

    /** setTimeout that is cleared when the component unmounts or the next one starts. */
    function useOneTimer() {
      const timer = useRef(undefined)
      useEffect(() => () => clearTimeout(timer.current), [])
      return useCallback((fn, ms) => { clearTimeout(timer.current); timer.current = setTimeout(fn, ms) }, [])
    }

    // 16px line icons drawn with the current text colour.
    function Icon({ d }) {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d }))
    }

    const styles = {
      root: {
        display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box',
        color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-base)',
        font: '13px/1.5 system-ui, sans-serif',
      },
      bar: {
        display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', boxSizing: 'border-box', minHeight: 40,
        borderBottom: '1px solid var(--dsw-alias-border-l2)',
      },
      input: {
        flex: 1, minWidth: 0, height: 28, boxSizing: 'border-box', padding: '0 10px', borderRadius: 8, border: 'none', outline: 'none',
        background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 12.5,
      },
      iconButton: {
        width: 28, height: 28, flexShrink: 0, display: 'grid', placeItems: 'center', padding: 0, borderRadius: 6,
        border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer',
      },
      iconActive: {
        background: 'color-mix(in srgb, var(--dsw-alias-button-info-fill) 18%, transparent)', color: 'var(--dsw-alias-button-info-fill)',
      },
      button: {
        padding: '3px 8px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', font: 'inherit',
      },
      buttonActive: { background: 'var(--dsw-alias-button-info-fill)', borderColor: 'var(--dsw-alias-button-info-fill)', color: '#fff' },
      status: { padding: '3px 10px', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      error: { padding: '3px 10px', fontSize: 11, color: 'var(--dsw-alias-state-error-primary)' },
      viewport: { position: 'relative', flex: 1, minHeight: 0, background: '#fff' },
      empty: {
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: 24, textAlign: 'center', background: 'var(--dsw-alias-bg-base)',
      },
      emptyTitle: { fontSize: 14, fontWeight: 500, color: 'var(--dsw-alias-label-primary)', marginTop: 4 },
      emptyText: { fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)', maxWidth: 300 },
      linkButton: { border: 'none', background: 'none', padding: 0, font: 'inherit', color: 'var(--dsw-alias-label-primary)', fontWeight: 500, cursor: 'pointer' },
      frame: { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: '#fff' },
      card: {
        maxHeight: '42%', overflow: 'auto', borderTop: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)', padding: '10px 12px', fontSize: 12,
      },
      cardHead: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
      mono: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 },
      muted: { color: 'var(--dsw-alias-label-tertiary)' },
      row: { display: 'flex', gap: 8, padding: '2px 0' },
      key: { width: 84, flexShrink: 0, color: 'var(--dsw-alias-label-tertiary)' },
    }

    function Row({ label, children }) {
      return h('div', { style: styles.row }, h('div', { style: styles.key }, label), h('div', { style: { minWidth: 0, wordBreak: 'break-word' } }, children))
    }

    /** One-line reference put into the composer so the user can keep typing after it (page text kept on one line). */
    function composerReference(s) {
      const flat = v => String(v).replace(/[\u0000-\u001f\u007f\u2028\u2029\]]+/g, ' ').trim()
      const where = s.source ? ' · ' + flat(s.source.location) : ''
      const inside = s.components && s.components.length > 0 ? ' in ' + flat(s.components[0]) : ''
      return '[Selected <' + flat(s.tag) + '>' + inside + where + '] '
    }

    function SelectionCard({ selection, onClear, onSend, sendState }) {
      const [copied, setCopied] = useState(false)
      const later = useOneTimer()
      const s = selection
      const components = Array.isArray(s.components) ? s.components : []
      const pageStyles = s.styles && typeof s.styles === 'object' ? s.styles : {}
      const rect = s.rect && typeof s.rect === 'object' ? s.rect : {}
      const styleSummary = ['color', 'background-color', 'font-size', 'font-weight', 'padding', 'border-radius']
        .filter(k => typeof pageStyles[k] === 'string').map(k => k + ': ' + pageStyles[k]).join('; ')
      const copy = () => {
        navigator.clipboard.writeText(JSON.stringify(s, null, 2)).then(() => {
          setCopied(true)
          later(() => setCopied(false), 1500)
        }, () => {})
      }
      return h('div', { style: styles.card, 'data-testid': 'devpreview-selection' },
        h('div', { style: styles.cardHead },
          h('strong', { style: styles.mono }, s.name || '<' + s.tag + '>'),
          components.length > 0 ? h('span', { style: styles.muted }, 'in ' + components.slice(0, 2).join(' › ')) : null,
          h('div', { style: { flex: 1 } }),
          h('button', {
            style: { ...styles.button, ...(sendState.kind === 'sent' ? null : styles.buttonActive) },
            type: 'button', onClick: onSend, disabled: sendState.kind === 'sending',
            title: 'Give this element to the agent and reference it in your message',
          }, sendState.kind === 'sending' ? 'Sending…' : sendState.kind === 'sent' ? 'Sent ✓' : 'Send to agent'),
          h('button', { style: styles.button, type: 'button', onClick: copy }, copied ? 'Copied' : 'Copy'),
          h('button', { style: styles.button, type: 'button', onClick: onClear, title: 'Clear selection' }, '✕'),
        ),
        h(Row, { label: 'Source' }, s.source
          ? h('span', { style: styles.mono }, s.source.location + (s.source.exact ? '' : ' (nearest parent)'))
          : h('span', { style: styles.muted }, 'No source location: add the Dev Preview source loader to your dev build')),
        s.text ? h(Row, { label: 'Text' }, '“' + s.text + '”') : null,
        rect.width !== undefined ? h(Row, { label: 'Size' }, rect.width + ' × ' + rect.height + (rect.x !== undefined ? ' at ' + rect.x + ', ' + rect.y : '')) : null,
        s.selector ? h(Row, { label: 'Selector' }, h('span', { style: styles.mono }, s.selector)) : null,
        styleSummary ? h(Row, { label: 'Styles' }, h('span', { style: styles.mono }, styleSummary)) : null,
        sendState.kind === 'error' ? h('div', { style: { ...styles.error, padding: '4px 0 0' }, role: 'alert' }, sendState.message) : null,
        sendState.kind === 'sent' ? h('div', { style: { ...styles.muted, paddingTop: 4 } }, 'The agent now sees this element. Describe the change in the message box, e.g. “make this bigger”.') : null,
      )
    }

    /**
     * Run `/preview-select` for one Session.
     * @returns {Promise<string | null>} an error message, or null on success.
     */
    async function runSelectCommand(ctx, sessionId, argument) {
      try {
        const result = await ctx.remote.commands.execute(sessionId, '/preview-select ' + argument, [])
        if (!result.ok) return result.error.message + ' (' + result.error.code + ')'
        if (result.value === undefined) return 'The /preview-select command is not available — is the plugin enabled on the Host?'
        return result.value.result.kind === 'error' ? result.value.result.text : null
      } catch (error) {
        return String(error && error.message ? error.message : error)
      }
    }

    // ---- Files pane: tree beside the open files, like Claude Code desktop's ------------------------
    const FILES_TAB_ID = '@harness-studio/files'
    const FILES_KIND = 'studio-files'
    const READ_LINES = 4000
    const HIDDEN_NAMES = new Set(['.git', '.DS_Store'])
    const ICON_FOLDER = 'M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z'
    const ICON_SEARCH = 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM14 14l-3.5-3.5'
    const failureText = failure => (failure && (failure.message || failure.code)) || 'Could not read it'
    const relativeTo = (root, path) => (root && path.startsWith(root + '/') ? path.slice(root.length + 1) : path)
    const baseName = path => path.slice(path.lastIndexOf('/') + 1)

    const FILES_CSS = `
      .hs-files { display: flex; height: 100%; min-height: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }
      .hs-files-side { width: 248px; flex: none; display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--dsw-alias-border-l2); }
      .hs-files-filter { position: relative; padding: 8px; }
      .hs-files-filter input { width: 100%; box-sizing: border-box; height: 30px; padding: 0 10px 0 32px; border-radius: 8px; outline: none; border: 1px solid var(--dsw-alias-border-l2);
        background: var(--dsw-alias-bg-base); color: inherit; font: inherit; font-size: 13px; }
      .hs-files-filter input:focus { border-color: var(--dsw-alias-button-info-fill); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-button-info-fill) 18%, transparent); }
      .hs-files-filter .hs-files-filter-icon { position: absolute; left: 18px; top: 15px; color: var(--dsw-alias-label-tertiary); pointer-events: none; display: grid; }
      .hs-files-list { flex: 1; overflow: auto; padding: 0 4px 12px; }
      .hs-files-row { display: flex; align-items: center; gap: 6px; height: 24px; padding-right: 8px; border-radius: 6px; cursor: pointer; white-space: nowrap; user-select: none; }
      .hs-files-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .hs-files-row.hs-active { background: color-mix(in srgb, var(--dsw-alias-button-info-fill) 14%, transparent); }
      .hs-files-row .hs-chevron { width: 16px; }
      .hs-files-row .hs-name { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
      .hs-files-row .hs-dir { color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; direction: rtl; text-align: left; }
      .hs-files-row .hs-dir > bdi { direction: ltr; }
      .hs-files-row mark { background: none; color: inherit; font-weight: 600; }
      .hs-files-hit { display: block; padding: 3px 8px 4px 28px; border-radius: 6px; cursor: pointer; font: 12px/18px var(--dsw-font-markdown-code-font-family, ui-monospace, monospace); color: var(--dsw-alias-label-secondary);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .hs-files-hit:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .hs-files-hit .hs-ln { color: var(--dsw-alias-label-tertiary); margin-right: 8px; }
      .hs-files-muted { color: var(--dsw-alias-label-tertiary); font-size: 12px; padding: 6px 10px; }
      .hs-files-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
      .hs-files-tabs { display: flex; align-items: stretch; gap: 0; height: 34px; flex: none; overflow-x: auto; border-bottom: 1px solid var(--dsw-alias-border-l2);
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, var(--dsw-alias-bg-base)); }
      .hs-files-tab { display: flex; align-items: center; gap: 6px; padding: 0 6px 0 10px; border-right: 1px solid var(--dsw-alias-border-l2); cursor: pointer; white-space: nowrap; color: var(--dsw-alias-label-secondary); }
      .hs-files-tab.hs-active { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-shadow: inset 0 -2px 0 var(--dsw-alias-button-info-fill); }
      .hs-files-tab button { width: 20px; height: 20px; display: grid; place-items: center; border: none; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; padding: 0; opacity: 0; }
      .hs-files-tab:hover button, .hs-files-tab.hs-active button { opacity: 1; }
      .hs-files-tab button:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .hs-files-path { display: flex; align-items: center; gap: 6px; padding: 6px 12px; font-size: 12px; color: var(--dsw-alias-label-tertiary); border-bottom: 1px solid var(--dsw-alias-border-l2); white-space: nowrap; min-width: 0; }
      .hs-files-path span { overflow: hidden; text-overflow: ellipsis; }
      .hs-files-code { flex: 1; overflow: auto; font: 13px/20px var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace); padding: 6px 0 24px; }
      .hs-files-code .hs-line { display: grid; grid-template-columns: 52px max-content; white-space: pre; }
      .hs-files-code .hs-line .hs-ln { text-align: right; padding-right: 14px; color: var(--dsw-alias-label-tertiary); user-select: none; }
      .hs-files-code .hs-line.hs-target { background: color-mix(in srgb, var(--dsw-alias-button-info-fill) 14%, transparent); }
      .hs-files-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
      .hs-files-empty strong { color: var(--dsw-alias-label-primary); font-weight: 500; font-size: 13px; }
      /* The header's tree button, highlighted while the tree shows, as in Claude Code desktop. */
      .hs-files-tree-toggle { box-sizing: border-box; width: 26px; height: 26px; display: inline-grid; place-items: center; margin: 0 8px 0 0; padding: 0 0 0 1px; border: none; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; vertical-align: middle; flex: none; }
      .hs-files-tree-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .hs-files-tree-toggle.hs-on { background: color-mix(in srgb, var(--dsw-alias-button-info-fill) 22%, transparent); color: var(--dsw-alias-button-info-fill); }
    `
    function useFilesStyles() {
      useChangesStyles() // shares the file icons and syntax colours
      useEffect(() => {
        if (document.getElementById('hs-files-css')) return undefined
        const style = document.createElement('style')
        style.id = 'hs-files-css'
        style.textContent = FILES_CSS
        document.head.append(style)
        return undefined // shared by every Files pane; left in place for the window's lifetime
      }, [])
    }

    /** Special icons Claude uses for a few well-known files; everything else is tinted by language. */
    function FilesIcon({ path }) {
      const name = baseName(path).toLowerCase()
      if (name === '.gitignore' || name === '.gitattributes') return h('span', { className: 'hs-file-icon', style: { color: '#f05133' } }, h(Icon, { d: 'M8 1.8l6.2 6.2L8 14.2 1.8 8z' }))
      if (/\.(md|mdx|markdown|txt|rst)$/.test(name)) return h('span', { className: 'hs-file-icon', style: { color: '#3fb950' } }, h(Icon, { d: 'M4 1.75h5.25L12.5 5v9.25H4zM9 1.75V5.25h3.5M6 8.5h4.5M6 11h3' }))
      return h(FileGlyph, { path })
    }

    /** Highlight the matched part of a name. */
    function marked(text, needle) {
      if (!needle) return text
      const i = text.toLowerCase().indexOf(needle)
      return i === -1 ? text : h(React.Fragment, null, text.slice(0, i), h('mark', null, text.slice(i, i + needle.length)), text.slice(i + needle.length))
    }

    /** One folder level: loads its children when first expanded. */
    function TreeLevel({ list, path, depth, activePath, onOpen }) {
      const [state, setState] = useState({ kind: 'loading' })
      const [expanded, setExpanded] = useState({})
      useEffect(() => {
        const controller = new AbortController()
        list(path, controller.signal).then(
          result => setState(result.ok ? { kind: 'ready', entries: result.value.entries } : { kind: 'failed', message: failureText(result.error) }),
          error => { if (!controller.signal.aborted) setState({ kind: 'failed', message: String(error && error.message || error) }) })
        return () => controller.abort()
      }, [list, path])
      const indent = 4 + depth * 12
      if (state.kind === 'loading') return depth === 0 ? h('div', { className: 'hs-files-muted' }, 'Loading…') : null
      if (state.kind === 'failed') return h('div', { className: 'hs-files-muted', style: { paddingLeft: indent + 20 } }, state.message)
      const sorted = state.entries.filter(entry => !HIDDEN_NAMES.has(entry.name))
        .sort((a, b) => (a.type === 'directory') === (b.type === 'directory') ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)
      if (sorted.length === 0) return h('div', { className: 'hs-files-muted', style: { paddingLeft: indent + 20 } }, depth === 0 ? 'This folder is empty' : 'Empty')
      return h(React.Fragment, null, sorted.map(entry => {
        const child = path.replace(/\/$/, '') + '/' + entry.name
        const isDir = entry.type === 'directory'
        const open = isDir && expanded[entry.name] === true
        return h(React.Fragment, { key: entry.name },
          h('div', {
            className: 'hs-files-row' + (activePath === child ? ' hs-active' : ''), style: { paddingLeft: indent }, title: entry.name,
            onClick: () => isDir ? setExpanded(prev => ({ ...prev, [entry.name]: !open })) : onOpen(child),
          },
            h('span', { className: 'hs-chevron' }, isDir ? h(Icon, { d: open ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4' }) : null),
            isDir ? null : h(FilesIcon, { path: entry.name }),
            h('span', { className: 'hs-name' }, entry.name)),
          open ? h(TreeLevel, { list, path: child, depth: depth + 1, activePath, onOpen }) : null)
      }))
    }

    /** Filtering by name: every non-ignored file of the folder (from the git helper). */
    function NameMatches({ cwd, needle, activePath, onOpen }) {
      const [all, setAll] = useState(undefined)
      useEffect(() => {
        const controller = new AbortController()
        gitGet('/files', { cwd }, controller.signal).then(result => { if (!controller.signal.aborted) setAll(result.ok && result.value.repo ? result.value.files : null) })
        return () => controller.abort()
      }, [cwd])
      if (all === undefined) return h('div', { className: 'hs-files-muted' }, 'Loading…')
      if (all === null) return h('div', { className: 'hs-files-muted' }, 'Filtering by name needs a git repository')
      const matches = all.filter(path => path.toLowerCase().includes(needle))
        .sort((a, b) => Number(!baseName(a).toLowerCase().includes(needle)) - Number(!baseName(b).toLowerCase().includes(needle)) || a.length - b.length)
        .slice(0, 200)
      if (matches.length === 0) return h('div', { className: 'hs-files-muted' }, 'No files match')
      return h(React.Fragment, null, matches.map(rel => {
        const slash = rel.lastIndexOf('/')
        const abs = cwd + '/' + rel
        return h('div', { key: rel, className: 'hs-files-row' + (activePath === abs ? ' hs-active' : ''), style: { paddingLeft: 8 }, title: rel, onClick: () => onOpen(abs) },
          h(FilesIcon, { path: rel }),
          h('span', { className: 'hs-name', style: { flex: 'none', maxWidth: '60%' } }, marked(rel.slice(slash + 1), needle)),
          h('span', { className: 'hs-dir' }, h('bdi', null, slash === -1 ? '' : rel.slice(0, slash))))
      }))
    }

    /** "?text": search inside files (git grep through the helper). */
    function ContentMatches({ cwd, query, onOpen }) {
      const [state, setState] = useState({ kind: 'idle' })
      useEffect(() => {
        if (query.trim().length < 2) { setState({ kind: 'idle' }); return undefined }
        const controller = new AbortController()
        const timer = setTimeout(() => {
          setState({ kind: 'loading' })
          gitGet('/search', { cwd, q: query }, controller.signal).then(result => {
            if (controller.signal.aborted) return
            setState(result.ok ? (result.value.repo === false ? { kind: 'norepo' } : { kind: 'ready', results: result.value.results, truncated: result.value.truncated }) : { kind: 'failed', message: result.message })
          })
        }, 250)
        return () => { clearTimeout(timer); controller.abort() }
      }, [cwd, query])
      if (state.kind === 'idle') return h('div', { className: 'hs-files-muted' }, 'Type at least two characters to search inside files')
      if (state.kind === 'loading') return h('div', { className: 'hs-files-muted' }, 'Searching…')
      if (state.kind === 'norepo') return h('div', { className: 'hs-files-muted' }, 'Searching inside files needs a git repository')
      if (state.kind === 'failed') return h('div', { className: 'hs-files-muted' }, state.message)
      if (state.results.length === 0) return h('div', { className: 'hs-files-muted' }, 'No matches')
      const byFile = []
      for (const result of state.results) {
        const last = byFile[byFile.length - 1]
        if (last && last.path === result.path) last.hits.push(result); else byFile.push({ path: result.path, hits: [result] })
      }
      const needle = query.trim().toLowerCase()
      return h(React.Fragment, null, byFile.map(group => h('div', { key: group.path },
        h('div', { className: 'hs-files-row', style: { paddingLeft: 8 }, title: group.path, onClick: () => onOpen(cwd + '/' + group.path, group.hits[0].line) },
          h(FilesIcon, { path: group.path }), h('span', { className: 'hs-name', style: { flex: 'none' } }, baseName(group.path)),
          h('span', { className: 'hs-dir' }, h('bdi', null, group.path.includes('/') ? group.path.slice(0, group.path.lastIndexOf('/')) : ''))),
        group.hits.map(hit => h('div', { key: hit.line, className: 'hs-files-hit', onClick: () => onOpen(cwd + '/' + group.path, hit.line) },
          h('span', { className: 'hs-ln' }, hit.line), marked(hit.text.trim(), needle))))),
      state.truncated ? h('div', { className: 'hs-files-muted' }, 'Showing the first matches only') : null)
    }

    function FileView({ read, path, line }) {
      const [state, setState] = useState({ kind: 'loading' })
      const targetRef = useRef(null)
      useEffect(() => {
        const controller = new AbortController()
        setState({ kind: 'loading' })
        read(path, { offset: 1, limit: READ_LINES }, controller.signal).then(
          result => setState(result.ok ? { kind: 'ready', text: result.value.text, eof: result.value.eof } : { kind: 'failed', message: failureText(result.error) }),
          error => { if (!controller.signal.aborted) setState({ kind: 'failed', message: String(error && error.message || error) }) })
        return () => controller.abort()
      }, [read, path])
      useEffect(() => { if (state.kind === 'ready' && targetRef.current) targetRef.current.scrollIntoView({ block: 'center' }) }, [state.kind, line, path])
      if (state.kind === 'loading') return h('div', { className: 'hs-files-empty' }, 'Loading…')
      if (state.kind === 'failed') return h('div', { className: 'hs-files-empty' }, /not-text|NUL/i.test(state.message) ? 'This file is not text' : state.message)
      const lang = languageOf(path)
      const lines = state.text.replace(/\n$/, '').split('\n')
      return h('div', { className: 'hs-files-code' },
        lines.map((text, i) => h('div', { key: i, ref: line === i + 1 ? targetRef : undefined, className: 'hs-line' + (line === i + 1 ? ' hs-target' : '') },
          h('span', { className: 'hs-ln' }, i + 1),
          h('span', null, highlight(text, lang).map(([cls, t], j) => cls ? h('span', { key: j, className: cls }, t) : t)))),
        state.eof ? null : h('div', { className: 'hs-files-muted', style: { paddingLeft: 66 } }, 'Showing the first ' + READ_LINES + ' lines'))
    }

    // Whether the Files pane shows its tree: one setting for every Files pane, remembered across restarts.
    const TREE_KEY = 'harness-studio.files-tree'
    const treeListeners = new Set()
    let treeShown = (() => { try { return localStorage.getItem(TREE_KEY) !== 'hidden' } catch { return true } })()
    function setTreeShown(value) {
      treeShown = value
      try { localStorage.setItem(TREE_KEY, value ? 'shown' : 'hidden') } catch { /* storage unavailable: the choice lasts for this window */ }
      for (const listener of treeListeners) listener(value)
    }
    function useTreeShown() {
      const [value, setValue] = useState(treeShown)
      useEffect(() => { treeListeners.add(setValue); return () => { treeListeners.delete(setValue) } }, [])
      return value
    }
    /** A list glyph balanced for its box: solid dots, lines a little shorter than the dots' column is wide. */
    function TreeIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        [4, 8, 12].map(y => h(React.Fragment, { key: y },
          h('circle', { cx: 3.5, cy: y, r: 1.05, fill: 'currentColor' }),
          h('path', { d: `M6.75 ${y}h6.5`, stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }))))
    }

    /** The Files pane's header title: the tree button, then the name. */
    function FilesTitle() {
      useFilesStyles()
      const shown = useTreeShown()
      return h(React.Fragment, null,
        h('button', {
          type: 'button', className: 'hs-files-tree-toggle' + (shown ? ' hs-on' : ''), 'aria-pressed': shown,
          'aria-label': shown ? 'Hide file tree' : 'Show file tree', title: shown ? 'Hide file tree' : 'Show file tree',
          onPointerDown: e => e.stopPropagation(), onClick: e => { e.stopPropagation(); setTreeShown(!shown) },
        }, h(TreeIcon)),
        'Files')
    }

    function FilesPane(props) {
      useFilesStyles()
      // Stable callers even if the injected functions are rebuilt between renders.
      const latest = useRef(props)
      latest.current = props
      const list = useCallback((path, signal) => latest.current.list(path, signal), [])
      const read = useCallback((path, range, signal) => latest.current.read(path, range, signal), [])
      // The tree starts at the Session's working folder, as Harness's own Files pane does.
      const cwd = props.useSessions(sessions => sessions.byId[props.sessionId]?.cwd)
      const [filter, setFilter] = useState('')
      const treeOn = useTreeShown()
      const [tabs, setTabs] = useState([]) // [{ path, line }]
      const [active, setActive] = useState(undefined)
      const open = (path, line) => {
        setTabs(prev => prev.some(t => t.path === path) ? prev.map(t => t.path === path ? { path, line } : t) : [...prev, { path, line }])
        setActive(path)
      }
      const close = (path) => {
        const index = tabs.findIndex(t => t.path === path)
        const next = tabs.filter(t => t.path !== path)
        setTabs(next)
        if (active === path) setActive(next.length ? (next[Math.max(0, index - 1)] || next[0]).path : undefined)
      }
      const current = tabs.find(t => t.path === active)
      const query = filter.trim()
      let side
      if (cwd === undefined) side = h('div', { className: 'hs-files-muted' }, 'This session has no folder')
      else if (query.startsWith('?')) side = h(ContentMatches, { cwd, query: query.slice(1), onOpen: open })
      else if (query !== '') side = h(NameMatches, { cwd, needle: query.toLowerCase(), activePath: active, onOpen: open })
      else side = h(TreeLevel, { list, path: cwd, depth: 0, activePath: active, onOpen: path => open(path) })
      return h('div', { className: 'hs-files', 'data-testid': 'studio-files' },
        treeOn && h('div', { className: 'hs-files-side' },
          h('div', { className: 'hs-files-filter' },
            h('span', { className: 'hs-files-filter-icon' }, h(Icon, { d: ICON_SEARCH })),
            h('input', { value: filter, placeholder: 'Filter, or ? to search in files', 'aria-label': 'Filter files', spellCheck: false,
              onChange: e => setFilter(e.target.value), onKeyDown: e => { if (e.key === 'Escape') setFilter('') } })),
          h('div', { className: 'hs-files-list', role: 'tree' }, side)),
        h('div', { className: 'hs-files-main' },
          tabs.length === 0
            ? h('div', { className: 'hs-files-empty' },
              h(Icon, { d: ICON_FOLDER }),
              h('strong', null, 'Open files appear here'),
              h('div', null, treeOn ? 'Pick a file in the tree, or type ? and a word to search inside files.' : 'Show the file tree with the button at the top left of this pane.'))
            : h(React.Fragment, null,
              h('div', { className: 'hs-files-tabs', role: 'tablist' }, tabs.map(tab => h('div', {
                key: tab.path, role: 'tab', 'aria-selected': tab.path === active, className: 'hs-files-tab' + (tab.path === active ? ' hs-active' : ''), title: relativeTo(cwd, tab.path),
                onClick: () => setActive(tab.path), onAuxClick: e => { if (e.button === 1) close(tab.path) },
              }, h(FilesIcon, { path: tab.path }), baseName(tab.path),
                h('button', { type: 'button', 'aria-label': 'Close ' + baseName(tab.path), onClick: e => { e.stopPropagation(); close(tab.path) } }, h(Icon, { d: 'M4.5 4.5l7 7M11.5 4.5l-7 7' }))))),
              current ? h('div', { className: 'hs-files-path' },
                h('span', null, relativeTo(cwd, current.path)),
                h('button', { type: 'button', className: 'hs-icon-button', title: 'Copy path', 'aria-label': 'Copy path', style: { marginLeft: 'auto', width: 22, height: 22 },
                  onClick: () => navigator.clipboard.writeText(relativeTo(cwd, current.path)).catch(() => {}) }, h(Icon, { d: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7' }))) : null,
              current ? h(FileView, { key: current.path, read, path: current.path, line: current.line }) : null)))
    }

    // ---- git data from the Host's local helper (git-helper.js) ------------------------------------
    // Fetching it directly keeps refreshes out of the conversation, which logs every slash command.
    // The helper answers only requests carrying its per-launch secret. This window asks its own Host
    // for the port and secret over Harness's authenticated channel (the `harnessStudioDevPreview/
    // helper` Remote method, see index.js), which writes nothing to the Session log, then checks that
    // the port proves the secret before sending it. So a process squatting on a helper port, or a
    // second Harness's helper, is never used.
    const HELPER_SERVICE = 'harness-studio-git'
    const HELPER_ENDPOINT = 'harnessStudioDevPreview/helper'
    const HELPER_KEY_HEADER = 'x-hs-helper-key'
    /** A failed link is retried no sooner than this. */
    const RELINK_MIN_MS = 3000
    /** This window's connection to its Host (set when the plugin applies). */
    let connection
    /** Promise of { base, key } for the linked helper, or undefined before linking. */
    let helperLink
    let lastLinkAt = 0

    const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    const fromHex = text => new Uint8Array(text.match(/../g).map(pair => parseInt(pair, 16)))

    async function hmacHex(keyBytes, message) {
      const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))))
    }

    /** Ask this window's Host for its helper, and check the helper before trusting it. */
    async function linkHelper() {
      lastLinkAt = Date.now()
      let result
      try { result = await connection.rpc.call('/api', HELPER_ENDPOINT, { args: {} }) } catch { return undefined }
      const value = result && result.ok ? result.value : undefined
      if (!value || value.service !== HELPER_SERVICE || !Number.isInteger(value.port) || !/^[0-9a-f]{64}$/.test(value.key || '')) return undefined
      const keyBytes = fromHex(value.key)
      const base = 'http://127.0.0.1:' + value.port
      const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)))
      try {
        const response = await fetch(base + '/hello?nonce=' + nonce, { cache: 'no-store' })
        const hello = response.ok ? await response.json() : undefined
        if (!hello || hello.service !== HELPER_SERVICE || hello.proof !== await hmacHex(keyBytes, 'hello:' + value.port + ':' + nonce)) return undefined
      } catch { return undefined }
      return { base, key: value.key }
    }

    /** The linked helper, linking first when needed; undefined when it is not reachable (yet). */
    function currentHelper() {
      if (helperLink !== undefined) return helperLink
      if (!connection?.rpc || Date.now() - lastLinkAt < RELINK_MIN_MS) return Promise.resolve(undefined)
      const link = linkHelper().then(result => { if (result === undefined && helperLink === link) helperLink = undefined; return result })
      helperLink = link
      return link
    }

    /** Drop a link that stopped working (the Host restarted, or its port stopped answering). */
    function forgetHelper(link) {
      if (link !== undefined && helperLink !== undefined) helperLink.then(current => { if (current === link) helperLink = undefined })
    }

    const helperHeaders = (link, extra) => ({ [HELPER_KEY_HEADER]: link.key, ...extra })

    /** GET a helper endpoint; resolves { ok, value } or { ok: false, message }. */
    async function gitGet(route, params, signal) {
      const link = await currentHelper()
      if (link === undefined) return { ok: false, message: 'The Dev Preview helper is not reachable. If you just updated the plugin, restart Harness.' }
      try {
        const response = await fetch(link.base + route + '?' + new URLSearchParams(params), { cache: 'no-store', signal, headers: helperHeaders(link) })
        if (response.status === 401 || response.status === 403) { forgetHelper(link); return { ok: false, message: 'Reconnecting to the Dev Preview helper…' } }
        const body = await response.json()
        return response.ok ? { ok: true, value: body } : { ok: false, message: (body && body.error) || ('HTTP ' + response.status) }
      } catch (error) {
        if (signal && signal.aborted) return { ok: false, message: 'cancelled' }
        forgetHelper(link) // the Host may have restarted
        return { ok: false, message: String(error && error.message || error) }
      }
    }

    const STATUS_POLL_MS = 4000

    /** Live working-tree status for a folder; refreshes while the window is visible. */
    function useGitStatus(cwd) {
      const [state, setState] = useState({ kind: 'loading' })
      const [tick, setTick] = useState(0)
      useEffect(() => {
        if (cwd === undefined) return undefined
        const controller = new AbortController()
        gitGet('/status', { cwd }, controller.signal).then(result => {
          if (controller.signal.aborted) return
          setState(result.ok ? { kind: 'ready', status: result.value } : { kind: 'failed', message: result.message })
        })
        return () => controller.abort()
      }, [cwd, tick])
      useEffect(() => {
        const refresh = () => { if (document.visibilityState === 'visible') setTick(t => t + 1) }
        const timer = setInterval(refresh, STATUS_POLL_MS)
        window.addEventListener('focus', refresh)
        return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
      }, [])
      return [state, () => setTick(t => t + 1)]
    }

    const gitStyles = {
      root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', fontSize: 13 },
      bar: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--dsw-alias-border-l2)', whiteSpace: 'nowrap' },
      list: { flex: 1, overflow: 'auto' },
      fileRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', cursor: 'pointer', background: 'var(--dsw-alias-bg-layer-1)', borderBottom: '1px solid var(--dsw-alias-border-l2)', whiteSpace: 'nowrap', position: 'sticky', top: 0 },
      dir: { color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 },
      plus: { color: 'var(--dsw-alias-state-success-primary)', fontVariantNumeric: 'tabular-nums' },
      minus: { color: 'var(--dsw-alias-state-error-primary)', fontVariantNumeric: 'tabular-nums' },
      code: { margin: 0, font: '12px/19px var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace)', overflowX: 'auto' },
      lineNo: { display: 'inline-block', width: 40, paddingRight: 8, textAlign: 'right', color: 'var(--dsw-alias-label-tertiary)', userSelect: 'none' },
      sign: { display: 'inline-block', width: 14, userSelect: 'none' },
      hunk: { color: 'var(--dsw-alias-label-tertiary)', background: 'var(--dsw-alias-bg-layer-1)', padding: '2px 0 2px 62px' },
      added: { background: 'var(--dsw-alias-file-diff-added-bg, rgba(34,197,94,.12))' },
      deleted: { background: 'var(--dsw-alias-file-diff-deleted-bg, rgba(242,90,90,.12))' },
      empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center' },
      muted: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12.5 },
      iconButton: { width: 26, height: 26, display: 'grid', placeItems: 'center', border: 'none', borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', padding: 0 },
    }
    const STATUS_LABEL = { modified: 'Modified', added: 'Added', deleted: 'Deleted', renamed: 'Renamed', untracked: 'New file' }
    const ICON_CHANGES = 'M3 2.5h10v11H3zM8 5v4M6 7h4M6 11h4'
    const ICON_DETAILS = 'M2.5 3.5h11v9h-11zM5 6.5h1M7.5 6.5h4M5 9.5h1M7.5 9.5h4'
    // Files whose diff is at most this many changed lines open expanded, like Claude's.
    const AUTO_EXPAND_LINES = 400
    const AUTO_EXPAND_FILES = 25

    // ---- syntax colours for diffs: a small per-language tokenizer -----------------------------
    const LANGS = {
      js: { ext: /\.(m|c)?(j|t)sx?$/, comment: '\\/\\/.*$|\\/\\*.*?\\*\\/', keywords: 'abstract|as|async|await|break|case|catch|class|const|continue|default|delete|do|else|enum|export|extends|false|finally|for|from|function|if|implements|import|in|instanceof|interface|let|new|null|of|private|protected|public|readonly|return|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while|yield' },
      py: { ext: /\.pyi?$/, comment: '#.*$', keywords: 'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|self|True|try|while|with|yield' },
      sh: { ext: /\.(sh|bash|zsh)$|(^|\/)\.?(bash|zsh)rc$/, comment: '#.*$', keywords: 'if|then|else|elif|fi|for|in|do|done|while|case|esac|function|return|export|local|echo|set' },
      yaml: { ext: /\.(ya?ml|toml|ini|cfg)$/, comment: '#.*$', keywords: 'true|false|null|yes|no', key: '^(\\s*-?\\s*)[\\w.@/"-]+(?=\\s*[:=])' },
      json: { ext: /\.(json|jsonc)$/, comment: '\\/\\/.*$', keywords: 'true|false|null', key: '"(?:\\\\.|[^"\\\\])*"(?=\\s*:)' },
      css: { ext: /\.(s?css|less)$/, comment: '\\/\\*.*?\\*\\/', keywords: 'important|inherit|initial|none|auto', key: '[\\w-]+(?=\\s*:[^:])' },
      html: { ext: /\.(html?|xml|svg|vue|svelte)$/, comment: '<!--.*?-->', keywords: '', tag: '<\\/?[\\w:-]+|\\/?>' },
      c: { ext: /\.(c|h|cc|cpp|hpp|go|rs|java|kt|swift|cs|rb|php)$/, comment: '\\/\\/.*$|\\/\\*.*?\\*\\/|#.*$', keywords: 'break|case|class|const|continue|def|default|else|end|enum|false|fn|for|func|if|impl|import|let|match|mut|nil|null|package|pub|return|self|static|struct|switch|true|type|use|var|void|while' },
    }
    const languageOf = path => Object.keys(LANGS).find(name => LANGS[name].ext.test(path))
    const tokenizers = {}
    function tokenizer(lang) {
      if (tokenizers[lang]) return tokenizers[lang]
      const spec = LANGS[lang]
      const parts = []
      if (spec.comment) parts.push('(?<comment>' + spec.comment + ')')
      if (spec.key) parts.push('(?<key>' + spec.key + ')')
      parts.push('(?<string>"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)')
      if (spec.tag) parts.push('(?<tag>' + spec.tag + ')', '(?<attr>\\s[\\w:@.-]+(?==))')
      parts.push('(?<number>\\b\\d[\\d_.xXa-fA-F]*\\b)')
      if (spec.keywords) parts.push('(?<keyword>\\b(?:' + spec.keywords + ')\\b)')
      tokenizers[lang] = new RegExp(parts.join('|'), 'gm')
      return tokenizers[lang]
    }

    /** Split one line of code into [className, text] pieces. */
    function highlight(line, lang) {
      if (!lang || line.length > 2000) return [[null, line]]
      const re = tokenizer(lang)
      const out = []
      let last = 0
      re.lastIndex = 0
      let m
      while ((m = re.exec(line)) !== null) {
        if (m[0] === '') { re.lastIndex++; continue }
        const kind = Object.keys(m.groups).find(k => m.groups[k] !== undefined)
        let start = m.index
        let text = m[0]
        // A YAML key match carries its leading indent and "- "; keep that plain.
        if (kind === 'key') { const lead = /^\s*-?\s*/.exec(text)[0]; start += lead.length; text = text.slice(lead.length) }
        if (start > last) out.push([null, line.slice(last, start)])
        out.push(['hs-tok-' + kind, text])
        last = start + text.length
      }
      if (last < line.length) out.push([null, line.slice(last)])
      return out
    }

    // ---- file-type icons: a page glyph tinted by language, like Claude's ------------------------
    const FILE_TINT = { js: '#d4a017', py: '#3572a5', sh: '#4e9a06', yaml: '#cb4b16', json: '#c9822b', css: '#7c4dff', html: '#e34c26', c: '#5a6acf' }
    function FileGlyph({ path }) {
      const lang = languageOf(path)
      const tint = lang ? FILE_TINT[lang] : 'var(--dsw-alias-label-tertiary)'
      if (lang === 'json') return h('span', { className: 'hs-file-icon', style: { color: tint, fontWeight: 600, fontSize: 11, letterSpacing: '-0.5px' } }, '{ }')
      return h('span', { className: 'hs-file-icon', style: { color: tint } },
        h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round', 'aria-hidden': true },
          h('path', { d: 'M4 1.75h5.25L12.5 5v9.25H4z' }), h('path', { d: 'M9 1.75V5.25h3.5' }),
          lang === 'yaml' || lang === 'html' ? h('path', { d: 'M6 8.5h4.5M6 11h3' }) : h('path', { d: 'M6.5 9l-1 1.25 1 1.25M9.5 9l1 1.25-1 1.25' })))
    }

    const CHANGES_CSS = `
      .hs-changes { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; }
      .hs-changes-bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 14px; border-bottom: 1px solid var(--dsw-alias-border-l2); white-space: nowrap; }
      .hs-changes-bar .hs-dim { color: var(--dsw-alias-label-tertiary); }
      .hs-changes-list { flex: 1; overflow: auto; }
      .hs-file-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 7px; height: 32px; padding: 0 12px 0 8px; cursor: pointer; white-space: nowrap;
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--dsw-alias-bg-base)); border-bottom: 1px solid var(--dsw-alias-border-l2); }
      .hs-file-head:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, var(--dsw-alias-bg-base)); }
      .hs-chevron { display: grid; color: var(--dsw-alias-label-tertiary); width: 16px; flex: none; }
      .hs-file-icon { display: inline-grid; place-items: center; width: 16px; flex: none; }
      .hs-file-name { font-weight: 500; flex: none; max-width: 55%; overflow: hidden; text-overflow: ellipsis; }
      .hs-file-dir { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-tertiary); direction: rtl; text-align: left; }
      .hs-file-dir > bdi { direction: ltr; }
      .hs-file-tag { font-size: 11px; color: var(--dsw-alias-label-tertiary); border: 1px solid var(--dsw-alias-border-l2); border-radius: 5px; padding: 0 5px; line-height: 16px; flex: none; }
      .hs-plus { color: var(--dsw-alias-state-success-primary); font-variant-numeric: tabular-nums; flex: none; }
      .hs-minus { color: var(--dsw-alias-state-error-primary); font-variant-numeric: tabular-nums; flex: none; }
      .hs-diff { font: 12.5px/20px var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace); padding: 2px 0 6px; }
      .hs-row { display: grid; grid-template-columns: 46px 16px minmax(0, 1fr); }
      .hs-row .hs-ln { text-align: right; padding-right: 8px; color: var(--dsw-alias-label-tertiary); user-select: none; font-variant-numeric: tabular-nums; }
      .hs-row .hs-mark { user-select: none; color: var(--dsw-alias-label-tertiary); }
      .hs-row .hs-code { white-space: pre-wrap; overflow-wrap: anywhere; padding-right: 12px; }
      .hs-row.hs-add { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 11%, transparent); box-shadow: inset 3px 0 0 var(--dsw-alias-state-success-primary); }
      .hs-row.hs-add .hs-mark { color: var(--dsw-alias-state-success-primary); }
      .hs-row.hs-del { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); box-shadow: inset 3px 0 0 var(--dsw-alias-state-error-primary); }
      .hs-row.hs-del .hs-mark { color: var(--dsw-alias-state-error-primary); }
      .hs-gap { display: flex; align-items: center; gap: 8px; padding: 3px 12px 3px 62px; color: var(--dsw-alias-label-tertiary); font-size: 11.5px;
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, transparent); }
      .hs-note { padding: 8px 14px 8px 62px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
      .hs-tok-comment { color: #8b8f98; font-style: italic; }
      .hs-tok-string { color: #1a7f37; }
      .hs-tok-key { color: #b4532a; }
      .hs-tok-keyword { color: #8250df; }
      .hs-tok-number { color: #0a58ca; }
      .hs-tok-tag { color: #b4532a; }
      .hs-tok-attr { color: #8250df; }
      body[data-ds-dark-theme] .hs-tok-string { color: #7ee2a8; }
      body[data-ds-dark-theme] .hs-tok-key, body[data-ds-dark-theme] .hs-tok-tag { color: #f0a070; }
      body[data-ds-dark-theme] .hs-tok-keyword, body[data-ds-dark-theme] .hs-tok-attr { color: #c4a7ff; }
      body[data-ds-dark-theme] .hs-tok-number { color: #8ab4ff; }
      .hs-icon-button { width: 26px; height: 26px; display: grid; place-items: center; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 0; }
      .hs-icon-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
      [data-studio-menu-button]:focus:not(:focus-visible), [data-testid="harness-studio-pane-toolbar"] button:focus:not(:focus-visible), .hs-icon-button:focus:not(:focus-visible), [data-testid="studio-browser-bar"] button:focus:not(:focus-visible) { outline: none; box-shadow: none; }
      .hs-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; text-align: center; }
    `
    function useChangesStyles() {
      useEffect(() => {
        if (document.getElementById('hs-changes-css')) return undefined
        const style = document.createElement('style')
        style.id = 'hs-changes-css'
        style.textContent = CHANGES_CSS
        document.head.append(style)
        return undefined // shared by every Changes pane; left in place for the window's lifetime
      }, [])
    }

    /** Unified diff → rows: one line-number column (new side; old side for removals), hunk gaps. */
    function diffRows(text) {
      const rows = []
      let oldNo = 0
      let newNo = 0
      let hunks = 0
      for (const line of text.split('\n')) {
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@\s?(.*)$/.exec(line)
        if (hunk) {
          oldNo = Number(hunk[1]); newNo = Number(hunk[2])
          if (hunks > 0 || hunk[3]) rows.push({ kind: 'gap', context: hunk[3] })
          hunks++
          continue
        }
        if (hunks === 0 || line.startsWith('\\')) continue
        if (line.startsWith('+')) rows.push({ kind: 'add', no: newNo++, text: line.slice(1) })
        else if (line.startsWith('-')) rows.push({ kind: 'del', no: oldNo++, text: line.slice(1) })
        else if (line.startsWith(' ')) { rows.push({ kind: 'ctx', no: newNo++, text: line.slice(1) }); oldNo++ }
      }
      return rows
    }

    function DiffView({ text, path }) {
      const lang = languageOf(path)
      const rows = diffRows(text)
      if (rows.length === 0) return h('div', { className: 'hs-note' }, 'No text changes (binary file or mode change)')
      return h('div', { className: 'hs-diff' }, rows.map((row, i) => row.kind === 'gap'
        ? h('div', { key: i, className: 'hs-gap' }, h(Icon, { d: 'M4 8h.01M8 8h.01M12 8h.01' }), row.context || 'unchanged lines')
        : h('div', { key: i, className: 'hs-row' + (row.kind === 'add' ? ' hs-add' : row.kind === 'del' ? ' hs-del' : '') },
          h('span', { className: 'hs-ln' }, row.no),
          h('span', { className: 'hs-mark' }, row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''),
          h('span', { className: 'hs-code' }, highlight(row.text, lang).map(([cls, t], j) => cls ? h('span', { key: j, className: cls }, t) : t)))))
    }

    function ChangedFile({ cwd, file, open, onToggle }) {
      const [diff, setDiff] = useState(undefined)
      const revision = file.status + ':' + file.added + ':' + file.deleted
      useEffect(() => {
        if (!open) return undefined
        const controller = new AbortController()
        gitGet('/diff', { cwd, path: file.path }, controller.signal).then(result => {
          if (!controller.signal.aborted) setDiff(result.ok ? result.value : { error: result.message })
        })
        return () => controller.abort()
      }, [open, cwd, file.path, revision])
      const slash = file.path.lastIndexOf('/')
      return h('div', null,
        h('div', { className: 'hs-file-head', onClick: onToggle, title: file.path, role: 'button', 'aria-expanded': open },
          h('span', { className: 'hs-chevron' }, h(Icon, { d: open ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4' })),
          h(FileGlyph, { path: file.path }),
          h('span', { className: 'hs-file-name' }, slash === -1 ? file.path : file.path.slice(slash + 1)),
          h('span', { className: 'hs-file-dir' }, h('bdi', null, slash === -1 ? '' : file.path.slice(0, slash))),
          file.status === 'untracked' || file.status === 'added' || file.status === 'deleted' || file.status === 'renamed'
            ? h('span', { className: 'hs-file-tag' }, STATUS_LABEL[file.status]) : null,
          file.added == null ? h('span', { className: 'hs-file-tag' }, 'binary') : h('span', { className: 'hs-plus' }, '+' + file.added),
          file.deleted == null ? null : h('span', { className: 'hs-minus' }, '−' + file.deleted)),
        open ? (diff === undefined ? h('div', { className: 'hs-note' }, 'Loading…')
          : diff.error ? h('div', { className: 'hs-note' }, diff.error)
          : h(React.Fragment, null, h(DiffView, { text: diff.diff, path: file.path }), diff.truncated ? h('div', { className: 'hs-note' }, 'Diff truncated') : null)) : null)
    }

    const smallDiff = file => file.added != null && (file.added + (file.deleted || 0)) <= AUTO_EXPAND_LINES

    function ChangesPane({ sessionId, useSessions }) {
      useChangesStyles()
      const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
      const [state, refresh] = useGitStatus(cwd)
      // Per-file open state the user chose; files without a choice follow the auto-expand rule.
      const [choice, setChoice] = useState({})
      const status = state.kind === 'ready' ? state.status : undefined
      const files = status && status.repo ? status.files : []
      const isOpen = (file, index) => choice[file.path] ?? (index < AUTO_EXPAND_FILES && smallDiff(file))
      const allOpen = files.length > 0 && files.every(isOpen)
      const setAll = open => setChoice(Object.fromEntries(files.map(f => [f.path, open])))
      let body
      if (cwd === undefined) body = h('div', { className: 'hs-empty' }, h('div', { className: 'hs-dim' }, 'This session has no folder'))
      else if (state.kind === 'loading') body = h('div', { className: 'hs-empty' }, h('div', { style: gitStyles.muted }, 'Loading…'))
      else if (state.kind === 'failed') body = h('div', { className: 'hs-empty' }, h('div', { style: gitStyles.muted }, state.message))
      else if (!status.repo) body = h('div', { className: 'hs-empty' }, h(Icon, { d: ICON_CHANGES }), h('div', { style: { fontWeight: 500 } }, 'Not a git repository'), h('div', { style: gitStyles.muted }, cwd))
      else if (files.length === 0) body = h('div', { className: 'hs-empty' }, h(Icon, { d: ICON_CHANGES }), h('div', { style: { fontWeight: 500 } }, 'No changes'), h('div', { style: gitStyles.muted }, 'The working tree matches ' + status.branch + '.'))
      else body = h('div', { className: 'hs-changes-list' },
        files.map((file, i) => h(ChangedFile, { key: file.path, cwd, file, open: isOpen(file, i), onToggle: () => setChoice(c => ({ ...c, [file.path]: !isOpen(file, i) })) })),
        status.truncated ? h('div', { className: 'hs-note' }, 'Showing ' + files.length + ' of ' + status.fileCount + ' files') : null)
      return h('div', { className: 'hs-changes', 'data-testid': 'studio-changes' },
        h('div', { className: 'hs-changes-bar' },
          h('span', { style: { fontWeight: 500 } }, status && status.repo ? status.branch : '—'),
          h('span', { className: 'hs-dim' }, '→'),
          h('span', null, 'working tree'),
          status && status.repo && status.fileCount ? h('span', { className: 'hs-dim', style: { marginLeft: 4 } }, status.fileCount + (status.fileCount === 1 ? ' file' : ' files')) : null,
          status && status.repo ? h('span', { className: 'hs-plus' }, '+' + status.totals.added) : null,
          status && status.repo ? h('span', { className: 'hs-minus' }, '−' + status.totals.deleted) : null,
          h('div', { style: { flex: 1 } }),
          files.length ? h('button', { type: 'button', className: 'hs-icon-button', title: allOpen ? 'Collapse all' : 'Expand all', 'aria-label': allOpen ? 'Collapse all' : 'Expand all', onClick: () => setAll(!allOpen) },
            h(Icon, { d: allOpen ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4' })) : null,
          h('button', { type: 'button', className: 'hs-icon-button', title: 'Refresh', 'aria-label': 'Refresh', onClick: refresh }, h(Icon, { d: 'M13 8a5 5 0 1 1-1.46-3.54M13 3v2.5h-2.5' }))),
        body)
    }

    // ---- session details: the Claude-style "session rail" ------------------------------------------
    const detailStyles = {
      root: { height: '100%', overflow: 'auto', padding: 12, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', fontSize: 13 },
      card: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 },
      title: { fontWeight: 500 },
      row: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
      icon: { color: 'var(--dsw-alias-label-tertiary)', display: 'grid', flexShrink: 0 },
      dim: { color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
      link: { marginLeft: 'auto', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 7, background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 12, padding: '3px 9px', cursor: 'pointer' },
    }
    const ICON_COMPUTER = 'M2.5 3h11v7.5h-11zM6 13.5h4M8 10.5v3'
    const ICON_BRANCH = 'M5 3v10M5 13a1.5 1.5 0 1 0 0-.01M11 3a1.5 1.5 0 1 0 0 .01M11 4.5c0 3-6 3-6 6'

    /**
     * The usage readings Harness shows under the message box (turns and steps, speed, tokens, cache hit,
     * context used), mirrored for the Session pane. They are read from the readings' own accessible
     * labels, so the pane always matches what Harness shows there, and the originals stay where they are.
     */
    function readComposerStats() {
      const slot = [...document.querySelectorAll('[data-slot="conversation.composer.dock"]')].find(d => d.closest('[class*="_centerCol"]') && d.parentElement && d.parentElement.getBoundingClientRect().width > 0)
      const dock = slot && slot.parentElement
      if (!dock) return { dock: null, rows: [] }
      const labels = [...new Set([...dock.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label').trim()).filter(Boolean))]
      const rows = []
      for (const label of labels) {
        for (const part of label.split(/\s+·\s+/)) {
          let m
          if ((m = /^(\d[\d,.]*)\s+turns?\s+(\d[\d,.]*)\s+steps?$/i.exec(part))) { rows.push(['Turns', m[1]], ['Steps', m[2]]) }
          else if ((m = /^([\d,.]+\s*tok\/s)$/i.exec(part))) rows.push(['Speed', m[1]])
          else if ((m = /^([\d,.]+[KMB]?)\s*tok$/i.exec(part))) rows.push(['Tokens', m[1]])
          else if ((m = /^Cache hit\s+([\d.]+%)$/i.exec(part))) rows.push(['Cache hit', m[1]])
          else if ((m = /^([\d.]+%)\s+of context used$/i.exec(part))) rows.push(['Context used', m[1]])
          else rows.push(['', part]) // a reading this pane doesn't know yet: shown as Harness words it
        }
      }
      return { dock, rows }
    }

    function useComposerStats() {
      const [rows, setRows] = useState(() => readComposerStats().rows)
      useEffect(() => {
        let observed = null
        const observer = new MutationObserver(() => update())
        const update = () => {
          const { dock, rows: next } = readComposerStats()
          setRows(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next)
          if (dock !== observed) {
            observer.disconnect()
            observed = dock
            if (dock) observer.observe(dock, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label'] })
          }
        }
        update()
        const timer = setInterval(update, 2000) // the message box can be replaced when switching sessions
        return () => { clearInterval(timer); observer.disconnect() }
      }, [])
      return rows
    }

    function DetailsPane({ sessionId, useSessions, sidebar }) {
      const usage = useComposerStats()
      const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
      const [state] = useGitStatus(cwd)
      const status = state.kind === 'ready' ? state.status : undefined
      // Windows paths use backslashes; the home folder shows as ~ on macOS, Linux and Windows.
      const folder = cwd ? cwd.split(/[\\/]/).pop() : ''
      const parent = cwd ? cwd.slice(0, Math.max(0, cwd.length - folder.length - 1)) : ''
      return h('div', { style: detailStyles.root, 'data-testid': 'studio-details' },
        h('div', { style: detailStyles.card },
          h('div', { style: detailStyles.title }, 'Environment'),
          h('div', { style: detailStyles.row }, h('span', { style: detailStyles.icon }, h(Icon, { d: ICON_COMPUTER })), 'This computer'),
          h('div', { style: detailStyles.row, title: cwd }, h('span', { style: detailStyles.icon }, h(Icon, { d: ICON_FOLDER })),
            h('span', { style: { flexShrink: 0 } }, folder || 'No folder'), parent ? h('span', { style: detailStyles.dim }, '· ' + parent.replace(/^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/, '~')) : null),
          status && status.repo ? h('div', { style: detailStyles.row }, h('span', { style: detailStyles.icon }, h(Icon, { d: ICON_BRANCH })), status.branch) : null),
        h('div', { style: detailStyles.card },
          h('div', { style: detailStyles.title }, 'Changes'),
          h('div', { style: detailStyles.row },
            h('span', { style: detailStyles.icon }, h(Icon, { d: ICON_CHANGES })),
            state.kind === 'failed' ? h('span', { style: detailStyles.dim }, state.message)
              : !status ? h('span', { style: detailStyles.dim }, 'Loading…')
              : !status.repo ? h('span', { style: detailStyles.dim }, 'Not a git repository')
              : h(React.Fragment, null,
                h('span', { style: gitStyles.plus }, '+' + status.totals.added),
                h('span', { style: gitStyles.minus }, '−' + status.totals.deleted),
                h('span', { style: detailStyles.dim }, status.fileCount + (status.fileCount === 1 ? ' file' : ' files'))),
            status && status.repo ? h('button', { type: 'button', style: detailStyles.link, onClick: () => sidebar.openTab(CHANGES_KIND) }, 'Review') : null)),
        usage.length ? h('div', { style: detailStyles.card, 'data-testid': 'studio-usage' },
          h('div', { style: detailStyles.title }, 'Usage'),
          // Two readings per row, each value right beside its label.
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 16, rowGap: 6 } },
            usage.map(([label, value], i) => h('div', { key: i, style: { display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 } },
              label ? h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' } }, label + ':') : null,
              h('span', { style: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, value))))) : null)
    }

    const CHANGES_TAB_ID = '@harness-studio/changes'
    const CHANGES_KIND = 'studio-changes'
    const DETAILS_TAB_ID = '@harness-studio/details'
    const DETAILS_KIND = 'studio-details'

    // ---- one watcher for the right sidebar's DOM ----------------------------------------------------
    // Several features follow the sidebar's tabs, panes and page frames. A single observer on the page
    // feeds them all, and it only reacts to records that touch the dock: a streaming reply, a running
    // terminal or a re-rendering diff adds nodes all the time and must not cause any work here beyond
    // the check itself. Listeners run at most every DOCK_THROTTLE_MS, on a timer because animation
    // frames pause in background windows and the agent's browser tools still need the marks there.
    const DOCK_CONTAINERS = '[class*="_tabLayout_"], [class*="_tabCell_"]'
    const DOCK_PARTS = DOCK_CONTAINERS + ', [data-dockkit-tab], [class*="_stripChrome_"], [class*="_viewport"], webview, iframe'
    const DOCK_THROTTLE_MS = 100
    const dockListeners = new Set()
    let dockObserver
    let dockTimer
    let dockLastRun = 0

    function touchesDock(records) {
      for (const record of records) {
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement
        if (!target) continue
        if (record.type === 'attributes') { if (target.closest('[class*="_tabCell_"]')) return true; continue }
        if (target.closest('[class*="_tabStrip_"]')) return true
        const inDock = target.closest('[class*="_tabCell_"]') !== null
        for (const nodes of [record.addedNodes, record.removedNodes]) {
          for (const node of nodes) {
            if (node.nodeType !== 1) continue
            const parts = inDock ? DOCK_PARTS : DOCK_CONTAINERS
            if (node.matches(parts) || node.querySelector(parts)) return true
          }
        }
      }
      return false
    }

    /** Run every dock listener soon: right away after a quiet spell, otherwise throttled. */
    function notifyDock() {
      if (dockTimer !== undefined) return
      dockTimer = setTimeout(() => {
        dockTimer = undefined
        dockLastRun = Date.now()
        for (const listener of [...dockListeners]) {
          try { listener() } catch (error) { console.warn('[harness-studio] sidebar watcher failed:', error) }
        }
      }, Math.max(0, dockLastRun + DOCK_THROTTLE_MS - Date.now()))
    }

    /** Call `listener` now and whenever the dock's DOM changes; returns the unsubscribe function. */
    function watchDock(listener) {
      dockListeners.add(listener)
      if (dockObserver === undefined) {
        dockObserver = new MutationObserver(records => { if (touchesDock(records)) notifyDock() })
        dockObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected'] })
      }
      notifyDock()
      return () => {
        dockListeners.delete(listener)
        if (dockListeners.size > 0 || dockObserver === undefined) return
        dockObserver.disconnect()
        dockObserver = undefined
        clearTimeout(dockTimer)
        dockTimer = undefined
      }
    }

    // ---- browser tabs: the one pane that keeps a tab strip, like Claude's browser ---------------
    // The theme hides pane tab strips (the header icons switch panes); browser tabs stay visible when
    // the browser is showing. Tabs only carry a dock id in the page, so mark each with its kind, and
    // make the strip's + open a new browser tab instead of the start page.
    function markTabKinds(sidebar) {
      const kinds = new Map(sidebar.openTabs.getSnapshot().map(tab => [String(tab.tabId), tab.kind]))
      for (const element of document.querySelectorAll('[data-dockkit-tab]')) {
        const kind = kinds.get(element.getAttribute('data-dockkit-tab'))
        if (kind !== undefined && element.getAttribute('data-studio-kind') !== kind) element.setAttribute('data-studio-kind', kind)
      }
    }

    function watchBrowserTabs(sidebar) {
      // Tab changes in the store reach every dock listener (the marks, the close buttons, the panes).
      const unsubscribe = sidebar.openTabs.subscribe(notifyDock)
      const unwatch = watchDock(() => markTabKinds(sidebar))
      const onClick = (event) => {
        const add = event.target instanceof Element ? event.target.closest('[aria-label="New tab"]') : null
        if (add === null || !add.closest('[class*="_tabStrip_"]')?.querySelector('[aria-selected="true"][data-studio-kind="browser"]')) return
        event.preventDefault()
        event.stopPropagation()
        // No address: a blank tab, without the "Enter an address" warning an empty one raises.
        sidebar.openTab('browser', { params: {}, revealIfOpened: false })
      }
      document.addEventListener('click', onClick, true)
      return () => { unsubscribe(); unwatch(); document.removeEventListener('click', onClick, true) }
    }

    // ---- no pane splitting: the right sidebar shows one pane at a time --------------------------
    // The split button is hidden by the theme; this blocks Harness's split shortcut (⌘\ / Ctrl+\),
    // which Harness's shortcut layer skips once another handler has claimed the key press.
    // The split button too, here rather than only in the theme, so it stays hidden without it.
    const NO_SPLIT_CSS = '[class*="_tabCell_"] [aria-label="Split"], [class*="_tabCell_"] span:has(> [aria-label="Split"]) { display: none !important; }' +
      // Panes open only through the header icons: Harness's own sidebar toggle would open an empty
      // sidebar onto its start page. (The pane's own collapse control stays clickable from code.)
      ' [aria-label="Open right sidebar"], [aria-label="Collapse right sidebar"] { display: none !important; }'
    function hideSplitButton() {
      const style = document.createElement('style')
      style.id = 'harness-studio-no-split'
      style.textContent = NO_SPLIT_CSS
      document.head.append(style)
      return () => style.remove()
    }

    function blockSplitShortcut(event) {
      const primary = /Mac|iPhone|iPad/.test(navigator.platform) ? event.metaKey : event.ctrlKey
      if (!primary) return
      const split = event.code === 'Backslash' && !event.altKey && !event.shiftKey
      // Harness's right-sidebar toggle: ⌥⌘B in the desktop app, ⇧⌘B on the web.
      const toggle = event.code === 'KeyB' && (event.altKey || event.shiftKey)
      if (!split && !toggle) return
      event.preventDefault()
      event.stopPropagation()
    }

    // ---- plugin settings forms: Enter saves -------------------------------------------------------
    // Harness's plugin settings forms (Web search, Subagent, Shell, …) are not HTML forms, so Enter in
    // a field does nothing and only the Save button writes. Enter in a single-line field now presses
    // that form's Save button when it is enabled (something changed and the values are valid).
    const cls = name => `:is([class$="_${name}"], [class*="_${name} "], [class*="_${name}_"])`
    function enterSavesSettings(event) {
      if (event.key !== 'Enter' || event.isComposing || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return
      const field = event.target
      if (!(field instanceof HTMLInputElement) || !/^(text|password|number|url|email|search)$/.test(field.type)) return
      const form = field.closest(cls('form'))
      const save = form && form.querySelector(`${cls('footer')} ${cls('save')}`)
      if (!save || save.disabled) return
      event.preventDefault()
      save.click()
    }

    // Harness shows a message only when a save fails. After a click on Save (or Enter, which clicks it),
    // wait for the save to settle — the button back to "Save" and disabled because nothing is left to
    // save — and, unless the form reports a failure, show "Saved ✓" just after the button, then go back
    // one page. A failed save stays on the form with Harness's message.
    const CRUMB = `${cls('detailTop')} ${cls('crumb')}`

    /**
     * Follow the Plugins page's "Back to …" breadcrumb once, and only while the user is still on the
     * settings page that was saved: same address, same breadcrumb, same Save button on screen.
     */
    function backFromSavedSettings(save, page) {
      if (!save.isConnected || location.href !== page.href) return
      const crumb = document.querySelector(CRUMB)
      if (crumb && crumb === page.crumb) crumb.click()
    }

    function confirmSettingsSaves(event) {
      const save = event.target instanceof Element ? event.target.closest(`${cls('footer')} ${cls('save')}`) : null
      if (!save || save.disabled) return
      const footer = save.parentElement
      // The page being saved; no breadcrumb means it is not a Plugins settings page, so no navigation.
      const page = { href: location.href, crumb: document.querySelector(CRUMB) }
      const started = Date.now()
      const check = () => {
        if (!save.isConnected) return
        if (footer.querySelector(cls('failed'))) return
        const settled = save.disabled && !/…|\.\.\./.test(save.textContent)
        if (!settled) { if (Date.now() - started < 15000) setTimeout(check, 120); return }
        footer.querySelector('[data-hs-saved]')?.remove()
        const note = document.createElement('span')
        note.setAttribute('data-hs-saved', '')
        note.setAttribute('role', 'status')
        note.textContent = 'Saved ✓'
        note.style.cssText = 'margin-left:10px;font-size:12px;line-height:18px;align-self:center;color:var(--dsw-alias-state-success-primary);transition:opacity 300ms'
        save.after(note)
        setTimeout(() => { note.style.opacity = '0' }, 2200)
        setTimeout(() => note.remove(), 2600)
        // On the Plugins page, go back once the confirmation has been seen.
        if (page.crumb) setTimeout(() => backFromSavedSettings(save, page), 700)
      }
      setTimeout(check, 120)
    }

    // ---- subagents switcher: open on click only, and a second click closes it --------------------
    // Harness opens the header's "N subagents" tree on hover and a click only pins it. Hover events
    // never reach it here, and clicking the open switcher closes it.
    const SWITCHER = 'button[aria-haspopup="tree"]'
    function clickOnlySwitcher() {
      const inSwitcher = node => node instanceof Element && node.closest(SWITCHER) !== null
      const blockHover = (event) => {
        if (inSwitcher(event.target) || inSwitcher(event.relatedTarget)) event.stopPropagation()
      }
      const toggle = (event) => {
        const trigger = event.target instanceof Element ? event.target.closest(SWITCHER) : null
        if (trigger === null || trigger.getAttribute('aria-expanded') !== 'true') return
        event.preventDefault()
        event.stopPropagation()
        // The switcher closes on a press outside it.
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      }
      const types = ['mouseover', 'mouseout', 'pointerover', 'pointerout', 'mouseenter', 'mouseleave']
      for (const type of types) window.addEventListener(type, blockHover, true)
      window.addEventListener('click', toggle, true)
      return () => {
        for (const type of types) window.removeEventListener(type, blockHover, true)
        window.removeEventListener('click', toggle, true)
      }
    }

    // ---- pane header controls: Claude's expand and × at the far right of each pane header ----------
    // Harness draws its header controls (Fullscreen, collapse) only in the right-most pane, which in a
    // top/bottom stack is the bottom one. Every docked pane gets a control group here: Harness's own
    // where it exists, otherwise one made to match, so the top pane also has expand, close and the
    // Browser pane menus. Kept topped up as Harness re-renders.
    const CLOSE_ATTR = 'data-studio-pane-close'
    const EXPAND_ATTR = 'data-studio-pane-expand'
    const CHROME_ATTR = 'data-studio-strip-chrome'
    const SOLO_ATTR = 'data-hs-solo'
    // The added group copies Harness's class names to look the same, so "Harness's own" must exclude it.
    const NATIVE_CHROME = '[class*="_stripChrome_"]:not([' + CHROME_ATTR + '])'
    const NATIVE_FULLSCREEN = '[data-sidebar-right-mode]'
    // Harness's own expand and restore glyphs, so the added button matches the one it draws.
    const GLYPH_FULLSCREEN = '<svg class="hs-enter" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.33203 10.4054V13.1681C2.33229 13.444 2.55605 13.6681 2.83203 13.6681H5.49512V14.6681H2.83203C2.00376 14.6681 1.33229 13.9963 1.33203 13.1681V10.4054H2.33203ZM14.6689 13.1681C14.6687 13.996 13.9968 14.6676 13.1689 14.6681H10.4951V13.6681H13.1689C13.4445 13.6676 13.6687 13.4437 13.6689 13.1681V10.4054H14.6689V13.1681ZM13.1689 1.33118C13.9969 1.33163 14.6688 2.00315 14.6689 2.83118V5.4054H13.6689V2.83118C13.6688 2.55544 13.4446 2.33162 13.1689 2.33118H10.4951V1.33118H13.1689ZM5.49512 2.33118H2.83203C2.55598 2.33118 2.33218 2.55516 2.33203 2.83118V5.4054H1.33203V2.83118C1.33218 2.00288 2.00369 1.33118 2.83203 1.33118H5.49512V2.33118Z" fill="currentColor"/></svg>'
    const GLYPH_EXIT_FULLSCREEN = '<svg class="hs-exit" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9 2.5V6C9 6.26522 9.10536 6.51957 9.29289 6.70711C9.48043 6.89464 9.73478 7 10 7H13.5" stroke="currentColor"/><path d="M7 13.5V10C7 9.73478 6.89464 9.48043 6.70711 9.29289C6.51957 9.10536 6.26522 9 6 9H2.5" stroke="currentColor"/></svg>'

    /** Whether the right sidebar holding `element` is in Harness's fullscreen mode. */
    const inFullscreen = element => element.closest('[data-sidebar-right-panel]')?.getAttribute('data-sidebar-right-panel') === 'fullscreen'

    /** A pane header's control group: Harness's own, or one added to match it (and dropped once Harness draws its own). */
    function stripChromeOf(strip) {
      const native = strip.querySelector(':scope > ' + NATIVE_CHROME)
      const added = strip.querySelector(':scope > [' + CHROME_ATTR + ']')
      if (native) { added?.remove(); return native }
      if (added) return added
      const chrome = document.createElement('div')
      chrome.setAttribute(CHROME_ATTR, '')
      const template = document.querySelector('[class*="_tabCell_"] ' + NATIVE_CHROME)
      if (template) chrome.className = template.className
      else chrome.style.cssText = 'display:flex;align-items:center;margin-left:auto'
      strip.append(chrome)
      return chrome
    }

    function ensurePaneControls() {
      const template = document.querySelector('[class*="_tabCell_"] ' + NATIVE_CHROME + ' button, [class*="_tabCell_"] [class*="_iconButton_"]')
      const makeButton = (attr, label, html) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.setAttribute(attr, '')
        button.setAttribute('aria-label', label)
        button.title = label
        if (template) button.className = template.className
        button.innerHTML = html
        return button
      }
      for (const strip of document.querySelectorAll('[class*="_tabCell_"] [class*="_tabStrip_"]')) {
        // A floating pane has Harness's own dock-back and close controls; expanding it means nothing.
        if (strip.closest('[data-dockkit-host="float"]')) {
          strip.querySelectorAll('[' + EXPAND_ATTR + '], [' + CLOSE_ATTR + ']').forEach(button => button.remove())
          continue
        }
        const chrome = stripChromeOf(strip)
        const added = chrome.querySelector('[' + EXPAND_ATTR + ']')
        if (chrome.querySelector(NATIVE_FULLSCREEN)) added?.remove()
        else if (!added) chrome.prepend(makeButton(EXPAND_ATTR, 'Fullscreen', GLYPH_FULLSCREEN + GLYPH_EXIT_FULLSCREEN))
        else {
          const label = inFullscreen(added) ? 'Exit fullscreen' : 'Fullscreen'
          if (added.getAttribute('aria-label') !== label) { added.setAttribute('aria-label', label); added.title = label }
        }
        if (!strip.querySelector('[' + CLOSE_ATTR + ']')) {
          chrome.append(makeButton(CLOSE_ATTR, 'Close pane', '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>'))
        }
      }
    }

    /**
     * Expanding a pane of a top/bottom stack fills the window with that pane alone, like Claude Code
     * desktop: the stack remembers which pane asked (STACK_CSS hides the other one while the sidebar is
     * fullscreen), and Harness's own Fullscreen button does the rest. An added expand button forwards to
     * Harness's, which lives in the other pane's header.
     */
    function watchPaneExpand() {
      let forwarding = false
      let soloSince = 0
      const onClick = (event) => {
        if (forwarding) return
        const button = event.target instanceof Element ? event.target.closest('[' + EXPAND_ATTR + '], ' + NATIVE_FULLSCREEN) : null
        if (button === null) return
        const grid = button.closest('[class*="_tabLayout_"]')
        const column = button.closest('[data-dockkit-column]')?.getAttribute('data-dockkit-column')
        if (grid && column != null && grid.querySelector(':scope > [data-dockkit-column="1"]')) {
          if (inFullscreen(button)) grid.removeAttribute(SOLO_ATTR)
          else { grid.setAttribute(SOLO_ATTR, column); soloSince = Date.now() }
        }
        if (!button.hasAttribute(EXPAND_ATTR)) return
        event.preventDefault()
        event.stopPropagation()
        const native = grid && grid.querySelector(NATIVE_FULLSCREEN)
        if (!native) return
        forwarding = true
        try { native.click() } finally { forwarding = false }
      }
      // Fullscreen can also end through Harness's shortcut; a stale choice must not hide a pane the
      // next time fullscreen starts that way.
      const clearStale = () => {
        if (Date.now() - soloSince < 1000) return
        for (const grid of document.querySelectorAll('[' + SOLO_ATTR + ']')) if (!inFullscreen(grid)) grid.removeAttribute(SOLO_ATTR)
      }
      document.addEventListener('click', onClick, true)
      const timer = setInterval(clearStale, 500)
      return () => {
        document.removeEventListener('click', onClick, true)
        clearInterval(timer)
        document.querySelectorAll('[' + SOLO_ATTR + ']').forEach(grid => grid.removeAttribute(SOLO_ATTR))
      }
    }

    // ---- the expand button's menu: Move, Fill and arrange, Open in new window --------------------------
    // Like Claude Code desktop (and the macOS green button), resting the pointer on a pane's expand
    // button opens a menu; clicking the button still expands. Move places the pane on a side of the
    // other one, Fill shows it alone in the sidebar, Arrange shows both again, and Open in new window
    // lifts it into a window of its own over the app (Harness's floating panel).
    const MENU_OPEN_DELAY_MS = 300
    const MENU_CLOSE_DELAY_MS = 250
    const frameGlyph = inner => '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor"/>' + inner + '</svg>'
    const block = (x, y, w, hgt, opacity = 1) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + hgt + '" rx="1" fill="currentColor" opacity="' + opacity + '"/>'
    const PANE_MENU_GLYPHS = {
      left: frameGlyph(block(3, 4, 4.5, 8)),
      right: frameGlyph(block(8.5, 4, 4.5, 8)),
      top: frameGlyph(block(3, 4, 10, 3.5)),
      bottom: frameGlyph(block(3, 8.5, 10, 3.5)),
      fill: frameGlyph(block(3, 4, 10, 8)),
      arrange: frameGlyph(block(3, 4, 4.5, 8, 0.45) + block(8.5, 4, 4.5, 8)),
      window: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="4.5" y="2.5" width="10" height="8" rx="1.5" stroke="currentColor"/><path d="M11.5 10.5v1.5a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 3 5.5h1.5" stroke="currentColor"/></svg>',
    }
    const MOVE_LABELS = { left: 'Move left', right: 'Move right', top: 'Move to top', bottom: 'Move to bottom' }
    const PLACE_LABELS = { left: 'Left of the conversation', right: 'Right of the conversation', top: 'Above the conversation', bottom: 'Below the conversation' }
    const cssText = style => Object.entries(style).map(([key, value]) => key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + ':' + (typeof value === 'number' && !/opacity|zIndex|fontWeight/i.test(key) ? value + 'px' : value)).join(';')

    function buildPaneMenu(sidebar, sessionId, grid, cell, close) {
      const column = cell.getAttribute('data-dockkit-column')
      const two = grid.querySelector(':scope > ' + COL1) !== null
      const arrangement = arrangementOf(sessionId)
      const first = (Number(column) ^ (arrangement.swap ? 1 : 0)) === 0
      // Two panes arrange against each other; one pane places the panel around the conversation.
      const at = two ? (arrangement.side ? (first ? 'left' : 'right') : (first ? 'top' : 'bottom')) : panelPlace.side
      const filled = two ? arrangement.fill === column : arrangement.fill === 'chat'
      const menu = document.createElement('div')
      menu.setAttribute('data-studio-menu', '')
      menu.setAttribute('role', 'menu')
      // Sizes follow Claude Code desktop's menu: 24px choices 6px apart under 11.5px labels, and a 28px row.
      menu.style.cssText = cssText({ ...extraStyles.menu, minWidth: 0, padding: '8px 10px 4px', borderRadius: 10 })
      const label = (text) => { const div = document.createElement('div'); div.textContent = text; div.style.cssText = cssText({ ...extraStyles.menuLabel, padding: '0 2px', margin: '0 0 4px', fontSize: 11.5, lineHeight: '16px' }); menu.append(div) }
      const row = (items) => {
        const div = document.createElement('div')
        div.style.cssText = 'display:flex;gap:6px;padding:0 0 8px'
        for (const { glyph, title, active, disabled, run } of items) {
          const button = document.createElement('button')
          button.type = 'button'
          button.setAttribute('role', 'menuitemradio')
          button.setAttribute('aria-checked', String(active))
          button.setAttribute('aria-label', title)
          button.title = title
          button.disabled = disabled
          button.innerHTML = glyph
          const rest = active ? 'color-mix(in srgb, var(--dsw-alias-button-info-fill) 18%, transparent)' : 'transparent'
          button.style.cssText = cssText({ width: 24, height: 24, display: 'grid', placeItems: 'center', padding: 0, border: 'none', borderRadius: 6, background: rest,
            color: active ? 'var(--dsw-alias-button-info-fill)' : 'var(--dsw-alias-label-secondary)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1 })
          if (!disabled) {
            button.onmouseenter = () => { if (!active) button.style.background = 'var(--dsw-alias-interactive-bg-hover)' }
            button.onmouseleave = () => { button.style.background = rest }
            button.onclick = () => { close(); run() }
          }
          div.append(button)
        }
        menu.append(div)
      }
      label('Move')
      row(['left', 'right', 'top', 'bottom'].map(dir => ({
        glyph: PANE_MENU_GLYPHS[dir], title: two ? MOVE_LABELS[dir] : PLACE_LABELS[dir], active: at === dir, disabled: false,
        run: () => two
          ? setArrangement(sessionId, {
            side: dir === 'left' || dir === 'right',
            swap: Number(column) !== (dir === 'left' || dir === 'top' ? 0 : 1),
            fill: undefined,
          })
          : (setArrangement(sessionId, { fill: undefined }), setPlace({ side: dir, size: undefined })),
      })))
      label('Fill and arrange')
      row([
        { glyph: PANE_MENU_GLYPHS.fill, title: two ? 'Fill the panel with this pane' : 'Fill the conversation\'s space with this pane', active: filled, disabled: false,
          run: () => setArrangement(sessionId, { fill: two ? column : 'chat' }) },
        { glyph: PANE_MENU_GLYPHS.arrange, title: two ? 'Show both panes' : 'Show the conversation too', active: !filled, disabled: false,
          run: () => setArrangement(sessionId, { fill: undefined }) },
      ])
      const sep = document.createElement('div')
      sep.style.cssText = cssText({ ...extraStyles.menuSep, margin: '0 0 2px' })
      menu.append(sep)
      const tabId = cell.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-dockkit-tab')
      const item = document.createElement('button')
      item.type = 'button'
      item.setAttribute('role', 'menuitem')
      item.innerHTML = PANE_MENU_GLYPHS.window + '<span>Open in new window</span>'
      item.style.cssText = cssText({ ...extraStyles.item, height: 28, padding: '0 6px', borderRadius: 6, fontSize: 13, whiteSpace: 'nowrap' })
      item.onmouseenter = () => { item.style.background = 'var(--dsw-alias-interactive-bg-hover)' }
      item.onmouseleave = () => { item.style.background = 'transparent' }
      item.onclick = () => {
        close()
        const s = surfaceOf(sidebar, sessionId)
        if (s && tabId) { try { s.actions.floatTab(sessionId, tabId) } catch (error) { console.warn('[harness-studio] could not open the pane in a window:', error) } }
      }
      menu.append(item)
      return menu
    }

    function watchPaneMenu(sidebar) {
      let menu = null
      let anchor = null
      let openTimer
      let closeTimer
      const close = () => {
        clearTimeout(openTimer)
        clearTimeout(closeTimer)
        menu?.remove()
        menu = null
        anchor = null
      }
      const scheduleClose = () => { clearTimeout(closeTimer); closeTimer = setTimeout(close, MENU_CLOSE_DELAY_MS) }
      const open = (button) => {
        close()
        const sessionId = sidebar.mounted && sidebar.mounted.getSnapshot()
        const grid = button.closest('[class*="_tabLayout_"]')
        const cell = button.closest('[data-dockkit-column]')
        if (!sessionId || !grid || !cell || !button.isConnected) return
        anchor = button
        menu = buildPaneMenu(sidebar, sessionId, grid, cell, close)
        const rect = button.getBoundingClientRect()
        menu.style.top = rect.bottom + 6 + 'px'
        menu.style.right = Math.max(8, window.innerWidth - rect.right) + 'px'
        menu.addEventListener('pointerenter', () => clearTimeout(closeTimer))
        menu.addEventListener('pointerleave', scheduleClose)
        document.body.append(menu)
      }
      const expandButton = target => target instanceof Element ? target.closest('[' + EXPAND_ATTR + '], ' + NATIVE_FULLSCREEN) : null
      const onOver = (event) => {
        const button = expandButton(event.target)
        if (button === null) return
        if (button === anchor) { clearTimeout(closeTimer); return }
        clearTimeout(openTimer)
        openTimer = setTimeout(() => open(button), MENU_OPEN_DELAY_MS)
      }
      const onOut = (event) => {
        const button = expandButton(event.target)
        if (button === null || (event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) return
        clearTimeout(openTimer)
        if (menu) scheduleClose()
      }
      // Pressing anywhere but the menu closes it; a press on the expand button then expands as usual.
      const onDown = (event) => { if (menu && !(event.target instanceof Node && menu.contains(event.target))) close() }
      const onKey = (event) => { if (menu && event.key === 'Escape') close() }
      document.addEventListener('pointerover', onOver, true)
      document.addEventListener('pointerout', onOut, true)
      window.addEventListener('pointerdown', onDown, true)
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('blur', close)
      return () => {
        close()
        document.removeEventListener('pointerover', onOver, true)
        document.removeEventListener('pointerout', onOut, true)
        window.removeEventListener('pointerdown', onDown, true)
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('blur', close)
      }
    }

    function watchPaneClose(sidebar) {
      const unwatch = watchDock(ensurePaneControls)
      const unwatchExpand = watchPaneExpand()
      const unwatchMenu = watchPaneMenu(sidebar)
      const onClick = (event) => {
        const button = event.target instanceof Element ? event.target.closest('[' + CLOSE_ATTR + ']') : null
        if (button === null) return
        event.preventDefault()
        event.stopPropagation()
        const paneId = button.closest('[data-dockkit-pane]')?.getAttribute('data-dockkit-pane')
        const sessionId = sidebar.mounted && sidebar.mounted.getSnapshot()
        if (paneId && sessionId && surfaceOf(sidebar, sessionId)) { closePaneOf(sidebar, sessionId, paneId); return }
        const strip = button.closest('[class*="_tabStrip_"]')
        const active = strip && strip.querySelector('[role="tab"][aria-selected="true"]')
        if (active) { try { sidebar.close(active.getAttribute('data-dockkit-tab')) } catch { /* already closed */ } }
      }
      document.addEventListener('click', onClick, true)
      return () => {
        unwatch()
        unwatchExpand()
        unwatchMenu()
        document.removeEventListener('click', onClick, true)
        document.querySelectorAll('[' + CLOSE_ATTR + '], [' + EXPAND_ATTR + '], [' + CHROME_ATTR + ']').forEach(element => element.remove())
      }
    }

    // ---- Browser pane extras, like Claude Code desktop's browser -----------------------------------
    // Rendered by the header toolbar (which has the composer's input actions) and portalled into each
    // visible Harness browser pane: a bottom bar to pick an element or annotate the page, a servers
    // menu (detected dev servers plus ones you add) and a ⋮ menu, both in the pane header.
    const ReactDOM = require('react-dom')
    const SERVERS_KEY = 'harness-studio.servers'
    const VIEWPORTS = [
      { id: 'responsive', label: 'Responsive', width: undefined },
      { id: 'mobile', label: 'Mobile · 390', width: 390 },
      { id: 'tablet', label: 'Tablet · 768', width: 768 },
      { id: 'desktop', label: 'Desktop · 1280', width: 1280 },
    ]
    const ICON_PICK_BAR = 'M3 3l4.2 10 1.5-4.3L13 7.2zM9 9l4 4'
    const ICON_PEN = 'M10.5 2.5l3 3L6 13H3v-3zM9 4l3 3'
    const ICON_CLOSE = 'M4 4l8 8M12 4l-8 8'
    const ICON_SERVER = 'M2.5 3h11v4h-11zM2.5 9h11v4h-11zM5 5h.01M5 11h.01'
    const ICON_MORE = 'M8 3.5h.01M8 8h.01M8 12.5h.01'

    const extraStyles = {
      bar: {
        position: 'absolute', left: '50%', bottom: 14, transform: 'translateX(-50%)', zIndex: 5, display: 'flex', alignItems: 'center', gap: 2,
        padding: 4, borderRadius: 12, background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l2)', boxShadow: '0 4px 16px rgba(0,0,0,.12)',
      },
      barButton: { width: 32, height: 30, display: 'grid', placeItems: 'center', border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', padding: 0 },
      barActive: { background: 'color-mix(in srgb, var(--dsw-alias-button-info-fill) 18%, transparent)', color: 'var(--dsw-alias-button-info-fill)' },
      sep: { width: 1, height: 18, margin: '0 3px', background: 'var(--dsw-alias-border-l2)' },
      card: { position: 'absolute', left: 10, right: 10, bottom: 60, zIndex: 6, maxHeight: '45%', overflow: 'auto', borderRadius: 12, border: '1px solid var(--dsw-alias-border-l2)', boxShadow: '0 4px 16px rgba(0,0,0,.12)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', font: '13px/1.5 system-ui, sans-serif' },
      menu: {
        position: 'fixed', zIndex: 2147483000, minWidth: 220, padding: 4, borderRadius: 12, background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l2)', boxShadow: '0 8px 24px rgba(0,0,0,.14)', font: '13px/1.4 system-ui, sans-serif',
      },
      item: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px', border: 'none', borderRadius: 7, background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' },
      itemHint: { marginLeft: 'auto', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 },
      menuLabel: { padding: '6px 10px 2px', fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' },
      menuSep: { height: 1, margin: '4px 6px', background: 'var(--dsw-alias-border-l2)' },
      menuInput: { flex: 1, minWidth: 0, height: 28, padding: '0 8px', borderRadius: 7, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', color: 'inherit', font: 'inherit', outline: 'none' },
      annotate: { position: 'absolute', inset: 0, zIndex: 7, background: 'var(--dsw-alias-bg-layer-1)', display: 'flex', flexDirection: 'column' },
      annotateBar: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', font: '13px system-ui, sans-serif', color: 'var(--dsw-alias-label-secondary)' },
      empty: { position: 'absolute', left: 0, right: 0, top: '58%', zIndex: 4, textAlign: 'center', font: '13px/1.6 system-ui, sans-serif', color: 'var(--dsw-alias-label-tertiary)' },
    }

    function readServers() {
      try { const list = JSON.parse(localStorage.getItem(SERVERS_KEY) || '[]'); return Array.isArray(list) ? list.filter(s => typeof s === 'string') : [] } catch { return [] }
    }
    function saveServers(list) {
      try { localStorage.setItem(SERVERS_KEY, JSON.stringify(list)) } catch { /* storage unavailable: the list lasts for this window only */ }
    }

    /** Visible Harness browser panes: their viewport, page frame and header button group. */
    function findBrowserPanes() {
      const panes = []
      for (const cell of document.querySelectorAll('[class*="_tabCell_"]')) {
        if (cell.getBoundingClientRect().width === 0) continue
        const active = cell.querySelector('[role="tab"][aria-selected="true"]')
        if (!active || active.getAttribute('data-studio-kind') !== 'browser') continue
        const viewport = [...cell.querySelectorAll('[class*="_viewport"][aria-label]')].find(v => v.getBoundingClientRect().width > 0)
        // Harness's header controls exist only in the right-most pane; other panes use the group
        // ensurePaneControls adds, so a Browser pane on top of a stack gets its Pick bar and menus too.
        const strip = cell.querySelector('[class*="_tabStrip_"]')
        const chrome = strip && stripChromeOf(strip)
        if (!viewport || !chrome) continue
        panes.push({ key: active.getAttribute('data-dockkit-tab'), viewport, chrome })
      }
      return panes
    }

    function useBrowserPanes() {
      const [panes, setPanes] = useState(() => findBrowserPanes())
      useEffect(() => watchDock(() => {
        const next = findBrowserPanes()
        setPanes(prev => prev.length === next.length && prev.every((p, i) => p.viewport === next[i].viewport && p.chrome === next[i].chrome && p.key === next[i].key) ? prev : next)
      }), [])
      return panes
    }

    /** A container element kept inside `parent` (first or last), for a portal. */
    function usePortalHost(parent, where) {
      const [host] = useState(() => { const div = document.createElement('div'); div.setAttribute('data-studio-browser-extra', ''); return div })
      useEffect(() => {
        if (!parent) return undefined
        if (where === 'start') parent.prepend(host); else parent.append(host)
        return () => host.remove()
      }, [parent, host, where])
      return host
    }

    /** The page frame inside a viewport: a desktop <webview> or a Web <iframe>. */
    function frameOf(viewport) {
      return viewport.querySelector('webview') || viewport.querySelector('iframe')
    }

    /** Run the companion command in the page, injecting the companion first when the page lacks it. */
    async function pageCommand(frame, cmd) {
      if (frame.tagName === 'WEBVIEW') {
        const present = await frame.executeJavaScript('typeof window.__hsDevPreview === "object"').catch(() => false)
        if (!present) await frame.executeJavaScript(COMPANION_SOURCE)
        await frame.executeJavaScript('window.__hsDevPreview.command(' + JSON.stringify(cmd) + ')')
        return true
      }
      // Web: a cross-origin iframe can only be reached through the page's own companion.
      frame.contentWindow?.postMessage({ source: FROM_TAB, type: 'hello' }, '*')
      frame.contentWindow?.postMessage({ source: FROM_TAB, ...cmd }, '*')
      return true
    }

    /** Listen for companion messages from one page frame. */
    function useCompanionMessages(frame, onMessage) {
      const latest = useRef(onMessage)
      latest.current = onMessage
      useEffect(() => {
        if (!frame) return undefined
        if (frame.tagName === 'WEBVIEW') {
          const listener = (event) => {
            const text = typeof event.message === 'string' ? event.message : ''
            if (!text.startsWith(CONSOLE_PREFIX)) return
            let data
            try { data = JSON.parse(text.slice(CONSOLE_PREFIX.length)) } catch { return }
            const message = companionMessage(data)
            if (message !== undefined) latest.current(message)
          }
          frame.addEventListener('console-message', listener)
          return () => frame.removeEventListener('console-message', listener)
        }
        const listener = (event) => {
          if (event.source !== frame.contentWindow) return
          const message = companionMessage(event.data)
          if (message !== undefined) latest.current(message)
        }
        window.addEventListener('message', listener)
        return () => window.removeEventListener('message', listener)
      }, [frame])
    }

    /** Navigate a browser pane through its own address bar, so Harness creates the page and records it. */
    function openInAddressBar(viewport, url) {
      const frame = frameOf(viewport)
      if (frame && frame.tagName === 'WEBVIEW') { frame.loadURL(url); return }
      const input = viewport.closest('[class*="_tabCell_"]')?.querySelector('form input')
      if (!input) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, url)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.form.requestSubmit()
    }

    /** Paste an image into the composer so it becomes an attachment, as a pasted screenshot would. */
    function attachImageToComposer(file) {
      const target = document.querySelector('[class*="_composerSeat"] [contenteditable="true"], [class*="_composerSeat"] textarea')
      if (!target) return false
      target.focus()
      const data = new DataTransfer()
      data.items.add(file)
      target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      return true
    }

    function Annotator({ image, onDone, onCancel }) {
      const canvasRef = useRef(null)
      const drawing = useRef(null)
      useEffect(() => {
        const canvas = canvasRef.current
        const img = new Image()
        img.onload = () => {
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          canvas.getContext('2d').drawImage(img, 0, 0)
        }
        img.src = image
      }, [image])
      const point = (event) => {
        const canvas = canvasRef.current
        const rect = canvas.getBoundingClientRect()
        return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height]
      }
      const down = (event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        const g = canvasRef.current.getContext('2d')
        g.strokeStyle = '#ef4444'
        g.lineWidth = Math.max(3, canvasRef.current.width / 300)
        g.lineCap = 'round'
        g.lineJoin = 'round'
        const [x, y] = point(event)
        g.beginPath(); g.moveTo(x, y)
        drawing.current = g
      }
      const move = (event) => { if (!drawing.current) return; const [x, y] = point(event); drawing.current.lineTo(x, y); drawing.current.stroke() }
      const up = () => { drawing.current = null }
      const attach = () => canvasRef.current.toBlob(blob => { if (blob) onDone(new File([blob], 'annotation.png', { type: 'image/png' })) }, 'image/png')
      return h('div', { style: extraStyles.annotate },
        h('div', { style: extraStyles.annotateBar },
          h(Icon, { d: ICON_PEN }), h('span', null, 'Draw on the page, then attach it to your message'),
          h('div', { style: { flex: 1 } }),
          h('button', { type: 'button', style: styles.button, onClick: onCancel }, 'Cancel'),
          h('button', { type: 'button', style: { ...styles.button, ...styles.buttonActive }, onClick: attach }, 'Attach')),
        h('div', { style: { flex: 1, overflow: 'auto', display: 'grid', placeItems: 'start center' } },
          h('canvas', { ref: canvasRef, style: { maxWidth: '100%', cursor: 'crosshair', touchAction: 'none' }, onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up })))
    }

    function BrowserOverlay({ viewport, sessionId, inputActions, sendSelection, clearSelection }) {
      const [frame, setFrame] = useState(() => frameOf(viewport))
      const [hidden, setHidden] = useState(false)
      const [picking, setPicking] = useState(false)
      const [selection, setSelection] = useState(undefined)
      const [sendState, setSendState] = useState({ kind: 'idle' })
      const [annotation, setAnnotation] = useState(undefined)
      const [note, setNote] = useState(undefined)
      // Set only by the user's click on Pick; the page's first selection after it is the one accepted.
      // Messages come from the page, so a page can't pick on its own or replace an accepted pick.
      const armed = useRef(false)
      const later = useOneTimer()
      useEffect(() => {
        // Only frames coming and going matter here, not the overlay's own re-renders.
        const isFrame = node => node.nodeType === 1 && (node.nodeName === 'WEBVIEW' || node.nodeName === 'IFRAME' || node.querySelector('webview, iframe') !== null)
        const observer = new MutationObserver((records) => {
          if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(isFrame))) setFrame(frameOf(viewport))
        })
        observer.observe(viewport, { childList: true, subtree: true })
        return () => observer.disconnect()
      }, [viewport])
      const flash = (text) => { setNote(text); later(() => setNote(undefined), 2500) }
      useEffect(() => { armed.current = false; setPicking(false) }, [frame])
      useCompanionMessages(frame, (message) => {
        // The page can end pick mode, never start it.
        if ((message.type === 'pick:state' && message.picking !== true) || message.type === 'pick:cancelled') { armed.current = false; setPicking(false); return }
        if (message.type !== 'selection' || !armed.current) return
        armed.current = false
        setPicking(false)
        const picked = normalizeSelection(message.selection)
        if (picked === undefined) { flash('The page sent an element Harness could not read'); return }
        setSelection(picked)
        setSendState({ kind: 'idle' })
      })
      const togglePick = async () => {
        if (!frame) return
        const on = !picking
        armed.current = on
        try { await pageCommand(frame, { type: on ? 'pick:on' : 'pick:off' }); setPicking(on) } catch (error) { armed.current = false; setPicking(false); flash('Pick is unavailable on this page') }
      }
      const startAnnotate = async () => {
        if (!frame || frame.tagName !== 'WEBVIEW') { flash('Annotate works in the Desktop app'); return }
        try { setAnnotation((await frame.capturePage()).toDataURL()) } catch { flash('Could not capture the page') }
      }
      const send = async () => {
        setSendState({ kind: 'sending' })
        const failure = await sendSelection(selection)
        if (failure !== null) { setSendState({ kind: 'error', message: failure }); return }
        setSendState({ kind: 'sent' })
        inputActions?.insertText(composerReference(selection), inputActions.captureInsertion())
      }
      const clear = async () => { setSelection(undefined); setSendState({ kind: 'idle' }); await clearSelection() }
      // Harness's empty browser ("Enter an HTTP(S) address…") gets Claude's "Detect dev server" offer.
      const empty = !frame && /start browsing/i.test(viewport.textContent || '')
      return h(React.Fragment, null,
        annotation ? h(Annotator, {
          image: annotation,
          onCancel: () => setAnnotation(undefined),
          onDone: (file) => { setAnnotation(undefined); flash(attachImageToComposer(file) ? 'Attached to your message' : 'Could not reach the message box') },
        }) : null,
        selection ? h('div', { style: extraStyles.card },
          h(SafeBoundary, { label: 'Selection card', resetKey: selection, fallback: h('div', { style: { ...styles.card, ...styles.muted } }, 'This element cannot be shown.') },
            h(SelectionCard, { selection, onClear: clear, onSend: send, sendState }))) : null,
        note ? h('div', { style: { ...extraStyles.empty, top: 'auto', bottom: 58 } }, note) : null,
        hidden ? null : h('div', { style: { ...extraStyles.bar, ...(frame ? null : { opacity: 0.5 }) }, role: 'toolbar', 'aria-label': 'Page tools', 'data-testid': 'studio-browser-bar', title: frame ? undefined : 'Open a page to use these tools' },
          h('button', { type: 'button', style: { ...extraStyles.barButton, ...(picking ? extraStyles.barActive : null) }, title: picking ? 'Stop picking (Esc)' : 'Pick an element for the agent', 'aria-label': 'Pick an element', 'aria-pressed': picking, onClick: togglePick }, h(Icon, { d: ICON_PICK_BAR })),
          h('button', { type: 'button', style: extraStyles.barButton, title: 'Annotate the page', 'aria-label': 'Annotate', onClick: startAnnotate }, h(Icon, { d: ICON_PEN })),
          h('span', { style: extraStyles.sep }),
          h('button', { type: 'button', style: extraStyles.barButton, title: 'Hide these tools', 'aria-label': 'Hide page tools', onClick: () => setHidden(true) }, h(Icon, { d: ICON_CLOSE }))),
        empty ? h('div', { style: extraStyles.empty }, 'Preview your app instead? ', h(DetectLink, { onFound: url => openInAddressBar(viewport, url) })) : null)
    }

    function DetectLink({ onFound }) {
      const [state, setState] = useState('idle')
      return h('button', {
        type: 'button', style: { ...styles.linkButton, fontSize: 13 }, disabled: state === 'busy',
        onClick: async () => { setState('busy'); const found = await detectDevServer(); setState(found ? 'idle' : 'none'); if (found) onFound(found) },
      }, state === 'busy' ? 'Detecting…' : state === 'none' ? 'No dev server found — retry' : 'Detect dev server')
    }

    /** A header button that opens a menu below it. */
    function HeaderMenuButton({ label, icon, testId, children }) {
      const [open, setOpen] = useState(false)
      useChangesStyles() // the shared sheet removes the mouse-click focus square
      const [at, setAt] = useState({ top: 0, right: 0 })
      const ref = useRef(null)
      useEffect(() => {
        if (!open) return undefined
        // A press on the menu or on its own button is not "outside" (the button's click toggles it).
        const close = (event) => { if (!(event.target instanceof Element) || !(event.target.closest('[data-studio-menu]') || ref.current?.contains(event.target))) setOpen(false) }
        const key = (event) => { if (event.key === 'Escape') setOpen(false) }
        window.addEventListener('pointerdown', close, true)
        window.addEventListener('keydown', key, true)
        return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', key, true) }
      }, [open])
      const toggle = () => {
        const rect = ref.current.getBoundingClientRect()
        setAt({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
        setOpen(!open)
      }
      // Styled inline to match the pane's own header buttons (28px, 8px radius, no border); without it
      // the browser's default grey, bordered button shows.
      const [hover, setHover] = useState(false)
      const look = {
        width: 28, height: 28, padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', borderRadius: 8, color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', appearance: 'none',
        background: open ? 'var(--dsw-alias-interactive-bg-active)' : hover ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
      }
      return h(React.Fragment, null,
        h('button', { ref, type: 'button', style: look, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false), 'data-studio-menu-button': '', 'data-testid': testId, title: label, 'aria-label': label, 'aria-expanded': open, onClick: toggle },
          h(Icon, { d: icon })),
        open ? ReactDOM.createPortal(h('div', { style: { ...extraStyles.menu, top: at.top, right: at.right }, 'data-studio-menu': '', role: 'menu' }, children(() => setOpen(false))), document.body) : null)
    }

    function MenuItem({ label, hint, onClick, danger }) {
      return h('button', {
        type: 'button', role: 'menuitem', style: { ...extraStyles.item, ...(danger ? { color: 'var(--dsw-alias-state-error-primary)' } : null) }, onClick,
        onMouseEnter: e => { e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)' },
        onMouseLeave: e => { e.currentTarget.style.background = 'transparent' },
      }, label, hint ? h('span', { style: extraStyles.itemHint }, hint) : null)
    }

    function ServersMenu({ viewport }) {
      return h(HeaderMenuButton, { label: 'Dev servers', icon: ICON_SERVER, testId: 'studio-servers-button' }, close => h(ServersList, { viewport, close }))
    }

    function ServersList({ viewport, close }) {
      const [detected, setDetected] = useState(undefined)
      const [saved, setSaved] = useState(readServers)
      const [adding, setAdding] = useState(false)
      const [draft, setDraft] = useState('')
      useEffect(() => {
        let live = true
        Promise.all(DEV_PORTS.map(async port => {
          const url = 'http://localhost:' + port + '/'
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
          try { await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal }); return url } catch { return undefined } finally { clearTimeout(timer) } // closed port
        })).then(found => { if (live) setDetected(found.filter(Boolean)) })
        return () => { live = false }
      }, [])
      const open = (url) => { openInAddressBar(viewport, url); close() }
      const add = () => {
        const url = normalizeUrl(draft)
        if (url === undefined) return
        const next = [url, ...saved.filter(s => s !== url)].slice(0, 12)
        saveServers(next); setSaved(next); setAdding(false); setDraft(''); open(url)
      }
      const remove = (url) => { const next = saved.filter(s => s !== url); saveServers(next); setSaved(next) }
      const local = (detected || []).filter(url => !saved.includes(url))
      return h(React.Fragment, null,
        h('div', { style: extraStyles.menuLabel }, 'Running on this computer'),
        detected === undefined ? h('div', { style: { ...extraStyles.item, cursor: 'default', color: 'var(--dsw-alias-label-tertiary)' } }, 'Looking…')
          : local.length === 0 ? h('div', { style: { ...extraStyles.item, cursor: 'default', color: 'var(--dsw-alias-label-tertiary)' } }, 'No dev servers found')
          : local.map(url => h(MenuItem, { key: url, label: url.replace(/^http:\/\//, '').replace(/\/$/, ''), onClick: () => open(url) })),
        saved.length ? h('div', { style: extraStyles.menuSep }) : null,
        saved.length ? h('div', { style: extraStyles.menuLabel }, 'Saved') : null,
        saved.map(url => h('div', { key: url, style: { display: 'flex', alignItems: 'center' } },
          h(MenuItem, { label: url.replace(/^https?:\/\//, '').replace(/\/$/, ''), onClick: () => open(url) }),
          h('button', { type: 'button', title: 'Remove', 'aria-label': 'Remove ' + url, style: { ...extraStyles.barButton, width: 24, height: 24 }, onClick: () => remove(url) }, h(Icon, { d: ICON_CLOSE })))),
        h('div', { style: extraStyles.menuSep }),
        adding
          ? h('form', { style: { display: 'flex', gap: 4, padding: 4 }, onSubmit: e => { e.preventDefault(); add() } },
            h('input', { style: extraStyles.menuInput, autoFocus: true, placeholder: 'localhost:5173', value: draft, onChange: e => setDraft(e.target.value), spellCheck: false }),
            h('button', { type: 'submit', style: styles.button }, 'Add'))
          : h(MenuItem, { label: 'Add server', onClick: () => setAdding(true) }))
    }

    function MoreMenu({ viewport }) {
      return h(HeaderMenuButton, { label: 'More', icon: ICON_MORE, testId: 'studio-more-button' }, close => h(MoreList, { viewport, close }))
    }

    function MoreList({ viewport, close }) {
      const frame = frameOf(viewport)
      const webview = frame && frame.tagName === 'WEBVIEW' ? frame : undefined
      const url = webview ? webview.getURL() : (frame ? frame.src : '')
      const [mode, setMode] = useState(() => viewport.getAttribute('data-studio-viewport') || 'responsive')
      const run = (fn) => () => { close(); fn() }
      const setViewport = (option) => {
        viewport.setAttribute('data-studio-viewport', option.id)
        if (frame) {
          frame.style.width = option.width ? option.width + 'px' : ''
          frame.style.maxWidth = option.width ? 'none' : ''
          frame.style.margin = option.width ? '0 auto' : ''
          frame.style.flex = option.width ? 'none' : ''
        }
        viewport.style.overflowX = option.width ? 'auto' : ''
        setMode(option.id)
        close()
      }
      const systemButton = viewport.closest('[class*="_tabCell_"]')?.querySelector('[aria-label="Open in system browser"]')
      return h(React.Fragment, null,
        h(MenuItem, { label: 'Open in default browser', onClick: run(() => systemButton ? systemButton.click() : window.open(url, '_blank')) }),
        h(MenuItem, { label: 'Copy URL', onClick: run(() => navigator.clipboard.writeText(url).catch(() => {})) }),
        webview ? h(MenuItem, { label: 'Save screenshot', onClick: run(async () => {
          const image = await webview.capturePage()
          const link = document.createElement('a')
          link.href = image.toDataURL()
          link.download = 'screenshot-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png'
          link.click()
        }) }) : null,
        h('div', { style: extraStyles.menuSep }),
        h('div', { style: extraStyles.menuLabel }, 'Viewport'),
        VIEWPORTS.map(option => h(MenuItem, { key: option.id, label: option.label, hint: mode === option.id ? '✓' : undefined, onClick: () => setViewport(option) })),
        webview ? h('div', { style: extraStyles.menuSep }) : null,
        webview ? h(MenuItem, { label: 'Hard reload', onClick: run(() => webview.reloadIgnoringCache()) }) : null,
        webview ? h(MenuItem, { label: 'Open developer tools', onClick: run(() => webview.openDevTools()) }) : null,
        webview ? h(MenuItem, { label: 'Clear page data', danger: true, onClick: run(() => webview.executeJavaScript('try { localStorage.clear(); sessionStorage.clear() } catch (e) {}; location.reload()').catch(() => {})) }) : null)
    }

    const addressInputOf = viewport => viewport.closest('[class*="_tabCell_"]')?.querySelector('form input') ?? null

    // Harness's empty-tab line ("Enter an HTTP(S) address to start browsing") sits beside the page area,
    // in the same tab cell; its module class ends in "_start".
    const BROWSER_START = '[class$="_start"], [class*="_start "]'

    /** A Browser pane with no page and nothing typed: Harness's own start line is all it shows. */
    function isEmptyBrowser(viewport) {
      const cell = viewport.closest('[class*="_tabCell_"]')
      return !frameOf(viewport) && (addressInputOf(viewport)?.value ?? '') === '' && cell?.querySelector(BROWSER_START) != null
    }

    const ICON_GLOBE = 'M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0zM2 8h12M8 2c1.7 1.6 2.5 3.6 2.5 6S9.7 12.4 8 14M8 2C6.3 3.6 5.5 5.6 5.5 8s.8 4.4 2.5 6'
    const emptyStyles = {
      wrap: { position: 'absolute', inset: 0, zIndex: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 24, textAlign: 'center', pointerEvents: 'none', font: '13px/1.5 system-ui, sans-serif' },
      icon: { width: 28, height: 28, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 6 },
      title: { fontSize: 15, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
      text: { maxWidth: 340, color: 'var(--dsw-alias-label-tertiary)' },
      row: { marginTop: 10, color: 'var(--dsw-alias-label-tertiary)', pointerEvents: 'auto' },
      link: { marginLeft: 8, padding: 0, border: 'none', background: 'transparent', font: 'inherit', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' },
    }

    /** Claude-style start page for an empty Browser pane, with a shortcut to the app's dev server. */
    function EmptyBrowser({ viewport }) {
      const [empty, setEmpty] = useState(() => isEmptyBrowser(viewport))
      const [search, setSearch] = useState('idle')
      useEffect(() => {
        const check = () => setEmpty(isEmptyBrowser(viewport))
        const observer = new MutationObserver(check)
        observer.observe(viewport.closest('[class*="_tabCell_"]') ?? viewport, { childList: true, subtree: true })
        const input = addressInputOf(viewport)
        input?.addEventListener('input', check)
        const timer = setInterval(check, 1000) // a typed address that React sets without an input event
        return () => { observer.disconnect(); input?.removeEventListener('input', check); clearInterval(timer) }
      }, [viewport])
      useEffect(() => {
        const cell = viewport.closest('[class*="_tabCell_"]')
        if (!empty || !cell) return undefined
        cell.setAttribute('data-studio-empty', '')
        return () => cell.removeAttribute('data-studio-empty')
      }, [empty, viewport])
      if (!empty) return null
      const detect = async () => {
        setSearch('looking')
        const url = await detectDevServer()
        if (url === undefined) { setSearch('none'); return }
        setSearch('idle')
        openInAddressBar(viewport, url)
      }
      return h('div', { style: emptyStyles.wrap, 'data-studio-browser-start': '' },
        h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1, style: emptyStyles.icon, 'aria-hidden': true }, h('path', { d: ICON_GLOBE })),
        h('div', { style: emptyStyles.title }, 'Browse with the agent'),
        h('div', { style: emptyStyles.text }, 'Type a URL or ask the agent to open a site. It can read, click, and type.'),
        h('div', { style: emptyStyles.row },
          search === 'none' ? 'No dev server found on the usual ports. Start yours, then' : 'Preview your app instead?',
          h('button', { type: 'button', style: emptyStyles.link, disabled: search === 'looking', onClick: detect },
            search === 'looking' ? 'Looking…' : search === 'none' ? 'Try again' : 'Detect dev server')))
    }

    function BrowserPaneExtras({ pane, ...rest }) {
      const overlayHost = usePortalHost(pane.viewport, 'end')
      const menuHost = usePortalHost(pane.chrome, 'start')
      useEffect(() => {
        const position = getComputedStyle(pane.viewport).position
        if (position === 'static') pane.viewport.style.position = 'relative'
        menuHost.style.display = 'contents'
      }, [pane.viewport, menuHost])
      return h(React.Fragment, null,
        ReactDOM.createPortal(h(React.Fragment, null, h(EmptyBrowser, { viewport: pane.viewport }), h(BrowserOverlay, { viewport: pane.viewport, ...rest })), overlayHost),
        ReactDOM.createPortal(h(React.Fragment, null, h(ServersMenu, { viewport: pane.viewport }), h(MoreMenu, { viewport: pane.viewport })), menuHost))
    }

    function BrowserExtras(props) {
      const panes = useBrowserPanes()
      return h(React.Fragment, null, panes.map(pane => h(SafeBoundary, { key: pane.key, label: 'Browser pane extras' }, h(BrowserPaneExtras, { pane, ...props }))))
    }

    // ---- pane toolbar: one icon per right-sidebar pane, in the conversation header ----------------
    // Like Claude Code desktop's header icons: a click opens that pane (or focuses the one already
    // open), and clicking the pane that is showing collapses the sidebar.
    const PANE_BUTTONS = [
      { kind: DETAILS_KIND, label: 'Session details', d: ICON_DETAILS, divider: true },
      { kind: 'terminal', label: 'Terminal', d: 'M3.5 4.5L7 8l-3.5 3.5M8.5 11.5h4' },
      { kind: CHANGES_KIND, label: 'Changes', d: ICON_CHANGES },
      { kind: 'browser', label: 'Browser', d: 'M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0zM2 8h12M8 2c1.7 1.6 2.5 3.6 2.5 6S9.7 12.4 8 14M8 2C6.3 3.6 5.5 5.6 5.5 8s.8 4.4 2.5 6' },
      { kind: FILES_KIND, label: 'Files', d: 'M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z' },
    ]
    const toolbarStyles = {
      bar: { display: 'flex', alignItems: 'center', gap: 2 },
      divider: { width: 1, height: 16, margin: '0 4px', background: 'var(--dsw-alias-border-l2)' },
      button: {
        width: 28, height: 28, display: 'grid', placeItems: 'center', padding: 0, border: 'none', borderRadius: 7,
        background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer',
      },
      active: {
        background: 'color-mix(in srgb, var(--dsw-alias-button-info-fill) 18%, transparent)', color: 'var(--dsw-alias-button-info-fill)',
      },
      note: { maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, padding: '0 6px', color: 'var(--dsw-alias-state-error-primary)' },
    }

    /** Which pane kind is showing in the right sidebar, or undefined while it is collapsed. */
    /**
     * The pane kind showing in the right sidebar, or undefined while it is closed. Read from the
     * screen: Harness's own "expanded" flag can say closed while a pane is visibly open.
     */
    function shownKind(sidebar) {
      const cell = [...document.querySelectorAll('[class*="_tabCell_"]')].find(c => c.getBoundingClientRect().width > 0)
      const tabId = cell?.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-dockkit-tab')
      if (!tabId) return undefined
      try { return sidebar.openTabs.getSnapshot().find(tab => String(tab.tabId) === tabId)?.kind } catch { return undefined } // no Session on screen yet
    }

    /** Close the right sidebar through Harness's own collapse control (kept in the DOM, hidden by the theme). */
    function collapseRightSidebar(sidebar) {
      const button = [...document.querySelectorAll('[aria-label="Collapse right sidebar"]')].find(b => b.closest('[class*="_tabCell_"]'))
      if (button) button.click()
      else sidebar.toggleExpanded()
    }

    // ---- pane arrangement: Move and Fill, from the expand button's menu --------------------------------
    // Per Session: `side` shows the two panes side by side instead of stacked, `swap` shows the second
    // pane first, and `fill` ('0' or '1') shows only that pane in the sidebar. Side and swap are kept
    // across launches; fill lasts until a pane is opened, closed or arranged again.
    const ARRANGE_KEY = 'harness-studio.pane-arrangement'
    const ARRANGE_KEEP = 200 // Sessions remembered
    const arrangements = new Map()
    const arrangementListeners = new Set()
    function readArrangements() {
      try { const value = JSON.parse(localStorage.getItem(ARRANGE_KEY) || '{}'); return value && typeof value === 'object' ? value : {} } catch { return {} } // storage unavailable or damaged
    }
    function arrangementOf(sessionId) {
      let arrangement = arrangements.get(sessionId)
      if (arrangement === undefined) {
        const saved = readArrangements()[sessionId] || {}
        arrangement = { side: saved.side === true, swap: saved.swap === true, fill: undefined }
        arrangements.set(sessionId, arrangement)
      }
      return arrangement
    }
    function setArrangement(sessionId, patch) {
      const next = { ...arrangementOf(sessionId), ...patch }
      arrangements.set(sessionId, next)
      try {
        const all = readArrangements()
        delete all[sessionId]
        if (next.side || next.swap) all[sessionId] = { side: next.side, swap: next.swap }
        const keys = Object.keys(all)
        for (const key of keys.slice(0, Math.max(0, keys.length - ARRANGE_KEEP))) delete all[key]
        localStorage.setItem(ARRANGE_KEY, JSON.stringify(all))
      } catch { /* storage unavailable: the arrangement lasts for this window only */ }
      for (const listener of [...arrangementListeners]) listener()
    }

    /** The pane column Fill shows alone ('0' or '1'), or undefined (none, or the conversation is hidden instead). */
    const filledColumn = arrangement => arrangement.fill === '0' || arrangement.fill === '1' ? arrangement.fill : undefined

    /** Show `kind` again if Fill is hiding the pane that holds it; returns whether anything changed. */
    function unhideKind(sidebar, sessionId, kind) {
      const s = surfaceOf(sidebar, sessionId)
      const arrangement = arrangementOf(sessionId)
      if (!s || filledColumn(arrangement) === undefined) return false
      const index = dockPanesOf(s.layout).findIndex(pane => pane.tabs.some(tabId => kindOfTab(s.layout, tabId) === kind))
      if (index === -1 || String(index) === arrangement.fill) return false
      setArrangement(sessionId, { fill: undefined })
      return true
    }

    // ---- panel placement: the right sidebar beside, above or below the conversation ----------------
    // With one pane open, Move places the whole panel left, right, above or below the conversation (like
    // Claude Code desktop showing the browser under the chat), and Fill lets it take the conversation's
    // space (arrangement.fill === 'chat'). Harness lays its window out as a grid of three columns
    // (sessions, conversation, panel) whose sizes it writes inline; these rules rearrange that grid,
    // reading Harness's own sizes from custom properties synced below. Placement is one choice for the
    // window, kept across launches; `size` is the panel's width in px (left) or its share of the
    // height (top, bottom), set by dragging the edge, and resets when the side changes.
    const PLACE_KEY = 'harness-studio.panel-place'
    const PLACES = ['right', 'left', 'top', 'bottom']
    function readPlace() {
      try {
        const value = JSON.parse(localStorage.getItem(PLACE_KEY) || 'null')
        if (value && PLACES.includes(value.side)) return { side: value.side, size: typeof value.size === 'number' ? value.size : undefined }
      } catch { /* storage unavailable or damaged */ }
      return { side: 'right', size: undefined }
    }
    let panelPlace = readPlace()
    function setPlace(next, persist = true) {
      panelPlace = next
      if (persist) {
        try { if (next.side === 'right') localStorage.removeItem(PLACE_KEY); else localStorage.setItem(PLACE_KEY, JSON.stringify(next)) } catch { /* storage unavailable: lasts for this window only */ }
      }
      for (const listener of [...arrangementListeners]) listener()
    }

    const APP_FRAME = '[class$="_frame"][style*="grid-template-columns"]'
    const PANEL_MIN_PX = 280
    const CHAT_MIN_PX = 400
    const PLACE_CSS = `
      ${APP_FRAME}[data-hs-place="left"] { grid-template-columns: var(--hs-col-side) var(--hs-col-panel) var(--hs-col-center) !important; }
      ${APP_FRAME}[data-hs-place="left"] > [class*="_sidebarCol"] { grid-column: 1; grid-row: 1; }
      ${APP_FRAME}[data-hs-place="left"] > [data-rightbar-col] { grid-column: 2; grid-row: 1; }
      ${APP_FRAME}[data-hs-place="left"] > [class*="_centerCol"] { grid-column: 3; grid-row: 1; }
      ${APP_FRAME}:is([data-hs-place="top"], [data-hs-place="bottom"]) { grid-template-columns: var(--hs-col-side) minmax(0, 1fr) !important; }
      ${APP_FRAME}[data-hs-place="bottom"] { grid-template-rows: var(--hs-row-chat) var(--hs-row-panel) auto !important; }
      ${APP_FRAME}[data-hs-place="top"] { grid-template-rows: var(--hs-row-panel) var(--hs-row-chat) auto !important; }
      ${APP_FRAME}:is([data-hs-place="top"], [data-hs-place="bottom"]) > [class*="_sidebarCol"] { grid-column: 1; grid-row: 1 / 3; }
      ${APP_FRAME}:is([data-hs-place="top"], [data-hs-place="bottom"]) > [data-shell-bottom] { grid-row: 3; }
      ${APP_FRAME}[data-hs-place="bottom"] > [class*="_centerCol"], ${APP_FRAME}[data-hs-place="top"] > [data-rightbar-col] { grid-column: 2; grid-row: 1; }
      ${APP_FRAME}[data-hs-place="bottom"] > [data-rightbar-col], ${APP_FRAME}[data-hs-place="top"] > [class*="_centerCol"] { grid-column: 2; grid-row: 2; }
      ${APP_FRAME}[data-hs-place="bottom"]:not([data-hs-chat-hidden]) > [data-rightbar-col] { border-top: 0.5px solid var(--dsw-alias-border-l3); }
      ${APP_FRAME}[data-hs-place="top"]:not([data-hs-chat-hidden]) > [data-rightbar-col] { border-bottom: 0.5px solid var(--dsw-alias-border-l3); }
      ${APP_FRAME}[data-hs-chat-hidden] > [class*="_centerCol"] { display: none !important; }
      ${APP_FRAME}[data-hs-chat-hidden]:not([data-hs-place]) { grid-template-columns: var(--hs-col-side) 0px minmax(0, 1fr) !important; }
      ${APP_FRAME}[data-hs-chat-hidden]:not([data-hs-place]) > [data-rightbar-col] { grid-column: 3; grid-row: 1; }
      ${APP_FRAME}[data-hs-chat-hidden][data-hs-place="left"] { grid-template-columns: var(--hs-col-side) minmax(0, 1fr) 0px !important; }
      ${APP_FRAME}:is([data-hs-place], [data-hs-chat-hidden]) > [class*="_handle"][data-side="rightbar"] { display: none !important; }
      ${APP_FRAME}:is([data-hs-place], [data-hs-chat-hidden]) [data-sidebar-right-panel]:not([data-sidebar-right-panel="fullscreen"]) { width: auto !important; left: 0 !important; }
      ${APP_FRAME}[data-hs-place] [data-sidebar-right-panel="fullscreen"] { position: fixed !important; inset: 0 !important; width: auto !important; }
      [data-hs-place-handle] { position: absolute; z-index: 25; background: transparent; touch-action: none; }
      [data-hs-place-handle]:hover, [data-hs-place-handle][data-dragging] { background: color-mix(in srgb, var(--dsw-alias-button-info-fill) 35%, transparent); }
    `

    /** Split a grid track list at top-level spaces ("274px minmax(400px, 1fr) 576px" → three tracks). */
    function gridTracks(value) {
      const tracks = []
      let depth = 0
      let current = ''
      for (const ch of String(value || '')) {
        if (ch === '(') depth++
        if (ch === ')') depth--
        if (ch === ' ' && depth === 0) { if (current) tracks.push(current); current = '' } else current += ch
      }
      if (current) tracks.push(current)
      return tracks
    }

    /** The panel of the Session on screen (Harness keeps one per mounted Session; the others are hidden). */
    const visiblePanel = () => [...document.querySelectorAll('[data-sidebar-right-panel]')].find(panel => panel.closest('[hidden]') === null)

    /** Apply the placement and the conversation's Fill to Harness's window grid; returns the frame. */
    function syncFrame(sessionId) {
      const frame = document.querySelector(APP_FRAME)
      if (!frame) return undefined
      const panel = visiblePanel()
      const open = panel !== undefined && panel.hasAttribute('data-sidebar-right-open')
      const arrangement = sessionId ? arrangementOf(sessionId) : undefined
      // Hiding the conversation needs an open panel; closing the panel brings the conversation back.
      if (arrangement && arrangement.fill === 'chat' && !open) arrangement.fill = undefined
      const chatHidden = open && arrangement !== undefined && arrangement.fill === 'chat'
      setDataAttr(frame, 'data-hs-place', panelPlace.side === 'right' ? undefined : panelPlace.side)
      setDataAttr(frame, 'data-hs-chat-hidden', chatHidden)
      const [side = '0px', center = 'minmax(' + CHAT_MIN_PX + 'px, 1fr)', panelTrack = '0px'] = gridTracks(frame.style.gridTemplateColumns)
      const share = panelPlace.side === 'top' || panelPlace.side === 'bottom' ? (panelPlace.size ?? 0.45) : 0.45
      const values = {
        '--hs-col-side': side,
        '--hs-col-center': center,
        '--hs-col-panel': !open ? '0px' : panelPlace.side === 'left' && panelPlace.size !== undefined ? panelPlace.size + 'px' : panelTrack,
        '--hs-row-panel': !open ? '0px' : chatHidden ? 'minmax(0, 1fr)' : 'minmax(0, ' + share + 'fr)',
        '--hs-row-chat': chatHidden ? '0px' : 'minmax(0, ' + (open ? 1 - share : 1) + 'fr)',
      }
      for (const [name, value] of Object.entries(values)) if (frame.style.getPropertyValue(name) !== value) frame.style.setProperty(name, value)
      return frame
    }

    /**
     * The placed panel's resize edge: Harness's own handle only knows the panel on the right, so a panel
     * on the left, top or bottom gets this one, drawn over the edge it shares with the conversation.
     */
    function watchPlaceHandle(getSessionId) {
      const handle = document.createElement('div')
      handle.setAttribute('data-hs-place-handle', '')
      let drag = null
      const position = () => {
        const frame = document.querySelector(APP_FRAME)
        const column = frame && frame.querySelector(':scope > [data-rightbar-col]')
        const show = frame && column && frame.hasAttribute('data-hs-place') && !frame.hasAttribute('data-hs-chat-hidden')
          && visiblePanel()?.hasAttribute('data-sidebar-right-open') && visiblePanel()?.getAttribute('data-sidebar-right-panel') !== 'fullscreen'
        if (!show) { handle.remove(); return }
        if (handle.parentElement !== frame) frame.append(handle)
        const f = frame.getBoundingClientRect()
        const c = column.getBoundingClientRect()
        const side = panelPlace.side
        const across = side === 'left'
        Object.assign(handle.style, across
          ? { left: (c.right - f.left - 4) + 'px', top: (c.top - f.top) + 'px', width: '8px', height: c.height + 'px', cursor: 'col-resize' }
          : { left: (c.left - f.left) + 'px', top: ((side === 'bottom' ? c.top : c.bottom) - f.top - 4) + 'px', width: c.width + 'px', height: '8px', cursor: 'row-resize' })
      }
      const onDown = (event) => {
        if (event.button !== 0 || event.target !== handle) return
        event.preventDefault()
        event.stopPropagation()
        const frame = document.querySelector(APP_FRAME)
        const shield = document.createElement('div')
        shield.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent;cursor:' + handle.style.cursor
        document.body.append(shield)
        document.documentElement.style.userSelect = 'none'
        handle.setAttribute('data-dragging', '')
        drag = { frame, shield }
      }
      const onMove = (event) => {
        if (!drag) return
        event.preventDefault()
        const f = drag.frame.getBoundingClientRect()
        const sidebarWidth = drag.frame.querySelector(':scope > [class*="_sidebarCol"]')?.getBoundingClientRect().width ?? 0
        const bottomRow = drag.frame.querySelector(':scope > [data-shell-bottom]')?.getBoundingClientRect().height ?? 0
        const height = f.height - bottomRow
        let size
        if (panelPlace.side === 'left') size = Math.round(Math.min(f.width - sidebarWidth - CHAT_MIN_PX, Math.max(PANEL_MIN_PX, event.clientX - f.left - sidebarWidth)))
        else {
          const raw = panelPlace.side === 'bottom' ? (f.top + height - event.clientY) / height : (event.clientY - f.top) / height
          size = Math.min(0.8, Math.max(0.2, raw))
        }
        setPlace({ side: panelPlace.side, size }, false)
        syncFrame(getSessionId())
        position()
      }
      const onUp = () => {
        if (!drag) return
        drag.shield.remove()
        drag = null
        handle.removeAttribute('data-dragging')
        document.documentElement.style.userSelect = ''
        setPlace(panelPlace)
      }
      window.addEventListener('pointerdown', onDown, true)
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onUp, true)
      window.addEventListener('blur', onUp)
      return {
        position,
        dispose: () => {
          onUp()
          handle.remove()
          window.removeEventListener('pointerdown', onDown, true)
          window.removeEventListener('pointermove', onMove, true)
          window.removeEventListener('pointerup', onUp, true)
          window.removeEventListener('pointercancel', onUp, true)
          window.removeEventListener('blur', onUp)
        },
      }
    }

    // ---- stacked panes: up to two, top and bottom, like Claude Code desktop -----------------------
    // Harness's right sidebar keeps a per-Session layout (panes, their tabs, a split between them) in a
    // store its pane service adopts. Its public face only splits side by side and only through the
    // Session it believes is on screen, so the stacking rules below work on that store directly:
    //   - a header icon whose pane is showing closes that pane (the last one also closes the sidebar);
    //   - otherwise it opens its pane: alone, below the one that is open, or in place of the bottom one;
    //   - a pane always shows one thing (browser tabs excepted), so closing it brings nothing back.
    // The side-by-side split is drawn top and bottom by STACK_CSS.
    function surfaceOf(sidebar, sessionId) {
      const adoption = sidebar.adopted && sidebar.adopted.get(sessionId)
      const surface = adoption && adoption.store.getSnapshot().bySession[sessionId]
      return surface ? { layout: surface.layout, actions: adoption.store.actions, store: adoption.store } : undefined
    }

    /** Docked panes in order: top first. */
    function dockPanesOf(layout) {
      const panes = []
      const visit = (id) => {
        const node = layout.nodes[id]
        if (!node) return
        if (node.kind === 'pane') { if (node.host === 'dock') panes.push(node) }
        else if (node.kind === 'split') node.children.forEach(visit)
      }
      visit(layout.rootId)
      return panes
    }

    const kindOfTab = (layout, tabId) => layout.tabs[tabId] && layout.tabs[tabId].kind

    /** Kinds showing right now, one per visible pane. */
    function shownKinds(sidebar, sessionId) {
      const s = surfaceOf(sidebar, sessionId)
      if (!s || !s.layout.expanded) return []
      const fill = filledColumn(arrangementOf(sessionId))
      return dockPanesOf(s.layout).filter((pane, index) => fill === undefined || String(index) === fill)
        .map(pane => kindOfTab(s.layout, pane.activeTabId)).filter(kind => kind && kind !== 'guide')
    }

    function closeTabIn(sidebar, sessionId, actions, tabId) {
      try { if (typeof sidebar.closeIn === 'function') sidebar.closeIn(sessionId, tabId); else actions.closeTab(sessionId, tabId) } catch { /* already closed */ }
    }

    /** Close every tab in a pane; when it was the only pane, close the sidebar too. */
    function closePaneOf(sidebar, sessionId, paneId) {
      const s = surfaceOf(sidebar, sessionId)
      if (!s) return
      const pane = s.layout.nodes[paneId]
      if (!pane || pane.kind !== 'pane') return
      // "Last" counts only panes showing something: a pane holding just the start page doesn't count.
      const others = dockPanesOf(s.layout).filter(other => other.id !== paneId && other.tabs.some(tabId => kindOfTab(s.layout, tabId) !== 'guide'))
      const wasLast = others.length === 0
      for (const tabId of [...pane.tabs]) closeTabIn(sidebar, sessionId, s.actions, tabId)
      if (wasLast) {
        // Harness seeds a start page into an emptied sidebar; it goes too, with the sidebar.
        const after = surfaceOf(sidebar, sessionId)
        for (const pane of after ? dockPanesOf(after.layout) : []) {
          for (const tabId of [...pane.tabs]) if (kindOfTab(after.layout, tabId) === 'guide') closeTabIn(sidebar, sessionId, after.actions, tabId)
        }
        s.actions.setExpanded(sessionId, false)
      }
    }

    /**
     * Keep one thing per pane. Harness can land a tab in a pane that already shows something else (a
     * floating pane sent back to the sidebar joins the docked pane as a second tab), and the theme hides
     * that pane's tab strip, stranding the other tab. With one pane open the arriving tab, which Harness
     * focuses, gets its own pane below; with two, it is left where Harness put it.
     */
    function separateMixedPane(sidebar, sessionId) {
      const s = surfaceOf(sidebar, sessionId)
      if (!s || !s.layout.expanded) return
      const panes = dockPanesOf(s.layout)
      if (panes.length !== 1) return
      const pane = panes[0]
      const kindOf = tabId => kindOfTab(s.layout, tabId)
      const kinds = new Set(pane.tabs.map(kindOf).filter(kind => kind && kind !== 'guide'))
      const activeKind = kindOf(pane.activeTabId)
      if (kinds.size < 2 || !activeKind || activeKind === 'guide') return
      let created
      s.actions.splitPane(sessionId, pane.id, id => { created = id })
      if (!created) return // no room to split (the sidebar is too narrow)
      for (const tabId of pane.tabs.filter(tabId => kindOf(tabId) === activeKind)) s.actions.placeTab(sessionId, tabId, created, 0)
    }

    /** Keep only `kind` (and, for the browser, its sibling tabs) in a pane. */
    function keepOnly(sidebar, sessionId, paneId, kind) {
      const s = surfaceOf(sidebar, sessionId)
      const pane = s && s.layout.nodes[paneId]
      if (!pane || pane.kind !== 'pane') return
      for (const tabId of [...pane.tabs]) {
        if (kindOfTab(s.layout, tabId) !== kind) closeTabIn(sidebar, sessionId, s.actions, tabId)
      }
    }

    function togglePane(sidebar, sessionId, kind) {
      const s = surfaceOf(sidebar, sessionId)
      if (!s) { sidebar.openTab(kind); return }
      const panes = dockPanesOf(s.layout)
      const showing = s.layout.expanded ? panes.find(pane => kindOfTab(s.layout, pane.activeTabId) === kind) : undefined
      const fill = filledColumn(arrangementOf(sessionId))
      if (showing) {
        // A pane Fill is hiding comes back instead of closing.
        if (fill !== undefined && String(panes.indexOf(showing)) !== fill) { setArrangement(sessionId, { fill: undefined }); return }
        closePaneOf(sidebar, sessionId, showing.id)
        return
      }
      // Opening a pane shows everything again.
      if (arrangementOf(sessionId).fill !== undefined) setArrangement(sessionId, { fill: undefined })
      let target
      if (!s.layout.expanded || panes.length === 0) {
        // Opening from closed: start clean with a single pane.
        for (const pane of panes.slice(1)) for (const tabId of [...pane.tabs]) closeTabIn(sidebar, sessionId, s.actions, tabId)
        const first = dockPanesOf(surfaceOf(sidebar, sessionId).layout)[0]
        target = first && first.id
        s.actions.setExpanded(sessionId, true)
      } else if (panes.length === 1) {
        const only = panes[0]
        const onlyKind = kindOfTab(s.layout, only.activeTabId)
        if (onlyKind === 'guide' || onlyKind === undefined) target = only.id
        else {
          let created
          s.actions.splitPane(sessionId, only.id, id => { created = id })
          target = created || only.id
        }
      } else {
        target = panes[panes.length - 1].id
      }
      sidebar.openTab(kind, target ? { paneId: target } : undefined)
      if (target) keepOnly(sidebar, sessionId, target, kind)
    }

    // Two docked panes are laid out side by side by Harness (columns 0 and 1 of its grid). These rules
    // draw them top and bottom instead (unless the Session chose side by side), in either order, at the
    // split's sizes, with a draggable bar between them; and show one pane alone when it fills the
    // sidebar (Fill) or the window (expand). The grid carries the choice as data-hs-side / -swap /
    // -fill / -solo attributes.
    const TWO = '[class*="_tabLayout_"]:has(> [data-dockkit-column="1"])'
    const COL0 = '[data-dockkit-column="0"]'
    const COL1 = '[data-dockkit-column="1"]'
    const DIVIDER = '[data-dockkit-divider]'
    const FULLSCREEN_PANEL = '[data-sidebar-right-panel="fullscreen"] '
    // macOS window buttons float over the panel's top-left corner while it fills the window.
    const UNDER_LIGHTS = '[data-platform="darwin"]:not([data-fullscreen]) ' + FULLSCREEN_PANEL
    /** Selectors for a two-pane grid showing only `column`, each followed by `rest`. */
    const alone = (column, rest = '') => [TWO + '[data-hs-fill="' + column + '"]' + rest, FULLSCREEN_PANEL + TWO + '[data-hs-solo="' + column + '"]' + rest]
    const STACKED = TWO + ':not([data-hs-side])'
    const STACK_CSS = `
      ${STACKED} {
        grid-template-columns: minmax(0, 1fr) !important;
        grid-template-rows: minmax(0, var(--hs-first, 1fr)) 8px minmax(0, var(--hs-second, 1fr)) !important;
      }
      ${STACKED} > ${COL0}, ${STACKED}[data-hs-swap] > ${COL1} { grid-area: 1 / 1 !important; }
      ${STACKED} > ${COL1}, ${STACKED}[data-hs-swap] > ${COL0} { grid-area: 3 / 1 !important; }
      ${STACKED} > ${DIVIDER} { grid-area: 2 / 1 !important; width: auto !important; height: 8px !important; cursor: row-resize !important; }
      ${STACKED}:not([data-hs-swap]):not([data-hs-solo]):not([data-hs-fill]) > ${COL0}, ${STACKED}[data-hs-swap]:not([data-hs-solo]):not([data-hs-fill]) > ${COL1} { padding-bottom: 0 !important; }
      ${STACKED}:not([data-hs-swap]):not([data-hs-solo]):not([data-hs-fill]) > ${COL1}, ${STACKED}[data-hs-swap]:not([data-hs-solo]):not([data-hs-fill]) > ${COL0} { padding-top: 0 !important; }
      ${TWO}[data-hs-side][data-hs-swap] { grid-template-columns: minmax(0, var(--hs-first, 1fr)) 0px minmax(0, var(--hs-second, 1fr)) !important; }
      ${TWO}[data-hs-side][data-hs-swap] > ${COL0} { grid-column: 3 !important; }
      ${TWO}[data-hs-side][data-hs-swap] > ${COL1} { grid-column: 1 !important; }
      ${[...alone(0, ' > ' + COL1), ...alone(1, ' > ' + COL0), ...alone(0, ' > ' + DIVIDER), ...alone(1, ' > ' + DIVIDER)].join(', ')} { display: none !important; }
      ${[...alone(0, ':not([data-hs-side]) > [data-dockkit-column]'), ...alone(1, ':not([data-hs-side]) > [data-dockkit-column]')].join(', ')} { grid-row: 1 / -1 !important; }
      ${[...alone(0, '[data-hs-side] > [data-dockkit-column]'), ...alone(1, '[data-hs-side] > [data-dockkit-column]')].join(', ')} { grid-column: 1 / -1 !important; }
      ${UNDER_LIGHTS}${TWO}[data-hs-swap]:not([data-hs-fill="0"]):not([data-hs-solo="0"]) > ${COL1},
      ${UNDER_LIGHTS}${TWO}[data-hs-fill="1"] > ${COL1}, ${UNDER_LIGHTS}${TWO}[data-hs-solo="1"] > ${COL1} { --dsh-dockkit-strip-inline-start: 88px; }
      ${UNDER_LIGHTS}${TWO}[data-hs-swap]:not([data-hs-fill="0"]):not([data-hs-solo="0"]) > ${COL0} { --dsh-dockkit-strip-inline-start: 10px; }
      [data-studio-pane-expand] .hs-exit, [data-sidebar-right-panel="fullscreen"] [data-studio-pane-expand] .hs-enter { display: none; }
      [data-sidebar-right-panel="fullscreen"] [data-studio-pane-expand] .hs-exit { display: inline; }
      [data-studio-empty] :is([class$="_start"], [class*="_start "]) { visibility: hidden !important; }
    `

    /** The right sidebar's pane grid on screen (Harness keeps one per mounted Session). */
    const visibleLayout = () => [...document.querySelectorAll('[class*="_tabLayout_"]')].find(grid => grid.getBoundingClientRect().width > 0)

    function setDataAttr(element, name, value) {
      if (value === undefined || value === false) { if (element.hasAttribute(name)) element.removeAttribute(name); return }
      const text = value === true ? '' : String(value)
      if (element.getAttribute(name) !== text) element.setAttribute(name, text)
    }

    /** Mirror the split's sizes onto the stacked rows, and turn the divider into a vertical resize. */
    function watchStack(sidebar, getSessionId) {
      const style = document.createElement('style')
      style.id = 'harness-studio-stack'
      style.textContent = STACK_CSS + PLACE_CSS
      document.head.append(style)
      let drag = null
      const placeHandle = watchPlaceHandle(getSessionId)
      const sync = () => {
        // While dragging, the pointer owns the sizes; the store catches up on release.
        if (drag) return
        const sessionId = getSessionId()
        if (sessionId) separateMixedPane(sidebar, sessionId)
        syncFrame(sessionId)
        placeHandle.position()
        const grid = visibleLayout()
        if (!grid) return
        const two = grid.querySelector(':scope > ' + COL1) !== null
        const arrangement = sessionId ? arrangementOf(sessionId) : { side: false, swap: false, fill: undefined }
        // A filled column means nothing once one pane is left.
        if (!two && filledColumn(arrangement) !== undefined) arrangement.fill = undefined
        setDataAttr(grid, 'data-hs-side', two && arrangement.side)
        setDataAttr(grid, 'data-hs-swap', two && arrangement.swap)
        setDataAttr(grid, 'data-hs-fill', two ? filledColumn(arrangement) : undefined)
        const s = sessionId && surfaceOf(sidebar, sessionId)
        const split = s && Object.values(s.layout.nodes).find(n => n.kind === 'split')
        const sizes = split ? split.sizes : [0.5, 0.5]
        const [first, second] = arrangement.swap ? [sizes[1], sizes[0]] : sizes
        grid.style.setProperty('--hs-first', first + 'fr')
        grid.style.setProperty('--hs-second', second + 'fr')
      }
      const DIVIDER_PX = 8
      // Harness keeps each docked pane at 20% or more and applies that when the size is saved, so the
      // drag stops there too instead of snapping back on release.
      const MIN_SHARE = 0.2
      const onDown = (event) => {
        if (event.button !== 0) return
        const divider = event.target instanceof Element ? event.target.closest('[data-dockkit-divider]') : null
        const grid = divider && divider.closest('[class*="_tabLayout_"]')
        if (!divider || !grid || !grid.querySelector(':scope > ' + COL1)) return
        const side = grid.hasAttribute('data-hs-side')
        const swapped = grid.hasAttribute('data-hs-swap')
        // Harness's own drag resizes side-by-side panes in its own order; stacked or swapped panes
        // are resized here.
        if (side && !swapped) return
        event.preventDefault()
        event.stopPropagation()
        // A transparent layer over the whole window for the length of the drag: the Browser pane's
        // page would otherwise swallow pointer moves (and the release) whenever the pointer crosses it,
        // and text under the pointer would get selected.
        const shield = document.createElement('div')
        shield.setAttribute('data-hs-stack-shield', '')
        shield.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent;cursor:' + (side ? 'col-resize' : 'row-resize')
        document.body.append(shield)
        document.documentElement.style.userSelect = 'none'
        window.getSelection()?.removeAllRanges()
        drag = { grid, shield, side, swapped, splitId: divider.getAttribute('data-dockkit-divider').split(':')[0] }
      }
      const onMove = (event) => {
        if (!drag) return
        event.preventDefault()
        const rect = drag.grid.getBoundingClientRect()
        // The divider's centre follows the pointer: the two panes share the length minus the divider
        // (stacked: an 8px bar; side by side: Harness's zero-width track).
        const along = drag.side
          ? (event.clientX - rect.left) / rect.width
          : (event.clientY - rect.top - DIVIDER_PX / 2) / (rect.height - DIVIDER_PX)
        const first = Math.min(1 - MIN_SHARE, Math.max(MIN_SHARE, along))
        drag.grid.style.setProperty('--hs-first', first + 'fr')
        drag.grid.style.setProperty('--hs-second', (1 - first) + 'fr')
        // The split stores sizes in its own order; a swapped grid shows the second pane first.
        drag.sizes = drag.swapped ? [1 - first, first] : [first, 1 - first]
      }
      const onUp = () => {
        if (!drag) return
        const { shield, sizes, splitId } = drag
        drag = null
        shield.remove()
        document.documentElement.style.userSelect = ''
        const sessionId = getSessionId()
        const s = sessionId && surfaceOf(sidebar, sessionId)
        if (s && sizes) s.actions.resizeSplit(sessionId, splitId, sizes)
      }
      window.addEventListener('pointerdown', onDown, true)
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onUp, true)
      window.addEventListener('blur', onUp)
      const timer = setInterval(sync, 500)
      arrangementListeners.add(sync)
      const unwatchDock = watchDock(sync)
      // The panel opening, closing or going fullscreen changes the window grid at once.
      const panelObserver = new MutationObserver(sync)
      panelObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-sidebar-right-open', 'data-sidebar-right-panel'] })
      window.addEventListener('resize', sync)
      sync()
      return () => {
        style.remove()
        clearInterval(timer)
        arrangementListeners.delete(sync)
        unwatchDock()
        panelObserver.disconnect()
        window.removeEventListener('resize', sync)
        placeHandle.dispose()
        const frame = document.querySelector(APP_FRAME)
        if (frame) for (const name of ['data-hs-place', 'data-hs-chat-hidden']) frame.removeAttribute(name)
        const grid = visibleLayout()
        if (grid) for (const name of ['data-hs-side', 'data-hs-swap', 'data-hs-fill']) grid.removeAttribute(name)
        window.removeEventListener('pointerdown', onDown, true)
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('pointercancel', onUp, true)
        window.removeEventListener('blur', onUp)
        onUp()
      }
    }

    // ---- the agent's browser tools: run Host commands in this Session's Browser pane ----------------
    // The Host's browser_* tools queue commands on the local helper (browser-bridge.js). The toolbar of
    // the Session on screen long-polls for them, runs each in that Session's own Browser pane — opening
    // one when needed — and posts the result back. Clicks and typing are real input events sent to the page.
    //
    // Element numbers: the number → element map lives in a closure inside the page, reached only through
    // one randomly named, non-enumerable, non-writable, non-configurable window property. Nothing is
    // written into the page's DOM, so the page cannot move a number onto another element between a read
    // and a click. Every read starts a new generation that the click or typing must name, so a page that
    // re-reads to renumber elements only makes the agent read again; and before acting, the element must
    // still be connected and match what the read saw (tag, kind, accessible name).
    // Residual risk: this runs in the page's own JavaScript world (a <webview> offers no isolated world to
    // the renderer), so a page that patched built-ins before the script ran can still lie about where an
    // element is or what it is called. The checks stop DOM tampering, not a page rewriting the runtime.
    const PAGE_KEY = '__hs' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('')
    const PAGE_TOOLS = `(() => {
      const KEY = ${JSON.stringify(PAGE_KEY)}
      if (Object.getOwnPropertyDescriptor(window, KEY)) return window[KEY]
      const MAX_TEXT = 6000, MAX_ELEMENTS = 150
      const visible = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const c = getComputedStyle(el); return c.visibility !== 'hidden' && c.display !== 'none' && c.opacity !== '0' }
      const clean = t => (t || '').replace(/\\s+/g, ' ').trim()
      const nameOf = el => {
        const label = el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')?.innerText)
        return clean(label || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || (el.tagName === 'INPUT' && /button|submit|reset/.test(el.type) ? el.value : '')).slice(0, 100)
      }
      const kindOf = el => {
        const role = el.getAttribute('role'); const tag = el.tagName.toLowerCase()
        if (tag === 'a') return 'link'
        if (tag === 'input') return 'input[' + (el.type || 'text') + ']'
        if (tag === 'select') return 'select'
        if (tag === 'textarea') return 'textarea'
        if (tag === 'button' || tag === 'summary') return 'button'
        if (role) return role
        if (el.isContentEditable) return 'editable'
        return tag
      }
      const selector = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=switch], ' +
        '[role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=option], [role=combobox], [role=treeitem], [role=slider], [role=spinbutton], [role=searchbox], [role=textbox], ' +
        '[contenteditable=""], [contenteditable=true], [onclick], [tabindex]:not([tabindex="-1"])'
      // Outermost matches only: a focusable wrapper inside a listed control would list the same thing twice.
      const CONTROLS = 'a[href], button, [role=button], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=option], [role=tab], [role=link]'
      // Open menus and dialogs first, then what is on screen, then the rest: pop-up menus usually sit at
      // the end of the page and would otherwise fall past the element limit.
      const rank = el => {
        if (el.closest('[role=menu], [role=menubar], [role=listbox], [role=dialog], [role=alertdialog], dialog[open]')) return 0
        const r = el.getBoundingClientRect()
        return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth ? 1 : 2
      }
      let generation = 0
      let refs = new Map()
      const read = () => {
        const all = [...document.querySelectorAll(selector)].filter(el => !el.parentElement?.closest(CONTROLS)).filter(visible)
          .map((el, i) => ({ el, i, r: rank(el) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.el)
        const next = new Map()
        const elements = []
        for (const el of all.slice(0, MAX_ELEMENTS)) {
          const ref = elements.length + 1
          const item = { ref, kind: kindOf(el), name: nameOf(el) }
          next.set(ref, { el, tag: el.tagName, kind: item.kind, name: item.name })
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') item.value = el.type === 'password' ? (el.value ? '••••' : '') : String(el.value).slice(0, 100)
          if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) item.value = el.checked ? 'checked' : 'unchecked'
          if (el.tagName === 'A' && el.getAttribute('href')) item.href = el.getAttribute('href').slice(0, 200)
          if (el.getAttribute('aria-checked') !== null) item.value = el.getAttribute('aria-checked') === 'true' ? 'checked' : 'unchecked'
          if (el.getAttribute('aria-selected') === 'true') item.value = 'selected'
          if (el.disabled || el.getAttribute('aria-disabled') === 'true') item.disabled = true
          elements.push(item)
        }
        refs = next
        generation++
        let text = (document.body ? document.body.innerText : '').split('\\n').map(l => l.replace(/\\s+/g, ' ').trim()).filter(Boolean).join('\\n')
        if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '\\n… [text truncated]'
        return { url: location.href, title: document.title, text, elements, moreElements: Math.max(0, all.length - MAX_ELEMENTS), generation }
      }
      // The element behind a number from the given read, or why it can't be used.
      const resolve = (gen, ref) => {
        if (gen !== generation) return { error: 'stale' }
        const entry = refs.get(Number(ref))
        if (!entry) return { error: 'unknown' }
        const el = entry.el
        if (!el.isConnected || el.tagName !== entry.tag || kindOf(el) !== entry.kind || nameOf(el) !== entry.name) return { error: 'changed' }
        return { el }
      }
      const point = (gen, ref) => {
        const found = resolve(gen, ref)
        if (found.error) return found
        found.el.scrollIntoView({ block: 'center', inline: 'center' })
        const r = found.el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: innerWidth }
      }
      const focus = (gen, ref) => {
        const found = resolve(gen, ref)
        if (found.error) return found
        const el = found.el
        el.scrollIntoView({ block: 'center' })
        el.focus()
        if (typeof el.select === 'function') el.select()
        else if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r) }
        return { ok: document.activeElement === el || el.contains(document.activeElement) }
      }
      const tools = Object.freeze({ read, point, focus })
      Object.defineProperty(window, KEY, { value: tools, enumerable: false, writable: false, configurable: false })
      return tools
    })()`
    /** Run one of the page tools (installing them first when this document lacks them). */
    const pageTool = (webview, call) => webview.executeJavaScript(`(() => { const tools = ${PAGE_TOOLS}; return tools.${call} })()`)
    /** webview → generation of the agent's latest read in it. */
    const readGenerations = new WeakMap()

    /** Sleep `ms`, or less when `signal` aborts. */
    const sleep = (ms, signal) => new Promise(resolve => {
      if (signal?.aborted) { resolve(); return }
      const timer = setTimeout(done, ms)
      function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
      signal?.addEventListener('abort', done, { once: true })
    })
    const checkAborted = signal => { if (signal?.aborted) throw new Error('Cancelled: the Harness window stopped serving this session') }
    /** webview → recent console messages (the agent's browser_console). */
    const consoleLogs = new WeakMap()

    function watchConsole(webview) {
      if (consoleLogs.has(webview)) return
      const log = []
      consoleLogs.set(webview, log)
      webview.addEventListener('console-message', (event) => {
        const text = typeof event.message === 'string' ? event.message : ''
        if (!text || text.startsWith(CONSOLE_PREFIX)) return
        const level = typeof event.level === 'string' ? event.level : (['verbose', 'info', 'warning', 'error'][event.level] ?? 'info')
        log.push({ level, text: text.slice(0, 1000), source: event.sourceId ? `${event.sourceId.split('/').pop()}:${event.line}` : undefined })
        if (log.length > 100) log.shift()
      })
      webview.addEventListener('did-navigate', () => { log.length = 0 })
    }

    /** Wait until the webview has stopped loading (or `ms` passes, or the command is cancelled). */
    async function settled(webview, ms = 20000, signal) {
      await sleep(250, signal)
      const end = Date.now() + ms
      while (webview.isLoading() && Date.now() < end && !signal?.aborted) await sleep(100, signal)
      checkAborted(signal)
    }

    /**
     * Browser panes on screen that belong to `sessionId`: none unless that Session is the one the right
     * sidebar shows, and then only panes whose tab is in that Session's layout.
     */
    function sessionBrowserPanes(sidebar, sessionId) {
      const mounted = sidebar.mounted && typeof sidebar.mounted.getSnapshot === 'function' ? sidebar.mounted.getSnapshot() : undefined
      if (mounted !== sessionId) return []
      const s = surfaceOf(sidebar, sessionId)
      return findBrowserPanes().filter(pane => !s || s.layout.tabs[pane.key] !== undefined)
    }

    /** This Session's Browser pane webview, opening a Browser pane first if none is showing. */
    async function browserWebview(sidebar, sessionId, { create = false, signal } = {}) {
      const mounted = sidebar.mounted && typeof sidebar.mounted.getSnapshot === 'function' ? sidebar.mounted.getSnapshot() : undefined
      if (mounted !== sessionId) throw new Error('This session is not the one on screen in its Harness window, so its Browser pane is not available. Ask the user to switch to it.')
      // A Browser pane Fill is hiding has no size, so it can't be driven; show it first.
      if (unhideKind(sidebar, sessionId, 'browser')) await sleep(100, signal)
      let pane = sessionBrowserPanes(sidebar, sessionId)[0]
      if (!pane && create) {
        if (shownKinds(sidebar, sessionId).includes('browser')) sidebar.openTab('browser', { params: {}, revealIfOpened: true })
        else togglePane(sidebar, sessionId, 'browser')
        notifyDock()
        for (let i = 0; i < 50 && !(pane = sessionBrowserPanes(sidebar, sessionId)[0]); i++) { checkAborted(signal); await sleep(100, signal) }
      }
      checkAborted(signal)
      if (!pane) throw new Error('This session has no Browser pane open. Open a page with browser_open first.')
      const frame = frameOf(pane.viewport)
      if (frame && frame.tagName !== 'WEBVIEW') throw new Error('Browser control works in the Harness desktop app only.')
      if (frame) watchConsole(frame)
      return { pane, webview: frame }
    }

    const where = webview => ({ url: webview.getURL(), title: webview.getTitle() })

    /** Explain a refused element number from the page tools. */
    function refError(ref, reason) {
      if (reason === 'stale') return `The page was read again or reloaded since the numbers you used; call browser_read again for current numbers.`
      if (reason === 'changed') return `Element [${ref}] changed since browser_read (removed, replaced or renamed); call browser_read again.`
      return `No element [${ref}] on the page; call browser_read again for current numbers.`
    }

    /**
     * Element centre, scrolled into view, in the coordinates input events use. Those are the pane's
     * on-screen units: under the theme's whole-app zoom the pane is drawn smaller than the page's own
     * CSS width, so page coordinates are scaled by on-screen width ÷ page width.
     * Throws for an unknown, stale or changed number.
     */
    async function elementPoint(webview, ref) {
      const point = await pageTool(webview, `point(${Number(readGenerations.get(webview))}, ${Number(ref)})`)
      if (!point || point.error || typeof point.x !== 'number' || typeof point.y !== 'number') throw new Error(refError(ref, point && point.error))
      const zoom = Number(document.documentElement.style.zoom) || 1
      const scale = point.width > 0 ? (webview.getBoundingClientRect().width * zoom) / point.width : 1
      return { x: Math.round(point.x * scale), y: Math.round(point.y * scale) }
    }

    const BROWSER_OPS = new Set(['open', 'back', 'forward', 'reload', 'read', 'click', 'type', 'console'])

    async function runBrowserCommand(sidebar, sessionId, command, signal) {
      const op = command.op
      const args = command.args !== null && typeof command.args === 'object' ? command.args : {}
      if (!BROWSER_OPS.has(op)) throw new Error(`Unknown browser command ${String(op).slice(0, 40)}`)
      checkAborted(signal)
      if (op === 'open') {
        const url = typeof args.url === 'string' ? normalizeUrl(args.url) : undefined
        if (url === undefined) throw new Error('url must be an absolute http(s) URL')
        const { pane, webview } = await browserWebview(sidebar, sessionId, { create: true, signal })
        if (webview) {
          let error
          await Promise.race([webview.loadURL(url).catch(e => { error = String(e.message ?? e) }), sleep(30000, signal)])
          await settled(webview, 5000, signal)
          return { ...where(webview), error }
        }
        // An empty pane has no page yet: navigate through its address bar, then wait for the page.
        openInAddressBar(pane.viewport, url)
        let frame
        for (let i = 0; i < 100 && !(frame = frameOf(pane.viewport)); i++) { checkAborted(signal); await sleep(100, signal) }
        if (!frame) throw new Error('The Browser pane did not open the page')
        watchConsole(frame)
        await settled(frame, 20000, signal)
        return where(frame)
      }
      const { webview } = await browserWebview(sidebar, sessionId, { signal })
      if (!webview) throw new Error('The Browser pane has no page open. Use browser_open first.')
      if (op === 'back' || op === 'forward' || op === 'reload') {
        if (op === 'back') { if (!webview.canGoBack()) throw new Error('There is no earlier page'); webview.goBack() }
        else if (op === 'forward') { if (!webview.canGoForward()) throw new Error('There is no later page'); webview.goForward() }
        else webview.reload()
        await settled(webview, 20000, signal)
        return where(webview)
      }
      if (op === 'read') {
        const page = await pageTool(webview, 'read()')
        if (!page || typeof page !== 'object') throw new Error('Could not read this page')
        readGenerations.set(webview, page.generation)
        const { generation, ...rest } = page
        return rest
      }
      if (op === 'click') {
        const { x, y } = await elementPoint(webview, args.ref)
        checkAborted(signal)
        webview.focus()
        webview.sendInputEvent({ type: 'mouseMove', x, y })
        webview.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
        webview.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
        await settled(webview, 20000, signal)
        return where(webview)
      }
      if (op === 'type') {
        if (typeof args.text !== 'string') throw new Error('text must be a string')
        const focused = await pageTool(webview, `focus(${Number(readGenerations.get(webview))}, ${Number(args.ref)})`)
        if (!focused || focused.error) throw new Error(refError(args.ref, focused && focused.error))
        if (!focused.ok) throw new Error(`Element [${args.ref}] cannot take text; call browser_read again for current numbers.`)
        checkAborted(signal)
        webview.focus()
        await webview.insertText(args.text)
        if (args.submit === true) {
          webview.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
          webview.sendInputEvent({ type: 'char', keyCode: '\r' })
          webview.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
        }
        await settled(webview, 20000, signal)
        return where(webview)
      }
      return { messages: (consoleLogs.get(webview) ?? []).slice(-50) }
    }

    /** Whether a header is laid out on screen (its Session is the one shown in this window). */
    const headerOnScreen = anchor => anchor.current?.isConnected === true && anchor.current.getClientRects().length > 0

    /**
     * Long-poll the helper for this Session's browser commands while its header is on screen. A hidden
     * header does not poll, so the Host can tell the agent the session is not open. Failures back off
     * (1 s doubling to 30 s); a failing helper is forgotten so the next round links again.
     */
    function useBrowserAgent(sessionId, sidebar, anchor) {
      useEffect(() => {
        if (!sessionId) return undefined
        const controller = new AbortController()
        const { signal } = controller
        ;(async () => {
          let failures = 0
          while (!signal.aborted) {
            if (!headerOnScreen(anchor)) { await sleep(1000, signal); continue }
            const link = await currentHelper()
            if (signal.aborted) break
            if (!link) { await sleep(5000, signal); continue }
            const started = Date.now()
            let command
            try {
              const response = await fetch(`${link.base}/browser/next?session=${encodeURIComponent(sessionId)}`, { cache: 'no-store', signal, headers: helperHeaders(link) })
              if (!response.ok) throw new Error('HTTP ' + response.status)
              const body = await response.json()
              command = body && typeof body === 'object' ? body.command : undefined
              failures = 0
            } catch {
              if (signal.aborted) break
              forgetHelper(link) // wrong key, or the port stopped answering: link again next round
              failures++
              await sleep(Math.min(30000, 1000 * 2 ** Math.min(failures - 1, 5)), signal)
              continue
            }
            if (command === null || typeof command !== 'object' || typeof command.id !== 'string') {
              // A poll normally holds 25 s; an immediate empty answer must not turn into a busy loop.
              if (Date.now() - started < 1000) await sleep(1000, signal)
              continue
            }
            const outcome = await runBrowserCommand(sidebar, sessionId, command, signal)
              .then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error?.message ?? error) }))
            // Report even when this header is going away, so the agent is not left waiting.
            try {
              await fetch(`${link.base}/browser/result`, {
                method: 'POST', headers: helperHeaders(link, { 'content-type': 'application/json' }),
                body: JSON.stringify({ session: sessionId, id: command.id, ...outcome }),
              })
            } catch { forgetHelper(link) }
          }
        })()
        return () => controller.abort()
      }, [sessionId, sidebar])
    }

    // ---- Elements picked in Chrome (Harness Studio Chrome bridge) ---------------------------------------
    // The extension's picker sends the element and a cropped screenshot to the local bridge server; the
    // header of the session on screen collects it and treats it like a Browser pane pick: the agent gets
    // the record, and the message box gets the reference and the picture — only once the agent has it.
    const CHROME_BRIDGE = 'http://127.0.0.1:47630'
    const PNG_PREFIX = 'data:image/png;base64,'
    const MAX_CHROME_IMAGE_CHARS = 8 * 1024 * 1024 // about 6 MB of PNG

    /** A bounded, well-formed PNG data URL as a File, or undefined. */
    function pngFromDataUrl(url) {
      if (typeof url !== 'string' || url.length > MAX_CHROME_IMAGE_CHARS || !url.startsWith(PNG_PREFIX)) return undefined
      const data = url.slice(PNG_PREFIX.length)
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return undefined
      let binary
      try { binary = atob(data) } catch { return undefined }
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      if (!signature.every((b, i) => bytes[i] === b)) return undefined
      return new File([bytes], 'chrome-selection.png', { type: 'image/png' })
    }

    function useChromeSelections(sessionId, inputActions, sendSelection, anchor, onNote) {
      const latest = useRef({ inputActions, sendSelection, onNote })
      latest.current = { inputActions, sendSelection, onNote }
      useEffect(() => {
        if (!sessionId) return undefined
        const controller = new AbortController()
        const { signal } = controller
        // Only the session you are looking at collects: a hidden header waits instead of polling.
        const onScreen = () => document.visibilityState === 'visible' && headerOnScreen(anchor)
        ;(async () => {
          while (!signal.aborted) {
            try {
              if (!onScreen()) { await sleep(1000, signal); continue }
              const response = await fetch(CHROME_BRIDGE + '/selections/next', { cache: 'no-store', signal })
              if (response.status !== 200) { await sleep(response.status === 204 ? 250 : 5000, signal); continue }
              const body = await response.json()
              const { inputActions: input, sendSelection: send, onNote: note } = latest.current
              const selection = normalizeSelection(body && body.selection)
              if (selection === undefined) { note('Chrome sent an element Harness could not read'); continue }
              const failure = await send(selection)
              if (failure !== null) { note('Chrome pick not sent: ' + failure); continue }
              input?.insertText(composerReference(selection), input.captureInsertion())
              if (body.image !== undefined && body.image !== null) {
                const file = pngFromDataUrl(body.image)
                if (file) attachImageToComposer(file)
                else note('The Chrome pick’s screenshot was not a PNG and was left out')
              }
            } catch {
              // No bridge running (the Chrome extension connector is off) or a dropped poll: retry slowly.
              if (!signal.aborted) await sleep(5000, signal)
            }
          }
        })()
        return () => controller.abort()
      }, [sessionId])
    }

    /** Whether the conversation on screen is a new Session's blank start view (Harness marks it data-phase="hero"). */
    const blankViewOnScreen = () => [...document.querySelectorAll('[data-phase]')].some(root => root.getAttribute('data-phase') === 'hero' && root.getBoundingClientRect().width > 0)

    /** The pane icons in a new Session's header corner; nothing once its conversation has started. */
    function BlankSessionToolbar(props) {
      const [blank, setBlank] = useState(blankViewOnScreen)
      useEffect(() => {
        const check = () => setBlank(blankViewOnScreen())
        const observer = new MutationObserver(check)
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-phase'] })
        check()
        return () => observer.disconnect()
      }, [])
      return blank ? h(PaneToolbar, props) : null
    }

    function PaneToolbar({ sessionId, sidebar, inputActions, sendSelection, clearSelection }) {
      useChangesStyles() // the shared sheet removes the mouse-click focus square
      const chromeAnchor = useRef(null)
      useBrowserAgent(sessionId, sidebar, chromeAnchor)
      const [note, setNote] = useState(undefined)
      const later = useOneTimer()
      const showNote = useCallback((text) => { setNote(text); later(() => setNote(undefined), 4000) }, [later])
      useChromeSelections(sessionId, inputActions, sendSelection, chromeAnchor, showNote)
      const read = () => shownKinds(sidebar, sessionId).join(',')
      const [shown, setShown] = useState(read)
      useEffect(() => {
        const update = () => setShown(read())
        arrangementListeners.add(update)
        return () => { arrangementListeners.delete(update) }
      }, [sidebar, sessionId])
      // Re-read on tab changes and on a light poll (Harness's own controls change the layout too).
      useEffect(() => {
        let last
        const refresh = () => {
          // Never leave the sidebar open on nothing but Harness's start page.
          const s = surfaceOf(sidebar, sessionId)
          if (s && s.layout.expanded) {
            const panes = dockPanesOf(s.layout)
            if (panes.length > 0 && panes.every(pane => pane.tabs.every(tabId => kindOfTab(s.layout, tabId) === 'guide'))) s.actions.setExpanded(sessionId, false)
          }
          const next = read()
          // The sidebar opened, closed or switched panes: the Browser pane extras look again.
          if (next !== last) { last = next; notifyDock() }
          setShown(next)
        }
        const unsubscribe = sidebar.openTabs.subscribe(refresh)
        const timer = setInterval(refresh, 300)
        return () => { unsubscribe(); clearInterval(timer) }
      }, [sidebar, sessionId])
      // The stack's sizes and divider follow whichever Session this header belongs to.
      const sessionRef = useRef(sessionId)
      sessionRef.current = sessionId
      useEffect(() => watchStack(sidebar, () => sessionRef.current), [sidebar])

      const open = (kind) => {
        togglePane(sidebar, sessionId, kind)
        // A timer, not an animation frame: frames pause while the window is in the background.
        setTimeout(() => setShown(read()), 60)
      }
      const lit = kind => shown.split(',').includes(kind)

      return h('div', { ref: chromeAnchor, style: toolbarStyles.bar, role: 'toolbar', 'aria-label': 'Side panes', 'data-testid': 'harness-studio-pane-toolbar' },
        // A page can send anything; whatever goes wrong in the extras must not take the pane icons with it.
        h(SafeBoundary, { label: 'Browser pane extras' }, h(BrowserExtras, { sessionId, inputActions, sendSelection, clearSelection })),
        note ? h('span', { role: 'status', style: toolbarStyles.note, title: note }, note) : null,
        PANE_BUTTONS.flatMap(button => [h('button', {
          key: button.kind, type: 'button', title: button.label, 'aria-label': button.label, 'aria-pressed': lit(button.kind),
          style: { ...toolbarStyles.button, ...(lit(button.kind) ? toolbarStyles.active : null) },
          onClick: () => open(button.kind),
        }, h(Icon, { d: button.d })), button.divider ? h('span', { key: button.kind + '-divider', style: toolbarStyles.divider }) : null]).filter(Boolean))
    }

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight', 'connection', 'remote', 'remote.commands', 'remote.workspaceFiles'],
      apply(ctx) {
        // The helper link asks this window's Host for the helper over its connection.
        connection = ctx.connection
        helperLink = undefined
        ctx.effect(() => () => { if (connection === ctx.connection) { connection = undefined; helperLink = undefined } }, 'helper link')

        ctx.effect(() => watchBrowserTabs(ctx.sidebarRight), 'browser tab strip')
        ctx.effect(() => watchPaneClose(ctx.sidebarRight), 'pane close button')
        ctx.effect(() => { window.addEventListener('keydown', blockSplitShortcut, true); return () => window.removeEventListener('keydown', blockSplitShortcut, true) }, 'no split shortcut')
        ctx.effect(() => { window.addEventListener('keydown', enterSavesSettings); return () => window.removeEventListener('keydown', enterSavesSettings) }, 'Enter saves plugin settings')
        ctx.effect(() => { window.addEventListener('click', confirmSettingsSaves, true); return () => window.removeEventListener('click', confirmSettingsSaves, true) }, 'confirm plugin settings saves')
        ctx.effect(hideSplitButton, 'no split button')
        ctx.effect(clickOnlySwitcher, 'subagents switcher opens on click')

        ctx.effect(() => ctx.sidebarRightTabs.register({ id: CHANGES_TAB_ID, kind: CHANGES_KIND, priority: 'extension', title: () => 'Changes', keepMounted: false }), 'changes pane type')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: CHANGES_TAB_ID, inject: () => ({}) }, ChangesPane)), 'changes pane body')
        ctx.effect(() => ctx.sidebarRightTabs.register({ id: DETAILS_TAB_ID, kind: DETAILS_KIND, priority: 'extension', title: () => 'Session', keepMounted: false }), 'details pane type')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: DETAILS_TAB_ID, inject: () => ({ sidebar: ctx.sidebarRight }) }, DetailsPane)), 'details pane body')

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: FILES_TAB_ID, kind: FILES_KIND, priority: 'extension', title: () => 'Files', keepMounted: true,
        }), 'files pane type')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab', key: FILES_TAB_ID,
            inject: (sessionId) => ({
              list: (path, signal) => ctx.remote.workspaceFiles.list(sessionId, path, signal),
              read: (path, range, signal) => ctx.remote.workspaceFiles.read(sessionId, path, range, signal),
            }),
          },
          FilesPane,
        )), 'files pane body')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab.title', key: FILES_TAB_ID }, FilesTitle)), 'files pane title with the tree button')

        ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
          {
            name: 'conversation.session.header.utilities', id: 'harness-studio-pane-toolbar',
            // Ahead of Harness's own utilities (open-in-app sits at -10).
            order: -20,
            inject: (sessionId) => ({
              sidebar: ctx.sidebarRight,
              sendSelection: selection => runSelectCommand(ctx, sessionId, JSON.stringify(selection)),
              clearSelection: () => runSelectCommand(ctx, sessionId, 'clear'),
            }),
          },
          PaneToolbar,
        )), 'pane toolbar in the conversation header')
        // A new Session's header (before its first message) draws only its far-right corner, where
        // Harness puts an "Open right sidebar" button. The corner shows the same pane icons there
        // instead, and nothing once the conversation has started (the utilities carry them then).
        ctx.effect(() => ctx.slots.inject('conversation.session.header.corner', () => ctx.slots.register(
          {
            name: 'conversation.session.header.corner', priority: -10,
            inject: (sessionId) => ({
              sidebar: ctx.sidebarRight,
              sendSelection: selection => runSelectCommand(ctx, sessionId, JSON.stringify(selection)),
              clearSelection: () => runSelectCommand(ctx, sessionId, 'clear'),
            }),
          },
          BlankSessionToolbar,
        )), 'pane toolbar in a new session\'s header')
      },
    }
  },
})
