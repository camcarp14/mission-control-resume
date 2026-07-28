#!/usr/bin/env bash
# The Verification Gate — run before every delivery. Exit nonzero on any failure.
# Syntax checks lie: `tsc` passes code whose function bundles don't resolve, and a
# green Vite build says nothing about serverless functions. The only honest test is
# the one the platform runs, so we bundle each function exactly as Netlify does.
set -u
FDIR="${1:-netlify/functions}"
fails=0

echo "== 1/4  function bundles (esbuild, exactly as the platform does) =="
if [ -d "$FDIR" ]; then
  for f in "$FDIR"/*.ts "$FDIR"/*.mts "$FDIR"/*.js "$FDIR"/*.mjs; do
    [ -e "$f" ] || continue
    out=$(npx esbuild "$f" --bundle --platform=node --format=esm \
            --external:@netlify/functions --outfile=/dev/null 2>&1)
    # -i is load-bearing: esbuild prints "ERROR" uppercase. A case-sensitive grep
    # once reported "ALL BUNDLES CLEAN" over two failing bundles.
    if echo "$out" | grep -qi "error"; then
      echo "BUNDLE FAIL: $f"; echo "$out" | head -6; fails=1
    else
      echo "  ok: $f"
    fi
  done
else
  echo "  (no $FDIR yet)"
fi

echo "== 2/4  engine smoke (planted defects must all fire) =="
if grep -q '"smoke"' package.json 2>/dev/null; then npm run --silent smoke || fails=1; fi

echo "== 3/4  unit tests =="
npm run --silent test || fails=1

echo "== 4/4  frontend build + secret sweep =="
npm run --silent build || fails=1
if [ -d dist ]; then
  # The API key must never reach the client bundle.
  if grep -rl "sk-ant" dist/ 2>/dev/null | head -1 | grep -q .; then
    echo "SECRET LEAK: 'sk-ant' found in dist/"; fails=1
  else
    echo "  ok: no 'sk-ant' in dist/"
  fi
  # The service-role key must never reach the client bundle either.
  if grep -rl "service_role" dist/ 2>/dev/null | head -1 | grep -q .; then
    echo "SECRET LEAK: 'service_role' found in dist/"; fails=1
  else
    echo "  ok: no 'service_role' in dist/"
  fi
fi

if [ $fails -eq 0 ]; then echo ""; echo "GATE: ALL GREEN"; else echo ""; echo "GATE: FAILURES ABOVE"; exit 1; fi
