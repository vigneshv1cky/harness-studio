// Client half of Sessions (hand-written loader format, no build step).
//
//   - The approval card: when `start_session` asks "start this as a separate session?", Harness would show
//     its generic question form. This half claims that one question (its id is START_QUESTION_ID) in the
//     composer chain, ahead of the generic form, and draws a compact card like Claude Code desktop's:
//     eyebrow, title, a two-line brief, one quiet context line, and Options / Do it here / Start. The answer
//     goes back through Harness's own question carrier, so the Host half's wait is unchanged. Every other
//     question still gets Harness's form.
//   - The tool row: a `start_session` call shows as one line — waiting for your choice, Started <title>
//     with an Open link to the new session, Kept here, or why it could not start.
window.__ModuleLoader__.load({
  id: '@harness-studio/sessions',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState, useSyncExternalStore } = React

    const START_QUESTION_ID = 'harness-studio/start-session'
    const START = 'Start'
    const DO_IT_HERE = 'Do it here'
    const STYLE_ID = 'harness-studio-sessions-style'

    // Theme tokens only, so the card follows light and dark mode with the rest of the app.
    const CSS = `
/* Seated in the composer column like Claude Code desktop's card: above the message box, which stays usable.
   Harness hides its composer while a card holds the seat (display: none on the composer's wrapper); for this
   card only, show it again and put the card first. */
[data-composer-seat] > div:has(> .hs-ss-frame) > div[style*="display: none"]:has(> [class*="composerStack"]) { display: block !important; }
.hs-ss-frame { order: -1; display: flex; justify-content: center; width: 100%; box-sizing: border-box; padding: 4px calc(var(--dsh-composer-side-clearance, 0px) + 16px) 8px; }
.hs-ss-card { box-sizing: border-box; width: 100%; max-width: min(680px, var(--dsh-chat-content-width, 680px)); overflow: hidden; border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 18px; outline: none; }
.hs-ss-head { display: flex; align-items: center; height: 32px; padding: 0 6px 0 14px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--dsw-alias-bg-base)); border-bottom: 1px solid var(--dsw-alias-border-l2); }
.hs-ss-eyebrow { flex: 1; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.hs-ss-body { padding: 8px 14px 6px; }
.hs-ss-title { font-size: 14px; line-height: 20px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hs-ss-brief { margin-top: 2px; line-height: 17px; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; overflow-wrap: anywhere; cursor: pointer; }
.hs-ss-brief.hs-ss-clamped { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.hs-ss-brief.hs-ss-open { max-height: 170px; overflow: auto; }
.hs-ss-context { margin-top: 4px; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hs-ss-options { margin: 0 14px 8px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l2); display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.hs-ss-options label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.hs-ss-actions { display: flex; align-items: center; gap: 8px; padding: 0 14px 10px; }
.hs-ss-spacer { flex: 1; }
.hs-ss-btn { height: 28px; padding: 0 13px; border-radius: 8px; font: inherit; font-size: 13px; line-height: 26px; cursor: pointer; white-space: nowrap; }
.hs-ss-btn:disabled { opacity: .5; cursor: default; }
.hs-ss-btn:focus-visible, .hs-ss-text:focus-visible, .hs-ss-close:focus-visible, .hs-ss-link:focus-visible { outline: 2px solid var(--dsw-alias-button-primary-fill); outline-offset: 1px; }
.hs-ss-secondary { border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); }
.hs-ss-secondary:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.hs-ss-primary { border: 1px solid transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); font-weight: 500; }
.hs-ss-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.hs-ss-text { height: 28px; padding: 0 8px; margin-left: -8px; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; cursor: pointer; }
.hs-ss-text:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.hs-ss-close { flex: none; width: 22px; height: 22px; display: grid; place-items: center; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.hs-ss-close:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.hs-ss-error { margin-top: 6px; font-size: 12px; color: var(--dsw-alias-label-error); }
.hs-ss-row { display: flex; align-items: center; gap: 6px; min-height: 24px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.hs-ss-row .hs-ss-what { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hs-ss-row strong { font-weight: 500; color: var(--dsw-alias-label-primary); }
.hs-ss-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); }
.hs-ss-dot.hs-ss-ok { background: #22a55b; }
.hs-ss-dot.hs-ss-wait { background: var(--dsw-alias-button-primary-fill); }
.hs-ss-dot.hs-ss-bad { background: var(--dsw-alias-label-error); }
.hs-ss-link { border: none; background: none; padding: 0 2px; border-radius: 4px; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); text-decoration: underline;
  text-underline-offset: 2px; cursor: pointer; }
.hs-ss-muted { color: var(--dsw-alias-label-tertiary); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`

    /** The carrier Harness hands the composer for our question, or null for anything else. */
    function startQuestion(pending) {
      if (!pending || typeof pending !== 'object' || typeof pending.answer !== 'function') return null
      if (pending.review !== undefined) return null
      const questions = pending.questions
      return Array.isArray(questions) && questions.length === 1 && questions[0]?.id === START_QUESTION_ID ? pending : null
    }

    /** The Host half writes "context line", a blank line, then the brief (see cardDetail in logic.js). */
    function splitDetail(detail) {
      const text = typeof detail === 'string' ? detail : ''
      const cut = text.indexOf('\n\n')
      return cut === -1 ? { context: '', brief: text } : { context: text.slice(0, cut), brief: text.slice(cut + 2) }
    }

    const CloseIcon = () => h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true },
      h('path', { d: 'M2.5 2.5l7 7M9.5 2.5l-7 7', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))

    function StartCard({ matched }) {
      const snapshot = useSyncExternalStore(matched.subscribe, matched.getSnapshot)
      const question = matched.questions[0]
      const { context, brief } = splitDetail(question.detail)
      const [folder, ...rest] = context.split(' · ')
      const askedWorktree = rest.length > 0
      const [worktree, setWorktree] = useState(askedWorktree)
      const [briefOpen, setBriefOpen] = useState(false)
      const [optionsOpen, setOptionsOpen] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(undefined)
      const startRef = useRef(null)
      useEffect(() => { startRef.current?.focus({ preventScroll: true }) }, [])
      if (snapshot?.closed) return null

      const contextLine = worktree ? (askedWorktree ? context : `${folder} · new worktree`) : folder
      const decide = (start) => {
        if (busy) return
        setBusy(true)
        setError(undefined)
        const item = { id: START_QUESTION_ID, selected: [start ? START : DO_IT_HERE] }
        if (start && worktree !== askedWorktree) item.custom = JSON.stringify({ worktree })
        matched.answer({ answers: [item] }).catch((reason) => {
          setBusy(false)
          setError(reason?.message ?? String(reason))
        })
      }
      const onKeyDown = (event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return
        const target = event.target
        if (target instanceof HTMLButtonElement || target instanceof HTMLInputElement) return
        event.preventDefault()
        decide(true)
      }

      return h('div', { className: 'hs-ss-frame' }, h('div', { className: 'hs-ss-card', role: 'dialog', 'aria-label': `New session: ${question.question}`, tabIndex: -1, onKeyDown },
        h('div', { className: 'hs-ss-head' },
          h('span', { className: 'hs-ss-eyebrow' }, question.header || 'New session'),
          h('button', { type: 'button', className: 'hs-ss-close', 'aria-label': 'Close (do it here)', title: 'Do it here', disabled: busy, onClick: () => decide(false) }, h(CloseIcon))),
        h('div', { className: 'hs-ss-body' },
          h('div', { className: 'hs-ss-title', title: question.question }, question.question),
          brief ? h('div', {
            className: 'hs-ss-brief ' + (briefOpen ? 'hs-ss-open' : 'hs-ss-clamped'),
            role: 'button', tabIndex: 0, 'aria-expanded': briefOpen,
            onClick: () => setBriefOpen(open => !open),
            onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setBriefOpen(open => !open) } },
          }, brief) : null,
          contextLine ? h('div', { className: 'hs-ss-context' }, contextLine) : null,
          error ? h('div', { className: 'hs-ss-error', role: 'alert' }, error) : null),
        optionsOpen ? h('div', { className: 'hs-ss-options' },
          h('label', null,
            h('input', { type: 'checkbox', checked: worktree, disabled: busy, onChange: event => setWorktree(event.target.checked) }),
            'Work in a new git worktree on its own branch'),
          h('div', null, 'Model: your default model')) : null,
        h('div', { className: 'hs-ss-actions' },
          h('button', { type: 'button', className: 'hs-ss-text', 'aria-expanded': optionsOpen, disabled: busy, onClick: () => setOptionsOpen(open => !open) }, 'Options'),
          h('span', { className: 'hs-ss-spacer' }),
          h('button', { type: 'button', className: 'hs-ss-btn hs-ss-secondary', disabled: busy, onClick: () => decide(false) }, DO_IT_HERE),
          h('button', { type: 'button', ref: startRef, className: 'hs-ss-btn hs-ss-primary', disabled: busy, onClick: () => decide(true) }, START))))
    }

    // ---- the start_session tool row ------------------------------------------------------------------
    function parseArgs(raw) {
      try { const value = JSON.parse(raw ?? ''); return value && typeof value === 'object' ? value : {} } catch { return {} }
    }

    function resultText(block) {
      return (Array.isArray(block?.content) ? block.content : []).filter(part => part?.type === 'text').map(part => part.text).join('\n')
    }

    function outcomeOf(block, text) {
      const meta = block?.meta
      if (meta && typeof meta === 'object' && typeof meta.outcome === 'string') return meta
      const started = /^Started session ".*" \((session-[^)\s]+)\)/.exec(text)
      if (started) return { outcome: 'started', sessionId: started[1] }
      if (/^(The user chose to do this here|Nothing was started)/.test(text)) return { outcome: 'kept' }
      return { outcome: 'other' }
    }

    function makeStartRow(openSession) {
      return function StartSessionRow(props) {
        const block = props.block
        const args = parseArgs(props.phase === 'result' ? block?.call?.argsRaw : block?.argsRaw)
        const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : 'a session'
        const row = (tone, ...children) => h('div', { className: 'hs-ss-row', 'data-testid': 'harness-studio-start-session' },
          h('span', { className: 'hs-ss-dot ' + tone }), ...children)
        if (props.phase !== 'result') {
          return args.initiation === 'proposal'
            ? row('hs-ss-wait', h('span', { className: 'hs-ss-what' }, 'New session ', h('strong', null, title), ' — waiting for your choice'))
            : row('hs-ss-wait', h('span', { className: 'hs-ss-what' }, 'Starting ', h('strong', null, title), '…'))
        }
        const text = resultText(block)
        const outcome = outcomeOf(block, text)
        if (!block?.isError && outcome.outcome === 'started') {
          return row('hs-ss-ok',
            h('span', { className: 'hs-ss-what' }, 'Started ', h('strong', null, title)),
            outcome.sessionId && openSession ? h('button', { type: 'button', className: 'hs-ss-link', onClick: () => openSession(outcome.sessionId) }, 'Open') : null)
        }
        if (!block?.isError && outcome.outcome === 'kept') {
          return row('', h('span', { className: 'hs-ss-what' }, 'Kept here · ', h('strong', null, title)))
        }
        const firstLine = (block?.isError ? (text || block?.error?.message || '') : text).split('\n')[0]
        return row(block?.isError ? 'hs-ss-bad' : '',
          h('span', { className: 'hs-ss-what' }, block?.isError ? 'Could not start ' : 'Not started · ', h('strong', null, title)),
          firstLine ? h('span', { className: 'hs-ss-muted', title: firstLine }, firstLine) : null)
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.id = STYLE_ID
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'sessions card styles')

        // Ahead of Harness's generic question form (priority 0) for our question only.
        ctx.effect(() => ctx.slots.inject('conversation.composer', () => ctx.slots.register({
          name: 'conversation.composer',
          priority: -10,
          select: ({ pendingInteraction }) => startQuestion(pendingInteraction),
        }, StartCard)), 'start-session card')

        const openSession = (sessionId) => { ctx.get('uiWorkspace')?.openSession(sessionId) }
        ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview', key: 'start_session',
        }, makeStartRow(openSession))), 'start_session row')
      },
    }
  },
})
