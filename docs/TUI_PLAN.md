# Terminal UI plan

Status: stages 1–3 done (2026-10-19; fork commits 25f27aa, daf01ec, 3a4c06e and a prompt fix); stage 4 done (fork commits f5a39cb, e5a54ba and build fixes up to dccdae4); a PTY test in the repository is deferred. Since the fork (2026-10-18) each stage is a commit on the fork's `studio` branch, not a patch file.

## Starting point

`harness-studio` with no task at an interactive terminal opens the line chat from [desktop patch 29](../desktop/patches/29-terminal-chat.patch) (`harness/packages/bundle/headless/src/`: `index.ts`, `runner-internals.ts`, `startup.ts`). Each line is one turn in one Session. Reasoning streams to stderr; the answer prints only when the turn ends. With no approval answerer, every approval fails closed. Only `/exit` exists.

Upstream removed its full-screen terminal app and the `dsh-tui` package (patched `pi-tui`) in August 2026 for maintenance cost (`.agents/notes/archived/simplification/2026-08-04-remove-tui-package.md`). The command, question and approval services it used remain in the base bundle.

Need check: the desktop app stays the main surface and the chat ships unpublished in 0.3.0. Each stage below should follow real use of the previous one.

## Risky defaults to flag first

1. **Model text goes to the terminal raw today.** An injected page can make the model emit escape sequences that clear the screen, set the title, write the clipboard (OSC 52) or draw a fake prompt. Upstream's TUI turned C0/C1 control characters into visible escapes before printing. Every stage must do the same for answers, reasoning, tool lines and prompts.
2. **An approval must never be answered by text typed before it appeared.** Discard queued input, then ask. The default (Enter, Ctrl-C, Ctrl-D, end of input) is *no*.
3. **Streamed text can be withdrawn.** A retried attempt discards text already shown. The durable log stays the authority.

## Stage 1: live replies (done)

- **Smallest version:** print `text-delta` chunks to stdout as they arrive. The runner's reasoning listener already watches that stream. Print one stderr line per tool call and per result, from the same `tool/call` and `tool/result` Session events `src/json-stream.ts` projects: `• web_fetch example.com` … `✓` or `✗ <first line of the error>`. If a new attempt starts after text was printed, print `(retrying)`. When stdout is not a terminal, keep the end-of-turn print.
- **Escape control characters** (risk 1) in all output, including the existing reasoning stream.
- **Files:** `src/index.ts`, `tests/headless.spec.ts`.
- **Form:** a fork commit (25f27aa): `src/chat-stream.ts` beside the runner. A plugin cannot do this because the runner owns stdout.
- **Checked live** (2026-10-19) under a pseudo-terminal: the answer arrives word by word, tool lines show, the saved key is used (Compact's layer turns the saved-key store back on for the command-line profile).
- **Tests:** add scripted stream frames to the existing bench, then assert the output order, the `(retrying)` marker, and that an ESC byte arrives escaped. Then run the chat once by hand under a PTY with a real key.

## Stage 2: approvals in the terminal (done)

How Harness asks today: a pre-execute "ask" (sandbox escalation, hook permission decisions, `plugins/compact/site-approval.js` for new sites) calls the approval service, which applies the session policy ("never" rejects outright) and then runs the agent-scoped `approval/request` waterfall. In the app, `ui-approval` answers it with a card; with no answerer it fails closed. `ask_user_question` uses the parallel `user-questions/request` waterfall.

- **Smallest version:** while a chat is open, register an answerer scoped to the chat's agent. It pauses the live output and prints the escaped tool name and the reason (the site approval already supplies a readable sentence naming the host). It then asks `Allow once? [y/N]`. Only `y` or `yes` returns allowed-once; anything else returns rejected. The request's abort signal withdraws the prompt.
- **Must stay refused:** one-task runs, `--json`, piped stdin, and any session whose policy is "never" (none of them registers the answerer). Requests from agents the chat does not own. The site approval's *always allow* stays app-only. Computer-use consent questions stay refused (nice-to-have later: numbered answers for ordinary `ask_user_question` cards).
- **Files:** `src/index.ts`, `src/runner-internals.ts` (a one-shot question on the same readline), `tests/headless.spec.ts`; one line in the patch-17 docs.
- **Form:** fork commit daf01ec. The answerer is registered on the chat agent's own context; lines entered before the question stay queued as messages, and the half-typed line is cleared. Checked live 2026-10-19: a write outside the workspace asked, `n` rejected it, nothing was written.
- **Tests:** a scripted tool that asks for approval, answered `y`, `n`, empty, and with a `y` queued before the prompt (it must be rejected). Abort mid-prompt. Check the audit events each case logs.

## Stage 3: slash commands and status (done)

- **Smallest version:** send any line starting with `/` to the base command registry's `execute`, which already holds `/compact`, `/plan`, `/permission` and `/goal`, and print its result text. Add local `/clear` (new Session; print the old id) and `/help`. `/model` shows the model only; switching it is later. `/resume` takes an id (listing needs the session-query service, so later). After each turn, print one dim status line: model · tokens in/out · permission mode.
- **Risk:** the line must not be sent to the model as a turn when the command is unknown. Hide commands whose result is not plain text.
- **Files:** `src/index.ts`, `src/chat-commands.ts`, tests. Form: fork commit 3a4c06e. Checked live 2026-10-19 (`/help`, `/model`, status line).

## Stage 4: Claude Code-style terminal app (proposal, 2026-10-19)

### What the fork has

- The line chat from stages 1–3: live streaming, tool lines, approvals, commands, a status line, and the escaping of control characters (`packages/bundle/headless/src/chat-stream.ts`, `chat-commands.ts`, `runner-internals.ts`). Its event handling carries over; only the drawing changes.
- React 18.3.1 (the web client uses it), `string-width` and `wrap-ansi` are already installed. No terminal renderer is: no Ink, no `pi-tui`.
- Upstream's deleted TUI (`packages/ui/tui`, removed in 10bb9cbf4a, archived note `2026-08-04-remove-tui-package.md`): 23 source files, 7,676 lines plus a 7,149-line test, on a patched `pi-tui` 0.80.7, written against session APIs that have changed since. Upstream removed it for maintenance cost, and asks any return for a named product, its own package and PTY acceptance tests.

### Risky choices, decided first

1. **A new third-party dependency.** Recommended: Ink 5 (the React renderer for terminals that Claude Code uses) with the React 18 the fork already has, plus its layout engine. Installing it fetches packages from npm and adds a few MB to the app. Alternatives: draw with raw escape codes (no dependency, but every redraw, wrap and resize bug is ours; the repository prefers maintained dependencies), or restore upstream's `pi-tui` TUI (7.7k lines on a patched library, built for old APIs).
2. **Inline, not alternate screen.** Claude Code draws inline: finished messages go into the terminal's normal scrollback (Ink's static output), and only the bottom area (the reply being written, the spinner, the input box, the footer) is redrawn. The terminal's own scrolling, search and copy keep working. A full alternate-screen app needs its own scrolling viewport and loses those.
3. **Its own package.** `packages/ui/terminal-chat` in the fork, so Ink and React stay out of the headless runner, which upstream still changes; upstream merges then touch only the runner's one call site. The desktop app's package set and the build scripts gain the package.
4. **Untrusted text still escaped.** Model and tool text goes through the same escaping before Ink draws it; Ink does not strip control characters.
5. **Fallback.** No terminal, `TERM=dumb`, a terminal narrower than 40 columns, or `--plain` keeps the line chat from stages 1–3. One-task runs and `--json` are unchanged.
6. **Runs under the app's executable.** The installed command runs the app's Electron binary as Node; the renderer and its layout engine must load there. Checked before anything else is built.

