// BAR 6 — gate-breach: the sign-in is open, but the invariants that protect
// the LOGBOOK and the session model still hold.
//
// Round 23 changed what this door means. It is no longer access control — the
// flight is free and the fields are optional (begin_visit, no code). So the
// old "wrong code stays gated" assertions are gone; what remains are the
// invariants that never depended on the code:
//
// MOCKED-WIRE (always runs, against dist-e2e + Playwright route interception):
//   1. Fresh load of '/'  → no station panel in the DOM, and the Flight
//      content chunk (/assets/Flight*) is never even fetched pre sign-in.
//      (The chunk is still lazy and still only imported once a visit begins —
//      an optimization now rather than a lock, but the ordering is asserted.)
//   2. Forged sessionStorage 'mc.visit' seeded pre-load → the server-side
//      validate_visit says no → sign-in shown, forged entry CLEARED. This is
//      the token model, unchanged: a fabricated session never resumes.
//   3. URL games: /dashboard direct shows the passcode form with zero fixture
//      strings; /#unlocked and /?unlocked=1 still land on the sign-in.
//   4. Wrong dashboard passcode → "Passcode not recognized.", still zero
//      fixtures. The owner's logbook stays protected.
//   5. Valid begin_visit → panel appears AND the Flight chunk request happened
//      only AFTER the begin_visit RPC. Then a corrupted token + reload →
//      re-gated (validate_visit rejects it).
//
// REAL-DB (only when VITE_SUPABASE_URL points at a live project, not the
// stub): raw REST probes proving deny-all RLS + grant hygiene — anon SELECT on
// visits is denied (an empty-200 is the classic silent RLS leak and FAILS),
// gate_rate_limit is not executable by anon, redeem_access_code is NO LONGER
// executable by anon (the door it fronted is closed), and begin_visit answers
// {ok:true} with a token. When the env is absent this half is SKIPPED, which
// is NOT a pass.
//
// Run: node scripts/e2e/gate-breach.mjs

import { spawnSync } from 'node:child_process';
import {
  pw,
  serve,
  installGateMock,
  makeReporter,
  STUB_HOST,
} from './_lib.mjs';

const PORT = 4314;
const SETTLE = 700; // transitions run 250–400ms; generous margin
const FLIGHT_RE = /assets\/Flight/;

const r = makeReporter('gate-breach');
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const countPanels = (page) => page.evaluate(() => document.querySelectorAll('section.panel').length);
const readVisit = (page) => page.evaluate(() => sessionStorage.getItem('mc.visit'));

/** Fresh isolated context with the wire mock installed BEFORE any navigation. */
async function freshContext(browser) {
  const context = await browser.newContext();
  await installGateMock(context);
  return context;
}

/** serve()'s kill() SIGTERMs the npx wrapper, but the actual `vite preview`
 *  grandchild can outlive it — holding OUR port (breaking the next run's
 *  --strictPort bind) and our stdio-watch pipes (hanging this process's event
 *  loop). Reap it, scoped strictly to this script's assigned port. */
function reapPreview() {
  spawnSync('pkill', ['-f', `vite preview.*--port ${PORT}`]);
}

reapPreview(); // pre-clean: a stale preview from an earlier run would 409 the port
await new Promise((res) => setTimeout(res, 300));

