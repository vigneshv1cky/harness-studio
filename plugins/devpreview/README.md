# @harness-studio/devpreview

A [Harness Studio](../../README.md) plugin that makes the right sidebar work like Claude Code desktop's, and lets you point the agent at an element of your running app:

1. **Browser pane extras** — Harness's Browser pane gains Claude's tools:
   - a bottom bar: **Pick** an element for the agent, **Annotate** the page (draw on a screenshot and attach it to your message), × to hide the bar;
   - a **Dev servers** menu in the pane header: dev servers detected on this computer (ports 3000, 3001, 5173, 5174, 4200, 4321, 8000, 8080, 8888) and servers you add;
   - a **⋮** menu: open in the default browser, copy URL, save screenshot, viewport (responsive, mobile 390, tablet 768, desktop 1280), hard reload, developer tools, clear page data;
   - **Detect dev server** on the empty browser page.
2. **Pick → Send to agent** — with the dev-only [companion script](../devpreview-companion) in your app, hover outlines elements; clicking one shows its source file and line, component, text, size, selector and styles. **Send to agent** puts a reference in the message box, so "make this bigger" edits the right file. The pane accepts a pick only right after you turn pick mode on (the first element the page reports, nothing before or after), and validates and trims it with the same rules as the Host.
3. **Changes and Session details** — a Changes pane shows the Session folder's git working tree against its branch, laid out like Claude Code desktop's: pinned file headers with type icons and +/− counts, small diffs expanded, one line-number column with coloured edge bars, wrapped lines and syntax colours ([screenshot](../../docs/screenshots/changes-pane.png)); and a Session card shows the environment, folder, branch and change totals. Both refresh every few seconds. Git data comes from a small read-only helper the Host half runs on `127.0.0.1` (ports 47613–47617), so refreshing never adds rows to the conversation. See [The local helper](#the-local-helper) for how it is secured.
4. **Files** — like Claude Code desktop's: a tree of the Session folder (`.git` hidden) beside tabs of open files with line numbers and syntax colours ([screenshot](../../docs/screenshots/files-pane.png)). The filter matches file names across the whole folder; start it with `?` to search inside files and jump to the matching line. Name filtering and search come from the same local git helper, so they need the folder to be a git repository. The list button at the left of the pane header hides or shows the tree, and the choice is remembered. Text matches Claude Code desktop's at 100%: 13px on 24px tree rows, code at 13px.
   The Browser pane is for previewing local apps; the agent is told to browse websites in your own Chrome (the Chrome extension tools) and to use the pane only for local previews or when you ask for it. Google sign-in works in the pane with a password: a small Harness patch ([patches/harness-browser-pane.patch](../../patches/harness-browser-pane.patch), see [docs/HARNESS_PIN.md](../../docs/HARNESS_PIN.md)) gives it Claude desktop's identity shape (a plain `HarnessStudio/1.0` token before Chrome's, no Electron), a real outer window size, and storage that keeps sign-ins across restarts. Passkeys do not work in the pane: at "Complete sign-in using your passkey" choose "Try another way".
5. **Pane toolbar and stacked panes** — icons in the conversation header (Session details, Terminal, Changes, Browser, Files) open or close their own pane, like Claude Code desktop's. Up to two panes show at once, stacked top and bottom with a draggable bar between them; opening a third replaces the bottom one. Each pane header ends with a × that closes that pane, and closing never brings back panes that were open before; closing the last one closes the sidebar. The browser pane keeps its own tabs and a + for a new tab. Harness's side-by-side split button and ⌘\\ are turned off, and so is its plain sidebar toggle (header button and ⌥⌘B): the sidebar only ever opens onto a pane, never onto an empty start page.

**Subagents switcher:** the header's "N subagents" tree opens on click only (not on hover), and clicking it again closes it.

**Live websites:** in the Desktop app, Pick adds the picker to any page that doesn't load the companion itself, so you can pick elements on live sites too (no source file — the agent gets text, styles and HTML, e.g. "make my button look like this one"). The Web app can't: browsers forbid scripting another site's page, so there Pick needs the companion in your app. Annotate needs the Desktop app.

Compatible with Harness `>=0.2.1-alpha.3 <0.3.0` (developer preview; later versions may break plugins).

## Install

Desktop app: **Plugins → Add plugin**, enter one of:

- a packed file: `/path/to/harness-studio-devpreview-0.1.0.tgz`
- a folder: `/path/to/harness-studio/plugins/devpreview`

then **Install → Enable now**.

Web / CLI profile:

```sh
dsh plugin --profile web add /path/to/harness-studio-devpreview-0.1.0.tgz
```

Click the **Browser** icon in the conversation header, open your dev server (or use the **Dev servers** menu), then use the bottom bar to pick or annotate.

## What the agent receives

