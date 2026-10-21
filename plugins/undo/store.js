/**
 * Snapshots of files taken just before the agent first changes them in a turn, and restoring them.
 *
 *   <harness home>/harness-studio/undo/<session id>/
 *     manifest.json   { "turns": { "<turn>": { "at": "<iso time>", "files": { "<absolute path>": Entry } } } }
 *     blobs/<sha256>  the earlier content of a file, stored once however many snapshots share it
 *
 * Entry: { existed: true, blob, size } for a file that existed, { existed: false } for one the agent
 * created, or { existed: true, skipped: 'too-large' | 'not-a-file' } when it could not be kept.
 *
 * Only the first change to a file in a turn is snapshotted, because that is the state before the turn.
 * Restoring from turn N puts every file changed in turn N or later back to its state before the earliest of
 * those turns, and forgets those turns' snapshots.
 */
import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Larger files are not snapshotted; the turn's card says they cannot be restored. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024

/**
 * Lines added and removed between two texts, as a line diff counts them (Myers' shortest edit script: every
 * changed line is one removal plus one addition). Very different large texts stop searching after `limit` edits
 * and fall back to counting lines present in one text and not the other, which is close but not exact.
 * @param {string} before
 * @param {string} after
 * @returns {{ added: number, removed: number }}
 */
export function lineChanges(before, after, limit = 20000) {
  const split = text => text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/)
  let a = split(before), b = split(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length, endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  a = a.slice(start, endA); b = b.slice(start, endB)
  const n = a.length, m = b.length
  if (n === 0 || m === 0) return { added: m, removed: n }
  const max = Math.min(n + m, limit)
  const v = new Int32Array(2 * max + 2)
  const off = max + 1
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) { x++; y++ }
      v[off + k] = x
      if (x >= n && y >= m) return { added: (d + m - n) / 2, removed: (d - m + n) / 2 }
    }
  }
  const count = lines => lines.reduce((map, line) => map.set(line, (map.get(line) ?? 0) + 1), new Map())
  const left = count(a), right = count(b)
  let added = 0, removed = 0
  for (const [line, c] of right) added += Math.max(0, c - (left.get(line) ?? 0))
  for (const [line, c] of left) removed += Math.max(0, c - (right.get(line) ?? 0))
  return { added, removed }
}
const SESSION_ID = /^[A-Za-z0-9._:-]{1,200}$/

