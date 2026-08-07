/* ==== SPACE — the voyage map =================================================
 *
 * Single source of truth for the 3D flight: where each station's celestial
 * body sits, where the camera docks, and what the camera looks at. Pure math
 * and pure data — the scene components render whatever this emits, so scenery
 * stays presentation and the "adding a station edits exactly one file"
 * contract holds: a 12th station gets a body from the roster automatically.
 *
 * Geometry: the voyage travels along -Z, one station every STEP units, with
 * golden-angle lateral/vertical drift so no two legs feel alike. Bodies sit
 * off to the LEFT of the flight line (DOM panels dock center-right on
 * desktop; the planet owns the left half of the frame). The sun is always
 * the final waypoint — the voyage bends sunward for the finale, which is
 * theater, not astronomy.
 * ========================================================================= */

export type Vec3 = [number, number, number];

export type BodyKind =
  | 'earth' // textured, clouds + night lights — the departure shot
  | 'moon'
  | 'mars'
  | 'asteroids' // procedural rock field, no texture
  | 'jupiter'
  | 'saturn' // textured + ring alpha
  | 'neptune'
  | 'nebula' // procedural ember-red gas field (the FIREFIGHT backdrop)
  | 'outpost' // procedural relay station built from primitives
  | 'cluster' // dense young star cluster
  | 'sun' // textured, bloom crescendo at the second-to-last station
  | 'earthReturn'; // the landing — same Earth as departure, close approach

export type Waypoint = {
  index: number;
  kind: BodyKind;
  /** World position of the celestial body (or field centre). */
  bodyPos: Vec3;
  bodyRadius: number;
  /** Camera anchor for the docked state — path3 threads through these. */
  camPos: Vec3;
  /** What the docked camera looks at — gaze path threads through these. */
  gaze: Vec3;
  /** Docked field of view; travel interpolates between neighbours. */
  fov: number;
};

const STEP = 95; // world units between stations
const PHI = 2.399963; // golden angle — non-repeating drift, same as the 2D layout

/**
 * Body roster in voyage order. Earth is pinned to the first slot and the sun
 * to the last; the middle assigns in order and cycles if the mission ever
 * outgrows it. Radii are composition choices, not astronomy.
 */
const MIDDLE_ROSTER: { kind: BodyKind; radius: number }[] = [
  { kind: 'moon', radius: 6 },
  { kind: 'mars', radius: 10 },
  { kind: 'asteroids', radius: 14 }, // field extent, not a sphere
  { kind: 'jupiter', radius: 22 },
  { kind: 'saturn', radius: 17 },
  { kind: 'neptune', radius: 13 },
  { kind: 'nebula', radius: 26 }, // field extent
  { kind: 'outpost', radius: 5 },
  { kind: 'cluster', radius: 20 }, // field extent
];

/**
 * The mission arc: depart Earth, voyage OUT past the roster, graze the sun at
 * the second-to-last station, then the final leg TURNS FOR HOME — a long
 * return flight that ends on a landing approach over a green Earth. The
 * resume's story ends where it started, which is also just the right story
 * for a "why me, why now" close.
 */
