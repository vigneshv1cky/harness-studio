// Client half of the editor: a file editor used by the right panel's Files tab (Dev Preview plugin) for every
// file it opens, and by an Editor tab opened from a file preview's Edit button. CodeMirror (bundled from vendor/,
// available here as CM) does the editing. The editor saves with
// ⌘S / Ctrl+S, checks the file on disk every 1.5 seconds, and when the agent (or anything else) changes it:
//   - with no unsaved edits, applies the change in place, keeping the cursor, scroll position and undo history;
//   - with unsaved edits, asks whether to reload from disk or keep your version.
// A file's line breaks (CRLF, CR or LF) are kept as they are.
// It talks to the Host half through the `harnessStudioEditor/call` Remote method (index.js).

// Text helpers, kept outside the module so the tests can load them with the bundled CodeMirror.

/** The line break a file uses, by its first one: CRLF, CR or LF (LF for a file without one). */
function lineSeparatorOf(content) {
  return /\r\n?|\n/.exec(content)?.[0] ?? '\n'
}

/**
 * The editor's text with the file's own line breaks. The editor is set to split and join lines with exactly the
 * file's separator, but `doc.toString()` always joins with LF; `sliceDoc` uses the configured one.
 */
const textOf = state => state.sliceDoc()

/**
 * The transaction that turns the editor's text into `content` (the file on disk), or null when they are equal:
 * the smallest single change, so the cursor and history map through it, or the whole text when the file's line
 * breaks changed. `separators` is the compartment holding the line separator.
 */
function diskUpdate(state, content, separators) {
  const separator = lineSeparatorOf(content)
  if (separator !== state.lineBreak) {
    const doc = CM.EditorState.create({ doc: content, extensions: CM.EditorState.lineSeparator.of(separator) }).doc
    return { changes: { from: 0, to: state.doc.length, insert: doc }, effects: separators.reconfigure(CM.EditorState.lineSeparator.of(separator)) }
  }
  const next = state.toText(content)
  // Both strings hold one character per line break, so their offsets are document positions.
  const from = state.doc.toString()
  const to = next.toString()
  let start = 0
  const max = Math.min(from.length, to.length)
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++
  let endFrom = from.length
  let endTo = to.length
  while (endFrom > start && endTo > start && from.charCodeAt(endFrom - 1) === to.charCodeAt(endTo - 1)) { endFrom--; endTo-- }
  const spec = start === endFrom && start === endTo ? null : { changes: { from: start, to: endFrom, insert: next.slice(start, endTo) } }
  // In a file that mixes line breaks, a line break can line up with a lone break character inside a line;
  // the whole text is taken then.
  if (textOf(spec ? state.update(spec).state : state) === content) return spec
  return { changes: { from: 0, to: state.doc.length, insert: next } }
}

