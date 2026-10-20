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

test('browser_resize checks the width, and an unapproved page is left after it too', async () => {
  const { tools, ops, exec } = mount({ finalUrl: 'http://localhost:3000/', allowed: [] })
  await assert.rejects(tools.browser_resize.execute({ width: 100 }, exec), /width must be a whole number from 240 to 3840/)
  await assert.rejects(tools.browser_resize.execute({ width: 375.5 }, exec), /width must be a whole number/)
  assert.deepEqual(ops, [])
  const away = mount({ finalUrl: 'https://evil.example/', allowed: [] })
  await assert.rejects(away.tools.browser_resize.execute({ width: 375 }, away.exec), /went on to evil\.example/)
  assert.deepEqual(away.ops, ['resize', 'leave'])
})

test('browser_resize reports the size the page ended up at, and no width fits the pane', async () => {
  const tools = {}
  const sent = []
  const bridge = { async request(_s, op, args) { sent.push([op, args]); return { url: 'http://localhost:5173/', width: args.width ?? 612, height: 800 } } }
  registerBrowserTools({ get: () => undefined, effect: fn => fn(), tools: { register: t => { tools[t.name] = t } } }, bridge)
  const exec = { agent: { session: { id: 's' } } }
  assert.match(await tools.browser_resize.execute({ width: 375 }, exec), /Page width set to 375: the page is now 375×800/)
  assert.match(await tools.browser_resize.execute({}, exec), /fits the pane again: the page is now 612×800/)
  assert.deepEqual(sent, [['resize', { width: 375 }], ['resize', {}]])
})

test('browser_screenshot stores the image for a model that accepts images, and explains when it cannot', async () => {
  const shot = { url: 'http://localhost:5173/', title: 'x', width: 375, height: 812, scrollY: 0, pageHeight: 2000, image: { data: Buffer.from('jpeg').toString('base64'), mediaType: 'image/jpeg', width: 375, height: 812 } }
  const saved = []
  const services = {
    attachments: { async saveImages(images) { saved.push(...images); return images.map((_, i) => ({ attachmentId: `a${i}`, mediaType: 'image/jpeg', bytes: 4, width: 375, height: 812 })) } },
    llm: { async resolveModelInfo(_p, model) { return { inputModalities: model === 'seeing' ? ['text', 'image'] : ['text'] } } },
  }
  const mountWith = (model) => {
    const tools = {}
    registerBrowserTools({ get: name => services[name], effect: fn => fn(), tools: { register: t => { tools[t.name] = t } } }, { request: async () => shot })
    return { tools, exec: { agent: { session: { id: 's', requestHeader: () => undefined }, options: { provider: 'p', model } }, signal: new AbortController().signal } }
  }
  const seeing = mountWith('seeing')
  const value = await seeing.tools.browser_screenshot.execute({}, seeing.exec)
  assert.match(value.text, /375×812 CSS pixels, showing 0–812 of a page 2000 pixels tall \(pass scroll_y to see the 1188 pixels below\)/)
  await assert.rejects(seeing.tools.browser_screenshot.execute({ scroll_y: -1 }, seeing.exec), /scroll_y must be/)
  assert.equal(saved.length, 1)
  assert.equal(Buffer.from(saved[0].data).toString(), 'jpeg')
  const blocks = seeing.tools.browser_screenshot.output.render({}, value)
  assert.deepEqual(blocks.map(b => b.type), ['text', 'image'])
  const blind = mountWith('text-only')
  const note = await blind.tools.browser_screenshot.execute({}, blind.exec)
  assert.match(note.text, /not shown: the model "text-only" does not accept images/)
  assert.deepEqual(blind.tools.browser_screenshot.output.render({}, note).map(b => b.type), ['text'])
})
