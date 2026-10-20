/**
 * The pure half of Watch: checking a watch's request, turning a check into a comparable result, deciding
 * whether a result is news, and writing the short notice the agent gets. Nothing here runs a command,
 * touches a file or knows about Harness, so all of it is tested directly (test/logic.test.mjs).
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'

export const SOURCE = 'harness-studio-watch'

export const KINDS = ['command', 'port', 'files', 'dashboard']
/** A dashboard's folder name in dashboards/ (as the Preview plugin's dashboards.js accepts it). */
export const DASHBOARD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
export const CONDITIONS = ['change', 'match', 'no_match', 'fails', 'succeeds']

/** Limits; every one is a whole number of seconds unless it says otherwise. */
export const LIMITS = Object.freeze({
  minInterval: 5,
  defaultInterval: { command: 30, port: 10, files: 0, dashboard: 15 * 60 },
  /** A dashboard refresh runs its sources' scripts, so it is never more often than once a minute. */
  minDashboardInterval: 60,
  maxInterval: 24 * 60 * 60,
  defaultTimeout: 30,
  maxTimeout: 120,
  minCooldown: 10,
  defaultCooldown: 60,
  maxCooldown: 24 * 60 * 60,
  defaultMaxWakes: 20,
  maxMaxWakes: 200,
  defaultLifetimeMinutes: 24 * 60,
  maxLifetimeMinutes: 7 * 24 * 60,
  perSession: 10,
  total: 50,
  /** Quiet time after the last file event before a batch of file changes counts as one change, in ms. */
  filesQuietMs: 2000,
  /** File events right after a turn ends still belong to that turn's work, in ms. */
  filesTurnGraceMs: 1500,
  /** Changed paths kept per batch. */
  maxPaths: 200,
  /** Folders a files watch watches one by one where the system has no recursive watch (Linux). */
  maxWatchedFolders: 2000,
  /** Bytes of output kept per check and compared. */
  outputBytes: 64 * 1024,
  /** Characters of a pattern. */
  patternLength: 300,
  /** Characters at the end of an output a pattern is tested against: it runs on the app's main thread. */
  patternText: 16 * 1024,
  /** Bytes of the notice's body. */
  noticeBytes: 2048,
  /** Lines of before/after difference in a notice. */
  noticeLines: 40,
})

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1']
const IGNORED_SEGMENTS = new Set(['.git', 'node_modules'])

const isInt = value => Number.isInteger(value)

