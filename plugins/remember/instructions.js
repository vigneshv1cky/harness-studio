/**
 * The Instructions page's Host half: which instruction files a workspace loads, the saved size limit,
 * reading, editing and opening those files, and the notes Remember saved.
 *
 * The page reaches this through one Remote method, `harnessStudioInstructions/call`, served by Harness's
 * API Gateway like Connectors' helper method: the channel is authenticated by Harness, and the method's one
 * JSON parameter, `request`, carries `{ action, ... }`.
 *
 * Files the page may read, write or open are limited to instruction files (`AGENTS.md` and `AGENTS.local.md`)
 * in the personal folder or in a registered workspace's folders, so the page cannot be used to read
 * or change anything else on the computer. Files written for other agent tools, such as `CLAUDE.md`, are
 * neither read nor listed.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { HEADING } from './logic.js'
import { INDEX, deleteMemory, indexText, listMemories, memoryDir, memoryProjectRoot, queueFileWrite } from './memory.js'

export const INSTRUCTIONS_SERVICE = 'harnessStudioInstructions'
const REMOTE_METHODS_MARKER = '@deepseek-ai/dsh-typert-protocol/remote-methods'
export const DEFAULT_LIMIT = 131072
const MAX_EDIT_BYTES = 1048576
const BASE = 'AGENTS.md'
const LOCAL = 'AGENTS.local.md'
const INSTRUCTION_NAME = /^AGENTS(?:\.local)?\.md$/

const exists = file => stat(file).then(info => info.isFile(), () => false)
const sizeOf = file => stat(file).then(info => (info.isFile() ? info.size : undefined), () => undefined)
const homeDisplay = file => {
  const home = os.homedir()
  return file === home || file.startsWith(home + path.sep) ? `~${file.slice(home.length)}` : file
}
const isInside = (root, file) => {
  const rel = path.relative(root, file)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

async function projectRoot(folder) {
  let current = path.resolve(folder)
  for (;;) {
    if (await stat(path.join(current, '.git')).then(() => true, () => false)) return current
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(folder)
    current = parent
  }
}

/** Folders from the project root down to `folder`, broadest first, as the instruction loader walks them. */
function chain(root, folder) {
  const out = []
  let current = path.resolve(folder)
  for (;;) {
    out.push(current)
    if (current === root) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return out.reverse()
}

/** Where the `## Remembered` section is: its heading line and the line after its last one (`start` -1 when missing). */
function rememberedRange(lines) {
  const start = lines.findIndex(line => line.trim() === HEADING)
  if (start === -1) return { start, end: -1 }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) if (/^#{1,2}\s/.test(lines[i])) { end = i; break }
  return { start, end }
}

const readText = file => readFile(file, 'utf8').catch(error => (error.code === 'ENOENT' ? '' : Promise.reject(error)))
const contentHash = content => createHash('sha256').update(content).digest('hex')

/** Remembered notes: `- text (date)` lines under the `## Remembered` heading. */
export function notesIn(content) {
  const lines = content.split('\n')
  const { start, end } = rememberedRange(lines)
  if (start === -1) return []
  const notes = []
  for (let i = start + 1; i < end; i++) {
    const match = /^- (.+?)(?: \((\d{4}-\d{2}-\d{2})\))?$/.exec(lines[i])
    if (match) notes.push({ text: match[1], date: match[2] ?? null, line: lines[i] })
  }
  return notes
}

/**
 * Which files load, in the loader's order, and what the limit does to them. Broader files are left out
 * first when the total is over the limit, then the most specific one is shortened, as the loader does; the
 * sizes are the files' own, without the few hundred bytes of framing the loader adds.
 */
export async function overview({ home, folder, limit }) {
  const files = []
  const personal = path.join(home, 'AGENTS.md')
  const personalSize = await sizeOf(personal)
  files.push({ kind: 'personal', label: 'Global, all projects', path: homeDisplay(personal), absolutePath: personal, bytes: personalSize ?? null, status: personalSize === undefined ? 'missing' : 'loaded' })

  if (folder) {
    const root = await projectRoot(folder)
    for (const dir of chain(root, folder)) {
      for (const name of [BASE, LOCAL]) {
        const label = name === BASE ? 'Project' : 'Project, just you'
        const file = path.join(dir, name)
        const bytes = await sizeOf(file)
        if (bytes !== undefined) {
          files.push({ kind: 'project', label, path: path.relative(root, file) || name, absolutePath: file, bytes, status: 'loaded' })
        } else if (dir === root) {
          files.push({ kind: 'project', label, path: name, absolutePath: file, bytes: null, status: 'missing' })
        }
      }
    }
  }

  const loaded = files.filter(f => f.status === 'loaded')
  let total = loaded.reduce((sum, f) => sum + f.bytes, 0)
  const budget = limit === 0 ? Infinity : limit
  if (total > budget) {
    for (const file of loaded) {
      if (total <= budget || file === loaded.at(-1)) break
      file.status = 'left-out'
      file.reason = 'Left out to fit the limit; broader files go first'
      total -= file.bytes
    }
    const last = loaded.at(-1)
    if (total > budget && last) {
      last.status = 'cut'
      last.reason = `Shortened to about ${Math.round(budget / 1024)} KB to fit the limit`
      total = budget
    }
  }
  return { files, sentBytes: total }
}

/** The limit saved for the instruction loader; 0 means no limit. */
export async function readLimit(home) {
  try {
    const saved = JSON.parse(await readFile(path.join(home, 'harness-studio', 'instructions.json'), 'utf8'))
    if (saved.maxBytes === 0 || (Number.isInteger(saved.maxBytes) && saved.maxBytes >= 4096)) return saved.maxBytes
  } catch { /* nothing saved */ }
  return DEFAULT_LIMIT
}

export async function writeLimit(home, maxBytes) {
  if (!(maxBytes === 0 || (Number.isInteger(maxBytes) && maxBytes >= 4096 && maxBytes <= 8 * 1048576))) throw new Error('Choose a limit of at least 4 KB, or no limit')
  await mkdir(path.join(home, 'harness-studio'), { recursive: true })
  await writeFile(path.join(home, 'harness-studio', 'instructions.json'), JSON.stringify({ maxBytes }) + '\n', 'utf8')
  return maxBytes
}

/**
 * Render Harness's system prompt from an assembly the way the agent loop does: sections in order, `{{name}}`
 * variables filled where known. Without an agent there is no model, so `{{model}}` and `{{provider}}` stay as written.
 * @param {{ sections: { name: string, text: string, interpolate?: boolean }[], variables: Record<string, string | undefined>, tools: unknown[] }} assembly
 */
export function renderSystemPrompt(assembly) {
  const fill = text => text.replace(/\{\{([A-Za-z_][\w-]*)\}\}/g, (group, name) => assembly.variables[name] ?? group)
  const sections = assembly.sections
    .map(section => ({ name: section.name, text: section.interpolate === false ? section.text : fill(section.text) }))
    .filter(section => section.text.length > 0)
  const text = sections.map(section => section.text).join('\n\n')
  return { text, bytes: Buffer.byteLength(text), sections: sections.map(section => ({ name: section.name, bytes: Buffer.byteLength(section.text) })), tools: assembly.tools.length }
}

/**
 * Create the page's Remote service.
 * @param {{ home: string, workspaces: () => { path: string, title?: string }[], assemble?: () => Promise<Parameters<typeof renderSystemPrompt>[0]> }} options
 *   `assemble` returns Harness's prompt assembly without a session, for the read-only system prompt view.
 */
export function createInstructionsService({ home, workspaces, assemble }) {
  const folders = () => workspaces().map(w => w.path).filter(Boolean)

  /** Refuse anything that is not an instruction file in an allowed folder, checked on the real path. */
  async function allowed(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('A full file path is needed')
    const resolved = path.resolve(file)
    if (!INSTRUCTION_NAME.test(path.basename(resolved))) throw new Error('Only instruction files (AGENTS.md and AGENTS.local.md) can be used here')
    const realFolder = await realpath(path.dirname(resolved)).catch(() => path.dirname(resolved))
    const roots = [home, ...folders()]
    for (const root of roots) {
      const realRoot = await realpath(root).catch(() => root)
      if (isInside(root, resolved) && isInside(realRoot, realFolder)) {
        const real = await realpath(resolved).catch(() => resolved)
        if (real !== resolved && !isInside(realRoot, real)) throw new Error('That file links outside its folder')
        return resolved
      }
    }
    throw new Error('That file is not in your personal folder or one of your workspaces')
  }

  const actions = {
    async overview({ folder }) {
      const list = workspaces().map(w => ({ path: w.path, title: w.title || path.basename(w.path) }))
      const selected = list.some(w => w.path === folder) ? folder : list[0]?.path
      const limit = await readLimit(home)
      const { files, sentBytes } = await overview({ home, folder: selected, limit })
      const notes = []
      for (const file of files) {
        if (file.status === 'missing') continue
        const content = await readFile(file.absolutePath, 'utf8').catch(() => '')
        for (const note of notesIn(content)) notes.push({ ...note, file: file.path, absolutePath: file.absolutePath })
      }
      let memory = null
      if (selected) {
        const dir = memoryDir(home, memoryProjectRoot(selected))
        const index = indexText(dir)
        memory = { folder: homeDisplay(dir), indexLines: index ? index.split('\n').length : 0, indexBytes: Buffer.byteLength(index), items: await listMemories(dir) }
      }
      return { limit, defaultLimit: DEFAULT_LIMIT, workspaces: list, folder: selected ?? null, files, sentBytes, notes, memory }
    },
    /** Harness's own system prompt, as a new session starts with it, for reading only. */
    async systemPrompt() {
      if (!assemble) return null
      return renderSystemPrompt(await assemble())
    },
    async setLimit({ maxBytes }) {
      return { limit: await writeLimit(home, maxBytes) }
    },
    /** The file's text and a hash of it; the editor sends the hash back with its save. */
    async read({ file }) {
      const target = await allowed(file)
      const content = await readText(target)
      return { content, hash: contentHash(content) }
    },
    /**
     * Save the editor's text, but only over the text it opened: when the file changed since (a note saved by
     * the remember tool, an edit elsewhere), nothing is written. Queued with the remember tool's writes.
     */
    async write({ file, content, hash }) {
      const target = await allowed(file)
      if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_EDIT_BYTES) throw new Error('The text must be under 1 MB')
      if (typeof hash !== 'string') throw new Error('Reopen the file to edit it; this save did not say which version it started from')
      return queueFileWrite(target, async () => {
        if (contentHash(await readText(target)) !== hash) {
          throw new Error('The file changed since you opened it, so your edit was not saved. Copy your text, reopen the file to see the changes, and edit again.')
        }
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, content, 'utf8')
        return { saved: true }
      })
    },
    async open({ file }) {
      const target = await allowed(file)
      if (!(await exists(target))) {
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, '', 'utf8')
      }
      const [command, args] = process.platform === 'darwin' ? ['open', ['-t', target]]
        : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]]
          : ['xdg-open', [target]]
      await new Promise((resolve, reject) => execFile(command, args, { timeout: 10000 }, error => (error ? reject(error) : resolve())))
      return { opened: true }
    },
    async deleteMemory({ folder, name }) {
      if (!folders().includes(folder)) throw new Error('That is not one of your workspaces')
      return { deleted: await deleteMemory(memoryDir(home, memoryProjectRoot(folder)), name) }
    },
    async openMemory({ folder, name }) {
      if (!folders().includes(folder)) throw new Error('That is not one of your workspaces')
      const dir = memoryDir(home, memoryProjectRoot(folder))
      if (name !== INDEX && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error('Unknown memory')
      const target = path.join(dir, name === INDEX ? INDEX : `${name}.md`)
      if (!(await exists(target))) throw new Error('That memory no longer exists')
      const [command, args] = process.platform === 'darwin' ? ['open', ['-t', target]] : ['xdg-open', [target]]
      await new Promise((resolve, reject) => execFile(command, args, { timeout: 10000 }, error => (error ? reject(error) : resolve())))
      return { opened: true }
    },
    /** Delete a note's line from the Remembered section only; the same text elsewhere in the file is left alone. */
    async deleteNote({ file, line }) {
      const target = await allowed(file)
      if (typeof line !== 'string' || !line.startsWith('- ')) throw new Error('That note is no longer in the file')
      return queueFileWrite(target, async () => {
        const lines = (await readFile(target, 'utf8')).split('\n')
        const { start, end } = rememberedRange(lines)
        let at = -1
        for (let i = start + 1; start !== -1 && i < end; i++) if (lines[i] === line) { at = i; break }
        if (at === -1) throw new Error('That note is no longer in the file')
        lines.splice(at, 1)
        await writeFile(target, lines.join('\n'), 'utf8')
        return { deleted: true }
      })
    },
  }

  class InstructionsAccess {
    constructor() {
      this.typertRemote = Object.freeze({ service: this, serviceKey: INSTRUCTIONS_SERVICE, namespace: INSTRUCTIONS_SERVICE })
    }

    /** @param {{ action: string }} request */
    async call(request) {
      const action = actions[request?.action]
      if (!action) throw new Error(`Unknown action ${request?.action}`)
      return action(request)
    }
  }
  Object.defineProperty(InstructionsAccess.prototype, REMOTE_METHODS_MARKER, {
    configurable: true,
    value: Object.freeze({ version: 1, methods: Object.freeze([Object.freeze({ method: 'call', invocation: Object.freeze({ kind: 'direct' }) })]) }),
  })
  return { access: new InstructionsAccess(), actions }
}
