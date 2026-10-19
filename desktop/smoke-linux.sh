#!/bin/sh
# Smoke-test the installed Linux app (the .deb from desktop/build-linux.sh, already installed): start it on a
# virtual display with a fresh home, then run desktop/smoke-probe.mjs, which checks the welcome screen, the
# workspace, the built-in plugins and their pages, and that no DeepSeek account or feedback UI is present, and
# saves screenshots and report.json in the output directory. desktop/smoke-main.mjs also checks, through the main
# process, the welcome window size set by the patches and that Check for Updates… opens the releases page; the run
# must leave the Harness home's AGENTS.md alone and write no AGENTS.local.md:
#
#   desktop/smoke-linux.sh dist/smoke
#
# Needs xvfb, dbus-x11 and x11-utils. .github/workflows/build-linux.yml runs it after each build.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
out=$(mkdir -p "$1" && cd "$1" && pwd)
app="/opt/Harness Studio/harness-studio"
[ -x "$app" ] || { echo "smoke-linux: Harness Studio is not installed at $app" >&2; exit 1; }
home=$(mktemp -d)
HOME="$home" dbus-launch xvfb-run -n 99 -f "$home/.Xauthority" -s '-screen 0 1440x900x24' "$app" --remote-debugging-port=9222 --inspect=9322 > "$out/app.log" 2>&1 &
status=0
# The personal instructions file in the Harness home: its checksum, or "absent".
agents() { [ -f "$home/.harness-studio/AGENTS.md" ] && sha256sum "$home/.harness-studio/AGENTS.md" | cut -c1-64 || echo absent; }
# A fresh home gets Compact's default reply style as its AGENTS.md at the first start, which may land during the run.
default_agents=$(sha256sum "$root/plugins/compact/default-agents.md" | cut -c1-64)
ELECTRON_RUN_AS_NODE=1 "$app" "$root/desktop/smoke-main.mjs" 9322 "$out" || status=1
agents_before=$(agents)
ELECTRON_RUN_AS_NODE=1 "$app" "$root/desktop/smoke-probe.mjs" 9222 "$out" || status=1
# The desktop links a window to its launcher entry (and icon) by the window's class.
expected=$(sed -n 's/^StartupWMClass=//p' /usr/share/applications/harness-studio.desktop)
window=$(DISPLAY=:99 XAUTHORITY="$home/.Xauthority" xwininfo -root -tree | awk '/"Harness Studio"/ { print $1; exit }')
class=$(DISPLAY=:99 XAUTHORITY="$home/.Xauthority" xprop -id "$window" WM_CLASS 2>/dev/null | sed -n 's/.*= "\([^"]*\)".*/\1/p')
echo "smoke-linux: window class \"$class\", launcher StartupWMClass \"$expected\""
[ -n "$class" ] && [ "$class" = "$expected" ] || { echo "smoke-linux: the window class does not match the launcher entry" >&2; status=1; }
pkill -f "$app" || true
ls -d "$home/.harness-studio" "$home/.config/Harness Studio" >> "$out/app.log" 2>&1 || true
# All ten bundled plugins: inside the app, and enabled in the first-run profile (Hooks and Terminal are host-only,
# so the probe's client list cannot show them).
plugins_expected='@harness-studio/compact @harness-studio/connectors @harness-studio/devpreview @harness-studio/editor @harness-studio/hooks @harness-studio/remember @harness-studio/sessions @harness-studio/terminal @harness-studio/undo @harness-studio/watch'
plugins_profile=$(grep -o '"@harness-studio/[a-z-]*"' "$home/.harness-studio/profiles/desktop/package.json" 2> /dev/null | tr -d '"' | sort | tr '\n' ' ' | sed 's/ $//')
plugins_packaged=$(ELECTRON_RUN_AS_NODE=1 "$app" -e "console.log(require('fs').readdirSync(process.argv[1]).sort().map(name => '@harness-studio/' + name).join(' '))" "/opt/Harness Studio/resources/app.asar/dsh/node_modules/@harness-studio" 2> /dev/null)
if [ "$plugins_profile" = "$plugins_expected" ] && [ "$plugins_packaged" = "$plugins_expected" ]; then
  echo "smoke-linux: ten plugins packaged and enabled: $plugins_expected"
else
  echo "smoke-linux: plugins packaged \"$plugins_packaged\", enabled \"$plugins_profile\"" >&2; status=1
fi
# Remember writes only notes the user approves, so a smoke run leaves the instruction files alone.
agents_after=$(agents)
if { [ "$agents_after" = "$agents_before" ] || { [ "$agents_before" = absent ] && [ "$agents_after" = "$default_agents" ]; }; } && [ -z "$(find "$home/Documents" -name AGENTS.local.md 2> /dev/null)" ]; then
  echo "smoke-linux: AGENTS.md untouched or the shipped default ($agents_after) and no AGENTS.local.md written"
else
  echo "smoke-linux: an instruction file changed during the smoke run" >&2; status=1
fi
# A fresh install keeps its first-use workspace in ~/Documents/Harness Studio.
[ -d "$home/Documents/Harness Studio/default-workspace" ] && echo "smoke-linux: default workspace in ~/Documents/Harness Studio" \
  || { echo "smoke-linux: no default workspace in ~/Documents/Harness Studio" >&2; status=1; }
exit $status
