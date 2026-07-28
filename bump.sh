#!/bin/bash
# Cache-bust. Stamps a fresh version onto every ?v= URL in the import map (and
# onto window.__RESORT_BUILD) so browsers fetch the new modules instead of
# serving a stale mix of old and new. Run before every push.
#
#   ./bump.sh
#
# The stamp is also what `curl | grep -oE 'v=[0-9]+'` reads back off the live
# site to prove a Pages deploy actually landed (Pages flake law).
set -e
cd "$(dirname "$0")"
V=$(date +%Y%m%d%H%M%S)
sed -i '' -E "s/\?v=[0-9]+/?v=$V/g" index.html
sed -i '' -E "s/__RESORT_BUILD='[0-9]+'/__RESORT_BUILD='$V'/" index.html
echo "Cache version stamped: $V"
grep -oE "(three\.module\.min\.js|game\.js|sim\.js)\?v=[0-9]+" index.html
