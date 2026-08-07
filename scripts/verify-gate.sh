#!/usr/bin/env bash
# The Verification Gate — run before every delivery. Exit nonzero on any failure.
# Syntax checks lie: `tsc` passes code whose function bundles don't resolve, and a
# green Vite build says nothing about serverless functions. The only honest test is
# the one the platform runs, so we bundle each function exactly as Netlify does.
set -u
FDIR="${1:-netlify/functions}"
fails=0

echo "== 1/5  function bundles (esbuild, exactly as the platform does) =="
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

echo "== 2/5  typecheck =="
npm run --silent typecheck || fails=1

echo "== 3/5  unit tests (engine math, stations schema, polish invariants) =="
npm run --silent test || fails=1

echo "== 4/5  frontend build + secret sweep =="
npm run --silent build || fails=1
if [ -d dist ]; then
  # The service-role key must never reach the client bundle.
  if grep -rl "service_role" dist/ 2>/dev/null | head -1 | grep -q .; then
    echo "SECRET LEAK: 'service_role' found in dist/"; fails=1
  else
    echo "  ok: no 'service_role' in dist/"
  fi
fi

echo "== 5/5  browser bar checks (skipped unless RUN_E2E=1 — they need ~3 min) =="
if [ "${RUN_E2E:-0}" = "1" ]; then
  node scripts/e2e/run-all.mjs || fails=1
else
  echo "  skipped. Run 'RUN_E2E=1 npm run gate' or 'npm run e2e' for the full bar:"
  echo "  frames (60fps) · a11y (axe+keyboard) · breakpoints (390/2560) ·"
  echo "  gate-breach · reduced-motion · pdf · lighthouse (perf ≥ 90)"
fi

if [ $fails -eq 0 ]; then echo ""; echo "GATE: ALL GREEN"; else echo ""; echo "GATE: FAILURES ABOVE"; exit 1; fi
