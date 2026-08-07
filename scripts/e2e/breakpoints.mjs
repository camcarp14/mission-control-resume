// BAR 4 — breakpoints: 390px and 2560px, no breakage.
//
// Matrix: widths [390x844, 2560x1200] × states [gate, flight station 1,
// flight station 6 (rail jump), static mode]. Per cell: no doc-level
// horizontal overflow; header.hud fully visible (where it exists — the gate
// deliberately renders no HUD, chrome appears only after redemption); in
// flight the current section.panel fits the viewport and its text is not
// clipped (scrollHeight > clientHeight tolerated ONLY when the panel itself
// scrolls, i.e. computed overflow-y auto/scroll — the designed escape for
// short viewports; noted, not failed). At 390 every interactive control in
// header.hud + .hudbar must offer a >=42px hit target in at least one
// dimension (BUTTON boxes, not the 7px dot spans). At 2560 the flight panel
// must not sit absurdly off-center: horizontal center within [30%, 80%] of
// viewport width. Every cell is screenshotted for human inspection.
//
// Run: node scripts/e2e/breakpoints.mjs

import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { pw, serve, installGateMock, unlock, makeReporter } from './_lib.mjs';

const PORT = 4313;
const SETTLE = 5600; // cinematic legs run 1.7–4.8s (homecoming longest); generous margin
const SHOTS = '/tmp/claude-0/-home-user-hyperscaler/8bf20831-d166-555c-a464-fdd5a13ea72e/scratchpad';
const WIDTHS = [
  { w: 390, h: 844 },
  { w: 2560, h: 1200 },
];
const TOL = 1; // px tolerance everywhere

mkdirSync(SHOTS, { recursive: true });

const r = makeReporter('breakpoints');
const notes = [];
const shots = [];
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** No document-level horizontal overflow. */
async function checkNoHorizontalOverflow(page, cell) {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  r.ok(sw <= cw + TOL, `${cell}: no doc horizontal overflow (scrollWidth ${sw} <= clientWidth ${cw} + 1)`);
}

/** header.hud fully visible inside the viewport. */
async function checkHudVisible(page, cell, vw, vh) {
  const box = await page.evaluate(() => {
    const el = document.querySelector('header.hud');
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  r.ok(
    !!box &&
      box.w > 0 &&
      box.h > 0 &&
      box.x >= -TOL &&
      box.y >= -TOL &&
      box.x + box.w <= vw + TOL &&
      box.y + box.h <= vh + TOL,
    `${cell}: header.hud fully visible in ${vw}x${vh} (got ${JSON.stringify(box)})`,
  );
}

/** The current flight panel: fits the viewport; text not clipped. */
async function checkPanel(page, cell, vw, vh, station) {
  const p = await page.evaluate((n) => {
    const el = Array.from(document.querySelectorAll('section.panel')).find((s) =>
      (s.getAttribute('aria-label') || '').startsWith(`Station ${n}:`),
    );
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: b.x, y: b.y, w: b.width, h: b.height,
      scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
      overflowY: cs.overflowY,
    };
  }, station);
  if (!r.ok(!!p, `${cell}: current panel "Station ${station}" present in DOM`)) return;

  r.ok(
    p.w > 0 &&
      p.h > 0 &&
      p.x >= -TOL &&
      p.y >= -TOL &&
      p.x + p.w <= vw + TOL &&
      p.y + p.h <= vh + TOL,
    `${cell}: panel bounding box fits viewport ${vw}x${vh} (x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} w=${p.w.toFixed(1)} h=${p.h.toFixed(1)})`,
  );

  const vClipped = p.scrollHeight > p.clientHeight + TOL;
  const panelScrolls = p.overflowY === 'auto' || p.overflowY === 'scroll';
  if (vClipped && panelScrolls) {
    notes.push(
      `${cell}: panel content taller than viewport slot (scrollHeight ${p.scrollHeight} > clientHeight ${p.clientHeight}) — panel itself scrolls (overflow-y: ${p.overflowY}), the designed escape; not a failure`,
    );
  }
  r.ok(
    !vClipped || panelScrolls,
    `${cell}: panel text not vertically clipped (scrollHeight ${p.scrollHeight}, clientHeight ${p.clientHeight}, overflow-y ${p.overflowY})`,
  );
  r.ok(
    p.scrollWidth <= p.clientWidth + TOL,
    `${cell}: panel text not horizontally clipped (scrollWidth ${p.scrollWidth} <= clientWidth ${p.clientWidth} + 1)`,
  );
}

/** 390 only: every header.hud / .hudbar control offers >=42px in one dimension. */
async function checkHitTargets(page, cell) {
  const controls = await page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll('header.hud button, header.hud a, .hudbar button, .hudbar a'),
    );
    return els
      .map((el) => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          label:
            el.getAttribute('aria-label') ||
            (el.textContent || '').trim().slice(0, 40) ||
            el.tagName,
          w: b.width,
          h: b.height,
          visible: b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
        };
      })
      .filter((c) => c.visible);
  });
  if (controls.length === 0) {
    notes.push(`${cell}: no header.hud/.hudbar controls exist in this state — hit-target check vacuous`);
    return;
  }
  const small = controls.filter((c) => Math.max(c.w, c.h) < 42);
  for (const c of small) {
    console.error(`  small hit target in ${cell}: "${c.label}" ${c.w.toFixed(1)}x${c.h.toFixed(1)}`);
  }
  r.ok(
    small.length === 0,
    `${cell}: all ${controls.length} hud/hudbar controls have a >=42px hit target in at least one dimension` +
      (small.length ? ` (${small.length} too small, e.g. "${small[0].label}" ${small[0].w.toFixed(1)}x${small[0].h.toFixed(1)})` : ''),
  );
}

