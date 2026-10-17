# Harness Studio desktop app

Build files for the downloadable Harness Studio app (macOS and Linux; Windows is paused, see [below](#windows-paused)): [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) at the commit pinned in [docs/HARNESS_PIN.md](../docs/HARNESS_PIN.md), with Harness Studio's name and logo, the three plugins built in, and telemetry off. Everything is applied by script to a fresh clone, so the build can be repeated and moved to a new Harness commit.

Harness Studio is an independent project. It is not affiliated with or endorsed by DeepSeek or Anthropic. The patches carry lines of DeepSeek Harness's source as context; see [patches/NOTICE.md](../patches/NOTICE.md) for its MIT licence notice.

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

The script clones Harness into `dist/build/harness` (replacing an earlier copy), applies `patches/harness-studio-brand.patch`, `patches/harness-studio-account.patch` and then `desktop/patches/*.patch` in order, copies the logo, packs the three plugins into the app, and runs Harness's own unsigned macOS packaging. It writes `dist/Harness-Studio-<version>-mac-arm64.dmg` and a `.sha256` file; the version is in [VERSION](VERSION), and the About panel shows the Harness version it is built on.

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

Native packages are installed for the build machine, so each architecture is built on Linux of that architecture. [.github/workflows/build-linux.yml](../.github/workflows/build-linux.yml) runs [build-linux.sh](build-linux.sh) on GitHub's `ubuntu-24.04` (x64) and `ubuntu-24.04-arm` (arm64) runners: run **Build Linux app** from the Actions tab, or push a tag starting with `v`. Each job then installs the `.deb` on that runner and smoke-tests it on a virtual display with [smoke-linux.sh](smoke-linux.sh): the welcome screen, "Choose a model provider" opening Settings → Models, the three built-in plugins and their pages, the first-use workspace in `~/Documents/Harness Studio`, the window matching its launcher entry, and no DeepSeek account, feedback or sign-in. The AppImage, the `.deb`, their checksums and the smoke-test screenshots are kept as workflow artifacts for 30 days.

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

Applied in this order to the pinned commit:

| Patch | Change |
|---|---|
| [`../patches/harness-studio-brand.patch`](../patches/harness-studio-brand.patch) | Name in the window title and sidebar, Harness Studio's mark in the sidebar and the empty chat, the plain name instead of DeepSeek's wordmark, "What should we build?" instead of "Into the Unknown", the icon artwork, and the development app's name and Dock icon |
| [`../patches/harness-studio-account.patch`](../patches/harness-studio-account.patch) | No DeepSeek account: its interface (sign-in, account menu, Settings → Account, account onboarding) and account-based models are switched off, and the welcome screen shows whenever no provider key is configured; no feedback (thumbs, the Feedback command and menu item, Session-log upload and its setting); a single welcome action, "Choose a model provider", that opens Settings → Models, where no provider is featured; with the matching Harness tests |
| [`01-rebrand.patch`](patches/01-rebrand.patch) | App name, installer and DMG names, bundle identifier, `harness-studio://` URL scheme, About panel, menu, dialog and installer text (English and Chinese) |
| [`02-identity-and-data.patch`](patches/02-identity-and-data.patch) | Harness data in `~/.harness-studio` for the packaged app |
| [`03-bundled-plugins.patch`](patches/03-bundled-plugins.patch) | Ships Dev Preview, Connectors and Compact inside the app and turns them on in a new profile |
| [`04-browser-pane-sign-in-setting.patch`](patches/04-browser-pane-sign-in-setting.patch) | The opt-in Browser pane sign-in setting and its menu item |
| [`05-telemetry-off.patch`](patches/05-telemetry-off.patch) | Product analytics and session telemetry off; Session-log upload off by default |
| [`06-unsigned-windows.patch`](patches/06-unsigned-windows.patch) | Unsigned Windows builds use the same local settings as unsigned macOS builds, without DeepSeek's release configuration or forced-update policy |
| [`07-upstream-tests.patch`](patches/07-upstream-tests.patch) | Harness's own desktop tests updated for the changes above (names, menu, URL scheme, bundled plugins), so they pass on the patched copy |
| [`08-linux.patch`](patches/08-linux.patch) | Linux targets (`linux-x64`, `linux-arm64`) in Harness's packaging: an AppImage and a `.deb` named `harness-studio`, with the Harness Studio icon set; the Linux sandbox launcher unpacked from the app archive so it can run; the packaging smoke test for the Linux layout; Linux kept out of the release upload and retention scripts; and the matching Harness tests |
| [`09-default-workspace-folder.patch`](patches/09-default-workspace-folder.patch) | The first-use workspace in `Documents/Harness Studio` for new installs, keeping an existing `Documents/deepseek-harness`; with the matching Harness tests |
| [`10-releases-page.patch`](patches/10-releases-page.patch) | **Check for Updates…** opens the public [Releases page](https://github.com/vigneshv1cky/harness-studio/releases) instead of checking an update feed Harness Studio doesn't publish; with the matching Harness tests |
| [`11-compact-welcome.patch`](patches/11-compact-welcome.patch) | A compact first-launch welcome: a 420 × 340 window with the mark, greeting and "Choose a model provider" grouped in the middle, the greeting and description in the system font, and a 32 px button; with the matching Harness test |

## Moving to a new Harness commit

1. Change the commit in [docs/HARNESS_PIN.md](../docs/HARNESS_PIN.md).
2. Run `desktop/build-mac.sh`. A patch that no longer applies stops the build and names itself.
3. To refresh one: clone Harness at the new commit, apply the patches before it and commit that state, apply it with `git apply --3way`, resolve the conflicts, and save `git diff` against that commit over the old file.
4. Run Harness's tests for the areas the patches touch (`pnpm exec vitest run apps/desktop/tests packages/boot/app-boot packages/client/ui-brand-official packages/client/ui-conversation packages/client/ui-sidebar packages/client/ui-primitives packages/client/ui-settings-models packages/client/ui-settings-general packages/client/ui-settings-account packages/bundle` in `dist/build/harness`) and refresh `07-upstream-tests.patch` the same way.

## Chrome extension

The [Chrome extension](../chrome-bridge) is not inside the app. For now it is distributed as a zip attached to each GitHub release: people unzip it, turn on Developer mode in `chrome://extensions`, and choose **Load unpacked**; Chrome then shows a developer-mode notice at startup. Publishing it on the Chrome Web Store instead needs a developer account (a one-time US$5 fee), a privacy policy URL, a store listing (description, 128-pixel icon, screenshots), a justification for each permission, and a review that usually takes a few days.

```sh
(cd chrome-bridge && zip -r ../dist/harness-studio-chrome-extension.zip extension)
```

## Known limitations

- The **Manage dsh Command** menu item installs a `dsh` command that uses `~/.dsh`, not Harness Studio's data.
- The three built-in plugins do not appear on the Plugins page and are always on.
- Anyone who used a DeepSeek account sign-in must add an API key (DeepSeek's or another provider's) after updating; the welcome screen leads there.
- The app has no update feed; new versions come from GitHub Releases.
- **Linux:** Word, Excel and PowerPoint files convert to PDF with the Office kit's WebAssembly engine, as no native Linux engine exists; it is slower than the native engine on macOS.
- **Linux:** CI smoke-tests only the `.deb`, on a virtual display. Both packages were also tried by hand on Ubuntu 24.04 (x64 and arm64) with an Xfce desktop. `harness-studio://` links need the `.deb`, or an AppImage integrated with the desktop.
- **Linux:** when the system reports no separate Documents folder, the first-use workspace goes in `~/Documents/Harness Studio`.
