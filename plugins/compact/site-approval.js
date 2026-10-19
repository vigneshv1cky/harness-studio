/**
 * Ask before the agent reaches a new site. Web fetch, opening a page in the Browser pane and opening a page in
 * the user's Chrome put an address the model wrote on the network, so a prompt injection can have the agent
 * carry what it has read (a workspace .env file, say) to any host in a URL. None of them goes through the
 * sandbox, so Network for commands does not apply to them.
 *
 * Before such a call reaches a host that is not on this computer and not on the Network for commands list
 * (when that is set to Only allowed sites), the call asks the user through Harness's approval prompt. Once a
 * call to a host has been allowed, later calls in the same session reach it without asking. Full access lifts
 * the check, as it lifts the sandbox. A site the user chose "Always allow for this website" for is saved on this
 * computer (harness-studio/sites.json) and never asks again until it is removed in Settings.
 */

/**
 * The tools that send a URL the model chose, and the argument holding it. Connector tool names are
 * `mcp__<connector>__<tool>`, so `chrome_open` is matched under whatever name the Chrome connector was given.
 */
export const SITE_TOOLS = [
  { test: name => name === 'web_fetch', arg: 'url', what: 'fetch' },
  { test: name => name === 'browser_open', arg: 'url', what: 'open a page from' },
  { test: name => /^mcp__.+__chrome_open$/.test(name), arg: 'url', what: 'open a page in your Chrome from' },
]

/** Host entries the allowlist accepts, as the sandbox policy reads them (desktop patch 16). */
const HOST_ENTRY = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/

/**
 * Normalize allowlist entries exactly as the sandbox policy does: lower case, scheme, path and port dropped,
 * invalid and repeated entries removed.
 * @param {readonly unknown[]} hosts
 * @returns {string[]}
 */
export function normalizeHosts(hosts) {
  const out = []
  for (const raw of hosts) {
    if (typeof raw !== 'string') continue
    const host = raw.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '')
    if (HOST_ENTRY.test(host) && !out.includes(host)) out.push(host)
  }
  return out
}

/**
 * Whether an allowlist admits a host, with the proxy's rule: `example.com` admits exactly that name and
 * `*.example.com` admits its subdomains (not the bare name).
 * @param {string} host
 * @param {readonly string[]} hosts - normalized entries.
 */
export function hostAllowed(host, hosts) {
  const name = host.toLowerCase().replace(/\.$/, '')
  return hosts.some(entry => (entry.startsWith('*.') ? name.endsWith(entry.slice(1)) && name.length > entry.length - 1 : name === entry))
}

/**
 * The host an http(s) URL reaches, lower case, without IPv6 brackets or a trailing dot; `undefined` for
 * anything else, which the tools themselves refuse.
 * @param {unknown} url
 */
export function hostOf(url) {
  if (typeof url !== 'string') return undefined
  let parsed
  try { parsed = new URL(url.trim()) } catch { return undefined }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '') || undefined
}

/**
 * Whether a host is this computer: `localhost` and its subdomains, 127.0.0.0/8, `::1`, and the unspecified
 * addresses (which connect to this computer). The URL parser has already turned short and hexadecimal IPv4
 * forms into dotted decimal.
 * @param {string} host
 */
export function isLocal(host) {
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) || host === '0.0.0.0') return true
  if (host === '::1' || host === '::') return true
  const mapped = /^::ffff:(.+)$/.exec(host)?.[1]
  if (mapped === undefined) return false
  if (/^7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(mapped)) return true
  return /^127\./.test(mapped)
}

/**
 * The gate itself, independent of Harness so it can be tested alone.
 * @param {{
 *   readNetwork: () => Promise<{ network: string, allowedHosts: unknown[] }>,
 *   fullAccess: (session: object) => boolean,
 * }} options - `readNetwork` returns the Network for commands setting; `fullAccess` whether a session runs
 *   with the sandbox off.
 */
