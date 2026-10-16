/**
 * The plugin's record of which Session started which: `<home>/harness-studio/sessions.json`, replaced
 * atomically and written one save at a time. Harness itself does not know the relation (see the design
 * note, section 8), so this file is the only link between a started Session and its parent.
 *
 * A file that does not parse is moved aside to `sessions.json.corrupt-<time>` instead of being
 * overwritten by the next save.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const FILE_VERSION = 1

/**
 * @typedef {object} ChildRecord
 * @property {string} id - the started Session.
 * @property {string} parentId - the Session that started it.
 * @property {string} title
 * @property {string} folder - the Session's stored folder (its Workspace).
 * @property {string} [repoRoot] - the repository a worktree belongs to.
 * @property {string} [worktreePath]
 * @property {boolean} [worktreeMissing] - the worktree folder was gone at the last check.
 * @property {string} [branch]
 * @property {number} depth - 1 for a Session started by a top-level one.
 * @property {string} createdAt - ISO time.
 * @property {number} [lastReportedTurn]
 * @property {string} [lastReportAt]
 * @property {boolean} [orphaned] - its parent is archived or gone; reports are recorded, not delivered.
 * @property {boolean} [closed] - it was archived; its turns are no longer followed.
 */

/**
 * @param {{ home: string }} options
 */
export function createStore({ home }) {
  const dir = path.join(home, 'harness-studio')
  const file = path.join(dir, 'sessions.json')
  /** @type {{ children: Record<string, ChildRecord>, wakeStreak: Record<string, number> }} */
  let state = { children: {}, wakeStreak: {} }
  let writing = Promise.resolve()

  async function load() {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    try {
      const parsed = JSON.parse(text)
      if (parsed?.version !== FILE_VERSION || typeof parsed.children !== 'object') throw new Error('unknown format')
      state = { children: parsed.children ?? {}, wakeStreak: parsed.wakeStreak ?? {} }
    } catch (error) {
      const aside = `${file}.corrupt-${Date.now()}`
      await rename(file, aside)
      console.warn(`[harness-studio] sessions: ${file} could not be read (${error.message}); moved to ${aside}`)
    }
  }

  function save() {
    const snapshot = JSON.stringify({ version: FILE_VERSION, ...state }, null, 2) + '\n'
    // A failed save is reported to its caller and does not stop later saves.
    writing = writing.catch(() => {}).then(async () => {
      await mkdir(dir, { recursive: true })
      const temp = `${file}.${process.pid}.tmp`
      await writeFile(temp, snapshot, { mode: 0o600 })
      await rename(temp, file)
    })
    return writing
  }

  return {
    load,
    /** @returns {Promise<void>} resolves when every queued save is on disk. */
    settled: () => writing,
    /** @returns {ChildRecord[]} every record. */
    all: () => Object.values(state.children),
    /** @returns {string[]} parents with a non-zero wake streak. */
    wakeParents: () => Object.keys(state.wakeStreak),
    /** @param {string} id @returns {ChildRecord | undefined} */
    child: id => state.children[id],
    /** @param {string} parentId @returns {ChildRecord[]} */
    childrenOf: parentId => Object.values(state.children).filter(c => c.parentId === parentId),
    /** @param {string} id @returns {boolean} */
    isParent: id => Object.values(state.children).some(c => c.parentId === id),
    /** @param {ChildRecord} record */
    add(record) {
      state.children[record.id] = record
      return save()
    },
    /** @param {string} id */
    remove(id) {
      delete state.children[id]
      return save()
    },
    /** @param {string} id @param {Partial<ChildRecord>} patch */
    update(id, patch) {
      const current = state.children[id]
      if (!current) return Promise.resolve()
      state.children[id] = { ...current, ...patch }
      return save()
    },
    /** @param {string} parentId @returns {number} */
    wakeStreak: parentId => state.wakeStreak[parentId] ?? 0,
    /** @param {string} parentId @param {number} value */
    setWakeStreak(parentId, value) {
      if ((state.wakeStreak[parentId] ?? 0) === value) return Promise.resolve()
      if (value === 0) delete state.wakeStreak[parentId]
      else state.wakeStreak[parentId] = value
      return save()
    },
  }
}
