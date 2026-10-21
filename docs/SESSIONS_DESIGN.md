# Side sessions for Harness — design (2026-10-16)

Status: **approved 2026-10-16 with the recommended answers in [section 9](#9-decisions-for-the-owner); built as [plugins/sessions](../plugins/sessions)**. The owner's later hard requirements changed worktree placement and added lifetimes rules: see [section 11](#11-changes-after-approval-2026-10-16), which overrides the earlier sections where they differ.

Goal: let the Harness agent hand a piece of work to a separate, top-level Session in the sidebar, the way Claude Code desktop's "start a session" does — a written brief, an optional git worktree, an approval card when the agent proposes the split itself, and a short report back into the parent Session when the child finishes a turn.

All paths below are relative to `harness/packages/` at the pinned commit (see [HARNESS_PIN.md](HARNESS_PIN.md)) unless they start with `plugins/`.

## 1. What Harness already has, and why none of it is enough

| Mechanism | Where | What it does | Gap |
|---|---|---|---|
| Subagents (spawn / fork) | `subagent/subagent`, `subagent/tool-subagent`, `client/ui-subagent` | Child Agent with its own durable Session; result returns to the parent as a `subagent-settled` notice (`subagent/subagent/src/continuation-messages.ts:138`) | Every child is created with `origin: 'subagent'` (`subagent/subagent/src/child-agent.ts:135`), which hides it from the sidebar (`client/ui-workspace/src/client/tree.ts:244`) and makes generic Session routing refuse it (`api/session-controller/src/agent.ts:110`). Only reachable through the "N subagents" switcher; the user cannot simply open and talk to it |
| Agent Teams (experimental) | `experimental/agent-team`, `experimental/tool-agent-team` | Lead, named teammates, inbox messages, task board | Teammates are subagent children (`experimental/agent-team/src/roster.ts:229`), so also hidden; one shared checkout, no worktree (its README's Known Limitations) |
| Worktrees (experimental) | `experimental/worktree`, `experimental/tool-worktree` | `ctx.worktrees.create(agent, { name })` adds a worktree under `<repo>/.agents/worktrees/` and moves that Agent's working directory into it | Moves the *current* Session; no remove API; optional bundle, likely not mounted in the owner's profile |
| Scheduled follow-ups | `schedule/schedule` | Wakes an existing Session with a `schedule` message (`schedule/schedule/src/runtime.ts:101-124`) | Same Session only |
| Webhook Sessions (experimental) | `experimental/webhook/src/session.ts:117-183` | Creates an ordinary, sidebar-visible root Session from Host code, titles it, and sends a first message with its own message-source kind | Triggered by webhooks, not by the agent |

The two in-tree templates this design copies are the **webhook** Session creation (create → attach to Workspace → title → first message) and the **schedule / tool-jobs** wake-up (resolve the target Agent, cold-resuming it if needed → `followup` when idle, `inject` when busy, with a wake budget — `jobs/tool-jobs/src/index.ts:263-307`).

## 2. Shape: one out-of-tree plugin, no Harness patch for the core

New package `plugins/sessions` (`@harness-studio/sessions`), laid out like `plugins/devpreview` and `plugins/connectors`: plain JavaScript, a Host half (`index.js`), an optional Client half (`client.js`), `cordis.patch.yml`, locale files, README.

Host half injects `tools`, `agents`, `sessionController`, `sessionTitle`, `workspaceRegistry`, `workingDirectory`, `permissionPresets`, `userQuestions`, `sessions`, `systemPrompt`. Everything in sections 3–6 uses existing public services; nothing needs a change inside Harness. Section 8 lists the two things that would.

## 3. Model-facing tools

### `start_session`

| Input | Type | Rules |
|---|---|---|
| `title` | string, required | ≤ 60 characters; becomes the sidebar title |
| `prompt` | string, required | The brief: the task, the files or area, what "done" looks like. ≤ 20 000 characters |
| `background` | string, optional | What the new Session needs to know from this one (decisions, constraints). Prepended to the brief. ≤ 8 000 characters |
| `folder` | absolute path, optional | Defaults to this Session's current working directory. Must exist and be a directory |
| `worktree` | boolean, optional, default `false` | Run the new Session in its own git worktree of `folder`'s repository. Use it whenever the new Session will edit files that this Session or another writer may also edit |
| `branch_name` | string, optional | Slug for the worktree branch; derived from `title` when omitted. Only with `worktree` |
| `initiation` | `'user_asked'` \| `'proposal'`, required | `user_asked`: the user asked in words for separate/parallel work — start now. `proposal`: the agent decided to split the work off — ask the user first (section 5) |

Result (text the model reads):
- started: `Started session "<title>" (<sessionId>) in <folder>[ on branch <branch>]. Its report arrives here as a message after each of its turns; do not poll it.`
- declined: `The user chose to do this here. Continue the task in this session.`

Refusals (tool error, nothing created): caller is a subagent or teammate (only root Sessions may start Sessions, which also keeps the approval card valid — `userQuestions` requires a live root agent, `interaction/user-questions/src/index.ts:295`); depth limit reached; live-children limit reached; `worktree` on a folder that is not inside a git repository; branch already exists.

### `message_session`

`session_id` (must be a Session **this** Session started, from the plugin's record) and `message`. Delivered to the child with `followup` (starts a turn if idle, queues one if busy). Used for follow-ups and answers; the child's next report comes back the same way.

### `list_sessions`

No input. The Sessions this one started: id, title, folder, branch, `running`/`idle`, last report time. For orientation only — the prompt text tells the model not to poll it.

### Model guidance

One system-prompt context entry (like Dev Preview's `browsing-default`), only when the tools are mounted: quick things stay here; independent pieces go to their own Session; two writing Sessions never share a checkout (use `worktree`); never poll; a report is the child's claim, so check the diff or result before telling the user it is done.

## 4. How a Session is created

All of it runs inside `ctx.agents.withoutInitiator(...)` so the new Agent is a root, not runtime-owned by the parent (otherwise disposing the parent would dispose the child — `core/agent/src/index.ts:344`).

1. **Resolve the folder.** `folder ?? await ctx.workingDirectory.ensure(parent, signal)`; `realpath`, must be a directory.
2. **Worktree (optional)** — see section 4.1. Produces `worktreePath` and `branch`.
3. **Workspace.** `ctx.workspaceRegistry.create(folder)` returns the existing Workspace for that path or creates one, so the new row lands in the same sidebar group as the folder's other Sessions.
4. **Create.** `ctx.sessionController.create({ workspaceId })` — the same call the sidebar's New session button makes (`api/session-controller/src/commands.ts:111`), so the Agent is composed with the default agent preset and model exactly like a user-made Session, owned by the Session controller, and attached to the Workspace. Then `ctx.sessionController.resolveAgent(sessionId)`.
5. **Match the parent.** `ctx.permissionPresets.set(child.session, ctx.permissionPresets.current(parent.session))` — the child never runs with a looser permission preset than the Session that started it. The model selection stays the user's default (no model choice in v1).
6. **Move into the worktree** when one was made: `ctx.workingDirectory.set(child, worktreePath)` (the mechanism Harness's own experimental worktree service uses).
7. **Title.** `ctx.sessionTitle.rename(child.session, title)`.
8. **Record** `{ childId, parentId, title, folder, worktreePath?, branch?, depth, createdAt, reportedTurns, wakeStreak }` in the plugin's store (`<home>/harness-studio/sessions.json`, written atomically like `plugins/connectors/store.js`).
9. **Brief.** `child.followup(createUserMessage({ content: [{ type: 'text', text }], source }))` with source `{ kind: 'harness-studio-brief', form: 'relay', senderSessionId: parentId }`. `text` = a two-line header ("This task comes from the session "<parent title>". Your final message of each turn is sent back to it as your report.") + `background` + `prompt`. The `followup` starts the first turn, which clears the Session's `blank` flag, so the row appears in the sidebar at once (`api/session-controller/src/list.ts:51`, `tree.ts:245`); the server already pushes `api-session/added` and status changes to every client.
10. **Rollback** on any failure after step 4: detach from the Workspace, dispose the Agent, remove a worktree created in step 2, drop the record — the webhook package's order.

### 4.1 Worktree handling

*Superseded in part by [section 11](#11-changes-after-approval-2026-10-16): worktrees now live outside the repository and the experimental worktree service is not used.*

- Repository root: `git -C <folder> rev-parse --show-toplevel`; refuse when it fails.
- If `ctx.worktrees` exists (the experimental worktree bundle is mounted), use it on the new Agent after step 4 instead of the plugin's own command, so both features share one layout.
- Otherwise the plugin runs `git worktree add -b <prefix><slug> <repoRoot>/.agents/worktrees/<slug> HEAD` itself (same directory layout as Harness's service; `prefix` defaults to `harness/`). Branch and directory names are validated slugs; the command runs with `execFile`, never a shell.
- **Where the Session lives (decision 1):** recommended — the Session's stored folder (its header `cwd`) stays the repository root, and only its *working directory* moves into the worktree. Harness requires a Session's stored folder to equal its Workspace's path (`workspace/workspace/src/entity.ts:110-140`), so this keeps the row in the project's sidebar group, as Claude Code desktop does. Tools, shell and the system prompt follow the working directory. Cost: Dev Preview's Changes and Files panes read the stored folder (`plugins/devpreview/client.js:480`) and would show the main checkout; the fix is a small change in our own Dev Preview plugin to read the `workingDirectory` Session projection, which Harness already sends to clients (`session/working-directory/src/index.ts:82`).
- **Cleanup:** never automatic. A worktree with commits or uncommitted edits is the user's work. `list_sessions` shows the path and branch; removing them is left to the user (or a later `/sessions cleanup` command that only removes clean, merged worktrees).

## 5. The approval card

For `initiation: 'proposal'` the tool calls, before anything is created:

```js
ctx.userQuestions.ask({
  agent: parent, signal,
  questions: [{
    id: 'start-session',
    header: 'New session',
    question: `Start "${title}" as a separate session?`,
    detail: `${folder}${worktree ? ' · new worktree' : ''}\n\n${prompt.slice(0, 600)}`,
    options: [{ label: 'New session' }, { label: 'Do it here' }],
  }],
})
```

This is Harness's own `ask_user_question` card (`interaction/user-questions`, client `client/ui-user-questions`): it takes over the composer in the parent Session, survives the Host/Client channel without any new forwarded event, and the tool waits for the answer exactly as Claude Code's offer card does. "New session" → section 4; "Do it here", a dismissal or cancellation → the declined result. `user_asked` skips the card.

Why not a custom card: Host→Client events are a closed allowlist (`api/remotes/src/remote-events.ts:25-52`), so a plugin cannot push its own; reusing `userQuestions` needs no patch and no new UI.

Not in v1: Claude Code's *non-blocking* proposal card (the agent keeps working while a "start this later" card waits in the transcript). It needs a custom card in the tool-call slot plus a way for the click to reach the Host with arguments (our plugins' local helper pattern can do that). Deferred to phase 2.

Done 2026-10-20: `initiation` now has three values, as in Claude Code desktop. `offer` is the blocking card above (`proposal` is still read as it). `own_initiative` saves the proposal in the plugin's record and returns at once; the Client half draws the tool-call row as a card with Dismiss / Start, and Start reaches the Host through the plugin's own Remote service (`harnessStudioSessions/call`, action `startProposal`), which creates the Session from the saved brief. At most three per turn, none repeated, each startable for a week.

## 6. The report back to the parent

- **Trigger.** `ctx.on('session/event', handler, { global: true })` filtered to `turn/end` events of recorded children (the listener `interaction/user-questions/src/index.ts:111` uses). One report per child turn; `reportedTurns` in the record prevents duplicates after a restart.
- **Content.** The child's last non-empty assistant message of that turn (`finalAssistantOutput` from `@deepseek-ai/dsh-subagent`, `subagent/subagent/src/assistant-output.ts:67`, over the turn's events), cut to `reportChars` (decision 2). Plus how the turn ended (`completed`, `stopped`, `failed: <message>`), the child's id and title.
- **Framing.** The report is fenced and labelled as the other Session's output — data, not instructions — and the parent is told to verify before reporting work as done (same fencing approach as Dev Preview's page data).
- **Delivery.** `ctx.sessionController.resolveAgent(parentId)` (cold-resumes a parent that is not loaded), message source `{ kind: 'harness-studio-report', form: 'notice', summary: '<title> finished a turn' }` so the parent shows a one-line row like other notices, then `ctx.sessions.flush(parent.session)`.
  - Parent idle → `followup` (wakes it; it continues the task).
  - Parent running → `inject` (arrives at its next step; no extra turn).
  - Child turn was started by the user typing in the child, or was stopped → `inject` without waking: the user is driving that Session, the parent sees it on its next turn.
  - **Wake budget:** at most `maxConsecutiveWakes` (default 5) report-wakes of a parent without a user message in between; after that reports are injected without waking. Prevents two agents ping-ponging forever.
- **Parent gone** (deleted or archived): the report is dropped and the record marked orphaned; the child keeps working as an ordinary Session.

## 7. Limits (validated plugin config, `cordis.patch.yml`)

| Field | Default | Meaning |
|---|---|---|
| `maxDepth` | 2 | A started Session may start Sessions of its own, up to this depth |
| `maxLiveChildren` | 6 | Started Sessions per parent that are running at once |
| `reportChars` | 1000 | Characters of the child's final message in a report |
| `maxConsecutiveWakes` | 5 | Report-wakes of a parent without a user message in between |
| `branchPrefix` | `harness/` | Prefix of worktree branches the plugin creates |

Other limits: the child uses the user's default model (no per-Session model choice in v1); Sessions are local to this Harness (no cloud, no SSH host); the plugin's record is the only parent/child link — Harness itself does not know the relation (section 8).

## 8. What would need a Harness patch (not in v1)

| Want | Why a plugin can't | Patch |
|---|---|---|
| Started Sessions nested under their parent in the sidebar | The sidebar tree deliberately builds groups "without projecting session lineage" (`client/ui-workspace/src/client/tree.ts:300`), compiled into the client | `patches/harness-session-nesting.patch`: indent rows whose parent is known. Also needs the relation in the Session header (`meta.parentSession`), which `sessionController.create` cannot set; the plugin would then create the Agent with `ctx.agents.create` directly as the webhook does. Without the patch the children are ordinary rows in the same Workspace group |
| A built-in "Linked sessions" strip in the parent, Claude-style | Same as above; a plugin can only add a header action through an existing slot | Could be done patch-free later with a Client-half header action (like the subagent switcher's slot), reading the plugin's record over a Remote method |

Nothing in sections 3–6 needs a patch.

## 9. Decisions for the owner

1. **Worktree Session placement** — *recommended:* stored folder stays the repository, working directory moves into the worktree (same sidebar group; follow-up change to Dev Preview's panes). Alternative: the worktree becomes the Session's own folder (correct panes with no Dev Preview change, but every worktree appears as its own sidebar group).
2. **Report length** — *recommended:* 1000 characters (Claude Code relays 400; Harness's notices are cheap and the parent needs substance).
3. **Scope of v1** — *recommended:* `start_session` (both initiations, worktree), `message_session`, `list_sessions`, report-back, no Client half. Phase 2: non-blocking proposal card, start-session tool card with an Open link, Dev Preview working-directory change, optional nesting patch.

## 10. Build and verification plan (after approval)

1. `plugins/sessions/` with Host half, store, README, `cordis.patch.yml`; unit tests (`node --test`) for slug/branch validation, report framing and truncation, wake-budget rules, store round-trip.
2. Install into the owner's desktop profile from the folder (**Plugins → Add plugin → Enable now**; no app restart — asked before doing it).
3. Manual run in the app: a `user_asked` start (row appears, title set, brief shown as a relay message), a `proposal` start (card; both answers), a `worktree` start (branch and folder exist, child's shell runs there), a report waking an idle parent, a report injected into a busy parent, the wake budget stopping a loop.
4. Risks to check first: a plugin-declared message-source kind renders as a notice/relay row in the client (Harness says consumers fall through unknown kinds, `llm/llm/src/message.ts:103-108`); `sessionController.create` and `prompt` behave outside a Remote invocation (the schedule package already calls `resolveAgent` this way).

## 11. Changes after approval (2026-10-16)

The owner added four hard requirements: processes and agent turns end cleanly, worktrees are non-destructive, and a restart reconciles state. They changed the build as follows.

| Requirement | What the plugin does |
|---|---|
| Child processes end cleanly | Every git process goes through one runner (`plugins/sessions/process.js`): timeout, abort signal, own process group on POSIX with group-wide SIGTERM then SIGKILL, `taskkill /T /F` on Windows, and every live process stopped on plugin disposal, Host shutdown and synchronously on Node exit |
| Child agent sessions end cleanly | New `stop_session` tool: Harness cancellation (cause `parent`) plus killing the child's running background jobs through `ctx.jobs`. Archiving a child (Harness's `workspace/session-stop`) releases its turn state and closes its record. Archiving a parent stops its children's turns and jobs: at once for an archive with stop, and about 1.5 s after an idle archive (detected through the `workspace/session-activity` question Harness asks first), with a check at every child step as a backstop. A child that finishes after its parent is gone records the turn, has its jobs killed, and delivers nothing |
| Non-destructive worktrees | Worktrees live in a dedicated folder outside the repository, `<Harness home>/harness-studio/worktrees/<repo>-<hash>/<name>`, so the main checkout is never written (not even its exclude file). Taken names get a numeric suffix. No forcing, reset, checkout, clean, prune or branch force-delete anywhere (a test scans the source). Removal only through the new `remove_session_worktree` tool, after a confirmation card, only when the worktree has no uncommitted or untracked files and no commits that are neither pushed nor merged; the branch is kept. Harness's experimental worktree service is not used |
| Idempotent restart reconciliation | At Host start: records of Sessions Harness no longer lists are dropped, missing worktrees are marked, parents that are gone orphan their children; nothing on disk is deleted or recreated, and an empty listing drops nothing |

In-app check, 2026-10-16 (development desktop app): user_asked start, both card answers, worktree session, report waking an idle parent, parent archived while its child worked (turn stopped, report recorded not delivered), and `stop_session` killing a child's background job all behaved as described. The brief and reports render as Harness's generic "Execution requested" rows. That check also found the background-job gap that the job-killing above closes.

## 12. The refined approval card (2026-10-16)

The owner found Harness's generic question form unrefined for this choice (numbered options, a free-text box, a pager, a Submit step, the raw folder path). The plugin now has a Client half that draws its own card for this one question, modelled on Claude Code desktop's: eyebrow, title, a two-line brief, one short context line, and Options / Do it here / Start, with × declining and Enter starting. No Harness patch was needed: Harness picks the card shown in place of the message box from a chain of selector-routed slot entries ordered by priority, so the plugin registers an entry ahead of Harness's that matches only its own question id and answers through the same question carrier. The Host half sends the folder shortened (`~/…` or only its name) and reads a worktree switch from the card's Options. A `start_session` call collapses to one line in the transcript (Started · Open, or Kept here) through the keyed tool-row slot. Checked in the development app in light and dark mode.

Revised the same day after owner feedback that the card was not compact enough: it now sits in the chat column above the message box (at most 680px wide, about 160px tall) with a hairline border, a tinted header strip holding the label and ×, a 14px title, and 28px buttons. Harness hides its composer while a card holds the seat but keeps it mounted next to the card; a style rule scoped to this card shows it again and orders the card first.
