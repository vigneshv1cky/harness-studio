#!/bin/sh
# Build the unsigned Harness Studio desktop app for Linux (AppImage and .deb) from the commit of Harness
# Studio's Harness fork pinned in docs/HARNESS_PIN.md. Native packages are installed for the build machine, so run it on Linux
# with the architecture you want (x64 or arm64); .github/workflows/build-linux.yml runs it on GitHub's
# Ubuntu runners:
#
#   desktop/build-linux.sh
#
# Same steps as desktop/build-mac.sh. Writes dist/Harness-Studio-<version>-linux-<arch>.AppImage and
# dist/harness-studio_<version>_<debian arch>.deb, each with a .sha256 file. HARNESS_STUDIO_WORK moves the
# build tree (default dist/build-linux); HARNESS_UPSTREAM overrides the Harness repository cloned.
# Needs Node.js 24, pnpm, Git, a C toolchain and Python 3 (build-essential python3), and on arm64 the fpm
# packager (gem install fpm), since electron-builder's bundled one is x64-only.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
work="${HARNESS_STUDIO_WORK:-$root/dist/build-linux}"
harness="$work/harness"
upstream="${HARNESS_UPSTREAM:-https://github.com/vigneshv1cky/harness-studio-core.git}"
pin=$(sed -n 's/^Pinned commit: \([0-9a-f]\{40\}\).*/\1/p' "$root/docs/HARNESS_PIN.md")
version=$(cat "$root/desktop/VERSION")

fail() { echo "build-linux: $*" >&2; exit 1; }
[ "$(uname -s)" = Linux ] || fail "needs Linux"
case "$(uname -m)" in
  x86_64|amd64) arch=x64; debarch=amd64 ;;
  aarch64|arm64) arch=arm64; debarch=arm64 ;;
  *) fail "unsupported architecture $(uname -m)" ;;
esac
[ -n "$pin" ] || fail "no pinned commit in docs/HARNESS_PIN.md"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || fail "needs Node.js 24"
command -v pnpm >/dev/null || fail "needs pnpm (corepack enable)"
if [ "$arch" = arm64 ]; then
  command -v fpm >/dev/null || fail "needs fpm on arm64 (gem install fpm)"
  export USE_SYSTEM_FPM=true
fi

echo "build-linux: Harness $pin from $upstream ($arch)"
rm -rf "$harness"
mkdir -p "$work"
git clone --quiet --no-checkout "$upstream" "$harness"
git -C "$harness" checkout --quiet "$pin"
# Builds use only commits published on the fork's studio branch (docs/HARNESS_PIN.md).
git -C "$harness" branch -r --contains "$pin" | grep -q ' origin/studio$' || fail "$pin is not on the studio branch of $upstream"
mkdir -p "$harness/harness-studio-plugins"
(cd "$root" && npm pack --silent --pack-destination "$harness/harness-studio-plugins" ./plugins/devpreview ./plugins/connectors ./plugins/compact ./plugins/sessions ./plugins/remember ./plugins/hooks ./plugins/undo ./plugins/watch ./plugins/terminal ./plugins/editor >/dev/null)

(cd "$harness" && pnpm install --frozen-lockfile && pnpm --filter @deepseek-ai/dsh-desktop run "package:linux:$arch:unsigned")

artifacts="$harness/apps/desktop/.desktop-build/targets/linux-$arch/unsigned-artifacts"
mkdir -p "$root/dist"
appimage="$root/dist/Harness-Studio-$version-linux-$arch.AppImage"
deb="$root/dist/harness-studio_${version}_$debarch.deb"
rm -f "$appimage" "$appimage.sha256" "$deb" "$deb.sha256"
cp "$artifacts"/harness-studio-*.AppImage "$appimage"
chmod 755 "$appimage"
cp "$artifacts"/harness-studio-*.deb "$deb"
(cd "$root/dist" && for file in "$(basename "$appimage")" "$(basename "$deb")"; do sha256sum "$file" > "$file.sha256"; done)
echo "build-linux: wrote $appimage and $deb"
