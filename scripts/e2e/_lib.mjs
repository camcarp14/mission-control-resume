// Shared harness for the browser-level bar checks (scripts/e2e/*.mjs).
//
// Architecture, chosen deliberately: every check runs against a REAL
// production build (dist-e2e, built with a stub Supabase URL) while the
// network layer is mocked with Playwright route interception. The app
// executes its genuine code paths — RPC calls, token storage, re-validation
// — against scripted responses, so there are no test hooks or bypass flags
// compiled into the product. The gate's security story stays intact in the
// artifact being tested; only the wire is fake.
//
// Playwright is the GLOBAL install (this container ships it); browsers live
// under /opt/pw-browsers. Scripts run with plain `node`, no test runner.

import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'dist-e2e');

export const pw = await import('/opt/node22/lib/node_modules/playwright/index.mjs');

/** The stub project baked into dist-e2e — never resolves; always intercepted. */
export const STUB_HOST = 'https://stub-gate.supabase.co';
// No E2E_CODE any more: round 23 opened the sign-in (begin_visit, no code).
// The dashboard passcode is the one secret the mock still checks.
export const E2E_PASSCODE = 'liftoff';

/** Build the stub-env production bundle once; reuse across scripts. */
export function ensureBuild({ force = false } = {}) {
  if (force || !existsSync(join(DIST, 'index.html'))) {
    execSync('npx vite build --outDir dist-e2e', {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_SUPABASE_URL: STUB_HOST,
        VITE_SUPABASE_ANON_KEY: 'stub-anon-key',
      },
    });
  }
}

/** Serve dist-e2e with `vite preview` (SPA fallback included).
 *  Spawned DETACHED in its own process group and killed by group: an `npx`
 *  wrapper here once survived its own kill(), orphaning the real vite process
 *  — which held the shared stdio pipes (scripts hung at exit on the GREEN
 *  path) and squatted the strict port for the next run. */
export function serve(port) {
  ensureBuild();
  const child = spawn(
    join(ROOT, 'node_modules', '.bin', 'vite'),
    ['preview', '--outDir', 'dist-e2e', '--port', String(port), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  const url = `http://localhost:${port}`;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite preview did not start in 20s')), 20000);
    const watch = (buf) => {
      if (String(buf).includes(String(port))) {
        clearTimeout(timer);
        resolve(undefined);
      }
    };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('exit', (code) => reject(new Error(`vite preview exited early (${code})`)));
  });
  const kill = () => {
    try {
      process.kill(-child.pid, 'SIGTERM'); // whole group, wrappers included
    } catch {
      child.kill('SIGTERM');
    }
  };
  return { url, ready, kill };
}

/** Dashboard fixtures the mock serves for the correct passcode. */
export const FIXTURE_VISITS = [
  {
    id: 'v-1', name: 'Ada Recruiter', company: 'Acme DSP', role: 'Recruiter', email: null,
    code: 'ACME-K7M3', user_agent: 'e2e', furthest_station: 10, station_count: 11,
    created_at: '2026-08-01T15:00:00Z', last_seen_at: '2026-08-01T15:06:00Z',
  },
  {
    id: 'v-2', name: 'Grace Panelist', company: 'ExchangeCo', role: 'Hiring manager', email: 'g@x.co',
    code: 'EXCH-Q2P8', user_agent: 'e2e', furthest_station: 4, station_count: 11,
    created_at: '2026-08-02T10:00:00Z', last_seen_at: '2026-08-02T10:03:00Z',
  },
];
export const FIXTURE_CODES = [
  { code: 'ACME-K7M3', company: 'Acme DSP', active: true, visit_count: 1, last_seen_at: '2026-08-01T15:06:00Z', max_station: 10 },
  { code: 'EXCH-Q2P8', company: 'ExchangeCo', active: true, visit_count: 1, last_seen_at: '2026-08-02T10:03:00Z', max_station: 4 },
];

/**
 * Intercept the stub Supabase's RPC endpoints on a page or context.
 * Scripted server: one valid code, one valid token, bcrypt passcode stand-in.
 */
export async function installGateMock(target, { validToken = 'tok-e2e', validVisit = 'v-e2e' } = {}) {
  await target.route(`${STUB_HOST}/rest/v1/rpc/*`, async (route) => {
    const req = route.request();
    const fn = req.url().split('/rpc/')[1]?.split('?')[0];
    let body = {};
    try {
      body = req.postDataJSON() ?? {};
    } catch {
      /* empty body */
    }
    const json = (payload) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });

    switch (fn) {
      // The open door (round 23): begin_visit always succeeds, mirroring the
      // real RPC — no code, name/company optional. redeem_access_code is kept
      // for the gate-breach live probe that asserts it is NO LONGER anon-callable.
      case 'begin_visit':
        return json({ ok: true, visit_id: validVisit, token: validToken });
      case 'validate_visit':
        return json(
          body.p_visit_id === validVisit && body.p_token === validToken
            ? { valid: true, furthest_station: 0 }
            : { valid: false, furthest_station: 0 },
        );
      case 'log_station':
        return json({ ok: body.p_token === validToken });
      case 'dashboard_visits':
        if (body.p_passcode === E2E_PASSCODE) {
          return json({ ok: true, visits: FIXTURE_VISITS, codes: FIXTURE_CODES });
        }
        return json({ ok: false });
      default:
        return json({ ok: false, reason: 'unknown_function' });
    }
  });
}

/** Sign in and fly: the standard way every script gets into the flight. The
 *  gate is open now (round 23) — name/company are optional — but the scripts
 *  fill them anyway so a real begin_visit row is exercised. */
export async function unlock(page, base) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.fill('#g-name', 'E2E Pilot');
  await page.fill('#g-company', 'Bar Check Co');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.panel', { timeout: 10000 });
}

/** Tiny assertion helper with the repo's loud-failure discipline. */
export function makeReporter(name) {
  let failures = 0;
  return {
    ok(cond, label) {
      if (cond) console.log(`ok: ${label}`);
      else {
        failures += 1;
        console.error(`FAIL: ${label}`);
      }
      return cond;
    },
    done() {
      if (failures) {
        console.error(`${name}: ${failures} FAILURE(S)`);
        process.exit(1);
      }
      console.log(`${name}: GREEN`);
    },
  };
}
