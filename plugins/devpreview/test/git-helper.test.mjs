import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { startGitHelper } from '../git-helper.js'

const ORIGIN = 'http://helper-test.invalid'
const secret = randomBytes(32)
const results = []
let helper, base

// Setup commands ignore the user's own git config (signing, hooks, templates).
const SETUP_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
const sh = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, env: SETUP_ENV, encoding: 'utf8' })

/** Send one request to the helper; resolves with { status, body }. */
function call(method, route, { body, chunks } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { origin: ORIGIN, 'x-hs-helper-key': secret.toString('hex') }
    if (body !== undefined || chunks) headers['content-type'] = 'application/json'
    const req = request({ host: '127.0.0.1', port: helper.port, path: route, method, headers }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', c => { text += c })
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : undefined }))
    })
    req.on('error', reject)
    if (chunks) {
      // Write each piece on its own turn so the server reads them as separate chunks.
      const write = (i) => { if (i === chunks.length) req.end(); else req.write(chunks[i], () => setTimeout(() => write(i + 1), 20)) }
      write(0)
    } else req.end(body)
  })
}
const status = cwd => call('GET', `/status?cwd=${encodeURIComponent(cwd)}`)
const diff = (cwd, file) => call('GET', `/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(file)}`)

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'devpreview-git-'))
  helper = await startGitHelper({ secret, origins: [ORIGIN], browser: { result: message => { results.push(message); return true }, next: async () => null, requeue() {} } })
})
after(async () => {
  await helper?.close()
  await rm(base, { recursive: true, force: true })
})

test('repository config cannot make status or diff run a program', async () => {
  const repo = path.join(base, 'evil')
  const marks = path.join(base, 'marks')
  await mkdir(repo)
  await mkdir(marks)
  // One script per mechanism; each leaves a marker file named after itself, then passes stdin through.
  const script = async (name) => {
    const file = path.join(base, `${name}.sh`)
    await writeFile(file, `#!/bin/sh\ntouch "${marks}/${name}"\nexec cat\n`)
    await chmod(file, 0o755)
    return file
  }
  sh(repo, 'init', '-q')
  await writeFile(path.join(repo, 'app.txt'), 'one\n')
  sh(repo, 'add', '.')
  sh(repo, 'commit', '-q', '-m', 'init')
  // What an agent could write once the repository exists.
  sh(repo, 'config', 'core.fsmonitor', await script('fsmonitor'))
  sh(repo, 'config', 'filter.evil.clean', await script('clean'))
  sh(repo, 'config', 'filter.evil.smudge', await script('smudge'))
  sh(repo, 'config', 'filter.evil.required', 'true')
  sh(repo, 'config', 'diff.evil.textconv', await script('textconv'))
  sh(repo, 'config', 'diff.evil.command', await script('diffdriver'))
  sh(repo, 'config', 'diff.external', await script('external'))
  sh(repo, 'config', 'core.pager', await script('pager'))
  await writeFile(path.join(repo, '.gitattributes'), '* filter=evil diff=evil\n')
  await writeFile(path.join(repo, 'app.txt'), 'one\ntwo\n')
  await writeFile(path.join(repo, 'new.txt'), 'a\nb\nc\n')

  const listed = await status(repo)
  assert.equal(listed.status, 200, JSON.stringify(listed.body))
  const byPath = Object.fromEntries(listed.body.files.map(f => [f.path, f]))
  assert.deepEqual([byPath['app.txt'].status, byPath['app.txt'].added, byPath['app.txt'].deleted], ['modified', 1, 0])
  assert.deepEqual([byPath['new.txt'].status, byPath['new.txt'].added], ['untracked', 3])
  const tracked = await diff(repo, 'app.txt')
  assert.equal(tracked.status, 200, JSON.stringify(tracked.body))
  assert.match(tracked.body.diff, /^\+two$/m)
  const untracked = await diff(repo, 'new.txt')
  assert.equal(untracked.status, 200, JSON.stringify(untracked.body))
  assert.match(untracked.body.diff, /^\+c$/m)
  assert.equal((await call('GET', `/files?cwd=${encodeURIComponent(repo)}`)).status, 200)
  assert.equal((await call('GET', `/search?cwd=${encodeURIComponent(repo)}&q=two`)).status, 200)

  assert.deepEqual(await readdir(marks), [], 'no repository-configured program ran')
  // The setup really is armed: plain git runs the clean filter and the external diff for the same repository.
  execFileSync('git', ['diff', 'HEAD'], { cwd: repo, env: SETUP_ENV, stdio: 'ignore' })
  const ran = await readdir(marks)
  assert.ok(ran.includes('clean') || ran.includes('external'), `plain git ran ${ran.join(', ') || 'nothing'}`)
})

