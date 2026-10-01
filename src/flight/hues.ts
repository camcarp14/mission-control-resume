import { voyage, type BodyKind } from '../engine';
import { stations } from '../content/stations.js';

/**
 * Each station's accent, taken from the body the ship docks at — the lobby's
 * per-panel hues (amber, cyan, ember), carried into the flight so the chrome
 * answers the planet instead of being the same cyan at Mars and at the sun.
 * RGB triples, consumed as rgba(var(--hue), a) in polish.css (FLIGHT ACCENTS).
 *
 * Read off voyage(), the same roster the 3D scene builds, so adding or
 * reordering stations re-colours the chrome to match the sky automatically.
 */
const HUE: Record<BodyKind, string> = {
  earth: '76,201,240', // the blue marble
  moon: '196,210,230', // regolith silver
  mars: '255,112,67', // rust
  asteroids: '222,178,120', // dusty stone
  jupiter: '255,181,71', // banded amber
  saturn: '240,206,130', // ring gold
  neptune: '96,146,255', // deep methane blue
  nebula: '255,92,108', // the ember-red gas field
  outpost: '94,234,212', // nav-light teal
  cluster: '150,200,255', // hot young stars
  sun: '255,150,60', // photosphere
  earthReturn: '110,231,160', // the green landing
};

const FALLBACK = '76,201,240';

const KINDS: BodyKind[] = voyage(stations.length).map((w) => w.kind);

/** One hue per station, index-aligned with stations.js. */
export const STATION_HUES: string[] = KINDS.map((k) => HUE[k] ?? FALLBACK);

export const hueAt = (i: number): string => STATION_HUES[i] ?? FALLBACK;

/** The class that lights station i's panel (see HUE_CSS). */
export const hueClass = (i: number): string => `hue-${KINDS[i] ?? 'earth'}`;

/**
 * The panel surface in each planet's colour, as LITERAL rules — one block per
 * body kind, generated once and mounted by Flight in a <style>.
 *
 * Literal, not rgba(var(--hue), …), and that is a performance decision, not a
 * style one. The surface sits on the element Framer Motion writes transform
 * and opacity to every frame, so its style is recalculated every frame — and
 * a value containing var() is re-substituted and re-parsed on every recalc.
 * Seven var()-built gradients and shadows on that element measured +75% style
 * recalc per leg (dev build, 4x CPU throttle) and read as lag. Written out per
 * kind, the values parse once, when this stylesheet loads.
 */
export const HUE_CSS = (Object.entries(HUE) as [BodyKind, string][])
  .map(([kind, rgb]) => {
    const c = (a: number) => `rgba(${rgb}, ${a})`;
    const w = `.panelwrap.hue-${kind}`;
    return `
${w} :has(> .panel) { border-top-color: ${c(0.5)}; box-shadow: 0 -1px 24px ${c(0.1)}, 0 14px 44px rgba(0, 0, 0, 0.5); }
${w} :has(> .panel.lit) {
  background: radial-gradient(140% 84% at 50% -6%, ${c(0.11)}, ${c(0)} 62%), linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0) 34%), #0d0f13;
  box-shadow: inset 0 1px 0 ${c(0.34)}, 0 -1px 28px ${c(0.12)}, 0 2px 8px rgba(0, 0, 0, 0.45), 0 22px 60px rgba(0, 0, 0, 0.62);
}
${w} .panel {
  background:
    linear-gradient(#0d0f13 62%, rgba(13, 15, 19, 0)) top / 100% 1.25rem no-repeat local,
    linear-gradient(rgba(13, 15, 19, 0), #0d0f13 38%) bottom / 100% 1.625rem no-repeat local,
    linear-gradient(${c(0.34)}, ${c(0.12)} 42%, ${c(0)}) top / 100% 0.875rem no-repeat,
    linear-gradient(${c(0)}, ${c(0.12)} 58%, ${c(0.34)}) bottom / 100% 1rem no-repeat;
  scrollbar-color: ${c(0.45)} transparent;
}
${w} .stn-dot { border-color: ${c(0.8)}; background: ${c(0.35)}; box-shadow: 0 0 10px ${c(0.7)}; }`;
  })
  .join('\n');
