#!/usr/bin/env bash
# Re-signs the macOS build with the fork's self-signed identity. Squirrel.Mac installs an
# update only when it satisfies the running app's designated requirement, which an
# unsigned (ad-hoc) build never does. No hardened runtime: there is no notarization.
set -euo pipefail

release_dir=$(cd "$1" && pwd)
: "${MACOS_SIGNING_P12:?}" "${MACOS_SIGNING_PASSWORD:?}"

work=$(mktemp -d)
keychain="$work/fork-signing.keychain-db"
keychain_password=$(uuidgen)
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
printf '%s' "$MACOS_SIGNING_P12" | base64 --decode > "$work/signing.p12"
security import "$work/signing.p12" -k "$keychain" -P "$MACOS_SIGNING_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
# shellcheck disable=SC2046
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')
identity=$(security find-identity -p codesigning "$keychain" | awk '$1 ~ /^[0-9]+\)$/ { print $2; exit }')
test -n "$identity" || { echo "No signing identity in MACOS_SIGNING_P12." >&2; exit 1; }

zip=$(ls "$release_dir"/*.zip)
dmg=$(ls "$release_dir"/*.dmg)
ditto -x -k "$zip" "$work/app"
app=$(ls -d "$work"/app/*.app)

node scripts/fork/sign-macos-app.ts "$app" "$identity" "$keychain"
codesign --verify --deep --strict --verbose=2 "$app"
codesign -d -r- "$app" 2>&1 | tee "$work/requirement.txt"
grep -q "certificate leaf" "$work/requirement.txt"

rm -f "$zip" "$zip.blockmap" "$dmg" "$dmg.blockmap"
ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"
mkdir "$work/dmg"
ditto "$app" "$work/dmg/$(basename "$app")"
ln -s /Applications "$work/dmg/Applications"
hdiutil create -volname "$(basename "$app" .app)" -srcfolder "$work/dmg" -ov -format UDZO "$dmg"

node scripts/fork/refresh-update-manifest.ts "$release_dir"
security delete-keychain "$keychain"
