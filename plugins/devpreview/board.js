/**
 * Design boards for the Design pane: the boards in a folder's `designs/` directory, and one board prepared for
 * the pane's sandboxed frame.
 *
 * A board is the single HTML file the design-board skill writes (plugins/compact/skills/design-board.md) at
 * `designs/<topic>.board.html`. Its last part is the board viewer (board-runtime.html, a copy of
 * plugins/compact/skills/board-runtime.html that the tests keep identical). Boards written before the viewer
 * learned to report clicks to the pane carry an older copy, so every board is shown with the current viewer
 * in place of whatever copy it has; the file itself is never changed. A board whose viewer cannot be found
 * (the agent edited it) is shown as it is, without click-to-reference.
 *
 * The prepared board also gets a Content Security Policy as the first thing in its head: inline scripts and
 * styles run, web fonts, stylesheets and images load, but its scripts cannot fetch, post forms or open
 * sockets, so a board cannot send what it holds anywhere. The pane's frame adds the rest of the isolation
 * (scripts only, an opaque origin with no access to the app).
 */
import { readFileSync } from 'node:fs'
import { lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export const BOARD_DIR = 'designs'
export const BOARD_NAME = /^[^/\\\0]{1,200}\.board\.html$/
/** The largest board the pane shows. */
export const MAX_BOARD_BYTES = 8 * 1024 * 1024
const MAX_BOARDS = 200

export const BOARD_RUNTIME = readFileSync(new URL('./board-runtime.html', import.meta.url), 'utf8').trimEnd()

export const BOARD_POLICY = [
  "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline' https: data:", 'font-src https: data:',
  'img-src https: data: blob:', 'media-src https: data: blob:', "connect-src 'none'", "form-action 'none'", "base-uri 'none'",
].join('; ')

const failure = (status, message) => Object.assign(new Error(message), { status })

/**
 * The boards in `<cwd>/designs`, newest first. A missing folder has none; links and other non-files are left out.
 * @param {string} cwd - the session folder (already validated as an absolute directory).
 * @returns {Promise<{ boards: { name: string, modified: number, size: number }[] }>}
 */
export async function listBoards(cwd) {
  const folder = path.join(cwd, BOARD_DIR)
  const info = await lstat(folder).catch(() => undefined)
  if (info === undefined || !info.isDirectory()) return { boards: [] }
  const names = (await readdir(folder).catch(() => [])).filter(name => BOARD_NAME.test(name))
  const boards = []
  for (const name of names) {
    const file = await lstat(path.join(folder, name)).catch(() => undefined)
    if (file !== undefined && file.isFile()) boards.push({ name, modified: Math.round(file.mtimeMs), size: file.size })
  }
  boards.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name))
  return { boards: boards.slice(0, MAX_BOARDS) }
}

/**
 * One board, prepared for the Design pane.
 * @param {string} cwd - the session folder.
 * @param {string | null} name - a file name in `designs/`, ending in `.board.html`.
 * @returns {Promise<{ name: string, modified: number, html: string, linked: boolean }>}
 */
export async function readBoard(cwd, name) {
  if (typeof name !== 'string' || !BOARD_NAME.test(name) || name === '.board.html' || name.startsWith('.')) throw failure(400, 'name must be a .board.html file in designs/')
  const folder = path.join(cwd, BOARD_DIR)
  const dir = await lstat(folder).catch(() => undefined)
  if (dir === undefined || !dir.isDirectory()) throw failure(404, 'There is no designs folder here')
  const file = path.join(folder, name)
  const info = await lstat(file).catch(() => undefined)
  if (info === undefined || !info.isFile()) throw failure(404, `There is no board named ${name}`)
  if (info.size > MAX_BOARD_BYTES) throw failure(413, `${name} is larger than ${MAX_BOARD_BYTES / 1024 / 1024} MB`)
  const { html, linked } = prepareBoard(await readFile(file, 'utf8'))
  return { name, modified: Math.round(info.mtimeMs), html, linked }
}

/**
 * Where a board's viewer sits: between the current viewer's comment markers, or, for a board written before
 * the markers, from the `<style>` holding `#hs-board-bar` to the end of the script that builds the board.
 * @param {string} html
 * @returns {{ from: number, to: number } | undefined}
 */
export function findRuntime(html) {
  const START = '<!-- hs-board-runtime'
  const END = '<!-- /hs-board-runtime -->'
  const marked = html.lastIndexOf(START)
  if (marked !== -1) {
    const end = html.indexOf(END, marked)
    if (end !== -1) return { from: marked, to: end + END.length }
  }
  const bar = html.indexOf('#hs-board-bar')
  const builder = html.indexOf('Harness Studio design board', bar)
  if (bar === -1 || builder === -1) return undefined
  const from = html.lastIndexOf('<style', bar)
  const close = html.indexOf('</script>', builder)
  if (from === -1 || close === -1 || html.lastIndexOf('<script', builder) < from) return undefined
  return { from, to: close + '</script>'.length }
}

/**
 * The board with the current viewer and the pane's policy.
 * @param {string} html - the board file's text.
 * @returns {{ html: string, linked: boolean }} `linked` says whether the current viewer is in it.
 */
export function prepareBoard(html) {
  const at = findRuntime(html)
  const body = at === undefined ? html : html.slice(0, at.from) + BOARD_RUNTIME + html.slice(at.to)
  const policy = `<meta http-equiv="Content-Security-Policy" content="${BOARD_POLICY}">`
  // In the board's own head, or else straight after the doctype, where the parser opens a head for it. Never in a
  // screen's template, where a policy would do nothing.
  const head = /<head(\s[^>]*)?>/i.exec(body)
  const content = body.search(/<(template|body)[\s>]/i)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(body)
  const insertAt = head && (content === -1 || head.index < content) ? head.index + head[0].length : doctype ? doctype[0].length : 0
  return { html: body.slice(0, insertAt) + policy + body.slice(insertAt), linked: at !== undefined }
}
