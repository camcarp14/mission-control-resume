// BAR 3 — a11y: keyboard flight + axe-core zero-critical across all surfaces.
//
// Keyboard: from unlock, ArrowRight through all 11 stations asserting focus
// lands on each station panel and the aria-live region announces the arrival;
// Home/End; full Tab-order reachability of HUD + hudbar controls with a
// visible focus outline on the rail dots; and the Space guard — Space while a
// button holds focus must activate the button natively, never hijack-advance
// the flight (verified at station 1, where the back button is disabled and the
// first tabbable hudbar control is the CURRENT station's rail dot, whose
// activation is a no-op — so any movement would prove a hijack).
//
// axe-core: gate, flight (station 1 + mid), static mode, dashboard locked +
// unlocked. Any 'critical' violation fails; 'serious' are collected as notes.
//
// Run: node scripts/e2e/a11y.mjs

import { execSync } from 'node:child_process';
import { join } from 'node:path';
import {
  pw,
  ROOT,
  serve,
  installGateMock,
  unlock,
  makeReporter,
  E2E_PASSCODE,
} from './_lib.mjs';

const PORT = 4312;
const N = 11;
const SETTLE = 7400; // cinematic legs run 2.6–6.2s (homecoming longest); generous margin
const AXE_PATH = join(ROOT, 'node_modules', 'axe-core', 'axe.min.js');

const r = makeReporter('a11y');
const seriousNotes = [];
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function injectAxe(page) {
  const has = await page.evaluate(() => typeof window.axe !== 'undefined');
  if (!has) await page.addScriptTag({ path: AXE_PATH });
}

async function scan(page, surface) {
  await injectAxe(page);
  const results = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
  const critical = results.violations.filter((v) => v.impact === 'critical');
  const serious = results.violations.filter((v) => v.impact === 'serious');
  for (const v of serious) {
    const targets = v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('; ');
    seriousNotes.push(`${surface}: [serious] ${v.id} (${v.nodes.length} node(s): ${targets}) — ${v.help}`);
  }
  for (const v of critical) {
    const targets = v.nodes.slice(0, 5).map((n) => n.target.join(' ')).join('; ');
    console.error(`  critical on ${surface}: ${v.id} — ${v.help} @ ${targets}`);
  }
  r.ok(critical.length === 0, `axe ${surface}: zero critical violations (found ${critical.length}; serious: ${serious.length})`);
}

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

/** Descriptor of the currently focused element, for the Tab walk. */
const focusedDescriptor = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement) return { body: true };
    const cs = getComputedStyle(a);
    return {
      body: false,
      tag: a.tagName,
      text: (a.textContent || '').trim().slice(0, 48),
      ariaLabel: a.getAttribute('aria-label'),
      href: a.getAttribute('href'),
      download: a.hasAttribute('download'),
      inHud: !!a.closest('header.hud'),
      inHudbar: !!a.closest('.hudbar'),
      inRail: !!a.closest('nav[aria-label="Stations"]'),
      ariaCurrent: a.getAttribute('aria-current'),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
    };
  });

