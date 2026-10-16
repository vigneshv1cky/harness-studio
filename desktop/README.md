# Harness Studio desktop app

Build files for the downloadable Harness Studio app: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) at the commit pinned in [docs/HARNESS_PIN.md](../docs/HARNESS_PIN.md), with Harness Studio's name and logo, the three plugins built in, and telemetry off. Everything is applied by script to a fresh clone, so the build can be repeated and moved to a new Harness commit.

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

Both apps can be installed side by side; they share no data.

## Build for macOS (Apple Silicon)

Needs a Mac with Apple Silicon, Node.js 24 (`nvm use 24`), pnpm (`corepack enable`), Git and a network connection. About 10 minutes and 10 GB of free disk space.

```sh
desktop/build-mac.sh
```

The script clones Harness into `dist/build/harness` (replacing an earlier copy), applies `patches/harness-studio-brand.patch`, `patches/harness-studio-account.patch` and then `desktop/patches/*.patch` in order, copies the logo, packs the three plugins into the app, and runs Harness's own unsigned macOS packaging. It writes `dist/Harness-Studio-<version>-mac-arm64.dmg` and a `.sha256` file; the version is in [VERSION](VERSION), and the About panel shows the Harness version it is built on.

An unsigned app opens only after the person allows it once: open the DMG, drag Harness Studio to Applications, open it, then **System Settings → Privacy & Security → Open Anyway**.

### Signing and notarisation

Needs an [Apple Developer Program](https://developer.apple.com/programs/) membership, a **Developer ID Application** certificate in your login keychain, and an App Store Connect API key (Users and Access → Integrations → App Store Connect API) for notarisation.

1. Copy [signing.example.env](signing.example.env) to `desktop/.env.signing` (git ignores it) and fill it in. Keep the `.p8` key file outside the repository.
2. Run `desktop/build-mac.sh`. When `desktop/.env.signing` exists, [sign-mac.sh](sign-mac.sh) signs every binary in the app with the hardened runtime and Harness's entitlements, builds the DMG, signs it, sends it to Apple's notary service, and staples the ticket.

`HARNESS_STUDIO_SIGNING_IDENTITY=-` signs ad hoc and skips notarisation, which checks the signing steps without credentials.

## Build for Windows (x64)

Harness packages Windows only on a Windows x64 machine. [.github/workflows/build-windows.yml](../.github/workflows/build-windows.yml) runs [build-windows.sh](build-windows.sh) on a GitHub-hosted Windows runner: run **Build Windows app** from the repository's Actions tab, or push a tag starting with `v`. The unsigned installer, `Harness-Studio-<version>-win-x64-setup.exe`, and its checksum are kept as a workflow artifact for 30 days. Windows shows "Windows protected your PC" for an unsigned installer: **More info → Run anyway**. Removing that warning needs a code-signing certificate.

## Linux

Harness has no packaged Linux desktop app. Run Harness from source and use the Web app with the plugins installed; see the main [README](../README.md#running-the-harness-from-source). The desktop-only features (the Browser pane's embedded browser, picking elements on live websites, Browser pane sign-in) are not available there.

## Browser pane sign-in

Off by default, the Browser pane behaves exactly like upstream Harness: each workspace gets its own browser storage, forgotten when the app quits, and Google refuses to sign in inside it. **Allow Sign-in in Browser Pane** in the app menu (on Windows, the menu in the title bar) shows the trade-offs and restarts the app with sign-in compatibility on: an identity Google's sign-in accepts, a page-size fix, and one browser store kept on disk and shared by all workspaces. Read [patches/NOTICE.md](../patches/NOTICE.md#the-patch-is-opt-in) before turning it on. The setting is stored in `~/Library/Application Support/Harness Studio/desktop/browser-pane.json`.

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
