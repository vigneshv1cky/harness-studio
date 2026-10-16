/**
 * Host half of Sessions: the agent hands work to separate, top-level Sessions in the sidebar, like
 * Claude Code desktop's side sessions. Design: docs/SESSIONS_DESIGN.md.
 *
 *   - `start_session` creates an ordinary Session through the same Session-controller call as the
 *     sidebar's New session button, optionally in its own git worktree (worktree.js), titles it, gives it
 *     the parent's permission preset and sends the brief as its first message (which starts its first turn
 *     and makes the row appear). With `initiation: 'proposal'` it first asks the user on Harness's own
 *     question card ("New session" / "Do it here") and creates nothing unless the user picks New session.
 *   - When a started Session ends a turn, its final message (cut to `reportChars`) is sent to the parent:
 *     waking it when it is idle, or into its next step when it is busy, the user drove that turn, or the
 *     wake budget is spent.
 *   - `message_session` sends a started Session a follow-up, `stop_session` ends its running turn through
 *     Harness's own cancellation, `list_sessions` lists them, `remove_session_worktree` removes a clean
 *     worktree after the user confirms.
 *
 * Lifetimes:
 *   - Every git process goes through one runner (process.js) that kills its whole process group on
 *     timeout, cancellation, plugin disposal and Host exit.
 *   - Archiving a started Session releases its turn state and marks its record closed. Archiving a parent
 *     (Harness asks every plugin to stop the Session's activity) cancels its started Sessions' running
 *     turns and marks them orphaned; a started Session that ends a turn after its parent is gone records
 *     that turn and delivers nothing.
 *   - At Host start the record is reconciled with what exists: records of Sessions that no longer exist
 *     are dropped and missing worktrees are marked; no worktree, branch or Session is ever deleted then.
 *
 * Which Session started which lives in `<home>/harness-studio/sessions.json` (store.js).
 */
import { realpath, stat, access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  BRIEF_SOURCE, DO_IT_HERE, REPORT_SOURCE, START, START_QUESTION_ID, briefText, cardDetail, readCardChoice, slugify, startOutcome, cleanMessageArgs, cleanStartArgs, contentText, deliveryMode,
  describeEnding, reportText, resolveConfig, userMessage,
} from './logic.js'
import { createRunner } from './process.js'
import { createStore } from './store.js'
import { createWorktrees } from './worktree.js'

export const name = 'harness-studio-sessions'
export const inject = ['tools', 'agents', 'sessions', 'sessionController', 'sessionTitle', 'workspaceRegistry', 'workingDirectory', 'systemPrompt']

const REMOVE = 'Remove worktree'
const KEEP = 'Keep it'
const CARD_PROMPT_CHARS = 600
const PARENT_GONE = { kind: 'parent' }
/** How long after an archive's activity check the archive is looked for. */
const ARCHIVE_SETTLE_MS = 1500

const text = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] }
const exists = p => access(p).then(() => true, () => false)

