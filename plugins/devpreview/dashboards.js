/**
 * Dashboards for the Dashboards pane: pages the dashboards skill writes in `dashboards/<name>/`, each with refresh
 * scripts that fetch its data, run by the app when the page is opened, without the agent.
 *
 * A dashboard is a folder (plugins/compact/skills/dashboards.md):
 *   dashboard.html  the page: charts drawn by its own scripts from the data the pane sends it;
 *   refresh/        one script per data source (`<source>.sh`, `.py`, `.mjs` or `.js`, printing JSON), plus files
 *                   they use, such as a `.sql` query;
 *   data/           the last result of each source, `<source>.json`, written here after each refresh.
 *
 * Safety:
 *   - A refresh runs only the dashboard's own scripts, each as `<interpreter> refresh/<file>` in the dashboard
 *     folder, through Harness's own command runner under the session's sandbox and network setting (the same
 *     rules as the agent's commands), with a time limit and an output cap. The page never names a command: it can
 *     only ask the pane to refresh.
 *   - Nothing runs until the person approves the refresh folder at its exact content: the approval stores a
 *     hash of every file in `refresh/` (names and contents), in `<harness home>/harness-studio/dashboard-approvals.json`,
 *     outside every session folder. Any change to any of those files needs a new approval. Only the pane can
 *     approve, through the local helper, whose key the agent never has. Links and folders inside `refresh/` are
 *     refused, so the hash covers everything the folder holds.
 *   - A script's output must be JSON and at most 2 MB; it is written to `data/<source>.json` by replacing the file
 *     (a link there is replaced, never followed). The page receives only that data.
 */
import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const DASHBOARD_DIR = 'dashboards'
export const DASHBOARD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
export const SCRIPT_NAME = /^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.(sh|py|mjs|js)$/
const INTERPRETERS = { sh: 'sh', py: 'python3', mjs: 'node', js: 'node' }
export const LIMITS = {
  dashboards: 100, refreshFiles: 50, refreshFileBytes: 256 * 1024, shownTextBytes: 64 * 1024, pageBytes: 8 * 1024 * 1024,
  outputBytes: 2 * 1024 * 1024, dataBytes: 4 * 1024 * 1024, timeoutMs: 60_000,
}

export const DASHBOARD_POLICY = [
  "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline' https: data:", 'font-src https: data:',
  'img-src https: data: blob:', "connect-src 'none'", "form-action 'none'", "base-uri 'none'",
].join('; ')

const failure = (status, message) => Object.assign(new Error(message), { status })
const realDir = async target => { const info = await lstat(target).catch(() => undefined); return info !== undefined && info.isDirectory() && !info.isSymbolicLink() }

