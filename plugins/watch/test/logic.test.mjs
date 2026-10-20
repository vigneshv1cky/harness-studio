import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import {
  LIMITS, afterDelivery, conditionHolds, cutBytes, deliveryDecision, foldCheck, foldFiles, initialState, isWantedPath, lineDiff,
  describe, noticeText, normalizeSpec, rebaseline,
} from '../logic.js'

const cwd = '/work/app'
const ok = output => ({ exitCode: 0, output })

test('normalizeSpec fills defaults and resolves paths against the session folder', () => {
  const command = normalizeSpec({ kind: 'command', command: ' git status --porcelain ' }, { cwd, now: 0 })
  assert.equal(command.command, 'git status --porcelain')
  assert.equal(command.interval, LIMITS.defaultInterval.command)
  assert.equal(command.when, 'change')
  assert.equal(command.cooldown, LIMITS.defaultCooldown)
  assert.equal(command.maxWakes, LIMITS.defaultMaxWakes)
  assert.equal(command.expiresAt, LIMITS.defaultLifetimeMinutes * 60_000)
  assert.equal(command.label, 'git status --porcelain')
  const port = normalizeSpec({ port: '3000' }, { cwd })
  assert.deepEqual([port.kind, port.port, port.host, port.interval, port.label], ['port', 3000, 'localhost', 10, 'port 3000'])
  const files = normalizeSpec({ kind: 'files', paths: ['src', '/abs/x', 'src'] }, { cwd })
  assert.deepEqual(files.paths, ['/work/app/src', '/abs/x'])
  assert.equal(files.interval, 0)
})

test('normalizeSpec refuses what a watch cannot do', () => {
  const bad = (args, message) => assert.throws(() => normalizeSpec(args, { cwd }), message)
  bad({ kind: 'command' }, /command is required/)
  bad({ kind: 'command', command: 'x', interval_seconds: 1 }, /at least 5/)
  bad({ kind: 'command', command: 'x', cooldown_seconds: 2 }, /at least 10/)
  bad({ kind: 'command', command: 'x', lifetime_minutes: 99999 }, /at most/)
  bad({ kind: 'port', port: 70000 }, /1 to 65535/)
  bad({ kind: 'port', port: 80, host: 'example.com' }, /this computer only/)
  bad({ kind: 'port', port: 80, when: 'match', pattern: 'x' }, /port watch takes/)
  bad({ kind: 'files', paths: [] }, /paths is required/)
  bad({ kind: 'files', paths: ['a'], when: 'fails' }, /only reports changes/)
  bad({ kind: 'command', command: 'x', when: 'match' }, /needs a pattern/)
  bad({ kind: 'command', command: 'x', when: 'match', pattern: '(' }, /not a valid regular expression/)
  bad({ kind: 'nope' }, /kind must be/)
})

test('change: the same result is not news; a different one is pending until delivered', () => {
  const spec = normalizeSpec({ command: 'x' }, { cwd })
  let state = initialState(spec, ok('a'), 0)
  state = foldCheck(spec, state, ok('a'), { now: 1, busy: false })
  assert.equal(state.pending, undefined)
  state = foldCheck(spec, state, ok('b'), { now: 2, busy: false })
  assert.deepEqual(state.pending, { since: 2, changes: 1 })
  state = foldCheck(spec, state, ok('c'), { now: 3, busy: false })
  assert.equal(state.pending.changes, 2)
  // Back to what the agent knew: nothing to say.
  state = foldCheck(spec, state, ok('a'), { now: 4, busy: false })
  assert.equal(state.pending, undefined)
  // The exit code counts as much as the output.
  state = foldCheck(spec, state, { exitCode: 1, output: 'a' }, { now: 5, busy: false })
  assert.ok(state.pending)
})

test('while the agent is busy nothing becomes news, and a turn end takes the latest state as the baseline', () => {
  const spec = normalizeSpec({ command: 'x' }, { cwd })
  let state = initialState(spec, ok('a'), 0)
  state = foldCheck(spec, state, ok('b'), { now: 1, busy: true })
  assert.equal(state.pending, undefined)
  assert.equal(state.last.output, 'b')
  state = rebaseline(spec, state, ok('c'))
  assert.equal(state.baseline.output, 'c')
  state = foldCheck(spec, state, ok('c'), { now: 2, busy: false })
  assert.equal(state.pending, undefined)
})

