// Client half of Watch (hand-written loader format, no build step): an eye button in the session header,
// beside Harness's Schedule clock. It opens this session's watches — what each checks, its latest result,
// when it last sent a notice, and how many notices it has left — with a remove button per row, Remove all,
// and a small form to add a watch without asking the agent. It talks to the Host half through the
// `harnessStudioWatch/call` Remote method (index.js).

window.__ModuleLoader__.load({
  id: '@harness-studio/watch',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } = React

    const ENDPOINT = 'harnessStudioWatch/call'
    const STYLE_ID = 'harness-studio-watch-style'
    let connection
    async function call(request) {
      if (!connection?.rpc) throw new Error('Harness did not provide its connection. Reload Harness.')
      const result = await connection.rpc.call('/api', ENDPOINT, { args: { request } })
      if (!result?.ok) throw new Error(result?.error?.message ?? 'The Watch service did not answer. Restart Harness Studio.')
      return result.value
    }

    // ---- each session's watches, shared by every view of that session --------------------------------
    const cache = new Map()
    const listeners = new Set()
    const notify = () => { for (const listener of listeners) listener() }
    const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
    function load(sessionId) {
      const entry = cache.get(sessionId)
      if (entry?.loading) return Promise.resolve()
      cache.set(sessionId, { watches: entry?.watches ?? [], loading: true, error: entry?.error })
      return call({ action: 'list', sessionId })
        .then(watches => cache.set(sessionId, { watches, loading: false }))
        .catch(error => cache.set(sessionId, { watches: entry?.watches ?? [], loading: false, error: error.message }))
        .finally(notify)
    }

    // Theme tokens only; sizes follow Harness's Schedule clock and its list.
    const CSS = `
.hsw-root { position: relative; }
.hsw-trigger { position: relative; display: inline-flex; flex: none; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 28px;
  background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.hsw-trigger:hover, .hsw-trigger:focus-visible, .hsw-trigger[aria-expanded='true'] { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover); }
.hsw-trigger.hsw-on { color: var(--dsw-alias-label-secondary); }
.hsw-count { position: absolute; top: 3px; right: 2px; min-width: 13px; height: 13px; padding: 0 3px; box-sizing: border-box; border-radius: 7px; font-size: 9px; line-height: 13px; font-weight: 600;
  background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); text-align: center; }
.hsw-menu { position: fixed; z-index: 100; box-sizing: border-box; display: flex; flex-direction: column; gap: 1px; width: 360px; max-width: calc(100vw - 32px); max-height: min(480px, calc(100vh - 140px));
  margin: 0; padding: 3px; overflow: auto; border-radius: 16px; background: var(--dsw-specific-menu); backdrop-filter: var(--dsw-menu-backdrop-filter);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1); box-shadow: var(--dsw-elevation-prominent); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 18px; }
.hsw-head { display: flex; align-items: center; gap: 6px; padding: 8px 12px 4px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.hsw-head span { flex: 1; }
.hsw-row { display: flex; align-items: start; gap: 6px; box-sizing: border-box; width: 100%; padding: 9px 12px; border-radius: 10px; }
.hsw-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.hsw-body { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
.hsw-title { overflow-wrap: anywhere; }
.hsw-meta { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 15px; overflow-wrap: anywhere; }
.hsw-current { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 15px; font-family: var(--dsw-font-mono, ui-monospace, monospace); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 45px; overflow: hidden; }
.hsw-dot { flex: none; width: 6px; height: 6px; margin-top: 6px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); }
.hsw-dot.hsw-up { background: #22a55b; }
.hsw-dot.hsw-down { background: var(--dsw-alias-state-error-primary, #d14343); }
.hsw-icon { position: relative; display: inline-flex; flex: none; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 6px;
  background: none; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.hsw-icon:hover, .hsw-icon:focus-visible { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.hsw-icon:disabled { cursor: wait; opacity: .5; }
.hsw-empty { padding: 10px 12px; color: var(--dsw-alias-label-secondary); }
.hsw-error { padding: 4px 12px 8px; font-size: 12px; color: var(--dsw-alias-label-error, #d14343); overflow-wrap: anywhere; }
.hsw-form { display: flex; flex-direction: column; gap: 6px; margin: 2px 0 0; padding: 8px 12px 10px; border-top: 1px solid var(--dsw-alias-border-l2); }
.hsw-form-row { display: flex; gap: 6px; align-items: center; }
.hsw-input, .hsw-select { box-sizing: border-box; height: 28px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; min-width: 0; }
.hsw-input { flex: 1; }
.hsw-input.hsw-narrow { flex: none; width: 64px; }
.hsw-btn { height: 28px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.hsw-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.hsw-btn:disabled { opacity: .5; cursor: default; }
.hsw-primary { border-color: transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); font-weight: 500; }
.hsw-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.hsw-link { padding: 0; border: 0; background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.hsw-link:hover { color: var(--dsw-alias-label-primary); text-decoration: underline; }
.hsw-note { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 15px; }
`

    const eye = size => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
      h('path', { d: 'M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z' }), h('circle', { cx: 8, cy: 8, r: 2 }))
    const trash = h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
      h('path', { d: 'M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4' }))

    const time = at => (at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '')
    function since(at, now) {
      const s = Math.max(0, Math.round((now - at) / 1000))
      if (s < 60) return `${s}s ago`
      if (s < 3600) return `${Math.round(s / 60)} min ago`
      return time(at)
    }

    function Row({ watch, sessionId, now }) {
      const [removing, setRemoving] = useState(false)
      const [error, setError] = useState('')
      const tone = watch.kind === 'port' ? (watch.current === 'up' ? 'hsw-up' : 'hsw-down') : watch.error ? 'hsw-down' : ''
      const remove = async () => {
        setRemoving(true)
        try {
          await call({ action: 'remove', sessionId, id: watch.id })
        } catch (e) {
          setError(e.message)
          setRemoving(false)
        }
        load(sessionId)
      }
      const notices = watch.lastNoticeAt ? `last notice ${since(watch.lastNoticeAt, now)}` : 'no notice yet'
      const checked = watch.lastCheckAt ? `${watch.kind === 'files' ? 'last change' : 'checked'} ${since(watch.lastCheckAt, now)}` : ''
      return h('div', { className: 'hsw-row', 'data-watch-id': watch.id },
        h('span', { className: `hsw-dot ${tone}` }),
        h('span', { className: 'hsw-body' },
          h('span', { className: 'hsw-title' }, watch.label),
          h('span', { className: 'hsw-meta' }, watch.what, watch.when !== 'change' ? ` · notifies on ${watch.when.replace('_', ' ')}${watch.pattern ? ` /${watch.pattern}/` : ''}` : ''),
          watch.kind === 'command' && watch.current ? h('span', { className: 'hsw-current' }, watch.current) : null,
          h('span', { className: 'hsw-meta' }, [checked, notices, `${watch.wakes} of ${watch.maxWakes} notices used`, watch.createdBy === 'user' ? 'added by you' : ''].filter(Boolean).join(' · ')),
          error ? h('span', { className: 'hsw-error' }, error) : null),
        h('button', { type: 'button', className: 'hsw-icon', 'aria-label': `Remove watch ${watch.label}`, title: 'Remove', disabled: removing, onClick: remove }, trash))
    }

    function AddForm({ sessionId, onDone }) {
      const [kind, setKind] = useState('command')
      const [value, setValue] = useState('')
      const [interval, setIntervalValue] = useState('30')
      const [label, setLabel] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const placeholder = { command: 'git status --porcelain', port: '3000', files: 'src' }[kind]
      const submit = async event => {
        event.preventDefault()
        setBusy(true)
        setError('')
        const spec = { kind, ...label.trim() ? { label: label.trim() } : {} }
        if (kind === 'command') spec.command = value
        if (kind === 'port') spec.port = Number(value)
        if (kind === 'files') spec.paths = value.split(',').map(p => p.trim()).filter(Boolean)
        if (kind !== 'files' && interval.trim()) spec.interval_seconds = Number(interval)
        try {
          await call({ action: 'create', sessionId, spec })
          onDone()
        } catch (e) {
          setError(e.message)
        } finally {
          setBusy(false)
          load(sessionId)
        }
      }
      return h('form', { className: 'hsw-form', onSubmit: submit },
        h('div', { className: 'hsw-form-row' },
          h('select', { className: 'hsw-select', value: kind, 'aria-label': 'What to watch', onChange: e => { setKind(e.target.value); setIntervalValue(e.target.value === 'port' ? '10' : '30') } },
            h('option', { value: 'command' }, 'Command'), h('option', { value: 'port' }, 'Port'), h('option', { value: 'files' }, 'Files')),
          h('input', { className: 'hsw-input', value, placeholder, autoFocus: true, 'aria-label': kind === 'command' ? 'Command' : kind === 'port' ? 'Port' : 'Files or folders, separated by commas', onChange: e => setValue(e.target.value) })),
        h('div', { className: 'hsw-form-row' },
          h('input', { className: 'hsw-input', value: label, placeholder: 'Name (optional)', 'aria-label': 'Name', onChange: e => setLabel(e.target.value) }),
          kind !== 'files' ? h('input', { className: 'hsw-input hsw-narrow', value: interval, inputMode: 'numeric', 'aria-label': 'Seconds between checks', title: 'Seconds between checks (at least 5)', onChange: e => setIntervalValue(e.target.value) }) : null,
          kind !== 'files' ? h('span', { className: 'hsw-note' }, 's') : null,
          h('button', { type: 'submit', className: 'hsw-btn hsw-primary', disabled: busy || value.trim() === '' }, busy ? 'Adding…' : 'Add')),
        h('span', { className: 'hsw-note' }, 'The agent is woken only when the result changes. Commands run under this session\'s sandbox.'),
        error ? h('span', { className: 'hsw-error', role: 'alert' }, error) : null)
    }

    function useNow(active) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        if (!active) return undefined
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [active])
      return now
    }

    /** Event the Preview plugin's Panes menu sends to open this list: detail { sessionId }. */
    const OPEN_WATCHES_EVENT = 'harness-studio:open-watches'

    function WatchAction({ sessionId, useSession }) {
      const openState = useSession ? useSession(snapshot => snapshot.openState) : 'open'
      const entry = useSyncExternalStore(subscribe, () => cache.get(sessionId))
      const [open, setOpen] = useState(false)
      const [adding, setAdding] = useState(false)
      const [position, setPosition] = useState(null)
      const [removingAll, setRemovingAll] = useState(false)
      const rootRef = useRef(null)
      const triggerRef = useRef(null)
      const menuRef = useRef(null)
      const now = useNow(open)
      // The header's Panes menu opens this list for the Session on screen (the eye itself shows only while watches run).
      useEffect(() => {
        const onOpen = event => { if (event.detail && event.detail.sessionId === String(sessionId)) setOpen(true) }
        window.addEventListener(OPEN_WATCHES_EVENT, onOpen)
        return () => window.removeEventListener(OPEN_WATCHES_EVENT, onOpen)
      }, [sessionId])

      // Cheap local reads: often while the list is open, now and then otherwise for the count.
      useEffect(() => {
        if (!sessionId) return undefined
        load(sessionId)
        const timer = setInterval(() => load(sessionId), open ? 2000 : 8000)
        return () => clearInterval(timer)
      }, [sessionId, open])

      useLayoutEffect(() => {
        if (!open) return undefined
        const place = () => {
          const anchor = triggerRef.current?.getBoundingClientRect()
          if (!anchor) return
          const width = Math.min(360, window.innerWidth - 32)
          setPosition({ top: anchor.bottom + 5, left: Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16)) })
        }
        place()
        window.addEventListener('resize', place)
        return () => window.removeEventListener('resize', place)
      }, [open])

      useEffect(() => {
        if (!open) return undefined
        const onPointer = event => {
          if (rootRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return
          setOpen(false)
        }
        const onKey = event => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus() } }
        document.addEventListener('pointerdown', onPointer, true)
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('pointerdown', onPointer, true); document.removeEventListener('keydown', onKey) }
      }, [open])

      useEffect(() => { if (!open) setAdding(false) }, [open])
      if (!sessionId || (openState !== undefined && openState !== 'open')) return null

      const watches = entry?.watches ?? []
      const count = watches.length
      const label = count === 0 ? 'Watches' : `${count} watch${count === 1 ? '' : 'es'}`
      const removeAll = async () => {
        setRemovingAll(true)
        try { await call({ action: 'removeAll', sessionId }) } catch { /* the list shows what is left */ }
        setRemovingAll(false)
        load(sessionId)
      }
      const menu = open ? ReactDOM.createPortal(h('div', {
        ref: menuRef, className: 'hsw-menu', role: 'dialog', 'aria-label': 'Watches of this session',
        style: position ? { top: position.top, left: position.left } : { visibility: 'hidden', top: 0, left: 0 },
      },
      h('div', { className: 'hsw-head' },
        h('span', null, count ? 'Watches — checked on this computer; the agent is woken only on change' : 'Watches'),
        count > 1 ? h('button', { type: 'button', className: 'hsw-link', disabled: removingAll, onClick: removeAll }, 'Remove all') : null),
      count === 0 && !adding ? h('div', { className: 'hsw-empty' }, 'No watches in this session. Ask the agent to watch a dev server, git status, a linter or files — or add one here.') : null,
      ...watches.map(watch => h(Row, { key: watch.id, watch, sessionId, now })),
      entry?.error ? h('div', { className: 'hsw-error' }, entry.error) : null,
      adding
        ? h(AddForm, { sessionId, onDone: () => setAdding(false) })
        : h('div', { className: 'hsw-head' }, h('button', { type: 'button', className: 'hsw-link', onClick: () => setAdding(true) }, '+ Add a watch'))), document.body) : null

      // No watches and the list closed: the eye steps out of the header; the Panes menu's Watches item brings it back.
      return h('div', { ref: rootRef, className: 'hsw-root', hidden: count === 0 && !open ? true : undefined },
        h('button', {
          ref: triggerRef, type: 'button', className: `hsw-trigger${count ? ' hsw-on' : ''}`, 'aria-label': label, title: label, 'aria-expanded': open,
          'data-testid': 'harness-studio-watch-entry', onClick: () => setOpen(value => !value),
        }, eye(16), count ? h('span', { className: 'hsw-count', 'aria-hidden': true }, String(count)) : null),
        menu)
    }

    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        connection = ctx.connection
        ctx.effect(() => () => { connection = undefined }, 'Watch connection')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.id = STYLE_ID
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'watch styles')
        ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          // Just left of Harness's Schedule clock (order -5).
          name: 'conversation.session.header.utilities', id: 'harness-studio-watch', order: -6, label: 'Watches',
        }, WatchAction)), 'watch list in the session header')
      },
    }
  },
})
