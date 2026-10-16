/**
 * Persistence for connectors.
 *
 *   - The connector list and per-session choices live in one JSON file in the Harness home folder
 *     (`<home>/harness-studio/connectors.json`, mode 0600, replaced atomically). It holds what the
 *     user typed, including header and environment values. A file that does not parse is moved
 *     aside to `connectors.json.corrupt-<time>` instead of being overwritten by the next save.
 *   - Sign-in grants (registered client, tokens, discovered endpoints) live in Harness's credential
 *     store as `grant` records under `harness-studio-connectors/<connector id>`; without a credential
 *     store they fall back to `<home>/harness-studio/connector-grants.json`, also 0600.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SCOPE = 'harness-studio-connectors'
const ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/

/**
 * What the Client sees in place of a stored header or environment value. Sending it back unchanged
 * in an edit keeps the stored value, so secrets never have to leave the Host half.
 */
export const MASK = '••••••••'

/** Validate and normalize one connector spec typed in the Connectors page. */
export function cleanSpec(input, existingIds) {
  if (input === null || typeof input !== 'object') throw new Error('Connector must be an object')
  const name = String(input.name ?? '').trim().slice(0, 60)
  if (!name) throw new Error('Name is required')
  const transport = input.transport === 'stdio' ? 'stdio' : input.transport === 'http' ? 'http' : undefined
  if (!transport) throw new Error('Choose URL or command')
  const record = value => {
    if (value === undefined || value === null) return {}
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Headers and environment must be key/value pairs')
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      const key = String(k).trim()
      if (key) out[key] = String(v)
    }
    return out
  }
  // A supplied id that is taken is ignored and a fresh one derived from the name, so a new connector
  // never takes over another one's entry or sign-in.
  let id = typeof input.id === 'string' && ID_PATTERN.test(input.id) && !existingIds.has(input.id) ? input.id : undefined
  if (!id) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'c$1').slice(0, 24) || 'connector'
    id = /^[a-z]/.test(slug) ? slug : 'c-' + slug
    for (let n = 2; existingIds.has(id); n++) id = `${slug.slice(0, 20)}-${n}`
  }
  const spec = { id, name, transport, enabled: input.enabled !== false }
  if (transport === 'http') {
    let url
    try { url = new URL(String(input.url ?? '').trim()) } catch { throw new Error('Enter a full URL, starting with https://') }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Remote servers must use https://')
    spec.url = url.toString()
    spec.headers = record(input.headers)
    const clientId = String(input.clientId ?? '').trim()
    if (clientId) spec.clientId = clientId
    const clientSecret = String(input.clientSecret ?? '').trim()
    if (clientSecret) spec.clientSecret = clientSecret
  } else {
    const command = String(input.command ?? '').trim()
    if (!command) throw new Error('Command is required')
    spec.command = command
    spec.args = Array.isArray(input.args) ? input.args.map(String).filter(a => a !== '') : []
    spec.env = record(input.env)
    const cwd = String(input.cwd ?? '').trim()
    if (cwd) {
      if (!path.isAbsolute(cwd)) throw new Error('Working folder must be an absolute path')
      spec.cwd = cwd
    }
  }
  return spec
}

/**
 * Fill an edit's masked or blank secrets from the stored spec: a header or environment value sent
 * back as {@link MASK} keeps the stored value for that name, and a blank client secret keeps the
 * stored one unless `clearClientSecret` is set or the client ID changed.
 */
export function mergeSecrets(input, stored) {
  if (input === null || typeof input !== 'object') return input
  const keep = (sent, saved) => {
    if (sent === null || typeof sent !== 'object' || Array.isArray(sent)) return sent
    const out = {}
    for (const [key, value] of Object.entries(sent)) {
      if (value === MASK) { if (saved && Object.hasOwn(saved, key.trim())) out[key] = saved[key.trim()] } else out[key] = value
    }
    return out
  }
  const merged = { ...input, headers: keep(input.headers, stored.headers), env: keep(input.env, stored.env) }
  const clientId = String(input.clientId ?? '').trim()
  if (!String(input.clientSecret ?? '').trim() && input.clearClientSecret !== true && stored.clientSecret && clientId === stored.clientId) {
    merged.clientSecret = stored.clientSecret
  }
  return merged
}