test('conditions notify when they become true, and re-arm when they stop holding', () => {
  const spec = normalizeSpec({ command: 'x', when: 'match', pattern: 'error' }, { cwd })
  let state = initialState(spec, ok('fine'), 0)
  assert.equal(state.baselineHolds, false)
  state = foldCheck(spec, state, ok('1 error'), { now: 1, busy: false })
  assert.ok(state.pending)
  state = afterDelivery(spec, state, 1)
  assert.equal(state.baselineHolds, true)
  state = foldCheck(spec, state, ok('2 error'), { now: 2, busy: false })
  assert.equal(state.pending, undefined, 'still true: no new notice')
  state = foldCheck(spec, state, ok('fine'), { now: 3, busy: false })
  assert.equal(state.baselineHolds, false)
  state = foldCheck(spec, state, ok('3 error'), { now: 4, busy: false })
  assert.ok(state.pending)
  const succeeds = normalizeSpec({ port: 3000, when: 'succeeds' }, { cwd })
  assert.equal(conditionHolds(succeeds, { exitCode: 0, output: 'up' }), true)
  assert.equal(conditionHolds(succeeds, { exitCode: 1, output: 'down' }), false)
  const fails = normalizeSpec({ command: 'x', when: 'fails' }, { cwd })
  assert.equal(conditionHolds(fails, { exitCode: null, output: '', error: 'timed out' }), true)
})

test('delivery waits for the cooldown and stops at the notice limit', () => {
  const spec = normalizeSpec({ command: 'x', cooldown_seconds: 60, max_wakes: 2 }, { cwd })
  let state = initialState(spec, ok('a'), 0)
  assert.deepEqual(deliveryDecision(spec, state, 0), { deliver: false })
  state = foldCheck(spec, state, ok('b'), { now: 0, busy: false })
  assert.deepEqual(deliveryDecision(spec, state, 0), { deliver: true })
  state = afterDelivery(spec, state, 1000)
  assert.equal(state.wakes, 1)
  assert.equal(state.baseline.output, 'b')
  state = foldCheck(spec, state, ok('c'), { now: 2000, busy: false })
  assert.deepEqual(deliveryDecision(spec, state, 2000), { deliver: false, at: 61_000 })
  assert.deepEqual(deliveryDecision(spec, state, 61_000), { deliver: true })
  state = afterDelivery(spec, state, 61_000)
  state = foldCheck(spec, state, ok('d'), { now: 200_000, busy: false })
  assert.deepEqual(deliveryDecision(spec, state, 200_000), { deliver: false }, 'limit reached')
})

test('files: ignored folders and unwanted paths never count; batches merge until delivered', () => {
  const spec = normalizeSpec({ kind: 'files', paths: ['.'], pattern: '\\.js$' }, { cwd })
  assert.equal(isWantedPath(spec, '/work/app/node_modules/x/a.js'), false)
  assert.equal(isWantedPath(spec, '/work/app/.git/index'), false)
  assert.equal(isWantedPath(spec, '/work/app/src/a.css'), false)
  assert.equal(isWantedPath(spec, '/work/app/src/a.js'), true)
  let state = initialState(spec, ok(''), 0)
  state = foldFiles(spec, state, ['/work/app/src/a.css'], { now: 1, busy: false })
  assert.equal(state.pending, undefined)
  state = foldFiles(spec, state, ['/work/app/src/a.js'], { now: 2, busy: true })
  assert.equal(state.pending, undefined)
  state = foldFiles(spec, state, ['/work/app/src/a.js'], { now: 3, busy: false })
  state = foldFiles(spec, state, ['/work/app/src/b.js', '/work/app/src/a.js'], { now: 4, busy: false })
  assert.deepEqual(state.pending.paths, ['/work/app/src/a.js', '/work/app/src/b.js'])
  const { text } = noticeText({ id: 'watch-1', spec }, state, { now: 4, last: false })
  assert.match(text, /2 files changed/)
  assert.match(text, /- \/work\/app\/src\/b\.js/)
  state = rebaseline(spec, state)
  assert.equal(state.pending, undefined)
})

test('lineDiff shows removed and added lines in order', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nc\nd'), ['- b', '+ d'])
  assert.deepEqual(lineDiff('', 'x'), ['+ x'])
  const many = lineDiff('', Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n'), 5)
  assert.equal(many.length, 6)
  assert.match(many[5], /95 more/)
})

