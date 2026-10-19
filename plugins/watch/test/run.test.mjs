// The check runners against the real operating system: a listening port and real file events. The command
// runner is Harness's own; here a stand-in records what it is asked to run.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import test from 'node:test'
import { confinePaths, probePort, runCommand, watchFiles } from '../run.js'

test('probePort sees a port come up and go down on this computer', async () => {
  const server = net.createServer(socket => socket.end())
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  assert.deepEqual(await probePort({ port, host: 'localhost' }), { exitCode: 0, output: 'up' })
  assert.deepEqual(await probePort({ port, host: '127.0.0.1' }), { exitCode: 0, output: 'up' })
  await new Promise(resolve => server.close(resolve))
  assert.deepEqual(await probePort({ port, host: 'localhost' }), { exitCode: 1, output: 'down' })
})

test('runCommand passes the session folder, time limit and sandbox policy to Harness\'s runner', async () => {
  const seen = []
  const shell = {
    resolve: request => ({ ...request, resolved: true }),
    execute: async spec => {
      seen.push(spec)
      return { result: async () => ({ exitCode: 2, timedOut: false, stdout: { text: 'out\n\n' }, stderr: { text: 'warn\n' } }) }
    },
  }
  const policy = { mode: 'read-only', workspaceRoot: '/w', network: { mode: 'off' } }
  const result = await runCommand(shell, { command: 'lint', timeout: 30 }, { cwd: '/w', sandboxPolicy: policy })
  assert.deepEqual(result, { exitCode: 2, output: 'out\n[stderr]\nwarn' })
  assert.equal(seen[0].workdir, '/w')
  assert.equal(seen[0].timeoutMs, 30_000)
  assert.equal(seen[0].sandboxPolicy, policy)
  assert.equal(seen[0].resolved, true)

  const timedOut = await runCommand({ resolve: r => r, execute: async () => ({ result: async () => ({ exitCode: null, timedOut: true, stdout: { text: '' }, stderr: { text: '' } }) }) }, { command: 'x', timeout: 5 }, { cwd: '/w' })
  assert.equal(timedOut.exitCode, null)
  assert.match(timedOut.error, /timed out after 5s/)
  const refused = await runCommand({ resolve: r => r, execute: async () => { throw new Error('sandbox mode "read-only" is requested but no sandbox backend is usable\nmore') } }, { command: 'x', timeout: 5 }, { cwd: '/w' })
  assert.match(refused.error, /no sandbox backend/)
  assert.doesNotMatch(refused.error, /more/)
})

test('watchFiles reports a quiet batch of changed paths and stops when asked', async t => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hs-watch-files-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(path.join(dir, 'src'))
  const batches = []
  const stop = await watchFiles([dir], paths => batches.push(paths), { quietMs: 150 })
  await sleep(100)
  await writeFile(path.join(dir, 'src', 'a.js'), 'one')
  await writeFile(path.join(dir, 'b.txt'), 'two')
  await sleep(600)
  assert.ok(batches.length >= 1, 'a batch arrived')
  const all = new Set(batches.flat())
  assert.ok(all.has(path.join(dir, 'src', 'a.js')), [...all].join(', '))
  assert.ok(all.has(path.join(dir, 'b.txt')), [...all].join(', '))
  stop()
  const count = batches.length
  await writeFile(path.join(dir, 'b.txt'), 'three')
  await sleep(400)
  assert.equal(batches.length, count, 'nothing after stopping')
  await assert.rejects(watchFiles([path.join(dir, 'missing')], () => {}), /does not exist/)
})

