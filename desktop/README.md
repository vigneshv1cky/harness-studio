# Harness Studio desktop app

Build files for the downloadable Harness Studio app (macOS and Linux; Windows is paused, see [below](#windows-paused)): [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) at the commit pinned in [docs/HARNESS_PIN.md](../docs/HARNESS_PIN.md), with Harness Studio's name and logo, the ten plugins built in, and telemetry off. Everything is applied by script to a fresh clone, so the build can be repeated and moved to a new Harness commit.

Harness Studio is an independent project. It is not affiliated with or endorsed by DeepSeek or Anthropic. It builds on its own fork of DeepSeek Harness, [harness-studio-core](https://github.com/vigneshv1cky/harness-studio-core), which keeps Harness's MIT licence; the patch files kept as a fallback carry lines of Harness's source as context, see [patches/NOTICE.md](../patches/NOTICE.md).

## What the app is

| | Harness Studio app | Upstream DeepSeek Harness |
|---|---|---|
| Name, icon, window title | Harness Studio, the blue target logo | DeepSeek Harness, the whale |
| Bundle identifier | `io.github.vigneshv1cky.harnessstudio` | `com.deepseek.harness` |
| Harness data | `~/.harness-studio` (or `DSH_HOME` when set) | `~/.dsh` |
| App data | `~/Library/Application Support/Harness Studio` | `~/Library/Application Support/DeepSeek Harness` |
| URL scheme | `harness-studio://` | `dsh://` |
| Plugins | Dev Preview, Connectors and Compact installed and on | none |
| Product analytics, session telemetry | off | on |
| Updates | none built in; download new versions from GitHub Releases | DeepSeek's update server |
| First launch | one action, "Choose a model provider", which opens Settings → Models listing every supported provider; shown whenever no provider key is configured | DeepSeek sign-in or DeepSeek API key |
| Feedback | none: no thumbs, Feedback command or menu item, and no Session-log upload | thumbs, Feedback command and menu, Session-log upload on by default |
| DeepSeek account | none: no sign-in, account menu or Settings → Account, and models never use an account sign-in; DeepSeek works with an API key like any other provider | sign-in, account pages, account-based models |
| Browser pane sign-in | off by default; app menu → **Allow Sign-in in Browser Pane** (see below) | not available |
| First-use workspace | `Documents/Harness Studio/default-workspace`, or an existing `Documents/deepseek-harness/default-workspace` | `Documents/deepseek-harness/default-workspace` |

Both apps can be installed side by side; they share no data.

## Build for macOS (Apple Silicon)

Needs a Mac with Apple Silicon, Node.js 24 (`nvm use 24`), pnpm (`corepack enable`), Git and a network connection. About 10 minutes and 10 GB of free disk space.

```sh
desktop/build-mac.sh
```

The script clones Harness Studio's Harness fork into `dist/build/harness` (replacing an earlier copy) at the commit pinned in [docs/HARNESS_PIN.md](../docs/HARNESS_PIN.md), which must be on the fork's `studio` branch, packs the ten plugins into the app, and runs Harness's own unsigned macOS packaging. It writes `dist/Harness-Studio-<version>-mac-arm64.dmg` and a `.sha256` file; the version is in [VERSION](VERSION), and the About panel shows the Harness version it is built on.

[smoke-mac.sh](smoke-mac.sh) checks a DMG without touching your own Harness Studio data: it runs a copy of the app on a throwaway home folder and checks the welcome screen, the built-in plugins and their pages, the first-use workspace (including that an existing `deepseek-harness` one is kept), the `harness-studio://` link and Office to PDF:

```sh
desktop/smoke-mac.sh dist/Harness-Studio-<version>-mac-arm64.dmg dist/smoke-mac
```

An unsigned app opens only after the person allows it once: open the DMG, drag Harness Studio to Applications, open it, then **System Settings → Privacy & Security → Open Anyway**.

### Signing and notarisation

Needs an [Apple Developer Program](https://developer.apple.com/programs/) membership, a **Developer ID Application** certificate in your login keychain, and an App Store Connect API key (Users and Access → Integrations → App Store Connect API) for notarisation.

1. Copy [signing.example.env](signing.example.env) to `desktop/.env.signing` (git ignores it) and fill it in. Keep the `.p8` key file outside the repository.
2. Run `desktop/build-mac.sh`. When `desktop/.env.signing` exists, [sign-mac.sh](sign-mac.sh) signs every binary in the app with the hardened runtime and Harness's entitlements, builds the DMG, signs it, sends it to Apple's notary service, and staples the ticket.

`HARNESS_STUDIO_SIGNING_IDENTITY=-` signs ad hoc and skips notarisation, which checks the signing steps without credentials.

## Windows (paused)

Downloads are for macOS and Linux; Windows isn't available yet. Windows packaging takes 35–40 minutes per build on GitHub's Windows runners, so its workflows were paused on 2026-10-17. Everything needed is kept: [build-windows.sh](build-windows.sh), [smoke-windows.sh](smoke-windows.sh), the Windows patches and icons, and the two workflows in [.github/workflows-paused](../.github/workflows-paused). To bring Windows back, move those two workflow files back into `.github/workflows` ([how](../.github/workflows-paused/README.md)); the build then produces an unsigned `Harness-Studio-<version>-win-x64-setup.exe` and smoke-tests it on the runner.

## Build for Linux (x64 and arm64)

Native packages are installed for the build machine, so each architecture is built on Linux of that architecture. [.github/workflows/build-linux.yml](../.github/workflows/build-linux.yml) runs [build-linux.sh](build-linux.sh) on GitHub's `ubuntu-24.04` (x64) and `ubuntu-24.04-arm` (arm64) runners: run **Build Linux app** from the Actions tab, or push a tag starting with `v`. Each job then installs the `.deb` on that runner and smoke-tests it on a virtual display with [smoke-linux.sh](smoke-linux.sh): the welcome screen, "Choose a model provider" opening Settings → Models, the ten built-in plugins and the Connectors, Session and Browser pages, the first-use workspace in `~/Documents/Harness Studio`, the window matching its launcher entry, and no DeepSeek account, feedback or sign-in. The AppImage, the `.deb`, their checksums and the smoke-test screenshots are kept as workflow artifacts for 30 days.

To build on your own Linux machine you need Node.js 24, pnpm, Git, `build-essential` and `python3`, and on arm64 also `fpm` (`sudo gem install fpm`):

```sh
desktop/build-linux.sh
```

It writes `dist/Harness-Studio-<version>-linux-<arch>.AppImage` and `dist/harness-studio_<version>_<amd64|arm64>.deb`.

Installing:

- **.deb (Debian, Ubuntu):** `sudo apt install ./harness-studio_<version>_amd64.deb`, then start **Harness Studio** from the applications menu or run `harness-studio`.
- **AppImage (most distributions):** `chmod +x Harness-Studio-*.AppImage` and run it. Ubuntu 22.04 and later need `libfuse2` (`libfuse2t64` on 24.04) to run AppImages, and a minimal system also needs the sound library (`libasound2t64` on 24.04, `libasound2` before). The arm64 AppImage also needs `zlib1g-dev`, which provides the `libz.so` its launcher loads.

On Linux the app has a normal window frame with a menu bar instead of the macOS title bar. The welcome screen, built-in plugins, Browser pane and settings are the same as on the other platforms. The Web app from source (main [README](../README.md#running-the-harness-from-source)) remains an option when a packaged app is not wanted.

## Browser pane sign-in

Off by default, the Browser pane behaves exactly like upstream Harness: each workspace gets its own browser storage, forgotten when the app quits, and Google refuses to sign in inside it. **Allow Sign-in in Browser Pane** in the app menu shows the trade-offs and restarts the app with sign-in compatibility on: an identity Google's sign-in accepts, a page-size fix, and one browser store kept on disk and shared by all workspaces. Read [patches/NOTICE.md](../patches/NOTICE.md#the-patch-is-opt-in) before turning it on. The setting is stored in `~/Library/Application Support/Harness Studio/desktop/browser-pane.json`.

## Patches

Each row is one commit on the fork's `studio` branch, in this order after the upstream base, with the patch file's name as its title. The patch files themselves stay in [`../patches`](../patches) and [`patches`](patches) as the fallback until the first release built from the fork; applied in this order to the upstream base, then `scripts/copy-logo.sh`, they reproduce the pinned tree exactly. A new change to Harness is a commit on `studio`, not a new patch file.

| Patch | Change |
|---|---|
| [`../patches/harness-studio-brand.patch`](../patches/harness-studio-brand.patch) | Name in the window title and sidebar, Harness Studio's mark in the sidebar and the empty chat, the plain name instead of DeepSeek's wordmark, "What should we build?" instead of "Into the Unknown", the icon artwork, and the development app's name and Dock icon |
| [`../patches/harness-studio-account.patch`](../patches/harness-studio-account.patch) | No DeepSeek account: its interface (sign-in, account menu, Settings → Account, account onboarding) and account-based models are switched off, and the welcome screen shows whenever no provider key is configured; no feedback (thumbs, the Feedback command and menu item, Session-log upload and its setting); a single welcome action, "Choose a model provider", that opens Settings → Models, where no provider is featured; with the matching Harness tests |
| [`01-rebrand.patch`](patches/01-rebrand.patch) | App name, installer and DMG names, bundle identifier, `harness-studio://` URL scheme, About panel, menu, dialog and installer text (English and Chinese) |
| [`02-identity-and-data.patch`](patches/02-identity-and-data.patch) | Harness data in `~/.harness-studio` for the packaged app |
| [`03-bundled-plugins.patch`](patches/03-bundled-plugins.patch) | Ships Harness Studio's ten built-in plugins inside the app and keeps them on: every launch adds any built-in a profile lacks (one made before Terminal and Editor shipped), keeping the person's own plugins, and the crash-recovery "disable plugins" action removes only third-party plugins; with tests |
| [`04-browser-pane-sign-in-setting.patch`](patches/04-browser-pane-sign-in-setting.patch) | The opt-in Browser pane sign-in setting and its menu item |
| [`05-telemetry-off.patch`](patches/05-telemetry-off.patch) | Product analytics and session telemetry off; Session-log upload off by default |
| [`06-unsigned-windows.patch`](patches/06-unsigned-windows.patch) | Unsigned Windows builds use the same local settings as unsigned macOS builds, without DeepSeek's release configuration or forced-update policy |
| [`07-upstream-tests.patch`](patches/07-upstream-tests.patch) | Harness's own desktop tests updated for the changes above (names, menu, URL scheme, bundled plugins), so they pass on the patched copy |
| [`08-linux.patch`](patches/08-linux.patch) | Linux targets (`linux-x64`, `linux-arm64`) in Harness's packaging: an AppImage and a `.deb` named `harness-studio`, with the Harness Studio icon set; the Linux sandbox launcher unpacked from the app archive so it can run; the packaging smoke test for the Linux layout; Linux kept out of the release upload and retention scripts; and the matching Harness tests |
| [`09-default-workspace-folder.patch`](patches/09-default-workspace-folder.patch) | The first-use workspace in `Documents/Harness Studio` for new installs, keeping an existing `Documents/deepseek-harness`; with the matching Harness tests |
| [`10-releases-page.patch`](patches/10-releases-page.patch) | **Check for Updates…** opens the public [Releases page](https://github.com/vigneshv1cky/harness-studio/releases) instead of checking an update feed Harness Studio doesn't publish; with the matching Harness tests |
| [`11-compact-welcome.patch`](patches/11-compact-welcome.patch) | A compact first-launch welcome: a 420 × 340 window with the mark, greeting and "Choose a model provider" grouped in the middle, the greeting and description in the system font, and a 32 px button; with the matching Harness test |
| [`12-instructions.patch`](patches/12-instructions.patch) | One instruction file per folder (`AGENTS.md`, else `CLAUDE.md`, and likewise for the `.local` overlays), so a repository keeping both for different tools pays for its rules once; a changed instruction file is sent as an edit of its changed lines instead of the whole file again; instruction files follow Claude Code-style `@path` includes, skipping files Harness loads anyway (project files only inside their project, personal files anywhere, five levels, no loops); the instruction budget rises from 64 KB to 128 KB; and when instructions are still left out or cut, the Chat shows a row under the message naming each file and its size; with tests. Harness Studio reads only its own instruction files, in Claude Code's three levels: the Harness home's `AGENTS.md`, then each folder's `AGENTS.md` from the project root down to the session folder, each followed by its `AGENTS.local.md` (no `CLAUDE.md`, `CLAUDE.local.md` or shared `~/.agents/AGENTS.md`; an explicit `@CLAUDE.md` import still expands). Imports: only the real global file (recognized by its absolute path, not its displayed one) may import outside the project; each file is read once per expansion, the byte cap is enforced while reading, and one load reads at most 200 files |
| [`13-workspace-label.patch`](patches/13-workspace-label.patch) | The sidebar's **View options → Group by** first choice reads "Workspace" instead of "WorkSpace"; with the matching Harness tests |
| [`14-right-panel-width.patch`](patches/14-right-panel-width.patch) | The right panel (Files, Terminal, Browser and the other right tabs) first opens at 35% of the window instead of 45%, so the conversation keeps most of the width; dragging it wider still works and holds until the app quits |
| [`15-plan-mode-read-only.patch`](patches/15-plan-mode-read-only.patch) | Plan mode is enforced, not just requested: while it is on, the session's sandbox is held read-only, so commands and file tools cannot change files (even through an approved escalation) until the plan is approved or plan mode is switched off. The sandbox policy gains a general way for a plugin to hold a session at a narrower mode, with the reason the agent is told; with tests. The hold also covers subagents and workflow children started from the planning session, however deep |
| [`16-network-for-commands.patch`](patches/16-network-for-commands.patch) | Network limits for confined commands: the sandbox policy gains `on`, `off` and a host `allowlist`, read from `<harness home>/harness-studio/network.json` (written by Settings → General → Network for commands) over the configured default `on`. Seatbelt denies outbound connections except loopback; bwrap gives each command its own network namespace; under `allowlist` a built-in proxy admits only the listed hosts (through a small bridge inside the namespace on Linux). Landlock-only hosts fail closed when network is limited. The agent is told the setting; with tests, including real Seatbelt runs. The proxy canonicalizes every target (IP literals in any spelling, including IPv6 with a zone suffix and IPv4-mapped forms, match only an exact IP entry; a host with `%` is refused), sends the checked host as `Host`, is closed as soon as the setting stops naming its host list, and uses random socket names; an AppImage's mount is bound back inside bwrap so the bridge runs. The agent is told plainly that `off` blocks direct connections but local proxies, SSH tunnels and system services can still reach other hosts. The SSH helper accepts the network field |
| [`17-command-line-tool.patch`](patches/17-command-line-tool.patch) | The terminal command, installed from **Install Command-Line Tool…** (was **Manage dsh Command…**) as `/usr/local/bin/harness-studio`: its launcher starts the Harness Studio executable (it named DeepSeek Harness's, so the command never started), defaults `DSH_HOME` to `~/.harness-studio`, and runs a bare task in a new `harness-studio` profile that adds Connectors, Remember and Hooks to the headless runner; dialog wording updated in English and Chinese; with tests. The `harness-studio` profile also loads Compact's host half, so its site approval applies on the command line, where an "ask" becomes a refusal |
| [`18-browser-devtools.patch`](patches/18-browser-devtools.patch) | DevTools access to the Browser pane's own pages: the window may send an allowed set of Chrome DevTools Protocol commands (real mouse and keyboard input, screenshots, DOM and accessibility reads, script evaluation, response bodies) to a page it holds through a Browser pane lease, and nothing else; console messages, uncaught errors with their stacks, and network requests, responses and failures are kept per page (the last 300) so the agent can read them after the fact; navigation still goes through the pane's own checks; with tests. `0.0.0.0` counts as local; a remote page that commits after a command re-attached mid-navigation ends the attachment, and the address is re-checked after attaching. Events are kept in separate rings per kind (console, exceptions and log entries 300 each; requests, responses and failures 500 each), `Harness.events` takes an optional `kinds` list and reports `dropped: { console, network }` |
| [`19-stale-host-cookies.patch`](patches/19-stale-host-cookies.patch) | Startup no longer fails after many launches: the Host names its sign-in cookie after its address, port included, and takes a new port each launch, while cookies are kept per host name, so every launch left one more `127.0.0.1` cookie until requests carried so many that the Host refused them (HTTP 431) and the app kept restarting. Earlier launches' sign-in cookies are now removed before signing in |
| [`20-protect-secret-files.patch`](patches/20-protect-secret-files.patch) | Secret files hidden from the agent: the sandbox policy gains a read-deny list, on in the app, covering `~/.ssh` (except `known_hosts` and `config`), `~/.aws`, `~/.config/gcloud`, `~/.netrc`, `~/.git-credentials`, `~/.npmrc`, `~/.docker/config.json`, `~/.env`, the Harness home's `.credentials.yaml` and `.env`, and dotenv files outside the workspace. Seatbelt denies reading their contents (a later rule re-allows dotenv files inside the workspace, and the exceptions last); bwrap masks the ones that exist with an empty folder or `/dev/null` (it cannot name other projects' dotenv files, and Landlock-only hosts do not apply the list). The read, edit, write and grep tools refuse the same files, symlinks included. Full access lifts it. The agent is told which files are hidden; with tests, including real Seatbelt runs that show a command posting `~/.aws/credentials` to a loopback listener sends nothing. Also hides Harness Studio's `connectors.json`, `connector-grants.json` and `watches.json`, and never imports a hidden file through an instruction `@path`. What the agent is told follows the backend: Seatbelt hides everything listed; bwrap hides listed paths but not dotenv files outside the workspace, and says so; Landlock-only Linux and Windows say commands can still read the files. The SSH helper accepts (and drops) the secret-file list |
| [`21-stress-fixes.patch`](patches/21-stress-fixes.patch) | Fixes from a stress test: a message sent while a new session is still being created is given back to the composer with a notice instead of vanishing; command output over the 64 MiB log cap keeps its first and last 32 MiB in the log with a line naming the bytes left out (the agent is told how many), instead of losing the log; a job's output logs are removed when the job is discarded, and every output log when the app quits; with tests |
| [`22-computer-use.patch`](patches/22-computer-use.patch) | Computer use on macOS: the provider refuses applications on a refused list (terminals, script editors, System Settings, password managers, Harness Studio itself) before asking, offers only Allow for this task or Deny for task-only applications (browsers), and asks `Let the agent use <app>?`; the helper gains `--permissions`, which reports Accessibility and Screen Recording without a system dialog, and builds under Swift 6.2. With tests |
| [`23-markdown-view-switch.patch`](patches/23-markdown-view-switch.patch) | A Markdown file's preview shows a Rendered / Source switch instead of the viewer menu (Source is the code viewer), opening in the view chosen last, remembered in browser storage under `harness-studio.markdown-view`, which the Files tab shares. With a test |
| [`24-cancel-cause-guard.patch`](patches/24-cancel-cause-guard.patch) | The agent loop refuses a cancel request whose cause is not one of `{ kind: 'user' }`, `{ kind: 'parent' }`, `{ kind: 'disposed' }` or `{ kind: 'hook', reason }`, throwing at the call before the turn is aborted. A JavaScript plugin that passed a plain sentence used to abort the turn and log its `turn/end` with `reason: null`, which blanked the session's chat for good. With tests |
| [`25-files-tab-viewers.patch`](patches/25-files-tab-viewers.patch) | The file preview becomes a component Factory (`sidebar.right.document.preview`) that the right panel's file tabs and Harness Studio's Files tab both show, so the Files tab has every viewer (PDF, images, spreadsheets, Word and PowerPoint, web pages). The right panel gains resource handlers, which let the Files tab take over files the conversation opens (file cards, links, references) instead of a tab per file. A host can pass the path the preview's header shows. The Excel viewer centres every cell horizontally and vertically, draws cells that name no font in the system sans-serif font instead of FortuneSheet's Times New Roman, and its formula bar, sheet tabs, zoom and selection follow the app's type and colours. With tests |
| [`26-boot-styles.patch`](patches/26-boot-styles.patch) | The desktop page adds every style a plugin stored in browser storage under `dsh.boot-style:` to its head before the first paint, marked with `data-dsh-boot-style`, so a plugin's look (Harness Studio's colour themes, or Harness's dark page colour) is there from the first frame instead of appearing once plugins load; only CSS text is stored and nothing stored is executed. With a test |
| [`27-linux-command-line.patch`](patches/27-linux-command-line.patch) | The terminal command on Linux: the launcher runs the app's executable beside `resources/` on Linux (it named the macOS one), and the .deb's install scripts (electron-builder's own, in `apps/desktop/installer/linux-after-install.tpl` and `linux-after-remove.tpl`, with this one change) link `/usr/bin/harness-studio` to the launcher instead of the app's executable, replacing the link an earlier version registered; the menu entry still starts the app by its full path. With the launcher test run in the Linux layout |
| [`28-computer-use-in-app.patch`](patches/28-computer-use-in-app.patch) | Computer use in the downloadable macOS app: packaging builds the native helper from its Swift sources (`xcrun swift build`) into `Resources/runtime/cua`, outside `app.asar`, and the app hands its path to the Host as `DSH_CUA_HELPER`; the web-app bundle (which the desktop profile loads) inserts Harness's computer-use provider registry and macOS provider, switched off on other systems and when no helper is named, and lists both packages as dependencies so the app ships them (with the lockfile change). The development app names its own `swift build` helper the same way |
| [`29-terminal-chat.patch`](patches/29-terminal-chat.patch) | A chat in the terminal: with no task and a terminal on stdin, the one-task runner opens a chat in one Session instead of refusing; each line is a turn answered on stdout as a one-task run prints, Ctrl-C stops the reply (or quits at the prompt), Ctrl-D or `/exit` quits, and the Session id is printed to continue with `--session-id`. `--json` with no task is still an error, and piped input still runs one task. With tests |

## Moving to a new Harness commit

Upstream releases are merged into the fork's `studio` branch, never rebased, so every commit an earlier release was built from stays buildable. The full steps are in [docs/FORK_PLAN.md](../docs/FORK_PLAN.md#5-merging-an-upstream-drop); in short:

1. In the dev copy (`harness/`), `git fetch upstream`, then on a branch from `studio`, `git merge upstream/master`, and resolve the conflicts.
2. `pnpm install`, then `pnpm run build`, which includes the type check that packaging runs. Then run Harness's tests for the areas the commits touch (`pnpm exec vitest run apps/desktop/tests packages/boot/app-boot packages/client/ui-brand-official packages/client/ui-conversation packages/client/ui-sidebar packages/client/ui-primitives packages/client/ui-settings-models packages/client/ui-settings-general packages/client/ui-settings-account packages/bundle`) and the plugins' tests.
3. Merge the branch into `studio`, push it to the fork, set `Pinned commit:` and `Upstream base:` in [docs/HARNESS_PIN.md](../docs/HARNESS_PIN.md), and build and smoke-test macOS and Linux.

## Chrome extension

The [Chrome extension](../chrome-bridge) is not inside the app. For now it is distributed as a zip attached to each GitHub release: people unzip it, turn on Developer mode in `chrome://extensions`, and choose **Load unpacked**; Chrome then shows a developer-mode notice at startup. Publishing it on the Chrome Web Store instead needs a developer account (a one-time US$5 fee), a privacy policy URL, a store listing (description, 128-pixel icon, screenshots), a justification for each permission, and a review that usually takes a few days.

```sh
(cd chrome-bridge && zip -r ../dist/harness-studio-chrome-extension.zip extension)
```

## Known limitations

- The terminal command comes from **Install Command-Line Tool…** on macOS and with the .deb on Linux; the AppImage has no terminal command.
- The ten built-in plugins (Dev Preview, Connectors, Compact, Sessions, Remember, Hooks, Undo, Watch, Terminal and Editor) do not appear on the Plugins page and are always on.
- Anyone who used a DeepSeek account sign-in must add an API key (DeepSeek's or another provider's) after updating; the welcome screen leads there.
- The app has no update feed; new versions come from GitHub Releases.
- **Linux:** Word, Excel and PowerPoint files convert to PDF with the Office kit's WebAssembly engine, as no native Linux engine exists; it is slower than the native engine on macOS.
- **Linux:** CI smoke-tests only the `.deb`, on a virtual display. Both packages were also tried by hand on Ubuntu 24.04 (x64 and arm64) with an Xfce desktop. `harness-studio://` links need the `.deb`, or an AppImage integrated with the desktop.
- **Linux:** when the system reports no separate Documents folder, the first-use workspace goes in `~/Documents/Harness Studio`.
