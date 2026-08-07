// BAR 1 — Lighthouse: performance score >= 90; first paint < 1.5s on 4G.
//
// Runs the real Lighthouse CLI against the production build (dist-e2e) served
// by vite preview, with Lighthouse's DEFAULT settings: mobile emulation,
// simulated slow-4G network throttling, 4x CPU slowdown. Those defaults ARE
// the "on 4G" bar — the throttling is deliberately not weakened.
//
// Assertions (the gate):
//   categories.performance.score            >= 0.90
//   audits['first-contentful-paint']        <  1500 ms
//   audits['largest-contentful-paint']      <  1500 ms
// first-meaningful-paint is DEPRECATED and removed from modern Lighthouse, so
// "first paint" is asserted via FCP and LCP — those are the assertions.
//
// Also reported (not gated): TBT, CLS, speed-index, accessibility score,
// best-practices score.
//
// Run: node scripts/e2e/lighthouse.mjs

import { spawnSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { serve, makeReporter } from './_lib.mjs';

const PORT = 4317;
const CHROME_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SCRATCH = '/tmp/claude-0/-home-user-hyperscaler/8bf20831-d166-555c-a464-fdd5a13ea72e/scratchpad';
const LH_JSON = join(SCRATCH, 'lh.json');
const EXEC_TIMEOUT_MS = 180000; // lighthouse can take 60–90s; 3-minute ceiling

const r = makeReporter('lighthouse');

// No gate mock here: Lighthouse audits the cold, unauthenticated landing (the
// gate screen), which performs no Supabase calls until the form is submitted.
// The stub Supabase host baked into dist-e2e never resolves, so even a stray
// request could not phone home.

/** One lighthouse CLI invocation. Returns the spawnSync result. */
function runLighthouse(url) {
  rmSync(LH_JSON, { force: true }); // never parse a stale report
  return spawnSync(
    'npx',
    [
      'lighthouse',
      url,
      '--output=json',
      `--output-path=${LH_JSON}`,
      '--only-categories=performance,accessibility,best-practices',
      // chrome-launcher splits this value on spaces itself:
      '--chrome-flags=--headless=new --no-sandbox --disable-gpu',
      '--quiet',
    ],
    {
      encoding: 'utf8',
      timeout: EXEC_TIMEOUT_MS,
      env: { ...process.env, CHROME_PATH },
    },
  );
}

/** Does a failed run look like npx/npm failing to fetch through the proxy? */
function looksLikeInfraFailure(res) {
  const text = `${res.stdout ?? ''}\n${res.stderr ?? ''}\n${res.error?.message ?? ''}`;
  return /npm (ERR|error)|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED .*registry|EAI_AGAIN|407 |403 |proxy|fetch failed|network request/i.test(
    text,
  );
}

const server = serve(PORT);
try {
  await server.ready;
  mkdirSync(SCRATCH, { recursive: true });
  const url = `http://localhost:${PORT}`;

  let res = runLighthouse(url);
  if (res.status !== 0 || !existsSync(LH_JSON)) {
    console.error('lighthouse run 1 failed; retrying once…');
    console.error((res.stderr || res.stdout || String(res.error) || '').slice(-2000));
    res = runLighthouse(url);
  }

  if (!existsSync(LH_JSON)) {
    // No report at all: the CLI itself never ran to completion. Distinguish
    // "npx couldn't fetch through the proxy" (infrastructure) from other
    // CLI-level failures — neither is an app verdict.
    const infra = looksLikeInfraFailure(res);
    console.error((res.stderr || res.stdout || String(res.error) || '').slice(-2000));
    r.ok(
      false,
      infra
        ? 'INFRASTRUCTURE failure (not an app failure): npx could not fetch/run lighthouse through the proxy after one retry'
        : `lighthouse CLI failed after one retry (exit ${res.status}, signal ${res.signal ?? 'none'})`,
    );
    // Fall through to finally/done — no early exit, teardown must run first.
  } else {
    // A report exists (lighthouse exits non-zero on runtimeError but still
    // writes JSON) — parse it and attribute failures to the APP.
    const lhr = JSON.parse(readFileSync(LH_JSON, 'utf8'));

    if (lhr.runtimeError) {
      r.ok(
        false,
        `APP failure — lighthouse runtimeError ${lhr.runtimeError.code}: ${lhr.runtimeError.message}`,
      );
    }

    const cat = (id) => lhr.categories?.[id]?.score;
    const num = (id) => lhr.audits?.[id]?.numericValue;
    const ms = (v) => (typeof v === 'number' ? `${Math.round(v)}ms` : 'n/a');

    const perf = cat('performance');
    const fcp = num('first-contentful-paint');
    const lcp = num('largest-contentful-paint');
    const tbt = num('total-blocking-time');
    const cls = num('cumulative-layout-shift');
    const si = num('speed-index');
    const a11y = cat('accessibility');
    const bp = cat('best-practices');

    console.log('--- metrics (default mobile / simulated slow-4G / 4x CPU) ---');
    console.log(`performance score : ${perf != null ? Math.round(perf * 100) : 'n/a'}`);
    console.log(`FCP               : ${ms(fcp)}`);
    console.log(`LCP               : ${ms(lcp)}`);
    console.log(`TBT               : ${ms(tbt)}`);
    console.log(`CLS               : ${cls != null ? cls.toFixed(3) : 'n/a'}`);
    console.log(`speed-index       : ${ms(si)}`);
    console.log(`accessibility     : ${a11y != null ? Math.round(a11y * 100) : 'n/a'} (reported, not gated)`);
    console.log(`best-practices    : ${bp != null ? Math.round(bp * 100) : 'n/a'} (reported, not gated)`);

    // ---- the bar --------------------------------------------------------
    r.ok(typeof perf === 'number' && perf >= 0.9, `performance score >= 90 (got ${perf != null ? Math.round(perf * 100) : 'n/a'})`);
    r.ok(typeof fcp === 'number' && fcp < 1500, `first-contentful-paint < 1500ms on 4G (got ${ms(fcp)})`);
    r.ok(typeof lcp === 'number' && lcp < 1500, `largest-contentful-paint < 1500ms on 4G (got ${ms(lcp)})`);
  }
} catch (err) {
  console.error('lighthouse: crashed —', err);
  r.ok(false, `run completed without crashing (${err?.message ?? err})`);
} finally {
  // Cleanup BEFORE r.done(): the reporter exits the process on failure, which
  // would skip a finally-based teardown.
  server.kill();
  // server.kill() TERMs the npx wrapper; the actual vite process can survive
  // it orphaned and squat on the strict port. Reap anything on OUR port only.
  try {
    execSync(`pkill -f "vite preview --outDir dist-e2e --port ${PORT}"`);
  } catch {
    /* nothing left to reap */
  }
}

r.done();
process.exit(0);
