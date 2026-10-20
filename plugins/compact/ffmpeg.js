/**
 * ffmpeg on first use. When the agent needs ffmpeg and neither ffmpeg nor ffprobe is on the command search path,
 * the person is asked once per session, on Harness's question card, whether to download a pinned build:
 * FFmpeg 9.0.2 release builds from Martin Riedl's build server (ffmpeg.martin-riedl.de), static, GPL, one zip
 * for ffmpeg and one for ffprobe per platform (macOS arm64 and x64, Linux glibc arm64 and x64).
 *
 * The download and the unpacking run through Harness's own command runner, sandboxed like the agent's commands
 * and under the session's network setting, with a new temporary folder inside
 * `<harness home>/harness-studio/ffmpeg/` as the only folder they may write. Between the two, this process checks
 * each zip's size and SHA-256 against the values pinned here (the server publishes the same hashes beside each
 * file), and the folder is renamed into place only after `ffmpeg -version` runs. Settings → Data lists the folder,
 * so the person can delete it; the next use asks again.
 *
 * The installed folder is added to the end of this process's PATH, which every command the agent runs inherits,
 * so an ffmpeg the person installed themselves still comes first.
 */
import { createHash, randomBytes } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const FFMPEG_VERSION = '9.0.2'
export const FFMPEG_HOST = 'ffmpeg.martin-riedl.de'
export const FFMPEG_SOURCE = 'https://git.martin-riedl.de/ffmpeg/build-script'
const DOWNLOAD = `https://${FFMPEG_HOST}/download`