const server = serve(PORT);
let browser;
try {
  await server.ready;
  browser = await pw.chromium.launch();
  const base = server.url;

  // ---- (1) fresh load: no panel, Flight chunk never fetched --------------
  {
    const context = await freshContext(browser);
    const page = await context.newPage();
    const requests = [];
    page.on('request', (req) => requests.push(req.url()));

    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#g-name', { timeout: 10000 });
    await sleep(1500); // let any idle-time prefetching happen, then look again

    r.ok((await countPanels(page)) === 0, 'fresh load: no section.panel in the DOM');
    const flightReqs = requests.filter((u) => FLIGHT_RE.test(u));
    r.ok(
      flightReqs.length === 0,
      `fresh load: no request matches /assets\\/Flight/ before sign-in (saw ${flightReqs.length}: ${flightReqs.join(', ') || 'none'})`,
    );
    await context.close();
  }

  // ---- (2) forged sessionStorage dies at validate_visit ------------------
  {
    const context = await freshContext(browser);
    await context.addInitScript(() => {
      sessionStorage.setItem('mc.visit', JSON.stringify({ visitId: 'forged', token: 'forged' }));
    });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    // The forged token forces a validate_visit round-trip → valid:false → sign-in.
    await page.waitForSelector('#g-name', { timeout: 10000 });

    r.ok(true, 'forged mc.visit: sign-in shown (validate_visit rejected the forgery)');
    r.ok((await countPanels(page)) === 0, 'forged mc.visit: no section.panel rendered');
    const left = await readVisit(page);
    r.ok(left === null, `forged mc.visit: entry CLEARED from sessionStorage (got ${JSON.stringify(left)})`);
    await context.close();
  }

  // ---- (3) URL games + (4) wrong dashboard passcode ----------------------
  {
    const context = await freshContext(browser);
    const page = await context.newPage();

    // /dashboard direct → passcode form, zero fixture strings.
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#d-pass', { timeout: 10000 });
    let html = await page.content();
    r.ok(
      !html.includes('Ada Recruiter') && !html.includes('ACME-K7M3'),
      '/dashboard direct: passcode form only, no fixture strings in page content',
    );

    // /#unlocked and /?unlocked=1 → still the sign-in, no panel.
    for (const path of ['/#unlocked', '/?unlocked=1']) {
      await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#g-name', { timeout: 10000 });
      r.ok((await countPanels(page)) === 0, `${path}: still the sign-in, no section.panel`);
    }

    // Wrong dashboard passcode → rejection message, still zero fixtures.
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#d-pass', { timeout: 10000 });
    await page.fill('#d-pass', 'wrong-passcode');
    await page.click('button:has-text("Open the logbook")');
    await page.waitForSelector('text=Passcode not recognized.', { timeout: 10000 });
    html = await page.content();
    r.ok(
      html.includes('Passcode not recognized.'),
      'wrong dashboard passcode: "Passcode not recognized." shown',
    );
    r.ok(
      !html.includes('Ada Recruiter') && !html.includes('ACME-K7M3'),
      'wrong dashboard passcode: no fixture strings leaked into page content',
    );
    await context.close();
  }

  // ---- (5) valid sign-in: request ordering + corrupted-token re-gate -----
  {
    const context = await freshContext(browser);
    const page = await context.newPage();
    const requests = [];
    page.on('request', (req) => requests.push(req.url()));

    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#g-name', { timeout: 10000 });
    await page.fill('#g-name', 'E2E Pilot');
    await page.fill('#g-company', 'Bar Check Co');
    await page.click('button[type="submit"]');
    await page.waitForSelector('section.panel', { timeout: 10000 });
    await sleep(SETTLE);

    r.ok((await countPanels(page)) > 0, 'valid sign-in: station panel appears');

    const beginIdx = requests.findIndex((u) => u.includes('/rest/v1/rpc/begin_visit'));
    const flightIdx = requests.findIndex((u) => FLIGHT_RE.test(u));
    r.ok(beginIdx !== -1, 'valid sign-in: begin_visit RPC was requested');
    r.ok(flightIdx !== -1, 'valid sign-in: Flight content chunk was requested');
    r.ok(
      beginIdx !== -1 && flightIdx !== -1 && flightIdx > beginIdx,
      `valid sign-in: Flight chunk fetched only AFTER the begin_visit POST (begin @${beginIdx}, flight @${flightIdx})`,
    );

    // Corrupt the token in devtools style, reload → server says no → re-gated.
    await page.evaluate(() => {
      const v = JSON.parse(sessionStorage.getItem('mc.visit') ?? '{}');
      v.token = 'corrupted-by-devtools';
      sessionStorage.setItem('mc.visit', JSON.stringify(v));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#g-name', { timeout: 10000 });
    r.ok((await countPanels(page)) === 0, 'corrupted token + reload: re-gated, no section.panel');
    r.ok(
      (await readVisit(page)) === null,
      'corrupted token + reload: rejected entry cleared from sessionStorage',
    );
    await context.close();
  }

  // ---- REAL-DB probes (only with a live Supabase env) --------------------
  const liveUrl = process.env.VITE_SUPABASE_URL;
  const liveAnon = process.env.VITE_SUPABASE_ANON_KEY;
  if (liveUrl && liveUrl !== STUB_HOST) {
    console.log(`live-DB probes against ${liveUrl}`);
    if (!liveAnon) {
      r.ok(
        false,
        'live: VITE_SUPABASE_URL is set but VITE_SUPABASE_ANON_KEY is missing — cannot run the anon probes, refusing to silently skip',
      );
    } else {
      const anonHeaders = {
        apikey: liveAnon,
        Authorization: `Bearer ${liveAnon}`,
        'Content-Type': 'application/json',
      };
      /** Raw fetch that never throws: a dead network is a red probe, not a crash. */
      const probe = async (url, init) => {
        try {
          const res = await fetch(url, init);
          return { status: res.status, body: await res.text() };
        } catch (err) {
          return { status: 0, body: `fetch failed: ${err?.message ?? err}` };
        }
      };

      // (a) anon SELECT on visits must be denied — an empty-200 is the classic
      // silent RLS leak (RLS on, but table grants still let the query
      // "succeed" returning []), and it FAILS here explicitly.
      {
        const { status, body } = await probe(`${liveUrl}/rest/v1/visits?select=id`, {
          headers: anonHeaders,
        });
        if (status === 200) {
          r.ok(
            false,
            `live: GET /rest/v1/visits returned HTTP 200 (${body.trim() === '[]' ? 'empty array — the classic silent RLS leak: grants present, policies filtering' : `body: ${body.slice(0, 120)}`}) — anon must be denied outright`,
          );
        } else {
          const denied = status === 401 || status === 403 || /permission denied/i.test(body);
          r.ok(
            denied,
            `live: GET /rest/v1/visits denied for anon (HTTP ${status}, body: ${body.slice(0, 120)})`,
          );
        }
      }

      // (b) gate_rate_limit is internal-only: anon must not be able to run it.
      {
        const { status, body } = await probe(`${liveUrl}/rest/v1/rpc/gate_rate_limit`, {
          method: 'POST',
          headers: anonHeaders,
          body: JSON.stringify({ p_scope: 'begin' }),
        });
        const denied =
          status === 401 || status === 403 || status === 404 || /permission denied/i.test(body);
        r.ok(
          denied && status !== 200,
          `live: POST /rpc/gate_rate_limit denied for anon (HTTP ${status}, body: ${body.slice(0, 120)})`,
        );
      }

      // (c) redeem_access_code is retired from the UI and REVOKED from anon in
      // 0002 — the door it fronted is closed. Anon calling it must be denied.
      {
        const { status, body } = await probe(`${liveUrl}/rest/v1/rpc/redeem_access_code`, {
          method: 'POST',
          headers: anonHeaders,
          body: JSON.stringify({
            p_code: 'ZZZZ-0000',
            p_name: 'e2e probe',
            p_company: 'e2e probe',
            p_role: '',
            p_email: null,
            p_user_agent: 'gate-breach probe',
          }),
        });
        const denied =
          status === 401 || status === 403 || status === 404 || /permission denied/i.test(body);
        r.ok(
          denied && status !== 200,
          `live: redeem_access_code denied for anon after 0002 revoke (HTTP ${status}, body: ${body.slice(0, 120)})`,
        );
      }

      // (d) begin_visit is the open door: anon calls it and gets a token back.
      {
        const { status, body } = await probe(`${liveUrl}/rest/v1/rpc/begin_visit`, {
          method: 'POST',
          headers: anonHeaders,
          body: JSON.stringify({
            p_name: 'gate-breach probe',
            p_company: 'gate-breach probe',
            p_user_agent: 'gate-breach probe',
          }),
        });
        let d;
        try {
          d = JSON.parse(body);
        } catch {
          d = undefined;
        }
        r.ok(
          status === 200 && d?.ok === true && typeof d?.token === 'string' && d.token.length >= 32,
          `live: begin_visit returns a token for anon (HTTP ${status}, ok=${d?.ok}, token len=${d?.token?.length ?? 0})`,
        );
      }
    }
  } else {
    console.log(
      'live-DB probes: SKIPPED (no live Supabase env) — this is NOT a pass for the live-DB half',
    );
  }

  r.done();
} catch (err) {
  console.error('gate-breach: crashed —', err);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server.kill();
  reapPreview(); // close the grandchild so our pipes drain and the port frees
  // Hard stop after a short flush window — never leave this process hanging
  // on a stray handle. exitCode carries the reporter/crash verdict.
  setTimeout(() => process.exit(process.exitCode ?? 0), 250);
}