/** @param {string} root - `<harness home>/harness-studio/undo` */
export function createStore(root) {
  /** One change at a time per session, so concurrent tool calls never interleave manifest writes. */
  const queues = new Map()
  const serial = (sessionId, work) => {
    const next = (queues.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(work)
    queues.set(sessionId, next)
    return next
  }

  const dirOf = sessionId => {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new Error('invalid session id')
    return path.join(root, sessionId)
  }
  async function readManifest(sessionId) {
    try {
      const value = JSON.parse(await readFile(path.join(dirOf(sessionId), 'manifest.json'), 'utf8'))
      return value && typeof value.turns === 'object' && value.turns !== null ? value : { turns: {} }
    } catch {
      return { turns: {} }
    }
  }
  async function writeManifest(sessionId, manifest) {
    const dir = dirOf(sessionId)
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, 'manifest.json')
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(manifest), 'utf8')
    await rename(temp, file)
  }

  /**
   * Snapshot a file before the agent changes it, unless this turn already has its snapshot.
   * @param {string} sessionId
   * @param {number} turn
   * @param {string} file - absolute path.
   * @returns {Promise<'taken' | 'already' >}
   */
  function capture(sessionId, turn, file) {
    dirOf(sessionId)
    return serial(sessionId, async () => {
      const manifest = await readManifest(sessionId)
      const key = String(turn)
      const entry = manifest.turns[key] ?? { at: new Date().toISOString(), files: {} }
      if (entry.files[file] !== undefined) return 'already'
      let info
      try {
        info = await lstat(file)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      if (info === undefined) entry.files[file] = { existed: false }
      else if (!info.isFile()) entry.files[file] = { existed: true, skipped: 'not-a-file' }
      else if (info.size > MAX_FILE_BYTES) entry.files[file] = { existed: true, skipped: 'too-large', size: info.size }
      else {
        const content = await readFile(file)
        const blob = createHash('sha256').update(content).digest('hex')
        const blobs = path.join(dirOf(sessionId), 'blobs')
        await mkdir(blobs, { recursive: true })
        await writeFile(path.join(blobs, blob), content, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error })
        entry.files[file] = { existed: true, blob, size: content.length, mode: info.mode & 0o777 }
      }
      manifest.turns[key] = entry
      await writeManifest(sessionId, manifest)
      return 'taken'
    })
  }

  /**
   * The turns that have snapshots, oldest first.
   * @param {string} sessionId
   * @returns {Promise<Array<{ turn: number, at: string, files: Array<{ path: string, existed: boolean, restorable: boolean }> }>>}
   */
  async function list(sessionId) {
    dirOf(sessionId)
    const manifest = await readManifest(sessionId)
    return Object.entries(manifest.turns)
      .map(([turn, entry]) => ({
        turn: Number(turn),
        at: entry.at,
        files: Object.entries(entry.files).map(([file, e]) => ({ path: file, existed: e.existed, restorable: e.skipped === undefined })),
      }))
      .sort((a, b) => a.turn - b.turn)
  }

  /**
   * Put every file changed in `fromTurn` or later back to its state before the earliest of those turns, and
   * forget those turns. A file that cannot be restored keeps its snapshot, so a later attempt can retry it.
   * @param {string} sessionId
   * @param {number} fromTurn
   * @returns {Promise<{ restored: string[], removed: string[], failed: Array<{ path: string, reason: string }> }>}
   */
  function restore(sessionId, fromTurn) {
    dirOf(sessionId)
    return serial(sessionId, async () => {
      const manifest = await readManifest(sessionId)
      const turns = Object.keys(manifest.turns).map(Number).filter(t => t >= fromTurn).sort((a, b) => a - b)
      const earliest = new Map()
      for (const turn of turns) {
        for (const [file, entry] of Object.entries(manifest.turns[String(turn)].files)) {
          if (!earliest.has(file)) earliest.set(file, { turn, entry })
        }
      }
      const result = { restored: [], removed: [], failed: [] }
      const kept = new Map()
      for (const [file, { turn, entry }] of earliest) {
        try {
          if (entry.skipped) throw new Error(entry.skipped === 'too-large' ? 'it was larger than 10 MB, so no copy was kept' : 'it was not a regular file')
          if (!entry.existed) {
            await rm(file, { force: true })
            result.removed.push(file)
          } else {
            const content = await readFile(path.join(dirOf(sessionId), 'blobs', entry.blob))
            await mkdir(path.dirname(file), { recursive: true })
            // Write beside the file and rename over it: a link put in the file's place since the copy was kept is
            // replaced, never written through.
            const temp = path.join(path.dirname(file), `.${path.basename(file)}.undo-${randomBytes(6).toString('hex')}`)
            try {
              await writeFile(temp, content, { flag: 'wx', ...entry.mode ? { mode: entry.mode } : {} })
              await rename(temp, file)
            } catch (error) {
              await rm(temp, { force: true })
              throw error
            }
            result.restored.push(file)
          }
        } catch (error) {
          result.failed.push({ path: file, reason: error.message })
          if (!entry.skipped) kept.set(file, { turn, entry })
        }
      }
      for (const turn of turns) delete manifest.turns[String(turn)]
      // Keep the earlier state of files that failed, under the turn they came from, so Undo can be retried.
      for (const [file, { turn, entry }] of kept) {
        const key = String(turn)
        manifest.turns[key] ??= { at: new Date().toISOString(), files: {} }
        manifest.turns[key].files[file] = entry
      }
      await writeManifest(sessionId, manifest)
      return result
    })
  }

  /**
   * What "Restore code" from `fromTurn` would change in each file: lines added and removed since the copy kept
   * before that turn, comparing it with the file as it is now. Files with no copy, or that are not text, have no
   * counts.
   * @param {string} sessionId
   * @param {number} fromTurn
   * @returns {Promise<Array<{ path: string, added?: number, removed?: number }>>}
   */
  function changes(sessionId, fromTurn) {
    dirOf(sessionId)
    return serial(sessionId, async () => {
      const manifest = await readManifest(sessionId)
      const earliest = new Map()
      for (const turn of Object.keys(manifest.turns).map(Number).filter(t => t >= fromTurn).sort((x, y) => x - y)) {
        for (const [file, entry] of Object.entries(manifest.turns[String(turn)].files)) if (!earliest.has(file)) earliest.set(file, entry)
      }
      const out = []
      for (const [file, entry] of earliest) {
        if (entry.skipped) { out.push({ path: file }); continue }
        const before = entry.existed ? await readFile(path.join(dirOf(sessionId), 'blobs', entry.blob)) : Buffer.alloc(0)
        const now = await readFile(file).catch(error => { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error })
        if (before.includes(0) || now.includes(0) || now.length > MAX_FILE_BYTES) { out.push({ path: file }); continue }
        // Counted from now back to before, as the Restore would change it; shown the way the agent changed it.
        const { added, removed } = lineChanges(before.toString('utf8'), now.toString('utf8'))
        out.push({ path: file, added, removed })
      }
      return out
    })
  }

  return { capture, list, restore, changes }
}