window.__ModuleLoader__.load({
  id: '@harness-studio/editor',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    const KIND = 'harness-studio-editor'
    const ID = '@harness-studio/editor'
    // The right panel opens resources only under Harness's dsh-resource:// scheme.
    const SCHEME = 'dsh-resource://harness-studio-editor/open'
    const ENDPOINT = 'harnessStudioEditor/call'
    const POLL_MS = 1500

    let connection
    let sidebarRight
    async function call(request) {
      if (!connection?.rpc) throw new Error('Harness did not provide its connection. Reload Harness.')
      const result = await connection.rpc.call('/api', ENDPOINT, { args: { request } })
      if (!result?.ok) throw new Error(result?.error?.message ?? 'The editor service did not answer. Restart Harness Studio.')
      return result.value
    }

    const addressOf = file => `${SCHEME}?path=${encodeURIComponent(file)}`
    function pathOf(address) {
      try { return new URL(address).searchParams.get('path') ?? '' } catch { return '' }
    }
    const baseName = file => file.split('/').filter(Boolean).pop() ?? file

    // Unsaved state per file, so the tab title can show a dot.
    const dirtyFiles = new Set()
    const dirtyListeners = new Set()
    function setDirty(file, dirty) {
      if (dirty === dirtyFiles.has(file)) return
      if (dirty) dirtyFiles.add(file); else dirtyFiles.delete(file)
      for (const listener of dirtyListeners) listener()
    }

    function languageFor(file) {
      const ext = (file.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
      if (['js', 'mjs', 'cjs', 'jsx'].includes(ext)) return CM.javascript({ jsx: true })
      if (['ts', 'mts', 'cts', 'tsx'].includes(ext)) return CM.javascript({ typescript: true, jsx: ext === 'tsx' })
      if (ext === 'json') return CM.json()
      if (['css', 'scss', 'less'].includes(ext)) return CM.css()
      if (['html', 'htm', 'vue', 'svelte'].includes(ext)) return CM.html()
      if (['md', 'markdown', 'mdx'].includes(ext)) return CM.markdown()
      if (ext === 'py') return CM.python()
      if (['yml', 'yaml'].includes(ext)) return CM.yaml()
      return []
    }

    const isDark = () => document.body.hasAttribute('data-ds-dark-theme')
    function themeFor(dark) {
      return [
        CM.EditorView.theme({
          '&': { height: '100%', fontSize: '13px', backgroundColor: 'transparent', color: 'var(--dsw-alias-label-primary)' },
          '.cm-scroller': { fontFamily: 'var(--dsw-font-markdown-code-font-family, ui-monospace, SFMono-Regular, Menlo, monospace)', lineHeight: '19px' },
          '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--dsw-alias-label-tertiary)', border: 'none' },
          '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent)' },
          '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--dsw-alias-label-secondary)' },
          '&.cm-focused': { outline: 'none' },
          '.cm-cursor': { borderLeftColor: 'var(--dsw-alias-label-primary)' },
          '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-accent-primary, #3b82f6) 28%, transparent) !important' },
          '.cm-panels': { backgroundColor: 'var(--dsw-specific-sidebar-fill, transparent)', color: 'var(--dsw-alias-label-primary)' },
        }, { dark }),
        CM.syntaxHighlighting(dark ? CM.oneDarkHighlightStyle : CM.defaultHighlightStyle),
      ]
    }

    const CSS = `
      .hse-root { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary); }
      .hse-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); font-size: 12px; min-height: 30px; box-sizing: border-box; }
      .hse-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); direction: rtl; text-align: left; }
      .hse-state { color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
      .hse-btn { height: 24px; padding: 0 10px; border-radius: 7px; border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
      .hse-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .hse-btn:disabled { opacity: 0.45; cursor: default; }
      .hse-banner { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; font-size: 12px; line-height: 18px; background: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #c27c0e) 12%, transparent); border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
      .hse-banner > span { flex: 1 1 220px; }
      .hse-banner-actions { display: flex; gap: 8px; flex: none; }
      .hse-editor { flex: 1; min-height: 0; overflow: hidden; }
      .hse-editor[hidden] { display: none; }
      .hse-preview { flex: 1; min-height: 0; overflow: auto; }
      .hse-message { padding: 16px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
      .hse-dot { display: inline-block; width: 6px; height: 6px; border-radius: 3px; background: currentColor; margin-left: 6px; vertical-align: middle; }
    `

    /**
     * One file in CodeMirror, with its save bar, disk following and conflict bar.
     * @param {{ file: string, displayPath?: string, line?: number, actions?: unknown, onDirty?: (dirty: boolean) => void, fallback?: (error: string) => unknown, preview?: (text: string) => unknown, showPreview?: boolean }} props
     *   `displayPath` replaces the absolute path in the bar; `line` (1-based) is selected and scrolled to; `actions`
     *   are extra buttons for the bar; `onDirty` follows unsaved changes; `fallback` renders a file the editor
     *   refuses (binary, too large, outside the workspace) instead of the error message. While `showPreview` is on,
     *   `preview` renders the buffer's current text (unsaved edits included) in place of the editor, which stays
     *   open underneath so nothing is lost when switching back.
     */
    function FileEditor({ file, displayPath, line, actions, onDirty, fallback, preview, showPreview }) {
      const host = useRef(null)
      const view = useRef(null)
      const known = useRef(null) // the disk version the buffer is based on: { mtimeMs, size, hash }
      const saved = useRef('') // the buffer text at the last open or save
      const external = useRef(CM.Annotation.define())
      const themeCompartment = useRef(new CM.Compartment())
      const separators = useRef(new CM.Compartment()) // the file's line separator
      // Counts saves started and finished, so a disk check that was under way across a save is dropped instead of
      // putting back the version from before the save.
      const saveGeneration = useRef(0)
      const [error, setError] = useState('')
      const [dirty, setDirtyState] = useState(false)
      const [conflict, setConflict] = useState(null) // { content, version } on disk while you have unsaved edits
      const [status, setStatus] = useState('Opening…')
      const [saving, setSaving] = useState(false)
      const [ready, setReady] = useState(false)
      // The buffer's text, kept only for a preview; other files skip the copy on every keystroke.
      const [text, setText] = useState('')
      const previewing = useRef(false)
      previewing.current = typeof preview === 'function'

      const onDirtyRef = useRef(onDirty)
      onDirtyRef.current = onDirty
      const markDirty = (value) => { setDirtyState(value); setDirty(file, value); onDirtyRef.current?.(value) }

      function replaceFromDisk(content, version) {
        const v = view.current
        if (!v) return
        const update = diskUpdate(v.state, content, separators.current)
        if (update) v.dispatch({ ...update, annotations: [external.current.of(true), CM.Transaction.addToHistory.of(false)] })
        known.current = version
        saved.current = content
        markDirty(false)
        setConflict(null)
      }

      async function save() {
        const v = view.current
        if (!v || saving) return true
        setSaving(true)
        saveGeneration.current++
        try {
          const content = textOf(v.state)
          const result = await call({ action: 'save', path: file, content, expected: known.current?.hash })
          if (result.conflict) {
            setConflict({ content: result.content, version: result.version })
            setStatus('Not saved: the file changed on disk')
          } else {
            known.current = result.version
            saved.current = content
            markDirty(textOf(v.state) !== content)
            setStatus(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
          }
        } catch (e) {
          setStatus(`Not saved: ${e.message}`)
        } finally {
          saveGeneration.current++
          setSaving(false)
        }
        return true
      }
      const saveRef = useRef(save)
      saveRef.current = save

      // Open the file and mount the editor.
      useEffect(() => {
        let cancelled = false
        call({ action: 'open', path: file }).then(({ content, version }) => {
          if (cancelled || !host.current) return
          known.current = version
          saved.current = content
          view.current = new CM.EditorView({
            parent: host.current,
            state: CM.EditorState.create({
              doc: content,
              extensions: [
                CM.basicSetup,
                separators.current.of(CM.EditorState.lineSeparator.of(lineSeparatorOf(content))),
                CM.keymap.of([CM.indentWithTab, { key: 'Mod-s', preventDefault: true, run: () => { void saveRef.current(); return true } }]),
                languageFor(file),
                themeCompartment.current.of(themeFor(isDark())),
                CM.EditorView.updateListener.of((update) => {
                  if (!update.docChanged) return
                  if (previewing.current) setText(textOf(update.state))
                  markDirty(textOf(update.state) !== saved.current)
                }),
              ],
            }),
          })
          setText(content)
          setStatus('')
          setReady(true)
        }, (e) => { if (!cancelled) setError(e.message) })
        return () => {
          cancelled = true
          view.current?.destroy()
          view.current = null
          setDirty(file, false)
        }
      }, [file])

      // Select and show a requested line, for example a search result.
      useEffect(() => {
        const v = view.current
        if (!ready || !v || !(line >= 1)) return
        const target = v.state.doc.line(Math.min(Math.floor(line), v.state.doc.lines))
        v.dispatch({ selection: { anchor: target.from, head: target.to }, effects: CM.EditorView.scrollIntoView(target.from, { y: 'center' }) })
      }, [ready, line])

      // Follow the app's light and dark theme.
      useEffect(() => {
        const observer = new MutationObserver(() => {
          view.current?.dispatch({ effects: themeCompartment.current.reconfigure(themeFor(isDark())) })
        })
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
        return () => observer.disconnect()
      }, [])

      // Check the file on disk, and follow changes made by the agent or anything else.
      useEffect(() => {
        let stopped = false
        const timer = setInterval(async () => {
          if (stopped || !view.current || !known.current || saving) return
          const generation = saveGeneration.current
          // Stale once this check stopped, a save started or finished, or the editor closed while it waited.
          const stale = () => stopped || generation !== saveGeneration.current || !view.current || !known.current
          try {
            const now = await call({ action: 'stat', path: file })
            if (stale() || (now.mtimeMs === known.current.mtimeMs && now.size === known.current.size)) return
            const disk = await call({ action: 'open', path: file })
            if (stale()) return
            if (disk.version.hash === known.current.hash) { known.current = disk.version; return }
            if (textOf(view.current.state) === saved.current) {
              replaceFromDisk(disk.content, disk.version)
              setStatus('Updated from disk')
            } else {
              setConflict({ content: disk.content, version: disk.version })
            }
          } catch (e) {
            if (!stale()) setStatus(e.message)
          }
        }, POLL_MS)
        return () => { stopped = true; clearInterval(timer) }
      }, [file, saving])

      if (error) return fallback ? fallback(error) : h('div', { className: 'hse-message' }, h('style', null, CSS), `Can’t edit ${baseName(file)}: ${error}`)
      return h('div', { className: 'hse-root' },
        h('style', null, CSS),
        h('div', { className: 'hse-bar' },
          // The span runs right to left so a long path is cut at its start; <bdi> keeps the path itself left to right.
          h('span', { className: 'hse-path', title: file }, h('bdi', null, displayPath ?? file)),
          h('span', { className: 'hse-state' }, dirty ? 'Unsaved changes' : status),
          h('button', { type: 'button', className: 'hse-btn', disabled: !dirty || saving, onClick: () => void save(), title: 'Save (⌘S)' }, saving ? 'Saving…' : 'Save'),
          actions ?? null),
        conflict ? h('div', { className: 'hse-banner' },
          h('span', null, 'This file changed on disk while you had unsaved edits (for example, the agent edited it).'),
          h('div', { className: 'hse-banner-actions' },
            h('button', { type: 'button', className: 'hse-btn', onClick: () => { replaceFromDisk(conflict.content, conflict.version); setStatus('Reloaded from disk') } }, 'Use the disk version'),
            h('button', { type: 'button', className: 'hse-btn', onClick: () => { known.current = conflict.version; setConflict(null); setStatus('Keeping your version; saving will replace the disk version') } }, 'Keep mine'))) : null,
        h('div', { className: 'hse-editor', ref: host, hidden: Boolean(showPreview && preview) }),
        showPreview && preview ? h('div', { className: 'hse-preview' }, ready ? preview(text) : null) : null)
    }

    /** The Editor tab: one file, opened from a file preview's Edit button. */
    function EditorTab({ useTabInfo }) {
      const { tab } = useTabInfo()
      return h(FileEditor, { file: pathOf(tab.navigation?.address ?? tab.contentId) })
    }

    function EditorTitle({ useTabInfo }) {
      const { tab } = useTabInfo()
      const file = pathOf(tab.navigation?.address ?? tab.contentId)
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => force(n => n + 1)
        dirtyListeners.add(listener)
        return () => { dirtyListeners.delete(listener) }
      }, [])
      return h(React.Fragment, null, baseName(file), dirtyFiles.has(file) ? h('span', { className: 'hse-dot', title: 'Unsaved changes' }) : null)
    }

    /** The Edit button in the file preview's toolbar. */
    function EditButton({ absolutePath, sessionId }) {
      return h('button', {
        type: 'button', title: 'Edit this file', 'aria-label': 'Edit this file',
        // The per-session open also works while the panel fills the window with no conversation on screen.
        onClick: () => sessionId !== undefined && typeof sidebarRight?.openResourceIn === 'function'
          ? sidebarRight.openResourceIn(sessionId, addressOf(absolutePath))
          : sidebarRight?.openResource(addressOf(absolutePath)),
        style: { height: 24, padding: '0 8px', borderRadius: 7, border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', font: 'inherit', fontSize: 12, cursor: 'pointer' },
      }, 'Edit')
    }

    return {
      inject: ['slots', 'connection', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        connection = ctx.connection
        sidebarRight = ctx.sidebarRight
        ctx.effect(() => () => { connection = undefined; sidebarRight = undefined }, 'editor services')
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: ID,
          kind: KIND,
          patterns: ['dsh-resource://harness-studio-editor/**'],
          canOpen: address => pathOf(address).startsWith('/'),
          title: address => baseName(pathOf(address)),
        }), 'editor tab type')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab', key: ID, inject: () => ({}),
        }, EditorTab)), 'editor tab body')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title', key: ID,
        }, EditorTitle)), 'editor tab title')
        ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register({
          name: 'sidebar.right.tab.document.actions', id: ID, inject: () => ({}),
        }, EditButton)), 'Edit button in the file preview')
        // The Files tab (Dev Preview plugin) shows every file it opens in this editor. The two plugins are
        // loaded separately, so the editor is handed over on a window property this plugin owns and removes,
        // with an event for a Files tab that was drawn before this plugin finished loading.
        ctx.effect(() => {
          const shared = (window.__harnessStudio ??= {})
          shared.FileEditor = FileEditor
          window.dispatchEvent(new Event('harness-studio-editor'))
          return () => {
            if (shared.FileEditor === FileEditor) delete shared.FileEditor
            window.dispatchEvent(new Event('harness-studio-editor'))
          }
        }, 'file editor for the Files tab')
      },
    }
  },
})