test('status counts lines of at most 100 untracked files and lists the rest without counts', async () => {
  const repo = path.join(base, 'many')
  await mkdir(repo)
  sh(repo, 'init', '-q')
  for (let i = 0; i < 120; i++) await writeFile(path.join(repo, `f${String(i).padStart(3, '0')}.txt`), 'x\ny\n')
  const [first, second] = await Promise.all([status(repo), status(repo)])
  assert.equal(first.status, 200)
  assert.deepEqual(first.body, second.body, 'concurrent requests for one folder get the same answer')
  const files = first.body.files.filter(f => f.status === 'untracked')
  assert.equal(files.length, 120)
  assert.equal(files.filter(f => f.added === 2).length, 100)
  assert.equal(files.filter(f => f.added === null).length, 20)
  assert.equal(first.body.totals.added, 200)
})

test('an abandoned status request does not break the next one', async () => {
  const repo = path.join(base, 'many')
  await new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: helper.port, path: `/status?cwd=${encodeURIComponent(repo)}`, headers: { origin: ORIGIN, 'x-hs-helper-key': secret.toString('hex') } })
    req.on('error', () => resolve())
    req.end()
    setTimeout(() => { req.destroy(); resolve() }, 50)
  })
  const next = await status(repo)
  assert.equal(next.status, 200)
  assert.equal(next.body.files.length, 120)
})

test('a posted result keeps characters split across chunks, and the size limit counts bytes', async () => {
  const value = { text: 'héllo €uro 😀 done' }
  const bytes = Buffer.from(JSON.stringify({ session: 's', id: 'x', ok: true, value }))
  const split = bytes.indexOf(Buffer.from('€')) + 1
  const posted = await call('POST', '/browser/result', { chunks: [bytes.subarray(0, split), bytes.subarray(split)] })
  assert.equal(posted.status, 200)
  assert.deepEqual(results.at(-1).value, value)
  // 900,000 three-byte characters: under the 2,000,000 limit in characters, over it in bytes.
  const big = JSON.stringify({ session: 's', id: 'y', ok: true, value: { text: '€'.repeat(900000) } })
  assert.equal((await call('POST', '/browser/result', { body: big })).status, 413)
})

