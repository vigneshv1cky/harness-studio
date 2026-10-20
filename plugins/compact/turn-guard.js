/**
 * Long turns and going in circles. Harness puts no limit on how many steps one turn takes, and its own
 * repeat-tool-reminder only catches the same call with the same arguments made several times in a row. An agent that
 * cannot make progress (for example, one waiting for a change that only an app restart would load) can keep
 * probing with different calls until the person stops it. This guard adds three things:
 *
 *   - a reminder at half the step budget: summarise progress, and ask the person if the work is going in circles;
 *   - a pause at the budget: the next tool call goes through Harness's approval prompt (where nothing can ask, as on
 *     the command line, that means it is refused); allowing it grants another full budget, rejecting it ends the turn;
 *   - a repeated-result reminder: the same tool returning an identical result three times in one turn, called with
 *     any arguments, means the calls are not producing anything new.
 *
 * Steps are counted per agent from the start of each turn, as Harness numbers them; a message the person sends while
 * the agent works joins the running turn and does not restart the count. The budget applies to the main agent
 * only (subagents report to it); the reminders apply to every agent. The budget is a setting (Settings → Permissions →
 * Long turns), saved in `<harness home>/harness-studio/turn-budget.json`.
 */
import { createHash, randomUUID } from 'node:crypto'

/** Steps a turn may take before it pauses; 0 turns the budget off. */
export const BUDGET_CHOICES = [60, 120, 200, 0]
export const DEFAULT_BUDGET = 60
/** Identical results from one tool, within a turn, at which the agent is told it is not making progress. */
export const REPEAT_THRESHOLDS = [3, 5]
/** Tools whose results are expected to repeat while they wait. */
const REPEAT_EXEMPT = /^(todo_write|job_wait|wait|sleep|terminal_read)$/

const SOURCE = 'harness-studio-turn-guard'

function note(text, summary) {
  const message = { content: [{ type: 'text', text }], source: { kind: SOURCE, form: 'notice', summary }, role: 'user', id: randomUUID() }
  Object.freeze(message.content[0])
  Object.freeze(message.content)
  Object.freeze(message.source)
  return Object.freeze(message)
}

const budgetReminder = (steps, budget) => note(
  `This turn has taken ${steps} steps. Before calling more tools, take stock: summarise in a few lines what you have `
  + 'done and found so far. If you are retrying or probing without new information, or need something only the user can '
  + `do (such as restarting the app, granting access or deciding), stop and ask the user instead of continuing. The turn `
  + `pauses for the user's approval at ${budget} steps.`,
  `${steps} steps`)

const repeatReminder = (tool, count) => note(
  `The last ${count} calls to ${tool} in this turn returned exactly the same result. Calling it again will not show `
  + 'anything new. Use what that result says, change approach, or stop and tell the user what is blocking you.',
  `${tool}: same result × ${count}`)

const isSubagent = agent => agent?.session?.header?.origin === 'subagent'

function hashResult(result) {
  let text
  try { text = JSON.stringify(result) } catch { return undefined }
  return text === undefined ? undefined : createHash('sha256').update(text).digest('hex')
}

/**
 * Read and write the budget setting.
 * @param {string} file - absolute path of turn-budget.json.
 * @param {{ readFile: Function, writeFile: Function, rename: Function, mkdir: Function, rm: Function, dirname: Function, randomSuffix: () => string }} fs
 */
export function createTurnBudgetSetting(file, fs) {
  return {
    async get() {
      try {
        const saved = JSON.parse(await fs.readFile(file, 'utf8'))
        return { pauseAfter: BUDGET_CHOICES.includes(saved.pauseAfter) ? saved.pauseAfter : DEFAULT_BUDGET, saved: true }
      } catch {
        return { pauseAfter: DEFAULT_BUDGET, saved: false }
      }
    },
    async set({ pauseAfter }) {
      if (!BUDGET_CHOICES.includes(pauseAfter)) throw new Error(`pauseAfter must be one of ${BUDGET_CHOICES.join(', ')}`)
      await fs.mkdir(fs.dirname(file), { recursive: true })
      const temp = `${file}.${fs.randomSuffix()}.tmp`
      try {
        await fs.writeFile(temp, `${JSON.stringify({ pauseAfter }, null, 2)}\n`, 'utf8')
        await fs.rename(temp, file)
      } catch (error) {
        await fs.rm(temp, { force: true }).catch(() => {})
        throw error
      }
      return { pauseAfter, saved: true }
    },
  }
}

