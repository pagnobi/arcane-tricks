#!/usr/bin/env bash
# Builds the Meta Quest app (APK) that wraps the live site, https://pagnobi.github.io/arcane-tricks/.
#
#   bash quest/build.sh          → quest/out/arcane-tricks.apk
#
# The APK only holds a launcher: the game itself always loads from the website, so pushing to
# GitHub updates the game for Quest players too. Rebuild (with a higher appVersionCode in
# twa-manifest.json) only when the icon, name or package settings change.
#
# Needs (one-time setup, see quest/README.md):
#   ~/.arcane-tricks-tools          Meta's bubblewrap CLI (npm i @meta-quest/bubblewrap-cli)
#   ~/.bubblewrap/config.json       paths to JDK 17 and the Android SDK
#   ~/.arcane-tricks-signing/       the signing key and its password. Never commit these.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SIGNING="$HOME/.arcane-tricks-signing"
BUBBLEWRAP="$HOME/.arcane-tricks-tools/node_modules/.bin/bubblewrap"

[ -x "$BUBBLEWRAP" ] || [ -f "$BUBBLEWRAP.cmd" ] || { echo "Bubblewrap not installed — see quest/README.md"; exit 1; }
[ -f "$SIGNING/quest-release.keystore" ] || { echo "Signing key missing at $SIGNING — see quest/README.md"; exit 1; }

# The keystore password lives next to the key, outside the repo.
PASSWORD="$(sed -n 's/^Keystore password and key password (same): //p' "$SIGNING/README-PASSWORD.txt")"
export BUBBLEWRAP_KEYSTORE_PASSWORD="$PASSWORD"
export BUBBLEWRAP_KEY_PASSWORD="$PASSWORD"

# Generate a fresh Android project from twa-manifest.json in a scratch folder (git-ignored).
mkdir -p "$HERE/android" "$HERE/out"
cp "$HERE/twa-manifest.json" "$HERE/android/twa-manifest.json"
cd "$HERE/android"
"$BUBBLEWRAP" update --skipVersionUpgrade --manifest="$HERE/android/twa-manifest.json"
"$BUBBLEWRAP" build --skipPwaValidation \
  --manifest="$HERE/android/twa-manifest.json" \
  --signingKeyPath="$SIGNING/quest-release.keystore" \
  --signingKeyAlias=arcanetricks

cp app-release-signed.apk "$HERE/out/arcane-tricks.apk"
echo
echo "Built quest/out/arcane-tricks.apk"
