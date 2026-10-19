import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerBrowserTools } from '../index.js'

/** Mount the browser tools with a stand-in window that lands on `finalUrl`, and approvals for `allowed`. */
function mount({ finalUrl, allowed }) {
  const tools = {}
  const ops = []
  const bridge = { async request(_session, op, args) { ops.push(op); return op === 'leave' ? { url: 'about:blank' } : { url: finalUrl, title: 'Page' } } }
  const approvals = { allows: async (_session, url) => allowed.some(host => new URL(url).host === host) || new URL(url).hostname === 'localhost' }
  registerBrowserTools({ get: name => (name === 'harnessStudioSiteApproval' ? approvals : undefined), effect: fn => fn(), tools: { register: tool => { tools[tool.name] = tool } } }, bridge)
  const exec = { agent: { session: { id: 's1', header: {} } }, signal: new AbortController().signal }
  return { tools, ops, exec }
}

test('a local page that redirects to an unapproved site is left, and the agent told to ask', async () => {
  const { tools, ops, exec } = mount({ finalUrl: 'https://evil.example/?d=secret', allowed: [] })
  await assert.rejects(tools.browser_open.execute({ url: 'http://localhost:3000/' }, exec), /went on to evil\.example, a site not approved[\s\S]*Ask the user/)
  assert.deepEqual(ops, ['open', 'leave'])
})

test('a click that navigates to an unapproved site is left too', async () => {
  const { tools, ops, exec } = mount({ finalUrl: 'https://other.example/', allowed: [] })
  await assert.rejects(tools.browser_click.execute({ ref: 1 }, exec), /went on to other\.example/)
  assert.deepEqual(ops, ['click', 'leave'])
})

test('local and approved pages stay', async () => {
  const local = mount({ finalUrl: 'http://localhost:3000/next', allowed: [] })
  assert.match(await local.tools.browser_open.execute({ url: 'http://localhost:3000/' }, local.exec), /Loaded "Page" at http:\/\/localhost:3000\/next/)
  const approved = mount({ finalUrl: 'https://docs.example/page', allowed: ['docs.example'] })
  assert.match(await approved.tools.browser_open.execute({ url: 'https://docs.example/' }, approved.exec), /Loaded/)
  assert.deepEqual(approved.ops, ['open'])
})

test('without the site check installed, nothing changes', async () => {
  const tools = {}
  registerBrowserTools({ get: () => undefined, effect: fn => fn(), tools: { register: t => { tools[t.name] = t } } }, { request: async () => ({ url: 'https://anything.example/' }) })
  assert.match(await tools.browser_open.execute({ url: 'https://anything.example/' }, { agent: { session: { id: 's' } } }), /Loaded/)
})
