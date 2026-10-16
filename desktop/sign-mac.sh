#!/bin/sh
# Sign, package, notarise and staple the Harness Studio macOS app with your Developer ID:
#
#   desktop/sign-mac.sh "path/to/Harness Studio.app" path/to/output.dmg
#
# Reads desktop/.env.signing (git-ignored; copy desktop/signing.example.env). Called by desktop/build-mac.sh
# when that file exists. With HARNESS_STUDIO_SIGNING_IDENTITY=- it signs ad hoc and skips notarisation,
# which checks the signing steps without credentials; such a build is not for distribution.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
app="$1"
dmg="$2"
harness="$root/dist/build/harness"
fail() { echo "sign-mac: $*" >&2; exit 1; }
[ -d "$app" ] || fail "no app at $app"
[ -f "$root/desktop/.env.signing" ] || fail "missing desktop/.env.signing (copy desktop/signing.example.env)"
set -a
. "$root/desktop/.env.signing"
set +a
identity="${HARNESS_STUDIO_SIGNING_IDENTITY:?set HARNESS_STUDIO_SIGNING_IDENTITY in desktop/.env.signing}"
adhoc=0
[ "$identity" = "-" ] && adhoc=1
if [ "$adhoc" = 0 ]; then
  : "${APPLE_API_KEY:?set APPLE_API_KEY (path to the .p8 file) in desktop/.env.signing}"
  : "${APPLE_API_KEY_ID:?set APPLE_API_KEY_ID in desktop/.env.signing}"
  : "${APPLE_API_ISSUER:?set APPLE_API_ISSUER in desktop/.env.signing}"
  [ -f "$APPLE_API_KEY" ] || fail "APPLE_API_KEY does not name a readable .p8 file"
fi

# Sign every nested binary, framework and helper inside out, with the hardened runtime and Harness's
# entitlements, using the signer electron-builder itself uses.
echo "sign-mac: signing $(basename "$app")"
HARNESS_STUDIO_APP="$app" HARNESS_STUDIO_IDENTITY="$identity" HARNESS_STUDIO_ADHOC="$adhoc" \
HARNESS_STUDIO_ENTITLEMENTS="$harness/apps/desktop/scripts/macos-entitlements.plist" \
node --input-type=module -e "
import { createRequire } from 'node:module'
const desktop = createRequire('$harness/apps/desktop/package.json')
const builder = createRequire(desktop.resolve('app-builder-lib/package.json'))
const { signAsync } = builder('@electron/osx-sign')
const env = process.env
await signAsync({
  app: env.HARNESS_STUDIO_APP,
  identity: env.HARNESS_STUDIO_IDENTITY,
  identityValidation: env.HARNESS_STUDIO_ADHOC !== '1',
  platform: 'darwin',
  preAutoEntitlements: false,
  optionsForFile: () => ({
    hardenedRuntime: true,
    entitlements: env.HARNESS_STUDIO_ENTITLEMENTS,
    timestamp: env.HARNESS_STUDIO_ADHOC === '1' ? 'none' : undefined,
  }),
})
"
codesign --verify --deep --strict "$app"

echo "sign-mac: creating $(basename "$dmg")"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
ditto "$app" "$stage/Harness Studio.app"
ln -s /Applications "$stage/Applications"
hdiutil create -quiet -volname "Harness Studio" -srcfolder "$stage" -ov -format ULMO "$dmg"

if [ "$adhoc" = 1 ]; then
  echo "sign-mac: ad hoc signature; skipping notarisation (not for distribution)"
  exit 0
fi
codesign --sign "$identity" --timestamp "$dmg"
echo "sign-mac: notarising (this can take several minutes)"
xcrun notarytool submit "$dmg" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
xcrun stapler staple "$dmg"
spctl --assess --type open --context context:primary-signature --verbose "$dmg"