const server = serve(PORT);
let browser;
try {
  await server.ready;
  browser = await pw.chromium.launch();
  const context = await browser.newContext();
  await installGateMock(context); // BEFORE any navigation that touches Supabase
  const page = await context.newPage();
  const base = server.url;

  // ---- (1) gate --------------------------------------------------------
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#g-code');
  await scan(page, 'gate');

  // ---- unlock into the flight -------------------------------------------
  await unlock(page, base); // navigates: axe must be re-injected afterwards
  await sleep(900); // liftoff focus + entrance choreography settle

  // Station titles, read from the rail so expectations track the real app.
  const titles = await page.$$eval('nav[aria-label="Stations"] button', (bs) =>
    bs.map((b) => (b.getAttribute('aria-label') || '').replace(/^Station \d+ of \d+: /, '')),
  );
  r.ok(titles.length === N && titles.every(Boolean), `rail exposes ${N} labelled station dots`);

  async function assertStation(n, what) {
    const title = titles[n - 1];
    // Wait for focus to actually LAND rather than sleeping a fixed margin:
    // focus fires on the travel tween's completion, and the homecoming leg
    // (4.8s) plus CPU contention twice outran the flat SETTLE on full-board
    // runs while passing every solo run. The assertion itself is unchanged —
    // this only replaces dead-reckoned timing with the real signal.
    await page
      .waitForFunction(
        (want) => {
          const a = document.activeElement;
          return !!a && a.tagName === 'SECTION' && a.getAttribute('aria-label') === want;
        },
        `Station ${n}: ${title}`,
        { timeout: 20000 },
      )
      .catch(() => {});
    const st = await focusState(page);
    r.ok(
      st.tag === 'SECTION' && st.label === `Station ${n}: ${title}`,
      `${what}: focus is on panel "Station ${n}: ${title}" (got ${st.tag} "${st.label}")`,
    );
    const expected = `Station ${n} of ${N} — ${title}`;
    r.ok(
      st.lives.includes(expected),
      `${what}: aria-live announced "${expected}" (got: ${JSON.stringify(st.lives)})`,
    );
  }

  await assertStation(1, 'liftoff');

  // ---- keyboard walkthrough: ArrowRight × 10 ----------------------------
  for (let n = 2; n <= N; n++) {
    await page.keyboard.press('ArrowRight');
    await sleep(SETTLE);
    await assertStation(n, `ArrowRight -> station ${n}`);
  }

  // Advance is disabled at the last station.
  r.ok(
    await page.$eval('.hudbar > button:last-of-type', (b) => b.disabled),
    'advance button disabled at station 11',
  );

  // ---- Home / End -------------------------------------------------------
  await page.keyboard.press('Home');
  await sleep(SETTLE + 200);
  await assertStation(1, 'Home');
  await page.keyboard.press('End');
  await sleep(SETTLE + 200);
  await assertStation(11, 'End');

  // ---- Tab order from the panel (mid station: both nav buttons enabled) --
  await page.keyboard.press('Home');
  await sleep(SETTLE + 200);
  await page.keyboard.press('ArrowRight');
  await sleep(SETTLE);
  await page.keyboard.press('ArrowRight');
  await sleep(SETTLE);
  await assertStation(3, 'setup for Tab walk');

  const found = {
    toggle: false,
    pdf: false,
    back: false,
    advance: false,
    dots: new Set(),
  };
  let dotOutlineChecked = 0;
  let dotOutlineVisible = 0;
  const classify = (d) => {
    if (d.body) return;
    if (d.inRail && d.tag === 'BUTTON') {
      const m = /^Station (\d+) of \d+: /.exec(d.ariaLabel || '');
      if (m) {
        found.dots.add(Number(m[1]));
        dotOutlineChecked += 1;
        if (d.outlineStyle !== 'none') dotOutlineVisible += 1;
        else console.error(`  rail dot ${m[1]} focused with outlineStyle 'none'`);
      }
      return;
    }
    if (d.inHudbar && d.tag === 'BUTTON') {
      if (d.text.includes('←')) found.back = true;
      if (d.text.includes('→')) found.advance = true;
      return;
    }
    if (d.inHud && d.tag === 'BUTTON' && d.text.includes('Skip the flight')) found.toggle = true;
    if (d.inHud && d.tag === 'A' && d.href === '/resume.pdf' && d.download) found.pdf = true;
  };
  const allFound = () =>
    found.toggle && found.pdf && found.back && found.advance && found.dots.size === N;

  for (let i = 0; i < 40 && !allFound(); i++) {
    await page.keyboard.press('Tab');
    await sleep(40);
    classify(await focusedDescriptor(page));
  }
  if (!found.toggle || !found.pdf) {
    // Header chrome sits BEFORE the panel in DOM order; if forward-Tab wrap
    // never re-entered the document in headless, walk backwards from the
    // panel — reachability in the tab order is direction-agnostic.
    await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll('section.panel')).find((s) =>
        (s.getAttribute('aria-label') || '').startsWith('Station 3:'),
      );
      p?.focus();
    });
    for (let i = 0; i < 6 && !(found.toggle && found.pdf); i++) {
      await page.keyboard.press('Shift+Tab');
      await sleep(40);
      classify(await focusedDescriptor(page));
    }
  }
  r.ok(found.back, 'Tab order reaches the back button');
  r.ok(
    found.dots.size === N,
    `Tab order reaches all ${N} rail dots (got ${found.dots.size}: ${[...found.dots].join(',')})`,
  );
  r.ok(found.advance, 'Tab order reaches the advance button');
  r.ok(found.toggle, 'Tab order reaches the HUD mode toggle ("Skip the flight")');
  r.ok(found.pdf, 'Tab order reaches the HUD résumé PDF link');
  r.ok(
    dotOutlineChecked > 0 && dotOutlineVisible === dotOutlineChecked,
    `keyboard-focused rail dots show a visible outline (${dotOutlineVisible}/${dotOutlineChecked})`,
  );

  // ---- Space guard at station 1 ----------------------------------------
  // At station 1 the back button is disabled — per HTML semantics a disabled
  // button cannot take focus at all, so Tab from the panel lands on the next
  // hudbar control: the rail dot for the CURRENT station. Activating that dot
  // is a deliberate no-op, so if Space advanced the flight here it could only
  // be a keyboard hijack.
  await page.keyboard.press('Home');
  await sleep(SETTLE + 200);
  await assertStation(1, 'setup for Space guard');

  const backDisabled = await page.$eval('.hudbar > button:first-of-type', (b) => b.disabled);
  r.ok(backDisabled, 'back button is disabled at station 1');
  const backUnfocusable = await page.$eval('.hudbar > button:first-of-type', (b) => {
    b.focus();
    return document.activeElement !== b;
  });
  r.ok(backUnfocusable, 'disabled back button refuses focus (unfocusable per spec)');
  await page.evaluate(() => {
    // Re-land focus on the panel so the Tab below starts from a known spot.
    document.querySelector('section.panel')?.focus();
  });

  let onButton = null;
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    await sleep(40);
    const d = await focusedDescriptor(page);
    if (!d.body && d.tag === 'BUTTON' && d.inHudbar) {
      onButton = d;
      break;
    }
  }
  r.ok(
    !!onButton && onButton.inRail && onButton.ariaCurrent === 'step',
    `Tab from panel 1 skips the disabled back button and lands on the current rail dot (got ${JSON.stringify(onButton)})`,
  );

  const before = await focusState(page);
  await page.keyboard.press('Space');
  await sleep(SETTLE + 200);
  const afterDot = await focusedDescriptor(page);
  const stillCurrent = await page.$eval(
    'nav[aria-label="Stations"] button:nth-child(1)',
    (b) => b.getAttribute('aria-current') === 'step',
  );
  const panel1Exists = await page.evaluate(
    () =>
      !!Array.from(document.querySelectorAll('section.panel')).find((s) =>
        (s.getAttribute('aria-label') || '').startsWith('Station 1:'),
      ),
  );
  r.ok(
    stillCurrent && panel1Exists,
    'Space while a hudbar button has focus does NOT advance the flight (still at station 1)',
  );
  r.ok(
    !afterDot.body && afterDot.inRail && afterDot.ariaCurrent === 'step',
    'Space activated the focused button natively (focus stayed on the rail dot, no hijack)',
  );
  const after = await focusState(page);
  r.ok(
    JSON.stringify(after.lives) === JSON.stringify(before.lives),
    'aria-live did not re-announce after the Space no-op',
  );

  // ---- (2) flight at station 1 -----------------------------------------
  await scan(page, 'flight station 1');

  // ---- (3) flight at a mid station after 3 advances ---------------------
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    await sleep(SETTLE);
  }
  await assertStation(4, 'axe setup: 3 advances');
  await scan(page, 'flight station 4 (mid)');

  // ---- (4) static mode --------------------------------------------------
  await page.click('header.hud button:has-text("Skip the flight")');
  await page.waitForSelector('h1:has-text("The whole mission, on one page")');
  await sleep(300);
  await scan(page, 'static mode');

  // ---- (5) dashboard passcode screen ------------------------------------
  await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#d-pass');
  await scan(page, 'dashboard locked');

  // ---- (6) dashboard unlocked -------------------------------------------
  await page.fill('#d-pass', E2E_PASSCODE);
  await page.click('button:has-text("Open the logbook")');
  await page.waitForSelector('td:has-text("Ada Recruiter")');
  await page.waitForSelector('td:has-text("ACME-K7M3")');
  await sleep(300);
  await scan(page, 'dashboard unlocked');

} catch (err) {
  console.error('a11y: crashed —', err);
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

if (seriousNotes.length) {
  console.log('serious (collected, non-failing):');
  for (const s of seriousNotes) console.log(`  ${s}`);
} else {
  console.log('serious (collected, non-failing): none');
}

r.done();
// Force the exit: server.kill() SIGTERMs the npx wrapper, but the grandchild
// vite process can outlive it holding our shared stdio pipes, which would keep
// the event loop (and this process) alive forever on the green path.
process.exit(0);
