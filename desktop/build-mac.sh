#!/bin/sh
# Build the Harness Studio desktop app for macOS (Apple Silicon) from the commit of Harness Studio's Harness fork
# pinned in docs/HARNESS_PIN.md:
#
#   desktop/build-mac.sh
#
# Clones the fork into dist/build/harness (replacing any earlier copy) at the pinned commit, which must be on
# its studio branch, bundles the ten plugins, and runs Harness's unsigned macOS packaging. Writes
# dist/Harness-Studio-<version>-mac-arm64.dmg and a .sha256 file beside it. When desktop/.env.signing exists,
# the app is signed with your Developer ID and notarised instead (see desktop/README.md). HARNESS_UPSTREAM
# overrides the Harness repository cloned (a local clone of the fork, for example).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
work="$root/dist/build"
harness="$work/harness"
upstream="${HARNESS_UPSTREAM:-https://github.com/vigneshv1cky/harness-studio-core.git}"
pin=$(sed -n 's/^Pinned commit: \([0-9a-f]\{40\}\).*/\1/p' "$root/docs/HARNESS_PIN.md")
version=$(cat "$root/desktop/VERSION")

fail() { echo "build-mac: $*" >&2; exit 1; }
[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || fail "needs a Mac with Apple Silicon"
[ -n "$pin" ] || fail "no pinned commit in docs/HARNESS_PIN.md"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || fail "needs Node.js 24 (nvm use 24)"
command -v pnpm >/dev/null || fail "needs pnpm (corepack enable)"

echo "build-mac: Harness $pin from $upstream"
rm -rf "$harness"
mkdir -p "$work"
git clone --quiet --no-checkout "$upstream" "$harness"
git -C "$harness" checkout --quiet "$pin"
# Builds use only commits published on the fork's studio branch (docs/HARNESS_PIN.md).
git -C "$harness" branch -r --contains "$pin" | grep -q ' origin/studio$' || fail "$pin is not on the studio branch of $upstream"
mkdir -p "$harness/harness-studio-plugins"
(cd "$root" && npm pack --silent --pack-destination "$harness/harness-studio-plugins" ./plugins/devpreview ./plugins/connectors ./plugins/compact ./plugins/sessions ./plugins/remember ./plugins/hooks ./plugins/undo ./plugins/watch ./plugins/terminal ./plugins/editor >/dev/null)

(cd "$harness" && pnpm install --frozen-lockfile && pnpm --filter @deepseek-ai/dsh-desktop run package:mac:arm64:unsigned)

artifacts="$harness/apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts"
dmg="$root/dist/Harness-Studio-$version-mac-arm64.dmg"
rm -f "$dmg" "$dmg.sha256"
if [ -f "$root/desktop/.env.signing" ]; then
  "$root/desktop/sign-mac.sh" "$artifacts/mac-arm64/Harness Studio.app" "$dmg"
else
  cp "$artifacts"/harness-studio-*-mac-arm64-unsigned.dmg "$dmg"
fi
(cd "$root/dist" && shasum -a 256 "$(basename "$dmg")" > "$(basename "$dmg").sha256")
echo "build-mac: wrote $dmg"
