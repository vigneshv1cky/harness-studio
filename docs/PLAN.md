> **Historical.** This is the original design note from 2026-10-15, kept for context. The project has moved on: the "Preview tab" became the Browser pane, the out-of-tree-only approach gained an optional Harness patch, and several stages listed here were dropped or reshaped. The READMEs describe what exists now.

# Harness Studio — plan

_Started 2026-10-15. Base: Harness (`dsh`) 0.2.1-alpha.3, pinned in [HARNESS_PIN.md](HARNESS_PIN.md)._

## Goal

An open-source, any-model agent desktop app for UI work on an **existing** codebase, built as plugins on Harness:

1. **Live preview** of the project's running dev server inside the app.
2. **Element selector** — click an element in the preview; the agent receives its source file, line, component name, DOM snippet and a screenshot.
3. **Real-Chrome bridge** — drive the user's logged-in Chrome (later).
4. **Design drafting** with the project's real tokens (later).

This document covers 1 and 2. First target framework: **Next.js / React** (the owner's main stack).

## What the Harness already gives us

| Need | Harness piece |
|---|---|
| App shell, chat, sessions, diffs, subagents, MCP, worktrees | Desktop app (Electron around the Web client), all plugins |
| Models | `llm-deepseek` + `llm-pi-ai` (multi-provider routes: Claude, OpenAI, Gemini…) |
| Right-sidebar tabs | `ctx.sidebarRightTabs.register` + slot `sidebar.right.pane.tab` |
| A browser tab that loads `http://localhost:*` | `ui-sidebar-browser` (iframe on Web, Electron `<webview>` on Desktop) — **no API for other plugins** |
| Model-facing tools | `ctx.tools.register(defineTool(...))`, images via `ctx.attachments.saveImage` |
| UI → agent channel | Host command (`ctx.commands.register`) invoked from the client with `ctx.remote.commands.execute(sessionId, '/cmd …', attachments)`; handler calls `agent.inject(...)` or `agent.followup(...)` |
| Out-of-tree packaging | npm package with a `dsh` field: Host `.` export + `./client` export + `cordis.patch.yml`; install with `dsh plugin --profile <p> add ./pkg` |

Key references inside `harness/`:
- `packages/preset/agent-preset/skills/cordis-plugin-development/` (SKILL.md, references/ui-plugin.md, host-plugin.md, practices.md, user-actions.md, templates/decoration)
- `packages/client/ui-sidebar-documentpreview/` (worked sidebar-tab example)
- `packages/client/ui-sidebar-browser/` (iframe / webview implementation to learn from)
- `docs/cookbook/adding-a-tool.md`, `docs/subsystems/sidebar-right.md`, `docs/subsystems/commands.md`

## The core constraint

The dev server (`localhost:3000`) is a **different origin** from the Harness client, so the panel cannot read or script the page:
- Web client: cross-origin iframe — no DOM access, no script injection.
- Desktop: Electron `<webview>` with forced sandbox/context isolation and **no guest preload**. Calling `executeJavaScript` / `capturePage` from the embedder may work but is unverified and fragile.

**Decision:** put a small **companion script inside the user's app** (dev-only) that cooperates with the panel over `window.postMessage`. This works identically in the Web iframe and the Desktop webview, needs no Harness changes, and is how comparable tools (LocatorJS, code-inspector-plugin, Onlook) solve it.

## Architecture

```
 User's Next.js app (dev only)                Harness client (React)                 Harness host (Node)
┌─────────────────────────────┐   postMessage  ┌───────────────────────────┐  command   ┌──────────────────────────┐
│ build plugin: adds           │◀──────────────│ Preview tab (sidebar)      │──────────▶│ /preview-select command   │
│ data-src="file:line:col"     │  pick on/off   │  - iframe/webview of :3000 │ +image    │  → agent.inject(context)  │
│ to every JSX element         │──────────────▶│  - Pick button, overlay    │           │ preview_* tools           │
│ companion runtime:           │  selection     │  - "Send to agent" / auto  │           │  → read last selection    │
│  hover outline, click,       │  {file,line,   │                            │           │  → screenshot attachment  │
│  component name, outerHTML,  │   comp, html,  └───────────────────────────┘           └──────────────────────────┘
│  computed styles, PNG crop   │   styles, png}
└─────────────────────────────┘
```

### Packages to build (in `plugins/`)

1. **`devpreview`** — Harness plugin (Host + Client in one package)
   - Client: right-sidebar tab "Preview" (URL bar, reload, Pick toggle, selection card); hosts its own iframe (Web) or leased `<webview>` (Desktop, copying `ui-sidebar-browser`'s lease pattern); listens for companion messages, validating origin.
   - Client → Host: on selection, call `/preview-select` with the screenshot as an attachment.
   - Host: command handler stores the selection per session and `agent.inject`s a structured context block (file, line, component, html excerpt, styles); tool `preview_selection` returns the latest selection; tool `preview_screenshot` returns the stored image.
   - Config: default URL, auto-send vs. manual, max HTML/style sizes.
2. **`devpreview-companion`** — npm package the user adds to their app as a dev dependency
   - Source-location stamping: SWC/Babel JSX transform adding `data-src` (file:line:col, project-relative). For Next.js, start with the existing open-source transforms used by code-inspector/LocatorJS before writing our own.
   - Runtime: only active when framed and when the parent sends `pick:on`; draws hover outline; on click resolves nearest `data-src`, React component name (fiber `type.displayName/name`), trimmed `outerHTML`, key computed styles, and a cropped PNG (html-to-image style capture), then posts to `window.parent`.
   - Strictly dev-only: no-ops in production builds.

## Stages

| # | Deliverable | Done when |
|---|---|---|
| 0 | Harness runs locally (Desktop + Web); telemetry/uploads disabled in our profile | App opens; `--dump-config` shows our overrides |
| 1 | Hello-world out-of-tree plugin: empty "Preview" tab mounted via `--patch` | Tab appears in the right sidebar |
| 2 | Preview tab loads `localhost:3000` (Web iframe, then Desktop webview) | A sample Next.js app renders and reloads in the tab |
| 3 | Companion runtime: pick mode + postMessage with DOM info (no source yet) | Clicking an element shows its tag/text/styles in the tab |
| 4 | Source stamping in a sample Next.js app | Selection card shows `src/app/page.tsx:42` |
| 5 | Host command + `agent.inject`; tools `preview_selection`, `preview_screenshot` | "Make this button blue" after a pick edits the right file |
| 6 | Packaging: `dsh plugin add`, README, demo GIF | Fresh profile installs and works |

Estimated 4–6 weeks part-time for stages 0–6.

## Privacy defaults for our profile

- `session-log-deepseek` → `enabled: false` (otherwise session logs ride official DeepSeek API requests).
- `product-analytics` (Desktop) → `enabled: false`.
- `DSH_TELEMETRY_MODE=DISABLED`.
- Use a non-DeepSeek provider route for client/production code.

## Risks

- **Developer-preview churn**: breaking changes between releases; pin `engines.dsh` and the harness commit; client UI packages "change without notice" — inline markup, use `--dsw-alias-*` theme tokens, only `require` platform modules (react, cordis, zod, slots…).
- **Out-of-tree client bundling** is undocumented (in-repo uses `tsdown.client.ts`); we need our own bundler config producing the `__ModuleLoader__.load` IIFE with platform modules external.
- **Cross-origin messaging** must validate origins on both sides; the companion must never run in production.
- **Source mapping** differs per framework/bundler (SWC in Next, Babel, Vite); start with Next.js only.
- **Screenshots** from inside the page (html-to-image) miss some effects (cross-origin images, canvas); Desktop `capturePage` is a possible upgrade.

## Open questions

- Is this a personal tool, an open-source project, or a product? (Affects polish, docs, licence of our own code.)
- Fork the Harness or stay purely out-of-tree? (Plan assumes out-of-tree.)
- Which model provider for day-to-day use?
