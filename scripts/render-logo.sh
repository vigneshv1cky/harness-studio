#!/bin/sh
# Render Harness Studio's logo (assets/logo/*.svg) into the Chrome extension's icons and the
# desktop app's icons (assets/logo/desktop). Run after changing the logo; the PNGs are committed,
# so building the app does not need this script. Needs rsvg-convert (brew install librsvg).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
logo="$root/assets/logo/logo.svg"
square="$root/assets/logo/logo-square.svg"
windows="$root/assets/logo/logo-windows.svg"
icons="$root/chrome-bridge/extension/icons"
desktop="$root/assets/logo/desktop"

# Toolbar sizes fill the square so the mark stays legible; larger sizes keep the
# margin that Chrome's extension page and macOS expect around an icon.
rsvg-convert -w 16 -h 16 "$square" -o "$icons/icon-16.png"
rsvg-convert -w 32 -h 32 "$square" -o "$icons/icon-32.png"
rsvg-convert -w 48 -h 48 "$logo" -o "$icons/icon-48.png"
rsvg-convert -w 128 -h 128 "$logo" -o "$icons/icon-128.png"

mkdir -p "$desktop"
rsvg-convert -w 1024 -h 1024 "$logo" -o "$desktop/icon-macos.png"
rsvg-convert -w 1024 -h 1024 "$windows" -o "$desktop/icon-windows.png"

# Linux .desktop icon set, one PNG per size.
mkdir -p "$root/assets/logo/linux"
for size in 16 32 48 64 128 256 512; do
  rsvg-convert -w "$size" -h "$size" "$logo" -o "$root/assets/logo/linux/${size}x${size}.png"
done