const GUIDANCE = [
  'Separate sessions: start_session hands a piece of work to a new top-level session in the user\'s sidebar, which the user can open and talk to.',
  'Keep quick things (a question, a read, one edit, a few tool calls) in this session. Use a separate session for an independent piece that can run while you or the user continue, and give it a complete brief: the task, the files or area, and what done looks like.',
  'Use initiation "user_asked" only when the user asked in words for separate or parallel work; when splitting the work off is your own idea, use "proposal", which asks the user first.',
  'Two sessions that write files never share a checkout: pass worktree: true when the new session will edit files this session or another one may also edit.',
  'A started session\'s report arrives here as a message when it ends a turn; never poll it. A report is that session\'s claim: check the result or diff before telling the user the work is done.',
].join(' ')

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const profile = ctx.get('profileContext')
  const home = profile?.home ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const store = createStore({ home })
  const runner = createRunner()
  const worktrees = createWorktrees(runner, path.join(home, 'harness-studio', 'worktrees'))

  /** Per started Session: what its current turn has produced so far. */
  const turns = new Map()
  /** Per parent: the report chain, so reports arrive in the order the turns ended. */
  const deliveries = new Map()
  let disposed = false
  ctx.effect(() => async () => {
    disposed = true
    turns.clear()
    deliveries.clear()
    await runner.dispose()
    await store.settled().catch(() => {})
  }, 'sessions runtime')

  const ready = store.load().then(reconcile).catch(error => {
    console.warn('[harness-studio] sessions: record not loaded:', error?.message ?? error)
  })

  const titleOf = session => {
    try { return ctx.sessionTitle.get(session)?.title } catch { return undefined }
  }
  const archived = id => ctx.workspaceRegistry.archivedSessionIds?.includes(id) === true

  /** Resume a Session (if needed) outside any agent's initiator scope, so it is never runtime-owned by another agent. */
  const resolveRoot = id => ctx.agents.withoutInitiator(async () => {
    const resolved = await ctx.sessionController.resolveAgent(id)
    if ('error' in resolved) throw resolved.error
    return resolved.agent
  })

  const ownedChild = (parent, sessionId) => {
    const record = store.child(sessionId)
    if (!record || record.parentId !== parent.id) throw new Error(`${sessionId} is not a session this session started; list_sessions shows them.`)
    return record
  }

  /**
   * End a started Session's work through Harness's own controls: cancel its running turn and kill the
   * background jobs it owns (the same kill Harness runs when a Session is archived with its work).
   * @returns {{ turn: boolean, jobs: number }} what was running.
   */
  function stopChildWork(childId, reason) {
    const agent = ctx.agents.get(childId)
    const turn = agent?.status === 'running'
    if (turn) agent.cancel(PARENT_GONE)
    let jobs = 0
    const registry = ctx.get('jobs')
    for (const job of registry?.list(childId) ?? []) {
      if (job.owner !== childId || (job.status !== 'running' && job.status !== 'stopping')) continue
      try {
        registry.kill(job.id, childId, reason)
        jobs++
      } catch (error) {
        console.warn(`[harness-studio] sessions: could not stop job ${job.id} of ${childId}:`, error?.message ?? error)
      }
    }
    return { turn, jobs }
  }

  /** The parent is archived or gone: stop each started Session's work and mark it orphaned. */
  async function orphanChildrenOf(parentId) {
    for (const child of store.childrenOf(parentId)) {
      if (child.closed) continue
      stopChildWork(child.id, 'the session that started it was archived')
      if (!child.orphaned) await store.update(child.id, { orphaned: true })
    }
  }

  // ---- restart reconciliation -------------------------------------------------------------------
  /**
   * Bring the record in line with what exists. Idempotent; deletes no Session, worktree or branch.
   * Records of Sessions Harness no longer lists are dropped; a missing worktree is marked, not recreated.
   */
  async function reconcile() {
    const records = store.all()
    if (records.length === 0) return
    let known
    try {
      const listed = await ctx.sessionController.list({}, AbortSignal.timeout(30000))
      known = new Set(listed.items.map(item => item.sessionId))
      // An empty listing at start-up proves nothing about the record; keep it as it is.
      if (known.size === 0) known = undefined
    } catch (error) {
      console.warn('[harness-studio] sessions: could not list sessions to reconcile:', error?.message ?? error)
    }
    for (const record of records) {
      if (known && !known.has(record.id)) {
        await store.remove(record.id)
        continue
      }
      if (record.worktreePath) {
        const present = await exists(record.worktreePath)
        if (present === (record.worktreeMissing === true)) await store.update(record.id, { worktreeMissing: !present })
      }
      if (known && !record.orphaned && !known.has(record.parentId)) await store.update(record.id, { orphaned: true })
    }
    if (known) for (const parentId of store.wakeParents()) if (!known.has(parentId)) await store.setWakeStreak(parentId, 0)
  }

  // ---- start_session ----------------------------------------------------------------------------
  async function startSession(rawArgs, exec) {
    await ready
    const parent = exec.agent
    if (!parent) throw new Error('start_session needs a session')
    if (parent.session.header?.origin === 'subagent') throw new Error('Only a top-level session can start sessions; report back to your parent instead.')
    const args = cleanStartArgs(rawArgs)
    const depth = (store.child(parent.id)?.depth ?? 0) + 1
    if (depth > config.maxDepth) throw new Error(`Sessions can be started ${config.maxDepth} level(s) deep at most; do this work here.`)
    const running = store.childrenOf(parent.id).filter(c => ctx.agents.get(c.id)?.status === 'running').length
    if (running >= config.maxLiveChildren) throw new Error(`${running} sessions started from here are still running (the limit is ${config.maxLiveChildren}); wait for their reports.`)

    const requested = args.folder ?? await ctx.workingDirectory.ensure(parent, exec.signal)
    const folder = await realpath(requested).catch(() => { throw new Error(`${requested} does not exist`) })
    if (!(await stat(folder)).isDirectory()) throw new Error(`${folder} is not a folder`)
    let plan = args.worktree ? await worktrees.plan({ folder, slug: args.slug, prefix: config.branchPrefix, signal: exec.signal }) : undefined

    if (args.initiation === 'proposal') {
      const brief = args.prompt.length > CARD_PROMPT_CHARS ? args.prompt.slice(0, CARD_PROMPT_CHARS) + '…' : args.prompt
      // The card (client.js) draws this question itself; Harness's generic question form is the fallback.
      const reply = await askUser(parent, exec.signal, {
        id: START_QUESTION_ID,
        header: 'New session',
        question: args.title,
        detail: cardDetail({ folder, home: os.homedir(), branch: plan?.branch, brief }),
        options: [
          { label: START, description: 'Start it in its own session in the sidebar; its report comes back here.' },
          { label: DO_IT_HERE, description: 'Keep working on it in this session.' },
        ],
      })
      if (typeof reply === 'string') return reply
      const choice = readCardChoice(reply)
      if (!choice.start) {
        return choice.said
          ? `Nothing was started. The user answered: ${choice.said}`
          : 'The user chose to do this here. Nothing was started; continue the task in this session.'
      }
      // The user may have switched the worktree in the card's Options; the card may also have been open
      // for a while, so take whatever names are free now.
      const worktree = choice.worktree ?? args.worktree
      plan = worktree
        ? await worktrees.plan({ folder, slug: args.slug ?? (slugify(args.title) || 'session'), prefix: config.branchPrefix, signal: exec.signal })
        : undefined
    }

    if (plan) await worktrees.add(plan, exec.signal)
    let child
    try {
      child = await ctx.agents.withoutInitiator(() => createChild({ parent, args, folder, plan, depth }))
    } catch (error) {
      if (plan && !(await worktrees.discardFresh(plan))) {
        throw new Error(`${error.message} (the new worktree ${plan.path} on branch ${plan.branch} was kept because it is no longer clean)`, { cause: error })
      }
      throw error
    }
    const where = plan ? `${plan.workDir} (worktree of ${plan.repoRoot}, branch ${plan.branch})` : folder
    const approved = args.initiation === 'proposal' ? ' The user approved it on the card.' : ''
    return `Started session "${args.title}" (${child.id}) in ${where}.${approved} Its report arrives here as a message when it ends a turn; do not poll it. Use message_session to send it follow-ups.`
  }

  /** One question on Harness's question card; a string result is the tool's answer when the user could not be asked. */
  async function askUser(agent, signal, question) {
    const questions = ctx.get('userQuestions')
    if (!questions) return 'This Harness cannot ask the user, so nothing was done; ask the user in your reply instead.'
    try {
      const answer = await questions.ask({ agent, signal, questions: [question] })
      const reply = answer?.answers?.find(a => a.id === question.id)
      return { selected: reply?.selected ?? [], custom: reply?.custom }
    } catch (error) {
      if (signal?.aborted) throw error
      return `The user could not be asked (${error.message}), so nothing was done.`
    }
  }

  async function createChild({ parent, args, folder, plan, depth }) {
    const workspace = await ctx.workspaceRegistry.create(folder)
    const { sessionId } = await ctx.sessionController.create({ workspaceId: workspace.id })
    let recorded = false
    try {
      const resolved = await ctx.sessionController.resolveAgent(sessionId)
      if ('error' in resolved) throw resolved.error
      const child = resolved.agent
      // The started Session never runs with a looser permission preset than the one that started it.
      const presets = ctx.get('permissionPresets')
      if (presets) presets.set(child.session, presets.current(parent.session))
      if (plan) await ctx.workingDirectory.set(child, plan.workDir)
      ctx.sessionTitle.rename(child.session, args.title)
      await store.add({
        id: child.id, parentId: parent.id, title: args.title, folder,
        ...(plan ? { repoRoot: plan.repoRoot, worktreePath: plan.path, branch: plan.branch } : {}),
        depth, createdAt: new Date().toISOString(),
      })
      recorded = true
      const brief = briefText({
        parentTitle: titleOf(parent.session), parentId: parent.id, background: args.background, prompt: args.prompt,
        ...(plan ? { worktree: { path: plan.workDir, branch: plan.branch } } : {}),
      })
      child.followup(userMessage(brief, { kind: BRIEF_SOURCE, form: 'relay', senderSessionId: parent.id }))
      await ctx.sessions.flush(child.session)
      return child
    } catch (error) {
      if (recorded) await store.remove(sessionId).catch(() => {})
      // The Session never got its brief, so it is blank (hidden); archive it so it does not linger.
      await ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity: true }).catch(() => {})
      throw error
    }
  }

  // ---- message / stop / list / remove worktree --------------------------------------------------
  async function messageSession(rawArgs, exec) {
    await ready
    const parent = exec.agent
    if (!parent) throw new Error('message_session needs a session')
    const { sessionId, message } = cleanMessageArgs(rawArgs)
    const record = ownedChild(parent, sessionId)
    if (record.closed || archived(sessionId)) throw new Error(`"${record.title}" was archived; it takes no more messages.`)
    const child = await resolveRoot(sessionId)
    const busy = child.status === 'running'
    child.followup(userMessage(message, { kind: BRIEF_SOURCE, form: 'relay', senderSessionId: parent.id }))
    await ctx.sessions.flush(child.session)
    return busy
      ? `Sent to "${record.title}". It is busy, so the message runs as its next turn; its report arrives here afterwards.`
      : `Sent to "${record.title}"; it started a turn. Its report arrives here when it ends.`
  }

  async function stopSession(rawArgs, exec) {
    await ready
    const parent = exec.agent
    if (!parent) throw new Error('stop_session needs a session')
    const sessionId = typeof rawArgs?.session_id === 'string' ? rawArgs.session_id.trim() : ''
    const record = ownedChild(parent, sessionId)
    const stopped = stopChildWork(sessionId, 'stopped by the session that started it')
    if (!stopped.turn && stopped.jobs === 0) return `"${record.title}" is not running a turn or background jobs.`
    const what = [stopped.turn ? 'its running turn (queued messages dropped)' : '', stopped.jobs ? `${stopped.jobs} background job(s)` : ''].filter(Boolean).join(' and ')
    return `Stopped ${what} of "${record.title}".${stopped.turn ? ' Its report for that turn arrives here.' : ''}`
  }

  async function listSessions(_args, exec) {
    await ready
    const parent = exec.agent
    if (!parent) throw new Error('list_sessions needs a session')
    const children = store.childrenOf(parent.id)
    if (children.length === 0) return 'This session has not started any sessions.'
    return children.map(c => {
      const live = ctx.agents.get(c.id)
      const title = (live && titleOf(live.session)) ?? c.title
      const status = c.closed || archived(c.id) ? 'archived' : live ? live.status : 'not loaded'
      const where = c.worktreePath
        ? `${c.worktreePath} (worktree, branch ${c.branch}${c.worktreeMissing ? ', folder missing' : ''})`
        : c.folder
      return [`- "${title}" (${c.id}): ${status}`, `  folder: ${where}`, `  last report: ${c.lastReportAt ?? 'none yet'}`].join('\n')
    }).join('\n')
  }

  async function removeSessionWorktree(rawArgs, exec) {
    await ready
    const parent = exec.agent
    if (!parent) throw new Error('remove_session_worktree needs a session')
    const sessionId = typeof rawArgs?.session_id === 'string' ? rawArgs.session_id.trim() : ''
    const record = ownedChild(parent, sessionId)
    if (!record.worktreePath) throw new Error(`"${record.title}" does not have its own worktree.`)
    if (ctx.agents.get(sessionId)?.status === 'running') throw new Error(`"${record.title}" is still running; stop it or wait for its report first.`)
    const target = { repoRoot: record.repoRoot, path: record.worktreePath, branch: record.branch }
    const blocker = await worktrees.removalBlocker(target, exec.signal)
    if (blocker) return `Not removed: ${blocker}. Nothing was changed.`
    const reply = await askUser(parent, exec.signal, {
      id: 'remove-worktree',
      header: 'Remove worktree',
      question: `Remove the worktree of "${record.title}"?`,
      detail: `${record.worktreePath}\nIt has no uncommitted files and no unpushed, unmerged commits. The branch ${record.branch} is kept.`,
      options: [{ label: REMOVE }, { label: KEEP }],
    })
    if (typeof reply === 'string') return reply
    if (!reply.selected.includes(REMOVE)) return 'The user kept the worktree. Nothing was changed.'
    const done = await worktrees.remove(target, exec.signal)
    await store.update(sessionId, { worktreeMissing: true })
    return done
  }

  const sessionIdOnly = description => ({
    type: 'object',
    properties: { session_id: { type: 'string', description } },
    required: ['session_id'],
    additionalProperties: false,
  })

  const tools = [
    {
      name: 'start_session',
      description: [
        'Start a separate top-level session in the user\'s sidebar and hand it a piece of work. The user can open it and talk to it; it works in parallel with this session.',
        'Its final message of each turn comes back here as a report message; do not poll it.',
        'With initiation "proposal" the user is asked first and may choose to keep the work here; then nothing is started.',
      ].join(' '),
      output: { ...text, presentationMeta: (_args, value) => startOutcome(value) },
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name for the session, at most 60 characters.' },
          prompt: { type: 'string', description: 'The brief: the task, the files or area, and what done looks like. The new session has not seen this conversation.' },
          background: { type: 'string', description: 'What the new session needs from this conversation: decisions, constraints, findings.' },
          folder: { type: 'string', description: 'Absolute folder to work in. Defaults to this session\'s working directory.' },
          worktree: { type: 'boolean', description: 'Run in its own new git worktree and branch of the folder\'s repository. Use it when the session will edit files that another session may also edit.' },
          branch_name: { type: 'string', description: 'Short name for the worktree\'s branch; derived from the title when omitted. Only with worktree.' },
          initiation: { type: 'string', enum: ['user_asked', 'proposal'], description: '"user_asked": the user asked in words for separate or parallel work; it starts now. "proposal": your own idea; the user is asked first.' },
        },
        required: ['title', 'prompt', 'initiation'],
        additionalProperties: false,
      },
      execute: startSession,
    },
    {
      name: 'message_session',
      description: 'Send a follow-up message to a session that this session started (its id is in the start_session result or list_sessions). It runs as that session\'s next turn; the report comes back here.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'Id of a session this session started.' },
          message: { type: 'string', description: 'The message, written for that session.' },
        },
        required: ['session_id', 'message'],
        additionalProperties: false,
      },
      execute: messageSession,
    },
    {
      name: 'stop_session',
      description: 'Stop the running turn of a session this session started and drop its queued messages. The session stays in the sidebar and can be messaged again.',
      parameters: sessionIdOnly('Id of a session this session started.'),
      execute: stopSession,
    },
    {
      name: 'list_sessions',
      description: 'List the sessions this session started: id, title, whether each is running, idle or archived, folder or worktree, and when it last reported. Reports arrive on their own; use this for orientation, not to wait.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: listSessions,
    },
    {
      name: 'remove_session_worktree',
      description: 'Remove the git worktree folder of a session this session started, after the user confirms. Refused when the worktree has uncommitted or untracked files or commits that are neither pushed nor merged; the branch is always kept.',
      parameters: sessionIdOnly('Id of a session this session started with worktree: true.'),
      execute: removeSessionWorktree,
    },
  ]
  for (const tool of tools) ctx.effect(() => ctx.tools.register({ output: text, ...tool }), `tool ${tool.name}`)

  ctx.systemPrompt.context({
    name: 'side-sessions',
    order: 295,
    interpolate: false,
    text: context => (context.agent?.session.header?.origin === 'subagent' ? '' : GUIDANCE),
  })

  // ---- reports ----------------------------------------------------------------------------------
  function queueReport(record, turn, reason, state) {
    const previous = deliveries.get(record.parentId) ?? Promise.resolve()
    const next = previous.then(() => deliverReport(record.id, turn, reason, state)).catch(error => {
      console.warn(`[harness-studio] sessions: report from ${record.id} not delivered:`, error?.message ?? error)
    })
    deliveries.set(record.parentId, next)
    next.then(() => { if (deliveries.get(record.parentId) === next) deliveries.delete(record.parentId) })
  }

  async function deliverReport(childId, turn, reason, state) {
    if (disposed) return
    const record = store.child(childId)
    if (!record || record.closed) return
    if (record.lastReportedTurn !== undefined && turn <= record.lastReportedTurn) return
    const ending = describeEnding(reason)
    if (!ending) return
    if (record.orphaned || archived(record.parentId)) {
      // The parent is gone: end any background work the turn left running, record the turn, deliver nothing.
      stopChildWork(childId, 'the session that started it was archived')
      await store.update(childId, { lastReportedTurn: turn, lastReportAt: new Date().toISOString(), orphaned: true })
      return
    }
    let parent
    try {
      parent = await resolveRoot(record.parentId)
    } catch (error) {
      await store.update(childId, { lastReportedTurn: turn, orphaned: true })
      console.warn(`[harness-studio] sessions: parent ${record.parentId} of ${childId} is gone:`, error?.message ?? error)
      return
    }
    if (disposed) return
    const { text: body, summary } = reportText({
      childId, title: record.title, ending, text: state.text, limit: config.reportChars, userDriven: state.userDriven,
    })
    const message = userMessage(body, { kind: REPORT_SOURCE, form: 'notice', summary, senderSessionId: childId })
    const streak = store.wakeStreak(record.parentId)
    const mode = deliveryMode({
      parentIdle: parent.status === 'idle', userDriven: state.userDriven, aborted: reason?.kind === 'aborted',
      wakeStreak: streak, maxConsecutiveWakes: config.maxConsecutiveWakes,
    })
    if (mode === 'followup') parent.followup(message)
    else parent.inject(message)
    await ctx.sessions.flush(parent.session)
    if (mode === 'followup') await store.setWakeStreak(record.parentId, streak + 1)
    await store.update(childId, { lastReportedTurn: turn, lastReportAt: new Date().toISOString() })
  }

  ctx.on('session/event', (session, event) => {
    if (disposed) return
    const id = session.id
    if (event.type === 'user/message' && event.data?.source?.kind === 'user' && store.wakeStreak(id) > 0) {
      // The user is back in the parent: reports may wake it again.
      store.setWakeStreak(id, 0).catch(() => {})
    }
    const record = store.child(id)
    if (!record || record.closed) return
    let state = turns.get(id)
    if (!state) turns.set(id, state = { text: '', userDriven: false })
    if (event.type === 'step/start' && (record.orphaned || archived(record.parentId))) {
      // The parent was archived while this Session works for it: end its work at this step boundary.
      setImmediate(() => { stopChildWork(id, 'the session that started it was archived') })
    } else if (event.type === 'user/message') {
      if (event.data?.source?.kind === 'user') state.userDriven = true
    } else if (event.type === 'assistant/message') {
      const said = contentText(event.data?.message?.content)
      if (said !== '') state.text = said
    } else if (event.type === 'turn/end') {
      turns.delete(id)
      queueReport(record, event.data.turn, event.data.reason, state)
    }
  }, { global: true })

  // An unloaded Session's half-finished turn state is not kept.
  ctx.on('session/disposed', session => { turns.delete(session.id) }, { global: true })

  // Harness asks every plugin to stop a Session's activity when it is archived with its work stopped.
  ctx.on('workspace/session-stop', async ({ sessionId }) => {
    await ready
    if (disposed) return
    const own = store.child(sessionId)
    if (own) {
      turns.delete(sessionId)
      await store.update(sessionId, { closed: true })
    }
    await orphanChildrenOf(sessionId)
  })

  // An archive without stopping work first asks every plugin what the Session is doing. A parent's
  // started Sessions are not its own activity, so the answer is unchanged; once the archive is written,
  // their work is stopped at once instead of at their next step.
  ctx.on('workspace/session-activity', async ({ sessionId }, next) => {
    const activity = await next()
    if (!disposed && store.childrenOf(sessionId).some(c => !c.closed)) {
      setTimeout(() => {
        if (!disposed && archived(sessionId)) orphanChildrenOf(sessionId).catch(() => {})
      }, ARCHIVE_SETTLE_MS).unref?.()
    }
    return activity
  })
}
