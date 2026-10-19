/**
 * Pure parts of Remember: note checks, the approval card's choices, and where a note goes in its file.
 * Kept free of Harness services so they can be tested directly.
 */

export const QUESTION_ID = 'harness-studio/remember'
export const PROJECT = 'This project'
export const PERSONAL = 'All my projects'
export const SKIP = "Don't save"

/** Heading of the section Remember keeps its notes under, in either file. */
export const HEADING = '## Remembered'
export const MAX_NOTE_CHARS = 300

/**
 * Shapes of secrets a note must never carry: provider keys, tokens, private keys, and `password: …`-style pairs.
 * Word boundaries are written as "no letter or digit before", since `\b` sees no boundary after an underscore
 * (`DB_PASSWORD`). Value parts need at least 6 characters, and values of name-value pairs that are a `$VAR`,
 * `<placeholder>` or `{template}` are let through, to keep false positives low.
 */
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /(?<![A-Za-z0-9])[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/,
  /(?<![A-Za-z0-9])glpat-[A-Za-z0-9_-]{20,}/,
  /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{30,}/,
  /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?<![A-Za-z0-9])(?:password|passwd|passphrase|secret|api[ _-]?key|access[ _-]?token|token)\s*[:=]\s*(?![$<{])\S{6,}/i,
  // Env-style assignments whose name holds KEY, TOKEN, SECRET, PASSWORD or PASSWD: `export GITHUB_TOKEN=…`.
  /(?<![A-Za-z0-9_])[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*\s*=\s*['"]?(?![$<{])[^\s'"]{6,}/,
  // Credentials in a URL: `scheme://user:password@host`.
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{6,}@/,
  /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{6,}/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/,
]

/**
 * Whether text looks like it holds a secret: a provider key, token, private key, or a `password: …`-style pair.
 * @param {string} text
 */
export function looksSecret(text) {
  return SECRET_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * Today's date on the user's own calendar, `YYYY-MM-DD`; `toISOString` would give the UTC date, which is a day
 * off for part of every day outside UTC.
 * @param {Date} [now]
 */
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * Normalise a proposed note to one line and refuse what must not be saved.
 * @param {unknown} raw - the note the agent proposed.
 * @returns {string} the note as it will be written, without a leading bullet.
 * @throws {Error} when the note is empty, too long, or looks like it holds a secret.
 */
export function cleanNote(raw) {
  if (typeof raw !== 'string') throw new Error('note must be text')
  const note = raw.replace(/\s+/g, ' ').trim().replace(/^[-*•]\s+/, '')
  if (note === '') throw new Error('note is empty')
  if (note.length > MAX_NOTE_CHARS) throw new Error(`keep the note to one line under ${MAX_NOTE_CHARS} characters; this one has ${note.length}`)
  if (looksSecret(note)) {
    throw new Error('the note looks like it contains a password, key or token; secrets are never saved')
  }
  return note
}

/**
 * Card options in the order shown, the suggested place first. Descriptions name the file, not its full path,
 * so the card stays short; the tool's answer gives the path.
 * @param {'project' | 'personal'} suggested
 */
export function cardOptions(suggested) {
  const project = { label: PROJECT, description: 'Saved in AGENTS.local.md at this project\'s root, read by new sessions here. Not part of the shared instructions.' }
  const personal = { label: PERSONAL, description: 'Saved in your personal AGENTS.md, read by new sessions in every project.' }
  const skip = { label: SKIP, description: 'Save nothing.' }
  return suggested === 'personal' ? [personal, project, skip] : [project, personal, skip]
}

/**
 * Read the user's answer to the card.
 * @param {{ selected?: string[], custom?: string } | undefined} reply
 * @returns {{ scope: 'project' | 'personal' } | { scope: null, said?: string }}
 */
export function readChoice(reply) {
  const selected = reply?.selected ?? []
  if (selected.includes(PROJECT)) return { scope: 'project' }
  if (selected.includes(PERSONAL)) return { scope: 'personal' }
  const said = typeof reply?.custom === 'string' ? reply.custom.trim() : ''
  return said === '' ? { scope: null } : { scope: null, said }
}

/**
 * Add a note to an instruction file's text under {@link HEADING}, creating the section when missing.
 * A note already present (same text, any date) is not added twice.
 * @param {string} existing - the file's current text, empty when it does not exist yet.
 * @param {string} note - a cleaned note.
 * @param {string} date - `YYYY-MM-DD` recorded with the note.
 * @returns {{ content: string, added: boolean }}
 */
export function withNote(existing, note, date) {
  const line = `- ${note} (${date})`
  const lines = existing.split('\n')
  const start = lines.findIndex(text => text.trim() === HEADING)
  if (start !== -1) {
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      if (/^#{1,2}\s/.test(lines[i])) { end = i; break }
    }
    const section = lines.slice(start + 1, end)
    if (section.some(text => text.startsWith(`- ${note} (`) || text === `- ${note}`)) return { content: existing, added: false }
    let last = start
    for (let i = start + 1; i < end; i++) if (lines[i].trim() !== '') last = i
    const insertAt = last === start ? start + 1 : last + 1
    const before = lines.slice(0, insertAt)
    if (last === start) before.push('')
    const next = [...before, line, ...lines.slice(insertAt)]
    return { content: next.join('\n').replace(/\n*$/, '\n'), added: true }
  }
  const body = existing.replace(/\s+$/, '')
  return { content: `${body}${body === '' ? '' : '\n\n'}${HEADING}\n\n${line}\n`, added: true }
}