/** Write a file atomically with owner-only permissions. */
async function writePrivate(file, text) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, text, { mode: 0o600 })
  await rename(temp, file)
}

/**
 * Read a JSON file. A missing file gives `fallback`; a file that does not parse is renamed to
 * `<file>.corrupt-<time>` (so the next save cannot destroy it) and also gives `fallback`. Any other
 * read failure throws, and callers must not save over a file they could not read.
 */
async function readJson(file, fallback) {
  let text
  try { text = await readFile(file, 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw new Error(`Could not read ${file}: ${error.message}`)
  }
  try { return JSON.parse(text) } catch (error) {
    const aside = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      await rename(file, aside)
    } catch (renameError) {
      throw new Error(`${file} is not valid JSON (${error.message}) and could not be moved aside: ${renameError.message}`)
    }
    console.error(`[connectors] ${file} is not valid JSON (${error.message}). It was moved to ${aside}; starting with an empty list. Fix that file and move it back to restore your connectors.`)
    return fallback
  }
}

/**
 * @param {{ home: string, credentials?: () => object | undefined }} options - `credentials` returns
 *   Harness's credential store once it is loaded; at app start it can load after this plugin.
 */
export function createStore({ home, credentials: credentialStore }) {
  // Wait up to 5 s for the credential store before falling back to the private grants file, so a
  // sign-in saved in the store is not missed when this plugin starts first.
  const credentialsReady = (async () => {
    for (let i = 0; i < 50; i++) {
      const store = credentialStore?.()
      if (store) return store
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return undefined
  })()
  const dir = path.join(home, 'harness-studio')
  const file = path.join(dir, 'connectors.json')
  const grantsFile = path.join(dir, 'connector-grants.json')
  let writing = Promise.resolve()
  const serial = task => (writing = writing.then(task, task))
  // Grant writes for one connector apply in call order, so a sign-out or removal that comes after a
  // refresh's write can never be overtaken by it.
  const grantWrites = new Map()
  const serialGrant = (id, task) => {
    const next = (grantWrites.get(id) ?? Promise.resolve()).then(task, task)
    const settled = next.catch(() => {})
    grantWrites.set(id, settled)
    settled.then(() => { if (grantWrites.get(id) === settled) grantWrites.delete(id) })
    return next
  }

  return {
    file,
    async load() {
      const data = await readJson(file, { version: 1, connectors: [], sessions: {} })
      const seen = new Set()
      const connectors = []
      for (const c of Array.isArray(data?.connectors) ? data.connectors : []) {
        if (!c || typeof c.id !== 'string' || !ID_PATTERN.test(c.id)) continue
        if (seen.has(c.id)) { console.warn(`[connectors] ${file}: ignoring a second connector with id "${c.id}"`); continue }
        seen.add(c.id)
        connectors.push(c)
      }
      return { connectors, sessions: data?.sessions && typeof data.sessions === 'object' ? data.sessions : {} }
    },
    save(state) {
      const text = JSON.stringify({ version: 1, connectors: state.connectors, sessions: state.sessions }, null, 2) + '\n'
      return serial(() => writePrivate(file, text))
    },
    async readGrant(id) {
      const credentials = await credentialsReady
      if (credentials) {
        const record = await credentials.readRecord(`${SCOPE}/${id}`)
        return record?.kind === 'grant' ? record.payload : undefined
      }
      return (await readJson(grantsFile, {}))[id]
    },
    writeGrant(id, value) {
      // Harness's credential store accepts plain JSON only, so unset fields are dropped here.
      const payload = value === undefined ? undefined : JSON.parse(JSON.stringify(value))
      return serialGrant(id, async () => {
        const credentials = await credentialsReady
        if (credentials) {
          return payload === undefined
            ? credentials.deleteRecord(`${SCOPE}/${id}`)
            : credentials.modifyRecord(`${SCOPE}/${id}`, async () => ({ kind: 'grant', payload }))
        }
        return serial(async () => {
          const all = await readJson(grantsFile, {})
          if (payload === undefined) delete all[id]
          else all[id] = payload
          await writePrivate(grantsFile, JSON.stringify(all, null, 2) + '\n')
        })
      })
    },
  }
}
