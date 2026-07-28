// Smoke test — synthetic fixtures with PLANTED defects; assert every rule fires.
// Runs inside the verify gate. Catches regressions that builds cannot: a build
// is perfectly happy with a decay curve that returns NaN.
//
// This file deliberately reports "PENDING" rather than passing vacuously when a
// module doesn't exist yet. A harness that goes green because it found nothing
// to check is worse than no harness — it launders an untested build as verified.
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const failures = [];
const pending = [];
const must = (cond, label) =>
  cond ? console.log('  ok:', label) : (failures.push(label), console.error('  FAIL:', label));

// The engine is TypeScript; import it through vitest in `npm test`. Here we check
// the compiled-behaviour invariants that are cheap to assert from plain node.
const enginePath = resolve('src/engine/index.ts');

if (!existsSync(enginePath)) {
  pending.push('engine not yet implemented (Phase 2) — decay/moat/scaling/projection fixtures pending');
} else {
  // Loaded via the vitest suite; see src/engine/__tests__. The planted-defect
  // fixtures below run against the same pure functions.
  const engine = await import(pathToFileURL(enginePath).href).catch((e) => {
    failures.push(`engine import threw: ${e.message}`);
    return null;
  });

  if (engine) {
    console.log('\n[decay] planted: a rack untouched for 10 half-lives');
    const rotted = engine.effectiveLevel({
      peakLevel: 80,
      retentionFloor: 0.5,
      halfLifeDays: 30,
      obsolescenceHalfLifeDays: 90,
      idleDays: 300,
      daysSinceRefresh: 300,
    });
    must(Number.isFinite(rotted), 'decay returns a finite number after 10 half-lives');
    must(rotted >= 0 && rotted <= 100, 'decay stays inside 0..100');
    must(rotted > 0, 'decay does NOT collapse to zero (retention floor holds)');

    console.log('\n[moat] planted: two perfectly-correlated capabilities');
    const twins = engine.moatIndex({
      capabilities: [
        { id: 'a', level: 80 },
        { id: 'b', level: 80 },
      ],
      affinity: { 'a|b': 1.0 }, // affinity 1.0 = always co-occur = zero surprise
      demand: { 'a|b': 1.0 },
    });
    must(twins === 0, 'perfectly-correlated pair contributes ZERO moat (surprisal of certainty is 0)');

    console.log('\n[moat] planted: a rare pair held at level 0');
    const unheld = engine.moatIndex({
      capabilities: [
        { id: 'a', level: 90 },
        { id: 'b', level: 0 },
      ],
      affinity: { 'a|b': 0.01 },
      demand: { 'a|b': 1.0 },
    });
    must(unheld === 0, 'a combination you do not actually hold contributes ZERO moat');
  }
}

console.log('');
if (pending.length) pending.forEach((p) => console.log('PENDING:', p));
if (failures.length) {
  console.error('\nSMOKE: FAILURES ABOVE');
  process.exit(1);
}
console.log(pending.length ? 'SMOKE: GREEN (with pending sections above)' : 'SMOKE: ALL GREEN');