function wholeSeconds(value, name, { min, max, fallback }) {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a number of seconds`)
  const n = Math.round(value)
  if (n < min) throw new Error(`${name} must be at least ${min}`)
  if (n > max) throw new Error(`${name} must be at most ${max}`)
  return n
}

/**
 * Check and compile a pattern. Patterns are tested synchronously on the app's main thread, so the shapes
 * that backtrack catastrophically are refused up front rather than freezing the app.
 * @param {string} pattern
 */
export function compilePattern(pattern) {
  if (pattern.length > LIMITS.patternLength) throw new Error(`pattern is too long (${LIMITS.patternLength} characters at most)`)
  let regex
  try {
    regex = new RegExp(pattern, 'm')
  } catch (error) {
    throw new Error(`pattern is not a valid regular expression: ${error.message}`)
  }
  if (repeatsRepetition(pattern)) {
    throw new Error('pattern repeats a group that itself repeats or has alternatives, such as (a+)+, (a*)* or (a|b)+, which can take long enough to freeze the app; write it without the nested repetition')
  }
  return regex
}

/** Test a pattern against the end of a text, no more than {@link LIMITS.patternText} characters of it. */
function testPattern(pattern, text) {
  return compilePattern(pattern).test(text.length > LIMITS.patternText ? text.slice(-LIMITS.patternText) : text)
}

/**
 * Whether a (valid) pattern puts a repeating quantifier on a group whose contents hold a quantifier or an
 * alternation, as in (a+)+, (a*)*, (a?b)+, (a|ab)+ or (?:x+){2,}. Conservative: it does not try to tell
 * overlapping alternatives from safe ones.
 * @param {string} pattern
 */
function repeatsRepetition(pattern) {
  /** Per open group: whether its contents so far hold a quantifier or an alternation. */
  const open = []
  /** Whether the atom just read is a group with such contents. */
  let riskyGroup = false
  const markOpen = () => { for (const group of open) group.risky = true }
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\') { i++; riskyGroup = false; continue }
    if (c === '[') {
      for (i++; i < pattern.length && pattern[i] !== ']'; i++) if (pattern[i] === '\\') i++
      riskyGroup = false
      continue
    }
    if (c === '(') {
      open.push({ risky: false })
      if (pattern[i + 1] === '?') {
        i++
        if (pattern[i + 1] === '<' && pattern[i + 2] !== '=' && pattern[i + 2] !== '!') i = Math.max(i, pattern.indexOf('>', i))
        else i += pattern[i + 1] === '<' ? 2 : 1
      }
      riskyGroup = false
      continue
    }
    if (c === ')') { riskyGroup = open.pop()?.risky === true; continue }
    if (c === '|') { markOpen(); riskyGroup = false; continue }
    const braces = c === '{' ? /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i)) : null
    if (c === '*' || c === '+' || c === '?' || braces) {
      const repeats = c === '*' || c === '+' || (braces !== null && (braces[2] === undefined ? Number(braces[1]) > 1 : braces[3] === '' || Number(braces[3]) > 1))
      if (repeats && riskyGroup) return true
      markOpen()
      if (braces) i += braces[0].length - 1
      if (pattern[i + 1] === '?') i++
      riskyGroup = false
      continue
    }
    riskyGroup = false
  }
  return false
}

/**
 * Check a watch request, from the agent's tool or the user's form, and fill in the defaults.
 * @param {any} args - the request as given.
 * @param {{ cwd: string, now?: number }} where - the session folder, against which relative paths resolve.
 * @returns {object} the watch's settled specification.
 */
export function normalizeSpec(args, { cwd, now = Date.now() }) {
  if (!args || typeof args !== 'object') throw new Error('expected an object')
  const kind = args.kind ?? (args.command ? 'command' : args.port !== undefined ? 'port' : args.paths ? 'files' : undefined)
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`)
  const spec = { kind }

  if (kind === 'command') {
    if (typeof args.command !== 'string' || args.command.trim() === '') throw new Error('command is required for a command watch')
    if (args.command.length > 4000) throw new Error('command is too long (4000 characters at most)')
    spec.command = args.command.trim()
    spec.timeout = wholeSeconds(args.timeout_seconds, 'timeout_seconds', { min: 1, max: LIMITS.maxTimeout, fallback: LIMITS.defaultTimeout })
  } else if (kind === 'port') {
    const port = typeof args.port === 'string' ? Number(args.port) : args.port
    if (!isInt(port) || port < 1 || port > 65535) throw new Error('port must be a whole number from 1 to 65535')
    const host = args.host === undefined || args.host === '' ? 'localhost' : String(args.host).toLowerCase().replace(/^\[|\]$/g, '')
    if (!LOCAL_HOSTS.includes(host)) throw new Error('a port watch checks this computer only: host must be localhost, 127.0.0.1 or ::1')
    spec.port = port
    spec.host = host
  } else if (kind === 'dashboard') {
    if (typeof args.dashboard !== 'string' || !DASHBOARD_NAME.test(args.dashboard)) throw new Error('dashboard must be the name of a folder in dashboards/')
    spec.dashboard = args.dashboard
  } else {
    const list = Array.isArray(args.paths) ? args.paths : typeof args.paths === 'string' ? [args.paths] : []
    const paths = list.filter(p => typeof p === 'string' && p.trim() !== '').map(p => path.resolve(cwd, p.trim()))
    if (paths.length === 0) throw new Error('paths is required for a files watch: one or more files or folders')
    if (paths.length > 20) throw new Error('a files watch takes 20 paths at most')
    spec.paths = [...new Set(paths)]
  }

  // A dashboard watch only keeps the dashboard's data fresh: it never notifies.
  const condition = kind === 'dashboard' ? 'never' : args.when ?? 'change'
  if (condition !== 'never' && !CONDITIONS.includes(condition)) throw new Error(`when must be one of ${CONDITIONS.join(', ')}`)
  if (kind === 'files' && condition !== 'change') throw new Error('a files watch only reports changes; use pattern to choose which paths count')
  if (kind === 'port' && (condition === 'match' || condition === 'no_match')) throw new Error('a port watch takes when: change, succeeds (comes up) or fails (goes down)')
  spec.when = condition
  if (args.pattern !== undefined && args.pattern !== null && args.pattern !== '') {
    if (typeof args.pattern !== 'string') throw new Error('pattern must be a string')
    compilePattern(args.pattern)
    spec.pattern = args.pattern
  } else if (condition === 'match' || condition === 'no_match') {
    throw new Error(`when: ${condition} needs a pattern`)
  }

  spec.interval = kind === 'files'
    ? 0
    : wholeSeconds(args.interval_seconds, 'interval_seconds', { min: kind === 'dashboard' ? LIMITS.minDashboardInterval : LIMITS.minInterval, max: LIMITS.maxInterval, fallback: LIMITS.defaultInterval[kind] })
  spec.cooldown = wholeSeconds(args.cooldown_seconds, 'cooldown_seconds', { min: LIMITS.minCooldown, max: LIMITS.maxCooldown, fallback: LIMITS.defaultCooldown })
  spec.maxWakes = wholeSeconds(args.max_wakes, 'max_wakes', { min: 1, max: LIMITS.maxMaxWakes, fallback: LIMITS.defaultMaxWakes })
  const lifetime = wholeSeconds(args.lifetime_minutes, 'lifetime_minutes', { min: 1, max: LIMITS.maxLifetimeMinutes, fallback: LIMITS.defaultLifetimeMinutes })
  spec.expiresAt = now + lifetime * 60_000
  const label = typeof args.label === 'string' && args.label.trim() !== '' ? args.label.trim() : defaultLabel(spec)
  spec.label = label.length > 80 ? `${label.slice(0, 79)}…` : label
  return spec
}

