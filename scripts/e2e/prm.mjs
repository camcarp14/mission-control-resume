// scripts/e2e/prm.mjs — BAR 7: reduced motion genuinely usable.
//
// Context is created with reducedMotion: 'reduce' (Playwright emulates the
// prefers-reduced-motion media query), then the whole product is exercised
// under it: full keyboard walkthrough 1→11 with focus + aria-live assertions
// at every station, End/Home/rail-dot jumps, the "crossfade world" contract
// (exactly ONE mounted section.panel at rest, no bob animation, zero running
// animations, Framer SNAPS rather than animates — transforms sampled twice
// 100ms apart must be identical), static-mode toggle + back, PDF link,
// dashboard passcode flow. Core walkthrough repeats at 390x844 (mobile PRM).
//
// App fact this script encodes: under PRM the app REMOVES the 'bob' class
// from the rocket wrapper entirely (Rocket.tsx), so the .bob element may be
// absent — absence passes; if present its computed animationName must be
// 'none'. A probe element with class 'bob' additionally verifies the
// @media (prefers-reduced-motion: reduce) block genuinely kills the keyframes
// in this rendering context.
//
// Run: node scripts/e2e/prm.mjs   (port 4315)

import { execSync } from 'node:child_process';
import {
  pw,
  serve,
  installGateMock,
  unlock,
  ensureBuild,
  makeReporter,
  E2E_PASSCODE,
} from './_lib.mjs';

const PORT = 4315;
const N = 11;
const SETTLE = 650; // transitions run 250–400ms with motion; PRM snaps, but React render + focus effect deserve margin

const r = makeReporter('prm');
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** Snapshot of focus + live-region state, taken in the page. */
const focusState = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return {
      tag: a?.tagName ?? null,
      label: a?.getAttribute('aria-label') ?? null,
      lives: Array.from(document.querySelectorAll('[aria-live="polite"]')).map((e) =>
        (e.textContent || '').trim(),
      ),
    };
  });

/** All mounted station panels: [{label}] — under PRM this must be length 1. */
const panelLabels = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('section.panel')).map(
      (s) => s.getAttribute('aria-label') || '',
    ),
  );

/** Every non-'none' computed transform inside the stage, keyed by walk index. */
const transformSnapshot = (page) =>
  page.evaluate(() => {
    const out = [];
    const els = document.querySelectorAll('.stage, .stage *');
    els.forEach((el, i) => {
      const tf = getComputedStyle(el).transform;
      if (tf && tf !== 'none') out.push(`${i}:${el.tagName}.${el.getAttribute('class') || ''}=${tf}`);
    });
    return out.join(' | ');
  });

/** Running animations (CSS animations/transitions + WAAPI), described. */
const runningAnimations = (page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .map((a) => {
        const el = a.effect && 'target' in a.effect ? a.effect.target : null;
        const who = el ? `${el.tagName}.${el.getAttribute?.('class') || ''}` : '?';
        return `${a.constructor.name}(${a.animationName || a.transitionProperty || ''}) on ${who}`;
      }),
  );

/**
 * The core walkthrough, shared by both viewports:
 * unlock → assert liftoff at 1 → ArrowRight through 2..11 (focus + aria-live
 * + single-panel windowing each arrival) → ArrowLeft to 10 → End → Home →
 * rail-dot jump to 6. Returns { page, titles } still inside the flight.
 */
