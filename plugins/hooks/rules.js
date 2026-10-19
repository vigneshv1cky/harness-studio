/**
 * Pure parts of command rules: reading a permissions file, describing a tool call in Claude Code's terms, and
 * deciding whether a rule denies it or asks you first. Kept free of Harness services so it can be tested directly.
 *
 * The format is Claude Code's `permissions` block, so rules can be copied between the two:
 *
 *   {
 *     "permissions": {
 *       "deny": ["Bash(git push --force:*)", "Read(./.env)", "Read(~/.ssh/**)", "WebFetch(domain:pastebin.com)"],
 *       "ask":  ["Bash(git push:*)", "Edit(./migrations/**)", "mcp__github__create_issue"],
 *       "allow": ["Bash(npm test:*)"]
 *     }
 *   }
 *
 * A rule is a tool name, optionally followed by a specifier in parentheses:
 *   Bash(npm run test:*)    a command starting with "npm run test"; without ":*" the whole command must match,
 *                           and "*" inside matches any text. Each part of a compound command (&&, ||, ;, |,
 *                           and $(…)) is checked on its own, so "cd x && git push" matches "Bash(git push:*)".
 *   Read(path) Edit(path)   gitignore-style paths: "~/…" from your home folder, "//…" absolute, anything else
 *                           from the project root; "**" crosses folders, and a pattern without "/" matches at any
 *                           depth. Edit rules cover every tool that changes files; Read rules every tool that
 *                           reads them.
 *   WebFetch(domain:host)   that host and its subdomains, for web fetches and pages the Browser pane opens.
 *   mcp__server, mcp__server__tool   a connector's tools.
 *   A bare name (Bash, WebFetch, …) covers every call of that tool.
 *
 * Deny wins over ask, and ask over allow. Commands inside the sandbox already run without asking, so allow
 * rules are accepted for compatibility and change nothing.
 */
import os from 'node:os'
import path from 'node:path'

export const RULE_KINDS = ['deny', 'ask', 'allow']

/**
 * Read one permissions file's JSON into a flat list of rules.
 * @param {unknown} json - the parsed file.
 * @param {string} source - the file's path, recorded on each rule and used in error messages.
 * @returns {{ rules: Array<{ kind: string, tool: string, specifier?: string, text: string, source: string }>, errors: string[] }}
 */
export function parsePermissionsFile(json, source) {
  const rules = []
  const errors = []
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return { rules, errors: [`${source}: expected a JSON object`] }
  const block = json.permissions
  if (block === undefined) return { rules, errors }
  if (block === null || typeof block !== 'object' || Array.isArray(block)) return { rules, errors: [`${source}: "permissions" must be an object with deny, ask and allow lists`] }
  for (const [kind, list] of Object.entries(block)) {
    if (!RULE_KINDS.includes(kind)) {
      // Claude Code's other permission settings (defaultMode, additionalDirectories) have no meaning here.
      errors.push(`${source}: "permissions.${kind}" is not used by Harness Studio (it reads deny, ask and allow)`)
      continue
    }
    if (!Array.isArray(list)) {
      errors.push(`${source}: "permissions.${kind}" must be a list of rules`)
      continue
    }
    list.forEach((text, i) => {
      const parsed = typeof text === 'string' ? parseRule(text) : undefined
      if (parsed === undefined) return void errors.push(`${source}: permissions.${kind}[${i}] is not a rule like "Bash(npm test:*)"`)
      rules.push({ kind, ...parsed, text: text.trim(), source })
    })
  }
  return { rules, errors }
}

/**
 * Split a rule into its tool name and specifier.
 * @param {string} text
 * @returns {{ tool: string, specifier?: string } | undefined}
 */
export function parseRule(text) {
  const match = /^\s*([A-Za-z0-9_*-]+)\s*(?:\((.*)\))?\s*$/s.exec(text)
  if (match === null) return undefined
  const specifier = match[2]?.trim()
  return specifier === undefined || specifier === '' ? { tool: match[1] } : { tool: match[1], specifier }
}

