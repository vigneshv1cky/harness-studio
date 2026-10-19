// Client half of Undo: under each finished turn whose file changes were kept, a row offers to put those
// files back the way they were before that turn. It asks first, then reports what was restored. It talks to
// the Host half through the `harnessStudioUndo/call` Remote method (index.js).

window.__ModuleLoader__.load({
  id: '@harness-studio/undo',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState, useSyncExternalStore } = React

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

    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        connection = ctx.connection
        ctx.effect(() => () => { connection = undefined }, 'Undo connection')
        ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail', id: '@harness-studio/undo', order: 100, inject: () => ({}),
        }, UndoRow)), 'Undo row under turns that changed files')
      },
    }
  },
})
