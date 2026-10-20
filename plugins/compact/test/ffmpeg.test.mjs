import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FFMPEG_BUILDS, applyFfmpeg, buildFor, createFfmpeg, findOnPath, installCommands, licenceOf, shellQuote } from '../ffmpeg.js'

test('a pinned build for each supported platform, none for Windows', () => {
  assert.deepEqual(Object.keys(FFMPEG_BUILDS).sort(), ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'])
  assert.equal(buildFor('win32', 'x64'), undefined)
  for (const build of Object.values(FFMPEG_BUILDS)) {
    assert.match(build.dir, /^(macos|linux)\/(arm64|amd64)\/\d+_9\.0\.2$/)
    for (const tool of ['ffmpeg', 'ffprobe']) {
      assert.match(build[tool].sha256, /^[0-9a-f]{64}$/)
      assert.ok(build[tool].bytes > 20e6 && build[tool].bytes < 40e6)
    }
  }
})

test('the download names the pinned files on the build server', () => {
  const { download, unpack } = installCommands(FFMPEG_BUILDS['darwin-arm64'])
  assert.match(download, /'https:\/\/ffmpeg\.martin-riedl\.de\/download\/macos\/arm64\/1789931890_9\.0\.2\/ffmpeg\.zip'/)
  assert.match(download, /ffprobe\.zip'/)
  assert.match(unpack, /\.\/ffmpeg -hide_banner -version$/)
})

test('the licence is read from the configuration line', () => {
  assert.equal(licenceOf('configuration: --enable-gpl --enable-version3 --enable-libx264'), 'GPL v3 or later')
  assert.equal(licenceOf('configuration: --enable-gpl'), 'GPL v2 or later')
  assert.equal(licenceOf('configuration: --disable-debug'), 'LGPL v2.1 or later')
  assert.equal(licenceOf('configuration: --enable-gpl --enable-nonfree'), 'nonfree (not redistributable)')
})

test('shell quoting survives quotes and spaces', () => {
  assert.equal(execFileSync('sh', ['-c', `printf %s ${shellQuote("it's a 'clip'.mp4")}`], { encoding: 'utf8' }), "it's a 'clip'.mp4")
})

/** A fake ffmpeg zip pair, a build pinning them, and a fake command runner that serves them instead of curl. */
async function fixture({ corrupt = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hs-ffmpeg-'))
  const stage = path.join(dir, 'stage')
  await mkdir(stage)
  const build = { label: 'Test', dir: 'test/arm64/1_9.0.2' }
  for (const tool of ['ffmpeg', 'ffprobe']) {
    await writeFile(path.join(stage, tool), `#!/bin/sh\necho "${tool} version 9.0.2 Copyright"\necho "configuration: --enable-gpl --enable-version3"\n`)
    await chmod(path.join(stage, tool), 0o755)
    execFileSync('python3', ['-m', 'zipfile', '-c', `${tool}.zip`, tool], { cwd: stage })
    const body = await readFile(path.join(stage, `${tool}.zip`))
    build[tool] = { bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }
  }
  if (corrupt) build.ffprobe.sha256 = '0'.repeat(64)
  const commands = []
  const shell = {
    resolve: request => request,
    async execute(request) {
      commands.push(request)
      let result
      if (request.command.startsWith('curl')) {
        for (const tool of ['ffmpeg', 'ffprobe']) await copyFile(path.join(stage, `${tool}.zip`), path.join(request.workdir, `${tool}.zip`))
        result = { exitCode: 0, stdout: { text: '' }, stderr: { text: '' } }
      } else {
        const stdout = execFileSync('sh', ['-c', request.command], { cwd: request.workdir, encoding: 'utf8' })
        result = { exitCode: 0, stdout: { text: stdout }, stderr: { text: '' } }
      }
      return { result: async () => result }
    },
  }
  return { dir, build, shell, commands }
}

function context({ shell, network, answer }) {
  const asked = []
  const services = {
    shell,
    sandboxPolicy: { resolve: ({ mode } = {}) => ({ mode: mode ?? 'workspace-write', workspaceRoot: '/work', extraWritable: ['/x'], ...network ? { network } : {} }) },
    userQuestions: { ask: async request => { asked.push(request); return { answers: [{ id: request.questions[0].id, selected: [answer] }] } } },
  }
  return { ctx: { get: name => services[name] }, asked }
}

const agent = id => ({ session: { id, header: { cwd: '/work' } } })

test('uses the person\'s own ffmpeg and ffprobe without asking', async () => {
  const { dir, build, shell } = await fixture()
  const own = path.join(dir, 'own')
  await mkdir(own)
  for (const tool of ['ffmpeg', 'ffprobe']) { await writeFile(path.join(own, tool), ''); await chmod(path.join(own, tool), 0o755) }
  const saved = process.env.PATH
  process.env.PATH = `${own}${path.delimiter}${saved}`
  try {
    const { ctx, asked } = context({ shell, answer: 'Download' })
    const found = await createFfmpeg(ctx, { home: dir, build }).ensure(agent('s1'))
    assert.equal(found.source, 'system')
    assert.equal(found.ffmpeg, path.join(own, 'ffmpeg'))
    assert.equal(asked.length, 0)
  } finally {
    process.env.PATH = saved
    await rm(dir, { recursive: true, force: true })
  }
})

test('asks, downloads into a sandboxed temporary folder, checks the hashes, installs and puts it on PATH', async () => {
  const { dir, build, shell, commands } = await fixture()
  const saved = process.env.PATH
  process.env.PATH = '/usr/bin:/bin'
  try {
    const { ctx, asked } = context({ shell, answer: 'Download' })
    const ffmpeg = createFfmpeg(ctx, { home: dir, build })
    const found = await ffmpeg.ensure(agent('s1'))
    assert.equal(asked.length, 1)
    assert.match(asked[0].questions[0].question, /ffmpeg\.martin-riedl\.de/)
    assert.equal(found.source, 'studio')
    assert.equal(found.installed, true)
    assert.equal(found.ffmpeg, path.join(dir, 'harness-studio', 'ffmpeg', '9.0.2', 'ffmpeg'))
    assert.equal(commands.length, 2)
    for (const command of commands) {
      assert.equal(command.sandboxPolicy.mode, 'workspace-write')
      assert.equal(command.sandboxPolicy.workspaceRoot, command.workdir)
      assert.equal(command.sandboxPolicy.extraWritable, undefined)
      assert.match(path.basename(command.workdir), /^9\.0\.2\.installing-/)
    }
    const ready = JSON.parse(await readFile(path.join(ffmpeg.bin, '.ready'), 'utf8'))
    assert.equal(ready.licence, 'GPL v3 or later')
    assert.match(ready.build, /^ffmpeg version 9\.0\.2/)
    assert.deepEqual((await readdir(path.join(dir, 'harness-studio', 'ffmpeg'))), ['9.0.2'])
    assert.ok(process.env.PATH.endsWith(`${path.delimiter}${ffmpeg.bin}`), 'added at the end of PATH')
    assert.equal(await findOnPath('ffprobe'), path.join(ffmpeg.bin, 'ffprobe'))
    // Installed: no second question.
    assert.equal((await ffmpeg.ensure(agent('s2'))).source, 'studio')
    assert.equal(asked.length, 1)
  } finally {
    process.env.PATH = saved
    await rm(dir, { recursive: true, force: true })
  }
})

test('a download that does not match the pinned hash installs nothing', async () => {
  const { dir, build, shell } = await fixture({ corrupt: true })
  const saved = process.env.PATH
  process.env.PATH = '/usr/bin:/bin'
  try {
    const { ctx } = context({ shell, answer: 'Download' })
    const ffmpeg = createFfmpeg(ctx, { home: dir, build })
    await assert.rejects(ffmpeg.ensure(agent('s1')), /does not match the pinned build/)
    assert.deepEqual(await readdir(path.join(dir, 'harness-studio', 'ffmpeg')), [])
    assert.equal(await ffmpeg.installed(), false)
  } finally {
    process.env.PATH = saved
    await rm(dir, { recursive: true, force: true })
  }
})

test('"Not now" is remembered for the session, and no network means no download', async () => {
  const { dir, build, shell, commands } = await fixture()
  const saved = process.env.PATH
  process.env.PATH = '/usr/bin:/bin'
  try {
    const declined = context({ shell, answer: 'Not now' })
    const ffmpeg = createFfmpeg(declined.ctx, { home: dir, build })
    await assert.rejects(ffmpeg.ensure(agent('s1')), /chose not to download/)
    await assert.rejects(ffmpeg.ensure(agent('s1')), /chose not to download/)
    assert.equal(declined.asked.length, 1)
    assert.equal(commands.length, 0)
    const offline = context({ shell, answer: 'Download', network: { mode: 'off' } })
    await assert.rejects(createFfmpeg(offline.ctx, { home: dir, build }).ensure(agent('s1')), /no network/)
    const listed = context({ shell, answer: 'Download', network: { mode: 'allowlist', hosts: ['github.com'] } })
    await assert.rejects(createFfmpeg(listed.ctx, { home: dir, build }).ensure(agent('s1')), /ffmpeg\.martin-riedl\.de is not one/)
    assert.equal(commands.length, 0)
  } finally {
    process.env.PATH = saved
    await rm(dir, { recursive: true, force: true })
  }
})

test('registers ffmpeg_install and puts an installed copy on PATH until the plugin unloads', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hs-ffmpeg-'))
  const bin = path.join(dir, 'harness-studio', 'ffmpeg', '9.0.2')
  await mkdir(bin, { recursive: true })
  await writeFile(path.join(bin, 'ffmpeg'), '')
  await chmod(path.join(bin, 'ffmpeg'), 0o755)
  await writeFile(path.join(bin, '.ready'), '{}')
  const saved = process.env.PATH
  const registered = []
  const disposers = []
  try {
    const ctx = {
      get: () => undefined,
      effect: (make) => { disposers.push(make()) },
      inject: (deps, fn) => { assert.deepEqual(deps, ['tools']); fn({ effect: make => make(), tools: { register: t => { registered.push(t); return () => {} } } }) },
    }
    applyFfmpeg(ctx, { home: dir })
    assert.deepEqual(registered.map(t => t.name), ['ffmpeg_install'])
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.ok(process.env.PATH.split(path.delimiter).includes(bin))
    for (const dispose of disposers) dispose()
    assert.ok(!process.env.PATH.split(path.delimiter).includes(bin))
    assert.ok((await stat(bin)).isDirectory())
  } finally {
    process.env.PATH = saved
    await rm(dir, { recursive: true, force: true })
  }
})
