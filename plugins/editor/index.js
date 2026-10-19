/**
 * Host half of the editor: reading, checking and saving the files you edit in the right panel. It only
 * touches regular text files inside your workspace folders (checked on the real path), and a save is refused
 * when the file changed on disk since you opened it, so neither your edits nor the agent's are overwritten
 * unseen. The client reaches it through Harness's authenticated Remote channel (`harnessStudioEditor/call`).
 */
import { createHash, randomBytes } from 'node:crypto'
import { open as openFile, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

export const name = 'harness-studio-editor'

export const EDITOR_SERVICE = 'harnessStudioEditor'
const REMOTE_METHODS_MARKER = '@deepseek-ai/dsh-typert-protocol/remote-methods'
/** Larger files open in the preview only. */
export const MAX_BYTES = 2 * 1024 * 1024
/** Refuses bytes that are not UTF-8 instead of turning them into U+FFFD, which a save would then write back. */
const utf8 = new TextDecoder('utf-8', { fatal: true })
const BOM = Buffer.from([0xef, 0xbb, 0xbf])

const versionOf = (info, content) => ({
  mtimeMs: info.mtimeMs,
  size: info.size,
  hash: createHash('sha256').update(content).digest('hex'),
})

/**
 * The editor's file operations.
 * @param {() => string[]} folders - the workspace folders files may live in.
 */
export function createEditorFiles(folders) {
  /** The real path of a file inside a workspace folder, or an error saying why not. */
  async function allowed(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('path must be an absolute file path')
    let real
    try {
      real = await realpath(file)
    } catch {
      throw new Error(`${file} does not exist`)
    }
    for (const folder of folders()) {
      let root
      try { root = await realpath(folder) } catch { continue }
      const rel = path.relative(root, real)
      if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) return real
    }
    throw new Error('the editor only opens files inside your workspace folders')
  }

  async function readText(real) {
    const info = await stat(real)
    if (!info.isFile()) throw new Error('only regular files can be edited')
    if (info.size > MAX_BYTES) throw new Error(`the file is larger than ${MAX_BYTES / 1024 / 1024} MB; open it in your own editor`)
    const buffer = await readFile(real)
    if (buffer.subarray(0, 8192).includes(0)) throw new Error('this looks like a binary file, which the editor does not open')
    // The decoder drops a leading byte order mark; `bom` puts it back on save. Line breaks are kept as they are.
    let content
    try { content = utf8.decode(buffer) } catch { throw new Error('this file is not UTF-8 text, which the editor does not open') }
    return { content, info, bom: buffer.subarray(0, 3).equals(BOM) }
  }

  return {
    /** @param {{ path: string }} request */
    async open({ path: file }) {
      const real = await allowed(file)
      const { content, info } = await readText(real)
      return { path: file, content, version: versionOf(info, content) }
    },

    /** Cheap check for changes on disk: modification time and size only. */
    async stat({ path: file }) {
      const info = await stat(await allowed(file))
      return { mtimeMs: info.mtimeMs, size: info.size }
    },

    /**
     * Save, unless the file changed on disk since `expected` (its content hash). A conflict returns the current
     * disk content instead of writing.
     * @param {{ path: string, content: string, expected: string }} request
     */
    async save({ path: file, content, expected }) {
      if (typeof content !== 'string') throw new Error('content must be text')
      if (Buffer.byteLength(content) > MAX_BYTES) throw new Error(`the file would be larger than ${MAX_BYTES / 1024 / 1024} MB`)
      const real = await allowed(file)
      const current = await readText(real)
      const currentVersion = versionOf(current.info, current.content)
      if (typeof expected === 'string' && expected !== currentVersion.hash) {
        return { conflict: true, content: current.content, version: currentVersion }
      }
      // Write beside the file and rename over it, keeping its permissions, so the file is never half-written.
      // The temporary name is random and created exclusively, so nothing planted under it (such as a symbolic
      // link to a file elsewhere) is followed or written through.
      const temp = path.join(path.dirname(real), `.${path.basename(real)}.hs-edit-${randomBytes(8).toString('hex')}`)
      const mode = current.info.mode & 0o7777
      let handle
      let created = false
      try {
        handle = await openFile(temp, 'wx', mode)
        created = true
        await handle.chmod(mode) // the umask may have narrowed it
        await handle.writeFile(current.bom ? Buffer.concat([BOM, Buffer.from(content)]) : content)
        await handle.close()
        handle = undefined
        await rename(temp, real)
      } catch (error) {
        await handle?.close().catch(() => {})
        if (created) await rm(temp, { force: true })
        throw error
      }
      const info = await stat(real)
      return { conflict: false, version: versionOf(info, content) }
    },
  }
}

export function apply(ctx) {
  const files = createEditorFiles(() => {
    try { return (ctx.get('workspaceRegistry')?.list?.() ?? []).map(w => w.path).filter(Boolean) } catch { return [] }
  })
  const actions = { open: r => files.open(r), stat: r => files.stat(r), save: r => files.save(r) }

  class EditorAccess {
    constructor() {
      this.typertRemote = Object.freeze({ service: this, serviceKey: EDITOR_SERVICE, namespace: EDITOR_SERVICE })
    }

    /** @param {{ action: string }} request */
    async call(request) {
      const action = actions[request?.action]
      if (!action) throw new Error(`Unknown action ${request?.action}`)
      return action(request)
    }
  }
  Object.defineProperty(EditorAccess.prototype, REMOTE_METHODS_MARKER, {
    configurable: true,
    value: Object.freeze({ version: 1, methods: Object.freeze([Object.freeze({ method: 'call', invocation: Object.freeze({ kind: 'direct' }) })]) }),
  })
  if (typeof ctx.provide === 'function') ctx.provide(EDITOR_SERVICE, new EditorAccess())
  return { files }
}