export function createSiteApproval({ readNetwork, fullAccess, readSites = async () => [] }) {
  /** Hosts reached with the user's approval, per session. */
  const approved = new WeakMap()
  /**
   * Calls that asked, until they are dispatched. Harness hands the same execution object to pre-execute and
   * execute, so keying by it ties an approval to exactly the call that was approved: call ids are not unique
   * (providers reuse them, and Harness falls back to `call-<index>`), and a rejected call never reaches execute.
   */
  const pending = new WeakMap()
  /** Hosts an approval card is asking about right now, counted, so only those can be made always-allowed. */
  const asking = new Map()
  const startAsking = host => asking.set(host, (asking.get(host) ?? 0) + 1)
  const stopAsking = host => { const n = (asking.get(host) ?? 1) - 1; if (n > 0) asking.set(host, n); else asking.delete(host) }
  const alwaysAllowed = async host => (await readSites()).includes(host)

  const approvedIn = session => approved.get(session)
  const remember = (session, host) => {
    let hosts = approved.get(session)
    if (!hosts) approved.set(session, hosts = new Set())
    hosts.add(host)
  }

  /**
   * What a call needs before it runs: `undefined` when it can run, the host to ask about, or `invalid` when
   * the address is not a string and so cannot be checked.
   * @param {{ name: string, arguments?: unknown, agent?: { session?: object } }} exec
   */
  async function hostToAsk(exec) {
    const tool = SITE_TOOLS.find(t => t.test(exec.name))
    if (!tool) return undefined
    const args = exec.arguments
    const value = args && typeof args === 'object' ? args[tool.arg] : undefined
    const session = exec.agent?.session
    if (value !== undefined && value !== null && typeof value !== 'string') {
      // The tools turn a non-string address into text themselves, so it could reach a host unchecked.
      if (session !== undefined && fullAccess(session)) return undefined
      return { invalid: true, tool }
    }
    const host = hostOf(value)
    if (host === undefined || isLocal(host)) return undefined
    if (session !== undefined && fullAccess(session)) return undefined
    if (session !== undefined && approvedIn(session)?.has(host)) return undefined
    if (await alwaysAllowed(host)) return undefined
    const setting = await readNetwork()
    if (setting.network === 'allowlist' && hostAllowed(host, normalizeHosts(setting.allowedHosts))) return undefined
    return { host, tool }
  }

  return {
    /** `tools/pre-execute` listener: other listeners decide first; an allowed call to a new site asks. */
    async preExecute(exec, next) {
      const decision = await next()
      if (decision?.kind !== 'allow') return decision
      const ask = await hostToAsk(exec)
      if (ask === undefined) return decision
      if (ask.invalid) {
        return { kind: 'deny', reason: `${exec.name} needs its ${ask.tool.arg} argument to be one web address written as text` }
      }
      const session = exec.agent?.session
      if (session !== undefined) pending.set(exec, { session, host: ask.host })
      startAsking(ask.host)
      // The card stops asking once answered either way, or when the call is cancelled; a timer is the backstop
      // for an answer that never reaches execute (a rejection).
      setTimeout(() => stopAsking(ask.host), 30 * 60 * 1000).unref?.()
      return {
        kind: 'ask',
        reason: `${exec.name} would reach ${ask.host}, a site not allowed in this session`,
        displayReason: {
          en: `Let the agent ${ask.tool.what} ${ask.host}? Each new site asks once per session, since a web address can carry what the agent has read.`,
        },
      }
    },
    /** `tools/execute` listener: a call that asked and is now running was allowed, so its host is remembered. */
    async execute(exec, next) {
      const waiting = pending.get(exec)
      if (waiting !== undefined) {
        pending.delete(exec)
        remember(waiting.session, waiting.host)
        // Answered: the always-allow choice, if any, was saved before the card answered.
        setTimeout(() => stopAsking(waiting.host), 5000).unref?.()
      }
      return next()
    },
    /** Whether an approval card is asking about this host right now. */
    isAsking: host => asking.has(host),
    /** Hosts allowed in a session so far (for tests). */
    approvedHosts: session => [...(approvedIn(session) ?? [])],
    /**
     * Whether a page address may be on screen in a session without asking: this computer, a site allowed in
     * the session or on the allowed-sites list, or full access. The Browser pane checks where a page ended up,
     * since a page (a local one included) can redirect or navigate to another site by itself.
     * @param {object | undefined} session
     * @param {string} url
     */
    async allows(session, url) {
      const host = hostOf(url)
      if (host === undefined || isLocal(host)) return true
      if (session !== undefined && fullAccess(session)) return true
      if (session !== undefined && approvedIn(session)?.has(host)) return true
      if (await alwaysAllowed(host)) return true
      const setting = await readNetwork()
      return setting.network === 'allowlist' && hostAllowed(host, normalizeHosts(setting.allowedHosts))
    },
  }
}

