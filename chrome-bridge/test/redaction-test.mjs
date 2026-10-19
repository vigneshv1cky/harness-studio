// Checks which field values the extension's page read masks before they reach the model. Runs the real
// readPage function from extension/background.js against a small stand-in DOM, no Chrome needed.
// Run: node chrome-bridge/test/redaction-test.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../extension/background.js', import.meta.url)), 'utf8')
const start = source.indexOf('function readPage() {')
const end = source.indexOf('\n}\n', start) + 2
if (start === -1 || end < start) throw new Error('readPage not found in background.js')
// readPage is self-contained (it is injected into pages), so it runs here with the page globals passed in.
const load = new Function('document', 'getComputedStyle', 'innerHeight', 'innerWidth', 'location', `${source.slice(start, end)}\nreturn readPage`)

const results = []
const check = (label, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`)

/** A visible text field with the given name, id, label, aria-label, autocomplete, type and value. */
function field({ name = '', id = '', label = '', ariaLabel = '', autocomplete = '', type = 'text', value = '' }) {
  const attributes = { name, 'aria-label': ariaLabel, autocomplete }
  return {
    tagName: 'INPUT', type, value, id, checked: false, disabled: false, isContentEditable: false, innerText: '',
    labels: label ? [{ innerText: label }] : [],
    getAttribute: key => attributes[key] || null,
    getBoundingClientRect: () => ({ width: 100, height: 20, top: 0, bottom: 20, left: 0, right: 100 }),
    closest: () => null,
    parentElement: null,
  }
}

function read(fields) {
  const document = {
    title: 'Form', body: { innerText: '' },
    querySelectorAll: selector => (selector === 'video, audio' ? [] : fields),
  }
  const readPage = load(document, () => ({ visibility: 'visible', display: 'block', opacity: '1' }), 800, 1200, { href: 'https://example.test/' })
  return readPage().elements.map(e => e.value)
}

const MASKED = '••••'
const byName = {
  'api_key': { name: 'api_key' }, apiKey: { name: 'apiKey' }, APIKEY: { id: 'APIKEY' }, 'access_token': { name: 'access_token' },
  auth: { name: 'auth' }, bearer: { id: 'bearer' }, credential: { name: 'credential' }, session: { name: 'session' },
  cookie: { name: 'cookie' }, private: { name: 'private' }, key: { name: 'key' }, 'label "Access token"': { label: 'Access token' },
  'aria-label "Secret key"': { ariaLabel: 'Secret key' }, 'client-secret': { id: 'client-secret' }, sessionId: { name: 'sessionId' },
  password: { type: 'password' }, 'one-time-code': { autocomplete: 'one-time-code' },
}
const named = read(Object.values(byName).map(f => field({ ...f, value: 'plain value' })))
const missed = Object.keys(byName).filter((_, i) => named[i] !== MASKED)
check('fields named or labelled like credentials are masked', missed.length === 0, missed.length ? 'shown: ' + missed.join(', ') : '')

// Made-up values, put together at run time so the file itself holds nothing a secret scanner would flag.
const tail = 'AbCdEf0123456789GhIjKlMn'
const b64url = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const byShape = {
  'OpenAI key': ['sk', 'proj', tail].join('-'), 'Anthropic key': ['sk', 'ant', 'api03', tail].join('-'), 'GitHub token': ['ghp', tail + tail].join('_'),
  'GitLab token': ['glpat', tail].join('-'), 'AWS key id': 'AK' + 'IA' + 'ABCDEFGHIJ234567', 'JWT': [b64url({ alg: 'HS256' }), b64url({ sub: 'someone-0042' }), tail].join('.'),
  'random string': 'q8Zt3LmX9vKp2RwY7nBc4HdJ', 'token inside text': `my key is ${['sk', tail].join('-')} thanks`,
}
const shaped = read(Object.values(byShape).map(value => field({ name: 'notes', value })))
const leaked = Object.keys(byShape).filter((_, i) => shaped[i] !== MASKED)
check('values shaped like credentials are masked in any field', leaked.length === 0, leaked.length ? 'shown: ' + leaked.join(', ') : '')

const ordinary = {
  email: { name: 'email', value: 'ada@example.com' }, search: { name: 'q', value: 'how to bake sourdough bread at home' },
  slug: { name: 'slug', value: 'my-very-long-article-title-goes-here' }, keyword: { name: 'keyword', value: 'cats' },
  author: { name: 'author', value: 'Ada Lovelace' }, order: { name: 'order', value: 'ORDER-2024-0042' },
  'long word': { name: 'word', value: 'pneumonoultramicroscopicsilicovolcanoconiosis' },
}
const plain = read(Object.values(ordinary).map(f => field(f)))
const hidden = Object.keys(ordinary).filter((key, i) => plain[i] !== ordinary[key].value)
check('ordinary fields keep their values', hidden.length === 0, hidden.length ? 'masked: ' + hidden.join(', ') : '')
check('an empty credential field reads empty, not masked', read([field({ name: 'api_key', value: '' })])[0] === '')

console.log(results.join('\n'))
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0)
