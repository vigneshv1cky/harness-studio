/**
 * The saved watches: `<home>/harness-studio/watches.json`, replaced atomically and written one save at a
 * time. A file that does not parse is moved aside to `watches.json.corrupt-<time>` instead of being
 * overwritten by the next save.
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const FILE_VERSION = 1

/** @param {{ home: string }} options */
export function createStore({ home }) {
  const dir = path.join(home, 'harness-studio')
  const file = path.join(dir, 'watches.json')
  /** @type {Map<string, object>} */
  const watches = new Map()
  let writing = Promise.resolve()

  async function load() {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    try {
      const parsed = JSON.parse(text)
      if (parsed?.version !== FILE_VERSION || typeof parsed.watches !== 'object') throw new Error('unknown format')
      for (const [id, watch] of Object.entries(parsed.watches)) {
        if (watch?.id === id && typeof watch.sessionId === 'string' && watch.spec && watch.state) watches.set(id, watch)
      }
    } catch (error) {
      const aside = `${file}.corrupt-${Date.now()}`
      await rename(file, aside)
      console.warn(`[harness-studio] watch: ${file} could not be read (${error.message}); moved to ${aside}`)
    }
    return [...watches.values()]
  }

  function save() {
    const content = `${JSON.stringify({ version: FILE_VERSION, watches: Object.fromEntries(watches) }, null, 2)}\n`
    writing = writing.then(async () => {
      // Watches hold commands and up to 64 KB of their output, so only this user may read them.
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
      try {
        await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
        await rename(temp, file)
      } catch (error) {
        await rm(temp, { force: true }).catch(() => {})
        throw error
      }
    }).catch(error => {
      console.warn(`[harness-studio] watch: could not save ${file}:`, error?.message ?? error)
    })
    return writing
  }

  return {
    file,
    load,
    save,
    get: id => watches.get(id),
    all: () => [...watches.values()],
    of: sessionId => [...watches.values()].filter(w => w.sessionId === sessionId),
    put(watch) {
      watches.set(watch.id, watch)
      return save()
    },
    remove(id) {
      const had = watches.delete(id)
      return had ? save() : Promise.resolve()
    },
    settled: () => writing,
  }
}
