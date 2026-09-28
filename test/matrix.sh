#!/bin/sh
# Run the compatibility matrix: pure unit tests, then the real-backend checks
# against every DSH generation this plugin claims to support.
#
# First run downloads the old DSH packages from npm into /tmp/compat/<era>.
# Usage: sh test/matrix.sh
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CURRENT_DSH="${CURRENT_DSH:-/usr/local/lib/node_modules/@deepseek-ai/dsh}"
MATRIX_DIR="${MATRIX_DIR:-/tmp/compat}"

echo "== unit tests =="
node --test "$REPO/test/events.test.mjs"

# era:format-version:package-version
ERAS="v0:0:0.1.1-rc.2 v2:2:0.1.3-alpha.2 v3:3:0.1.6-alpha.2"

for entry in $ERAS; do
  era=$(echo "$entry" | cut -d: -f1)
  format=$(echo "$entry" | cut -d: -f2)
  version=$(echo "$entry" | cut -d: -f3)
  dir="$MATRIX_DIR/$era"
  if [ ! -d "$dir/node_modules/@deepseek-ai/dsh-session" ]; then
    echo "== installing $era ($version) into $dir =="
    mkdir -p "$dir"
    cd "$dir"
    [ -f package.json ] || npm init -y >/dev/null
    npm i --no-audit --no-fund --legacy-peer-deps \
      "@deepseek-ai/dsh-base@$version" \
      "@deepseek-ai/dsh-session-persistence@$version" \
      "@deepseek-ai/dsh-session-persistence-jsonl@$version" \
      "@deepseek-ai/dsh-scope@$version" \
      "@deepseek-ai/dsh-invariants@$version" \
      "@deepseek-ai/cordis@4.0.1" >/dev/null
  fi
  echo "== $era (format v$format, DSH $version) =="
  ( cd "$dir" && node "$REPO/test/compat.mjs" --expect "$format" && node "$REPO/test/live-import.mjs" )
done

if [ -d "$CURRENT_DSH" ]; then
  echo "== current install ($CURRENT_DSH) =="
  ( cd "$CURRENT_DSH" && node "$REPO/test/compat.mjs" && node "$REPO/test/live-import.mjs" )
else
  echo "current DSH install not found at $CURRENT_DSH (set CURRENT_DSH=...)" >&2
fi

echo "matrix complete"