// ---- describing a tool call ---------------------------------------------------------------------

/**
 * Split a shell command into the simple commands it runs, each normalised for matching. Parts joined by &&, ||,
 * ;, |, & or new lines are separate, and so is everything inside (…), { …; }, $(…), backquotes, <(…) and >(…),
 * the script of `bash -c "…"` (and sh, zsh, dash, ksh, fish) and the arguments of `eval`. Each simple command
 * loses its leading `NAME=value` assignments and wrapper programs (env, command, exec, sudo, doas, nohup, nice,
 * time, timeout, xargs, stdbuf, builtin), its words lose their quotes and backslashes, and a program named by
 * path is named by its file name (`/usr/bin/git` → `git`). This reads shell text for rule matching; it is not a
 * full shell parser, so it errs towards finding more parts, and command rules guard rather than sandbox.
 * @param {string} command
 * @returns {string[]}
 */
export function splitCommand(command, depth = 0) {
  if (depth > 8) return []
  const parts = []
  const nested = []
  let current = ''
  let quote
  const capture = (open, i) => {
    const end = closing(command, open)
    nested.push(command.slice(open + 1, end))
    return end
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote !== undefined) {
      if (ch === '\\' && quote === '"' && i + 1 < command.length) { current += ch + command[++i]; continue }
      // Double quotes still run $(…) and backquoted commands; single quotes run nothing.
      if (quote === '"' && ch === '$' && command[i + 1] === '(') {
        const end = capture(i + 1, i)
        current += command.slice(i, end + 1)
        i = end
        continue
      }
      if (quote === '"' && ch === '`') {
        const end = command.indexOf('`', i + 1)
        const stop = end === -1 ? command.length : end
        nested.push(command.slice(i + 1, stop))
        current += command.slice(i, stop + 1)
        i = stop
        continue
      }
      if (ch === quote) quote = undefined
      current += ch
      continue
    }
    if (ch === '\\' && i + 1 < command.length) { current += ch + command[++i]; continue }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue }
    if ((ch === '$' || ch === '<' || ch === '>') && command[i + 1] === '(') {
      const end = capture(i + 1, i)
      current += command.slice(i, end + 1)
      i = end
      continue
    }
    if (ch === '`') {
      const end = command.indexOf('`', i + 1)
      const stop = end === -1 ? command.length : end
      nested.push(command.slice(i + 1, stop))
      current += command.slice(i, stop + 1)
      i = stop
      continue
    }
    // A subshell or group runs its contents as commands of their own.
    if (ch === '(') {
      const end = capture(i, i)
      parts.push(current)
      current = ''
      i = end
      continue
    }
    if (ch === ';' || ch === '\n' || ch === '|' || ch === '&' || ch === ')') {
      parts.push(current)
      current = ''
      if ((ch === '|' || ch === '&') && command[i + 1] === ch) i++
      continue
    }
    current += ch
  }
  parts.push(current)
  const simple = []
  for (const part of parts) {
    const words = shellWords(part).filter(word => word !== '{' && word !== '}')
    const found = normalise(words, depth)
    simple.push(...found)
  }
  for (const inner of nested) simple.push(...splitCommand(inner, depth + 1))
  return simple
}

/** The index of the parenthesis closing the one at `open`, or the end of the text. */
function closing(text, open) {
  let depth = 0
  let quote
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (quote !== undefined) {
      if (ch === '\\' && quote === '"') { i++; continue }
      if (ch === quote) quote = undefined
      continue
    }
    if (ch === '\\') { i++; continue }
    if (ch === "'" || ch === '"') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i
  }
  return text.length
}

