import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_TIMEOUT_SECONDS, claudeToolName, combine, contentText, matchesTool, parseHooksFile, readOutcome } from '../logic.js'

test('tool names are also matched in Claude Code spelling', () => {
  assert.equal(claudeToolName('bash'), 'Bash')
  assert.equal(claudeToolName('web_fetch'), 'WebFetch')
  assert.equal(claudeToolName('exit_plan_mode'), 'ExitPlanMode')
  assert.ok(matchesTool('Bash', 'bash'))
  assert.ok(matchesTool('bash', 'bash'))
  assert.ok(matchesTool('Edit|Write', 'write'))
  assert.ok(matchesTool('', 'read'))
  assert.ok(matchesTool('*', 'read'))
  assert.ok(!matchesTool('Edit', 'edit_notebook'), 'a matcher must match the whole name')
  assert.ok(matchesTool('mcp__.*', 'mcp__github__search'))
  assert.ok(matchesTool('a(b', 'a(b'), 'an invalid expression matches only that exact name')
  assert.ok(!matchesTool('a(b', 'ab'))
})

test('a hooks file becomes a flat list, and mistakes are reported, not fatal', () => {
  const { hooks, errors, disabled } = parseHooksFile({
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './check.sh', timeout: 5 }, { type: 'prompt', prompt: 'x' }] }],
      PostToolUse: [{ hooks: [{ type: 'command', command: 'fmt', timeout: 10_000 }] }],
      Stop: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'npm test' }] }],
      Notification: [],
    },
  }, '/h.json')
  assert.equal(disabled, false)
  assert.deepEqual(hooks, [
    { event: 'PreToolUse', matcher: 'Bash', command: './check.sh', timeoutMs: 5000, source: '/h.json' },
    { event: 'PostToolUse', matcher: '', command: 'fmt', timeoutMs: MAX_TIMEOUT_SECONDS * 1000, source: '/h.json' },
    { event: 'Stop', matcher: '', command: 'npm test', timeoutMs: 60_000, source: '/h.json' },
  ])
  assert.equal(errors.length, 3)
  assert.match(errors.join('\n'), /type must be "command"/)
  assert.match(errors.join('\n'), /Stop hooks are not tied to a tool/)
  assert.match(errors.join('\n'), /"Notification" is not a supported event/)
  assert.equal(parseHooksFile({ disableAllHooks: true }, 'x').disabled, true)
  assert.match(parseHooksFile([], 'x').errors[0], /expected a JSON object/)
})

test('exit code 2 blocks with standard error, other failures block nothing', () => {
  assert.deepEqual(readOutcome({ code: 2, stdout: '', stderr: 'no rm -rf\n' }, 'PreToolUse'), { kind: 'deny', reason: 'no rm -rf' })
  assert.deepEqual(readOutcome({ code: 2, stdout: '', stderr: '' }, 'PostToolUse'), { kind: 'block', reason: 'A PostToolUse hook returned exit code 2.' })
  assert.deepEqual(readOutcome({ code: 1, stdout: '', stderr: 'oops' }, 'PreToolUse'), { kind: 'error', reason: 'exit code 1: oops' })
  assert.deepEqual(readOutcome({ code: null, stdout: '', stderr: '', timedOut: true }, 'Stop'), { kind: 'error', reason: 'timed out' })
  assert.deepEqual(readOutcome({ code: 0, stdout: 'formatted 3 files', stderr: '' }, 'PostToolUse'), { kind: 'none' })
})

test('JSON output decides as in Claude Code', () => {
  const json = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' })
  assert.deepEqual(readOutcome(json({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'prod config' } }), 'PreToolUse'), { kind: 'deny', reason: 'prod config' })
  assert.deepEqual(readOutcome(json({ hookSpecificOutput: { permissionDecision: 'ask' } }), 'PreToolUse').kind, 'ask')
  assert.deepEqual(readOutcome(json({ hookSpecificOutput: { permissionDecision: 'allow' } }), 'PreToolUse'), { kind: 'allow' })
  assert.deepEqual(readOutcome(json({ decision: 'block', reason: 'old style' }), 'PreToolUse'), { kind: 'deny', reason: 'old style' })
  assert.deepEqual(readOutcome(json({ decision: 'block', reason: 'tests fail' }), 'Stop'), { kind: 'block', reason: 'tests fail' })
  assert.deepEqual(readOutcome(json({ hookSpecificOutput: { additionalContext: 'lint: 2 warnings' } }), 'PostToolUse'), { kind: 'none', context: 'lint: 2 warnings' })
})

test('a denial wins over ask, which wins over allow; reasons and context are kept', () => {
  assert.deepEqual(combine([{ kind: 'allow' }, { kind: 'none' }]), { kind: 'allow', errors: [] })
  assert.deepEqual(combine([{ kind: 'ask', reason: 'a' }, { kind: 'deny', reason: 'b' }, { kind: 'deny', reason: 'c' }]), { kind: 'deny', reason: 'b\nc', errors: [] })
  assert.deepEqual(combine([{ kind: 'ask', reason: 'a' }, { kind: 'error', reason: 'x' }]), { kind: 'ask', reason: 'a', errors: ['x'] })
  assert.deepEqual(combine([{ kind: 'none', context: 'one' }, { kind: 'none', context: 'two' }]), { kind: 'allow', context: 'one\n\ntwo', errors: [] })
})

test('tool output passed to hooks is text and bounded', () => {
  assert.equal(contentText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]), 'a\n[image]\nb')
  assert.match(contentText([{ type: 'text', text: 'x'.repeat(30) }], 10), /^x{10}\n\[… 20 more characters\]$/)
})
