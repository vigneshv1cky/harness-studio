/**
 * Cloud logins for commands. Harness's sandbox hides the cloud and database command-line logins (`~/.config/gcloud`,
 * `~/.aws`, `~/.azure`, `~/.kube`, Snowflake's connections, `~/.databrickscfg` and `~/.databricks`, `~/.pgpass` and
 * `~/.pg_service.conf`, `~/.my.cnf` and `~/.mylogin.cnf`) from the agent's commands, so `gcloud` or `psql` there act
 * as if the person never signed in. Settings → Permissions → Cloud logins for commands lets the person expose
 * chosen ones:
 *
 *   - the choice is saved in `<harness home>/harness-studio/cloud-logins.json`, which Harness's sandbox policy reads
 *     before each command: an exposed login's files become readable to commands and its folders also writable (so the
 *     CLI runs as the person and refreshes its tokens), and the agent is told which logins it has;
 *   - the first command in a session that uses an exposed login asks the person, through Harness's approval card;
 *     allowing it lets that login's later commands in the session run without asking. Each login is approved on
 *     its own, so allowing gcloud does not allow kubectl.
 *
 * Commands are recognised by the CLI at the start of a command (after `;`, `&&`, `|`, `(` or `$(`, and behind
 * `sudo`, `env`, `time` or a variable assignment). A program that starts a CLI some other way is not asked about,
 * but still runs only with the logins the person exposed.
 */
import { randomBytes } from 'node:crypto'

/** The logins offered, in the order the setting shows them; `paths` are under the home directory (a login is present when any exists). */
export const CLOUD_LOGINS = [
  { id: 'gcloud', label: 'Google Cloud', cli: 'gcloud', paths: ['.config/gcloud'], commands: ['gcloud', 'gsutil', 'bq'] },
  { id: 'aws', label: 'AWS', cli: 'aws', paths: ['.aws'], commands: ['aws'] },
  { id: 'azure', label: 'Azure', cli: 'az', paths: ['.azure'], commands: ['az'] },
  { id: 'kubernetes', label: 'Kubernetes', cli: 'kubectl', paths: ['.kube'], commands: ['kubectl', 'helm'] },
  // Snowflake keeps its connections in ~/.snowflake, or else in the platform's configuration folder.
  { id: 'snowflake', label: 'Snowflake', cli: 'snow', paths: ['.snowflake', 'Library/Application Support/snowflake', '.config/snowflake'], commands: ['snow', 'snowsql'] },
  { id: 'databricks', label: 'Databricks', cli: 'databricks', paths: ['.databrickscfg', '.databricks'], commands: ['databricks'] },
  { id: 'postgres', label: 'PostgreSQL', cli: 'psql', paths: ['.pgpass', '.pg_service.conf'], commands: ['psql', 'pg_dump', 'pg_dumpall', 'pg_restore'] },
  { id: 'mysql', label: 'MySQL', cli: 'mysql', paths: ['.my.cnf', '.mylogin.cnf'], commands: ['mysql', 'mysqldump', 'mysqladmin'] },
]

const IDS = CLOUD_LOGINS.map(login => login.id)
/** Words that run the next word as the command. */
const WRAPPERS = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command', 'xargs', 'nice'])

/**
 * The exposed logins a shell command uses, by the CLI at the start of each of its commands.
 * @param {string} command - the shell command.
 * @param {readonly string[]} enabled - the exposed logins.
 * @returns {string[]} login ids, in {@link CLOUD_LOGINS} order.
 */
