/* ==== STARFIELD ==== */

/*
 * Mulberry32: tiny, fast, and — unlike Math.random — seeded, so the same
 * spec always renders the same sky. That determinism is what lets the tests
 * assert exact output strings and lets a re-render never "reshuffle the
 * stars" under the visitor.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type StarLayerSpec = {
  seed: number;
  count: number;
  size: number;
  minR: number;
  maxR: number;
  opacity: [number, number];
};

/*
 * Two-decimal rounding keeps the data URI compact (full doubles would triple
 * its size), but rounding alone can nudge a value a few thousandths past its
 * bound — so we clamp after rounding to keep the invariants below honest.
 */
function fmt(v: number, lo: number, hi: number): string {
  const rounded = Math.round(v * 100) / 100;
  return String(rounded < lo ? lo : rounded > hi ? hi : rounded);
}

/*
 * Renders one tileable star layer as an SVG data URI for background-image
 * with background-repeat. Greyscale white only — the starfield is telemetry
 * chrome, and any hue here would compete with the mission-control accents.
 */
export function starLayerDataUri(spec: StarLayerSpec): string {
  const { count, size, minR, maxR } = spec;
  const [opLo, opHi] = spec.opacity;
  const rand = mulberry32(spec.seed);

  // Wrap safety: centres are confined to [maxR, size - maxR] so no star can
  // touch a tile edge. Chosen over duplicating edge stars into the opposite
  // margin because it needs no bookkeeping and the field is sparse enough
  // that a star-free border a couple of pixels wide is imperceptible —
  // whereas a half-clipped star repeats at every seam and is instantly
  // visible once the tile wraps.
  const span = Math.max(0, size - 2 * maxR);

  let circles = '';
  for (let i = 0; i < count; i++) {
    const cx = fmt(maxR + rand() * span, maxR, size - maxR);
    const cy = fmt(maxR + rand() * span, maxR, size - maxR);
    const r = fmt(minR + rand() * (maxR - minR), minR, maxR);
    const o = fmt(opLo + rand() * (opHi - opLo), Math.min(opLo, opHi), Math.max(opLo, opHi));
    circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" fill-opacity="${o}"/>`;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}">${circles}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
