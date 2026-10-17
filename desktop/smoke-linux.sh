#!/bin/sh
# Smoke-test the installed Linux app (the .deb from desktop/build-linux.sh, already installed): start it on a
# virtual display with a fresh home, then run desktop/smoke-probe.mjs, which checks the welcome screen, the
# workspace, the built-in plugins and their pages, and that no DeepSeek account or feedback UI is present, and
# saves screenshots and report.json in the output directory. desktop/smoke-main.mjs also checks, through the main
# process, the welcome window size set by the patches and that Check for Updates… opens the releases page:
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
ELECTRON_RUN_AS_NODE=1 "$app" "$root/desktop/smoke-main.mjs" 9322 "$out" || status=1
ELECTRON_RUN_AS_NODE=1 "$app" "$root/desktop/smoke-probe.mjs" 9222 "$out" || status=1
# The desktop links a window to its launcher entry (and icon) by the window's class.
expected=$(sed -n 's/^StartupWMClass=//p' /usr/share/applications/harness-studio.desktop)
window=$(DISPLAY=:99 XAUTHORITY="$home/.Xauthority" xwininfo -root -tree | awk '/"Harness Studio"/ { print $1; exit }')
class=$(DISPLAY=:99 XAUTHORITY="$home/.Xauthority" xprop -id "$window" WM_CLASS 2>/dev/null | sed -n 's/.*= "\([^"]*\)".*/\1/p')
echo "smoke-linux: window class \"$class\", launcher StartupWMClass \"$expected\""
[ -n "$class" ] && [ "$class" = "$expected" ] || { echo "smoke-linux: the window class does not match the launcher entry" >&2; status=1; }
pkill -f "$app" || true
ls -d "$home/.harness-studio" "$home/.config/Harness Studio" >> "$out/app.log" 2>&1 || true
# A fresh install keeps its first-use workspace in ~/Documents/Harness Studio.
[ -d "$home/Documents/Harness Studio/default-workspace" ] && echo "smoke-linux: default workspace in ~/Documents/Harness Studio" \
  || { echo "smoke-linux: no default workspace in ~/Documents/Harness Studio" >&2; status=1; }
exit $status
