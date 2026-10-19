# Changelog

Changes to the downloadable Harness Studio app. The plugins in [`plugins`](plugins) keep their own versions.

## 0.3.0 — 2026-10-18

Includes the 0.2.1 changes below, which were not published as a separate release.

### Added

- **Computer use in the downloadable app (macOS):** the agent can see and control apps on your Mac, one approved app at a time, as it already could in a development build. The app now ships the native helper and turns computer use on by itself; Settings → General → Computer use shows the two macOS permissions it needs. While the app is not signed with a Developer ID, macOS may ask for those permissions again after each update.
- **Chat in the terminal:** `harness-studio` with no task opens a chat: each line you type is one message in the same session. Ctrl-C stops a reply, Ctrl-D or `/exit` quits, and the session id it prints continues the chat later with `--session-id`. Piped input and `--json` work as before.
- **The terminal command on Linux:** the .deb now installs `harness-studio` as the command-line tool, as on macOS: give it a task, pipe text into it or use `--json` and `--session-id`. Typing `harness-studio` in a terminal used to open the app; open it from your applications menu instead. The AppImage has no terminal command.
- **The system prompt on the Instructions page:** a read-only System prompt row above the instruction files shows Harness Studio's own prompt as a new session starts with it, with its size, sections and tool count, and Show for the full text, so everything the agent is told before your first message is in one place.
- **Replies like Claude Code's, out of the box:** the first start writes a default reply style as your global instructions, shown in the Instructions tab as "Global, all projects": the agent leads with the answer, keeps replies as long as the request needs, uses lists and tables only when the content calls for them, links files, gives a one-line note before each batch of tool calls, and ends with what changed and how it was checked, including what failed or was not verified. Edit it there like any instruction file. It is written only when you have no global instruction file yet, and never again after you change or delete it.
- **Every file in the Files tab, like Claude Code:** the Files tab now shows PDFs, images, spreadsheets, and Word and PowerPoint documents with Harness's own viewers, and file cards, file links and references in the chat open their file there (with the tree hidden) instead of in a separate preview. Markdown, web pages, CSV files and SVG images have a Rendered / Source switch, Source being the editor; both start in the view you chose last. CSV files render as a table in the app's table style, Excel workbooks in a cleaner spreadsheet (sans-serif cells, the app's type on the formula bar and sheet tabs), every spreadsheet cell centred, and in full screen the tree shows by default.
- **Chrome picks are authenticated:** elements picked in Chrome reach Harness only over polls signed with a key the Chrome bridge makes at each start and hands to Harness over its private pipe, and every answer is signed back. Another program on the bridge's port can no longer collect picks or slip a fake one into a conversation.
- **Your own session in a new worktree:** the New Session screen has a New worktree switch (for git workspaces with commits). With it on, sending the first message first makes a new git worktree and branch from the workspace, and the session works there, so its changes stay apart from yours.
- **Always allow a website:** the new-site approval has a third button, Always allow for this website. The site is saved on this computer and never asks again; Settings → General → Always-allowed sites lists them, each with Remove. Only the exact site is allowed, not its subdomains.
- **Calmer approval card:** the approval prompt is a neutral card like Claude Code desktop's (hairline border, small muted "Waiting for approval" label, 14px question, smaller buttons) instead of an orange-framed warning, and the new-site question is shorter.
- **Your message's time and copy button** sit beside the message instead of under it, so they no longer cover the line that follows.
- **Previous prompts with the arrow keys:** in the message box, Up brings back the prompts you sent, newest first, when the box is empty or the cursor is at its start; Down steps forward and finally returns what you were typing. The last 200 are kept on this computer.
- **Question cards like Claude Code's:** the choices sit straight on the card as soft rounded rows (no inner box or lines), each label over a lighter description, its number in a chip at the right that fills with the accent colour when chosen, and the typed answer as the last row. The send button in the message box is smaller (24px).
- **Clearer full pages:** Plugins, Connectors, Automation tasks, Instructions, About and the Git page draw their separator lines and boxes stronger, and group their lists in rounded, bordered sections with a line between rows (the Git commit list without row lines, so the branch graph stays whole).
- **Colour themes:** Settings → General → Colour theme adds Warm (Claude-like), Graphite, Nord, Solarized and High contrast, each in light and dark, on top of the default look; Appearance still chooses light, dark or system. The app starts in the chosen theme from its first frame, and dark mode no longer starts on a white loading screen.
- **Code like Claude Code's:** code blocks in replies, Markdown files and previews have Claude Code desktop's look: a hairline border on a soft fill, rounded corners, no header bar, with copy and wrap buttons that appear when the pointer is over the block. Inline code uses Claude's smaller chip.
- **One table style:** tables in the conversation, in Markdown files and in a connector's tool list share one look: a rounded border, a shaded header row and light row lines.
- **Git page:** your workspaces' git history, below Instructions in the sidebar, opening over the whole window: an overview of every workspace's branch, upstream and uncommitted files, then one workspace's commits with a branch graph, search by message, author or changed code, each commit's files and diffs, and blame. A Branch menu switches the workspace to another local branch, refused while anything is uncommitted or an agent is working there.
- **Background tasks in the Session pane, like Claude Code desktop's:** one card lists what is still working for the session: commands the agent left running in the background, workflows, subagents, programs in the agent's terminal and watches, each with its running time and a stop button. Finished ones are behind an "N finished" row, newest first. One compact line per task.
- **Command rules, like Claude Code's:** rules that block a tool call or ask you first, in Claude Code's `permissions` format, in `~/.harness-studio/permissions.json` and a project's `.harness-studio/permissions.json`. Bash rules check each part of a compound command and also cover the agent's terminal and Watch commands; Read and Edit rules take paths; WebFetch rules take a domain; connector rules name a server or tool. Deny wins over ask.
- **Your data:** Settings → General → Your data lists where Harness Studio keeps things on this computer, with each part's size and an Open button.
- **Asking before new sites:** web fetch, Browser pane pages the agent opens and pages it opens in your Chrome now ask before reaching a site for the first time in a session; once allowed, the session reaches it again without asking. A prompt injection could otherwise have the agent put what it has read into a web address, and none of these goes through Network for commands. Sites on this computer pass, as do the sites on the Network for commands list while it is set to Only allowed sites. Full access lifts the check. The command-line tool does not ask.
- **Ask before calls, per connector:** each connector can now ask before every call, or only before calls to tools its server does not mark read-only. Off by default.
- **Secret files are hidden from the agent:** commands the agent runs and its file tools can no longer read SSH keys (`~/.ssh`, except `known_hosts` and `config`), cloud and registry credentials (`~/.aws`, `~/.config/gcloud`, `~/.docker/config.json`, `~/.npmrc`), password files (`~/.netrc`, `~/.git-credentials`), `~/.env`, Harness Studio's own key store, or `.env` files outside the workspace. A prompt injection in a README or web page could otherwise have the agent read one and send it anywhere. The workspace's own `.env` files stay readable. A command that genuinely needs a key, such as git over ssh without an ssh agent, fails until you approve it with full access. On Linux, `.env` files in other projects are not covered, and hosts without bubblewrap do not hide these files from commands.
- **Full-screen programs for the agent:** a real terminal the agent can drive: it starts a program (vim, less, top, an installer that asks questions), reads the screen as text and sends keys, waiting each time until the screen settles. Programs run under the session's sandbox and network setting, up to four per session, and close when the session ends, after 30 minutes unused, or when the sandbox setting changes. Terminal is the ninth built-in plugin.
- **Code editor:** files you open in the Files tab open ready to edit (CodeMirror), and Edit on a file preview opens one in an editor tab, with syntax colours, search and replace, multiple cursors and folding; ⌘S saves. Changes on disk appear in place while you have no unsaved edits; otherwise a bar asks which version to keep, and a save never overwrites a change you have not seen. Text files inside your workspaces, up to 2 MB. Editor is the tenth built-in plugin.
- **Browser DevTools for the agent (desktop app):** on your own development pages (localhost and your local network), the agent can read the Browser pane page's network requests (status, failures, and filtering), any response body, and its console with uncaught errors and their stack traces. Requests are recorded from the page's first load. DevTools never attaches to public sites, which can detect it, and detaches when a page leaves a local address.
- **Watches:** cheap checks that wake the agent only when something changes — a command's output (git status, a linter), a port on this computer going up or down, or files changing. They run on your computer without the model, commands under the session's sandbox and network setting; only an idle agent is woken, never by its own work, with a cooldown between notices and a notice limit. The eye button in the session header lists them, removes them and adds one. Watch is the eighth built-in plugin.
- **Command-line tool (macOS):** app menu → Install Command-Line Tool adds `harness-studio`. `harness-studio "task"` (or text piped in) runs one session in the current folder and prints the answer, with the app's model key, settings, connectors, memory and hooks; `--json` and `--session-id` are available for scripts and CI.
- **Network for commands:** Settings → General → Network for commands can turn the internet Off for commands the agent runs, or allow Only the sites you list (it starts with npm, PyPI and GitHub). The operating system blocks direct connections; listed sites go through a small built-in proxy, and other sites are refused with a message naming them. The default stays On. On Linux this needs bubblewrap.
- **Undo file changes, like Claude Code's rewind:** before the agent first changes a file in a turn, a copy is kept. Under each turn that changed files, Undo file changes puts them back as they were before that turn (and undoes later turns too), removes files the agent created, and tells the agent. Changes made by shell commands are not covered. Undo is the seventh built-in plugin.
- **About page:** an About row under Settings at the foot of the sidebar opens a page that explains everything Harness Studio does: the agent loop and its tools, plan mode and access modes, instructions, memory and compaction, connectors, helper agents, hooks and sessions, the sandbox, and what is not there yet. Each feature says what it does, how it works and why.
- **Hooks, like Claude Code's:** your own commands that run before a tool call (and can block it or ask you first), after a successful one (and can send the agent feedback), and when the agent is about to finish (and can send it back to work, for example until the tests pass). The file format is Claude Code's, so hooks can be copied over. Yours live in `~/.harness-studio/hooks.json`; a project's `.harness-studio/hooks.json` runs only after you allow it on a card. Hooks is the sixth built-in plugin.
- **Auto memory, like Claude Code's:** the agent keeps notes for itself as it works in a project, without asking: one small file per fact (what it is, why, and how to apply it) plus a `MEMORY.md` index, in `~/.harness-studio/memory/<project>/`. New sessions in the project read the index, so a correction or preference carries over without being repeated. The Instructions page lists each memory with Open and Delete. Secret-looking text is refused.

### Changed

- **About page:** a new Panes and pages section covers the right panel and its layout menu, the Session pane with Background tasks, the Changes pane, Files, the Terminal and the Git page; editing files and the agent's choice between the Browser pane and your Chrome are described as they now work.
- **Plan mode is enforced:** while it is on, the session is read-only, so the agent cannot change files, even with an approved escalation, until you approve the plan or switch plan mode off. Before, plan mode only asked the agent not to edit.
- **Remember** now offers a card only when you ask the agent to add a rule to your instruction files; everyday corrections and preferences go to auto memory instead.
- **Instruction files are Harness Studio's own:** sessions read your personal `~/.harness-studio/AGENTS.md`, then each project folder's `AGENTS.md` from the repository root down, each followed by its `AGENTS.local.md` — Claude Code's three levels, with Harness Studio's file names. Files written for other agent tools are no longer read: not `CLAUDE.md`, `CLAUDE.local.md` or `~/.agents/AGENTS.md`. The Instructions page lists only these files. To keep a project's `CLAUDE.md` rules, move them into `AGENTS.md`, or make `CLAUDE.md` a link to `AGENTS.md` so both tools read one file.
- **Instructions page:** the personal row is named "Global, all projects". Long paths keep their folder and file name visible and shorten the middle, with the full path on hover.
- **Left sidebar is more compact:** 26px rows (13px text, as before) and a shorter Workspaces header, so more sessions fit now that the sidebar also has Instructions and About.
- **Right panel:** Files, Terminal, Browser and the other right tabs first open at 35% of the window instead of 45%, so the conversation keeps most of the width. Dragging it wider still works.
- **Pane layout button:** each pane header has a layout button next to expand. Clicking it opens the menu for moving the pane, filling the panel and opening it in a new window; clicking again, pressing Escape or clicking elsewhere closes it. The expand button only expands, and nothing opens on hover.

### Fixed

- **The downloadable build stopped at its type check:** twelve type errors in tests added or changed by the Browser DevTools, secret-file, stress-fix and computer-use patches (and one in the plan-mode test) failed the full build that packaging runs, and three menu tests still expected "Manage dsh Command…" after the menu item became "Install Command-Line Tool…". The tests are corrected inside the patches that introduced them; the app's behaviour is unchanged.
- **Browser tabs:** + in a browser pane opens the new tab in that pane; with two stacked browser panes it opened in the other one.
- **The app could fail to start after many launches** ("Web request failed", then restarting again and again): each launch left one more sign-in cookie for 127.0.0.1 until requests carried so many that the app's own server refused them. Old sign-in cookies are now removed at startup.
- **The terminal command did not start:** in 0.2.0 and 0.2.1 the command installed from the app menu looked for an executable named after DeepSeek Harness and failed. It now starts Harness Studio, and uses Harness Studio's home folder instead of Harness's.
- **Dates on remembered notes and memories** are the local date; they were the UTC date, a day ahead in the evening in the Americas and a day behind in the morning further east.
- **Sidebar scrollbar in the light theme:** the workspace list's scrollbar was drawn almost the colour of the sidebar and was hard to see. It is now a visible grey in both themes, and still hides when the pointer leaves the sidebar.

## 0.2.1 — 2026-10-17

### Added

- **Instructions page:** below Automation tasks in the left sidebar: every instruction file a workspace reads with size, token cost and status (loaded, skipped, left out or shortened), Edit and Open for each, the size limit (64 KB to 1 MB, or none; applies from the next message), and the remembered notes with Delete.
- **Remember:** the agent proposes one-line notes that carry over to new sessions; you approve each on a card and choose this project (`AGENTS.local.md`) or all your projects (your personal `AGENTS.md`). Secret-looking notes are refused.
- **Sessions and Remember are built into the app.** 0.2.0 listed Sessions as new but did not include it in the downloads; both now ship with the app alongside Dev Preview, Connectors and Compact.
- **Includes in instruction files:** an `@path` line in `AGENTS.md` or `CLAUDE.md` brings in another file, as in Claude Code. A project's files can only include files inside that project; your personal `~/.harness-studio/AGENTS.md` can include any file, such as `@~/.claude/CLAUDE.md`.
- **Cut instructions are shown:** when instructions don't fit, a row under your message names each file left out or shortened and its size.

### Changed

- **Sidebar wording:** View options → Group by says "Workspace" instead of "WorkSpace".
- **One instruction file per folder:** `AGENTS.md`, else `CLAUDE.md` (and the same for the `.local` files), instead of both, so instructions aren't sent twice; an include of a file already read is skipped.
- **Chat font:** Settings → General → Chat font chooses the conversation's typeface from 25 presets (only installed ones are shown) or any installed font; System stays the default, now drawn with normal smoothing so it no longer looks thin.
- **Large connectors load tools on demand:** a connector with more than 10 tools (GitHub has 49) is listed by name in one `connector_tools` tool, and the agent loads what it needs, instead of every tool's schema going with every request; about 13,000 fewer tokens per request with GitHub connected.
- **Edited instruction files:** when an instruction file changes mid-session, only the changed lines are sent, instead of the whole file again.
- **Instruction limit:** 128 KB instead of 64 KB.
- **README:** a "Your instructions" section on where the app reads instructions from.

## 0.2.0 — 2026-10-17

Downloads are for macOS (Apple Silicon) and Linux (x64 and arm64). Windows is paused: its build scripts and patches are kept, and [desktop/README.md](desktop/README.md#windows-paused) says how to bring it back.

### Added

- **Linux packages:** an AppImage and a `.deb` for x64 and arm64, built and smoke-tested on GitHub Actions. The `.deb` installs the sound library a minimal system lacks and registers `harness-studio://` links, and Linux windows show the app's icon in the taskbar.
- **Usage card:** the Session pane shows the session's usage readings in two columns.
- **Compact `+` menu and question panel:** the composer's `+` menu is a compact popover with rounded corners, and the question panel takes less room.
- **Pane menu:** each stacked pane has its own expand, close and Browser tools, with a pane menu sized like Claude Code desktop's.
- **Sessions plugin:** the agent can hand work to a separate session in the sidebar with a written brief, optionally in its own git worktree, and gets each turn's report back. It has its own approval card and a Plugins-page title and description.

### Changed

- **No DeepSeek sign-in or feedback:** the welcome screen has a single "Choose a model provider" button that opens Settings → Models, where DeepSeek is an ordinary provider used with an API key. The account pages, thumbs, Feedback command and Session-log upload are gone.
- **First-use workspace:** new installs keep it in `Documents/Harness Studio`. An existing `Documents/deepseek-harness` workspace is kept where it is.
- **README screenshots** show the current app on sample content.
- **Compact welcome screen:** the first-launch window is 420 × 340 instead of 600 × 700, with the mark, greeting and button grouped together and the greeting in the system font.
- **Check for Updates…** opens the [Releases page](https://github.com/vigneshv1cky/harness-studio/releases), since the app has no automatic updates.
- **README:** a "First launch on macOS" section for the unsigned app (Open Anyway, and the fix for the "damaged" message).

### Fixed

- Settings → Models stayed closed when "Choose a model provider" was clicked before the plugins finished loading.
- Linux: converting Word, Excel and PowerPoint files to PDF failed in the packaged app; it now uses the Office kit's WebAssembly engine.
- Linux: the default workspace could not be created when the system reports no separate Documents folder.
- The Session pane showed "No folder" for Windows paths and shortened only macOS home folders to `~`.

## 0.1.0

The first downloadable Harness Studio app for macOS: DeepSeek Harness with Harness Studio's name and logo, the Dev Preview, Connectors and Compact plugins built in, and telemetry off.