function defaultLabel(spec) {
  if (spec.kind === 'dashboard') return `dashboard ${spec.dashboard}`
  if (spec.kind === 'port') return `port ${spec.port}`
  if (spec.kind === 'files') return spec.paths.map(p => path.basename(p) || p).join(', ')
  return spec.command.length > 40 ? `${spec.command.slice(0, 39)}…` : spec.command
}

/** One line on what a watch checks, for lists and notices. */
export function describe(spec) {
  if (spec.kind === 'dashboard') return `refreshes dashboard ${spec.dashboard}, every ${spec.interval >= 60 && spec.interval % 60 === 0 ? `${spec.interval / 60} min` : `${spec.interval}s`}`
  if (spec.kind === 'port') return `port ${spec.port} on ${spec.host}, every ${spec.interval}s`
  if (spec.kind === 'files') return `changes under ${spec.paths.join(', ')}${spec.pattern ? ` matching /${spec.pattern}/` : ''}`
  return `\`${spec.command}\`, every ${spec.interval}s`
}

export const newWatchId = () => `watch-${randomUUID().slice(0, 8)}`

/**
 * A check's outcome in the one shape every kind shares.
 * @typedef {{ exitCode: number | null, output: string, error?: string }} CheckResult
 */

/** The text two results are compared on. */
export function resultKey(result) {
  return `${result.exitCode === null ? 'none' : result.exitCode}\n${result.output}`
}

