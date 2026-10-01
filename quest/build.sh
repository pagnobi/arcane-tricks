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

[ -f "$BUBBLEWRAP" ] || [ -f "$BUBBLEWRAP.cmd" ] || { echo "Bubblewrap not installed — see quest/README.md"; exit 1; }
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

# Build and sign directly rather than with `bubblewrap build`: on Windows with Node 22+ it can't
# launch gradlew.bat ("spawn EINVAL"). These are the same steps it runs.
SDK="$HOME/.bubblewrap/android_sdk"
JAVA_HOME="$HOME/.bubblewrap/jdk/jdk-17.0.11+9"
ANDROID_HOME="$SDK"
if command -v cygpath >/dev/null; then
  JAVA_HOME="$(cygpath -w "$JAVA_HOME")"
  ANDROID_HOME="$(cygpath -w "$ANDROID_HOME")"
fi
export JAVA_HOME ANDROID_HOME
if [ "${OS:-}" = "Windows_NT" ]; then GRADLE=./gradlew.bat; APKSIGNER=apksigner.bat; else GRADLE=./gradlew; APKSIGNER=apksigner; fi
"$GRADLE" assembleRelease --console=plain

BUILD_TOOLS="$SDK/build-tools/34.0.0"
UNSIGNED=app/build/outputs/apk/release/app-release-unsigned.apk
"$BUILD_TOOLS/zipalign" -c 4 "$UNSIGNED"
"$BUILD_TOOLS/$APKSIGNER" sign \
  --ks "$SIGNING/quest-release.keystore" --ks-key-alias arcanetricks \
  --ks-pass env:BUBBLEWRAP_KEYSTORE_PASSWORD --key-pass env:BUBBLEWRAP_KEY_PASSWORD \
  --out "$HERE/out/arcane-tricks.apk" "$UNSIGNED"
"$BUILD_TOOLS/$APKSIGNER" verify --print-certs "$HERE/out/arcane-tricks.apk" | grep -i "SHA-256"
echo
echo "Built quest/out/arcane-tricks.apk"
