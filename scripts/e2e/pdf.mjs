// BAR 8 — the PDF works from every station, every breakpoint.
//
// 1. Raw asset: fetch(base + '/resume.pdf') → 200, content-type contains
//    'pdf' OR body starts '%PDF', and > 500 bytes.
// 2. Matrix widths [390x844, 2560x1200] × states [gate (pre-unlock), flight
//    stations 1 / 6 / 11 (rail jumps), static mode]: the PDF link
//    a[download][href="/resume.pdf"] is visible — bounding box non-null,
//    fully inside the viewport (1px tolerance), and unobscured
//    (elementFromPoint at its center resolves to the link or a descendant).
// 3. At 390 the link must EXIST at every station 1..11 (rail loop) — the
//    literal bar.
// 4. Clicking the link at one representative station fires a Playwright
//    'download' event.
//
// Run: node scripts/e2e/pdf.mjs

import { pw, serve, installGateMock, unlock, makeReporter } from './_lib.mjs';

const PORT = 4316;
const SETTLE = 5600; // cinematic legs run 1.7–4.8s (homecoming longest); generous margin
const TOL = 1; // px tolerance
const WIDTHS = [
  { w: 390, h: 844 },
  { w: 2560, h: 1200 },
];
const LINK = 'a[download][href="/resume.pdf"]';

const r = makeReporter('pdf');
const notes = [];
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** All PDF links currently in the DOM, with geometry + occlusion info. */
async function linkReport(page) {
  return page.evaluate((sel) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return Array.from(document.querySelectorAll(sel)).map((el) => {
      const b = el.getBoundingClientRect();
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        x: b.x, y: b.y, w: b.width, h: b.height, vw, vh,
        nonNull: b.width > 0 && b.height > 0,
        inViewport:
          b.x >= -1 && b.y >= -1 && b.x + b.width <= vw + 1 && b.y + b.height <= vh + 1,
        unobscured: !!hit && (hit === el || el.contains(hit)),
        hitDesc: hit
          ? hit.tagName + (typeof hit.className === 'string' && hit.className ? '.' + hit.className.split(' ')[0] : '')
          : 'null',
      };
    });
  }, LINK);
}

/** Assert at least one PDF link is fully visible + unobscured in this state. */
async function checkLinkVisible(page, cell) {
  const links = await linkReport(page);
  if (!r.ok(links.length > 0, `${cell}: PDF link ${LINK} present in DOM`)) return;
  const good = links.filter((l) => l.nonNull && l.inViewport && l.unobscured);
  const detail = links
    .map(
      (l) =>
        `[x=${l.x.toFixed(1)} y=${l.y.toFixed(1)} w=${l.w.toFixed(1)} h=${l.h.toFixed(1)} vp=${l.vw}x${l.vh} inViewport=${l.inViewport} unobscured=${l.unobscured} hit=${l.hitDesc}]`,
    )
    .join(' ');
  r.ok(
    good.length > 0,
    `${cell}: PDF link visible — non-null box, fully in viewport, elementFromPoint hits link (${detail})`,
  );
}

/** Rail-jump to station n and wait for the dot to become current, then settle. */
async function railJump(page, n) {
  await page.click(`nav[aria-label="Stations"] button:nth-child(${n})`);
  await page.waitForFunction(
    (i) => {
      const dot = document.querySelector(`nav[aria-label="Stations"] button:nth-child(${i})`);
      return !!dot && dot.getAttribute('aria-current') === 'step';
    },
    n,
    { timeout: 10000 },
  );
  await page.waitForSelector(`section.panel[aria-label^="Station ${n}:"]`, { timeout: 10000 });
  await sleep(SETTLE);
}

const server = serve(PORT);
let browser;
let crashed = false;
try {
  await server.ready;
  browser = await pw.chromium.launch();
  const base = server.url;

  // ---- 1. raw asset check ------------------------------------------------
  {
    const res = await fetch(base + '/resume.pdf');
    r.ok(res.status === 200, `GET /resume.pdf → 200 (got ${res.status})`);
    const ct = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    const magic = buf.subarray(0, 5).toString('latin1');
    r.ok(
      ct.toLowerCase().includes('pdf') || magic.startsWith('%PDF'),
      `/resume.pdf is a PDF (content-type "${ct}", first bytes "${magic}")`,
    );
    r.ok(buf.byteLength > 500, `/resume.pdf byte length > 500 (got ${buf.byteLength})`);
  }

  // ---- 2–4. browser matrix -----------------------------------------------
  for (const { w, h } of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width: w, height: h },
      acceptDownloads: true,
    });
    await installGateMock(context); // BEFORE any navigation that touches Supabase
    const page = await context.newPage();

    // gate (pre-unlock)
    let cell = `${w}x${h} gate`;
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#g-code');
    await sleep(SETTLE); // entrance choreography
    await checkLinkVisible(page, cell);

    // flight station 1
    cell = `${w}x${h} flight station 1`;
    await unlock(page, base);
    await page.waitForSelector('section.panel[aria-label^="Station 1:"]');
    await sleep(900); // liftoff choreography settles
    await checkLinkVisible(page, cell);

    // flight station 6 (rail jump)
    cell = `${w}x${h} flight station 6`;
    await railJump(page, 6);
    await checkLinkVisible(page, cell);

    // flight station 11 (rail jump)
    cell = `${w}x${h} flight station 11`;
    await railJump(page, 11);
    await checkLinkVisible(page, cell);

    if (w === 390) {
      // 3. link EXISTS at every station 1..11 (loop the rail)
      const missing = [];
      for (let n = 1; n <= 11; n += 1) {
        await railJump(page, n);
        const exists = (await page.$(LINK)) !== null;
        if (!exists) missing.push(n);
      }
      r.ok(
        missing.length === 0,
        `${w}x${h}: PDF link exists at every station 1..11` +
          (missing.length ? ` (missing at: ${missing.join(', ')})` : ''),
      );

      // 4. clicking the link fires a download event (representative station 11)
      const dlPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
      await page.click(`header.hud ${LINK}`);
      const dl = await dlPromise;
      r.ok(
        dl !== null,
        `${w}x${h} station 11: clicking the HUD PDF link fires a download event` +
          (dl ? ` (suggested filename "${dl.suggestedFilename()}")` : ''),
      );
      if (dl) await dl.cancel().catch(() => {});
    }

    // static mode
    cell = `${w}x${h} static mode`;
    await page.click('header.hud button:has-text("Skip the flight")');
    await page.waitForSelector('h1:has-text("The whole mission, on one page")');
    await sleep(SETTLE);
    await checkLinkVisible(page, cell);

    await context.close();
  }

  if (notes.length) {
    console.log('notes (non-failing):');
    for (const n of notes) console.log(`  ${n}`);
  }
} catch (err) {
  console.error('pdf: crashed —', err);
  crashed = true;
} finally {
  await browser?.close().catch(() => {});
  server.kill();
}

if (crashed) process.exit(1);
r.done(); // exits 1 on recorded failures
// serve()'s SIGTERM reaches only the npx wrapper; the vite preview grandchild
// inherits the stdio pipes and would keep this event loop alive forever.
process.exit(0);