/** Whether a watch's condition holds for a result; `undefined` for `change`, which has no condition. */
export function conditionHolds(spec, result) {
  switch (spec.when) {
    case 'match': return testPattern(spec.pattern, result.output)
    case 'no_match': return !testPattern(spec.pattern, result.output)
    case 'fails': return result.exitCode !== 0
    case 'succeeds': return result.exitCode === 0
    case 'never': return false
    default: return undefined
  }
}

/** A fresh watch's state, from its first check: the silent baseline. */
export function initialState(spec, result, now) {
  return {
    baseline: snapshot(result),
    baselineHolds: conditionHolds(spec, result),
    last: snapshot(result),
    lastCheckAt: now,
    pending: undefined,
    wakes: 0,
    lastNoticeAt: undefined,
    checks: 1,
  }
}

function snapshot(result) {
  return { exitCode: result.exitCode, output: result.output, ...result.error ? { error: result.error } : {} }
}

/**
 * Fold one check into a watch's state. While the agent is working nothing is recorded as news: when the
 * turn ends the watch takes the state then as its baseline (see {@link rebaseline}). While it is idle, a
 * result that is news (a different result under `change`, a condition that has just become true) becomes
 * pending until it can be delivered.
 * @param {object} spec
 * @param {object} state - left unchanged; the next state is returned.
 * @param {CheckResult} result
 * @param {{ now: number, busy: boolean }} at
 * @returns {object} the next state.
 */
export function foldCheck(spec, state, result, { now, busy }) {
  const next = { ...state, last: snapshot(result), lastCheckAt: now, checks: (state.checks ?? 0) + 1 }
  if (busy) return next
  if (spec.when === 'change') {
    if (resultKey(result) === resultKey(state.baseline)) return { ...next, pending: undefined }
    const changes = state.pending ? state.pending.changes + (resultKey(result) === resultKey(state.last) ? 0 : 1) : 1
    return { ...next, pending: { since: state.pending?.since ?? now, changes } }
  }
  const holds = conditionHolds(spec, result)
  // A condition that stopped holding is armed again, silently.
  if (!holds) return { ...next, baselineHolds: false, pending: undefined }
  if (state.baselineHolds) return next
  return { ...next, pending: state.pending ?? { since: now, changes: 1 } }
}

/**
 * Fold one settled batch of file changes. Paths the watch does not care about, and every batch while the
 * agent is working or just finished, are dropped.
 */
export function foldFiles(spec, state, paths, { now, busy }) {
  const wanted = paths.filter(p => isWantedPath(spec, p))
  const next = { ...state, lastCheckAt: now, checks: (state.checks ?? 0) + 1 }
  if (busy || wanted.length === 0) return next
  const merged = [...new Set([...(state.pending?.paths ?? []), ...wanted])].slice(0, LIMITS.maxPaths)
  return { ...next, last: { exitCode: 0, output: merged.join('\n') }, pending: { since: state.pending?.since ?? now, changes: (state.pending?.changes ?? 0) + 1, paths: merged } }
}

/** Whether a folder name is one a files watch never looks inside. */
export const isIgnoredFolder = name => IGNORED_SEGMENTS.has(name)

/** Whether a changed path counts for a files watch: not inside .git or node_modules, and matching its pattern. */
export function isWantedPath(spec, file) {
  if (file.split(/[\\/]/).some(isIgnoredFolder)) return false
  return spec.pattern === undefined || testPattern(spec.pattern, file)
}