async function coreWalkthrough(page, base, name) {
  r.ok(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    `${name}: prefers-reduced-motion: reduce is active in the page`,
  );
  await sleep(800); // liftoff focus settle

  const titles = await page.$$eval('nav[aria-label="Stations"] button', (bs) =>
    bs.map((b) => (b.getAttribute('aria-label') || '').replace(/^Station \d+ of \d+: /, '')),
  );
  r.ok(titles.length === N && titles.every(Boolean), `${name}: rail exposes ${N} labelled station dots`);

  let panelCountAlwaysOne = true;
  const badCounts = [];

  async function assertStation(n, what) {
    const title = titles[n - 1];
    const st = await focusState(page);
    const labels = await panelLabels(page);
    // The (single) mounted panel advanced to the target station.
    r.ok(
      labels.includes(`Station ${n}: ${title}`),
      `${name} ${what}: mounted panel is "Station ${n}: ${title}" (got: ${JSON.stringify(labels)})`,
    );
    // Focus landed on that panel.
    r.ok(
      st.tag === 'SECTION' && st.label === `Station ${n}: ${title}`,
      `${name} ${what}: focus on panel "Station ${n}: ${title}" (got ${st.tag} "${st.label}")`,
    );
    // The live region announced the arrival.
    const expected = `Station ${n} of ${N} — ${title}`;
    r.ok(
      st.lives.includes(expected),
      `${name} ${what}: aria-live announced "${expected}" (got: ${JSON.stringify(st.lives)})`,
    );
    // PRM windowing: never more than the current panel in the DOM at rest.
    if (labels.length !== 1) {
      panelCountAlwaysOne = false;
      badCounts.push(`${what}: ${labels.length} panels [${labels.join('; ')}]`);
    }
  }

  await assertStation(1, 'liftoff');

  // ---- ArrowRight through every station ---------------------------------
  for (let n = 2; n <= N; n++) {
    await page.keyboard.press('ArrowRight');
    await sleep(SETTLE);
    await assertStation(n, `ArrowRight -> station ${n}`);
  }
  r.ok(
    await page.$eval('.hudbar > button:last-of-type', (b) => b.disabled),
    `${name}: advance button disabled at station 11`,
  );

  // ---- back once so End is a REAL transition, then End / Home / rail jump
  await page.keyboard.press('ArrowLeft');
  await sleep(SETTLE);
  await assertStation(10, 'ArrowLeft -> station 10');
  await page.keyboard.press('End');
  await sleep(SETTLE);
  await assertStation(11, 'End');
  await page.keyboard.press('Home');
  await sleep(SETTLE);
  await assertStation(1, 'Home');
  r.ok(
    await page.$eval('.hudbar > button:first-of-type', (b) => b.disabled),
    `${name}: back button disabled at station 1`,
  );
  await page.click('nav[aria-label="Stations"] button:nth-child(6)');
  await sleep(SETTLE);
  await assertStation(6, 'rail-dot jump -> station 6');
  r.ok(
    await page.$eval(
      'nav[aria-label="Stations"] button[aria-current="step"]',
      (b) => (b.getAttribute('aria-label') || '').startsWith('Station 6 of 11'),
    ),
    `${name}: rail marks station 6 as current after the jump`,
  );

  r.ok(
    panelCountAlwaysOne,
    `${name}: exactly ONE section.panel mounted at every rest (violations: ${badCounts.join(' / ') || 'none'})`,
  );

  return titles;
}

/** The crossfade-world contract, asserted at rest (desktop run, station 6). */
async function assertCrossfadeWorld(page, name) {
  await sleep(800); // fully at rest — beyond any transition window

  // (a) exactly one panel in the DOM at rest.
  const labels = await panelLabels(page);
  r.ok(
    labels.length === 1,
    `${name}: exactly one section.panel in the DOM at rest (got ${labels.length}: ${JSON.stringify(labels)})`,
  );

  // (b) the bob animation is dead. The app removes the class under PRM
  // (absence passes); if a .bob exists its computed animationName must be
  // 'none'. A probe .bob verifies the reduce block kills the keyframes.
  const bob = await page.evaluate(() => {
    const el = document.querySelector('.bob');
    const existing = el ? getComputedStyle(el).animationName : null;
    const probe = document.createElement('div');
    probe.className = 'bob';
    document.body.appendChild(probe);
    const probeName = getComputedStyle(probe).animationName;
    probe.remove();
    return { present: !!el, existing, probeName, rocket: !!document.querySelector('.rocketwrap') };
  });
  r.ok(
    bob.present ? bob.existing === 'none' : true,
    bob.present
      ? `${name}: .bob computed animationName is 'none' (got '${bob.existing}')`
      : `${name}: .bob absent under PRM (app strips the class; rocket present: ${bob.rocket})`,
  );
  r.ok(
    bob.probeName === 'none',
    `${name}: reduce block kills 'bob' keyframes — probe .bob animationName 'none' (got '${bob.probeName}')`,
  );

  // (c) zero running animations anywhere on the page at rest.
  const running = await runningAnimations(page);
  r.ok(
    running.length === 0,
    `${name}: zero running animations at rest (found ${running.length}: ${running.join(', ') || 'none'})`,
  );

  // (d) Framer snaps, never animates: every transform in the stage sampled
  // twice 100ms apart must be byte-identical.
  const s1 = await transformSnapshot(page);
  await sleep(100);
  const s2 = await transformSnapshot(page);
  r.ok(
    s1 === s2,
    `${name}: stage transforms identical across 100ms at rest${
      s1 === s2 ? '' : ` (before: ${s1} || after: ${s2})`
    }`,
  );
  r.ok(s1.length > 0, `${name}: transform snapshot non-empty (sampled: ${s1.slice(0, 120)}...)`);
}

