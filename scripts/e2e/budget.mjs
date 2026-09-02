#!/usr/bin/env node
/* ==== THE POST-UNLOCK TRANSFER BUDGET ======================================
 *
 * Every asset regression this project has ever had lived on the far side of
 * the button. lighthouse.mjs scores 100 and it only ever loads the gate —
 * ~250 kB of a ~2.6 MB experience — so the 1.3 MB flight chunk, the HDRI and
 * eleven planet maps were structurally invisible to the site's own green
 * check. This script closes that: it drives the real sign-in, then asserts on
 * what actually crosses the wire afterwards.
 *
 * Two numbers, and the difference between them is the point:
 *
 *   COLD   a first-time visitor who presses the button the instant the gate
 *          paints, before the warm-up (src/lib/warm.ts) has moved anything.
 *          The floor of the experience, and what the ceiling is set against.
 *   WARM   the same visitor after a few seconds of reading the splash. Every
 *          byte the warm-up moved out of this window is a byte nobody watches
 *          a progress bar for.
 *
 * ---- WHY THIS SCRIPT DOES NOT USE installGateMock --------------------------
 * It is the only script in scripts/e2e/ that does not, and the reason is
 * worth writing down because it invalidates any future check in this
 * directory that tries to reason about caching:
 *
 *   REGISTERING A PLAYWRIGHT ROUTE TURNS THE BROWSER'S HTTP CACHE OFF.
 *
 * Measured directly, four warm techniques against a `max-age=2592000`
 * response: without a route, the second request for each is 0 bytes; with one
 * route registered anywhere on the context, all four re-download in full.
 * Under interception a working warm-up is indistinguishable from no warm-up
 * at all — which is exactly what this script reported before it stopped
 * intercepting. So the Supabase stub here is a real HTTP endpoint on the same
 * origin as the page, baked in at build time, and no request is intercepted.
 *
 * `encodedDataLength` from CDP, not content-length: a response served from
 * cache reports zero, which is the whole distinction being measured. Which
 * also means the static server below sends the SAME cache headers
 * netlify.toml does — `vite preview` sends `Cache-Control: no-cache` on
 * everything — and each measurement runs in a fresh PERSISTENT profile,
 * because an incognito context has no disk cache and a real visitor does.
 * ========================================================================= */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { ROOT, pw, makeReporter, FIXTURE_VISITS, FIXTURE_CODES, E2E_PASSCODE } from './_lib.mjs';

const PORT = 4327;
const ORIGIN = `http://localhost:${PORT}`;
const DIST = join(ROOT, 'dist-budget');

/* ---- the budget ----------------------------------------------------------
 * Set against what this build ships, with headroom for one honest change and
 * not a byte more — a ceiling a regression fits inside is not a ceiling. A
 * new dependency in the flight chunk trips COLD; a texture that grew, or one
 * added to the scene and never added to WARM_MEDIA, trips WARM. */
const COLD_BUDGET_KB = 2900;
const WARM_BUDGET_KB = 250;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.hdr': 'image/vnd.radiance', '.pdf': 'application/pdf', '.ico': 'image/x-icon',
};

/** netlify.toml's cache policy, reproduced. Keep the two in step: a media
 *  path that loses its header here reads as a warm-up that stopped working,
 *  which is a confusing way to find out. */
const MEDIA = /^\/(textures|hdri|fonts)\//;
const cacheControl = (path) =>
  path.startsWith('/assets/') ? 'public, max-age=31536000, immutable'
  : MEDIA.test(path) ? 'public, max-age=2592000, stale-while-revalidate=86400'
  : 'public, max-age=0, must-revalidate';

/** The same scripted server installGateMock provides, as real HTTP on the
 *  page's own origin — so supabase-js reaches it without CORS, a preflight,
 *  or an intercepted route. */
function rpc(fn, body) {
  switch (fn) {
    case 'begin_visit': return { ok: true, visit_id: 'v-budget', token: 'tok-budget' };
    case 'validate_visit': return { valid: body.p_visit_id === 'v-budget', furthest_station: 0 };
    case 'log_station': return { ok: true };
    case 'dashboard_visits':
      return body.p_passcode === E2E_PASSCODE
        ? { ok: true, visits: FIXTURE_VISITS, codes: FIXTURE_CODES }
        : { ok: false };
    default: return { ok: false, reason: 'unknown_function' };
  }
}

function serveDist() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, ORIGIN).pathname);

    if (path.startsWith('/supa/rest/v1/rpc/')) {
      const fn = path.slice('/supa/rest/v1/rpc/'.length);
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { /* empty body */ }
        const payload = JSON.stringify(rpc(fn, body));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
        res.end(payload);
      });
      return;
    }

    let file = join(DIST, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html'); // SPA fallback
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': statSync(file).size,
      'Cache-Control': cacheControl(path),
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

/** A production build whose Supabase URL is this script's own server. */
function build() {
  execSync(`npx vite build --outDir ${DIST}`, {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, VITE_SUPABASE_URL: `${ORIGIN}/supa`, VITE_SUPABASE_ANON_KEY: 'budget-anon-key' },
  });
}

/** Bytes off the wire between the click and the flight deck coming up.
 *  `settle` is how long the gate is left alone first — 0 for the cold case
 *  (press it the instant it paints), generous for the warm one. */
async function measure(settle) {
  const profile = mkdtempSync(join(tmpdir(), 'mc-budget-'));
  const context = await pw.chromium.launchPersistentContext(profile, {
    viewport: { width: 1440, height: 900 },
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');

    let counting = false;
    let bytes = 0;
    const seen = new Set();
    cdp.on('Network.responseReceived', (e) => {
      if (counting && !e.response.url.includes('/supa/')) seen.add(e.requestId);
    });
    cdp.on('Network.loadingFinished', (e) => {
      if (seen.has(e.requestId)) bytes += e.encodedDataLength ?? 0;
    });

    await page.goto(ORIGIN, { waitUntil: 'load' });
    await page.waitForSelector('button[type="submit"]');
    if (settle) await page.waitForTimeout(settle);

    counting = true;
    const t0 = Date.now();
    await page.click('button[type="submit"]');
    await page.waitForSelector('.panel', { timeout: 30000 });
    const ms = Date.now() - t0;
    await page.waitForTimeout(3000); // let the scene finish pulling what it needs
    counting = false;

    return { kb: Math.round(bytes / 1024), ms };
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

const r = makeReporter('budget');
build();
const server = await serveDist();
try {
  const cold = await measure(0);
  console.log(`cold  (click on arrival):    ${cold.kb} kB, ${cold.ms} ms to first panel`);
  r.ok(cold.kb <= COLD_BUDGET_KB, `cold post-unlock transfer ${cold.kb} kB <= ${COLD_BUDGET_KB} kB`);

  const warm = await measure(6000);
  console.log(`warm  (click after reading): ${warm.kb} kB, ${warm.ms} ms to first panel`);
  r.ok(warm.kb <= WARM_BUDGET_KB, `warm post-unlock transfer ${warm.kb} kB <= ${WARM_BUDGET_KB} kB`);

  // A byte ceiling alone would pass a warm-up that half ran. This is the
  // assertion that says it works, rather than that it did not get worse.
  r.ok(
    warm.kb < cold.kb / 4,
    `warm-up moved the cost off the click (${cold.kb} kB -> ${warm.kb} kB)`,
  );
} finally {
  server.close();
}
r.done();