### Smallest version

- **Welcome box:** Harness Studio, model, folder, and the `/help` hint.
- **Conversation in scrollback:** your messages (`> …`), the answer as wrapped text with code blocks set apart, and tool calls as `⏺ Bash(ls -la)` with `⎿  ✓` or `⎿  ✗ <first line>` under them.
- **Live area:** a spinner with elapsed time while the agent works (`✻ Working… 12s · Esc to stop`), and the answer streaming in.
- **Input box:** bordered, at the bottom; multi-line (Shift+Enter or a trailing `\`), history with ↑ and ↓, paste; Esc stops a reply; Ctrl-C twice quits; Ctrl-D quits.
- **Slash menu:** typing `/` lists matching commands under the box; Tab completes.
- **Approvals:** an inline box naming the tool and the reason, with **Yes, once** / **No** chosen by arrows and Enter (default No), keeping stage 2's rule that nothing typed before it answers it.
- **Footer:** the status line from stage 3, under the box.
- **Not in it:** rendered diffs, Markdown tables, `@` file mentions, pasted images, a `/resume` picker, themes, vim keys.

### Order

1. Load Ink under the app's executable; skeleton with the welcome box, scrollback, input box and streaming; the fallback. **Done** (f5a39cb): Ink 5.2.1 renders under Electron 44 (Node 24.21); checked live in a pseudo-terminal and replayed through xterm.
2. Tool lines, spinner, footer. **Done** in the same commit.
3. Approval box and slash menu. **Done** (e5a54ba), checked live: the menu narrowed by typing and ran `/model`; a write outside the workspace asked in the box and Enter on No rejected it. Live checking also found that Ink reads each chunk of input as one key, so arrows sent together were lost; keys are now split per press (`src/keys.ts`).
4. PTY acceptance tests (keystrokes in, screen out), the package in the desktop package set, a macOS build and its smoke test. **Done except the repository PTY test** (2026-10-19): the package ships in the app (`dsh/node_modules/@deepseek-ai/dsh-terminal-chat`, with `ink` and `react`), the macOS build passes its smoke test, and the built app's `harness-studio` command was run live in a pseudo-terminal (a tool call, the answer, the status line, the `/` menu, `/exit`). The build first failed on test files' types (the packaging build type-checks tests) and on the package being private (the desktop package set packs only public workspace packages); both are fixed. A repository PTY test needs a fake model or a key and is deferred; the scripted live checks cover the same ground.

About 1,200–1,800 lines plus tests, in four commits on the fork, each checked live.
