#!/bin/sh
# Copy Harness Studio's logo into a Harness checkout's desktop app icons:
#   scripts/copy-logo.sh path/to/harness
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
resources="$1/apps/desktop/resources"
cp "$root/assets/logo/logo.svg" "$resources/icon-macos.svg"
cp "$root/assets/logo/desktop/icon-macos.png" "$resources/icon-macos.png"
cp "$root/assets/logo/logo-windows.svg" "$resources/icon-windows.svg"
cp "$root/assets/logo/desktop/icon-windows.png" "$resources/icon-windows.png"
mkdir -p "$resources/linux-icons"
cp "$root"/assets/logo/linux/*.png "$resources/linux-icons/"