test('history: overview, a page of commits, search, a commit\'s files and diff, and blame', async () => {
  const repo = path.join(base, 'history')
  await mkdir(repo)
  const q = (route, params) => call('GET', `${route}?` + new URLSearchParams({ cwd: repo, ...params }))
  sh(repo, 'init', '-q', '-b', 'main')
  await writeFile(path.join(repo, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\n')
  sh(repo, 'add', '.')
  sh(repo, 'commit', '-q', '-m', 'First commit')
  sh(repo, 'checkout', '-q', '-b', 'side')
  await writeFile(path.join(repo, 'b.txt'), 'needle here\n')
  sh(repo, 'add', '.')
  sh(repo, 'commit', '-q', '-m', 'Add b on side')
  sh(repo, 'checkout', '-q', 'main')
  await writeFile(path.join(repo, 'a.txt'), 'one\nTWO\nthree\nfour\nfive\n')
  sh(repo, 'mv', 'a.txt', 'c.txt')
  sh(repo, 'commit', '-q', '-am', 'Rename a to c and edit')
  sh(repo, 'merge', '-q', '--no-ff', '-m', 'Merge side', 'side')
  await writeFile(path.join(repo, 'dirty.txt'), 'x\n')

  const over = (await q('/overview')).body
  assert.equal(over.repo, true)
  assert.equal(over.branch, 'main')
  assert.equal(over.changed, 1)
  assert.equal(over.last.subject, 'Merge side')

  const page = (await q('/log', { skip: '0' })).body
  assert.deepEqual(page.commits.map(c => c.subject), ['Merge side', 'Add b on side', 'Rename a to c and edit', 'First commit'])
  assert.equal(page.commits[0].parents.length, 2, 'a merge lists both parents for the graph')
  assert.ok(page.commits[0].refs.some(r => r.includes('main')))
  assert.equal(page.more, false)
  assert.deepEqual((await q('/log', { q: 'rename', by: 'message' })).body.commits.map(c => c.subject), ['Rename a to c and edit'])
  assert.equal((await q('/log', { q: 'TEST', by: 'author' })).body.commits.length, 4)
  assert.deepEqual((await q('/log', { q: 'needle', by: 'code' })).body.commits.map(c => c.subject), ['Add b on side'])
  assert.equal((await q('/log', { q: 'x', by: 'nope' })).status, 400)

  const renamed = page.commits[2]
  const detail = (await q('/commit', { hash: renamed.hash })).body
  assert.equal(detail.message, 'Rename a to c and edit')
  assert.deepEqual(detail.files.map(f => [f.path, f.status, f.from]), [['c.txt', 'renamed', 'a.txt']])
  assert.equal(detail.files[0].added, 1)
  const root = (await q('/commit', { hash: page.commits[3].hash })).body
  assert.deepEqual(root.files.map(f => [f.path, f.status, f.added]), [['a.txt', 'added', 5]], 'a first commit lists its files as added')
  const merge = (await q('/commit', { hash: page.commits[0].hash })).body
  assert.deepEqual(merge.files.map(f => f.path), ['b.txt'], 'a merge is compared with its first parent')

  const fileDiff = (await q('/commit-diff', { hash: renamed.hash, path: 'c.txt' })).body
  assert.match(fileDiff.diff, /\+TWO/)
  assert.match((await q('/commit-diff', { hash: page.commits[3].hash, path: 'a.txt' })).body.diff, /\+one/)

  const blamed = (await q('/blame', { hash: page.commits[0].hash, path: 'c.txt' })).body
  assert.deepEqual(blamed.lines.map(l => l.text), ['one', 'TWO', 'three', 'four', 'five'])
  assert.equal(blamed.commits[blamed.lines[0].hash].summary, 'First commit')
  assert.equal(blamed.commits[blamed.lines[1].hash].summary, 'Rename a to c and edit')

  assert.equal((await q('/commit', { hash: '--output=/tmp/x' })).status, 400, 'a commit id cannot be an option')
  assert.equal((await q('/blame', { hash: renamed.hash, path: '../etc/passwd' })).status, 400)
  assert.equal((await call('GET', '/overview?' + new URLSearchParams({ cwd: base }))).body.repo, false)
})

test('branches are listed, and a switch is refused while anything is uncommitted, filtered or checked out elsewhere', async () => {
  const repo = path.join(base, 'switching')
  await mkdir(repo)
  const post = body => call('POST', '/switch', { body: JSON.stringify({ cwd: repo, ...body }) })
  const current = () => sh(repo, 'branch', '--show-current').trim()
  sh(repo, 'init', '-q', '-b', 'main')
  await writeFile(path.join(repo, 'a.txt'), 'main\n')
  sh(repo, 'add', '.')
  sh(repo, 'commit', '-q', '-m', 'on main')
  sh(repo, 'branch', 'feature')
  sh(repo, 'branch', 'busy')
  sh(repo, 'worktree', 'add', '-q', path.join(base, 'switching-wt'), 'busy')

  const listed = (await call('GET', '/branches?' + new URLSearchParams({ cwd: repo }))).body
  assert.equal(listed.current, 'main')
  assert.deepEqual(listed.branches.map(b => b.name).sort(), ['busy', 'feature', 'main'])
  assert.ok(listed.branches.find(b => b.name === 'busy').elsewhere, 'a branch checked out in another worktree says where')

  assert.deepEqual((await post({ branch: 'feature' })).body, { switched: true, branch: 'feature' })
  assert.equal(current(), 'feature')
  assert.deepEqual((await post({ branch: 'feature' })).body, { switched: false, branch: 'feature' }, 'already there')

  await writeFile(path.join(repo, 'a.txt'), 'edited\n')
  const dirty = await post({ branch: 'main' })
  assert.equal(dirty.status, 409)
  assert.match(dirty.body.error, /1 uncommitted file/)
  sh(repo, 'checkout', '--', 'a.txt')
  await writeFile(path.join(repo, 'new.txt'), 'x\n')
  assert.equal((await post({ branch: 'main' })).status, 409, 'an untracked file counts as uncommitted')
  await rm(path.join(repo, 'new.txt'))

  assert.equal((await post({ branch: 'busy' })).status, 409)
  assert.match((await post({ branch: 'busy' })).body.error, /another worktree/)
  assert.equal((await post({ branch: 'nope' })).status, 400)
  assert.equal((await post({ branch: '--orphan=x' })).status, 400)

  // A configured filter driver alone (Git LFS sets one globally) does not stop a switch; a repository
  // whose attributes ask for one does.
  sh(repo, 'config', 'filter.lfs.smudge', 'git-lfs smudge -- %f')
  assert.deepEqual((await post({ branch: 'main' })).body, { switched: true, branch: 'main' })
  await writeFile(path.join(repo, '.gitattributes'), '*.bin filter=lfs\n')
  sh(repo, 'add', '.gitattributes')
  sh(repo, 'commit', '-q', '-m', 'use a filter')
  const filtered = await post({ branch: 'feature' })
  assert.equal(filtered.status, 409)
  assert.match(filtered.body.error, /content filters/)
  assert.equal(current(), 'main')
  const form = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: helper.port, path: '/switch', method: 'POST',
      headers: { origin: ORIGIN, 'x-hs-helper-key': secret.toString('hex'), 'content-type': 'application/x-www-form-urlencoded' } }, (res) => { res.resume(); resolve(res.statusCode) })
    req.on('error', reject)
    req.end('branch=feature')
  })
  assert.equal(form, 415, 'only JSON, so a form on another site cannot post it')
})
