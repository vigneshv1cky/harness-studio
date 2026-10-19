# Hooks

Your own shell commands that run at fixed points in the agent's work, like Claude Code's hooks:

| Event | Runs | Can |
|---|---|---|
| `PreToolUse` | Before a tool call, for the tools its matcher selects | Block the call, with a reason the agent reads, or ask you first on an approval card |
| `PostToolUse` | After a successful tool call, for the tools its matcher selects | Report a problem the agent must deal with, or add context for its next step |
| `Stop` | When the agent is about to finish its turn | Send it back to work with a reason, for example failing tests |

Typical uses: format every file the agent edits, refuse force-pushes or edits to production config, run the linter after edits, keep the agent working until the tests pass.

## Where hooks are read from

| File | For | Runs |
|---|---|---|
| `~/.harness-studio/hooks.json` (in the Harness home) | Every project | Always |
| `<project>/.harness-studio/hooks.json` | This project, shared through the repository | After you allow it |
| `<project>/.harness-studio/hooks.local.json` | This project, just you | After you allow it |

The project is the nearest folder with `.git` above the session's working folder. A project's hooks run commands that came with the repository, so the first time a session in that project uses a tool, a card lists the file's commands and asks whether to run them. Allowing is remembered in `~/.harness-studio/harness-studio/hooks-trust.json` until the file changes; declining lasts until Harness Studio restarts. Helper agents never ask; they skip project hooks that have not been allowed.

Files are re-read when they change, so edits take effect on the next tool call. `"disableAllHooks": true` in any of the files turns every hook off.

## The format

The same as the `hooks` block of Claude Code's settings, so hooks can be copied between the two:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "~/.harness-studio/hooks/no-force-push.sh" }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "jq -r .tool_input.file_path | xargs npx prettier --write", "timeout": 30 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "npm test --silent >&2 || exit 2" }] }
    ]
  }
}
```

- **`matcher`** selects tools for `PreToolUse` and `PostToolUse`: a regular expression that must match the whole tool name, tried against both Harness's name (`bash`, `edit`, `write`) and Claude Code's spelling (`Bash`, `Edit`, `Write`). Empty or `*` matches every tool. `Stop` hooks take no matcher.
- **`timeout`** is in seconds: 60 by default, at most 600. A hook that runs longer is stopped along with any processes it started.
- All hooks that match one event run at the same time.

## What a hook receives

The event as JSON on standard input, run with your shell in the session's working folder, with `CLAUDE_PROJECT_DIR` and `HARNESS_PROJECT_DIR` set to the project folder:

```json
{
  "session_id": "…",
  "cwd": "/path/to/project",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "harness_tool_name": "bash",
  "tool_input": { "command": "git push --force" }
}
```

`PostToolUse` adds `tool_response` with the tool's text `output` (at most 100,000 characters) and, when the tool returns one, its `value`. `Stop` adds `stop_hook_active`, true when a Stop hook already sent the agent back to work in this turn.

## What a hook returns

| Result | `PreToolUse` | `PostToolUse` | `Stop` |
|---|---|---|---|
| Exit code 0 | The call goes ahead | Nothing changes | The turn ends |
| Exit code 2 | Blocked; standard error is the reason the agent reads | The agent is told the call ran but there is a problem, with standard error | The agent continues, with standard error as the reason |
| Any other exit code, a timeout, or a command that cannot start | Nothing is blocked; the failure is logged | Same | Same |

On exit code 0 a hook may instead print a JSON object, as in Claude Code:

- `PreToolUse`: `{"hookSpecificOutput": {"permissionDecision": "deny" | "ask" | "allow", "permissionDecisionReason": "…"}}`. `ask` shows an approval card with the reason. The older `{"decision": "block" | "approve", "reason": "…"}` also works.
- `PostToolUse` and `Stop`: `{"decision": "block", "reason": "…"}`.
- `PostToolUse`: `{"hookSpecificOutput": {"additionalContext": "…"}}` adds the text for the agent's next step.

When several hooks answer, a block or denial wins over `ask`, which wins over going ahead; every reason is kept.

To avoid an endless loop, Stop hooks can send the agent back at most three times in one turn; after that the turn ends. Stop hooks don't run for helper agents.

## Command rules

Rules that block a tool call or ask you first, without writing a script, in Claude Code's `permissions` format, so rules can be copied between the two:

```json
{
  "permissions": {
    "deny": ["Bash(git push --force:*)", "Bash(curl:*)", "Read(./.env)", "Read(~/.ssh/**)", "WebFetch(domain:pastebin.com)"],
    "ask": ["Bash(git push:*)", "Edit(./migrations/**)", "mcp__github__create_issue"]
  }
}
```

They are read from `~/.harness-studio/permissions.json` (yours), and the project's `.harness-studio/permissions.json` (shared) and `.harness-studio/permissions.local.json` (just you). Rules only take away, so a project's rules apply without a card. They are checked before hooks; a change to a file applies from the next tool call. A project's rules only add up during a session: a rule removed from its file (by the agent's shell, say) keeps applying until the next session. Changing any hooks or rules file through the agent's file tools asks you first.

| Rule | Covers |
|---|---|
| `Bash(npm run test:*)` | A command starting with `npm run test`. Without `:*` the whole command must match; `*` inside matches any text. Each part of a compound command is checked on its own: parts joined by `&&`, `\|\|`, `;`, `\|` or new lines, and what runs inside `( )`, `{ }`, `$( )` (even inside double quotes), backquotes, `<( )`, a shell's `-c "…"` script and `eval`. Wrapper programs (env, command, exec, sudo, doas, nohup, nice, time, timeout, xargs, stdbuf) and quotes are looked through, and a program named by path matches its name, so `cd x && sudo /usr/bin/git push` matches `Bash(git push:*)`. Covers the shell and PowerShell tools, programs started in the agent's terminal, each line it types there (checked when Enter is pressed), and Watch commands |
| `Read(path)`, `Edit(path)` | Paths in `.gitignore` style: `~/…` from your home folder, `//…` absolute, anything else from the project root; `**` crosses folders, and a pattern without `/` matches at any depth. `Read` covers read, read image, glob and grep; `Edit` covers write and edit |
| `WebFetch(domain:example.com)` | That host and its subdomains, for web fetches and pages the agent opens in the Browser pane |
| `mcp__server`, `mcp__server__tool` | A connector's tools |
| `Bash`, `WebFetch`, … | Every call of that tool |

