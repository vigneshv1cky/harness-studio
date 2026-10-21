// Client half of Undo: under each finished turn whose file changes were kept, a row offers to put those
// files back the way they were before that turn. It asks first, then reports what was restored. It talks to
// the Host half through the `harnessStudioUndo/call` Remote method (index.js).
//
// Rewind, like Claude Code's: the rewind button on a message that started a turn, or Esc twice in an empty
// message box, offers to restore the code, the conversation, or both to before that message, in the same chat.

window.__ModuleLoader__.load({
  id: '@harness-studio/undo',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const { useEffect, useRef, useState, useSyncExternalStore } = React

    const ENDPOINT = 'harnessStudioUndo/call'
    let connection
    async function call(request) {
      if (!connection?.rpc) throw new Error('Harness did not provide its connection. Reload Harness.')
      const result = await connection.rpc.call('/api', ENDPOINT, { args: { request } })
      if (!result?.ok) throw new Error(result?.error?.message ?? 'The Undo service did not answer. Restart Harness after installing or updating the plugin.')
      return result.value
    }

    // ---- the kept turns of each session, shared by every row of that session ------------------------
    const cache = new Map()
    const listeners = new Set()
    const notify = () => { for (const listener of listeners) listener() }
    function load(sessionId, force = false) {
      const entry = cache.get(sessionId)
      if (!force && entry && (entry.loading || Date.now() - entry.at < 1500)) return
      cache.set(sessionId, { ...entry, loading: true, at: Date.now() })
      call({ action: 'list', sessionId })
        .then(turns => cache.set(sessionId, { turns, at: Date.now(), loading: false }))
        .catch(() => cache.set(sessionId, { turns: entry?.turns ?? [], at: Date.now(), loading: false }))
        .finally(notify)
    }
    const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }

    const CSS = `
      .hsu-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 0 2px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
      .hsu-btn { height: 24px; padding: 0 10px; border-radius: 7px; border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
      .hsu-btn:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
      .hsu-btn:disabled { opacity: 0.5; cursor: default; }
      .hsu-danger { color: var(--dsw-alias-state-error-primary, #d14343); border-color: currentColor; }
      .hsu-confirm { flex-basis: 100%; color: var(--dsw-alias-label-secondary); }
      .hsu-result { color: var(--dsw-alias-label-secondary); }
      .hsu-files { margin: 2px 0 0; padding-left: 18px; flex-basis: 100%; }
      .hsr-anchor { position: relative; display: inline-flex; }
      .hsr-icon { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 4px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
      .hsr-icon:hover, .hsr-icon[aria-expanded='true'] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
      .hsr-icon svg { width: 14px; height: 14px; }
      .hsr-panel { position: fixed; z-index: 1000; width: 340px; max-width: min(340px, 80vw); padding: 10px; border-radius: 10px; border: 0.5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-l1, var(--dsw-alias-bg-primary, Canvas)); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); text-align: left; white-space: normal; cursor: default; outline: none; }
      .hsr-title { font-weight: 600; color: var(--dsw-alias-label-primary); margin: 0 4px 6px; }
      .hsr-note { margin: 0 4px 8px; }
      .hsr-panel .hsu-files, .hsr-picker .hsu-files { margin: 0 4px 8px; }
      .hsr-options { display: flex; flex-direction: column; gap: 2px; }
      .hsr-option { display: flex; flex-direction: row; align-items: baseline; gap: 6px; width: 100%; padding: 6px 8px; border: none; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; }
      .hsr-option:hover, .hsr-option:focus-visible, .hsr-option:focus, .hsr-option[data-selected] { background: var(--dsw-alias-interactive-bg-hover); outline: none; }
      .hsr-pointer { flex: none; width: 10px; opacity: 0; color: var(--dsw-alias-accent-primary, var(--dsw-alias-label-link, #3b82f6)); }
      .hsr-num { flex: none; min-width: 14px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
      .hsr-label { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      .hsr-option:focus .hsr-pointer, .hsr-option:hover .hsr-pointer { opacity: 1; }
      .hsr-option:focus .hsr-label, .hsr-option:focus .hsr-num { color: var(--dsw-alias-accent-primary, var(--dsw-alias-label-link, #3b82f6)); }
      .hsr-option:disabled { opacity: 0.5; cursor: default; }
      .hsr-option small { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
      .hsr-error { color: var(--dsw-alias-state-error-primary, #d14343); margin: 0 4px 8px; }
      .hsr-dock { display: contents; }
      .hsr-picker { margin: 0 0 8px; padding: 10px; border-radius: 12px; border: 0.5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-l1, var(--dsw-alias-bg-primary, Canvas)); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.10); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .hsr-list { max-height: 260px; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
      .hsr-item { display: flex; gap: 8px; align-items: baseline; width: 100%; padding: 5px 8px; border: none; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; }
      .hsr-item[data-selected], .hsr-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .hsr-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
      .hsr-item small { color: var(--dsw-alias-label-tertiary); flex: none; }
      .hsr-hint { margin: 6px 4px 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .hsr-backdrop { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.28); }
      .hsr-modal { width: 460px; max-width: calc(100vw - 32px); padding: 20px 22px 18px; border-radius: 14px; background: var(--dsw-alias-bg-l1, var(--dsw-alias-bg-primary, Canvas)); box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25); font-size: 13px; line-height: 19px; color: var(--dsw-alias-label-secondary); text-align: left; white-space: normal; cursor: default; outline: none; }
      .hsr-body .hsr-title { margin: 0 0 12px; font-size: 19px; line-height: 26px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .hsr-quote { margin: 0 0 14px; padding: 9px 14px; border-radius: 10px; background: var(--dsw-alias-bg-l2, rgba(127, 127, 127, 0.08)); color: var(--dsw-alias-label-primary); white-space: pre-wrap; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
      .hsr-field { margin: 0 0 6px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .hsr-select { width: 100%; height: 32px; margin: 0 0 12px; padding: 0 10px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; }
      .hsr-files-line { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; color: var(--dsw-alias-label-primary); white-space: nowrap; min-width: 0; }
      .hsr-names { overflow: hidden; text-overflow: ellipsis; min-width: 0; color: var(--dsw-alias-label-secondary); }
      .hsr-counts { display: inline-flex; gap: 2px; flex: none; font-size: 11.5px; font-variant-numeric: tabular-nums; }
      .hsr-plus, .hsr-minus { padding: 0 5px; border-radius: 5px; line-height: 18px; }
      .hsr-plus { color: #1a7f37; background: rgba(26, 127, 55, 0.12); }
      .hsr-minus { color: #cf222e; background: rgba(207, 34, 46, 0.12); }
      .hsr-body .hsr-note { margin: 0 0 4px; color: var(--dsw-alias-label-tertiary); }
      .hsr-body .hsr-error { margin: 4px 0; }
      .hsr-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
      .hsr-btn { height: 30px; padding: 0 14px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; cursor: pointer; }
      .hsr-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .hsr-primary { border-color: transparent; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-label-primary-inverted, #fff); }
      .hsr-primary:hover:not(:disabled) { background: var(--dsw-alias-label-primary); opacity: 0.88; }
      .hsr-btn:disabled { opacity: 0.5; cursor: default; }
    `
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
    const shortPath = file => file.split('/').slice(-2).join('/')

    function UndoRow({ turn, sessionId }) {
      const snapshot = useSyncExternalStore(subscribe, () => cache.get(sessionId))
      const [stage, setStage] = useState('idle')
      const [result, setResult] = useState(null)
      const closed = turn?.status === 'closed'
      useEffect(() => { if (closed && sessionId) load(sessionId) }, [sessionId, closed, turn?.turn])
      if (result) {
        const back = result.restored.length + result.removed.length
        return h('div', { className: 'hsu-row' }, h('style', null, CSS),
          h('span', { className: 'hsu-result' }, back ? `Undone: ${plural(back, 'file')} put back as before turn ${turn.turn}.` : 'Nothing was changed.'),
          result.failed.length ? h('ul', { className: 'hsu-files' }, ...result.failed.map(f => h('li', { key: f.path }, `${shortPath(f.path)} could not be restored: ${f.reason}`))) : null)
      }
      if (!closed || !sessionId) return null
      const turns = snapshot?.turns ?? []
      if (!turns.some(t => t.turn === turn.turn)) return null
      const affected = new Map()
      for (const t of turns) if (t.turn >= turn.turn) for (const f of t.files) if (!affected.has(f.path)) affected.set(f.path, f)
      const files = [...affected.values()]
      const later = turns.some(t => t.turn > turn.turn)
      const undo = async () => {
        setStage('working')
        try {
          setResult(await call({ action: 'restore', sessionId, turn: turn.turn }))
        } catch (error) {
          setResult({ restored: [], removed: [], failed: [{ path: 'Undo', reason: error.message }] })
        } finally {
          load(sessionId, true)
        }
      }
      if (stage === 'idle') {
        return h('div', { className: 'hsu-row' }, h('style', null, CSS),
          h('button', { type: 'button', className: 'hsu-btn', onClick: () => setStage('confirm'), title: files.map(f => f.path).join('\n') },
            h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
              h('path', { d: 'M5 3 2 6l3 3' }), h('path', { d: 'M2 6h7.5a4.5 4.5 0 0 1 0 9H6' })),
            later ? 'Undo file changes from here on' : 'Undo file changes'),
          h('span', null, plural(files.length, 'file')))
      }
      return h('div', { className: 'hsu-row' }, h('style', null, CSS),
        h('span', { className: 'hsu-confirm' },
          `Put ${plural(files.length, 'file')} back the way ${files.length === 1 ? 'it was' : 'they were'} before this turn?`
          + (later ? ' Changes to them in later turns are undone too.' : '')
          + ' Any edits you made to them since are lost; changes made by shell commands are not undone.'),
        h('ul', { className: 'hsu-files' }, ...files.slice(0, 8).map(f => h('li', { key: f.path }, `${shortPath(f.path)}${f.existed ? '' : ' (will be removed: it was new)'}${f.restorable ? '' : ' (cannot be restored)'}`)),
          files.length > 8 ? h('li', null, `and ${files.length - 8} more`) : null),
        h('button', { type: 'button', className: 'hsu-btn hsu-danger', disabled: stage === 'working', onClick: undo }, stage === 'working' ? 'Undoing…' : 'Undo changes'),
        h('button', { type: 'button', className: 'hsu-btn', disabled: stage === 'working', onClick: () => setStage('idle') }, 'Cancel'))
    }

    // ---- Rewind, like Claude Code's ----------------------------------------------------------------
    // Restore conversation rewinds this chat in place: Harness appends one replacement that sets the model's
    // context back to before that message, the chat hides the turns from there on, and the message goes back in
    // the box. The log is only appended to, so nothing is lost; the Trajectory view still shows every turn.
    // Restore code: Undo from that turn on. Both: files first, then the conversation.
    let sessions
    let uiWorkspace
    const REWIND_ICON = h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
      h('path', { d: 'M2.5 3v3.5H6' }), h('path', { d: 'M2.9 6.3A5.5 5.5 0 1 1 3 10' }), h('path', { d: 'M8 5.5V8l1.8 1.2' }))
    const errorText = error => error?.message ?? String(error)

    /** Rewind this chat to before `turn` and put `text` back in its message box. */
    async function restoreConversation(sessionId, turn, text) {
      if (!sessions?.rewind || !uiWorkspace) throw new Error('This version of Harness cannot rewind a chat in place. Restart Harness Studio.')
      await sessions.rewind({ sessionId, beforeTurn: turn })
      uiWorkspace.openSession(sessionId, { prompt: text, clearPreviousDraft: true })
    }

    /** Claude Code's rewind choices for one message: code and conversation, conversation, code, cancel. */
    function RewindChoices({ sessionId, turn, closed, text, onClose }) {
      const snapshot = useSyncExternalStore(subscribe, () => cache.get(sessionId))
      const [stage, setStage] = useState('choose')
      const [outcome, setOutcome] = useState(null)
      const [choice, setChoice] = useState(null)
      const list = useRef(null)
      useEffect(() => { load(sessionId, true) }, [sessionId])
      useEffect(() => { list.current?.querySelector('.hsr-primary:not(:disabled), button:not(:disabled)')?.focus() }, [stage, snapshot !== undefined])

      const affected = new Map()
      for (const t of snapshot?.turns ?? []) if (t.turn >= turn) for (const f of t.files) if (!affected.has(f.path)) affected.set(f.path, f)
      const files = [...affected.values()]
      const code = files.length > 0 && closed
      const working = stage === 'working'
      // Lines added and removed in those files since the copies were kept, as Claude Code shows them. An older
      // Undo background (before a restart) has no such action; the dialog then just leaves the counts out.
      const [counts, setCounts] = useState(null)
      useEffect(() => {
        if (!code) return undefined
        let live = true
        call({ action: 'changes', sessionId, turn }).then(found => { if (live) setCounts(found) }, () => { if (live) setCounts(null) })
        return () => { live = false }
      }, [sessionId, turn, code])
      const totals = counts?.some(f => Number.isInteger(f.added))
        ? counts.reduce((sum, f) => ({ added: sum.added + (f.added ?? 0), removed: sum.removed + (f.removed ?? 0) }), { added: 0, removed: 0 })
        : null

      const run = async (choice) => {
        setStage('working')
        setOutcome(null)
        try {
          if (choice !== 'conversation') {
            const result = await call({ action: 'restore', sessionId, turn })
            load(sessionId, true)
            if (result.failed.length) { setOutcome({ failed: result.failed, then: choice }); setStage('files-failed'); return }
            if (choice === 'code') { setOutcome({ restored: result.restored.length + result.removed.length }); setStage('code-done'); return }
          }
          await restoreConversation(sessionId, turn, text)
          onClose()
        } catch (error) {
          setOutcome({ error: errorText(error) })
          setStage('choose')
        }
      }
      const finishConversation = async () => {
        setStage('working')
        try { await restoreConversation(sessionId, turn, text); onClose() } catch (error) { setOutcome({ error: errorText(error) }); setStage('choose') }
      }
      const move = (event) => {
        const buttons = [...(list.current?.querySelectorAll('button:not(:disabled)') ?? [])]
        if (/^[1-9]$/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const pick = list.current?.querySelector(`.hsr-option[data-n="${event.key}"]:not(:disabled)`)
          if (pick) { pick.focus(); pick.click(); event.preventDefault() }
          return
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        const at = buttons.indexOf(document.activeElement)
        buttons[(at + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
        event.preventDefault()
      }
      // Numbered like Claude Code's rewind prompt: "❯ 1. Restore code and conversation", the pointer on the selected row.
      let number = 0
      const option = (key, label, hint, onClick) => {
        const n = ++number
        return h('button', { key, type: 'button', className: 'hsr-option', 'data-n': n, disabled: working, onClick },
          h('span', { className: 'hsr-pointer', 'aria-hidden': true }, '❯'),
          h('span', { className: 'hsr-num', 'aria-hidden': true }, n + '.'),
          h('span', { className: 'hsr-label' }, label, hint ? h('small', null, hint) : null))
      }

      if (stage === 'code-done') {
        return h('div', { ref: list },
          h('p', { className: 'hsr-note' }, outcome.restored ? `Put back ${plural(outcome.restored, 'file')} as before this message. The conversation is unchanged.` : 'Nothing needed putting back.'),
          h('div', { className: 'hsr-options' }, option('done', 'Done', null, onClose)))
      }
      if (stage === 'files-failed') {
        return h('div', { ref: list, onKeyDown: move },
          h('p', { className: 'hsr-error' }, `${plural(outcome.failed.length, 'file')} could not be put back; the others were.`),
          h('ul', { className: 'hsu-files' }, ...outcome.failed.slice(0, 6).map(f => h('li', { key: f.path }, `${shortPath(f.path)}: ${f.reason}`))),
          h('div', { className: 'hsr-options' },
            outcome.then === 'both' ? option('anyway', 'Restore conversation anyway', null, finishConversation) : null,
            option('cancel', outcome.then === 'both' ? 'Cancel' : 'Done', null, onClose)))
      }
      // Laid out like Claude Code's rewind dialog: the question, the message, a Restore menu, what it covers, and
      // Cancel / Rewind. The menu offers code only when the agent changed files from here on and has finished.
      // All three always listed; the two code ones are greyed out when there is no code to restore.
      const restores = [['both', 'Code and conversation', code], ['conversation', 'Conversation', true], ['code', 'Code', code]]
      const picked = restores.some(([value, , on]) => on && value === choice) ? choice : code ? 'both' : 'conversation'
      const named = files.slice(0, 3).map(f => shortPath(f.path) + (f.existed ? '' : ' (new)') + (f.restorable ? '' : ' (cannot be restored)')).join(', ')
      return h('div', { ref: list, className: 'hsr-body' },
        h('div', { className: 'hsr-title' }, 'Rewind to this message?'),
        text ? h('div', { className: 'hsr-quote' }, text) : null,
        h('div', { className: 'hsr-field' }, 'Restore'),
        h('select', { className: 'hsr-select', value: picked, disabled: working, 'aria-label': 'Restore', onChange: event => setChoice(event.target.value) },
          ...restores.map(([value, label, on]) => h('option', { key: value, value, disabled: !on }, on ? label : `${label} (${files.length > 0 ? 'agent still working' : 'no file changes'})`))),
        picked !== 'conversation' ? h('div', { className: 'hsr-files-line' }, plural(files.length, 'file'),
          totals ? h('span', { className: 'hsr-counts' }, h('span', { className: 'hsr-plus' }, `+${totals.added}`), h('span', { className: 'hsr-minus' }, `\u2212${totals.removed}`)) : null,
          h('span', { className: 'hsr-names' }, ' · ', named, files.length > 3 ? ` and ${files.length - 3} more` : '')) : null,
        files.length > 0 && !closed ? h('p', { className: 'hsr-note' }, 'Code cannot be restored while the agent is still working on this message.') : null,
        files.length === 0 && snapshot !== undefined ? h('p', { className: 'hsr-note' }, 'The agent changed no files with its file tools from here on, so there is no code to restore.') : null,
        picked !== 'conversation' ? h('p', { className: 'hsr-note' }, 'Changes made through shell commands aren\u2019t reverted. Commits stay in place.') : null,
        picked === 'conversation' && files.length > 0 ? h('p', { className: 'hsr-note' }, 'Files stay as they are now.') : null,
        outcome?.error ? h('p', { className: 'hsr-error' }, `Could not rewind: ${outcome.error}`) : null,
        h('div', { className: 'hsr-actions' },
          h('button', { type: 'button', className: 'hsr-btn', onClick: onClose }, 'Cancel'),
          h('button', { type: 'button', className: 'hsr-btn hsr-primary', disabled: working, onClick: () => run(picked) }, working ? 'Rewinding\u2026' : 'Rewind')))
    }

    /** The rewind button beside Copy on a message that started a turn, with its choices in a layer over the page. */
    function RewindAction({ sessionId, turn, opensTurn, text }) {
      const [open, setOpen] = useState(false)
      const [at, setAt] = useState(null)
      const button = useRef(null)
      const panel = useRef(null)
      useEffect(() => {
        if (!open) return
        const place = () => {
          const rect = button.current?.getBoundingClientRect()
          if (rect) setAt({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) })
        }
        place()
        const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false) } }
        const onDown = event => { if (!panel.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false) }
        const onScroll = event => { if (!panel.current?.contains(event.target)) setOpen(false) }
        document.addEventListener('keydown', onKey, true)
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', place)
        return () => {
          document.removeEventListener('keydown', onKey, true)
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('scroll', onScroll, true)
          window.removeEventListener('resize', place)
        }
      }, [open])
      if (!sessionId || !turn || !opensTurn) return null
      return h('span', { className: 'hsr-anchor' }, h('style', null, CSS),
        h('button', {
          ref: button, type: 'button', className: 'hsr-icon', 'aria-label': 'Rewind', title: 'Rewind',
          'aria-expanded': open, onClick: () => setOpen(!open),
        }, REWIND_ICON),
        open ? ReactDOM.createPortal(h('div', { className: 'hsr-backdrop' },
          h('style', null, CSS),
          h('div', { ref: panel, className: 'hsr-modal', role: 'dialog', 'aria-modal': true, 'aria-label': 'Rewind', tabIndex: -1 },
            h(RewindChoices, { sessionId, turn: turn.turn, closed: turn.status !== 'open', text, onClose: () => setOpen(false) }))), document.body) : null)
    }

    /**
     * Esc twice in an empty message box lists the messages that started a turn, newest last, as Claude Code's
     * CLI does; choosing one shows that message's rewind choices. It sits above this chat's composer.
     */
    function RewindPicker({ sessionId }) {
      const dock = useRef(null)
      const [open, setOpen] = useState(false)
      const [points, setPoints] = useState(null)
      const [selected, setSelected] = useState(0)
      const [chosen, setChosen] = useState(null)
      const [problem, setProblem] = useState(null)
      const state = useRef({})
      state.current = { open, points, selected, chosen }

      useEffect(() => {
        if (!sessionId) return
        let lastEscape = 0
        const ownsInput = (input) => {
          let node = input
          while (node && !node.querySelector?.('.hsr-dock')) node = node.parentElement
          return node?.querySelector('.hsr-dock') === dock.current
        }
        const onKey = (event) => {
          const { open, points, selected, chosen } = state.current
          if (open) {
            if (event.key === 'Escape') {
              event.preventDefault(); event.stopPropagation()
              if (chosen) setChosen(null)
              else setOpen(false)
              return
            }
            if (chosen || !points?.length) return
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault(); event.stopPropagation()
              setSelected(Math.min(points.length - 1, Math.max(0, selected + (event.key === 'ArrowDown' ? 1 : -1))))
            } else if (event.key === 'Enter') {
              event.preventDefault(); event.stopPropagation()
              setChosen(points[selected])
            }
            return
          }
          if (event.key !== 'Escape' || event.repeat) return
          const input = event.target?.closest?.('[data-composer-input]')
          if (!input || input.innerText.trim() !== '' || !ownsInput(input)) { lastEscape = 0; return }
          const now = Date.now()
          if (now - lastEscape > 600) { lastEscape = now; return }
          lastEscape = 0
          event.preventDefault(); event.stopPropagation()
          setOpen(true); setChosen(null); setPoints(null); setProblem(null)
          call({ action: 'messages', sessionId })
            .then((found) => { setPoints(found); setSelected(Math.max(0, found.length - 1)) })
            .catch(error => setProblem(errorText(error)))
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [sessionId])
      useEffect(() => { dock.current?.querySelector('[data-selected]')?.scrollIntoView?.({ block: 'nearest' }) }, [selected, points])

      const close = () => { setOpen(false); setChosen(null) }
      let body = null
      if (open && chosen) {
        body = h(RewindChoices, { sessionId, turn: chosen.turn, closed: chosen.closed, text: chosen.text, onClose: close })
      } else if (open) {
        body = [
          h('div', { key: 't', className: 'hsr-title' }, 'Rewind to an earlier message'),
          problem ? h('p', { key: 'e', className: 'hsr-error' }, `Could not list the messages: ${problem}`) : null,
          points === null && !problem ? h('p', { key: 'l', className: 'hsr-note' }, 'Loading…') : null,
          points?.length === 0 ? h('p', { key: 'n', className: 'hsr-note' }, 'There is no earlier message to rewind to.') : null,
          points?.length ? h('div', { key: 'list', className: 'hsr-list', role: 'listbox' }, ...points.map((point, index) => h('button', {
            key: point.seq, type: 'button', className: 'hsr-item', role: 'option', 'aria-selected': index === selected,
            ...(index === selected ? { 'data-selected': '' } : {}),
            onMouseEnter: () => setSelected(index), onClick: () => setChosen(point),
          }, h('span', null, point.text.replace(/\s+/g, ' ').trim() || '(no text)'), h('small', null, `turn ${point.turn}`)))) : null,
          h('p', { key: 'h', className: 'hsr-hint' }, '↑↓ to choose · Enter to rewind · Esc to close'),
        ]
      }
      return h('div', { ref: dock, className: 'hsr-dock' },
        open ? h('div', { className: 'hsr-picker', role: 'dialog', 'aria-label': 'Rewind' }, h('style', null, CSS), body) : null)
    }

    return {
      inject: ['slots', 'connection', 'sessions', 'uiWorkspace'],
      apply(ctx) {
        connection = ctx.connection
        sessions = ctx.sessions
        uiWorkspace = ctx.uiWorkspace
        ctx.effect(() => () => { connection = undefined; sessions = undefined; uiWorkspace = undefined }, 'Undo connection')
        ctx.effect(() => ctx.slots.inject('conversation.chat.user-actions', () => ctx.slots.register({
          name: 'conversation.chat.user-actions', id: '@harness-studio/undo/rewind', order: 100, inject: () => ({}),
        }, RewindAction)), 'Rewind on the messages that started a turn')
        ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock', id: '@harness-studio/undo/rewind-picker', order: 100, inject: () => ({}),
        }, RewindPicker)), 'Esc twice in an empty message box to rewind')
        ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail', id: '@harness-studio/undo', order: 100, inject: () => ({}),
        }, UndoRow)), 'Undo row under turns that changed files')
      },
    }
  },
})
