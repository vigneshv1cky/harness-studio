// Client half of Remember: an "Instructions" page in the left sidebar, below Automation tasks.
//   - which instruction files a workspace's sessions read, with size, token cost and status (loaded,
//     skipped, left out or shortened to fit the limit);
//   - the size limit for instructions, applied from the next message;
//   - editing a file on the page, or opening it in the editor;
//   - the notes Remember saved, each with Delete.
// It talks to the Host half through the `harnessStudioInstructions/call` Remote method (instructions.js).

window.__ModuleLoader__.load({
  id: '@harness-studio/remember',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    const ENDPOINT = 'harnessStudioInstructions/call'
    const LIMITS = [
      [65536, '64 KB'], [131072, '128 KB'], [262144, '256 KB'], [524288, '512 KB'], [1048576, '1 MB'], [0, 'No limit'],
    ]
    const STATUS = {
      loaded: ['Loaded', 'var(--dsw-alias-state-success-primary, #1f9d55)'],
      skipped: ['Skipped', 'var(--dsw-alias-label-tertiary)'],
      missing: ['Not created', 'var(--dsw-alias-label-tertiary)'],
      'left-out': ['Left out', 'var(--dsw-alias-state-warning-primary, #c27c0e)'],
      cut: ['Shortened', 'var(--dsw-alias-state-warning-primary, #c27c0e)'],
    }
    const kb = bytes => (bytes == null ? '—' : bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`)
    /** A path that keeps its end (folder and file name) when it is too long, shortening the middle instead. */
    function PathText({ text, title }) {
      const parts = text.split('/')
      const cut = parts.length > 3 ? parts.length - 2 : parts.length
      const head = parts.slice(0, cut).join('/')
      const tail = cut < parts.length ? '/' + parts.slice(cut).join('/') : ''
      return h('div', { className: 'hsi-path', title }, h('span', { className: 'hsi-path-head' }, head), tail ? h('span', { className: 'hsi-path-tail' }, tail) : null)
    }
    const tokens = bytes => (bytes == null ? '' : `≈ ${Math.round(bytes / 4).toLocaleString()} tokens`)

    let connection
    async function call(request) {
      if (!connection?.rpc) throw new Error('Harness did not provide its connection. Reload Harness.')
      const result = await connection.rpc.call('/api', ENDPOINT, { args: { request } })
      if (!result?.ok) throw new Error(result?.error?.message ?? 'The Instructions service did not answer. Restart Harness after installing or updating the plugin.')
      return result.value
    }

    const CSS = `
      .hsi-page { box-sizing: border-box; height: 100%; display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 0 clamp(24px, 4vw, 48px) 48px; overflow: auto; color: var(--dsw-alias-label-primary); font-size: 14px; }
      .hsi-page > * { width: 100%; max-width: 960px; flex: none; }
      .hsi-head { padding-top: 28px; }
      [data-platform="darwin"] .hsi-head { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
      .hsi-title { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; }
      .hsi-intro { margin: 4px 0 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
      .hsi-controls { display: flex; flex-wrap: wrap; gap: 12px 28px; align-items: center; padding-bottom: 14px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
      .hsi-control { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
      .hsi-select { height: 30px; padding: 0 28px 0 10px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; }
      .hsi-note { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
      .hsi-section { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px; }
      .hsi-list { display: flex; flex-direction: column; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 12px; overflow: hidden; }
      .hsi-row { display: flex; align-items: center; gap: 14px; padding: 10px 14px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
      .hsi-row:first-child { border-top: none; }
      .hsi-main { flex: 1; min-width: 0; }
      .hsi-label { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
      .hsi-path { display: flex; min-width: 0; font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, monospace); font-size: 13px; line-height: 20px; white-space: nowrap; }
      .hsi-path-head { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .hsi-path-tail { flex: none; }
      .hsi-why { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
      .hsi-size { width: 150px; flex: none; text-align: right; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
      .hsi-pill { flex: none; width: 82px; font-size: 12px; font-weight: 500; }
      .hsi-actions { display: flex; gap: 6px; flex: none; width: 150px; justify-content: flex-end; }
      .hsi-btn { height: 28px; padding: 0 10px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
      .hsi-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .hsi-btn:disabled { opacity: 0.5; cursor: default; }
      .hsi-btn.primary { background: var(--dsw-alias-button-primary-fill); border-color: transparent; color: var(--dsw-alias-bg-layer-1); }
      .hsi-btn.danger { color: var(--dsw-alias-state-error-primary); }
      .hsi-editor { display: flex; flex-direction: column; gap: 8px; padding: 0 14px 12px; }
      .hsi-editor textarea { box-sizing: border-box; width: 100%; min-height: 260px; padding: 10px 12px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, monospace); font-size: 12.5px; line-height: 19px; resize: vertical; }
      .hsi-editor-actions { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
      .hsi-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; }
      .hsi-empty { padding: 14px; font-size: 13px; color: var(--dsw-alias-label-tertiary); }
      .hsi-prompt { margin: 0 14px 12px; padding: 10px 12px; max-height: 420px; overflow: auto; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2, transparent); font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, monospace); font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
    `
    function useCss() {
      useEffect(() => {
        let style = document.getElementById('hsi-css')
        if (!style) { style = document.createElement('style'); style.id = 'hsi-css'; document.head.append(style) }
        if (style.textContent !== CSS) style.textContent = CSS
      }, [])
    }

    function Editor({ file, onClose }) {
      const [text, setText] = useState(null)
      // The hash of the text as opened; the Host refuses the save when the file changed since.
      const [hash, setHash] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      useEffect(() => {
        call({ action: 'read', file: file.absolutePath }).then(r => { setText(r.content); setHash(r.hash) }, e => setError(e.message))
      }, [file.absolutePath])
      const save = async () => {
        setBusy(true); setError('')
        try { await call({ action: 'write', file: file.absolutePath, content: text, hash }); onClose(true) } catch (e) { setError(e.message) } finally { setBusy(false) }
      }
      return h('div', { className: 'hsi-editor' },
        text === null && !error ? h('div', { className: 'hsi-note' }, 'Loading…') : null,
        text !== null ? h('textarea', { value: text, spellCheck: false, onChange: e => setText(e.target.value), 'aria-label': `Edit ${file.path}` }) : null,
        h('div', { className: 'hsi-editor-actions' },
          error ? h('span', { className: 'hsi-error' }, error) : null,
          text !== null ? h('span', { className: 'hsi-note' }, `${kb(new TextEncoder().encode(text).length)} · ${tokens(new TextEncoder().encode(text).length)}`) : null,
          h('button', { type: 'button', className: 'hsi-btn', onClick: () => onClose(false) }, 'Cancel'),
          h('button', { type: 'button', className: 'hsi-btn primary', disabled: busy || text === null, onClick: save }, busy ? 'Saving…' : 'Save')))
    }

    /** Harness's own system prompt, as a new session starts with it: read only, shown on demand. */
    function SystemPrompt() {
      const [prompt, setPrompt] = useState(undefined)
      const [open, setOpen] = useState(false)
      const [error, setError] = useState('')
      useEffect(() => { call({ action: 'systemPrompt' }).then(setPrompt, e => setError(e.message)) }, [])
      if (prompt === null) return null
      return h(React.Fragment, null,
        h('div', { className: 'hsi-section' }, 'System prompt'),
        h('div', { className: 'hsi-list' },
          h('div', { className: 'hsi-row' },
            h('div', { className: 'hsi-main' },
              h('div', { className: 'hsi-label' }, 'Harness Studio, every session'),
              h('div', { style: { fontSize: 13, lineHeight: '20px' } }, 'Sent before the files below: the agent\'s role and how to use each tool, set by Harness and its plugins.'),
              error ? h('div', { className: 'hsi-error' }, error)
                : prompt ? h('div', { className: 'hsi-why' }, `${prompt.sections.length} sections, plus ${prompt.tools} tool definitions sent alongside. {{model}} is filled in with the session's model; plan mode and agent presets add or replace parts.`) : null),
            h('div', { className: 'hsi-size' }, prompt ? `${kb(prompt.bytes)} · ${tokens(prompt.bytes)}` : ''),
            h('div', { className: 'hsi-pill', style: { color: 'var(--dsw-alias-label-tertiary)' } }, 'Read only'),
            h('div', { className: 'hsi-actions' },
              h('button', { type: 'button', className: 'hsi-btn', disabled: !prompt, onClick: () => setOpen(!open) }, open ? 'Hide' : 'Show'))),
          open && prompt ? h('pre', { className: 'hsi-prompt', 'aria-label': 'System prompt' }, prompt.text) : null))
    }

    function InstructionsPage() {
      useCss()
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [folder, setFolder] = useState(null)
      const [editing, setEditing] = useState(null)
      const load = useCallback(async (nextFolder) => {
        try {
          const value = await call({ action: 'overview', folder: nextFolder ?? undefined })
          setState(value); setFolder(value.folder); setError('')
        } catch (e) { setError(e.message) }
      }, [])
      useEffect(() => {
        let saved = null
        try { saved = localStorage.getItem('harness-studio.instructions-workspace') } catch { /* no storage: first workspace */ }
        load(saved)
      }, [load])
      const act = async (request) => { try { await call(request); await load(folder) } catch (e) { setError(e.message) } }

      const head = h('div', { className: 'hsi-head' },
        h('h1', { className: 'hsi-title' }, 'Instructions'),
        h('p', { className: 'hsi-intro' }, 'What every new session reads before it starts, in this order: your rules for every project, then the project\'s AGENTS.md in each folder from the repository root down, each followed by its AGENTS.local.md, which is just for you. They are sent with every request, so their size is a cost on every message.'))
      if (!state) return h('div', { className: 'hsi-page' }, head, error ? h('div', { className: 'hsi-error' }, error) : h('div', { className: 'hsi-note' }, 'Loading…'))

      const limitLabel = state.limit === 0 ? 'no limit' : kb(state.limit)
      const controls = h('div', { className: 'hsi-controls' },
        h('label', { className: 'hsi-control' }, 'Workspace',
          h('select', { className: 'hsi-select', value: folder ?? '', onChange: e => {
            try { localStorage.setItem('harness-studio.instructions-workspace', e.target.value) } catch { /* not remembered */ }
            load(e.target.value)
          } },
            state.workspaces.map(w => h('option', { key: w.path, value: w.path }, w.title)))),
        h('label', { className: 'hsi-control' }, 'Size limit',
          h('select', { className: 'hsi-select', value: String(state.limit), onChange: e => act({ action: 'setLimit', maxBytes: Number(e.target.value) }) },
            LIMITS.map(([value, label]) => h('option', { key: value, value: String(value) }, label + (value === state.defaultLimit ? ' (default)' : ''))))),
        h('span', { className: 'hsi-note' }, 'The size limit caps how much instruction text each message carries. When the files below add up to more, the broadest are left out first (your rules for every project, then the folders nearest the repository root), and if the most specific file alone is still too long, it is shortened to fit. Each file\'s row says when that happens. A lower limit makes every message cheaper but can drop rules; no limit sends everything.'),
        h('span', { className: 'hsi-note' }, `Sent with each request here: ${kb(state.sentBytes)}, ${tokens(state.sentBytes)} (limit ${limitLabel}). A new limit applies from the next message.`))

      const rows = state.files.map(file => {
        const [statusLabel, color] = STATUS[file.status] ?? [file.status, 'inherit']
        const key = file.absolutePath
        return h(React.Fragment, { key },
          h('div', { className: 'hsi-row' },
            h('div', { className: 'hsi-main' },
              h('div', { className: 'hsi-label' }, file.label),
              h(PathText, { text: file.path, title: file.absolutePath }),
              file.reason ? h('div', { className: 'hsi-why' }, file.reason) : null),
            h('div', { className: 'hsi-size' }, file.bytes == null ? '' : `${kb(file.bytes)} · ${tokens(file.bytes)}`),
            h('div', { className: 'hsi-pill', style: { color } }, statusLabel),
            h('div', { className: 'hsi-actions' },
              h('button', { type: 'button', className: 'hsi-btn', onClick: () => setEditing(editing === key ? null : key) }, file.status === 'missing' ? 'Create' : 'Edit'),
              file.status === 'missing' ? null : h('button', { type: 'button', className: 'hsi-btn', onClick: () => act({ action: 'open', file: file.absolutePath }) }, 'Open'))),
          editing === key ? h(Editor, { file, onClose: saved => { setEditing(null); if (saved) load(folder) } }) : null)
      })

      const notes = state.notes.length === 0
        ? h('div', { className: 'hsi-empty' }, 'No remembered notes yet. When you ask the agent to add a rule to your instruction files, it offers to save it here.')
        : state.notes.map(note => h('div', { key: note.absolutePath + note.line, className: 'hsi-row' },
          h('div', { className: 'hsi-main' },
            h('div', { style: { fontSize: 13, lineHeight: '20px' } }, note.text),
            h('div', { className: 'hsi-why' }, `${note.file}${note.date ? ' · ' + note.date : ''}`)),
          h('div', { className: 'hsi-actions' },
            h('button', { type: 'button', className: 'hsi-btn danger', onClick: () => act({ action: 'deleteNote', file: note.absolutePath, line: note.line }) }, 'Delete'))))

      const memory = state.memory
      const memoryRows = !memory ? null
        : memory.items.length === 0
          ? h('div', { className: 'hsi-empty' }, 'No memories yet. The agent saves them on its own as it learns about this project and how you like to work, one small note per fact.')
          : memory.items.map(item => h('div', { key: item.name, className: 'hsi-row' },
            h('div', { className: 'hsi-main' },
              h('div', { className: 'hsi-label' }, [item.type, item.updated].filter(Boolean).join(' · ')),
              h('div', { style: { fontSize: 13, lineHeight: '20px' } }, item.description || item.name),
              h('div', { className: 'hsi-why' }, item.name + '.md')),
            h('div', { className: 'hsi-size' }, `${kb(item.bytes)}`),
            h('div', { className: 'hsi-actions' },
              h('button', { type: 'button', className: 'hsi-btn', onClick: () => act({ action: 'openMemory', folder, name: item.name }) }, 'Open'),
              h('button', { type: 'button', className: 'hsi-btn danger', onClick: () => act({ action: 'deleteMemory', folder, name: item.name }) }, 'Delete'))))

      return h('div', { className: 'hsi-page', 'data-studio-instructions': '' },
        head, controls,
        error ? h('div', { className: 'hsi-error' }, error) : null,
        h(SystemPrompt),
        h('div', { className: 'hsi-section' }, 'Files'),
        h('div', { className: 'hsi-list' }, rows),
        memory ? h('div', { className: 'hsi-section' }, 'Memory') : null,
        memory ? h('div', { className: 'hsi-note' }, `Saved by the agent on its own, one note per fact, in ${memory.folder}. New sessions here read the index: ${memory.indexLines} line${memory.indexLines === 1 ? '' : 's'}, ${kb(memory.indexBytes)}.`) : null,
        memory ? h('div', { className: 'hsi-list' }, memoryRows) : null,
        h('div', { className: 'hsi-section' }, 'Remembered in instruction files'),
        h('div', { className: 'hsi-list' }, notes))
    }

    function InstructionsIcon({ size = 16, className }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round', strokeLinejoin: 'round', className, 'aria-hidden': true },
        h('path', { d: 'M4 1.75h5.5L12.5 4.75v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2.25a.5.5 0 0 1 .5-.5z' }),
        h('path', { d: 'M9.5 1.75v3h3M5.75 8h4.5M5.75 10.5h4.5M5.75 13h2.5' }))
    }

    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        connection = ctx.connection
        ctx.effect(() => () => { if (connection === ctx.connection) connection = undefined }, 'instructions connection')
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'instructions', inject: () => ({}),
        }, InstructionsPage)), 'Instructions page')
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'instructions', order: 11, label: () => 'Instructions',
        }, InstructionsIcon)), 'Instructions entry in the left sidebar, below Automation tasks')
      },
    }
  },
})
