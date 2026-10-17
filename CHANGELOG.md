# Changelog

Changes to the downloadable Harness Studio app. The plugins in [`plugins`](plugins) keep their own versions.

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