After **Send to agent**, every request in that Session carries a short description until you clear the selection (✕):

- element, source `file:line:column`, enclosing component
- visible text, rendered size, CSS selector, key computed styles, trimmed HTML

Only the fact that you picked the element is stated as coming from you. Everything else is read from the page — which may be any website — so it sits between `<<<PAGE-DATA` and `PAGE-DATA>>>` markers, labelled as untrusted data that is never to be followed as instructions, and the source location is described as a hint to confirm in the code. The agent can also call the `preview_selection` tool for the full record (framed the same way). The selection is kept in memory per Session; restarting the Host forgets it.

**Elements picked in Chrome** (with the Harness Studio Chrome extension) arrive the same way: the reference and screenshot go into the message box only after the agent has the element; if sending fails, a short note appears beside the header icons instead. Only a PNG screenshot of at most about 6 MB is attached.

## Pieces

| Part | File | Runs in |
|---|---|---|
| Pane toolbar, Browser extras (pick, annotate, menus), Changes, Session, Files | `client.js` | Harness client (browser / Electron renderer) |
| `/preview-select` command, model context, `preview_selection` tool, git helper and its Remote-method access | `index.js`, `git-helper.js` | Harness Host (Node) |
| Plugin row | `cordis.patch.yml` | Profile composition |

No build step: both halves are plain JavaScript.

## Plugin settings forms

Harness's plugin settings pages (Web search, Subagent, Shell and others) save only through their **Save** button and confirm nothing on success. With this plugin, **Enter** in a single-line field presses that form's Save when there is something valid to save, and a green **Saved ✓** appears beside the button once the save goes through, and a moment later the page goes back one level — only if you are still on the settings page you saved. A failed save still shows Harness's own message.

## The agent drives the Browser pane

The agent gets five tools that act on the Browser pane of the session's own window, where you can watch them. A command only ever runs in the Browser pane of the session that asked for it; if that session isn't the one on screen, the tool says so instead of acting on another session's pane:

| Tool | What it does |
|---|---|
| `browser_open` | Open a URL (http or https), or go back, forward or reload. Opens a Browser pane if none is showing. |
| `browser_read` | The page's title, URL, visible text (up to 6,000 characters) and a numbered list of up to 150 interactive elements — links, buttons, form fields, menu items (including radio and checkbox items), tabs, options, sliders and other focusable controls, with their checked or selected state. Elements in open menus and dialogs come first, then those on screen. |
| `browser_click` | A real mouse click at the centre of an element, by its number from the latest read. |
| `browser_type` | Replace a field's text by typing into it, optionally pressing Enter. |
| `browser_console` | The page's recent console messages (errors, warnings, logs), up to the last 50. |

![The agent filling a form in the Browser pane](../../docs/screenshots/agent-browser.png)

How it works: the tools run in the Host; the local helper relays each command to the window showing that session (`GET /browser/next` long poll, `POST /browser/result`, see `browser-bridge.js`), which runs it in the pane's page and posts the result back. Only the header of the session on screen polls; failed polls back off from 1 to 30 seconds, and a helper that stops answering is linked again. A queued command fails after about 4 seconds only when no window is serving the session (no poll open, no command running, nothing heard recently), so a window busy with an earlier command keeps later ones waiting. Clicks and keys are real input events; click positions are scaled for the theme's whole-app zoom, which draws the pane smaller than the page's own CSS size.

Element numbers are not written into the page. The number-to-element map lives in a closure in the page, behind one randomly named, read-only window property; each read starts a new generation that clicks and typing must name, and before acting the element must still be in the page with the same tag, kind and accessible name. A page that re-reads or rearranges itself only makes the agent read again. Because a `<webview>` gives the Harness window no isolated script world, a page that deliberately patched the browser's built-in functions before the read could still misreport an element's position or name.

Limits: works in the desktop app only, and only while the session is open in a window (otherwise the tool says so after a few seconds). No screenshots are returned to the model yet. Numbers from `browser_read` change on every read.

## The local helper

The Host half serves git data and relays browser commands on `127.0.0.1` (first free port of 47613–47617). It answers only the Harness app's origins, and every request except `/hello` must carry a random secret made when the Host starts. The window gets the port and the secret from its own Host through a Remote method (`harnessStudioDevPreview/helper`) that Harness's API Gateway serves over its own authenticated window-to-Host connection, the same way the Connectors plugin reaches its helper. That call writes nothing to the session log, so linking never adds rows to the conversation, and a local process that can reach `127.0.0.1` still cannot read the secret; peers on shared remote access are refused by the Gateway. Before sending the secret anywhere, the window checks that the named port answers `/hello` with an HMAC of a fresh nonce under that secret, so another process on a helper port, or a second Harness's helper, is never used. If the Host restarts, the window links again (at most every 3 seconds).