export function loginsUsedBy(command, enabled) {
  if (typeof command !== 'string' || enabled.length === 0) return []
  const used = new Set()
  for (const segment of command.split(/\$\(|[;&|(){}\n`]/)) {
    const words = segment.trim().split(/\s+/)
    let index = 0
    while (index < words.length && (WRAPPERS.has(words[index]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]) || /^-/.test(words[index] ?? ''))) index++
    const program = (words[index] ?? '').split('/').at(-1)
    for (const login of CLOUD_LOGINS) if (enabled.includes(login.id) && login.commands.includes(program)) used.add(login.id)
  }
  return CLOUD_LOGINS.map(login => login.id).filter(id => used.has(id))
}

/**
 * Read and write the setting.
 * @param {string} file - absolute path of cloud-logins.json.
 * @param {{ readFile: Function, writeFile: Function, rename: Function, mkdir: Function, rm: Function, stat: Function, dirname: Function, join: Function, home: string }} fs
 */
export function createCloudLoginsSetting(file, fs) {
  async function enabled() {
    try {
      const saved = JSON.parse(await fs.readFile(file, 'utf8'))
      return Array.isArray(saved.enabled) ? IDS.filter(id => saved.enabled.includes(id)) : []
    } catch {
      // Nothing saved yet, or unreadable: no login is exposed (the sandbox policy reads it the same way).
      return []
    }
  }
  return {
    enabled,
    /** The choice, and for each login whether its folder exists on this computer. */
    async get() {
      const on = await enabled()
      const logins = await Promise.all(CLOUD_LOGINS.map(async login => {
        const found = await Promise.all(login.paths.map(rel => fs.stat(fs.join(fs.home, rel)).then(() => true, () => false)))
        return {
          id: login.id, label: login.label, cli: login.cli, path: login.paths.map(rel => `~/${rel}`).join(', '),
          present: found.some(Boolean),
          enabled: on.includes(login.id),
        }
      }))
      return { enabled: on, logins }
    },
    async set({ enabled: next }) {
      if (!Array.isArray(next) || next.some(id => !IDS.includes(id))) throw new Error(`enabled must list some of ${IDS.join(', ')}`)
      await fs.mkdir(fs.dirname(file), { recursive: true })
      const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`
      try {
        await fs.writeFile(temp, `${JSON.stringify({ enabled: IDS.filter(id => next.includes(id)) }, null, 2)}\n`, 'utf8')
        await fs.rename(temp, file)
      } catch (error) {
        await fs.rm(temp, { force: true }).catch(() => {})
        throw error
      }
      return this.get()
    },
  }
}

const labelsOf = ids => ids.map(id => CLOUD_LOGINS.find(login => login.id === id)?.label ?? id)
const join = words => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`)

/**
 * The guard's listeners, apart from the plugin context so they can be tested with stand-in calls.
 * @param {{ readEnabled: () => Promise<string[]> }} options
 */
export function createCloudLoginGuard({ readEnabled }) {
  /** Logins approved per session. */
  const approved = new WeakMap()
  /** Calls that asked, with the logins they asked for, until they run. */
  const asked = new WeakMap()
  return {
    /** `tools/pre-execute`: a shell command using an exposed login not yet approved in this session asks. */
    async preExecute(exec, next) {
      const decision = await next()
      if (decision?.kind !== 'allow' || exec.name !== 'bash') return decision
      const args = exec.arguments
      if (args?.sandbox_permissions === 'danger-full-access') return decision // escalation asks on its own
      const session = exec.agent?.session
      if (session === undefined) return decision
      const done = approved.get(session) ?? new Set()
      const logins = loginsUsedBy(args?.command, await readEnabled()).filter(id => !done.has(id))
      if (logins.length === 0) return decision
      asked.set(exec, logins)
      const names = join(labelsOf(logins))
      const clis = join(logins.map(id => CLOUD_LOGINS.find(login => login.id === id).cli))
      const first = String(args.command).split('\n')[0].slice(0, 200)
      return {
        kind: 'ask',
        reason: `this command uses the user's ${names} login`,
        displayReason: {
          en: `The agent wants to run a command with your ${names} login: ${first}. Allowing it also lets this session's later ${clis} commands run without asking.`,
        },
      }
    },
    /** `tools/execute`: a call that asked and now runs was allowed, so its logins are approved for the session. */
    execute(exec, next) {
      const logins = asked.get(exec)
      const session = exec.agent?.session
      if (logins !== undefined && session !== undefined) {
        const done = approved.get(session) ?? new Set()
        for (const id of logins) done.add(id)
        approved.set(session, done)
      }
      return next()
    },
  }
}

/**
 * Register the guard on Harness's tool pipeline.
 * @param {object} ctx - the Host plugin context.
 * @param {{ enabled: () => Promise<string[]> }} setting - the cloud logins setting.
 */
export function applyCloudLoginGuard(ctx, setting) {
  const guard = createCloudLoginGuard({ readEnabled: () => setting.enabled() })
  ctx.on('tools/pre-execute', (exec, next) => guard.preExecute(exec, next))
  ctx.on('tools/execute', (exec, next) => guard.execute(exec, next))
  return guard
}
