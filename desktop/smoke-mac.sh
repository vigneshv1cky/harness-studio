#!/bin/sh
# Smoke-test the macOS app from desktop/build-mac.sh without touching the user's own Harness Studio data: copy the
# app out of the DMG and run it with HOME and CFFIXED_USER_HOME pointing at a throwaway home, so its settings,
# ~/.harness-studio and Documents all live there. Runs desktop/smoke-probe.mjs (welcome screen, workspace,
# built-in plugins and their pages, no DeepSeek account or feedback UI), checks the harness-studio:// link
# declaration, the first-use workspace in Documents/Harness Studio, that an existing
# Documents/deepseek-harness/default-workspace is kept instead, and converts a Word document to PDF. Through the
# main process (desktop/smoke-main.mjs) it checks the welcome window size set by the patches and that Check for Updates… opens
# the releases page instead of an update dialog, and that the run leaves the Harness home's AGENTS.md alone and
# writes no AGENTS.local.md. Saves screenshots and report.json in the output directory:
#
#   desktop/smoke-mac.sh dist/Harness-Studio-<version>-mac-arm64.dmg dist/smoke-mac
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
dmg=$1
out=$(mkdir -p "$2" && cd "$2" && pwd)
fail() { echo "smoke-mac: $*" >&2; exit 1; }
work=$(mktemp -d "${TMPDIR:-/tmp}/harness-studio-smoke.XXXXXX")

volume=$(hdiutil attach -nobrowse -readonly "$dmg" | tail -1 | cut -f3)
ditto "$volume/Harness Studio.app" "$work/Harness Studio.app"
hdiutil detach -quiet "$volume"
app="$work/Harness Studio.app/Contents/MacOS/Harness Studio"
scheme=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' "$work/Harness Studio.app/Contents/Info.plist")
[ "$scheme" = harness-studio ] || fail "the app declares the link scheme \"$scheme\", not harness-studio"

# Start the app on a throwaway home; prints its main process ID.
start() {
  HOME="$1" CFFIXED_USER_HOME="$1" "$app" --remote-debugging-port="$2" --inspect="$(($2 + 100))" > "$3" 2>&1 &
  echo $!
}
stop() {
  kill "$1" 2> /dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "$work/Harness Studio.app" > /dev/null || return 0; sleep 1; done
  pkill -9 -f "$work/Harness Studio.app" || true
}

status=0
home="$work/home"
mkdir -p "$home"
# The personal instructions file in the Harness home: its checksum, or "absent".
agents() { [ -f "$1/.harness-studio/AGENTS.md" ] && shasum -a 256 "$1/.harness-studio/AGENTS.md" | cut -c1-64 || echo absent; }
# A fresh home gets Compact's default reply style as its AGENTS.md at the first start, which may land during the run.
default_agents=$(shasum -a 256 "$root/plugins/compact/default-agents.md" | cut -c1-64)
pid=$(start "$home" 9336 "$out/app.log")
ELECTRON_RUN_AS_NODE=1 "$app" "$root/desktop/smoke-main.mjs" 9436 "$out" || status=1
agents_before=$(agents "$home")
ELECTRON_RUN_AS_NODE=1 "$app" "$root/desktop/smoke-probe.mjs" 9336 "$out" || status=1
stop "$pid"
# All ten bundled plugins: inside the app, and enabled in the first-run profile (Hooks and Terminal are host-only,
# so the probe's client list cannot show them).
plugins_expected='@harness-studio/compact @harness-studio/connectors @harness-studio/devpreview @harness-studio/editor @harness-studio/hooks @harness-studio/remember @harness-studio/sessions @harness-studio/terminal @harness-studio/undo @harness-studio/watch'
plugins_profile=$(grep -o '"@harness-studio/[a-z-]*"' "$home/.harness-studio/profiles/desktop/package.json" 2> /dev/null | tr -d '"' | sort | tr '\n' ' ' | sed 's/ $//')
plugins_packaged=$(ELECTRON_RUN_AS_NODE=1 "$app" -e "console.log(require('fs').readdirSync(process.argv[1]).sort().map(name => '@harness-studio/' + name).join(' '))" "$work/Harness Studio.app/Contents/Resources/app.asar/dsh/node_modules/@harness-studio" 2> /dev/null)
if [ "$plugins_profile" = "$plugins_expected" ] && [ "$plugins_packaged" = "$plugins_expected" ]; then
  echo "smoke-mac: ten plugins packaged and enabled: $plugins_expected"
else
  echo "smoke-mac: plugins packaged \"$plugins_packaged\", enabled \"$plugins_profile\"" >&2; status=1
fi
# Remember writes only notes the user approves, so a smoke run leaves the instruction files alone.
agents_after=$(agents "$home")
if { [ "$agents_after" = "$agents_before" ] || { [ "$agents_before" = absent ] && [ "$agents_after" = "$default_agents" ]; }; } && [ -z "$(find "$home/Documents" -name AGENTS.local.md)" ]; then
  echo "smoke-mac: AGENTS.md untouched or the shipped default ($agents_after) and no AGENTS.local.md written"
else
  echo "smoke-mac: an instruction file changed during the smoke run" >&2; status=1
fi
[ -d "$home/Documents/Harness Studio/default-workspace" ] && echo "smoke-mac: default workspace in Documents/Harness Studio" \
  || { echo "smoke-mac: no default workspace in Documents/Harness Studio" >&2; status=1; }

# An install that already has a first-use workspace in Documents/deepseek-harness keeps it.
upgrade="$work/upgrade"
mkdir -p "$upgrade/Documents/deepseek-harness/default-workspace"
echo 'keep me' > "$upgrade/Documents/deepseek-harness/default-workspace/notes.txt"
pid=$(start "$upgrade" 9337 "$out/app-upgrade.log")
for _ in $(seq 1 60); do [ -f "$upgrade/.harness-studio/storages/workspace.json" ] && break; sleep 1; done
sleep 5
stop "$pid"
if grep -q 'deepseek-harness' "$upgrade/.harness-studio/storages/workspace.json" 2> /dev/null && [ ! -e "$upgrade/Documents/Harness Studio" ] \
  && [ "$(cat "$upgrade/Documents/deepseek-harness/default-workspace/notes.txt")" = 'keep me' ]; then
  echo "smoke-mac: an existing Documents/deepseek-harness workspace is kept"
else
  echo "smoke-mac: an existing Documents/deepseek-harness workspace was not kept" >&2; status=1
fi

printf 'Harness Studio Office check\n' > "$work/input.txt"
textutil -convert docx "$work/input.txt" -output "$work/input.docx"
kit="$work/Harness Studio.app/Contents/Resources/app.asar.unpacked/dsh/node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js"
ELECTRON_RUN_AS_NODE=1 "$app" "$kit" convert --input "$work/input.docx" --output "$out/office.pdf" || status=1
[ "$(head -c 5 "$out/office.pdf" 2> /dev/null)" = "%PDF-" ] && echo "smoke-mac: Office to PDF passed" \
  || { echo "smoke-mac: Office to PDF failed" >&2; status=1; }

rm -rf "$work"
exit $status