/**
 * The guard's listeners, kept apart from the plugin context so they can be tested with stand-in agents.
 * @param {{ readBudget: () => Promise<number>, cancel?: (agent: object) => void }} options
 *   `readBudget` returns the step budget (0 = off); `cancel` ends the agent's turn after a rejected pause.
 */
export function createTurnGuard({ readBudget, cancel = agent => agent.cancel?.({ kind: 'user' }) }) {
  const turns = new WeakMap()
  const fresh = turn => ({ turn, steps: 0, reminded: false, nextPause: undefined, askedAtStep: undefined, results: new Map() })
  const turnOf = (agent) => {
    let turn = turns.get(agent)
    if (turn === undefined) turns.set(agent, turn = fresh(undefined))
    return turn
  }
  /** Calls that asked for approval at the budget, until they either run (allowed) or settle without running. */
  const asked = new WeakSet()
  const ran = new WeakSet()

  return {
    /** `agent/pre-step`: Harness's turn number starts a new count, and its step number within the turn is the count. */
    preStep({ agent, turn, step }, next) {
      if (turnOf(agent).turn !== turn) turns.set(agent, fresh(turn))
      turnOf(agent).steps = step
      return next()
    },
    /** `tools/pre-execute`: other listeners decide first; at the budget, an allowed call asks instead. */
    async preExecute(exec, next) {
      const decision = await next()
      if (decision?.kind !== 'allow' || exec.agent === undefined || isSubagent(exec.agent)) return decision
      const budget = await readBudget()
      if (!budget) return decision
      const turn = turnOf(exec.agent)
      if (turn.steps < (turn.nextPause ?? budget)) return decision
      // One card per step: other calls the model made in the same step run as decided.
      if (turn.askedAtStep === turn.steps) return decision
      turn.askedAtStep = turn.steps
      asked.add(exec)
      return {
        kind: 'ask',
        reason: `this turn has taken ${turn.steps} steps without finishing`,
        displayReason: {
          en: `The agent has taken ${turn.steps} steps on this request without finishing. Let it continue for up to ${budget} more steps? Reject stops it here.`,
        },
      }
    },
    /** `tools/execute`: a call that asked and is now running was allowed, so the turn gets another budget. */
    async execute(exec, next) {
      if (asked.has(exec)) {
        ran.add(exec)
        const budget = await readBudget()
        const turn = turnOf(exec.agent)
        turn.nextPause = turn.steps + budget
        turn.reminded = false
      }
      return next()
    },
    /** `tools/post-execute`: add the reminders as model context, and end the turn after a rejected pause. */
    async postExecute(exec, result, next) {
      const downstream = await next()
      if (exec.agent === undefined) return downstream
      if (asked.has(exec) && !ran.has(exec)) {
        // Rejected: the person chose to stop. End the turn once this result is recorded.
        setTimeout(() => cancel(exec.agent), 0)
        return downstream
      }
      const turn = turnOf(exec.agent)
      const notes = []
      const budget = isSubagent(exec.agent) ? 0 : await readBudget()
      const limit = turn.nextPause ?? budget
      if (budget && !turn.reminded && turn.steps >= limit - Math.floor(budget / 2)) {
        turn.reminded = true
        notes.push(budgetReminder(turn.steps, limit))
      }
      if (!REPEAT_EXEMPT.test(exec.name)) {
        const hash = hashResult(result)
        if (hash !== undefined) {
          const key = `${exec.name}\u0000${hash}`
          const count = (turn.results.get(key) ?? 0) + 1
          turn.results.set(key, count)
          if (REPEAT_THRESHOLDS.includes(count)) notes.push(repeatReminder(exec.name, count))
        }
      }
      if (notes.length === 0) return downstream
      return { ...downstream, additionalContexts: [...notes, ...downstream.additionalContexts ?? []] }
    },
  }
}

/**
 * Register the guard on Harness's agent and tool pipeline.
 * @param {object} ctx - the Host plugin context.
 * @param {{ get: () => Promise<{ pauseAfter: number }> }} setting - the budget setting.
 */
export function applyTurnGuard(ctx, setting) {
  const guard = createTurnGuard({ readBudget: async () => (await setting.get()).pauseAfter })
  ctx.on('agent/pre-step', (event, next) => guard.preStep(event, next))
  ctx.on('tools/pre-execute', (exec, next) => guard.preExecute(exec, next))
  ctx.on('tools/execute', (exec, next) => guard.execute(exec, next))
  ctx.on('tools/post-execute', (exec, result, next) => guard.postExecute(exec, result, next))
  return guard
}
