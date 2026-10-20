/**
 * Host half of Compact. The Client module owns all styling and zoom; this half saves the "Network for
 * commands" setting from Settings → Permissions, in `<harness home>/harness-studio/network.json`, which the
 * sandbox policy reads before each command (desktop patch 16). The client reaches it through Harness's
 * authenticated Remote channel (`harnessStudioSettings/call`). It also asks before web fetch or a page
 * the agent opens reaches a site that is not on that list (site-approval.js), keeps long turns and repeated results
 * in check (turn-guard.js), and lists where Harness Studio
 * keeps your data for Settings → Data (data.js), downloads ffmpeg on first use (ffmpeg.js), transcribes audio and
 * video files with Harness's local speech recognizer (transcribe.js), and on the first start writes Harness Studio's
 * default reply style as the person's global AGENTS.md when they have none (default-instructions.js).
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { applySiteApproval, createSiteList } from './site-approval.js'
import { createDataInventory } from './data.js'
import { applyComputerUse } from './computer-use.js'
import { writeDefaultInstructions } from './default-instructions.js'
import { applyTurnGuard, createTurnBudgetSetting } from './turn-guard.js'
import { applyCloudLoginGuard, createCloudLoginsSetting } from './cloud-logins.js'
import { applyStudioSkills } from './studio-skills.js'
import { applyFfmpeg } from './ffmpeg.js'
import { applyTranscribe } from './transcribe.js'

export const name = 'harness-studio-compact'

export const SETTINGS_SERVICE = 'harnessStudioSettings'
const REMOTE_METHODS_MARKER = '@deepseek-ai/dsh-typert-protocol/remote-methods'
const NETWORK_MODES = ['on', 'off', 'allowlist']
const MAX_HOSTS = 200

/**
 * Read and write the network setting file.
 * @param {string} file - absolute path of network.json.
 */
export function createNetworkSetting(file) {
  /**
   * Saves run one at a time, in the order they were asked for: interleaved writes could leave a broken file,
   * which the sandbox would read as the default network On.
   */
  let saving = Promise.resolve()
  return {
    async get() {
      try {
        const saved = JSON.parse(await readFile(file, 'utf8'))
        return {
          network: NETWORK_MODES.includes(saved.network) ? saved.network : 'on',
          allowedHosts: Array.isArray(saved.allowedHosts) ? saved.allowedHosts.filter(h => typeof h === 'string') : [],
          saved: true,
        }
      } catch {
        return { network: 'on', allowedHosts: [], saved: false }
      }
    },
    async set({ network, allowedHosts }) {
      if (!NETWORK_MODES.includes(network)) throw new Error(`network must be one of ${NETWORK_MODES.join(', ')}`)
      if (!Array.isArray(allowedHosts) || allowedHosts.length > MAX_HOSTS || allowedHosts.some(h => typeof h !== 'string' || h.length > 253)) {
        throw new Error(`allowedHosts must be at most ${MAX_HOSTS} host names`)
      }
      const save = saving.then(async () => {
        await mkdir(path.dirname(file), { recursive: true })
        const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
        try {
          await writeFile(temp, `${JSON.stringify({ network, allowedHosts }, null, 2)}\n`, 'utf8')
          await rename(temp, file)
        } catch (error) {
          await rm(temp, { force: true }).catch(() => {})
          throw error
        }
      })
      saving = save.catch(() => {})
      await save
      return { network, allowedHosts, saved: true }
    },
  }
}

export function apply(ctx) {
  const home = ctx.get('profileContext')?.home ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const setting = createNetworkSetting(path.join(home, 'harness-studio', 'network.json'))
  const sites = createSiteList(path.join(home, 'harness-studio', 'sites.json'), {
    writeFile, readFile, rename, mkdir, rm, dirname: path.dirname, randomSuffix: () => randomBytes(6).toString('hex'),
  })
  const gate = typeof ctx.on === 'function' ? applySiteApproval(ctx, setting, sites) : undefined
  // Long turns and repeated results (turn-guard.js): a reminder at half the step budget, a pause at it.
  const turnBudget = createTurnBudgetSetting(path.join(home, 'harness-studio', 'turn-budget.json'), {
    writeFile, readFile, rename, mkdir, rm, dirname: path.dirname, randomSuffix: () => randomBytes(6).toString('hex'),
  })
  if (typeof ctx.on === 'function') applyTurnGuard(ctx, turnBudget)
  // Cloud logins for commands (cloud-logins.js): Harness's sandbox policy reads the same file before each command.
  const cloudLogins = createCloudLoginsSetting(path.join(home, 'harness-studio', 'cloud-logins.json'), {
    readFile, writeFile, rename, mkdir, rm, stat, dirname: path.dirname, join: path.join, home: os.homedir(),
  })
  if (typeof ctx.on === 'function') applyCloudLoginGuard(ctx, cloudLogins)
  // The design board and charts-and-diagrams skills (studio-skills.js), loaded by the agent when it picks them.
  applyStudioSkills(ctx)
  // ffmpeg on first use (ffmpeg.js) and local transcription of audio and video files (transcribe.js).
  const ffmpeg = applyFfmpeg(ctx, { home })
  applyTranscribe(ctx, { ffmpeg })
  const data = createDataInventory({ home })
  writeDefaultInstructions(home).catch(error => console.warn(`harness-studio-compact: default instructions not written: ${error.message}`))
  const actions = {
    getNetwork: () => setting.get(),
    setNetwork: request => setting.set(request),
    listData: () => data.list(),
    revealData: request => data.reveal(request),
    listSites: () => sites.get(),
    // Only a site an approval card is asking about right now can be made always-allowed.
    alwaysAllowSite: async ({ host }) => {
      if (!gate?.isAsking(String(host ?? '').toLowerCase())) throw new Error('That site is not waiting for approval')
      return sites.add(host)
    },
    forgetSite: ({ host }) => sites.remove(host),
    getTurnBudget: () => turnBudget.get(),
    setTurnBudget: request => turnBudget.set({ pauseAfter: Number(request?.pauseAfter) }),
    getCloudLogins: () => cloudLogins.get(),
    setCloudLogins: request => cloudLogins.set({ enabled: request?.enabled }),
    ...applyComputerUse(ctx),
  }

  class SettingsAccess {
    constructor() {
      this.typertRemote = Object.freeze({ service: this, serviceKey: SETTINGS_SERVICE, namespace: SETTINGS_SERVICE })
    }

    /** @param {{ action: string }} request */
    async call(request) {
      const action = actions[request?.action]
      if (!action) throw new Error(`Unknown action ${request?.action}`)
      return action(request)
    }
  }
  Object.defineProperty(SettingsAccess.prototype, REMOTE_METHODS_MARKER, {
    configurable: true,
    value: Object.freeze({ version: 1, methods: Object.freeze([Object.freeze({ method: 'call', invocation: Object.freeze({ kind: 'direct' }) })]) }),
  })
  if (typeof ctx.provide === 'function') ctx.provide(SETTINGS_SERVICE, new SettingsAccess())
  return { actions }
}