/** Split a simple command into words, removing quotes and backslashes as the shell would. */
export function shellWords(text) {
  const words = []
  let word = ''
  let started = false
  let quote
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote === "'") {
      if (ch === "'") quote = undefined
      else word += ch
      continue
    }
    if (quote === '"') {
      if (ch === '\\' && i + 1 < text.length && '"\\$`\n'.includes(text[i + 1])) { word += text[++i]; continue }
      if (ch === '"') quote = undefined
      else word += ch
      continue
    }
    if (ch === '\\' && i + 1 < text.length) { word += text[++i]; started = true; continue }
    if (ch === "'" || ch === '"') { quote = ch; started = true; continue }
    if (/\s/.test(ch)) {
      if (started) words.push(word)
      word = ''
      started = false
      continue
    }
    word += ch
    started = true
  }
  if (started) words.push(word)
  return words
}

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish'])
/** Wrapper programs and the options of theirs that take a value, so the value is not mistaken for the program. */
const WRAPPERS = {
  env: new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']),
  command: new Set(),
  exec: new Set(['-a']),
  builtin: new Set(),
  sudo: new Set(['-u', '--user', '-g', '--group', '-C', '--close-from', '-D', '--chdir', '-h', '--host', '-p', '--prompt', '-r', '--role', '-t', '--type', '-T', '--command-timeout', '-U', '--other-user']),
  doas: new Set(['-u', '-C']),
  nohup: new Set(),
  nice: new Set(['-n', '--adjustment']),
  time: new Set(['-f', '--format', '-o', '--output']),
  timeout: new Set(['-s', '--signal', '-k', '--kill-after']),
  xargs: new Set(['-a', '--arg-file', '-d', '--delimiter', '-E', '-e', '--eof', '-I', '-i', '--replace', '-L', '-l', '--max-lines', '-n', '--max-args', '-P', '--max-procs', '-s', '--max-chars']),
  stdbuf: new Set(['-i', '-o', '-e']),
}

/**
 * The commands a list of words runs: assignments and wrappers removed, the program named by its file name,
 * and any script handed to a shell's -c or to eval split as commands of its own.
 */
function normalise(words, depth) {
  let i = 0
  for (;;) {
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++
    if (i >= words.length) return []
    const program = words[i].split('/').pop()
    const takesValue = WRAPPERS[program]
    if (takesValue === undefined) break
    i++
    if (program === 'env') {
      // env -S "cmd args" runs a split string.
      for (let j = i; j < words.length && words[j].startsWith('-'); j++) {
        if ((words[j] === '-S' || words[j] === '--split-string') && j + 1 < words.length) return splitCommand(words[j + 1], depth + 1)
      }
    }
    while (i < words.length && words[i].startsWith('-') && words[i] !== '-') {
      const option = words[i++]
      if (option === '--') break
      if (takesValue.has(option)) i++
    }
    // nice -10 and timeout's duration come before the program.
    if (program === 'timeout' && i < words.length && /^\d/.test(words[i])) i++
  }
  const rest = words.slice(i)
  rest[0] = rest[0].split('/').pop()
  const program = rest[0]
  const found = [rest.join(' ')]
  if (SHELLS.has(program)) {
    for (let j = 1; j < rest.length; j++) {
      if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(rest[j]) && j + 1 < rest.length) {
        found.push(...splitCommand(rest[j + 1], depth + 1))
        break
      }
      if (!rest[j].startsWith('-')) break
    }
  }
  if (program === 'eval' && rest.length > 1) found.push(...splitCommand(rest.slice(1).join(' '), depth + 1))
  return found
}

/**
 * Which Claude Code rule family a Harness tool belongs to, and the fields of its arguments that rules look at.
 * Tools not listed here are matched by name only.
 */
export const TOOL_FAMILIES = {
  // `text` is what the agent types into its terminal (the Terminal plugin), which may be a shell.
  command: { rule: 'Bash', fields: ['command', 'text'] },
  read: { rule: 'Read', fields: ['file_path', 'path'] },
  edit: { rule: 'Edit', fields: ['file_path', 'path'] },
  fetch: { rule: 'WebFetch', fields: ['url'] },
}