/** Static mode toggle + back, PDF link — under PRM, from the flight. */
async function assertStaticAndPdf(page, name) {
  r.ok(
    (await page.$('header.hud a[download][href="/resume.pdf"]')) !== null,
    `${name}: HUD résumé PDF link present in flight mode`,
  );
  await page.click('header.hud button:has-text("Skip the flight")');
  await page.waitForSelector('h1:has-text("The whole mission, on one page")', { timeout: 5000 });
  await sleep(400);
  const sections = await page.$$eval('main section', (s) => s.length);
  r.ok(sections === N, `${name}: static mode renders ${N} sections (got ${sections})`);
  r.ok(
    (await page.$('header.hud a[download][href="/resume.pdf"]')) !== null,
    `${name}: HUD résumé PDF link present in static mode`,
  );
  const staticRunning = await runningAnimations(page);
  r.ok(
    staticRunning.length === 0,
    `${name}: static mode has zero running animations (found: ${staticRunning.join(', ') || 'none'})`,
  );
  await page.click('header.hud button:has-text("Back to the flight")');
  await page.waitForSelector('section.panel', { timeout: 5000 });
  await sleep(SETTLE);
  const labels = await panelLabels(page);
  r.ok(
    labels.length === 1 && labels[0].startsWith('Station 6:'),
    `${name}: toggling back returns to the flight at station 6 (got: ${JSON.stringify(labels)})`,
  );
}

/** Dashboard passcode flow under the same PRM context. */
async function assertDashboard(page, base, name) {
  await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#d-pass', { timeout: 5000 });
  r.ok(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    `${name}: PRM active on the dashboard page`,
  );
  await page.fill('#d-pass', E2E_PASSCODE);
  await page.click('button:has-text("Open the logbook")');
  const gotVisits = await page
    .waitForSelector('td:has-text("Ada Recruiter")', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  const gotCodes = await page
    .waitForSelector('td:has-text("ACME-K7M3")', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  r.ok(gotVisits, `${name}: dashboard unlocks with passcode — visits table shows "Ada Recruiter"`);
  r.ok(gotCodes, `${name}: dashboard codes table shows "ACME-K7M3"`);
}

ensureBuild();
const server = serve(PORT);
let browser;
try {
  await server.ready;
  browser = await pw.chromium.launch();
  const base = server.url;

  // ---- desktop PRM: full pass -------------------------------------------
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    });
    try {
      await installGateMock(context); // BEFORE any navigation that hits Supabase
      const page = await context.newPage();
      await unlock(page, base);
      await coreWalkthrough(page, base, 'desktop 1440x900');
      await assertCrossfadeWorld(page, 'desktop 1440x900'); // at rest, station 6
      await assertStaticAndPdf(page, 'desktop 1440x900');
      await assertDashboard(page, base, 'desktop 1440x900');
    } finally {
      await context.close();
    }
  }

  // ---- mobile PRM: core walkthrough repeated ----------------------------
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
    });
    try {
      await installGateMock(context);
      const page = await context.newPage();
      await unlock(page, base);
      await coreWalkthrough(page, base, 'mobile 390x844');
      // The world must be just as still on the phone.
      await sleep(800);
      const running = await runningAnimations(page);
      r.ok(
        running.length === 0,
        `mobile 390x844: zero running animations at rest (found: ${running.join(', ') || 'none'})`,
      );
      const s1 = await transformSnapshot(page);
      await sleep(100);
      const s2 = await transformSnapshot(page);
      r.ok(s1 === s2, `mobile 390x844: stage transforms identical across 100ms at rest`);
    } finally {
      await context.close();
    }
  }
} catch (err) {
  console.error('prm: crashed —', err);
  r.ok(false, `run completed without crashing (${err?.message ?? err})`);
} finally {
  // Cleanup BEFORE r.done(): the reporter exits the process on failure, which
  // would skip a finally-based teardown.
  await browser?.close().catch(() => {});
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
// Force the exit: orphaned preview pipes can keep the event loop alive on the
// green path even after kill().
process.exit(0);