/** Whether a path is a folder or inside it; both already resolved. */
export function isInside(file, folder) {
  const relative = path.relative(folder, file)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/** When a turn ends: what the agent could have seen becomes the baseline, and nothing is pending. */
export function rebaseline(spec, state, result) {
  const current = result === undefined ? state.last : snapshot(result)
  return {
    ...state,
    last: current,
    baseline: spec.kind === 'files' ? { exitCode: 0, output: '' } : current,
    baselineHolds: spec.kind === 'files' ? undefined : conditionHolds(spec, current),
    pending: undefined,
  }
}

/**
 * Whether pending news may be delivered now, and if not, when it may.
 * @returns {{ deliver: true } | { deliver: false, at?: number }}
 */
export function deliveryDecision(spec, state, now) {
  if (!state.pending) return { deliver: false }
  if (state.wakes >= spec.maxWakes) return { deliver: false }
  if (state.lastNoticeAt !== undefined && now - state.lastNoticeAt < spec.cooldown * 1000) {
    return { deliver: false, at: state.lastNoticeAt + spec.cooldown * 1000 }
  }
  return { deliver: true }
}

/** The state once pending news has been delivered: the agent now knows the latest result. */
export function afterDelivery(spec, state, now) {
  return {
    ...state,
    baseline: spec.kind === 'files' ? { exitCode: 0, output: '' } : state.last,
    baselineHolds: spec.kind === 'files' ? undefined : conditionHolds(spec, state.last),
    pending: undefined,
    wakes: state.wakes + 1,
    lastNoticeAt: now,
  }
}

const encoder = new TextEncoder()
const bytes = text => encoder.encode(text).byteLength

/** Keep the first `max` bytes of a text, cut at a character boundary. */
export function cutBytes(text, max) {
  if (bytes(text) <= max) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (bytes(text.slice(0, mid)) <= max) low = mid
    else high = mid - 1
  }
  return text.slice(0, low)
}

/**
 * A line-level difference between two outputs: the removed lines with "- " and the added ones with "+ ",
 * in order. Long outputs fall back to the lines of the new output that the old one did not have.
 */
export function lineDiff(before, after, maxLines = LIMITS.noticeLines) {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  let out = []
  if (a.length * b.length > 250_000) {
    const old = new Set(a)
    const now = new Set(b)
    out = [...a.filter(l => !now.has(l)).map(l => `- ${l}`), ...b.filter(l => !old.has(l)).map(l => `+ ${l}`)]
  } else {
    // Longest common subsequence, then walk it.
    const n = a.length
    const m = b.length
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { i++; j++ } else if (i < n && (j === m || table[i + 1][j] >= table[i][j + 1])) out.push(`- ${a[i++]}`)
      else out.push(`+ ${b[j++]}`)
    }
  }
  // One very long line must not push the others out of the notice.
  out = out.map(line => (line.length > 200 ? `${line.slice(0, 199)}…` : line))
  if (out.length > maxLines) return [...out.slice(0, maxLines), `… and ${out.length - maxLines} more changed lines`]
  return out
}

const clock = now => new Date(now).toTimeString().slice(0, 8)

function exitText(result) {
  if (result.error) return `could not run (${result.error})`
  return result.exitCode === null ? 'no exit code (stopped or timed out)' : `exit code ${result.exitCode}`
}

/**
 * The notice for delivered news: what changed, before → after, short enough to cost little.
 * @param {{ id: string, spec: object }} watch
 * @param {object} state - the state before delivery (baseline = what the agent knew).
 * @param {{ now: number, last: boolean }} at - `last`: this is the final wake the watch may use.
 * @returns {{ text: string, summary: string }}
 */
