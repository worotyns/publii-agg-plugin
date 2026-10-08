#!/bin/sh
# Builds dist/aggAnalytics.zip, installable in Publii via Tools & Plugins → Install plugin.
# Publii expects exactly one folder in the zip; its name becomes the plugin directory.
set -eu

cd "$(dirname "$0")"
node --test

out="$(pwd)/dist"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/aggAnalytics" "$out"
cp plugin.json main.js thumbnail.svg README.md CHANGELOG.md "$tmp/aggAnalytics/"
cp LICENSE "$tmp/aggAnalytics/LICENSE"
rm -f "$out/aggAnalytics.zip"
(cd "$tmp" && zip -qr "$out/aggAnalytics.zip" aggAnalytics)
echo "built $out/aggAnalytics.zip"