test('a burst of ignored or unmatched paths does not crowd a real change out of the batch', async t => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hs-watch-burst-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(path.join(dir, 'node_modules', 'pkg'), { recursive: true })
  await mkdir(path.join(dir, 'src'))
  const batches = []
  const stop = await watchFiles([dir], paths => batches.push(paths), { quietMs: 300, accept: file => !file.includes('node_modules') && !file.endsWith('.log') })
  t.after(stop)
  await sleep(100)
  for (let i = 0; i < 300; i++) await writeFile(path.join(dir, 'node_modules', 'pkg', `f${i}.js`), 'x')
  for (let i = 0; i < 50; i++) await writeFile(path.join(dir, `build${i}.log`), 'x')
  await writeFile(path.join(dir, 'src', 'real.js'), 'change')
  await sleep(1000)
  const all = batches.flat()
  assert.ok(all.includes(path.join(dir, 'src', 'real.js')), all.slice(0, 5).join(', '))
  assert.ok(all.every(file => !file.includes('node_modules') && !file.endsWith('.log')))
})

test('where folders are watched one by one, ignored folders are skipped, new folders are followed, and the limit is noted', async t => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hs-watch-linux-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(path.join(dir, 'src', 'deep'), { recursive: true })
  for (let i = 0; i < 10; i++) await mkdir(path.join(dir, 'node_modules', `pkg${i}`, 'lib'), { recursive: true })
  await mkdir(path.join(dir, '.git', 'objects', 'ab'), { recursive: true })
  const notes = []
  const batches = []
  // root, src and src/deep: three folders, so a limit of three is not reached when ignored folders are skipped.
  const stop = await watchFiles([dir], paths => batches.push(paths), { quietMs: 150, platform: 'linux', maxFolders: 3, onNote: note => notes.push(note) })
  t.after(stop)
  assert.deepEqual(notes, [])
  await sleep(100)
  await writeFile(path.join(dir, 'src', 'deep', 'a.js'), 'x')
  await sleep(500)
  assert.ok(batches.flat().includes(path.join(dir, 'src', 'deep', 'a.js')), batches.flat().join(', '))
  stop()

  // A folder made after the watch starts is watched too.
  const roomy = await watchFiles([dir], paths => batches.push(paths), { quietMs: 150, platform: 'linux', onNote: note => notes.push(note) })
  t.after(roomy)
  await sleep(100)
  await mkdir(path.join(dir, 'src', 'new'))
  await sleep(300)
  await writeFile(path.join(dir, 'src', 'new', 'b.js'), 'x')
  await sleep(500)
  assert.ok(batches.flat().includes(path.join(dir, 'src', 'new', 'b.js')), batches.flat().join(', '))
  roomy()

  // Past the limit, a note says so.
  const tight = await watchFiles([dir], () => {}, { platform: 'linux', maxFolders: 2, onNote: note => notes.push(note) })
  tight()
  assert.equal(notes.length, 1)
  assert.match(notes[0], /Only the first 2 folders are watched/)
})

test('confinePaths keeps a files watch inside the session folder and away from read-denied paths', async t => {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hs-watch-confine-')))
  t.after(() => rm(base, { recursive: true, force: true }))
  const work = path.join(base, 'work')
  const secrets = path.join(base, 'home', '.ssh')
  await mkdir(path.join(work, 'src'), { recursive: true })
  await mkdir(path.join(work, 'keys'), { recursive: true })
  await mkdir(secrets, { recursive: true })
  await symlink(secrets, path.join(work, 'ssh-link'))
  assert.equal(await confinePaths([work, path.join(work, 'src')], { root: work }), work)
  await assert.rejects(confinePaths([secrets], { root: work }), /outside this session's folder/)
  await assert.rejects(confinePaths([path.join(work, 'ssh-link')], { root: work }), /outside this session's folder/)
  await assert.rejects(confinePaths([path.join(work, 'src', '..', '..')], { root: work }), /outside this session's folder/)
  await assert.rejects(confinePaths([path.join(work, 'missing')], { root: work }), /does not exist/)
  const deny = [path.join(work, 'keys')]
  await assert.rejects(confinePaths([path.join(work, 'keys')], { root: work, deny }), /keeps from being read/)
  await assert.rejects(confinePaths([work], { root: work, deny }), /keeps from being read/)
  assert.equal(await confinePaths([path.join(work, 'src')], { root: work, deny }), work)
})
