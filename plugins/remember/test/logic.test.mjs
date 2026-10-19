import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HEADING, PERSONAL, PROJECT, SKIP, cardOptions, cleanNote, localDate, readChoice, withNote } from '../logic.js'

test('a note becomes one trimmed line without a leading bullet', () => {
  assert.equal(cleanNote('  - Run the tests with\n  pnpm test  '), 'Run the tests with pnpm test')
})

test('empty, overlong and secret-looking notes are refused', () => {
  assert.throws(() => cleanNote('   '), /empty/)
  assert.throws(() => cleanNote('x'.repeat(301)), /under 300/)
  // Fake keys are assembled at run time so no file in the repository looks like it holds one.
  const fake = (prefix, body) => prefix + body
  for (const secret of [
    `Use key ${fake('sk', '-')}${'a'.repeat(24)} for the API`,
    `Deploy token ${fake('gh', 'p_')}${'b'.repeat(32)}`,
    `AWS key ${fake('AK', 'IA')}${'C'.repeat(16)}`,
    `${fake('pass', 'word')}: ${'d'.repeat(12)}`,
    `${fake('api', '_key')}=${'e'.repeat(16)}`,
  ]) assert.throws(() => cleanNote(secret), /secrets are never saved/, secret)
  assert.equal(cleanNote('Never paste the API key into chat'), 'Never paste the API key into chat')
})

test('secret shapes after an underscore, env-style names, provider tokens, JWTs, URLs and Bearer headers are refused', () => {
  // Assembled at run time so the repository holds nothing that looks like a real secret.
  const j = (...parts) => parts.join('')
  for (const secret of [
    j('DB_', 'PASSWORD', '=', 'hunter2hunter'),
    j('AWS_SECRET_', 'ACCESS_KEY', '=', 'f'.repeat(40)),
    j('export GITHUB_', 'TOKEN', '=', 'g'.repeat(24)),
    j('client', '_secret: ', 'h'.repeat(12)),
    j('Use ', 'sk_', 'live_', 'a'.repeat(24)),
    j('sk_', 'test_', 'b'.repeat(24)),
    j('rk_', 'live_', 'c'.repeat(24)),
    j('gl', 'pat-', 'd'.repeat(20)),
    j('np', 'm_', 'e'.repeat(36)),
    j('ey', 'JhbGciOiJIUzI1NiJ9', '.', 'ey', 'JzdWIiOiIxMjM0In0', '.', 'sig'),
    j('postgres://admin', ':', 's3cretpw', '@db.example.com/app'),
    j('Authorization', ': Bearer ', 'abcdef123'),
    j('curl -H "Bearer ', 'x'.repeat(32), '"'),
  ]) assert.throws(() => cleanNote(secret), /secrets are never saved/, secret)
  for (const fine of [
    'Set DB_PASSWORD in .env, never in the code',
    'Read the key from DB_PASSWORD=$DB_PASSWORD_FILE',
    'Copy API_KEY=<your-key> from the template',
    'Postgres runs at postgres://localhost:5432/app',
    'The Bearer header comes from the auth helper',
    'Use the token bucket limiter for the API',
    'Sort with sk_ prefixes first',
  ]) assert.equal(cleanNote(fine), fine)
})

test('the suggested place is offered first and Don\'t save is last', () => {
  assert.deepEqual(cardOptions('project').map(o => o.label), [PROJECT, PERSONAL, SKIP])
  assert.deepEqual(cardOptions('personal').map(o => o.label), [PERSONAL, PROJECT, SKIP])
  assert.match(cardOptions('project')[0].description, /AGENTS\.local\.md/)
})

test('only a place choice saves; anything else saves nothing', () => {
  assert.deepEqual(readChoice({ selected: [PROJECT] }), { scope: 'project' })
  assert.deepEqual(readChoice({ selected: [PERSONAL] }), { scope: 'personal' })
  assert.deepEqual(readChoice({ selected: [SKIP] }), { scope: null })
  assert.deepEqual(readChoice({ selected: [], custom: ' say it differently ' }), { scope: null, said: 'say it differently' })
  assert.deepEqual(readChoice(undefined), { scope: null })
})

test('a new file gets the section and the note', () => {
  assert.deepEqual(withNote('', 'Use pnpm', '2026-10-17'), { content: `${HEADING}\n\n- Use pnpm (2026-10-17)\n`, added: true })
})

test('an existing file keeps its text and gains the section at the end', () => {
  const { content } = withNote('# Rules\n\nBe brief.\n\n', 'Use pnpm', '2026-10-17')
  assert.equal(content, `# Rules\n\nBe brief.\n\n${HEADING}\n\n- Use pnpm (2026-10-17)\n`)
})

test('notes join the existing section, before any later section', () => {
  const start = `# Rules\n\n${HEADING}\n\n- Use pnpm (2026-10-16)\n\n## Other\n\nText.\n`
  const { content, added } = withNote(start, 'Prefer tabs', '2026-10-17')
  assert.equal(added, true)
  assert.equal(content, `# Rules\n\n${HEADING}\n\n- Use pnpm (2026-10-16)\n- Prefer tabs (2026-10-17)\n\n## Other\n\nText.\n`)
})

test('a note already saved is not added twice', () => {
  const start = `${HEADING}\n\n- Use pnpm (2026-10-16)\n`
  assert.deepEqual(withNote(start, 'Use pnpm', '2026-10-17'), { content: start, added: false })
})

test('dates are on the local calendar, not UTC', () => {
  assert.equal(localDate(new Date(2026, 9, 17, 23, 30)), '2026-10-17')
  assert.equal(localDate(new Date(2026, 0, 5, 0, 5)), '2026-01-05')
})