/** A string as one single-quoted shell word. */
export const shellQuote = text => `'${String(text).replace(/'/g, `'\\''`)}'`

/** The dashboard's folder, checked: a plain folder directly in `<cwd>/dashboards`. */
export async function dashboardFolder(cwd, name) {
  if (typeof name !== 'string' || !DASHBOARD_NAME.test(name)) throw failure(400, 'name must be a dashboard folder name')
  const root = path.join(cwd, DASHBOARD_DIR)
  if (!(await realDir(root))) throw failure(404, 'There is no dashboards folder here')
  const dir = path.join(root, name)
  if (!(await realDir(dir))) throw failure(404, `There is no dashboard named ${name}`)
  return dir
}

/**
 * Every file in a dashboard's `refresh/` folder, with its content's hash; refused when the folder holds a link,
 * a folder or too much.
 * @returns {Promise<{ name: string, size: number, sha256: string, text: string }[]>}
 */
export async function refreshFiles(dir) {
  const folder = path.join(dir, 'refresh')
  if (!(await realDir(folder))) return []
  const names = (await readdir(folder)).sort()
  if (names.length > LIMITS.refreshFiles) throw failure(413, `refresh/ holds more than ${LIMITS.refreshFiles} files`)
  const files = []
  for (const name of names) {
    const info = await lstat(path.join(folder, name))
    if (!info.isFile()) throw failure(422, `refresh/${name} is a ${info.isSymbolicLink() ? 'link' : 'folder'}; refresh/ may hold only plain files, so that approving it covers everything it runs`)
    if (info.size > LIMITS.refreshFileBytes) throw failure(413, `refresh/${name} is larger than ${LIMITS.refreshFileBytes / 1024} KB`)
    const bytes = await readFile(path.join(folder, name))
    files.push({ name, size: info.size, sha256: createHash('sha256').update(bytes).digest('hex'), text: bytes.toString('utf8') })
  }
  return files
}

/** The hash an approval names: every file's name and content hash, in name order. */
export function refreshHash(files) {
  const hash = createHash('sha256')
  for (const file of files) hash.update(`${file.name}\0${file.sha256}\n`)
  return hash.digest('hex')
}

/** The sources: one per script in refresh/, by its name without the extension. */
export const sourcesOf = files => files.flatMap(file => { const m = SCRIPT_NAME.exec(file.name); return m ? [{ id: m[1], script: file.name, interpreter: INTERPRETERS[m[2]] }] : [] })

/** The page's `<title>`, if it has one in its first 64 KB. */
async function titleOf(file) {
  const head = (await readFile(file).catch(() => Buffer.alloc(0))).subarray(0, 65536).toString('utf8')
  const m = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(head)
  return m ? m[1].trim() : undefined
}

/**
 * The dashboards in `<cwd>/dashboards`, newest first: folders holding a dashboard.html.
 * @returns {Promise<{ dashboards: { name: string, title?: string, modified: number, updated: number }[] }>}
 */
export async function listDashboards(cwd) {
  const root = path.join(cwd, DASHBOARD_DIR)
  if (!(await realDir(root))) return { dashboards: [] }
  const dashboards = []
  for (const name of (await readdir(root).catch(() => [])).filter(n => DASHBOARD_NAME.test(n))) {
    if (!(await realDir(path.join(root, name)))) continue
    const page = await lstat(path.join(root, name, 'dashboard.html')).catch(() => undefined)
    if (page === undefined || !page.isFile()) continue
    dashboards.push({ name, title: await titleOf(path.join(root, name, 'dashboard.html')), modified: Math.round(page.mtimeMs), updated: await dataUpdated(path.join(root, name, 'data')) })
  }
  dashboards.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name))
  return { dashboards: dashboards.slice(0, LIMITS.dashboards) }
}

/** When any source's saved data last changed (0 for none), so the pane can show data a watch refreshed. */
async function dataUpdated(folder) {
  if (!(await realDir(folder))) return 0
  let latest = 0
  for (const name of (await readdir(folder).catch(() => [])).filter(n => n.endsWith('.json')).slice(0, LIMITS.refreshFiles)) {
    const info = await lstat(path.join(folder, name)).catch(() => undefined)
    if (info?.isFile()) latest = Math.max(latest, Math.round(info.mtimeMs))
  }
  return latest
}

/** The page with the pane's policy as the first thing in its head, so its scripts cannot send anything anywhere. */
export function preparePage(html) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${DASHBOARD_POLICY}">`
  const head = /<head(\s[^>]*)?>/i.exec(html)
  const body = html.search(/<body[\s>]/i)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  const at = head && (body === -1 || head.index < body) ? head.index + head[0].length : doctype ? doctype[0].length : 0
  return html.slice(0, at) + policy + html.slice(at)
}

/** The saved data of each source: `{ value, updated }`, or `{ error }` when its file does not parse. */
async function savedData(dir, sources) {
  const data = {}
  for (const source of sources) {
    const file = path.join(dir, 'data', `${source.id}.json`)
    const info = await lstat(file).catch(() => undefined)
    if (info === undefined || !info.isFile()) continue
    if (info.size > LIMITS.dataBytes) { data[source.id] = { error: 'the saved data is too large to show' }; continue }
    try {
      data[source.id] = { value: JSON.parse(await readFile(file, 'utf8')), updated: Math.round(info.mtimeMs) }
    } catch {
      data[source.id] = { error: 'the saved data is not JSON' }
    }
  }
  return data
}

/**
 * The approvals: per dashboard folder (its real path), the hash of the refresh files the person approved.
 * Saved in one owner-only file, replaced atomically, one save at a time.
 * @param {string} file - `<harness home>/harness-studio/dashboard-approvals.json`.
 */