export function noticeText(watch, state, { now, last }) {
  const { spec } = watch
  const head = `Watch "${spec.label}" (${watch.id}) at ${clock(now)}`
  const lines = []
  let summary
  if (spec.kind === 'files') {
    const paths = state.pending?.paths ?? []
    summary = `Watch "${spec.label}": ${paths.length} file${paths.length === 1 ? '' : 's'} changed`
    lines.push(`${head}: ${paths.length === 1 ? 'a file' : `${paths.length} files`} changed while you were idle.`)
    lines.push(...paths.slice(0, LIMITS.noticeLines).map(p => `- ${p}`))
    if (paths.length > LIMITS.noticeLines) lines.push(`… and ${paths.length - LIMITS.noticeLines} more`)
  } else if (spec.kind === 'port') {
    const up = state.last.exitCode === 0
    summary = `Watch "${spec.label}": port ${spec.port} is ${up ? 'up' : 'down'}`
    lines.push(`${head}: port ${spec.port} on ${spec.host} is now ${up ? 'up (accepting connections)' : 'down (nothing is listening)'}; it was ${state.baseline.exitCode === 0 ? 'up' : 'down'}.`)
  } else {
    const before = state.baseline
    const after = state.last
    const what = spec.when === 'change' ? 'output changed' : `condition "${spec.when}${spec.pattern ? ` /${spec.pattern}/` : ''}" now holds`
    summary = `Watch "${spec.label}": ${spec.when === 'change' ? 'changed' : `${spec.when.replace('_', ' ')}`}`
    lines.push(`${head}: ${what} for \`${spec.command}\`.`)
    if (exitText(before) !== exitText(after)) lines.push(`Before: ${exitText(before)}. Now: ${exitText(after)}.`)
    else lines.push(`Still ${exitText(after)}.`)
    const diff = lineDiff(before.output, after.output)
    if (diff.length) lines.push('Changed lines:', ...diff)
    else if (spec.when !== 'change') lines.push('Output:', ...after.output.split('\n').slice(0, LIMITS.noticeLines))
  }
  if ((state.pending?.changes ?? 1) > 1 && spec.kind !== 'files') lines.push(`(It changed ${state.pending.changes} times since the last notice; this is the latest.)`)
  const tail = last
    ? `This was the last notice this watch may send (${spec.maxWakes}); it has stopped. Create a new one if you still need it.`
    : `Notices left: ${spec.maxWakes - state.wakes - 1}. Remove it with watch_remove once it stops being useful.`
  const body = cutBytes(lines.join('\n'), LIMITS.noticeBytes - bytes(tail) - 2)
  return { text: `${body}${body.endsWith('\n') ? '' : '\n'}${tail}`, summary: summary.length > 120 ? `${summary.slice(0, 119)}…` : summary }
}

/** A notice message, in the form Harness keeps user-role messages. */
export function noticeMessage(text, summary) {
  const message = { content: [{ type: 'text', text }], source: { kind: SOURCE, form: 'notice', summary }, role: 'user', id: randomUUID() }
  Object.freeze(message.content[0])
  Object.freeze(message.content)
  Object.freeze(message.source)
  return Object.freeze(message)
}

/** A short account of a result for the create result and the list: first lines of output. */
export function resultPreview(spec, result, maxLines = 12) {
  if (spec.kind === 'port') return result.exitCode === 0 ? 'up' : 'down'
  if (spec.kind === 'files') return 'watching'
  const lines = result.output.split('\n')
  const shown = lines.slice(0, maxLines).join('\n')
  return `${exitText(result)}${result.output ? `\n${cutBytes(shown, 1500)}${lines.length > maxLines ? `\n… ${lines.length - maxLines} more lines` : ''}` : ', no output'}`
}

/** What the list shows for one watch: for the agent's tool and for the header list. */
export function publicWatch(watch, now = Date.now()) {
  const { spec, state } = watch
  return {
    id: watch.id,
    sessionId: watch.sessionId,
    label: spec.label,
    kind: spec.kind,
    what: describe(spec),
    when: spec.when,
    ...spec.pattern ? { pattern: spec.pattern } : {},
    createdBy: watch.createdBy,
    createdAt: watch.createdAt,
    expiresAt: spec.expiresAt,
    lastCheckAt: state.lastCheckAt,
    lastNoticeAt: state.lastNoticeAt,
    wakes: state.wakes,
    maxWakes: spec.maxWakes,
    pending: state.pending !== undefined,
    current: resultPreview(spec, state.last, 3),
    ...state.last?.error ? { error: state.last.error } : {},
    expired: spec.expiresAt <= now,
  }
}
