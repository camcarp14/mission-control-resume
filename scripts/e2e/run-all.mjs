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
  const r = spawnSync('node', [join(here, s)], { stdio: 'inherit', timeout: 5 * 60 * 1000 });
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
