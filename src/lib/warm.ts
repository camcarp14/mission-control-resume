/* ==== THE WARM-UP — what the gate does with the time it is already spending ==
 *
 * MEASURED, on a production build, with a 2.5s idle window at the gate:
 * FOUR requests before the button is pressed (the document, the entry chunk,
 * react, the stylesheet) and 2.65 MB across sixteen requests after it, every
 * byte of it serialized behind the click:
 *
 *     +50ms   supabase chunk        214 kB   <- blocks begin_visit
 *     +81ms   begin_visit RPC                <- blocks the flight chunk
 *     +98ms   Flight chunk        1,280 kB   <- blocks every texture below
 *     +288ms  ...11 textures + the HDRI + the display face, 1.15 MB
 *
 * On localhost that reads as 600ms. On the 4G a recruiter opens a LinkedIn
 * link over it is the better part of ten seconds, spent on a pre-flight
 * console whose bar is honestly pinned at zero because nothing it can measure
 * has started yet. And the whole time it costs, the gate screen — fully
 * painted, four requests deep — is doing nothing at all.
 *
 * So it does this instead. Three waves, after first paint, at idle, in the
 * order the click will need them.
 *
 * WHY THIS DOES NOT COST FIRST PAINT. Everything below is reached through a
 * runtime `import()` or a runtime element, never a static import, so the
 * module graph vite.config.ts guards is untouched: `dist/index.html` still
 * modulepreloads exactly one chunk (react), and the entry stays Framer-free,
 * Supabase-free and three.js-free. That guard has been tripped twice in this
 * repo's history — both times by a manualChunks entry, both times worth
 * ~1.4s of FCP — so it is asserted rather than trusted (see budget.mjs).
 *
 * WHY IT IS SAFE TO WARM THE FLIGHT CHUNK. It was not, once. When the splash
 * was a gate with an access code, "the content chunk is not even fetched
 * until a code redeems" was a real lock and the browser bar tested it. Round
 * 23 opened that door: there is no code, both fields are optional, and
 * "Begin the flight" works on an empty form — begin_visit is attribution, not
 * authorization. A chunk any visitor obtains by pressing a button with a
 * blank form is not being protected by arriving two seconds later; it is only
 * arriving two seconds later. What still IS load-bearing is that the flight
 * never RENDERS without a server-minted token, and that is a property of
 * gate/Experience.tsx, not of when bytes land in a cache — scripts/e2e/
 * gate-breach.mjs tests exactly that, and still does.
 *
 * WHAT IT WILL NOT DO. `saveData`, `slow-2g` and `2g` skip the whole thing.
 * A visitor on a metered or genuinely slow connection gets the behaviour this
 * module replaced, byte for byte, because for them the trade actually is a
 * trade.
 * ========================================================================= */

import { prefetchSupabase } from './gate';
import { ENV_PRESENT, OFFLINE_DEV } from './supabase';

/**
 * Everything the first flight needs off the network that is not JavaScript.
 * All of it is fetched by the scene on EVERY visit — the pre-flight console's
 * `loaded/total` counter is these files — so nothing here is speculative.
 *
 * `kind` says which mechanism warms it, and the split is narrower than it
 * looks — the first pass used <img> for the textures on the theory that
 * matching three's own ImageLoader byte for byte was the surest cache hit. It
 * is not, and it is measurably worse: an <img> that nothing references is
 * eligible for collection the moment the warm loop ends, taking its memory-
 * cache entry with it, and keeping it alive instead would mean holding eleven
 * DECODED bitmaps — tens of megabytes of RAM to save a megabyte of transfer.
 * `fetch` costs a transient ArrayBuffer, decodes nothing, and lands the bytes
 * in the HTTP cache where a later CORS-mode <img> request finds them (checked
 * directly in a browser, not assumed).
 *
 *   binary  fetched with credentials: 'same-origin' — three's own FileLoader
 *           setting, and the one that also serves the texture loads
 *   font    the CSS Font Loading API, which sidesteps the cache question
 *           entirely by putting the face in the document's font set
 *
 * warm.test.ts asserts this list is EXACTLY the set of media paths referenced
 * anywhere under src/ — so a renamed texture fails a test instead of quietly
 * warming a 404 while the real file arrives cold.
 */
export type WarmAsset = { href: string; kind: 'binary' | 'font' };

export const WARM_MEDIA: readonly WarmAsset[] = [
  // The display face first: it is 27 kB and it is the hero's own name. Left
  // cold it arrives ~400ms into the flight and the identity moment — the one
  // frame this whole site is built around — swaps typeface on camera.
  { href: '/fonts/SpaceGrotesk.woff2', kind: 'font' },
  // Then the opening shot, in the order the eye meets it.
  { href: '/hdri/dikhololo_night_1k.hdr', kind: 'binary' },
  { href: '/textures/4k_earth_daymap.webp', kind: 'binary' },
  { href: '/textures/4k_earth_clouds.webp', kind: 'binary' },
  { href: '/textures/4k_earth_nightmap.webp', kind: 'binary' },
  { href: '/textures/6k_stars_milky_way.webp', kind: 'binary' },
  // Then the rest of the roster, in voyage order.
  { href: '/textures/2k_moon.webp', kind: 'binary' },
  { href: '/textures/2k_mars.webp', kind: 'binary' },
  { href: '/textures/2k_jupiter.webp', kind: 'binary' },
  { href: '/textures/2k_saturn.webp', kind: 'binary' },
  { href: '/textures/2k_saturn_ring_alpha.png', kind: 'binary' },
  { href: '/textures/2k_neptune.webp', kind: 'binary' },
  { href: '/textures/4k_sun.webp', kind: 'binary' },
] as const;

