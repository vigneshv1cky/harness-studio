/**
 * Pure parts of Hooks: reading a hooks file, matching a hook to a tool, and turning what the hook commands
 * returned into a decision. Kept free of Harness services and processes so they can be tested directly.
 *
 * The file format is Claude Code's, so a `hooks` block can be copied between the two:
 *
 *   {
 *     "hooks": {
 *       "PreToolUse":  [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "./check.sh", "timeout": 30 }] }],
 *       "PostToolUse": [{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "jq -r .tool_input.file_path | xargs npx prettier --write" }] }],
 *       "Stop":        [{ "hooks": [{ "type": "command", "command": "npm test --silent" }] }]
 *     }
 *   }
 */

export const EVENTS = ['PreToolUse', 'PostToolUse', 'Stop']
/** Harness and Harness Studio tools that run a shell command. */
export const SHELL_TOOLS = new Set(['bash', 'pwsh', 'terminal_start', 'watch_create'])
/** Events whose entries carry a tool matcher. */
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse'])
export const DEFAULT_TIMEOUT_SECONDS = 60
export const MAX_TIMEOUT_SECONDS = 600
/** Consecutive times Stop hooks may send the agent back to work in one turn before they are ignored. */
export const MAX_STOP_BLOCKS = 3

/**
 * A Harness tool name as Claude Code spells its tools: `bash` → `Bash`, `web_fetch` → `WebFetch`. Matchers and
 * the `tool_name` hooks receive use this spelling, so hooks written for Claude Code keep working.
 * @param {string} name
 */
