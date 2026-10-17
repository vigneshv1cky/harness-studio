#!/bin/sh
# Smoke-test the Windows installer from desktop/build-windows.sh in Git Bash: install it silently for the
# current user, check the harness-studio:// link registration, start the app and run desktop/smoke-probe.mjs
# (welcome screen, workspace, built-in plugins and their pages, no DeepSeek account or feedback UI), then
# convert a Word document to PDF with the packaged Office kit. Saves screenshots, report.json and the PDF in
# the output directory:
#
#   desktop/smoke-windows.sh dist/Harness-Studio-<version>-win-x64-setup.exe dist/smoke [document.docx]
#
# The Word document defaults to the Office fixture in the Harness build tree. .github/workflows/build-windows.yml
# runs this after each build, and .github/workflows/smoke-windows.yml reruns it on an existing installer, both
# on a runner with a desktop session.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
installer=$1
out=$(mkdir -p "$2" && cd "$2" && pwd)
docx=${3:-$root/dist/build/harness/scripts/fixtures/office-render/color-blocks.docx}
fail() { echo "smoke-windows: $*" >&2; exit 1; }

echo "smoke-windows: installing $installer"
timeout 600 powershell -NoProfile -Command \
  "\$p = Start-Process -FilePath '$(cygpath -w "$installer")' -ArgumentList '/S' -Wait -PassThru; exit \$p.ExitCode" \
  || fail "the silent install failed or took longer than 10 minutes"
app=$(cygpath -u "$LOCALAPPDATA")"/Programs/Harness Studio/Harness Studio.exe"
[ -f "$app" ] || app=$(find "$(cygpath -u "$LOCALAPPDATA")/Programs" -maxdepth 2 -iname "harness*studio*.exe" ! -iname "uninstall*" | head -1)
[ -n "$app" ] && [ -f "$app" ] || fail "Harness Studio was not installed under %LOCALAPPDATA%\\Programs"
echo "smoke-windows: installed $app"

"$app" --remote-debugging-port=9222 > "$out/app.log" 2>&1 &
status=0
timeout 300 node "$root/desktop/smoke-probe.mjs" 9222 "$out" || status=$?
# The installer or the first start registers the link handler for the current user.
reg query 'HKCU\Software\Classes\harness-studio\shell\open\command' > "$out/url-handler.txt" 2>&1 \
  && cat "$out/url-handler.txt" || { echo "smoke-windows: the harness-studio:// link handler is not registered" >&2; status=1; }
# A second launch with a link must hand it to the running app and exit instead of opening another copy.
"$app" "harness-studio://open" >> "$out/app.log" 2>&1 &
sleep 10
tasklist //FI "IMAGENAME eq $(basename "$app")" >> "$out/app.log" 2>&1 || true
# A fresh install keeps its first-use workspace in Documents\Harness Studio.
documents=$(cygpath -u "$(powershell -NoProfile -Command "[Environment]::GetFolderPath('MyDocuments')" | tr -d '\r')")
[ -d "$documents/Harness Studio/default-workspace" ] && echo "smoke-windows: default workspace in Documents\\Harness Studio" \
  || { echo "smoke-windows: no default workspace in $documents/Harness Studio" >&2; status=1; }
taskkill //F //T //IM "$(basename "$app")" > /dev/null 2>&1 || true

kit="$(dirname "$app")/resources/app.asar.unpacked/dsh/node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js"
ELECTRON_RUN_AS_NODE=1 timeout 300 "$app" "$(cygpath -w "$kit")" convert --input "$(cygpath -w "$docx")" \
  --output "$(cygpath -w "$out/office.pdf")" || status=1
[ "$(head -c 5 "$out/office.pdf" 2>/dev/null)" = "%PDF-" ] && echo "smoke-windows: Office to PDF passed" \
  || { echo "smoke-windows: Office to PDF failed" >&2; status=1; }
exit $status