/** The pinned zips per platform, with the sizes and SHA-256 hashes the server published on 2026-09-20. */
export const FFMPEG_BUILDS = {
  'darwin-arm64': {
    label: 'macOS (Apple silicon)',
    dir: 'macos/arm64/1789931890_9.0.2',
    ffmpeg: { bytes: 28395699, sha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924' },
    ffprobe: { bytes: 28317701, sha256: 'fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6' },
  },
  'darwin-x64': {
    label: 'macOS (Intel)',
    dir: 'macos/amd64/1789931006_9.0.2',
    ffmpeg: { bytes: 33816391, sha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4' },
    ffprobe: { bytes: 33719233, sha256: '2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd' },
  },
  'linux-arm64': {
    label: 'Linux (arm64)',
    dir: 'linux/arm64/1789931697_9.0.2',
    ffmpeg: { bytes: 28753826, sha256: '93a76ae90db5474eecdf951a729857c64f3de23567228d6a7d5e6e8e3cd1021b' },
    ffprobe: { bytes: 28655683, sha256: 'bcbe80fb741c180083327afaf5434812e006b33cacde2016b9aeaf6936128330' },
  },
  'linux-x64': {
    label: 'Linux (x64)',
    dir: 'linux/amd64/1789931100_9.0.2',
    ffmpeg: { bytes: 33326445, sha256: 'fa8ecf4abbd290d98f7d188b8649cc6b391ae209a98452be955a15aab1909d7f' },
    ffprobe: { bytes: 33223234, sha256: '3f428c49070be3d24ec338602b76d412e401ffcb8a5641ef0e729181a232fc32' },
  },
}

const TOOLS = ['ffmpeg', 'ffprobe']
const READY = '.ready'
const DOWNLOAD_TIMEOUT_MS = 20 * 60_000
const UNPACK_TIMEOUT_MS = 2 * 60_000
const QUESTION_ID = 'ffmpeg-download'
const ACCEPT = 'Download'
const DECLINE = 'Not now'

/** The pinned build for a platform, or undefined where none is offered (Windows, Linux on other machines). */
export function buildFor(platform = process.platform, arch = process.arch) {
  return FFMPEG_BUILDS[`${platform}-${arch}`]
}

/** A string as one single-quoted shell word. */
export const shellQuote = text => `'${String(text).replace(/'/g, `'\\''`)}'`

const megabytes = bytes => `${(bytes / 1e6).toFixed(1)} MB`

/** Total download size of a build's two zips. */
export const downloadBytes = build => build.ffmpeg.bytes + build.ffprobe.bytes

/** The download and unpack commands for one build, run in the temporary install folder. */
export function installCommands(build) {
  const download = TOOLS.map(tool => `curl -fsSL --retry 2 --connect-timeout 20 -o ${tool}.zip ${shellQuote(`${DOWNLOAD}/${build.dir}/${tool}.zip`)}`).join(' && ')
  // unzip is missing on some Linux installs; Python's zipfile module unpacks the same archive.
  const unzip = tool => `{ if command -v unzip >/dev/null 2>&1; then unzip -o -q ${tool}.zip; else python3 -m zipfile -e ${tool}.zip .; fi; }`
  const unpack = [
    ...TOOLS.map(unzip),
    `chmod 755 ${TOOLS.join(' ')}`,
    `rm -f ${TOOLS.map(tool => `${tool}.zip`).join(' ')}`,
    './ffmpeg -hide_banner -version',
  ].join(' && ')
  return { download, unpack }
}

/** SHA-256 of a file, streamed. */
export async function sha256File(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** The licence FFmpeg's configuration line implies. */
export function licenceOf(versionText) {
  const configuration = /configuration:(.*)/.exec(versionText)?.[1] ?? ''
  if (configuration.includes('--enable-nonfree')) return 'nonfree (not redistributable)'
  if (configuration.includes('--enable-gpl')) return configuration.includes('--enable-version3') ? 'GPL v3 or later' : 'GPL v2 or later'
  return configuration.includes('--enable-version3') ? 'LGPL v3 or later' : 'LGPL v2.1 or later'
}

async function executable(file) {
  try {
    await access(file, constants.X_OK)
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

/** The first `name` on a PATH value, skipping `skip`. */
export async function findOnPath(name, pathValue = process.env.PATH ?? '', skip = undefined) {
  for (const dir of pathValue.split(path.delimiter)) {
    if (dir === '' || (skip !== undefined && path.resolve(dir) === path.resolve(skip))) continue
    const file = path.join(dir, name)
    if (await executable(file)) return file
  }
  return undefined
}

const lastLines = (text, n = 12) => String(text ?? '').trim().split('\n').slice(-n).join('\n').slice(0, 2000)

/**
 * ffmpeg on first use.
 * @param {object} ctx - the Host plugin context.
 * @param {{ home: string, platform?: string, arch?: string, build?: object }} options - `build` replaces the pinned build (tests).
 */
export function createFfmpeg(ctx, { home, platform = process.platform, arch = process.arch, build = buildFor(platform, arch) }) {
  const root = path.join(home, 'harness-studio', 'ffmpeg')
  const bin = path.join(root, FFMPEG_VERSION)
  /** Sessions whose person answered "Not now"; they are not asked again until the app restarts. */
  const declined = new Set()
  let installing

  async function installed() {
    return (await stat(path.join(bin, READY)).then(() => true, () => false)) && await executable(path.join(bin, 'ffmpeg'))
  }

  /** The ffmpeg and ffprobe commands will run: the person's own when both are on PATH, otherwise the installed ones. */
  async function find() {
    const ffmpeg = await findOnPath('ffmpeg', process.env.PATH, bin)
    const ffprobe = await findOnPath('ffprobe', process.env.PATH, bin)
    if (ffmpeg !== undefined && ffprobe !== undefined) return { ffmpeg, ffprobe, source: 'system' }
    if (await installed()) return { ffmpeg: path.join(bin, 'ffmpeg'), ffprobe: path.join(bin, 'ffprobe'), source: 'studio' }
    return undefined
  }

  /** Put the installed folder at the end of PATH; returns the undo. */
  function addToPath() {
    const entries = (process.env.PATH ?? '').split(path.delimiter)
    if (entries.includes(bin)) return () => {}
    process.env.PATH = [...entries.filter(Boolean), bin].join(path.delimiter)
    return () => {
      process.env.PATH = (process.env.PATH ?? '').split(path.delimiter).filter(entry => entry !== bin).join(path.delimiter)
    }
  }

  async function run(shell, request) {
    const result = await (await shell.execute(shell.resolve(request))).result()
    return { exitCode: result.timedOut ? null : result.exitCode, timedOut: result.timedOut === true, stdout: result.stdout?.text ?? '', stderr: result.stderr?.text ?? '' }
  }

  /** The session's command sandbox, narrowed to writing `folder` only. */
  function policyFor(agent, folder) {
    const policies = ctx.get('sandboxPolicy')
    const policy = policies?.resolve({ session: agent.session })
    if (policy === undefined) return {}
    // Full access would also lift the hidden secret files, so it is narrowed like any other mode.
    const base = policy.mode === 'danger-full-access' ? policies.resolve({ session: agent.session, mode: 'workspace-write' }) : policy
    return { sandboxPolicy: { ...base, mode: 'workspace-write', workspaceRoot: folder, extraWritable: undefined } }
  }

  async function ask(agent, signal) {
    const questions = ctx.get('userQuestions')
    if (!questions) throw new Error('ffmpeg is not installed and this Harness cannot ask the user to download it; ask them to install ffmpeg themselves.')
    const answer = await questions.ask({
      agent,
      signal,
      questions: [{
        id: QUESTION_ID,
        header: 'ffmpeg',
        question: `Download ffmpeg and ffprobe ${FFMPEG_VERSION} for ${build.label} from ${FFMPEG_HOST}? ${megabytes(downloadBytes(build))} to download, about ${Math.round(downloadBytes(build) * 2.3 / 1e6)} MB once unpacked. They are checked against their published SHA-256 and kept in Harness Studio's data folder, where Settings → Data lists them. Licence: GPL; source at ffmpeg.org and ${FFMPEG_SOURCE}.`,
        options: [
          { label: ACCEPT, description: `Download ${megabytes(downloadBytes(build))} now.` },
          { label: DECLINE, description: 'Do not download; this session will not ask again.' },
        ],
      }],
    })
    const found = answer?.answers?.find(a => a.id === QUESTION_ID)
    return found?.selected?.includes(ACCEPT) === true
  }

  async function install(agent, signal) {
    const shell = ctx.get('shell')
    if (!shell) throw new Error('Harness\'s command runner is not available, so ffmpeg cannot be installed.')
    const policy = ctx.get('sandboxPolicy')?.resolve({ session: agent.session })
    if (policy?.network?.mode === 'off') throw new Error(`Commands in this session have no network, so ffmpeg cannot be downloaded from ${FFMPEG_HOST}. Change the network setting for commands, or install ffmpeg yourself.`)
    if (policy?.network?.mode === 'allowlist' && !policy.network.hosts.some(host => host === FFMPEG_HOST || FFMPEG_HOST.endsWith(`.${host}`))) {
      throw new Error(`Commands in this session may only reach listed sites, and ${FFMPEG_HOST} is not one. Add it under Settings → Permissions → Network for commands, or install ffmpeg yourself.`)
    }
    await mkdir(root, { recursive: true })
    const temp = path.join(root, `${FFMPEG_VERSION}.installing-${randomBytes(4).toString('hex')}`)
    await mkdir(temp)
    try {
      const { download, unpack } = installCommands(build)
      const fetched = await run(shell, { command: download, workdir: temp, timeoutMs: DOWNLOAD_TIMEOUT_MS, stdoutMaxBytes: 16 * 1024, signal, ...policyFor(agent, temp) })
      if (fetched.exitCode !== 0) {
        const reason = fetched.timedOut ? 'it took longer than 20 minutes' : `curl exited with ${fetched.exitCode}`
        throw new Error(`ffmpeg could not be downloaded from ${FFMPEG_HOST} (${reason}).\n${lastLines(fetched.stderr || fetched.stdout)}`)
      }
      for (const tool of TOOLS) {
        const file = path.join(temp, `${tool}.zip`)
        const size = (await stat(file)).size
        const digest = await sha256File(file)
        if (size !== build[tool].bytes || digest !== build[tool].sha256) {
          throw new Error(`The downloaded ${tool}.zip does not match the pinned build (${size} bytes, SHA-256 ${digest}); nothing was installed.`)
        }
      }
      const unpacked = await run(shell, { command: unpack, workdir: temp, timeoutMs: UNPACK_TIMEOUT_MS, stdoutMaxBytes: 64 * 1024, signal, ...policyFor(agent, temp) })
      if (unpacked.exitCode !== 0) throw new Error(`ffmpeg was downloaded but could not be unpacked or run.\n${lastLines(unpacked.stderr || unpacked.stdout)}`)
      const versionLine = unpacked.stdout.split('\n').find(line => line.startsWith('ffmpeg version')) ?? `ffmpeg version ${FFMPEG_VERSION}`
      await writeFile(path.join(temp, READY), `${JSON.stringify({
        version: FFMPEG_VERSION, build: versionLine.trim(), licence: licenceOf(unpacked.stdout), source: `${DOWNLOAD}/${build.dir}/`, buildScript: FFMPEG_SOURCE, installedAt: new Date().toISOString(),
      }, null, 2)}\n`)
      await rm(bin, { recursive: true, force: true })
      await rename(temp, bin)
    } catch (error) {
      await rm(temp, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  /**
   * ffmpeg and ffprobe for the agent's session, asking to download them when neither the person's own nor an
   * installed copy is there.
   * @returns {{ ffmpeg: string, ffprobe: string, source: 'system'|'studio', installed?: boolean }}
   */
  async function ensure(agent, signal) {
    const found = await find()
    if (found) return found
    if (build === undefined) throw new Error(`Harness Studio offers no ffmpeg download for ${platform} on ${arch}; install ffmpeg and ffprobe yourself.`)
    const sessionId = agent.session?.id ?? agent.session?.header?.id
    if (declined.has(sessionId)) throw new Error('The user chose not to download ffmpeg in this session. Do not ask again; work without it or tell the user how to install it themselves.')
    if (!installing) {
      installing = (async () => {
        if (!await ask(agent, signal)) {
          declined.add(sessionId)
          return false
        }
        await install(agent, signal)
        addToPath()
        return true
      })().finally(() => { installing = undefined })
    }
    if (!await installing) throw new Error('The user chose not to download ffmpeg. Do not ask again in this session; work without it or tell the user how to install it themselves.')
    return { ...await find(), installed: true }
  }

  async function details() {
    try {
      return JSON.parse(await readFile(path.join(bin, READY), 'utf8'))
    } catch {
      return undefined
    }
  }

  const tool = {
    name: 'ffmpeg_install',
    description: 'Make ffmpeg and ffprobe available to your commands. Call it when a task needs ffmpeg or ffprobe and `command -v ffmpeg` finds none; do not install ffmpeg any other way. If the user\'s own ffmpeg is installed it is used; otherwise the user is asked once whether to download a pinned build (about 57–68 MB) into Harness Studio\'s data folder, after which `ffmpeg` and `ffprobe` work in your commands.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_args, exec) {
      if (!exec.agent) throw new Error('ffmpeg_install needs a session')
      const found = await ensure(exec.agent, exec.signal)
      if (found.source === 'system') return `ffmpeg is already installed: ${found.ffmpeg} and ${found.ffprobe}. Use \`ffmpeg\` and \`ffprobe\` in your commands.`
      const info = await details()
      return `${found.installed ? 'Downloaded and installed' : 'Already installed:'} ${info?.build ?? `ffmpeg ${FFMPEG_VERSION}`} (${info?.licence ?? 'GPL'}) in ${bin}. \`ffmpeg\` and \`ffprobe\` now work in your commands.`
    },
  }

  return { root, bin, build, find, ensure, installed, addToPath, details, tool }
}

/**
 * Register ffmpeg_install and put an installed ffmpeg on PATH.
 * @param {object} ctx - the Host plugin context.
 * @param {{ home?: string }} options
 */
export function applyFfmpeg(ctx, { home = path.join(os.homedir(), '.dsh') } = {}) {
  const ffmpeg = createFfmpeg(ctx, { home })
  if (typeof ctx.effect === 'function') {
    let undo = () => {}
    ffmpeg.installed().then(yes => { if (yes) undo = ffmpeg.addToPath() }, () => {})
    ctx.effect(() => () => undo(), 'ffmpeg on PATH')
  }
  if (typeof ctx.inject === 'function') {
    const text = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] }
    ctx.inject(['tools'], (scope) => {
      scope.effect(() => scope.tools.register({ output: text, ...ffmpeg.tool }), 'tool ffmpeg_install')
    })
  }
  return ffmpeg
}
