/* ==== LAYOUT ==== */

export type Vec = { x: number; y: number };

export const MOBILE_BREAKPOINT = 768;

/*
 * 2.399 rad is the golden angle, pi * (3 - sqrt(5)). Because it is (to the
 * eye) an irrational fraction of a full turn, i * PHI never falls into a
 * short repeating cycle — every station gets a fresh drift offset instead of
 * the sawtooth you'd see with, say, PI/2. The journey reads as organic
 * wander, not a metronome.
 */
const PHI = 2.399;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/*
 * Per-station spacing along the travel axis. Exported separately so panel
 * layout can size itself to the same number the flight path uses — if these
 * ever diverged, panels would slowly slide off their stations.
 */
export function gap(vw: number, vh: number): number {
  if (vw >= MOBILE_BREAKPOINT) {
    // Roughly one station per viewport width, but clamped: the floor keeps
    // small laptops from cramming stations together, and the ceiling keeps
    // ultrawide monitors from stretching the trip into dead space.
    return clamp(0.8 * vw, 640, 1040);
  }
  // Mobile descends vertically; slightly under one viewport per station so
  // the next stop always peeks into view and invites the scroll.
  return 0.85 * vh;
}

export function stationPositions(n: number, vw: number, vh: number): Vec[] {
  const g = gap(vw, vh);
  const out: Vec[] = [];
  if (vw >= MOBILE_BREAKPOINT) {
    // Desktop travels left-to-right; the sine drift is scaled to viewport
    // height so the wander stays visible without ever leaving the screen.
    const amp = 0.18 * vh;
    for (let i = 0; i < n; i++) {
      out.push({ x: i * g, y: amp * Math.sin(i * PHI) });
    }
    return out;
  }
  // Mobile swaps the axes into a vertical descent. The lateral drift is much
  // tighter (viewport-width scaled) because horizontal room is scarce and
  // panels need most of it.
  const amp = 0.06 * vw;
  for (let i = 0; i < n; i++) {
    out.push({ x: amp * Math.sin(i * PHI), y: i * g });
  }
  return out;
}