/**
 * Register the gate on Harness's tool pipeline.
 * @param {object} ctx - the Host plugin context.
 * @param {{ get: () => Promise<{ network: string, allowedHosts: unknown[] }> }} setting - the network setting.
 */
/** The service other plugins read approvals through. */
export const SITE_APPROVAL_SERVICE = 'harnessStudioSiteApproval'

export function applySiteApproval(ctx, setting, sites) {
  const gate = createSiteApproval({
    readNetwork: () => setting.get(),
    readSites: async () => (sites ? (await sites.get()).hosts : []),
    fullAccess: session => {
      try {
        return ctx.get('sandboxPolicy')?.resolve({ session }).mode === 'danger-full-access'
      } catch {
        return false
      }
    },
  })
  ctx.on('tools/pre-execute', (exec, next) => gate.preExecute(exec, next))
  ctx.on('tools/execute', (exec, next) => gate.execute(exec, next))
  // Other plugins (the Browser pane) ask whether a page they ended up on is allowed.
  if (typeof ctx.provide === 'function') ctx.provide(SITE_APPROVAL_SERVICE, { allows: (session, url) => gate.allows(session, url) })
  return gate
}

/**
 * The sites the user chose "Always allow for this website" for, saved in one JSON file and written atomically.
 * @param {string} file - absolute path of sites.json.
 */
export function createSiteList(file, { writeFile: write, readFile: read, rename: move, mkdir: makeDir, rm: remove, dirname, randomSuffix }) {
  let saving = Promise.resolve()
  async function get() {
    try {
      const saved = JSON.parse(await read(file, 'utf8'))
      const hosts = Array.isArray(saved.hosts) ? saved.hosts.filter(h => typeof h === 'string' && HOST_ENTRY.test(h)) : []
      return { hosts: [...new Set(hosts)] }
    } catch {
      return { hosts: [] }
    }
  }
  async function save(hosts) {
    const job = saving.then(async () => {
      await makeDir(dirname(file), { recursive: true })
      const temp = `${file}.${process.pid}.${randomSuffix()}.tmp`
      try {
        await write(temp, `${JSON.stringify({ hosts }, null, 2)}\n`, 'utf8')
        await move(temp, file)
      } catch (error) {
        await remove(temp, { force: true }).catch(() => {})
        throw error
      }
    })
    saving = job.catch(() => {})
    await job
    return { hosts }
  }
  return {
    get,
    async add(host) {
      const value = String(host ?? '').toLowerCase()
      if (!HOST_ENTRY.test(value) || value.startsWith('*.')) throw new Error('host must be one site name, such as example.com')
      const { hosts } = await get()
      if (hosts.includes(value)) return { hosts }
      if (hosts.length >= 500) throw new Error('At most 500 sites can be always allowed')
      return save([...hosts, value])
    },
    async remove(host) {
      const { hosts } = await get()
      return save(hosts.filter(h => h !== String(host ?? '').toLowerCase()))
    },
  }
}