/**
 * The Harness and Harness Studio tools each family covers. Unlisted tools (and connectors, named
 * `mcp__<server>__<tool>`) are matched by name.
 */
export const HARNESS_FAMILIES = {
  // What the agent types into a terminal (terminal_send) is checked a line at a time by the Hooks plugin.
  bash: 'command', pwsh: 'command', terminal_start: 'command', watch_create: 'command',
  read: 'read', read_image: 'read', glob: 'read', grep: 'read',
  write: 'edit', edit: 'edit',
  web_fetch: 'fetch', browser_open: 'fetch',
}

/**
 * Describe one tool call for rule matching.
 * @param {string} name - the Harness tool name.
 * @param {Record<string, unknown>} args - the call's arguments.
 * @param {Record<string, keyof typeof TOOL_FAMILIES>} families - Harness tool names mapped to their family.
 * @returns {{ name: string, claudeName: string, family?: string, rule?: string, commands: string[], paths: string[], urls: string[] }}
 */
export function describeCall(name, args, families) {
  const familyName = families[name]
  const family = familyName === undefined ? undefined : TOOL_FAMILIES[familyName]
  const values = family === undefined ? [] : family.fields.flatMap(field => {
    const value = args?.[field]
    return Array.isArray(value) ? value.filter(v => typeof v === 'string') : typeof value === 'string' ? [value] : []
  })
  return {
    name,
    claudeName: claudeName(name),
    family: familyName,
    rule: family?.rule,
    commands: familyName === 'command' ? values.flatMap(splitCommand) : [],
    // grep and glob search the working folder when they are given no path.
    paths: familyName === 'read' || familyName === 'edit' ? (values.length === 0 && (name === 'grep' || name === 'glob') ? ['.'] : values) : [],
    urls: familyName === 'fetch' ? values : [],
  }
}

/** A Harness tool name as Claude Code spells its tools: `bash` → `Bash`, `web_fetch` → `WebFetch`. */
export function claudeName(name) {
  if (name.startsWith('mcp__')) return name
  return name.split(/[_-]/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join('')
}

// ---- matching -----------------------------------------------------------------------------------

/** A glob as a regular expression: `**` crosses folders, `*` and `?` stay within one. */
function globExpression(glob) {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*' && glob[i + 1] === '*') {
      // "**/" matches zero or more folders; a trailing "**" matches everything below.
      if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2 } else { out += '.*'; i++ }
    } else if (ch === '*') out += '[^/]*'
    else if (ch === '?') out += '[^/]'
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return out
}

/**
 * Whether a path rule's pattern covers an absolute file path.
 * @param {string} pattern - the rule's specifier.
 * @param {string} file - an absolute path.
 * @param {{ root: string, home?: string }} where - the project root, and the home folder for "~/".
 */
export function pathMatches(pattern, file, where) {
  const home = where.home ?? os.homedir()
  const target = path.resolve(file)
  let base
  let rest
  if (pattern.startsWith('~/')) { base = home; rest = pattern.slice(2) }
  else if (pattern.startsWith('//')) { base = '/'; rest = pattern.slice(2) }
  else if (pattern.startsWith('./')) { base = where.root; rest = pattern.slice(2) }
  else if (pattern.startsWith('/')) { base = where.root; rest = pattern.slice(1) }
  else { base = where.root; rest = pattern }
  // Like .gitignore: a pattern with no "/" (other than a trailing one) matches a name at any depth.
  const anywhere = !rest.replace(/\/$/, '').includes('/') && !pattern.startsWith('~/') && !pattern.startsWith('/') && !pattern.startsWith('./')
  const body = rest.endsWith('/') ? `${rest}**` : rest
  // macOS and Windows file systems ignore case by default, so `.ENV` is the file `.env` there.
  const nocase = where.nocase ?? (process.platform === 'darwin' || process.platform === 'win32')
  const fold = value => (nocase ? value.toLowerCase() : value)
  const relative = path.relative(fold(base), fold(target))
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false
  const expression = new RegExp(`^${anywhere ? '(?:.*/)?' : ''}${globExpression(fold(body))}(?:/.*)?$`)
  return expression.test(relative.split(path.sep).join('/'))
}