export function claudeToolName(name) {
  return name.split(/[_-]/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join('')
}

/**
 * Read one hooks file's JSON into a flat list of hook commands.
 * @param {unknown} json - the parsed file.
 * @param {string} source - the file's path, recorded on each hook and used in error messages.
 * @returns {{ hooks: Array<{ event: string, matcher: string, command: string, timeoutMs: number, source: string }>, disabled: boolean, errors: string[] }}
 */
export function parseHooksFile(json, source) {
  const hooks = []
  const errors = []
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return { hooks, disabled: false, errors: [`${source}: expected a JSON object`] }
  const disabled = json.disableAllHooks === true
  const table = json.hooks
  if (table === undefined) return { hooks, disabled, errors }
  if (table === null || typeof table !== 'object' || Array.isArray(table)) return { hooks, disabled, errors: [`${source}: "hooks" must be an object keyed by event name`] }
  for (const [event, entries] of Object.entries(table)) {
    if (!EVENTS.includes(event)) {
      errors.push(`${source}: "${event}" is not a supported event (supported: ${EVENTS.join(', ')})`)
      continue
    }
    if (!Array.isArray(entries)) {
      errors.push(`${source}: "${event}" must be a list`)
      continue
    }
    entries.forEach((entry, i) => {
      const where = `${source}: ${event}[${i}]`
      if (entry === null || typeof entry !== 'object') return void errors.push(`${where} must be an object`)
      const matcher = entry.matcher ?? ''
      if (typeof matcher !== 'string') return void errors.push(`${where}.matcher must be text`)
      if (!TOOL_EVENTS.has(event) && matcher !== '') errors.push(`${where}.matcher is ignored: ${event} hooks are not tied to a tool`)
      if (!Array.isArray(entry.hooks)) return void errors.push(`${where}.hooks must be a list`)
      entry.hooks.forEach((hook, j) => {
        const at = `${where}.hooks[${j}]`
        if (hook === null || typeof hook !== 'object') return void errors.push(`${at} must be an object`)
        if (hook.type !== 'command') return void errors.push(`${at}.type must be "command"`)
        if (typeof hook.command !== 'string' || hook.command.trim() === '') return void errors.push(`${at}.command must be a non-empty command`)
        let seconds = DEFAULT_TIMEOUT_SECONDS
        if (hook.timeout !== undefined) {
          if (typeof hook.timeout !== 'number' || !(hook.timeout > 0)) return void errors.push(`${at}.timeout must be a positive number of seconds`)
          seconds = Math.min(hook.timeout, MAX_TIMEOUT_SECONDS)
        }
        hooks.push({ event, matcher: TOOL_EVENTS.has(event) ? matcher : '', command: hook.command, timeoutMs: Math.round(seconds * 1000), source })
      })
    })
  }
  return { hooks, disabled, errors }
}

/**
 * Whether a matcher selects a tool. Empty or `*` matches every tool; otherwise the matcher is a regular
 * expression that must match the whole name, tried against both the Harness name and its Claude Code spelling.
 * A matcher that is not a valid expression matches only a tool with exactly that name.
 * @param {string} matcher
 * @param {string} toolName - the Harness tool name.
 */
export function matchesTool(matcher, toolName) {
  if (matcher === '' || matcher === '*') return true
  // Tools that run a shell command also answer to "Bash", so a hook written for Claude Code's Bash tool guards
  // every way Harness Studio runs one.
  const names = [toolName, claudeToolName(toolName), ...SHELL_TOOLS.has(toolName) ? ['Bash'] : []]
  let pattern
  try {
    pattern = new RegExp(`^(?:${matcher})$`)
  } catch {
    return names.includes(matcher)
  }
  return names.some(name => pattern.test(name))
}

/** Parse a hook's standard output as a JSON object, or undefined when it is not one. */
function jsonOutput(stdout) {
  const text = stdout.trim()
  if (!text.startsWith('{')) return undefined
  try {
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

const reasonOf = (text, fallback) => (text.trim() === '' ? fallback : text.trim())

/**
 * What one finished hook command means, following Claude Code: exit code 2 blocks with its standard error
 * as the reason; exit code 0 may print a JSON decision; any other outcome is an error that blocks nothing.
 * @param {{ code: number | null, stdout: string, stderr: string, timedOut?: boolean, error?: string }} run
 * @param {'PreToolUse' | 'PostToolUse' | 'Stop'} event
 * @returns {{ kind: 'allow' | 'deny' | 'ask' | 'block' | 'none' | 'error', reason?: string, context?: string }}
 */
export function readOutcome(run, event) {
  if (run.timedOut) return { kind: 'error', reason: 'timed out' }
  if (run.error !== undefined) return { kind: 'error', reason: run.error }
  if (run.code === 2) {
    const fallback = event === 'PreToolUse' ? 'Blocked by a PreToolUse hook.' : `A ${event} hook returned exit code 2.`
    return { kind: event === 'PreToolUse' ? 'deny' : 'block', reason: reasonOf(run.stderr, fallback) }
  }
  if (run.code !== 0) return { kind: 'error', reason: `exit code ${run.code}${run.stderr.trim() ? `: ${run.stderr.trim()}` : ''}` }
  const out = jsonOutput(run.stdout)
  if (out === undefined) return { kind: 'none' }
  const specific = out.hookSpecificOutput && typeof out.hookSpecificOutput === 'object' ? out.hookSpecificOutput : {}
  const reason = typeof specific.permissionDecisionReason === 'string' ? specific.permissionDecisionReason
    : typeof out.reason === 'string' ? out.reason : ''
  const context = typeof specific.additionalContext === 'string' && specific.additionalContext.trim() !== '' ? specific.additionalContext.trim() : undefined
  if (event === 'PreToolUse') {
    const decision = specific.permissionDecision ?? (out.decision === 'block' ? 'deny' : out.decision === 'approve' ? 'allow' : undefined)
    if (decision === 'deny') return { kind: 'deny', reason: reasonOf(reason, 'Blocked by a PreToolUse hook.') }
    if (decision === 'ask') return { kind: 'ask', reason: reasonOf(reason, 'A PreToolUse hook asks for your approval.') }
    if (decision === 'allow') return { kind: 'allow' }
    return { kind: 'none' }
  }
  if (out.decision === 'block') return { kind: 'block', reason: reasonOf(reason, `Blocked by a ${event} hook.`), ...context ? { context } : {} }
  return context ? { kind: 'none', context } : { kind: 'none' }
}

/**
 * Combine the outcomes of every hook that ran for one event: a block or denial wins over a request to ask,
 * which wins over the rest; reasons and added context from all hooks are kept, in order.
 * @param {ReturnType<typeof readOutcome>[]} outcomes
 * @returns {{ kind: 'allow' | 'deny' | 'ask' | 'block', reason?: string, context?: string, errors: string[] }}
 */
export function combine(outcomes) {
  const reasons = kind => outcomes.filter(o => o.kind === kind).map(o => o.reason)
  const contexts = outcomes.map(o => o.context).filter(Boolean)
  const errors = reasons('error')
  const context = contexts.length ? contexts.join('\n\n') : undefined
  for (const kind of ['deny', 'block', 'ask']) {
    const found = reasons(kind)
    if (found.length) return { kind, reason: found.join('\n'), ...context ? { context } : {}, errors }
  }
  return { kind: 'allow', ...context ? { context } : {}, errors }
}

/**
 * The text of a tool's result content, for the `tool_response` hooks receive: text blocks joined, other
 * blocks named by type, at most `limit` characters.
 * @param {Array<{ type: string, text?: string }>} content
 * @param {number} [limit]
 */
export function contentText(content, limit = 100_000) {
  const text = (content ?? []).map(block => (block.type === 'text' ? block.text ?? '' : `[${block.type}]`)).join('\n')
  return text.length > limit ? `${text.slice(0, limit)}\n[… ${text.length - limit} more characters]` : text
}
