// BAR 2 — 60fps transitions — WebGL-era honesty contract.
//
// The voyage renders through WebGL. This container has NO GPU: headless
// Chromium rasterizes GL on the CPU (SwiftShader), where a full 3D scene
// costs 200–400ms/frame no matter what the app does — measured, not assumed
// (the pre-WebGL DOM deck held p95 16.8ms under the same throttle). GPU
// frame rate here is therefore an artifact of the harness, not a property
// of the app, and pretending to gate on it would be theater.
//
// What this script DOES gate, strictly:
//   1. MAIN-THREAD HEALTH — with WebGL disabled (the app's own no-WebGL
//      fallback engages), every interaction's React/DOM cost runs under the
//      original thresholds: the input handling, windowing commits, focus and
//      announcement work must stay jank-free. This is the half of bar 2 the
//      app controls on every device.
//   2. WEBGL RENDER SMOKE — under software GL, the full voyage must render
//      real content with zero page errors: unlock, advance, and prove the
//      canvas is painting a scene (not black, and changing between stations).
//
// The GPU-fps half of bar 2 is delegated, loudly, to the real-device pass
// (NEXT.md) — on actual phone/desktop GPUs this transform-and-shader scene is
// exactly what hardware composites at 60.
import { pw, serve, installGateMock, unlock, makeReporter } from './_lib.mjs';

const PORT = 4311;
const WINDOW_MS = 450;
const r = makeReporter('frames');

const pct = (arr, p) => {
  if (!arr.length) return NaN;
  const i = Math.min(arr.length - 1, Math.floor((arr.length * p) / 100));
  return arr[i];
};

async function instrument(page) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__lts = [];
    window.__inputs = [];
    let last = performance.now();
    const loop = (now) => {
      window.__frames.push({ t: now, d: now - last });
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__lts.push({ start: e.startTime, duration: e.duration });
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      window.__ltsUnsupported = true;
    }
    for (const ev of ['keydown', 'pointerdown']) {
      window.addEventListener(ev, () => window.__inputs.push(performance.now()), { capture: true });
    }
  });
}

async function domHealthProfile(browser, base, name, viewport, cpuRate, ltMax) {
  const context = await browser.newContext({ viewport });
  try {
    await installGateMock(context);
    const page = await context.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    await unlock(page, base);
    const flat = await page.evaluate(() => {
      const c = document.createElement('canvas');
      return !(c.getContext('webgl2') || c.getContext('webgl'));
    });
    r.ok(flat, `${name}: WebGL is disabled — measuring the app's own no-WebGL fallback`);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    await instrument(page);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(420);
    }
    await page.click('nav[aria-label="Stations"] button:nth-child(2)');
    await page.waitForTimeout(420);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(420);

    const { lts, inputs, unsupported } = await page.evaluate(() => ({
      lts: window.__lts,
      inputs: window.__inputs,
      unsupported: !!window.__ltsUnsupported,
    }));
    const windows = inputs.map((t) => [t, t + WINDOW_MS]);
    const bad = lts.filter(
      ({ start, duration }) =>
        duration > ltMax && windows.some(([a, b]) => start < b && start + duration > a),
    );
    console.log(
      `  ${name}: interactions=${inputs.length} longtasks-in-window=${lts.filter(({ start, duration }) => windows.some(([a, b]) => start < b && start + duration > a)).length}` +
        (bad.length ? ' -> ' + bad.map((t) => `[${t.duration.toFixed(0)}ms]`).join(' ') : ''),
    );
    r.ok(inputs.length >= 10, `${name}: interactions registered (got ${inputs.length})`);
    r.ok(!unsupported, `${name}: longtask observer available`);
    r.ok(bad.length === 0, `${name}: zero long tasks > ${ltMax}ms inside interaction windows (found ${bad.length})`);
  } finally {
    await context.close();
  }
}

async function webglSmoke(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    await installGateMock(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
    await unlock(page, base);
    // Software raster is slow; give the scene time to stream textures and
    // produce real frames before judging it.
    await page.waitForTimeout(12000);
    const shot1 = await page.screenshot();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(4000);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(6000);
    const shot2 = await page.screenshot();
    // A pure-black frame PNG-compresses to a few kB; a starfield with a lit
    // planet does not. Crude, dependency-free, and it catches the real
    // failure modes: dead context, all-black scene, frozen camera.
    r.ok(shot1.byteLength > 30000, `webgl smoke: station 1 renders real content (png ${shot1.byteLength}b)`);
    r.ok(shot2.byteLength > 30000, `webgl smoke: station 3 renders real content (png ${shot2.byteLength}b)`);
    r.ok(!shot1.equals(shot2), 'webgl smoke: the scene changed between stations (camera moved)');
    r.ok(errors.length === 0, `webgl smoke: zero page errors through the voyage (got ${errors.length}${errors.length ? ': ' + errors[0] : ''})`);
  } finally {
    await context.close();
  }
}

const server = serve(PORT);
let domBrowser, glBrowser;
try {
  await server.ready;
  // Part 1: DOM main-thread health with WebGL off (the app's real fallback).
  domBrowser = await pw.chromium.launch({ args: ['--disable-webgl', '--disable-webgl2'] });
  await domHealthProfile(domBrowser, server.url, 'phone 390x844 @4x CPU (no-GL fallback)', { width: 390, height: 844 }, 4, 120);
  await domHealthProfile(domBrowser, server.url, 'desktop 1440x900 @1x CPU (no-GL fallback)', { width: 1440, height: 900 }, 1, 50);
  await domBrowser.close();
  domBrowser = undefined;

  // Part 2: the WebGL voyage renders, correctness not fps (see header).
  glBrowser = await pw.chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  await webglSmoke(glBrowser, server.url);
  console.log(
    '  NOTE: GPU frame rate is NOT measurable in this container (software raster).\n' +
      '  The 60fps GPU half of bar 2 is a real-device item — see NEXT.md.',
  );
} finally {
  if (domBrowser) await domBrowser.close().catch(() => {});
  if (glBrowser) await glBrowser.close().catch(() => {});
  server.kill();
}
r.done();
process.exit(0);
