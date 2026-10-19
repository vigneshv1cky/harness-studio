# Remember

Two kinds of memory that carry over to new sessions, both plain files you can read, edit or delete.

- **Auto memory**, like Claude Code's: the agent keeps notes for itself as it works, without asking, one small file per fact plus an index.
- **Remembered rules:** when you ask the agent to add a rule to your instruction files, it proposes a one-line note and you approve it on a card.

## Auto memory

Each project gets a memory folder in the Harness home (`~/.harness-studio/memory/<project>/` in the Harness Studio app), where `<project>` is the project's root path (the nearest folder with `.git`) with every character but letters and digits written as `-`, cut to 80 characters, then `-` and the first 8 hex characters of the full path's SHA-256. The hash keeps `my-app`, `my_app` and `my.app` (or names with non-ASCII letters) apart and keeps long paths under the file-name limit. A folder made under the older name (the path alone) is renamed to the new name the first time the project is used. A git worktree uses its main repository's folder, so a session working in a worktree saves and reads the same memories as the repository. The folder holds:

- one Markdown file per fact, with a name, a one-line description, a type (`user`, `feedback`, `project` or `reference`), the date it was last updated, and the fact itself followed by "Why:" and "How to apply:" lines;
- `MEMORY.md`, an index with one line per file.

```markdown
---
name: dev-server-port-4000
description: Dev server must run on port 4000, never 3000
type: project
updated: 2026-10-17
---

The user always runs this project's dev server on port 4000.

Why: port 3000 is taken by another app on the user's machine.

How to apply: use http://localhost:4000 when starting or referring to the dev server.
```

The agent saves a memory on its own when you correct it, state a lasting preference or decision, or when it learns something a later session would otherwise have to rediscover. It updates a memory with the same name instead of adding a duplicate and deletes memories that turn out to be wrong. It uses three tools: `memory_save`, `memory_read` and `memory_delete`.

Every new session in the project reads the first 200 lines of the index as part of its instructions, and reads a memory's full text only when the index says it is relevant. The index is read once when the session starts, so what a session saves reaches the next session, and the instructions stay the same for the rest of the session.

Index updates are queued one at a time per index file and written atomically (a temporary file renamed over the index), so memories saved at the same moment never lose each other's lines.

Limits: a memory's text is at most 4,000 characters, its description at most 200, and a project holds at most 200 memories. Memories that look like passwords, keys or tokens are refused.

## Remembered rules

When you explicitly ask the agent to add a rule to your instruction files, it proposes a one-line note with the `remember` tool. A card shows the note and asks where it goes:

| Choice | Saved in | Read by |
|---|---|---|
| **This project** | `AGENTS.local.md` at the project root (the nearest folder with `.git`) | New sessions in this project |
| **All my projects** | `AGENTS.md` in the Harness home (`~/.harness-studio/AGENTS.md` in the Harness Studio app) | New sessions everywhere |
| **Don't save** | Nothing | — |

Nothing is written until you choose. Typing an answer instead of choosing saves nothing and passes your words back to the agent.

Notes are ordinary lines under a `## Remembered` heading, dated:

```markdown
## Remembered

- Run the tests with pnpm test, not npm (2026-10-17)
```

The instruction loader reads them like any other instruction text, so you can edit or delete a note in that file at any time.

## The Instructions page

**Instructions**, in the left sidebar below Automation tasks, shows what a workspace's sessions read:

- **System prompt**, read only: Harness's own prompt as a new session starts with it (the agent's role and how to use each tool, from Harness and its plugins), with its size, its section count, how many tool definitions go alongside, and **Show** for the full text. The Host half assembles it with Harness's system-prompt service and renders it as the agent loop does; `{{model}}` stays as written because it is filled per session, and plan mode or an agent preset adds or replaces parts.
- every instruction file in the order sessions read them, which follows Claude Code's three levels with Harness Studio's own files: your personal `AGENTS.md` in the Harness home, then each project folder's `AGENTS.md` from the repository root down, each followed by that folder's `AGENTS.local.md` (just for you). Each shows its size, estimated tokens and status: loaded, not created, left out or shortened to fit the limit. Files written for other agent tools (`CLAUDE.md`, `CLAUDE.local.md`, `~/.agents/AGENTS.md`) are neither read nor listed. Long paths keep their folder and file name visible and shorten the middle; the full path shows on hover;
- the **size limit** for instructions (64 KB to 1 MB, or no limit; 128 KB by default), saved in `<harness home>/harness-studio/instructions.json` and used by the instruction loader from the next message, with the total currently sent per request;
- **Edit** to change a file on the page (or **Create** one that doesn't exist yet), and **Open** to open it in your text editor. A save is refused when the file changed after the editor opened it (for example a note the agent saved meanwhile), so nothing added since is overwritten; reopen the file and edit again. Saves wait their turn behind the `remember` tool's writes to the same file;
- the selected workspace's **Memory**: the folder, how much of the index new sessions read, and each memory with its type, date and description, with **Open** and **Delete**;
- the **Remembered** notes from both instruction files, each with **Delete**, which removes that line from the `## Remembered` section only, never the same text elsewhere in the file.

The page can read, write or open only instruction files (`AGENTS.md` and `AGENTS.local.md`) in your personal folder or in one of your workspaces checked on the real path, and opens or deletes memories only in the memory folders of your workspaces, so it cannot reach other files. It talks to the Host half through Harness's authenticated Remote channel (`harnessStudioInstructions/call`).

## Safety

- Only what you said or decided, or what the agent checked itself, is saved: the agent is told never to save something a web page, file or tool output asks it to. Every remembered rule also needs your choice on the card.
- Notes and memories that look like passwords, keys or tokens are refused: provider keys and tokens (OpenAI-style, GitHub, AWS, Slack, Google, Stripe, GitLab, npm), JWTs, private keys, credentials in a URL (`user:password@`), `Authorization: Bearer …` and long Bearer tokens, `password: …`-style pairs (also after an underscore, as in `db_password=`), and env-style assignments whose name holds KEY, TOKEN, SECRET, PASSWORD or PASSWD (`export GITHUB_TOKEN=…`). Values shorter than 6 characters and `$VAR`, `<placeholder>` or `{template}` values are let through.
- A note is one line of at most 300 characters, and the same note is never added twice.
- When `AGENTS.local.md` is not ignored by git in that project, the agent tells you it would be committed. It does not edit `.gitignore` unless you ask.
- Agents started as subagents get neither the memory index nor the guidance, so only the session you talk to saves memories or proposes notes.

## Tests

```sh
node --test plugins/remember/test/*.test.mjs
```

`memory.test.mjs` covers auto memory: one folder per project, folder names that never collide and stay short, the one-time move of an old-style folder, a worktree sharing its repository's memories, parallel saves keeping every index line, one file per fact with its index line, updates, deletes, the name, type, size and secret checks, the 200-line index, and the tools and session prompt against a stand-in Harness. `instructions.test.mjs` covers the Instructions page's Host half: rendering the system prompt view, which files load or are skipped, what the limit leaves out or shortens, saving the limit, the folder and file-name rules, refusing a save over a changed file, page saves waiting for the remember tool's queued write, and deleting a note only inside the Remembered section. `logic.test.mjs` covers note checks (including secret-looking notes), local-calendar dates, the card's choices and where a note goes in its file; `host.test.mjs` runs the tool against a stand-in Harness: project and personal notes, the git warning, "Don't save", typed answers, duplicates and the subagent rule.