export function voyage(n: number): Waypoint[] {
  const out: Waypoint[] = [];

  for (let i = 0; i < n; i++) {
    const isReturn = n >= 3 && i === n - 1;
    const sunSlot = n >= 3 ? n - 2 : n - 1;

    const spec = isReturn
      ? { kind: 'earthReturn' as BodyKind, radius: 17 }
      : i === 0
        ? { kind: 'earth' as BodyKind, radius: 17 }
        : i === sunSlot
          ? { kind: 'sun' as BodyKind, radius: 26 }
          : (MIDDLE_ROSTER[(i - 1) % MIDDLE_ROSTER.length] as { kind: BodyKind; radius: number });

    if (isReturn) {
      // The landing: the SAME Earth the mission departed from (one body,
      // rendered once — the return waypoint reuses waypoint 0's planet). The
      // camera pulls in close over the sunlit green hemisphere; low altitude
      // plus a wide-ish fov reads as descent, not orbit.
      const first = out[0] as Waypoint;
      const bodyPos = first.bodyPos;
      const camPos: Vec3 = [bodyPos[0] + 20, bodyPos[1] + 9, bodyPos[2] + 26];
      const gaze: Vec3 = [bodyPos[0], bodyPos[1] + 2, bodyPos[2]];
      out.push({ index: i, kind: 'earthReturn', bodyPos, bodyRadius: first.bodyRadius, camPos, gaze, fov: 56 });
      continue;
    }

    // The outbound flight line: forward is -Z; drift keeps every leg unique.
    const camPos: Vec3 = [
      26 * Math.sin(i * PHI),
      9 * Math.sin(i * 1.7 + 1),
      -i * STEP,
    ];

    // Bodies sit left of and slightly beyond the dock, scaled out with their
    // radius so big planets read as vistas, not walls. The sun swings WIDE of
    // the flight line — parked on-axis it photobombed every earlier station's
    // road-ahead view (a live-site screenshot finding).
    const spread = spec.kind === 'sun' ? 58 : 24 + spec.radius * 1.35;
    const bodyPos: Vec3 = [
      camPos[0] - spread,
      camPos[1] + 4 * Math.sin(i * 1.3) + (spec.kind === 'sun' ? 8 : 0),
      camPos[2] - 26 - spec.radius * 0.8,
    ];

    // Docked gaze: mostly the body, partly the road ahead — the visitor
    // should always sense there is more voyage past this station.
    const ahead: Vec3 = [camPos[0] * 0.6, camPos[1] * 0.6, camPos[2] - STEP * 0.6];
    // Giants earn more of the frame — at the road-ahead bias Saturn shot half
    // off-screen (live-site finding).
    const gazeBias = spec.kind === 'sun' ? 0.85 : spec.radius >= 16 ? 0.72 : 0.62;
    const gaze: Vec3 = [
      bodyPos[0] * gazeBias + ahead[0] * (1 - gazeBias),
      bodyPos[1] * gazeBias + ahead[1] * (1 - gazeBias),
      bodyPos[2] * gazeBias + ahead[2] * (1 - gazeBias),
    ];

    out.push({
      index: i,
      kind: spec.kind,
      bodyPos,
      bodyRadius: spec.radius,
      camPos,
      gaze,
      fov: spec.kind === 'sun' ? 58 : spec.kind === 'earth' ? 52 : 48,
    });
  }
  return out;
}

/** How far along the leg INTO station i the continuous t is — 0 outside the
 *  leg, rising to 1 at the dock. Used to stage arrival-specific drama. */
export function legInto(n: number, target: number, t: number): number {
  if (target <= 0 || target > n - 1) return 0;
  const x = Math.min(1, Math.max(0, t - (target - 1)));
  return x * x * (3 - 2 * x);
}

/** Interpolated field of view for a continuous t — travel breathes slightly
 *  wider than the docked framing, which reads as speed. */
export function fovAt(points: Waypoint[], t: number): number {
  const n = points.length;
  if (n === 0) return 50;
  const c = Math.min(n - 1, Math.max(0, t));
  const i = Math.min(n - 2, Math.floor(c));
  const s = c - i;
  const a = (points[i] as Waypoint).fov;
  const b = (points[Math.min(i + 1, n - 1)] as Waypoint).fov;
  // Smoothstep between docked fovs plus a mid-leg widening bump.
  const ease = s * s * (3 - 2 * s);
  const bump = 5 * Math.sin(Math.PI * s);
  return a + (b - a) * ease + bump;
}

/** Sun ramp: 0 far away, 1 docked AT the sun station (n-2), easing back down
 *  across the flight home — drives the bloom swell and light temperature. */
export function sunApproach(n: number, t: number): number {
  if (n < 3) return 0;
  const sun = n - 2;
  const c = Math.min(n - 1, Math.max(0, t));
  const d = Math.abs(c - sun); // legs away from the sun dock
  const x = Math.min(1, Math.max(0, 1 - d));
  return x * x * (3 - 2 * x);
}
