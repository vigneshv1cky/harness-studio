# Chrome bridge

Lets the Harness Studio agent use **your own Chrome** — the tabs you already have open, with your sign-ins — through a
small Chrome extension, the way Claude in Chrome does. No remote debugging port is opened.

```
Harness Studio agent ──MCP (stdio)──▶ server.mjs ◀──WebSocket 127.0.0.1:47630── Chrome extension ──▶ your tabs
```

- `server.mjs` is a zero-dependency MCP server. Harness starts it as a local connector (Settings → Connectors).
- The extension's service worker connects to it on `127.0.0.1:47630` and runs the commands with Chrome's extension
  APIs: `chrome.tabs`, `chrome.scripting` to read pages, `chrome.debugger` for real clicks and typing, and
  `chrome.tabs.captureVisibleTab` for screenshots.

## Tools

| Tool | What it does |
|---|---|
| `chrome_tabs` | Lists open tabs: id, title, URL, which is active, and its tab group |
| `chrome_open` | Opens an http(s) URL in a new tab, or in a given tab; waits for it to load |
| `chrome_read` | Title, URL, visible text, a numbered list of links, buttons, fields and other controls, and each video or audio's state (playing or paused, position, resolution) |
| `chrome_click` | Clicks a numbered element from the latest read |
| `chrome_type` | Replaces a field's text; `submit: true` presses Enter |
| `chrome_press` | Presses a key on whatever has focus: Enter, Escape, Tab, Space, the arrows, PageUp/PageDown, Home/End, Backspace/Delete or one character, with optional Shift+/Ctrl+/Alt+/Meta+ |
| `chrome_activate` | Brings a tab to the front |
| `chrome_close` | Closes a tab |
| `chrome_screenshot` | JPEG image of the visible part of the active tab. Harness Studio passes it to the model when the session's model accepts images; otherwise the result carries a note saying why it is not shown |

Tool calls default to the active tab when no `tabId` is given.

Each tool carries MCP annotations: `chrome_tabs`, `chrome_read` and `chrome_screenshot` are marked read-only;
`chrome_open`, `chrome_click`, `chrome_type` and `chrome_press` are marked destructive and open-world, and
`chrome_close` destructive. A connector set to **Ask before calls that can change things** therefore lets reads
through and asks before every action.

`chrome_read` sends the model the current value of each listed form field, up to 100 characters. Fields that hold
secrets show `••••` instead when filled: password inputs, fields whose `autocomplete` is `one-time-code`,
`cc-number`, `cc-csc`, `cc-exp`, `cc-exp-month`, `cc-exp-year`, `new-password` or `current-password`, and fields whose
`name`, `id`, `aria-label` or label text reads as a password, passcode, PIN, one-time code, card number, card
security code, card expiry, social security number, secret, key, API key, token (access, refresh, auth, ID),
bearer, auth or authorization, credential, session or session id, cookie, client secret or private key — case and
separators do not matter, so `api_key`, `apiKey` and `API-KEY` all count. A value is also masked, whatever its
field is called, when it looks like a credential: an `sk-` key, a GitHub (`ghp_`, `github_pat_`, …), GitLab
(`glpat-`), AWS (`AKIA…`) or Slack (`xox…-`) token, a JWT, or a run of 24 or more letters, digits, `-` and `_` that
mixes letters with digits and is varied enough to be random. Every other field's value — a search box, an address,
a message you are drafting — is sent as it is.

A click first scrolls the element into view and checks that the click point really lands on it; when something covers every part of it (a clipped menu, an overlay) it is clicked from the page instead, and the reply says so. After a click, typing or a key press the reply waits, up to 2.5 seconds, for the page to stop changing, so pages that update in place (search results, menus) are drawn before the next read.

Tabs the agent opens or acts in join a blue **Harness Studio** tab group in their window, so you can see which tabs it is using. A tab already in one of your own groups stays there. Each reply says whether the tab was grouped, and why not if it wasn't.

## Select an element for Harness Studio

Click the extension's **Select an element** button, or press **⌥⇧S** (change it at `chrome://extensions/shortcuts`), then click any element on the page; Esc cancels. The element goes to the session open in Harness exactly like a pick in Harness's Browser pane: the agent gets its tag, text, selector, size, key styles, HTML, React component names and, on your own app with the Dev Preview source loader, its source file and line; your message box gets a short reference and a cropped screenshot. This works on any site you are signed in to.

The picker runs in the extension's isolated world, so the page's scripts cannot see it, switch it off, or change
what it reports, and it only reacts to real mouse and keyboard input. React component names live on the page's own
JavaScript objects, which the isolated world cannot see, so after the click one small call in the page's world reads
the names for the picked element. The page controls that world, so the names are treated like the element's text:
page data, kept only when they are plain identifiers (at most four, 64 characters each). Everything a pick carries —
text, HTML, styles, selector, source path and component names — comes from the page and is untrusted. The bridge server holds a pick for up to two minutes until Harness collects it from `GET /selections/next`, which answers only Harness's own origins (`dsh-app://app`, `http://localhost:3080`, `http://127.0.0.1:3080`) and only a poll signed with the bridge's link key (see Security). The extension's badge shows ✓ when the pick was sent, or *off* when no Harness is connected.

## Install

1. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick `chrome-bridge/extension`.
2. Click the extension's toolbar icon and **Copy** the pairing code (four groups of five characters).
3. Harness → Settings → Connectors → **Add**:
   - Type: Local command
   - Command: the full path to `node` (for example `~/.nvm/versions/node/v24.x/bin/node` — Harness doesn't read
     your shell profile, so a bare `node` may not be found)
   - Arguments: the full path to `chrome-bridge/server.mjs`
   - Environment: `HS_CHROME_PAIRING_CODE=<the code you copied>`
4. Save. Within a few seconds the popup shows **Connected to the bridge** and the connector shows its 9 tools.

**New code** in the popup replaces the code; paste the new one into the connector's environment afterwards.

## Security

- **Picks reach only Harness, and only real picks reach it.** The server makes a new random link key at every
  start. The key leaves the process only over the MCP stdio pipe, as the unlisted resource
  `harness-studio://chrome-bridge/link` (never as a tool, so a model is never offered it); Harness Studio's
  Connectors plugin reads it and hands it to its own window. Every `GET /selections/next?nonce=<32 hex>` must carry
  `x-hs-bridge-auth: HMAC-SHA256(key, "poll:<port>:<nonce>")`, or it gets 401, and every answer carries
  `x-hs-bridge-sig: HMAC-SHA256(key, "pick:<nonce>:<exact body>")`, which the window checks before reading it. A
  program holding the port (say while the connector is off) never has the key, so it can neither collect picks nor
  put a fake pick into a conversation.
- **Pairing.** Both sides prove they know the pairing code without sending it: the server sends a random nonce,
  the extension answers with HMAC-SHA256(code, nonce) and its own nonce, and the server answers that in turn.
  A wrong code is refused and the extension keeps waiting. The code is created by the extension with
  `crypto.getRandomValues` and stays in `chrome.storage.local`.
- **Origin.** The server only accepts WebSocket upgrades whose `Origin` is a `chrome-extension://` origin, so a web
  page can't connect to it, and it listens on `127.0.0.1` only.
- **Before pairing.** Any local program can open a connection, so until a connection proves the code the server
  accepts at most four such connections at once (a fifth gets `503`), closes each one that has not proved the code
  within 10 seconds, and refuses any message over 4 KB. After pairing a message may be up to 25 MB, counted across
  all its fragments. Malformed frames, messages that are not JSON objects, proofs that are not 64 hex characters,
  and odd HTTP request targets close the connection or get an error reply; none of them can stop the server.
- **One extension at a time.** When a second extension connection pairs, it replaces the first; commands still
  running on the first fail at once with a message saying so, rather than waiting out the 45-second timeout.
- **Element numbers stay private.** The numbers from `chrome_read` are kept in the extension's isolated world, a
  JavaScript context the page's own scripts cannot reach, not written into the page. A page therefore cannot move
  a number onto another element to redirect the agent's next click or typing.
- **Page content is marked untrusted.** Everything a reply carries from a page — titles, URLs, visible text, link
  targets, field values — comes back between `<<<CHROME-PAGE-DATA` and `CHROME-PAGE-DATA>>>` lines, after a line
  saying it is untrusted page content, never instructions. A page cannot close the fence early: the marker (in any
  case) and runs of three or more `<` or `>` are removed from page text, repeatedly, until none is left. The
  server's MCP instructions say the same.
- **Pings.** A connection may ping at most 10 times a second; more closes it. Before pairing, a connection that
  leaves more than 64 KB of the server's answers unread is cut off, so a local program cannot make the server
  hold its output.
- **URLs.** `chrome_open` only opens `http:` and `https:` URLs.
- **Visible input.** Clicks and typing attach `chrome.debugger` to the tab, so Chrome shows its
  "… started debugging this browser" bar while the agent acts; it detaches after 8 seconds idle. Where the
  debugger permission is blocked by policy, the extension falls back to page-level events (some sites ignore
  those).
- **Scope.** The extension can read and act on any tab (`<all_urls>`) — that is the point of it. Remove it, or
  toggle the connector off for a session from the composer's + menu, when you don't want the agent in your
  browser.

## Tests

The server test runs the real server with a stand-in extension and a stand-in MCP client (30 checks), including
malformed input before pairing, the message-size caps, the ping limit, the handshake timeout, the
unpaired-connection limit, a second extension replacing the first, the tool annotations and the untrusted-data
fence:

```bash
node chrome-bridge/test/server-test.mjs
```

The redaction test runs the extension's page-reading function against a stand-in page (4 checks): fields named or
labelled like credentials, values shaped like credentials, and ordinary fields that must keep their values:

```bash
node chrome-bridge/test/redaction-test.mjs
```

The end-to-end test drives a real Chrome with the real extension (10 checks). It needs a throwaway Chrome with
remote debugging on port 9444 — loading an unpacked extension over the DevTools protocol requires
`--enable-unsafe-extension-debugging`, so never use your everyday profile — and the test form served on port 3010:

```bash
python3 -m http.server 3010 --bind 127.0.0.1 --directory chrome-bridge/test
```

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --user-data-dir="$(mktemp -d)" --remote-debugging-port=9444 --enable-unsafe-extension-debugging --no-first-run about:blank
```

```bash
node chrome-bridge/test/extension-e2e.mjs
```

The test keeps its DevTools connection open for the whole run, because Chrome unloads an extension loaded this
way as soon as that connection closes. Quit the throwaway Chrome and delete its profile folder afterwards.
