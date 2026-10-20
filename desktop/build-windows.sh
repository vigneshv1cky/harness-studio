#!/bin/sh
# Build the unsigned Harness Studio installer for Windows (x64) from the commit of Harness Studio's Harness
# fork pinned in docs/HARNESS_PIN.md. Harness packages Windows only on a Windows x64 machine, so this runs in
# Git Bash there; .github/workflows/build-windows.yml runs it on GitHub Actions:
#
#   desktop/build-windows.sh
#
# Same steps as desktop/build-mac.sh, plus rendering the tray icon from the Windows logo.
# Writes dist/Harness-Studio-<version>-win-x64-setup.exe and a .sha256 file beside it.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
work="$root/dist/build"
harness="$work/harness"
upstream="${HARNESS_UPSTREAM:-https://github.com/vigneshv1cky/harness-studio-core.git}"
pin=$(sed -n 's/^Pinned commit: \([0-9a-f]\{40\}\).*/\1/p' "$root/docs/HARNESS_PIN.md")
version=$(cat "$root/desktop/VERSION")

fail() { echo "build-windows: $*" >&2; exit 1; }
[ -n "$pin" ] || fail "no pinned commit in docs/HARNESS_PIN.md"
[ "$(node -p 'process.platform + "-" + process.arch')" = win32-x64 ] || fail "needs Windows on x64"
command -v pnpm >/dev/null || fail "needs pnpm (corepack enable)"

echo "build-windows: Harness $pin from $upstream"
rm -rf "$harness"
mkdir -p "$work"
# Keep LF line endings: Git for Windows converts text files to CRLF by default, and the patches would not apply.
git clone --quiet --no-checkout -c core.autocrlf=false -c core.eol=lf "$upstream" "$harness"
git -C "$harness" checkout --quiet "$pin"
# Builds use only commits published on the fork's studio branch (docs/HARNESS_PIN.md).
git -C "$harness" branch -r --contains "$pin" | grep -q ' origin/studio$' || fail "$pin is not on the studio branch of $upstream"
mkdir -p "$harness/harness-studio-plugins"
(cd "$root" && npm pack --silent --pack-destination "$harness/harness-studio-plugins" ./plugins/devpreview ./plugins/connectors ./plugins/compact ./plugins/sessions ./plugins/remember ./plugins/hooks ./plugins/undo ./plugins/watch ./plugins/terminal ./plugins/editor >/dev/null)

# Packaging runs tar on Windows paths such as D:\...; Git Bash's GNU tar reads "D:" as a remote host, so
# Windows' own tar (System32) must come first, as it does outside Git Bash.
system32="$(cygpath -u "$SYSTEMROOT")/System32"
(cd "$harness" && export PATH="$system32:$PATH" && pnpm install --frozen-lockfile \
  && pnpm --filter @deepseek-ai/dsh-desktop run render:tray-icon \
  && HARNESS_STUDIO_VERSION="$version" pnpm --filter @deepseek-ai/dsh-desktop run package:win:x64:unsigned)

exe="$root/dist/Harness-Studio-$version-win-x64-setup.exe"
rm -f "$exe" "$exe.sha256"
cp "$harness"/apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/harness-studio-*.exe "$exe"
(cd "$root/dist" && sha256sum "$(basename "$exe")" > "$(basename "$exe").sha256")
echo "build-windows: wrote $exe"
