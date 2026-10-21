#!/usr/bin/env sh
# Builds the Chrome Web Store package: extension files only, no tests, docs or git metadata.
set -eu
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
out="store/meet-capture-for-claude-$version.zip"
rm -f "$out"
zip -q -r "$out" manifest.json background.js src sidepanel offscreen icons LICENSE -x '*.DS_Store'
echo "built $out"
unzip -l "$out"