export function createApprovals(file) {
  let saving = Promise.resolve()
  async function load() {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      return parsed !== null && typeof parsed.approvals === 'object' ? parsed.approvals : {}
    } catch {
      return {}
    }
  }
  return {
    async hashOf(key) { return (await load())[key]?.hash },
    async set(key, hash) {
      const save = saving.then(async () => {
        const approvals = await load()
        if (hash === undefined) delete approvals[key]
        else approvals[key] = { hash, approvedAt: new Date().toISOString() }
        await mkdir(path.dirname(file), { recursive: true })
        const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`
        try {
          await writeFile(temp, `${JSON.stringify({ version: 1, approvals }, null, 2)}\n`, { mode: 0o600 })
          await rename(temp, file)
        } catch (error) {
          await rm(temp, { force: true }).catch(() => {})
          throw error
        }
      })
      saving = save.catch(() => {})
      return save
    },
  }
}

/**
 * Dashboards for one Host: reading them for the pane, approving, refreshing and snapshots.
 * @param {{ approvals: ReturnType<typeof createApprovals>, now?: () => number }} options
 */
export function createDashboards({ approvals, now = Date.now }) {
  /** Refreshes in progress, per dashboard folder, so a second request joins the first. */
  const running = new Map()
  /** The last refresh's errors and time, per dashboard folder. */
  const last = new Map()

  async function describe(cwd, name) {
    const dir = await dashboardFolder(cwd, name)
    const key = await realpath(dir)
    let files = []
    let problem
    try { files = await refreshFiles(dir) } catch (error) { problem = error.message }
    const hash = problem ? undefined : refreshHash(files)
    const approved = hash !== undefined && files.length > 0 && (await approvals.hashOf(key)) === hash
    return { dir, key, files, hash, approved, problem, sources: sourcesOf(files) }
  }

  return {
    list: cwd => listDashboards(cwd),

    /** One dashboard for the pane: its prepared page, sources, saved data, and what approving it would cover. */
    async read(cwd, name) {
      const d = await describe(cwd, name)
      const page = path.join(d.dir, 'dashboard.html')
      const info = await lstat(page).catch(() => undefined)
      if (info === undefined || !info.isFile()) throw failure(404, `${name} has no dashboard.html`)
      if (info.size > LIMITS.pageBytes) throw failure(413, `${name}/dashboard.html is larger than 8 MB`)
      const html = await readFile(page, 'utf8')
      const shown = d.files.map(file => ({
        name: file.name, size: file.size,
        text: file.text.length > LIMITS.shownTextBytes ? file.text.slice(0, LIMITS.shownTextBytes) : file.text,
        truncated: file.text.length > LIMITS.shownTextBytes,
      }))
      return {
        name, title: await titleOf(page), modified: Math.round(info.mtimeMs), html: preparePage(html),
        sources: d.sources.map(s => s.id), data: await savedData(d.dir, d.sources),
        approval: { approved: d.approved, hash: d.hash, files: shown, ...d.problem ? { problem: d.problem } : {} },
        lastRefresh: last.get(d.key),
      }
    },

    /** Approve the refresh files, only when they are still exactly what the person was shown. */
    async approve(cwd, name, hash) {
      const d = await describe(cwd, name)
      if (d.problem) throw failure(422, d.problem)
      if (d.files.length === 0) throw failure(422, `${name} has no refresh scripts`)
      if (typeof hash !== 'string' || hash !== d.hash) throw failure(409, 'The refresh files changed since they were shown. Look at them again before approving.')
      await approvals.set(d.key, d.hash)
      return { approved: true, hash: d.hash }
    },

    /** Withdraw the approval. */
    async revoke(cwd, name) {
      const d = await describe(cwd, name)
      await approvals.set(d.key, undefined)
      return { approved: false }
    },

    /**
     * Run every source's script and save its data. Refused unless approved at the current content.
     * @param {{ cwd: string, name: string, run: (command: string, workdir: string) => Promise<{ exitCode: number | null, stdout: string, stderr: string, timedOut: boolean }> }} request
     */
    async refresh({ cwd, name, run }) {
      const d = await describe(cwd, name)
      if (d.problem) throw failure(422, d.problem)
      if (!d.approved) throw failure(409, d.files.length === 0 ? `${name} has no refresh scripts` : `${name}'s refresh scripts are not approved at their current content`)
      if (running.has(d.key)) return running.get(d.key)
      const job = (async () => {
        const errors = {}
        let saved = 0
        for (const source of d.sources) {
          const result = await run(`${source.interpreter} ${shellQuote(`refresh/${source.script}`)}`, d.dir).catch(error => ({ exitCode: null, stdout: '', stderr: String(error?.message ?? error), timedOut: false }))
          if (result.exitCode !== 0) {
            errors[source.id] = result.timedOut ? `took longer than ${LIMITS.timeoutMs / 1000} s` : `exited with ${result.exitCode}: ${firstLines(result.stderr || result.stdout)}`
            continue
          }
          if (Buffer.byteLength(result.stdout) > LIMITS.outputBytes) { errors[source.id] = 'printed more than 2 MB'; continue }
          let value
          try { value = JSON.parse(result.stdout) } catch { errors[source.id] = `did not print JSON: ${firstLines(result.stdout || result.stderr)}`; continue }
          try {
            await saveData(d.dir, source.id, value)
            saved++
          } catch (error) {
            errors[source.id] = `could not be saved: ${error.message}`
          }
        }
        const summary = { at: now(), sources: d.sources.length, saved, errors }
        last.set(d.key, summary)
        return summary
      })()
      running.set(d.key, job)
      try { return await job } finally { running.delete(d.key) }
    },

    /** One self-contained HTML file with the data as it is now and no refresh, saved in the dashboard's snapshots/. */
    async snapshot(cwd, name) {
      const d = await describe(cwd, name)
      const page = path.join(d.dir, 'dashboard.html')
      const info = await lstat(page).catch(() => undefined)
      if (info === undefined || !info.isFile() || info.size > LIMITS.pageBytes) throw failure(404, `${name} has no dashboard.html to save`)
      const data = await savedData(d.dir, d.sources)
      const html = snapshotPage(await readFile(page, 'utf8'), { data, savedAt: new Date(now()).toISOString() })
      const folder = path.join(d.dir, 'snapshots')
      const folderInfo = await lstat(folder).catch(() => undefined)
      if (folderInfo !== undefined && (folderInfo.isSymbolicLink() || !folderInfo.isDirectory())) throw failure(409, `${name}/snapshots is not a plain folder`)
      await mkdir(folder, { recursive: true })
      // Named in this computer's local time, as the person reads the clock.
      const at = new Date(now())
      const two = n => String(n).padStart(2, '0')
      const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}`
      const file = `${name}-${stamp}.html`
      await replaceFile(path.join(folder, file), html)
      return { path: `${DASHBOARD_DIR}/${name}/snapshots/${file}` }
    },
  }
}

/** The page with its data written into it, for a snapshot: the dashboard runtime reads it when no pane sends data. */
export function snapshotPage(html, { data, savedAt }) {
  const json = JSON.stringify({ data, savedAt }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  const script = `<script>window.hsDashboardSnapshot = ${json};</script>`
  const prepared = preparePage(html)
  const head = /<\/head>/i.exec(prepared)
  return head ? prepared.slice(0, head.index) + script + prepared.slice(head.index) : script + prepared
}

const firstLines = text => String(text ?? '').trim().split('\n').slice(0, 6).join('\n').slice(0, 600)

/** Write a file by replacing it: a link in its place is replaced, never followed. */
async function replaceFile(file, text) {
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, text, { flag: 'wx' })
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

async function saveData(dir, id, value) {
  const folder = path.join(dir, 'data')
  const info = await lstat(folder).catch(() => undefined)
  if (info !== undefined && (info.isSymbolicLink() || !info.isDirectory())) throw failure(409, 'data/ is not a plain folder')
  await mkdir(folder, { recursive: true })
  await replaceFile(path.join(folder, `${id}.json`), `${JSON.stringify(value)}\n`)
}