/** Whether a Bash specifier covers one simple command. */
export function commandMatches(specifier, command) {
  // The rule's words are read like a command's: quotes removed, a program path reduced to its name.
  const raw = specifier.trim()
  const prefix = raw.endsWith(':*')
  const words = shellWords(prefix ? raw.slice(0, -2) : raw)
  if (words.length > 0) words[0] = words[0].split('/').pop()
  const spec = words.join(' ') + (prefix ? ':*' : '')
  if (spec.endsWith(':*')) {
    const prefix = spec.slice(0, -2).trimEnd()
    return command === prefix || command.startsWith(`${prefix} `)
  }
  if (!spec.includes('*')) return command === spec
  return new RegExp(`^${spec.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(command)
}

/** Whether a `domain:` specifier covers a URL's host (the host itself or a subdomain). */
export function domainMatches(specifier, url) {
  const match = /^domain:(.+)$/.exec(specifier.trim())
  if (match === null) return false
  let host
  // A trailing dot names the same host (`example.com.`), so it is dropped on both sides.
  try { host = new URL(url).hostname.toLowerCase().replace(/\.+$/, '') } catch { return false }
  const domain = match[1].trim().toLowerCase().replace(/^\*\./, '').replace(/\.+$/, '')
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * Whether one rule covers a described call.
 * @param {{ tool: string, specifier?: string }} rule
 * @param {ReturnType<typeof describeCall>} call
 * @param {{ root: string, home?: string }} where
 */
export function ruleMatches(rule, call, where) {
  if (rule.tool.startsWith('mcp__')) {
    if (!call.name.startsWith('mcp__')) return false
    const pattern = rule.tool.endsWith('__*') ? rule.tool.slice(0, -1) : rule.tool
    return call.name === pattern || call.name.startsWith(pattern.endsWith('__') ? pattern : `${pattern}__`)
  }
  const sameTool = rule.tool === '*' || rule.tool === call.claudeName || rule.tool === call.name || rule.tool === call.rule
  if (!sameTool) return false
  if (rule.specifier === undefined) return true
  if (call.rule === 'Bash') return call.commands.some(command => commandMatches(rule.specifier, command))
  if (call.rule === 'Read' || call.rule === 'Edit') {
    // A path is also checked as the file it really is, so a link to a protected file is covered.
    const candidates = file => {
      const absolute = path.resolve(where.cwd ?? where.root, file)
      return where.realpath ? [absolute, ...where.realpath(absolute)] : [absolute]
    }
    return call.paths.some(file => candidates(file).some(candidate => pathMatches(rule.specifier, candidate, where)))
  }
  if (call.rule === 'WebFetch') return call.urls.some(url => domainMatches(rule.specifier, url))
  return false
}

/**
 * The decision the rules make for one call: the first denying rule, else the first asking rule.
 * @param {ReturnType<typeof parsePermissionsFile>['rules']} rules
 * @param {ReturnType<typeof describeCall>} call
 * @param {{ root: string, cwd?: string, home?: string }} where
 * @returns {{ kind: 'deny' | 'ask' | 'none', rule?: { text: string, source: string } }}
 */
export function decide(rules, call, where) {
  for (const kind of ['deny', 'ask']) {
    const rule = rules.find(r => r.kind === kind && ruleMatches(r, call, where))
    if (rule !== undefined) return { kind, rule: { text: rule.text, source: rule.source } }
  }
  return { kind: 'none' }
}
