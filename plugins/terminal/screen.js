/**
 * Pure parts of the agent terminal: turning named keys into the bytes a terminal program expects, and
 * rendering the emulated screen as text the model can read. Kept free of Harness services so they can be
 * tested directly.
 */

/** Named keys, matched without regard to case. Arrow and Home/End keys depend on the program's cursor mode. */
const KEYS = {
  enter: '\r', return: '\r', tab: '\t', 'shift-tab': '\x1b[Z', escape: '\x1b', esc: '\x1b', backspace: '\x7f', space: ' ',
  delete: '\x1b[3~', insert: '\x1b[2~', pageup: '\x1b[5~', pagedown: '\x1b[6~',
  f1: '\x1bOP', f2: '\x1bOQ', f3: '\x1bOR', f4: '\x1bOS', f5: '\x1b[15~', f6: '\x1b[17~', f7: '\x1b[18~', f8: '\x1b[19~',
  f9: '\x1b[20~', f10: '\x1b[21~', f11: '\x1b[23~', f12: '\x1b[24~',
}
const CURSOR_KEYS = { up: 'A', down: 'B', right: 'C', left: 'D', home: 'H', end: 'F' }

/** Every key name `keysToBytes` accepts, for the tool description. */
export const KEY_NAMES = ['any single character', 'Enter', 'Tab', 'Shift-Tab', 'Escape', 'Backspace', 'Space', 'Delete', 'Insert', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'F1–F12', 'Ctrl-A … Ctrl-Z', 'Alt-<key>']

/**
 * The bytes for a list of named keys.
 * @param {string[]} keys - names such as `Enter`, `Up`, `Ctrl-C`, `Alt-x`.
 * @param {{ applicationCursor?: boolean }} [modes] - whether the program switched the arrow keys to application mode.
 * @returns {string}
 * @throws {Error} naming the first key it does not know.
 */
export function keysToBytes(keys, modes = {}) {
  let out = ''
  for (const raw of keys) {
    // A single character is typed as itself, so ["Escape", ":", "w", "q", "Enter"] works.
    if (typeof raw === 'string' && [...raw].length === 1) { out += raw; continue }
    const name = String(raw).trim().toLowerCase()
    const cursor = CURSOR_KEYS[name]
    if (cursor !== undefined) {
      out += (modes.applicationCursor ? '\x1bO' : '\x1b[') + cursor
      continue
    }
    if (KEYS[name] !== undefined) {
      out += KEYS[name]
      continue
    }
    const ctrl = /^(?:ctrl|control|c)-(.)$/.exec(name)
    if (ctrl) {
      const ch = ctrl[1]
      if (ch >= 'a' && ch <= 'z') { out += String.fromCharCode(ch.charCodeAt(0) - 96); continue }
      const special = { '[': '\x1b', '\\': '\x1c', ']': '\x1d', '^': '\x1e', '_': '\x1f', '@': '\x00', ' ': '\x00' }[ch]
      if (special !== undefined) { out += special; continue }
    }
    const alt = /^(?:alt|meta|m)-(.+)$/.exec(name)
    if (alt) {
      const rest = alt[1]
      out += '\x1b' + (rest.length === 1 ? String(raw).trim().slice(-1) : keysToBytes([rest], modes))
      continue
    }
    throw new Error(`unknown key "${raw}"; use one of ${KEY_NAMES.join(', ')}, or put plain text in the text field`)
  }
  return out
}

/**
 * The visible screen of an emulated terminal as text: one line per row, trailing spaces and trailing empty
 * rows removed, with the cursor position.
 * @param {{ rows: number, cols: number, buffer: { active: { viewportY: number, cursorX: number, cursorY: number, getLine(y: number): { translateToString(trim: boolean): string } | undefined } } }} term
 * @returns {{ lines: string[], cursor: { row: number, column: number } }}
 */
export function readScreen(term) {
  const buffer = term.buffer.active
  const lines = []
  for (let y = 0; y < term.rows; y++) lines.push(buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? '')
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return { lines, cursor: { row: buffer.cursorY + 1, column: buffer.cursorX + 1 } }
}

/**
 * The text a tool returns for a terminal: a header, then the screen between rules.
 * @param {{ id: string, command: string, cols: number, rows: number, status: string, lines: string[], cursor: { row: number, column: number }, note?: string }} view
 */
export function screenText({ id, command, cols, rows, status, lines, cursor, note }) {
  const label = command.length > 60 ? `${command.slice(0, 57)}…` : command
  return [
    `Terminal ${id} · ${label} · ${cols}×${rows} · ${status}`,
    `Cursor: row ${cursor.row}, column ${cursor.column}`,
    ...note ? [note] : [],
    '──── screen ────',
    ...lines,
    '────────────────',
  ].join('\n')
}
