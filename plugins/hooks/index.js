/**
 * Hooks for Harness Studio, like Claude Code's: your own shell commands that run before a tool call
 * (and can block it or ask you first), after a successful tool call (and can send the agent feedback), and
 * when the agent is about to finish its turn (and can send it back to work).
 *
 * Hooks are read from two places, in this order:
 *   <harness home>/hooks.json                       yours, for every project
 *   <project root>/.harness-studio/hooks.json       the project's, shared through the repository
 *   <project root>/.harness-studio/hooks.local.json the project's, just for you
 * The project's files run commands that came with the repository, so each one is asked about once on a
 * card, and runs only after you allow it; changing the file asks again.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MAX_STOP_BLOCKS, claudeToolName, combine, contentText, matchesTool, parseHooksFile, readOutcome } from './logic.js'
import { runHook } from './run.js'
import { HARNESS_FAMILIES, decide, describeCall, parsePermissionsFile, pathMatches, shellWords } from './rules.js'

export const name = 'harness-studio-hooks'

const SOURCE = 'harness-studio-hook'
const TRUST_QUESTION_ID = 'harness-studio/hooks-trust'
const ALLOW = 'Allow these hooks'
const DENY = "Don't run them"

/** The nearest folder at or above `dir` holding `.git`, or `dir` itself. */
function projectRootOf(dir) {
  let current = path.resolve(dir)
  for (;;) {
    if (existsSync(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(dir)
    current = parent
  }
}

/** A model-visible notice message, in the form Harness persists user-role messages. */
function notice(text, summary) {
  const message = { content: [{ type: 'text', text }], source: { kind: SOURCE, form: 'notice', summary }, role: 'user', id: randomUUID() }
  Object.freeze(message.content[0])
  Object.freeze(message.content)
  Object.freeze(message.source)
  return Object.freeze(message)
}

const isSubagent = agent => agent?.session?.header?.origin === 'subagent'

export function apply(ctx) {
  const profile = ctx.get('profileContext')
  const home = profile?.home ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const globalFile = path.join(home, 'hooks.json')
  const trustFile = path.join(home, 'harness-studio', 'hooks-trust.json')

  // ---- reading hooks files ------------------------------------------------------------------------
  /** Parsed files by path, reused while the file's modification time and size are unchanged. */
  const cache = new Map()
  async function readHooksFile(file) {
    let info
    try {
      info = await stat(file)
    } catch {
      cache.delete(file)
      return undefined
    }
    const stamp = `${info.mtimeMs}:${info.size}`
    const cached = cache.get(file)
    if (cached?.stamp === stamp) return cached
    let entry
    try {
      const content = await readFile(file, 'utf8')
      const parsed = parseHooksFile(JSON.parse(content), file)
      entry = { stamp, content, ...parsed }
    } catch (error) {
      entry = { stamp, content: '', hooks: [], disabled: false, errors: [`${file}: ${error.message}`] }
    }
    for (const message of entry.errors) ctx.logger.warn('hooks: %s', message)
    cache.set(file, entry)
    return entry
  }

  // ---- trusting a project's hooks ------------------------------------------------------------------
  const declined = new Set()
  const asking = new Map()
  async function readTrust() {
    try {
      return JSON.parse(await readFile(trustFile, 'utf8'))
    } catch {
      return {}
    }
  }
  /**
   * What approving a project's hooks file covers: the file itself and every script inside the project its
   * commands name (`./check.sh`, `scripts/lint.mjs`, `$CLAUDE_PROJECT_DIR/hooks/x`), so changing such a script
   * asks again. A script that starts others is covered for itself only.
   */
  async function trustDigest(file, content) {
    const root = path.dirname(path.dirname(file))
    const hash = createHash('sha256').update(content)
    let parsed
    try { parsed = parseHooksFile(JSON.parse(content), file) } catch { parsed = { hooks: [] } }
    const seen = new Set()
    for (const hook of parsed.hooks) {
      const command = hook.command.replace(/\$\{?(?:CLAUDE|HARNESS)_PROJECT_DIR\}?/g, root)
      for (const word of shellWords(command)) {
        if (word.startsWith('-') || !/[/.]/.test(word)) continue
        const candidate = path.resolve(root, word)
        if (seen.has(candidate)) continue
        seen.add(candidate)
        try {
          const real = await realpath(candidate)
          const info = await stat(real)
          if (!info.isFile() || info.size > 5 * 1024 * 1024) continue
          hash.update(`\0${path.relative(root, candidate)}\0`).update(await readFile(real))
        } catch { /* not a file in the project: nothing more to cover */ }
      }
    }
    return hash.digest('hex')
  }

  async function trusted(file, content, agent, signal) {
    const digest = await trustDigest(file, content)
    if ((await readTrust())[file] === digest) return true
    const key = `${file}\n${digest}`
    if (declined.has(key)) return false
    // Only the session you are talking to asks; a helper agent's tool calls skip untrusted project hooks.
    const questions = ctx.get('userQuestions')
    if (agent === undefined || isSubagent(agent) || questions === undefined) return false
    if (!asking.has(key)) {
      asking.set(key, (async () => {
        try {
          const { hooks, disabled } = parseHooksFile(JSON.parse(content), file)
          const listed = hooks.slice(0, 8).map(h => `${h.event}${h.matcher ? ` (${h.matcher})` : ''}: ${h.command}`)
          if (hooks.length > listed.length) listed.push(`and ${hooks.length - listed.length} more`)
          if (disabled) listed.unshift('It also turns off all hooks while you work in this project, including your own.')
          const answer = await questions.ask({
            agent,
            signal,
            questions: [{
              id: TRUST_QUESTION_ID,
              header: 'Hooks',
              question: `This project's ${path.basename(path.dirname(file))}/${path.basename(file)} runs commands on your computer when the agent uses tools or finishes a turn. Run them?`,
              detail: listed.join('\n'),
              options: [
                { label: ALLOW, description: 'Run them now and in later sessions, until the file changes.' },
                { label: DENY, description: 'Ignore this file. You are asked again after Harness Studio restarts.' },
              ],
            }],
          })
          const found = answer?.answers?.find(a => a.id === TRUST_QUESTION_ID)
          if (!(found?.selected ?? []).includes(ALLOW)) {
            declined.add(key)
            return false
          }
          const store = await readTrust()
          store[file] = digest
          await mkdir(path.dirname(trustFile), { recursive: true })
          await writeFile(trustFile, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
          return true
        } catch (error) {
          ctx.logger.warn('hooks: could not ask about %s: %s', file, error.message)
          return false
        } finally {
          asking.delete(key)
        }
      })())
    }
    return asking.get(key)
  }

  /** Every hook that applies to an agent's session, global first; empty when any file turns hooks off. */
  async function hooksFor(agent, signal) {
    let cwd = agent?.session?.header?.cwd
    const workingDirectory = ctx.get('workingDirectory')
    if (agent !== undefined && workingDirectory !== undefined) {
      try {
        cwd = await workingDirectory.ensure(agent, signal)
      } catch { /* keep the session's starting folder */ }
    }
    const root = cwd === undefined ? undefined : projectRootOf(cwd)
    const files = [{ file: globalFile, project: false }]
    if (root !== undefined) {
      files.push({ file: path.join(root, '.harness-studio', 'hooks.json'), project: true })
      files.push({ file: path.join(root, '.harness-studio', 'hooks.local.json'), project: true })
    }
    const hooks = []
    for (const { file, project } of files) {
      const entry = await readHooksFile(file)
      if (entry === undefined) continue
      if (!entry.disabled && entry.hooks.length === 0) continue
      // A project's file, including one that only turns hooks off, counts only after the user allowed it.
      if (project && !(await trusted(file, entry.content, agent, signal))) continue
      if (entry.disabled) return { hooks: [], cwd, root }
      hooks.push(...entry.hooks)
    }
    return { hooks, cwd: cwd ?? process.cwd(), root: root ?? cwd ?? process.cwd() }
  }

  async function runAll(hooks, { cwd, root }, input, event, signal) {
    const env = { CLAUDE_PROJECT_DIR: root, HARNESS_PROJECT_DIR: root }
    const runs = await Promise.all(hooks.map(hook => runHook({ command: hook.command, cwd, input, timeoutMs: hook.timeoutMs, env, signal })))
    const combined = combine(runs.map(run => readOutcome(run, event)))
    combined.errors.forEach((error, i) => ctx.logger.warn('hooks: %s hook failed (%s): %s', event, hooks[i]?.command ?? '', error))
    return combined
  }

  const baseInput = (agent, cwd, event) => ({ session_id: agent.session.id, cwd, hook_event_name: event, transcript_path: null })

  // ---- command rules ------------------------------------------------------------------------------
  // Claude Code's `permissions` block, from <harness home>/permissions.json and the project's
  // .harness-studio/permissions.json and permissions.local.json. Rules only deny or ask, never widen what
  // runs, so a project's rules apply without asking you first.
  const ruleCache = new Map()
  async function readRulesFile(file) {
    let info
    try {
      info = await stat(file)
    } catch {
      ruleCache.delete(file)
      return []
    }
    const stamp = `${info.mtimeMs}:${info.size}`
    const cached = ruleCache.get(file)
    if (cached?.stamp === stamp) return cached.rules
    let parsed
    try {
      parsed = parsePermissionsFile(JSON.parse(await readFile(file, 'utf8')), file)
    } catch (error) {
      parsed = { rules: [], errors: [`${file}: ${error.message}`] }
    }
    for (const message of parsed.errors) ctx.logger.warn('command rules: %s', message)
    ruleCache.set(file, { stamp, rules: parsed.rules })
    return parsed.rules
  }
  /**
   * A project's rules seen so far in each session. Rules only ever add up during a session, so a deny rule
   * removed from the file (by the agent's shell, say) still applies until the next session.
   */
  const projectRulesSeen = new Map()
  async function rulesFor(cwd, sessionId) {
    const root = projectRootOf(cwd)
    const own = await readRulesFile(path.join(home, 'permissions.json'))
    let project = (await Promise.all([path.join(root, '.harness-studio', 'permissions.json'), path.join(root, '.harness-studio', 'permissions.local.json')].map(readRulesFile))).flat()
    if (sessionId !== undefined) {
      const seen = projectRulesSeen.get(sessionId) ?? new Map()
      for (const rule of project) seen.set(`${rule.kind}\0${rule.text}\0${rule.source}`, rule)
      projectRulesSeen.delete(sessionId)
      projectRulesSeen.set(sessionId, seen)
      while (projectRulesSeen.size > 200) projectRulesSeen.delete(projectRulesSeen.keys().next().value)
      project = [...seen.values()]
    }
    return { rules: [...own, ...project], root }
  }
  /** Whether a path is one of the files holding hooks or command rules, yours or the project's. */
  function isControlFile(file, root) {
    const names = new Set(['hooks.json', 'hooks.local.json', 'permissions.json', 'permissions.local.json'])
    const dir = path.dirname(file)
    return (names.has(path.basename(file)) && (dir === path.join(root, '.harness-studio')))
      || file === globalFile || file === path.join(home, 'permissions.json')
  }
  const realpathsOf = file => { try { const real = realpathSync(file); return real === file ? [] : [real] } catch { return [] } }

  // ---- what the agent types into its terminal ---------------------------------------------------------
  // Text typed into a terminal is checked a line at a time, when Enter is pressed: the line is what the shell
  // (or whatever program is running) receives, however the agent split it across sends and keys.
  const typedLines = new Map()
  function linesTyped(exec) {
    const key = `${exec.agent.session.id}\0${exec.arguments?.id}`
    let line = typedLines.get(key) ?? ''
    const done = []
    const feed = text => {
      for (const ch of text) {
        if (ch === '\r' || ch === '\n') { done.push(line); line = '' }
        else if (ch === '\b' || ch === '\x7f') line = line.slice(0, -1)
        else if (ch >= ' ' || ch === '\t') line += ch
      }
    }
    if (typeof exec.arguments?.text === 'string') feed(exec.arguments.text)
    for (const raw of Array.isArray(exec.arguments?.keys) ? exec.arguments.keys : []) {
      const k = String(raw)
      if ([...k].length === 1) feed(k)
      else if (/^(enter|return)$/i.test(k)) feed('\n')
      else if (/^space$/i.test(k)) feed(' ')
      else if (/^tab$/i.test(k)) feed('\t')
      else if (/^backspace$/i.test(k)) feed('\b')
      else if (/^(ctrl|control|c)[+-]?[cu]$/i.test(k) || /^escape$/i.test(k)) line = ''
    }
    return { done, commit: () => { typedLines.delete(key); if (line !== '') typedLines.set(key, line); while (typedLines.size > 500) typedLines.delete(typedLines.keys().next().value) } }
  }
  async function sessionCwd(agent, signal) {
    const workingDirectory = ctx.get('workingDirectory')
    if (workingDirectory !== undefined) {
      try { return await workingDirectory.ensure(agent, signal) } catch { /* keep the session's starting folder */ }
    }
    return agent?.session?.header?.cwd ?? process.cwd()
  }
  const shortSource = (file, root) => (file.startsWith(root + path.sep) ? path.relative(root, file) : file.replace(os.homedir(), '~'))

  // ---- before a tool call -------------------------------------------------------------------------
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.agent !== undefined) {
      const cwd = await sessionCwd(exec.agent, exec.signal)
      const { rules, root } = await rulesFor(cwd, String(exec.agent.session.id))
      const where = { root, cwd, home: os.homedir(), realpath: realpathsOf }

      // The files holding hooks and rules guard the agent, so changing them through its file tools asks first.
      const target = (exec.name === 'write' || exec.name === 'edit') && typeof exec.arguments?.file_path === 'string'
        ? path.resolve(cwd, exec.arguments.file_path) : undefined
      if (target !== undefined && [target, ...realpathsOf(target)].some(file => isControlFile(file, root))) {
        const shown = shortSource(target, root)
        return { kind: 'ask', reason: `${shown} holds hooks or command rules`, displayReason: { en: `The agent wants to change ${shown}, which holds hooks or command rules that guard what it may do.` } }
      }

      // Lines typed into the agent's terminal are commands too: rules and Bash hooks see each finished line.
      const typed = exec.name === 'terminal_send' ? linesTyped(exec) : undefined
      const commands = typed ? typed.done.map(line => ({ name: 'bash', args: { command: line } })) : [{ name: exec.name, args: exec.arguments ?? {} }]

      for (const { name: tool, args } of commands) {
        if (!rules.length) break
        const decision = decide(rules, describeCall(tool, args, HARNESS_FAMILIES), where)
        const named = decision.rule && `${decision.rule.text} in ${shortSource(decision.rule.source, root)}`
        if (decision.kind === 'deny') return { kind: 'deny', reason: `A command rule blocks this call: ${named}. Do not try to get around it; ask the user if it is needed.` }
        if (decision.kind === 'ask') return { kind: 'ask', reason: `A command rule asks first: ${named}`, displayReason: { en: `Your command rule ${named} asks before this runs.` } }
      }
      const found = await hooksFor(exec.agent, exec.signal)
      for (const { name: tool, args } of commands) {
        const hooks = found.hooks.filter(h => h.event === 'PreToolUse' && matchesTool(h.matcher, tool))
        if (!hooks.length) continue
        const input = { ...baseInput(exec.agent, found.cwd, 'PreToolUse'), tool_name: claudeToolName(tool), harness_tool_name: exec.name, tool_input: args }
        const decision = await runAll(hooks, found, input, 'PreToolUse', exec.signal)
        if (decision.kind === 'deny') return { kind: 'deny', reason: `A PreToolUse hook blocked this call: ${decision.reason}` }
        if (decision.kind === 'ask') return { kind: 'ask', reason: `PreToolUse hook: ${decision.reason}`, displayReason: { en: decision.reason } }
      }
      typed?.commit()
    }
    return next()
  })

  // ---- after a successful tool call ---------------------------------------------------------------
  ctx.on('tools/post-execute', async (exec, result, next) => {
    let decision = await next()
    if (exec.agent === undefined || result.isError || decision.kind === 'block') return decision
    if ((exec.name === 'grep' || exec.name === 'glob') && decision.kind === 'accept') decision = await withoutHiddenFiles(exec, result, decision)
    const found = await hooksFor(exec.agent, exec.signal)
    const hooks = found.hooks.filter(h => h.event === 'PostToolUse' && matchesTool(h.matcher, exec.name))
    if (!hooks.length) return decision
    const input = {
      ...baseInput(exec.agent, found.cwd, 'PostToolUse'),
      tool_name: claudeToolName(exec.name),
      harness_tool_name: exec.name,
      tool_input: exec.arguments ?? {},
      tool_response: { output: contentText(decision.content ?? result.content), ...result.value === undefined ? {} : { value: result.value } },
    }
    const outcome = await runAll(hooks, found, input, 'PostToolUse', exec.signal)
    const contexts = outcome.context ? [notice(`PostToolUse hook context:\n${outcome.context}`, 'A hook added context after this tool call')] : []
    if (outcome.kind === 'block') {
      return { kind: 'block', feedback: [{ type: 'text', text: `The call ran, but a PostToolUse hook reported a problem: ${outcome.reason}` }], ...contexts.length ? { additionalContexts: contexts } : {} }
    }
    if (!contexts.length) return decision
    return { ...decision, additionalContexts: [...decision.additionalContexts ?? [], ...contexts] }
  })

  /**
   * A search can name files a Read rule denies or asks about without reading them one by one; those results
   * are dropped (with a line saying how many). The search's output lists one path per line, or a path line
   * followed by its "Line N:" matches.
   */
  async function withoutHiddenFiles(exec, result, decision) {
    const cwd = await sessionCwd(exec.agent, exec.signal)
    const { rules, root } = await rulesFor(cwd, String(exec.agent.session.id))
    const hiding = rules.filter(rule => (rule.kind === 'deny' || rule.kind === 'ask') && rule.tool === 'Read' && rule.specifier !== undefined)
    if (!hiding.length) return decision
    const base = path.resolve(cwd, typeof exec.arguments?.path === 'string' ? exec.arguments.path : '.')
    const where = { root, cwd, home: os.homedir(), realpath: realpathsOf }
    const hidden = line => {
      const candidate = line.trim()
      if (candidate === '' || /^Line \d+:/.test(candidate)) return false
      const file = path.resolve(base, candidate)
      return [file, ...realpathsOf(file)].some(f => hiding.some(rule => pathMatches(rule.specifier, f, where)))
    }
    let dropped = 0
    const content = (decision.content ?? result.content).map(block => {
      if (block.type !== 'text' || typeof block.text !== 'string') return block
      const kept = []
      let skipping = false
      for (const line of block.text.split('\n')) {
        if (/^Line \d+:/.test(line.trim())) { if (!skipping) kept.push(line); continue }
        skipping = hidden(line)
        if (skipping) dropped++
        else kept.push(line)
      }
      return { ...block, text: kept.join('\n') }
    })
    if (!dropped) return decision
    content.push({ type: 'text', text: `${dropped} result(s) left out: your command rules hide those files. Do not try to read them another way.` })
    return { ...decision, content }
  }

  // ---- when the agent is about to finish its turn -------------------------------------------------
  /** Stop-hook blocks so far in each session's current turn. */
  const blocks = new WeakMap()
  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
    if (isSubagent(agent) || signal?.aborted) return
    const found = await hooksFor(agent, signal)
    const hooks = found.hooks.filter(h => h.event === 'Stop')
    if (!hooks.length) return
    const seen = blocks.get(agent.session)
    const count = seen?.turn === turn ? seen.count : 0
    const input = { ...baseInput(agent, found.cwd, 'Stop'), stop_hook_active: count > 0 }
    const outcome = await runAll(hooks, found, input, 'Stop', signal)
    if (outcome.kind !== 'block' || signal?.aborted) return
    if (count >= MAX_STOP_BLOCKS) {
      ctx.logger.warn('hooks: Stop hooks blocked %d times in one turn; letting the turn end', count)
      return
    }
    blocks.set(agent.session, { turn, count: count + 1 })
    agent.steer(notice(`A Stop hook says the work is not finished yet:\n${outcome.reason}`, 'A Stop hook sent the agent back to work'))
  })
}
