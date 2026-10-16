#!/bin/sh
# Build the unsigned Harness Studio installer for Windows (x64) from the Harness commit pinned in
# docs/HARNESS_PIN.md. Harness packages Windows only on a Windows x64 machine, so this runs in
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
upstream="${HARNESS_UPSTREAM:-https://github.com/deepseek-ai/deepseek-harness.git}"
pin=$(sed -n 's/^Pinned commit: \([0-9a-f]\{40\}\).*/\1/p' "$root/docs/HARNESS_PIN.md")
version=$(cat "$root/desktop/VERSION")

fail() { echo "build-windows: $*" >&2; exit 1; }
[ -n "$pin" ] || fail "no pinned commit in docs/HARNESS_PIN.md"
[ "$(node -p 'process.platform + "-" + process.arch')" = win32-x64 ] || fail "needs Windows on x64"
command -v pnpm >/dev/null || fail "needs pnpm (corepack enable)"

echo "build-windows: Harness $pin from $upstream"
rm -rf "$harness"
mkdir -p "$work"
git clone --quiet --no-checkout "$upstream" "$harness"
git -C "$harness" checkout --quiet "$pin"
for patch in "$root/patches/harness-studio-brand.patch" "$root/patches/harness-studio-account.patch" "$root"/desktop/patches/*.patch; do
  echo "build-windows: applying $(basename "$patch")"
  git -C "$harness" apply "$patch" || fail "$(basename "$patch") no longer applies to $pin; refresh it (desktop/README.md)"
done
"$root/scripts/copy-logo.sh" "$harness"
mkdir -p "$harness/harness-studio-plugins"
(cd "$root" && npm pack --silent --pack-destination "$harness/harness-studio-plugins" ./plugins/devpreview ./plugins/connectors ./plugins/compact >/dev/null)

(cd "$harness" && pnpm install --frozen-lockfile \
  && pnpm --filter @deepseek-ai/dsh-desktop run render:tray-icon \
  && pnpm --filter @deepseek-ai/dsh-desktop run package:win:x64:unsigned)

exe="$root/dist/Harness-Studio-$version-win-x64-setup.exe"
rm -f "$exe" "$exe.sha256"
cp "$harness"/apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/harness-studio-*.exe "$exe"
(cd "$root/dist" && sha256sum "$(basename "$exe")" > "$(basename "$exe").sha256")
echo "build-windows: wrote $exe"