test('the notice says what changed, stays under its size, and says when it is the last one', () => {
  const spec = normalizeSpec({ command: 'npm run lint', label: 'lint' }, { cwd })
  let state = initialState(spec, ok('clean'), 0)
  state = foldCheck(spec, state, { exitCode: 1, output: `${'x'.repeat(5000)}\nsrc/a.js: error` }, { now: 1, busy: false })
  const { text, summary } = noticeText({ id: 'watch-1', spec }, state, { now: 1, last: false })
  assert.match(text, /Watch "lint" \(watch-1\)/)
  assert.match(text, /Before: exit code 0\. Now: exit code 1\./)
  assert.match(text, /- clean/)
  assert.ok(new TextEncoder().encode(text).byteLength <= LIMITS.noticeBytes)
  assert.match(text, /Notices left: 19/)
  assert.equal(summary, 'Watch "lint": changed')
  const port = normalizeSpec({ port: 3000 }, { cwd })
  let portState = initialState(port, { exitCode: 1, output: 'down' }, 0)
  portState = foldCheck(port, portState, { exitCode: 0, output: 'up' }, { now: 1, busy: false })
  const final = noticeText({ id: 'watch-2', spec: port }, portState, { now: 1, last: true })
  assert.match(final.text, /port 3000 on localhost is now up/)
  assert.match(final.text, /last notice/)
})

test('patterns that can backtrack catastrophically, or are too long, are refused up front', () => {
  for (const pattern of ['(a+)+$', '(a*)*b', '(x|x)+y', '(?:a?b?)+', '(\\d+\\s?)+$', '((ab)+)+', '(?<n>a+){2,}', '(a|ab){3}', '([a-z]+)*@', '(.*a){20}']) {
    assert.throws(() => normalizeSpec({ command: 'x', when: 'match', pattern }, { cwd }), /repeats a group that itself repeats or has alternatives/, pattern)
  }
  assert.throws(() => normalizeSpec({ command: 'x', when: 'match', pattern: 'a'.repeat(301) }, { cwd }), /too long \(300 characters at most\)/)
  // Ordinary patterns, including quantified groups without inner repetition and repeated escapes or classes.
  for (const pattern of ['error|warn', '^(ERROR|FATAL):', '(\\d+) passing', '(ab)+', '(?:foo)?bar', '[(+*]+', '\\(a+\\)+', '(a|b)?', '(a+){1}', '(a+){0,1}', 'a{2,}', '\\.(ts|js)$']) {
    assert.doesNotThrow(() => normalizeSpec({ command: 'x', when: 'match', pattern }, { cwd }), pattern)
  }
  assert.throws(() => normalizeSpec({ paths: ['src'], pattern: '(a+)+' }, { cwd }), /repeats a group/)
})

test('a pattern is tested against the last 16 KB of the output only', () => {
  const spec = normalizeSpec({ command: 'x', when: 'match', pattern: '^READY' }, { cwd })
  const tail = `${'x'.repeat(LIMITS.patternText - 10)}\nREADY`
  assert.equal(conditionHolds(spec, ok(`READY\n${'y'.repeat(LIMITS.patternText)}`)), false)
  assert.equal(conditionHolds(spec, ok(`${'y'.repeat(LIMITS.outputBytes - tail.length)}${tail}`)), true)
  // A slow but allowed pattern on a large output stays quick.
  const slow = normalizeSpec({ command: 'x', when: 'match', pattern: '\\s+$x' }, { cwd })
  const started = performance.now()
  conditionHolds(slow, ok(' '.repeat(LIMITS.outputBytes)))
  assert.ok(performance.now() - started < 2000)
})

test('cutBytes never splits a character', () => {
  assert.equal(cutBytes('héllo', 2), 'h')
  assert.equal(cutBytes('abc', 10), 'abc')
})

test('a dashboard watch refreshes on its interval and never notifies', () => {
  const spec = normalizeSpec({ kind: 'dashboard', dashboard: 'sales', when: 'change' }, { cwd: '/w', now: 0 })
  assert.equal(spec.when, 'never')
  assert.equal(spec.interval, 15 * 60)
  assert.equal(spec.label, 'dashboard sales')
  assert.equal(describe(spec), 'refreshes dashboard sales, every 15 min')
  assert.throws(() => normalizeSpec({ kind: 'dashboard', dashboard: '../x' }, { cwd: '/w' }), /name of a folder in dashboards/)
  assert.throws(() => normalizeSpec({ kind: 'dashboard', dashboard: 'x', interval_seconds: 30 }, { cwd: '/w' }), /at least 60/)
  let state = initialState(spec, { exitCode: 0, output: '1 of 1 sources refreshed' }, 0)
  state = foldCheck(spec, state, { exitCode: 1, output: '0 of 1 sources refreshed\nsales: exited with 1' }, { now: 1, busy: false })
  assert.equal(state.pending, undefined)
})
