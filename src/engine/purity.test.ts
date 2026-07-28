import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The engine must stay pure: no React, no Supabase, no network, no clock.
 *
 * This is enforced as a TEST rather than a convention because the failure is
 * silent and expensive — the moment decay.ts imports the supabase client, the
 * math can no longer be unit-tested in isolation, and "the numbers are wrong"
 * becomes indistinguishable from "the query is wrong".
 */
const ENGINE_DIR = join(process.cwd(), 'src/engine');

const FORBIDDEN = [
  { pattern: /from ['"]react/, why: 'React import — engine must have zero UI dependencies' },
  { pattern: /from ['"]@supabase/, why: 'Supabase import — engine must not know how data is stored' },
  { pattern: /from ['"]\.\.\//, why: 'import escaping src/engine — engine must be self-contained' },
  { pattern: /\bfetch\s*\(/, why: 'network call — engine must be pure' },
  { pattern: /\bDate\.now\s*\(/, why: 'reads the clock — pass `now` in so tests are deterministic' },
  { pattern: /new Date\s*\(\s*\)/, why: 'reads the clock — pass `now` in so tests are deterministic' },
  { pattern: /Math\.random\s*\(/, why: 'nondeterminism — engine output must be reproducible' },
];

function engineFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...engineFiles(p));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('engine purity', () => {
  const files = engineFiles(ENGINE_DIR);

  it('has engine source files to check (guards against a vacuous pass)', () => {
    // Without this, the suite below goes green on an empty directory and
    // launders "nothing implemented" as "architecture verified".
    expect(files.length, 'no engine files found — is Phase 2 built?').toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file.replace(process.cwd() + '/', '')} imports nothing impure`, () => {
      const src = readFileSync(file, 'utf8');
      for (const { pattern, why } of FORBIDDEN) {
        expect(pattern.test(src), `${file}: ${why}`).toBe(false);
      }
    });
  }
});
