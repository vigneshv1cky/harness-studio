/**
 * Your data: what Harness Studio keeps on this computer, where, and how large it is, with a way to open each
 * folder. Nothing here reads file contents; it only counts sizes.
 */
import { execFile } from 'node:child_process'
import { lstat, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** At most this many entries are visited per location when sizing, so a huge cache cannot stall the page. */
const MAX_ENTRIES = 200_000

/** The locations, relative to the Harness home folder unless `absolute`; `files` lists single files instead of a folder. */
export const LOCATIONS = [
  { id: 'sessions', label: 'Conversations', rel: 'sessions', what: 'Every session: messages, tool calls and their results, one folder per workspace.' },
  { id: 'memory', label: 'Auto memory', rel: 'memory', what: 'Notes the agent keeps for itself, one folder per project.' },
  { id: 'undo', label: 'Undo copies', rel: 'harness-studio/undo', what: 'Copies of files taken before the agent first changed them in a turn, so Undo can put them back.' },
  { id: 'worktrees', label: 'Separate-session worktrees', rel: 'harness-studio/worktrees', what: 'Git worktrees that separate sessions work in. Remove them from their sessions, not here.' },
  { id: 'settings', label: 'Settings and rules', rel: '.', files: ['settings.yaml', 'hooks.json', 'permissions.json'], what: 'Settings, your hooks and your command rules.' },
  { id: 'studio', label: 'Plugin settings', rel: 'harness-studio', files: ['instructions.json', 'sessions.json', 'watches.json', 'network.json', 'hooks-trust.json', 'connectors.json'], what: 'Instruction limits, watches, the network setting, hook approvals and connectors.' },
  { id: 'storages', label: 'Workspaces and schedules', rel: 'storages', what: 'Your workspace list, automation schedules and caches.' },
  { id: 'credentials', label: 'Keys and sign-ins', rel: '.', files: ['.credentials.yaml'], what: 'Model provider keys and connector sign-ins. Only its size is shown.' },
  { id: 'profiles', label: 'Plugin lists', rel: 'profiles', what: 'Which plugins load in the app and in the command-line tool.' },
]

/** The window's own data folder (Browser pane cookies and storage, caches) for a platform. */
export function appDataFolder(platform = process.platform, home = os.homedir(), env = process.env) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Harness Studio')
  if (platform === 'win32') return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Harness Studio')
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Harness Studio')
}

/** Total size and file count below a path, without following links, stopping after MAX_ENTRIES entries. */
export async function sizeOf(target) {
  let bytes = 0
  let files = 0
  let visited = 0
  let partial = false
  const stack = [target]
  while (stack.length) {
    const current = stack.pop()
    let info
    try { info = await lstat(current) } catch { continue }
    if (++visited > MAX_ENTRIES) { partial = true; break }
    if (info.isDirectory()) {
      let names = []
      try { names = await readdir(current) } catch { continue }
      for (const name of names) stack.push(path.join(current, name))
    } else {
      bytes += info.size
      files += 1
    }
  }
  return { bytes, files, partial }
}

const exists = async p => { try { await lstat(p); return true } catch { return false } }

/**
 * The data inventory for one Harness home folder.
 * @param {{ home: string, appData?: string, platform?: string, run?: (file: string, args: string[]) => Promise<void> }} options
 */
export function createDataInventory({ home, appData = appDataFolder(), platform = process.platform, run = execFileAsync }) {
  const locationPath = loc => path.resolve(home, loc.rel)
  const all = () => [...LOCATIONS, { id: 'appdata', label: 'Window data', absolute: appData, what: 'The app window’s own folder: Browser pane cookies and site storage, and caches.' }]
  const find = id => all().find(loc => loc.id === id)

  return {
    home,
    /** Every location with its path, size and what it holds. */
    async list() {
      return Promise.all(all().map(async loc => {
        const base = loc.absolute ?? locationPath(loc)
        let size = { bytes: 0, files: 0, partial: false }
        let present = false
        if (loc.files) {
          for (const name of loc.files) {
            const s = await sizeOf(path.join(base, name))
            if (s.files) present = true
            size = { bytes: size.bytes + s.bytes, files: size.files + s.files, partial: size.partial || s.partial }
          }
        } else if (await exists(base)) {
          present = true
          size = await sizeOf(base)
        }
        return { id: loc.id, label: loc.label, what: loc.what, path: loc.files ? loc.files.map(f => path.join(base, f)).join(', ') : base, folder: base, present, ...size }
      }))
    },

    /** Show a location in the file manager. */
    async reveal({ id }) {
      const loc = find(id)
      if (loc === undefined) throw new Error(`Unknown location ${id}`)
      const folder = loc.absolute ?? locationPath(loc)
      if (!(await exists(folder))) throw new Error(`${folder} does not exist yet`)
      if (platform === 'darwin') await run('open', [folder])
      else if (platform === 'win32') await run('explorer', [folder])
      else await run('xdg-open', [folder])
      return { ok: true }
    },
  }
}

function execFileAsync(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 120_000 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`${file} failed: ${String(stderr || error.message).trim()}`))
      else resolve()
    })
  })
}