/** 2560 only: flight panel horizontal center within [30%, 80%] of viewport width. */
async function checkCentering(page, cell, vw, station) {
  const c = await page.evaluate((n) => {
    const el = Array.from(document.querySelectorAll('section.panel')).find((s) =>
      (s.getAttribute('aria-label') || '').startsWith(`Station ${n}:`),
    );
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return b.x + b.width / 2;
  }, station);
  const pct = c === null ? NaN : (c / vw) * 100;
  r.ok(
    c !== null && pct >= 30 && pct <= 80,
    `${cell}: panel horizontal center at ${pct.toFixed(1)}% of ${vw}px viewport (must be within [30%, 80%])`,
  );
}

async function shoot(page, w, state) {
  const path = join(SHOTS, `bp-${w}-${state}.png`);
  await page.screenshot({ path });
  shots.push(path);
}

const server = serve(PORT);
let browser;
try {
  await server.ready;
  browser = await pw.chromium.launch();
  const base = server.url;

  for (const { w, h } of WIDTHS) {
    const context = await browser.newContext({ viewport: { width: w, height: h } });
    await installGateMock(context); // BEFORE any navigation that touches Supabase
    const page = await context.newPage();

    // ---- cell: gate -------------------------------------------------------
    let cell = `${w}x${h} gate`;
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#g-code');
    await sleep(600); // entrance choreography
    await checkNoHorizontalOverflow(page, cell);
    const hasHud = await page.$('header.hud');
    if (hasHud) {
      await checkHudVisible(page, cell, w, h);
    } else {
      notes.push(`${cell}: no header.hud on the gate (HUD chrome appears only after redemption — by design); visibility check skipped`);
    }
    if (w === 390) await checkHitTargets(page, cell);
    await shoot(page, w, 'gate');

    // ---- cell: flight station 1 ------------------------------------------
    cell = `${w}x${h} flight station 1`;
    await unlock(page, base);
    await page.waitForSelector('section.panel[aria-label^="Station 1:"]');
    await sleep(900); // liftoff choreography settles
    await checkNoHorizontalOverflow(page, cell);
    await checkHudVisible(page, cell, w, h);
    await checkPanel(page, cell, w, h, 1);
    if (w === 390) await checkHitTargets(page, cell);
    if (w === 2560) await checkCentering(page, cell, w, 1);
    await shoot(page, w, 'station1');

    // ---- cell: flight station 6 via rail jump ----------------------------
    cell = `${w}x${h} flight station 6 (rail jump)`;
    await page.click('nav[aria-label="Stations"] button:nth-child(6)');
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('[aria-live="polite"]')).some((el) =>
          (el.textContent || '').includes('Station 6 of 11'),
        ),
      undefined,
      { timeout: 10000 },
    );
    await page.waitForSelector('section.panel[aria-label^="Station 6:"]');
    await sleep(SETTLE); // let the multi-station transit fully dock
    r.ok(
      await page.$eval(
        'nav[aria-label="Stations"] button:nth-child(6)',
        (b) => b.getAttribute('aria-current') === 'step',
      ),
      `${cell}: rail dot 6 is aria-current="step" after the jump`,
    );
    await checkNoHorizontalOverflow(page, cell);
    await checkHudVisible(page, cell, w, h);
    await checkPanel(page, cell, w, h, 6);
    if (w === 390) await checkHitTargets(page, cell);
    if (w === 2560) await checkCentering(page, cell, w, 6);
    await shoot(page, w, 'station6');

    // ---- cell: static mode -----------------------------------------------
    cell = `${w}x${h} static mode`;
    await page.click('header.hud button:has-text("Skip the flight")');
    await page.waitForSelector('h1:has-text("The whole mission, on one page")');
    await sleep(600);
    r.ok(
      (await page.$$eval('main section', (s) => s.length)) === 11,
      `${cell}: static mode renders 11 sections`,
    );
    await checkNoHorizontalOverflow(page, cell);
    await checkHudVisible(page, cell, w, h);
    if (w === 390) await checkHitTargets(page, cell);
    await shoot(page, w, 'static');

    await context.close();
  }

  if (notes.length) {
    console.log('notes (non-failing):');
    for (const n of notes) console.log(`  ${n}`);
  }
  console.log('screenshots:');
  for (const s of shots) console.log(`  ${s}`);

  r.done();
} catch (err) {
  console.error('breakpoints: crashed —', err);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server.kill();
}