Deny wins over ask. File rules ignore upper and lower case on macOS and Windows, and a link is checked as the file it points to; search results (grep and glob) leave out files a `Read` rule denies or asks about. Rules are a guard, not a sandbox: a determined program can still find another way, so pair them with the sandbox and Network for commands. `allow` rules are accepted, so a block copied from Claude Code loads, but change nothing: commands inside the sandbox already run without asking. A file rule covers the file tools only; `cat .env` in a command is a `Bash` rule's job (`Bash(cat .env)`), and the sandbox's own limits apply to everything else.

## Safety

- Hooks run your commands as you, outside the agent's sandbox, as in Claude Code. Only your own file runs without asking.
- A project's file runs only after you allow it on a card, and a changed file is asked about again. The approval covers the scripts inside the project its commands name (`./check.sh`, `scripts/lint.mjs`), so changing one of them asks again too; a script those scripts start is covered for itself only.
- A project file that only turns hooks off (`disableAllHooks`) is asked about like any other; until you allow it, your own hooks keep running.
- Hooks whose matcher is `Bash` also run for the other tools that start a shell command: PowerShell, the agent's terminal (each typed line) and Watch commands.
- A hook's standard output and error are kept up to 64 KB each.

## Not supported yet

Claude Code's other events (`UserPromptSubmit`, `SessionStart`, `SessionEnd`, `SubagentStop`, `Notification`, `PreCompact`), prompt-type hooks, and the `continue`, `stopReason` and `suppressOutput` fields. A file that uses them still loads: unsupported events are skipped with a warning in the log, and unsupported fields are ignored.

## Tests

```sh
node --test plugins/hooks/test/*.test.mjs
```

`rules.test.mjs` covers reading rules, splitting compound commands, prefix and wildcard commands, path patterns, domains and connectors, and deny winning over ask. `logic.test.mjs` covers reading files, matching tools in both spellings, exit codes and JSON decisions, and combining several hooks. `host.test.mjs` runs real hook commands against a stand-in Harness: blocking and asking before a call, feedback and context after one, Stop hooks and their limit, asking before a project's hooks run and remembering the answer, turning hooks off, and stopping a hook that runs too long, and command rules from your home folder and a project.
