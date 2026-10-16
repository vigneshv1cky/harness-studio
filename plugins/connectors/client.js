// Client half of Connectors:
//   - a "Connectors" page in Settings to add MCP servers by URL or command, sign in, see status and
//     tools, turn them off, edit or remove them;
//   - a "Connectors" entry in the composer's + menu that turns each connector on or off for the
//     current Session (or signs in when one needs it).
// Both talk to the Host half through its local helper on 127.0.0.1 (see helper.js).

window.__ModuleLoader__.load({
  id: '@harness-studio/connectors',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState, useCallback } = React

    // ---- helper --------------------------------------------------------------------------------
    // The Host half's helper needs a key that changes at every launch. The Client asks its own Host
    // for the port and key over Harness's authenticated channel (the `harnessStudioConnectors/helper`
    // Remote method, see index.js), so it never scans ports and never reaches another Harness's helper.
    const HELPER_ENDPOINT = 'harnessStudioConnectors/helper'
    const KEY_HEADER = 'x-connectors-key'
    let connection
    let helper // { base, key }
    let finding

    async function findHelper() {
      if (helper) return helper
      finding ??= (async () => {
        if (!connection?.rpc) throw new Error('The Connectors helper is not reachable: Harness did not provide its connection. Reload Harness.')
        for (let attempt = 0; ; attempt++) {
          let result
          try {
            result = await connection.rpc.call('/api', HELPER_ENDPOINT, { args: {} })
          } catch (error) {
            throw new Error(`The Connectors helper is not reachable (${String(error.message ?? error)}). Reload Harness after installing or updating the plugin.`)
          }
          if (!result?.ok) throw new Error(`The Connectors helper is not running (${result?.error?.message ?? 'no answer'}). Restart Harness after installing or updating the plugin.`)
          const value = result.value ?? {}
          if (value.service === 'harness-studio-connectors' && Number.isInteger(value.port) && typeof value.key === 'string') {
            return (helper = { base: `http://127.0.0.1:${value.port}`, key: value.key })
          }
          // The Host is still loading saved connectors; ask again shortly.
          if (!value.starting || attempt >= 40) throw new Error('The Connectors helper did not start. Restart Harness.')
          await new Promise(resolve => setTimeout(resolve, 250))
        }
      })().finally(() => { finding = undefined })
      return finding
    }

    /** Call the helper; throws with its error message. */
    async function api(method, route, body, retried = false) {
      const { base, key } = await findHelper()
      let response
      try {
        response = await fetch(base + route, {
          method,
          headers: { [KEY_HEADER]: key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      } catch (error) {
        helper = undefined
        throw error
      }
      // A restarted Host half has a new port and key: look them up again once.
      if (response.status === 401 && !retried) { helper = undefined; return api(method, route, body, true) }
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`)
      return json
    }

    /** Poll the connector list while mounted. */
    function useConnectors(sessionId, intervalMs = 1500) {
      const [state, setState] = useState({ loading: true, connectors: [], error: undefined })
      const [tick, setTick] = useState(0)
      const refresh = useCallback(() => setTick(t => t + 1), [])
      useEffect(() => {
        let stopped = false
        let timer
        const load = async () => {
          try {
            const result = await api('GET', '/connectors' + (sessionId ? '?session=' + encodeURIComponent(sessionId) : ''))
            if (!stopped) setState({ loading: false, connectors: result.connectors, file: result.file, error: result.loadError ? `Connectors could not be read: ${result.loadError}` : undefined })
          } catch (error) {
            if (!stopped) setState(s => ({ ...s, loading: false, error: String(error.message ?? error) }))
          }
          if (!stopped) timer = setTimeout(load, intervalMs)
        }
        load()
        return () => { stopped = true; clearTimeout(timer) }
      }, [sessionId, tick, intervalMs])
      return [state, refresh]
    }

    // ---- presentation ----------------------------------------------------------------------------
    const STATUS = {
      connected: { label: 'Connected', color: 'var(--dsw-alias-state-success-primary)' },
      connecting: { label: 'Connecting…', color: 'var(--dsw-alias-state-warn-primary)' },
      'needs-auth': { label: 'Needs sign-in', color: 'var(--dsw-alias-state-warn-primary)' },
      failed: { label: 'Not connected', color: 'var(--dsw-alias-state-error-primary)' },
      disabled: { label: 'Off', color: 'var(--dsw-alias-state-idle-primary)' },
    }
    const toolCount = n => `${n} tool${n === 1 ? '' : 's'}`

    const pageOf = uri => { try { const u = new URL(uri); return u.host + u.pathname } catch { return uri } }

    function statusLine(c) {
      if (c.device) return `Enter code ${c.device.userCode} at ${pageOf(c.device.verificationUri)}`
      if (c.authorizing && c.status === 'needs-auth') return 'Waiting for sign-in in your browser…'
      if (c.status === 'connected') return `Connected · ${toolCount(c.tools.length)}`
      if (c.status === 'needs-auth') return c.loginError ? `Needs sign-in · ${c.loginError}` : 'Needs sign-in'
      if (c.status === 'failed') return c.error ? `Not connected · ${c.error}` : 'Not connected'
      return STATUS[c.status]?.label ?? c.status
    }

    function where(c) {
      if (c.transport === 'http') {
        try { const url = new URL(c.url); return url.host + (url.pathname === '/' ? '' : url.pathname) } catch { return c.url }
      }
      return [c.command, ...(c.args ?? [])].join(' ')
    }

    const CSS = `
      .hsc { display: flex; flex-direction: column; color: var(--dsw-alias-label-primary); font-size: 14px; }
      .hsc-intro { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 4px 0 14px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
      .hsc-title { font-size: 14px; line-height: 22px; }
      /* The Connectors page matches the Plugins page: centred 960px column, 20/28 title, 13/20 intro. */
      .hsc-page { box-sizing: border-box; height: 100%; display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 0 clamp(24px, 4vw, 48px) 48px; overflow: auto; color: var(--dsw-alias-label-primary); }
      .hsc-page > * { width: 100%; max-width: 960px; }
      .hsc-page-head { box-sizing: border-box; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 16px; padding-top: 28px; }
      [data-platform="darwin"] .hsc-page-head { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
      .hsc-page-heading { flex: 1 1 0; min-width: 0; max-width: 100%; }
      .hsc-page-title { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; }
      .hsc-page-intro { margin: 4px 0 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
      .hsc-page > .hsc { border-top: 0.5px solid var(--dsw-alias-border-l2); }
      .hsc-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
      .hsc-row { border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
      .hsc-head { display: flex; align-items: center; gap: 12px; padding: 14px 0; cursor: pointer; }
      .hsc-head:hover .hsc-name { text-decoration: underline; text-decoration-color: var(--dsw-alias-border-l3); text-underline-offset: 3px; }
      .hsc-main { flex: 1; min-width: 0; }
      .hsc-name { display: flex; align-items: center; gap: 8px; }
      .hsc-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
      .hsc-sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .hsc-actions { display: flex; align-items: center; gap: 8px; flex: none; }
      .hsc-btn { height: 28px; padding: 0 10px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; white-space: nowrap; }
      .hsc-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .hsc-btn:disabled { opacity: 0.5; cursor: default; }
      .hsc-btn.primary { background: var(--dsw-alias-button-primary-fill); border-color: transparent; color: var(--dsw-alias-bg-layer-1); }
      .hsc-btn.primary:hover { background: var(--dsw-alias-button-primary-hover); }
      .hsc-btn.danger { color: var(--dsw-alias-state-error-primary); }
      .hsc-btn.danger:hover { background: var(--dsw-alias-interactive-bg-hover-danger); }
      .hsc-switch { width: 36px; height: 20px; border-radius: 10px; border: none; padding: 0; position: relative; cursor: pointer; background: var(--dsw-alias-state-idle-primary); flex: none; }
      .hsc-switch[aria-checked="true"] { background: var(--dsw-alias-button-primary-fill); }
      .hsc-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: transform 120ms; }
      .hsc-switch[aria-checked="true"]::after { transform: translateX(16px); }
      .hsc-body { padding: 0 0 14px 15px; display: flex; flex-direction: column; gap: 10px; }
      .hsc-kv { display: grid; grid-template-columns: 96px 1fr; gap: 4px 12px; font-size: 12px; line-height: 18px; }
      .hsc-kv dt { color: var(--dsw-alias-label-tertiary); }
      .hsc-kv dd { margin: 0; word-break: break-all; font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, monospace); }
      .hsc-tools { display: flex; flex-direction: column; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 10px; overflow: hidden; }
      .hsc-tool { padding: 8px 12px; border-top: 0.5px solid var(--dsw-alias-border-l2); font-size: 12px; line-height: 18px; }
      .hsc-tool:first-child { border-top: none; }
      .hsc-tool b { font-weight: 500; font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, monospace); }
      .hsc-tool span { display: block; color: var(--dsw-alias-label-tertiary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .hsc-error { font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); white-space: pre-wrap; word-break: break-word; }
      .hsc-code { margin: 0 0 14px 15px; padding: 10px 12px; border-radius: 10px; background: var(--dsw-alias-state-business-tertiary); display: flex; flex-direction: column; gap: 6px; }
      .hsc-code-row { display: flex; align-items: center; gap: 12px; }
      .hsc-code-value { font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, monospace); font-size: 18px; line-height: 24px; letter-spacing: 2px; font-weight: 600; }
      .hsc-presets { display: flex; align-items: center; gap: 8px; }
      .hsc-empty { padding: 28px 0; text-align: center; }
      .hsc-form { display: flex; flex-direction: column; gap: 12px; padding: 16px; margin: 14px 0; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 12px; }
      .hsc-field { display: flex; flex-direction: column; gap: 6px; }
      .hsc-field label { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .hsc-input { height: 32px; padding: 0 10px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: inherit; font: inherit; font-size: 13px; }
      textarea.hsc-input { height: auto; min-height: 56px; padding: 7px 10px; resize: vertical; font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, monospace); font-size: 12px; line-height: 18px; }
      .hsc-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
      .hsc-segment { display: inline-flex; padding: 2px; gap: 2px; border-radius: 9px; background: var(--dsw-alias-interactive-bg-hover); align-self: flex-start; }
      .hsc-segment button { height: 26px; padding: 0 12px; border: none; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
      .hsc-segment button[aria-pressed="true"] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l3); }
      .hsc-form-actions { display: flex; justify-content: flex-end; gap: 8px; }
      .hsc :is(button, .hsc-head):focus:not(:focus-visible) { outline: none; }
    `
    function useCss() {
      useEffect(() => {
        // Replace the text each time so a reloaded plugin brings its new styles.
        let style = document.getElementById('hsc-css')
        if (!style) {
          style = document.createElement('style')
          style.id = 'hsc-css'
          document.head.append(style)
        }
        if (style.textContent !== CSS) style.textContent = CSS
        return undefined
      }, [])
    }

    // ---- form ----------------------------------------------------------------------------------
    const pairsToText = (record, sep) => Object.entries(record ?? {}).map(([k, v]) => `${k}${sep}${v}`).join('\n')
    function textToPairs(text, sep) {
      const out = {}
      for (const line of text.split('\n')) {
        const at = line.indexOf(sep)
        if (at <= 0) continue
        out[line.slice(0, at).trim()] = line.slice(at + sep.length).trim()
      }
      return out
    }

    /** Servers that sign in with an OAuth app built into the plugin. */
    const PRESETS = [{ name: 'GitHub', url: 'https://api.githubcopilot.com/mcp/' }]

    // Stored header and environment values come back masked; a line left as `Name: ••••••••` keeps the
    // stored value, a new value replaces it, and a removed line removes it. The client secret is never
    // shown: leave it blank to keep the saved one.
    function ConnectorForm({ initial, onDone, onCancel }) {
      const editing = Boolean(initial)
      const [kind, setKind] = useState(initial?.transport ?? 'http')
      const [clearSecret, setClearSecret] = useState(false)
      const [fields, setFields] = useState(() => ({
        name: initial?.name ?? '',
        url: initial?.url ?? '',
        headers: pairsToText(initial?.headers, ': '),
        clientId: initial?.clientId ?? '',
        clientSecret: '',
        command: initial?.command ?? '',
        args: (initial?.args ?? []).join('\n'),
        env: pairsToText(initial?.env, '='),
        cwd: initial?.cwd ?? '',
      }))
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState()
      const set = key => event => setFields(f => ({ ...f, [key]: event.target.value }))
      const submit = async (event) => {
        event.preventDefault()
        setBusy(true)
        setError(undefined)
        const body = kind === 'http'
          ? { name: fields.name, transport: 'http', url: fields.url, headers: textToPairs(fields.headers, ':'), clientId: fields.clientId, clientSecret: fields.clientSecret, ...(clearSecret ? { clearClientSecret: true } : {}) }
          : { name: fields.name, transport: 'stdio', command: fields.command, args: fields.args.split('\n').map(s => s.trim()).filter(Boolean), env: textToPairs(fields.env, '='), cwd: fields.cwd }
        try {
          const saved = editing ? await api('PUT', `/connectors/${encodeURIComponent(initial.id)}`, body) : await api('POST', '/connectors', body)
          onDone(saved)
        } catch (err) {
          setError(String(err.message ?? err))
          setBusy(false)
        }
      }
      const formRef = useRef(null)
      useEffect(() => { formRef.current?.scrollIntoView({ block: 'nearest' }) }, [])
      const field = (label, input, hint) => h('div', { className: 'hsc-field' }, h('label', null, label), input, hint ? h('div', { className: 'hsc-desc' }, hint) : null)
      return h('form', { ref: formRef, className: 'hsc-form', onSubmit: submit, 'data-testid': 'hsc-form' },
        h('div', { className: 'hsc-title' }, editing ? `Edit ${initial.name}` : 'Add connector'),
        editing ? null : h('div', { className: 'hsc-segment', role: 'group', 'aria-label': 'Connector type' },
          h('button', { type: 'button', 'aria-pressed': kind === 'http', onClick: () => setKind('http') }, 'Remote URL'),
          h('button', { type: 'button', 'aria-pressed': kind === 'stdio', onClick: () => setKind('stdio') }, 'Local command')),
        !editing && kind === 'http' ? h('div', { className: 'hsc-presets' },
          h('span', { className: 'hsc-desc' }, 'Quick add:'),
          PRESETS.map(preset => h('button', { key: preset.name, type: 'button', className: 'hsc-btn', onClick: () => setFields(f => ({ ...f, name: preset.name, url: preset.url })) }, preset.name))) : null,
        field('Name', h('input', { className: 'hsc-input', value: fields.name, onChange: set('name'), placeholder: kind === 'http' ? 'Linear' : 'Filesystem', autoFocus: !editing, required: true })),
        kind === 'http' ? [
          field('Server URL', h('input', { key: 'url', className: 'hsc-input', value: fields.url, onChange: set('url'), placeholder: 'https://mcp.example.com/mcp', required: true }),
            'Streamable HTTP or SSE. Servers that need an account show a Sign in button once added.'),
          field('Headers (optional)', h('textarea', { key: 'headers', className: 'hsc-input', value: fields.headers, onChange: set('headers'), placeholder: 'Authorization: Bearer …', rows: 2 }),
            editing ? 'One per line, as Name: value. Saved values show as ••••••••; leave them to keep them.' : 'One per line, as Name: value. Use this for servers that take an API key instead of sign-in.'),
          field('OAuth client ID (optional)', h('input', { key: 'client', className: 'hsc-input', value: fields.clientId, onChange: set('clientId'), placeholder: 'Only for servers that do not register clients automatically' }),
            'For servers such as GitHub, create an OAuth app whose callback URL is http://127.0.0.1:47620/oauth/callback.'),
          field('OAuth client secret (optional)', h('input', { key: 'secret', className: 'hsc-input', type: 'password', autoComplete: 'off', value: fields.clientSecret, onChange: set('clientSecret'), disabled: clearSecret,
            placeholder: initial?.clientSecretSet ? 'Saved · leave blank to keep it' : 'If the OAuth app has one' }),
          initial?.clientSecretSet ? h('label', { key: 'clear', className: 'hsc-desc', style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('input', { type: 'checkbox', checked: clearSecret, onChange: e => setClearSecret(e.target.checked) }), 'Remove the saved secret') : null),
        ] : [
          field('Command', h('input', { key: 'command', className: 'hsc-input', value: fields.command, onChange: set('command'), placeholder: 'npx', required: true })),
          field('Arguments', h('textarea', { key: 'args', className: 'hsc-input', value: fields.args, onChange: set('args'), placeholder: '-y\n@modelcontextprotocol/server-filesystem\n/Users/me/projects', rows: 3 }), 'One per line.'),
          field('Environment (optional)', h('textarea', { key: 'env', className: 'hsc-input', value: fields.env, onChange: set('env'), placeholder: 'API_KEY=…', rows: 2 }), editing ? 'One per line, as NAME=value. Saved values show as ••••••••; leave them to keep them.' : 'One per line, as NAME=value.'),
          field('Working folder (optional)', h('input', { key: 'cwd', className: 'hsc-input', value: fields.cwd, onChange: set('cwd'), placeholder: '/absolute/path' })),
        ],
        error ? h('div', { className: 'hsc-error', role: 'alert' }, error) : null,
        h('div', { className: 'hsc-form-actions' },
          h('button', { type: 'button', className: 'hsc-btn', onClick: onCancel }, 'Cancel'),
          h('button', { type: 'submit', className: 'hsc-btn primary', disabled: busy }, busy ? 'Saving…' : editing ? 'Save' : 'Add')))
    }

    // ---- Settings page -------------------------------------------------------------------------
    function ConnectorRow({ connector: c, onChanged, onEdit }) {
      const [open, setOpen] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState()
      const run = (fn) => async (event) => {
        event?.stopPropagation()
        setBusy(true)
        setError(undefined)
        try { await fn() } catch (err) { setError(String(err.message ?? err)) }
        setBusy(false)
        onChanged()
      }
      const [copied, setCopied] = useState(false)
      const copy = (text) => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => {}) }
      const status = STATUS[c.status] ?? STATUS.failed
      const signIn = run(async () => {
        const result = await api('POST', `/connectors/${c.id}/login`, {})
        if (result.device) copy(result.device.userCode)
      })
      return h('div', { className: 'hsc-row', 'data-testid': 'hsc-connector', 'data-connector': c.id, 'data-status': c.status },
        h('div', { className: 'hsc-head', onClick: () => setOpen(o => !o), role: 'button', tabIndex: 0, 'aria-expanded': open,
          onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } } },
        h('div', { className: 'hsc-main' },
          h('div', { className: 'hsc-name hsc-title' }, h('span', { className: 'hsc-dot', style: { background: status.color }, 'aria-hidden': true }), c.name),
          h('div', { className: 'hsc-desc hsc-sub', title: statusLine(c) }, statusLine(c))),
        h('div', { className: 'hsc-actions' },
          c.status === 'needs-auth' ? h('button', { type: 'button', className: 'hsc-btn primary', disabled: busy, onClick: signIn }, c.device ? 'New code' : c.authorizing ? 'Open sign-in again' : 'Sign in') : null,
          c.status === 'failed' ? h('button', { type: 'button', className: 'hsc-btn', disabled: busy, onClick: run(() => api('POST', `/connectors/${c.id}/reconnect`, {})) }, 'Retry') : null,
          h('button', {
            type: 'button', role: 'switch', className: 'hsc-switch', 'aria-checked': c.enabled, 'aria-label': `${c.name} on`, disabled: busy,
            onClick: run(() => api('POST', `/connectors/${c.id}/enabled`, { enabled: !c.enabled })),
          }))),
      c.device ? h('div', { className: 'hsc-code', 'data-testid': 'hsc-device-code' },
        h('div', { className: 'hsc-desc' }, `Enter this code at ${pageOf(c.device.verificationUri)}, then approve:`),
        h('div', { className: 'hsc-code-row' },
          h('span', { className: 'hsc-code-value' }, c.device.userCode),
          h('button', { type: 'button', className: 'hsc-btn', onClick: (e) => { e.stopPropagation(); copy(c.device.userCode) } }, copied ? 'Copied' : 'Copy code'))) : null,
      // A failed Sign in / Retry / switch shows on the row itself, not only inside the details.
      error && !open ? h('div', { className: 'hsc-error', role: 'alert', style: { padding: '0 0 12px 15px' } }, error) : null,
      open ? h('div', { className: 'hsc-body' },
        h('dl', { className: 'hsc-kv' },
          h('dt', null, c.transport === 'http' ? 'URL' : 'Command'), h('dd', null, c.transport === 'http' ? c.url : where(c)),
          c.server ? [h('dt', { key: 'st' }, 'Server'), h('dd', { key: 'sd' }, `${c.server.name ?? ''} ${c.server.version ?? ''}`.trim())] : null,
          c.transport === 'http' ? [h('dt', { key: 'at' }, 'Account'), h('dd', { key: 'ad' }, c.signedIn ? 'Signed in' : Object.keys(c.headers ?? {}).length ? 'Headers' : 'None')] : null),
        c.status === 'failed' && c.error ? h('div', { className: 'hsc-error' }, c.error) : null,
        error ? h('div', { className: 'hsc-error', role: 'alert' }, error) : null,
        c.tools.length ? h('div', { className: 'hsc-tools' }, c.tools.map(t => h('div', { key: t.name, className: 'hsc-tool' },
          h('b', null, t.title || t.name), t.description ? h('span', null, t.description) : null,
          c.toolErrors?.[t.publicName] ? h('div', { className: 'hsc-error' }, 'Not available to the agent: ' + c.toolErrors[t.publicName]) : null))) : null,
        h('div', { className: 'hsc-actions' },
          h('button', { type: 'button', className: 'hsc-btn', disabled: busy, onClick: run(() => api('POST', `/connectors/${c.id}/reconnect`, {})) }, 'Reconnect'),
          c.signedIn ? h('button', { type: 'button', className: 'hsc-btn', disabled: busy, onClick: run(() => api('POST', `/connectors/${c.id}/logout`, {})) }, 'Sign out') : null,
          h('button', { type: 'button', className: 'hsc-btn', disabled: busy, onClick: (e) => { e.stopPropagation(); onEdit(c) } }, 'Edit'),
          h('button', {
            type: 'button', className: 'hsc-btn danger', disabled: busy,
            onClick: run(async () => { if (window.confirm(`Remove ${c.name}? Its sign-in is deleted too.`)) await api('DELETE', `/connectors/${c.id}`) }),
          }, 'Remove'))) : null)
    }

    /**
     * The connector list with its add form. In Settings it opens with a small intro row; as a page
     * of its own (the sidebar's Connectors entry) it takes the Plugins page's header and column.
     */
    function ConnectorsSection({ page = false } = {}) {
      useCss()
      const [state, refresh] = useConnectors(undefined)
      const [form, setForm] = useState(null) // null | 'add' | connector
      const done = () => { setForm(null); refresh() }
      const description = 'Give the agent tools from MCP servers. Every connector is on in new sessions; turn one off for a session from the + menu in the message box.'
      const addButton = form === 'add' ? null : h('button', { type: 'button', className: 'hsc-btn', onClick: () => setForm('add'), 'data-testid': 'hsc-add' }, 'Add connector')
      const body = [
        form === 'add' ? h(ConnectorForm, { key: 'add', onDone: done, onCancel: () => setForm(null) }) : null,
        state.error ? h('div', { key: 'error', className: 'hsc-error', style: { padding: '14px 0' } }, state.error) : null,
        !state.loading && !state.error && state.connectors.length === 0 && !form
          ? h('div', { key: 'empty', className: 'hsc-empty hsc-desc' }, 'No connectors yet. Add a remote MCP server by its URL, or a local one by the command that starts it.')
          : null,
        // The edit form takes the row's place, so it opens where Edit was clicked rather than above the list.
        ...state.connectors.map(c => (form && form !== 'add' && form.id === c.id
          ? h(ConnectorForm, { key: 'edit-' + c.id, initial: c, onDone: done, onCancel: () => setForm(null) })
          : h(ConnectorRow, { key: c.id, connector: c, onChanged: refresh, onEdit: setForm }))),
      ]
      if (page) {
        return h('section', { className: 'hsc-page', 'data-testid': 'hsc-page' },
          h('header', { className: 'hsc-page-head' },
            h('div', { className: 'hsc-page-heading' },
              h('h1', { className: 'hsc-page-title' }, 'Connectors'),
              h('div', { className: 'hsc-page-intro' }, description)),
            addButton),
          h('div', { className: 'hsc', 'data-testid': 'hsc-section' }, ...body))
      }
      return h('div', { className: 'hsc', 'data-testid': 'hsc-section' },
        h('div', { className: 'hsc-intro' },
          h('div', null,
            h('div', { className: 'hsc-title' }, 'Connectors'),
            h('div', { className: 'hsc-desc' }, description)),
          addButton),
        ...body)
    }

    const ConnectorsPage = () => h(ConnectorsSection, { page: true })

    // ---- + menu --------------------------------------------------------------------------------
    function PlugIcon({ size = 16, className }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', className, 'aria-hidden': true },
        h('path', { d: 'M6 1.75v3M10 1.75v3M4.25 4.75h7.5v2.5a3.75 3.75 0 0 1-7.5 0v-2.5zM8 11v3.25' }))
    }

    function menuDetail(c) {
      if (!c.enabled) return 'Off in Settings · select to turn on'
      if (c.device) return `Enter code ${c.device.userCode} at ${pageOf(c.device.verificationUri)}`
      if (c.status === 'needs-auth') return 'Needs sign-in · select to sign in'
      if (c.status === 'connecting') return 'Connecting…'
      if (c.status === 'failed') return 'Not connected · select to retry'
      return c.onInSession ? `On · ${toolCount(c.tools.length)}` : 'Off in this session'
    }

    /**
     * Open Settings on the Connectors page, then pick its nav entry. Settings opens from the Harness
     * Studio Settings row at the foot of the sidebar when the Compact plugin provides it, otherwise
     * from Harness's account menu (or, in older builds, its More menu).
     */
    function openConnectorsSettings() {
      const clickWhen = (find, then, tries = 20) => {
        const el = find()
        if (el) { el.click(); then?.(); return }
        if (tries > 0) setTimeout(() => clickWhen(find, then, tries - 1), 60)
      }
      const navEntry = () => [...document.querySelectorAll('button')].find(b => b.className.includes('navCell') && b.textContent.trim() === 'Connectors')
      if (navEntry()) { navEntry().click(); return }
      const direct = document.querySelector('[data-studio-settings]')
      if (direct) { direct.click(); clickWhen(navEntry); return }
      clickWhen(() => document.querySelector('button[aria-label="Account menu"]') ?? [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'More'),
        () => clickWhen(() => [...document.querySelectorAll('[role="menuitem"]')].find(b => /^Settings/.test(b.textContent.trim())),
          () => clickWhen(navEntry)))
    }

    return {
      inject: ['slots', 'commandUi', 'connection'],
      apply(ctx) {
        connection = ctx.connection
        helper = undefined
        ctx.effect(() => () => { if (connection === ctx.connection) { connection = undefined; helper = undefined } }, 'connectors helper connection')
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'connectors', order: 12, label: () => 'Connectors', inject: () => ({}),
        }, ConnectorsSection)), 'connectors settings page')

        // A Connectors entry in the left sidebar under Plugins, opening the same list as a full page.
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'connectors', inject: () => ({}),
        }, ConnectorsPage)), 'connectors page')
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'connectors', order: 5, label: () => 'Connectors',
        }, PlugIcon)), 'connectors entry in the left sidebar')

        ctx.effect(() => ctx.commandUi.register({
          name: 'connectors',
          label: () => 'Connectors',
          description: () => 'Turn MCP connectors on or off for this session',
          icon: PlugIcon,
          available: () => true,
          ui: {
            kind: 'popupSelect',
            searchLabels: () => ({ placeholder: 'Search connectors', empty: 'No connectors yet', noResults: 'No matching connectors' }),
            async options(session, signal) {
              const { connectors } = await api('GET', '/connectors?session=' + encodeURIComponent(session.sessionId))
              if (signal.aborted) return []
              return [
                ...connectors.map(c => ({ id: c.id, label: c.name, detail: menuDetail(c), group: { name: 'connectors', label: 'Connectors' } })),
                { id: '__manage', label: 'Manage connectors…', detail: connectors.length ? 'Add, sign in, see tools' : 'Add your first connector', group: { name: 'manage', label: 'Settings' } },
              ]
            },
            async onSelect(option, session) {
              if (option.id === '__manage') { openConnectorsSettings(); return }
              const { connectors } = await api('GET', '/connectors?session=' + encodeURIComponent(session.sessionId))
              const c = connectors.find(x => x.id === option.id)
              if (!c) return
              if (!c.enabled) { await api('POST', `/connectors/${c.id}/enabled`, { enabled: true }); return }
              if (c.status === 'needs-auth') {
                const result = await api('POST', `/connectors/${c.id}/login`, {})
                // Device sign-in: the code must stay visible while the user types it on the provider's page.
                if (result.device) { navigator.clipboard?.writeText(result.device.userCode).catch(() => {}); openConnectorsSettings() }
                return
              }
              if (c.status === 'failed') { await api('POST', `/connectors/${c.id}/reconnect`, {}); return }
              await api('POST', `/connectors/${c.id}/session`, { session: session.sessionId, enabled: !c.onInSession })
            },
          },
        }), 'connectors in the + menu')
      },
    }
  },
})
