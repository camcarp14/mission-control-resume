// Runs every browser-level bar check in sequence and prints one honest table.
// Sequential on purpose: the frame-timing check must not share CPU with six
// other chromiums, or its numbers measure contention instead of the app.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = readdirSync(here)
  .filter((f) => f.endsWith('.mjs') && !f.startsWith('_') && f !== 'run-all.mjs')
  .sort();

if (scripts.length === 0) {
  console.error('run-all: no check scripts found — that is a FAILURE, not a pass.');
  process.exit(1);
}

const results = [];
for (const s of scripts) {
  console.log(`\n———— ${s} ————`);
  // 10 min per check, not 5: pdf.mjs walks 2 widths × an 11-station rail
  // loop with cinematic 1.7–4.8s legs plus a boot-overlay wait — it crossed
  // 5:00 as the scene grew and spawnSync's kill read as a red check with no
  // failure line (it passed standalone every time). A timeout is a harness
  // guard, not a bar; the bars live inside the scripts.
  const r = spawnSync('node', [join(here, s)], { stdio: 'inherit', timeout: 10 * 60 * 1000 });
  if (r.signal) console.error(`run-all: ${s} KILLED by ${r.signal} (timeout?) — red.`);
  results.push({ script: s, ok: r.status === 0 });
}

console.log('\n============ BAR CHECK SUMMARY ============');
for (const r of results) console.log(`${r.ok ? '  ok ' : 'FAIL '} ${r.script}`);
const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.error(`\n${bad.length} check(s) red.`);
  process.exit(1);
}
console.log('\nALL BAR CHECKS GREEN');