/** The face the hero sets its name in, at the weight and size polish.css
 *  actually renders. `document.fonts.load` needs a real font shorthand, and a
 *  weight outside the loaded range would quietly resolve to nothing. */
const DISPLAY_FONT = '700 92px "Space Grotesk"';

/**
 * Is this a connection we are allowed to spend on? Only POSITIVE evidence of
 * a bad one stops the warm-up — `navigator.connection` does not exist in
 * Safari or Firefox at all, and treating "no answer" as "slow" would mean
 * warming nothing for most of the visitors on the fastest machines. Same
 * asymmetry, and the same reasoning, as flight3d/quality.ts's detectTier.
 */
function connectionAllowsWarming(): boolean {
  const conn = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (!conn) return true;
  if (conn.saveData === true) return false;
  return conn.effectiveType !== 'slow-2g' && conn.effectiveType !== '2g';
}

/** Run at the browser's convenience, but never later than `timeout` — an
 *  idle callback with no bound can be starved indefinitely on a busy thread,
 *  which is the one case where the visitor most needs this to have happened. */
function onIdle(fn: () => void, timeout: number): void {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout });
  else window.setTimeout(fn, Math.min(timeout, 300));
}

/** How many media files are in the air at once.
 *
 *  Not one, and not thirteen. One serializes thirteen round trips, which on
 *  the 4G link this is all for is a couple of seconds of pure latency added to
 *  a wave the visitor may interrupt at any moment. Thirteen is a burst. Four
 *  keeps the pipe full over one multiplexed HTTP/2 connection while the
 *  transient ArrayBuffers stay bounded — the largest file here is 418 kB, and
 *  four of those at once is the ceiling this number is really setting. */
const MEDIA_CONCURRENCY = 4;

async function warmOne(asset: WarmAsset): Promise<void> {
  try {
    if (asset.kind === 'font') {
      if (document.fonts?.load) await document.fonts.load(DISPLAY_FONT);
      return;
    }
    // credentials: 'same-origin' is three's own FileLoader setting, and
    // `priority: 'low'` (ignored where unsupported) keeps a megabyte of
    // scenery behind anything the visitor actually asked for.
    const res = await fetch(asset.href, {
      credentials: 'same-origin',
      priority: 'low',
    } as RequestInit);
    // The body has to be drained for the response to settle into the cache;
    // the buffer itself is immediately garbage.
    await res.arrayBuffer();
  } catch {
    // A warm-up that throws is worse than a warm-up that did not happen.
  }
}

async function warmMedia(): Promise<void> {
  // A shared cursor rather than a chunked split, so a slow file cannot leave
  // one worker holding the last three while the others idle.
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      // Re-checked before every file, not once at the top. This wave is the
      // only one that can DUPLICATE work rather than share it: waves 1 and 2
      // hand back the same promise the click would have made (getSupabase
      // memoises its client, and a second import() of the flight chunk joins
      // the first), but these are bare URLs, and a warm request still in
      // flight when the scene asks for the same file is a second full
      // download of it. Once the visitor has committed, the real loaders own
      // the media.
      if (stoodDown) return;
      const asset = WARM_MEDIA[next++];
      if (!asset) return;
      await warmOne(asset);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MEDIA_CONCURRENCY, WARM_MEDIA.length) }, worker),
  );
}

let started = false;
let stoodDown = false;

/**
 * Stop warming: the visitor has committed and the flight's own loaders are
 * about to ask for the same files. Called from the gate's submit handler,
 * which is the exact moment — not from an unlock effect, which is a render
 * later and a whole network round trip after the decision was made.
 */
export function standDownWarming(): void {
  stoodDown = true;
}

/**
 * Warm what the button is about to need. Idempotent, non-blocking, and safe
 * to call from a render-adjacent effect: everything it does is scheduled.
 *
 * The waves are SEQUENTIAL and in dependency order, not fired together. The
 * click's critical path is supabase → begin_visit → flight chunk → media, and
 * warming them in that order means a visitor who presses the button early
 * still finds the earliest thing they need already in hand. Firing all three
 * at once would put 1.15 MB of texture in front of the 214 kB the click
 * actually blocks on.
 */
export function warmForFlight(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (!connectionAllowsWarming()) return;
  // A production deploy with no Supabase env fails closed: the gate renders a
  // configuration error and no visitor reaches the flight, so there is nothing
  // to warm and 2.4 MB would be spent proving it.
  if (!ENV_PRESENT && !OFFLINE_DEV) return;

  // Wave 1 — the SDK the click blocks on. Short leash: on a slow thread this
  // is the one wave that must not be late.
  onIdle(() => {
    prefetchSupabase();

    // Wave 2 — the flight itself, 1.28 MB and the gate on everything below
    // it. The same module specifier gate/Experience.tsx lazily imports, so a
    // click landing mid-download joins this promise rather than starting a
    // second one.
    onIdle(() => {
      void import('../flight/Flight').then(
        () => onIdle(() => void warmMedia(), 4000), // Wave 3 — see WARM_MEDIA.
        () => {
          // A failed warm is not a failed flight: Experience.tsx's import
          // will try again behind its own error boundary, which is the one
          // that can actually offer the visitor a way out.
        },
      );
    }, 2000);
  }, 1000);
}
