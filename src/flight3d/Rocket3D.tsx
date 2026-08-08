/* ==== ROCKET 3D — the hero prop ==============================================
 *
 * A Millennium-Falcon-style light freighter built entirely from primitives and
 * canvas textures. Fidelity pass — what actually makes the Falcon read:
 *
 *   SILHOUETTE  the hull is not a smooth saucer: a flattened crown and belly
 *               with a pronounced edge-on RIM BAND, and a top-view outline
 *               that is a circle INTERRUPTED three ways — the mandible fork
 *               forward, the cockpit corridor starboard-forward, and two
 *               engine-deck cutouts flanking the stern band. The cutouts are
 *               real geometry: the hull lathe is built as four arcs (stern
 *               deck, main arc, two short-radius cutout arcs) with their UVs
 *               remapped so the one hull texture still wraps continuously.
 *   MANDIBLES   wide, flat, BLUNT-ENDED prongs (squared tips, not spikes) that
 *               flare off the hull with a deep U notch between them — 0.60
 *               wide, 0.81 deep. Stepped inner faces, raised dorsal spines.
 *   COCKPIT     starboard, forward: a ribbed corridor that visibly LEAVES the
 *               hull before the pod, and a flat-topped canopy of exactly five
 *               trapezoid panes (a 5-facet frustum sector) in a dark frame.
 *   FURNITURE   quad-laser turret bumps top AND bottom centre, sensor dish
 *               offset port-forward, boarding-ramp plate under the front.
 *   CLUTTER     dense merged greeble banks across the rear deck either side of
 *               the engine band, plus conduit runs radiating from the core.
 *   ENGINE      the blue strip, inset into a dark recessed housing framed by
 *               deck lips above and below and by the two cutouts outboard.
 *
 * Everything static is MERGED into five buffers (hull / grey / mid / dark /
 * gear) so the whole freighter is a handful of draw calls.
 *
 * Contract: renders at local origin, nose (mandibles) along local -Z. Envelope
 * z in [-2.2, +2.2] (mandible tips exactly -2.2, engine lip 2.145), x within
 * +-1.95, y in [-1.0, +1.1]. The PARENT drives position/quaternion/scale.
 *
 * LANDING GEAR: gearRef.current is 0 = fully retracted (in flight) .. 1 =
 * fully deployed (landed). At 1 every pad sole sits at EXACTLY local y = -1.0
 * — the plane the finale stands the craft on. At 0 the legs are tucked and the
 * whole gear group is .visible = false; the belly bay doors close flush.
 *
 * thrustRef is 0..1 (may spike ~1.2); `reduced` gates every continuous
 * animation (band flicker, dish sweep, trail) — value-tracking state (glow
 * intensity, sprite scale, GEAR POSE) still follows its ref.
 * ========================================================================= */

import * as THREE from 'three';
import { forwardRef, useEffect, useMemo, useRef } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../engine';

const TAU = Math.PI * 2;

/* Hyperdrive palette — wash, not fire. */
const HYPER_CORE = '#7db8ff';
const HYPER_HOT = '#b9dcff';

/* ---- build-time geometry helpers -------------------------------------------
 * Everything below runs ONCE at module load. `put` normalises to non-indexed
 * (mergeGeometries refuses a mixed batch) and bakes a transform in; `bake`
 * collapses a bucket into a single buffer and drops the intermediates.
 */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

function trs(
  px: number,
  py: number,
  pz: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    _v.set(px, py, pz),
    _q.setFromEuler(_e.set(rx, ry, rz)),
    _s.set(sx, sy, sz),
  );
}

function mul(a: THREE.Matrix4, b: THREE.Matrix4): THREE.Matrix4 {
  return new THREE.Matrix4().multiplyMatrices(a, b);
}

function put(out: THREE.BufferGeometry[], geo: THREE.BufferGeometry, m?: THREE.Matrix4): void {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (m) g.applyMatrix4(m);
  out.push(g);
}

function bake(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged: THREE.BufferGeometry | null = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged ?? new THREE.BufferGeometry();
}

/** Axis-aligned box helper (the greeble workhorse), optional yaw. */
function box(
  out: THREE.BufferGeometry[],
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  ry = 0,
): void {
  put(out, UNIT_BOX, trs(x, y, z, 0, ry, 0, sx, sy, sz));
}

/* ---- hull profile ----------------------------------------------------------
 * Half-height of the top shell at radius fraction u. Flat crown out to u=0.34,
 * two straight conic breaks, then a near-flat shoulder into the rim band. The
 * bottom mirrors it: the Falcon is a flattened plate, not a lens.
 */
/* Hull disc 3.24 across against a 4.4 overall length — the real ship's 1.36:1
 * length:beam — and its centre pushed AFT so the mandible notch reads deep. */
const DISC_R = 1.62;
const DISC_CZ = 0.4;
const DISC_N = 14; // profile samples per shell

/** Rim band: a near-vertical wrap 0.25 tall with a faint equator bulge. */
const RIM_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [DISC_R + 0.006, -0.098],
  [DISC_R + 0.02, -0.046],
  [DISC_R + 0.022, 0.046],
  [DISC_R + 0.006, 0.098],
];
const DISC_LAST = DISC_N * 2 + RIM_PROFILE.length + 1; // last profile index

function discY(u: number): number {
  if (u <= 0.34) return 0.33; // flat crown
  if (u <= 0.72) return 0.33 - 0.095 * ((u - 0.34) / 0.38); // shallow slope
  if (u <= 0.955) return 0.235 - 0.103 * ((u - 0.72) / 0.235); // steeper break
  return 0.132 - 0.007 * ((u - 0.955) / 0.045); // rim shoulder
}

/** Surface height of the hull at a ship-space (x, z) — greebles ride on it. */
function surfaceY(x: number, z: number): number {
  const r = Math.hypot(x, z - DISC_CZ);
  return discY(Math.min(1, r / DISC_R));
}

/**
 * Closed lathe profile out to radius fraction uMax. At uMax = 1 it ends in the
 * real rim band; short of that it ends in a rounded edge cap — that cap is the
 * inner face of an engine-deck cutout.
 */
function discProfileTo(uMax: number): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= DISC_N; i++) {
    const u = (i / DISC_N) * uMax;
    pts.push(new THREE.Vector2(Math.max(0.001, u * DISC_R), -discY(u)));
  }
  if (uMax > 0.999) {
    for (const [r, y] of RIM_PROFILE) pts.push(new THREE.Vector2(r, y));
  } else {
    const rE = uMax * DISC_R;
    const hE = discY(uMax);
    pts.push(new THREE.Vector2(rE + 0.006, -hE * 0.74));
    pts.push(new THREE.Vector2(rE + 0.014, -hE * 0.3));
    pts.push(new THREE.Vector2(rE + 0.014, hE * 0.3));
    pts.push(new THREE.Vector2(rE + 0.006, hE * 0.74));
  }
  for (let i = DISC_N; i >= 0; i--) {
    const u = (i / DISC_N) * uMax;
    pts.push(new THREE.Vector2(Math.max(0.001, u * DISC_R), discY(u)));
  }
  return pts;
}

/**
 * One arc of the hull. LatheGeometry hands back u = i/segments over the arc's
 * OWN sweep, so we remap it onto the arc's true share of the circle — that is
 * what lets four separate arcs share one seamless wrapped hull texture.
 * phi = 0 is +Z (the stern), matching CylinderGeometry's theta.
 */
function makeDiscArc(
  uMax: number,
  phiStart: number,
  phiLength: number,
  segs: number,
): THREE.BufferGeometry {
  const g: THREE.BufferGeometry = new THREE.LatheGeometry(
    discProfileTo(uMax),
    segs,
    phiStart,
    phiLength,
  );
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const u0 = phiStart / TAU;
  const du = phiLength / TAU;
  for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * du);
  uv.needsUpdate = true;
  g.translate(0, 0, DISC_CZ);
  return g;
}

/* Cutout sweep: inboard edge of each bite at CUT_A, outboard at CUT_B, and the
 * hull only reaches CUT_U of full radius inside them. */
const CUT_A = 0.7;
const CUT_B = 1.06;
const CUT_U = 0.76;

const HULL_GEO = ((): THREE.BufferGeometry => {
  const parts: THREE.BufferGeometry[] = [];
  put(parts, makeDiscArc(1, -CUT_A, CUT_A * 2, 22)); // stern engine deck
  put(parts, makeDiscArc(1, CUT_B, TAU - CUT_B * 2, 64)); // main body arc
  put(parts, makeDiscArc(CUT_U, CUT_A, CUT_B - CUT_A, 6)); // starboard cutout
  put(parts, makeDiscArc(CUT_U, -CUT_B, CUT_B - CUT_A, 6)); // port cutout
  return bake(parts);
})();

/** Flat cross-section of the hull between the cutout radius and the rim — the
 *  wall that closes each cutout's open lathe edge. Rendered double-sided. */
function cutoutWallShape(): THREE.Shape {
  const s = new THREE.Shape();
  const step = (1 - CUT_U) / 6;
  s.moveTo(CUT_U * DISC_R, -discY(CUT_U));
  for (let i = 1; i <= 6; i++) {
    const u = CUT_U + step * i;
    s.lineTo(u * DISC_R, -discY(u));
  }
  for (const [r, y] of RIM_PROFILE) s.lineTo(r, y);
  for (let i = 6; i >= 0; i--) {
    const u = CUT_U + step * i;
    s.lineTo(u * DISC_R, discY(u));
  }
  s.closePath();
  return s;
}
const CUT_WALL_GEO = new THREE.ShapeGeometry(cutoutWallShape());

/* ---- hull texture ----------------------------------------------------------
 * Lathe UVs: u wraps the azimuth (canvas x -> radial seams), v runs along the
 * profile (canvas y -> ring seams at constant radius, mirrored across the rim
 * band in the middle of the canvas). Light warm grey, panel grid, darker
 * patches, rust hints, scorch streaks, greeble dots — lived-in.
 */
let hullCache: THREE.CanvasTexture | null = null;
function hullTexture(): THREE.CanvasTexture {
  if (hullCache) return hullCache;
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  // 2d context only fails where WebGL could not have rendered either.
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const rand = mulberry32(0x0fa1c02);

  // v(profile index) -> canvas y, for a ring at radius fraction u on each shell.
  const topY = (u: number): number => ((DISC_N * u) / DISC_LAST) * S;
  const botY = (u: number): number => S - ((DISC_N * u) / DISC_LAST) * S;

  ctx.fillStyle = '#b8bcc0';
  ctx.fillRect(0, 0, S, S);

  // Soft tonal mottling under everything.
  for (let i = 0; i < 170; i++) {
    const g = 140 + Math.floor(rand() * 80);
    ctx.fillStyle = `rgba(${g}, ${g + 3}, ${g + 6}, ${(0.04 + rand() * 0.07).toFixed(3)})`;
    ctx.fillRect(rand() * S, rand() * S, 14 + rand() * 90, 8 + rand() * 60);
  }

  const SECTORS = 24;
  const secW = S / SECTORS;
  const RING_US = [0.14, 0.28, 0.42, 0.56, 0.7, 0.84, 0.97];

  // Darker replacement panels snapped to the seam grid, both shells.
  for (let i = 0; i < 58; i++) {
    const bi = Math.floor(rand() * (RING_US.length - 1));
    const u1 = RING_US[bi] ?? 0.2;
    const u2 = RING_US[bi + 1] ?? 0.9;
    const x = Math.floor(rand() * SECTORS) * secW;
    const w = (rand() < 0.3 ? 2 : 1) * secW;
    const topHalf = rand() < 0.62;
    const ya = topHalf ? topY(u1) : botY(u2);
    const yb = topHalf ? topY(u2) : botY(u1);
    const roll = rand();
    ctx.fillStyle =
      roll < 0.16
        ? 'rgba(160, 136, 95, 0.30)' // #a0885f rust hint
        : roll < 0.5
          ? 'rgba(142, 146, 150, 0.55)' // #8e9296 darker plate
          : 'rgba(170, 174, 178, 0.6)';
    ctx.fillRect(x + 2, Math.min(ya, yb) + 2, w - 4, Math.abs(yb - ya) - 4);
  }

  // Scorch streaks near the rim — decades of hard flying.
  for (let i = 0; i < 14; i++) {
    const x = rand() * S;
    const topHalf = rand() < 0.5;
    const y0 = topHalf ? topY(0.68) : botY(0.97);
    const y1 = topHalf ? topY(0.97) : botY(0.68);
    ctx.fillStyle = `rgba(92, 84, 70, ${(0.06 + rand() * 0.09).toFixed(3)})`;
    ctx.fillRect(x, Math.min(y0, y1), 5 + rand() * 10, Math.abs(y1 - y0));
  }

  // Radial seams (constant u = spokes), heavier every 4th.
  for (let i = 0; i < SECTORS; i++) {
    ctx.strokeStyle = i % 4 === 0 ? 'rgba(48, 54, 62, 0.34)' : 'rgba(48, 54, 62, 0.2)';
    ctx.lineWidth = i % 4 === 0 ? 3 : 2;
    const x = i * secW;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, S);
    ctx.stroke();
  }

  // Ring seams mirrored on both shells.
  ctx.strokeStyle = 'rgba(48, 54, 62, 0.28)';
  ctx.lineWidth = 2;
  for (const u of RING_US) {
    for (const y of [topY(u), botY(u)]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(S, y);
      ctx.stroke();
    }
  }

  // Rim band: darker wrap with vent ticks.
  const rimA = topY(1);
  const rimB = botY(1);
  ctx.fillStyle = 'rgba(104, 110, 118, 0.4)';
  ctx.fillRect(0, rimA, S, rimB - rimA);
  ctx.fillStyle = 'rgba(40, 46, 54, 0.35)';
  for (let i = 0; i < 64; i++) {
    if (rand() < 0.35) continue;
    ctx.fillRect(i * 16 + 5, rimA + 8 + rand() * 32, 6, 30 + rand() * 26);
  }

  // Dense machine clutter painted along the outer decks, both shells — the
  // Falcon's charm is that nothing out there is a clean surface.
  for (let i = 0; i < 300; i++) {
    const topHalf = rand() < 0.5;
    const u = 0.5 + rand() * 0.45;
    const y = topHalf ? topY(u) : botY(u);
    const x = rand() * S;
    ctx.fillStyle = `rgba(60, 66, 76, ${(0.1 + rand() * 0.24).toFixed(3)})`;
    ctx.fillRect(x, y, 3 + rand() * 16, 2 + rand() * 7);
  }

  // Greeble dots and short ticks scattered everywhere.
  for (let i = 0; i < 240; i++) {
    const x = rand() * S;
    const y = rand() * S;
    ctx.fillStyle = `rgba(52, 57, 66, ${(0.14 + rand() * 0.28).toFixed(3)})`;
    if (rand() < 0.7) {
      ctx.beginPath();
      ctx.arc(x, y, 1.2 + rand() * 2.4, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, 3 + rand() * 12, 2 + rand() * 3);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  hullCache = tex;
  return tex;
}

/* ---- cockpit canopy texture ------------------------------------------------
 * Near-black glaze in a pale frame. The canopy is a FIVE-segment frustum
 * sector, so its u splits into exactly five equal facets: put a mullion on
 * every fifth of the canvas and each facet becomes one trapezoid pane.
 */
let canopyCache: THREE.CanvasTexture | null = null;
function canopyTexture(): THREE.CanvasTexture {
  if (canopyCache) return canopyCache;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  // Dark frame everywhere, glass punched into it.
  ctx.fillStyle = '#2b3038';
  ctx.fillRect(0, 0, S, S);
  const pane = S / 5;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = '#0e1218';
    ctx.fillRect(i * pane + 7, 30, pane - 14, S - 74);
  }
  const sheen = ctx.createLinearGradient(0, 0, 0, S);
  sheen.addColorStop(0, 'rgba(150, 190, 230, 0.16)');
  sheen.addColorStop(0.45, 'rgba(150, 190, 230, 0.03)');
  sheen.addColorStop(1, 'rgba(150, 190, 230, 0.1)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 30, S, S - 74);

  // Mullions on the facet boundaries + top/bottom frame rails.
  ctx.strokeStyle = 'rgba(168, 176, 188, 0.9)';
  ctx.lineWidth = 5;
  for (let i = 0; i <= 5; i++) {
    const x = i * pane;
    ctx.beginPath();
    ctx.moveTo(x, 24);
    ctx.lineTo(x, S - 40);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(150, 158, 170, 0.85)';
  ctx.fillRect(0, 20, S, 10);
  ctx.fillRect(0, S - 50, S, 12);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  canopyCache = tex;
  return tex;
}

/* Radial glow sprite texture: white-hot core through hyperdrive blue. */
let glowCache: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
  if (glowCache) return glowCache;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  g.addColorStop(0.25, 'rgba(185, 220, 255, 0.62)');
  g.addColorStop(0.6, 'rgba(125, 184, 255, 0.22)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  glowCache = tex;
  return tex;
}

/* ---- mandibles -------------------------------------------------------------
 * Flat slabs in the (x, z) plane, 0.28 thick, roots buried in the hull at
 * z = -1.02 and tips SQUARED OFF at exactly z = -2.20. Inner faces are
 * parallel at x = +-0.30, so the U notch is 0.60 wide; the hull's front edge
 * sits at z = -1.393, making the notch 0.807 deep — deeper than it is wide,
 * which is the proportion that reads.
 *
 * Shape space: sx = ship x, sy = ship -z (so +sy is forward). NOTE three's
 * extrude bevel pushes the MID section out by bevelSize and leaves the caps on
 * the contour, so the outline is authored 0.02 shy of where it must land.
 */
const MANDIBLE_PTS: ReadonlyArray<readonly [number, number]> = [
  [0.3, 0.8],
  [1.04, 0.8],
  [1.0, 1.12],
  [0.9, 1.52],
  [0.855, 1.99],
  [0.83, 2.09],
  [0.76, 2.16],
  [0.38, 2.16],
  [0.3, 2.08],
];

function makeMandibleGeometry(side: 1 | -1): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  const pts = side === 1 ? MANDIBLE_PTS : [...MANDIBLE_PTS].reverse();
  pts.forEach(([x, y], i) => {
    if (i === 0) s.moveTo(x * side, y);
    else s.lineTo(x * side, y);
  });
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.24,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 1,
  });
  g.translate(0, 0, -0.12); // centre the 0.28 total thickness on z = 0
  g.rotateX(-Math.PI / 2); // (sx, sy, d) -> (x, y, -z): +sy becomes forward
  return g;
}

/* ---- engine housing --------------------------------------------------------
 * The band is INSET: a dark back wall and grille bars sit at r 1.735-1.82, the
 * emissive core at r 1.80, and deck lip rings reach out to r 1.865 above and
 * below — so the glow reads as recessed under a lip, framed outboard by the
 * two engine-deck cutouts. Rear-most solid: DISC_CZ + 1.865 = 2.145.
 */
const BAND_HALF = 0.6;
const HOUSE_HALF = 0.665;
const ENG_R_BACK = 1.655;
const ENG_R_CORE = 1.72;
const ENG_R_HOT = 1.745;
const ENG_R_LIP = 1.785;

const ENGINE_CORE_GEO = new THREE.CylinderGeometry(
  ENG_R_CORE,
  ENG_R_CORE,
  0.23,
  30,
  1,
  true,
  -BAND_HALF,
  2 * BAND_HALF,
).translate(0, 0, DISC_CZ);
const ENGINE_HOT_GEO = new THREE.CylinderGeometry(
  ENG_R_HOT,
  ENG_R_HOT,
  0.095,
  24,
  1,
  true,
  -0.42,
  0.84,
).translate(0, 0, DISC_CZ);

/* ---- cockpit ---------------------------------------------------------------
 * Root buried at (1.38, 0.03, -0.10) and yawed 0.17 rad outboard, so the tube
 * leaves the hull around local z = -0.5 and runs another 0.55 in clear air
 * before the pod — it reads as an attached CORRIDOR, not a fairing.
 */
const COCKPIT_ROOT: readonly [number, number, number] = [1.34, 0.03, -0.1];
const COCKPIT_YAW = -0.17;
const COCKPIT_M = trs(COCKPIT_ROOT[0], COCKPIT_ROOT[1], COCKPIT_ROOT[2], 0, COCKPIT_YAW, 0);

/** Five equal facets wrapping 216 deg about "up" = five trapezoid panes. The
 *  cone is deliberately steep (34 deg) so the panes face FORWARD, not out. */
const CANOPY_GEO = ((): THREE.BufferGeometry => {
  const g = new THREE.CylinderGeometry(0.115, 0.3, 0.27, 5, 1, true, -1.885, 3.77);
  g.rotateX(-Math.PI / 2); // axis along -Z (forward); theta 0 points up
  g.applyMatrix4(mul(COCKPIT_M, trs(0, 0, -1.445)));
  return g;
})();

/* ---- sensor dish (the one animated sub-assembly) --------------------------- */
const DISH_GEO = ((): THREE.BufferGeometry => {
  const parts: THREE.BufferGeometry[] = [];
  const dish = new THREE.ConeGeometry(0.27, 0.1, 20, 1, true);
  put(parts, dish, trs(0, 0, 0, Math.PI, 0, 0));
  dish.dispose();
  const feed = new THREE.CylinderGeometry(0.014, 0.014, 0.17, 6);
  put(parts, feed, trs(0, 0.075, 0));
  feed.dispose();
  const horn = new THREE.SphereGeometry(0.032, 8, 6);
  put(parts, horn, trs(0, 0.15, 0));
  horn.dispose();
  return bake(parts);
})();
const DISH_PIVOT: readonly [number, number, number] = [-0.66, 0.43, -0.3];

/* ---- landing gear ----------------------------------------------------------
 * Three legs: one forward, two aft. Authored in the DEPLOYED pose, so every
 * pad sole is at exactly y = -1.0. Retraction is a pure translation of the one
 * shared gear group along local -Y by GEAR_TUCK, which lifts the soles to
 * y = -0.58 (tucked) before the group is hidden outright below gear 0.02.
 */
const GEAR_TUCK = 0.42;
const GEAR_POS: ReadonlyArray<readonly [number, number]> = [
  [0, -0.66],
  [-1.02, 1.02],
  [1.02, 1.02],
];
/** Per-leg upper-strut top, tucked just under that leg's local hull surface. */
const GEAR_TOP: readonly number[] = [-0.24, -0.2, -0.2];

const { GEAR_MID_GEO, GEAR_DARK_GEO } = ((): {
  GEAR_MID_GEO: THREE.BufferGeometry;
  GEAR_DARK_GEO: THREE.BufferGeometry;
} => {
  const mid: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  GEAR_POS.forEach(([gx, gz], i) => {
    const top = GEAR_TOP[i] ?? -0.22;
    const kneeY = -0.63;
    box(mid, gx, (top + kneeY) / 2, gz, 0.13, kneeY - top, 0.15); // upper strut
    box(mid, gx, kneeY, gz, 0.19, 0.11, 0.2); // knee / shock collar
    box(dark, gx, -0.79, gz, 0.1, 0.3, 0.12); // lower strut
    box(mid, gx, -0.9, gz, 0.3, 0.05, 0.36); // pad yoke
    box(dark, gx, -0.95, gz, 0.44, 0.1, 0.52); // foot pad, sole at -1.00
    box(dark, gx - 0.15, -0.985, gz, 0.06, 0.03, 0.44); // cleats, also at -1.00
    box(dark, gx + 0.15, -0.985, gz, 0.06, 0.03, 0.44);
  });
  return { GEAR_MID_GEO: bake(mid), GEAR_DARK_GEO: bake(dark) };
})();

/* Bay doors: two per bay, hinged on the outboard edge, swinging down/out.
 * Left doors take +rotation.z, right doors -rotation.z. */
const DOOR_MAX = 1.5;
const DOOR_HALF = 0.33;
const DOOR_L_GEO = new THREE.BoxGeometry(DOOR_HALF, 0.03, 0.56).translate(-DOOR_HALF / 2, 0, 0);
const DOOR_R_GEO = new THREE.BoxGeometry(DOOR_HALF, 0.03, 0.56).translate(DOOR_HALF / 2, 0, 0);
/** [x, y, z] of every door hinge, ordered left, right, left, right, ... */
const DOOR_SLOTS: ReadonlyArray<readonly [number, number, number]> = GEAR_POS.flatMap(
  ([gx, gz]) => {
    const y = -surfaceY(gx, gz) - 0.012;
    return [
      [gx - DOOR_HALF, y, gz] as const,
      [gx + DOOR_HALF, y, gz] as const,
    ];
  },
);

/* ---- every static detail, merged into three buffers ------------------------ */
const { GREY_GEO, MID_GEO, DARK_GEO } = ((): {
  GREY_GEO: THREE.BufferGeometry;
  MID_GEO: THREE.BufferGeometry;
  DARK_GEO: THREE.BufferGeometry;
} => {
  const grey: THREE.BufferGeometry[] = [];
  const mid: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const scrap: THREE.BufferGeometry[] = []; // sources to dispose after baking

  const src = <T extends THREE.BufferGeometry>(g: T): T => {
    scrap.push(g);
    return g;
  };

  /* --- MANDIBLES ---------------------------------------------------------- */
  for (const side of [1, -1] as const) {
    put(grey, src(makeMandibleGeometry(side)));
    const sx = side;
    // Raised dorsal spine, stepped in two tiers.
    box(mid, sx * 0.66, 0.155, -1.56, 0.3, 0.05, 1.18);
    box(grey, sx * 0.66, 0.195, -1.66, 0.17, 0.05, 0.92);
    // Shallow ventral keel.
    box(mid, sx * 0.64, -0.155, -1.55, 0.24, 0.05, 1.06);
    // Stepped inner face: two tiers standing proud of the flush mid-face at
    // x = +-0.28, so the notch wall reads as machined, not as a slab edge.
    box(grey, sx * 0.252, 0.075, -1.62, 0.065, 0.09, 1.1);
    box(dark, sx * 0.268, -0.085, -1.62, 0.05, 0.075, 1.1);
    // Outer-face conduit run.
    box(dark, sx * 0.9, 0.0, -1.62, 0.05, 0.12, 1.0);
    // Squared-off blunt tip: pale cap plate so the dark U notch reads against
    // it head-on. Its front face is at exactly z = -2.20.
    box(mid, sx * 0.57, 0, -2.185, 0.36, 0.24, 0.03);
    box(dark, sx * 0.57, 0, -2.17, 0.16, 0.13, 0.05);
    box(mid, sx * 0.6, 0.135, -2.02, 0.2, 0.06, 0.2);
    box(dark, sx * 0.48, -0.135, -1.93, 0.14, 0.05, 0.3);
    // Root blister where the prong swallows into the hull.
    box(mid, sx * 0.82, 0.13, -0.95, 0.28, 0.09, 0.3);
  }
  // Dark bulkhead across the back of the U notch, at the hull's front edge.
  box(dark, 0, 0, -1.28, 0.5, 0.2, 0.16);
  box(mid, 0, 0.12, -1.24, 0.4, 0.07, 0.2);

  /* --- ENGINE-DECK CUTOUT WALLS ------------------------------------------- */
  for (const th of [CUT_A, CUT_B, -CUT_A, -CUT_B]) {
    put(dark, CUT_WALL_GEO, trs(0, 0, DISC_CZ, 0, th - Math.PI / 2, 0));
  }

  /* --- ENGINE HOUSING ------------------------------------------------------ */
  put(
    dark,
    src(
      new THREE.CylinderGeometry(
        ENG_R_BACK,
        ENG_R_BACK,
        0.34,
        26,
        1,
        true,
        -HOUSE_HALF,
        2 * HOUSE_HALF,
      ),
    ),
    trs(0, 0, DISC_CZ),
  );
  const lip = src(
    new THREE.RingGeometry(1.45, ENG_R_LIP, 22, 1, -Math.PI / 2 - HOUSE_HALF, 2 * HOUSE_HALF),
  );
  put(dark, lip, trs(0, 0.155, DISC_CZ, -Math.PI / 2, 0, 0));
  put(dark, lip, trs(0, -0.155, DISC_CZ, -Math.PI / 2, 0, 0));
  for (const s of [1, -1] as const) {
    const th = s * HOUSE_HALF;
    box(dark, 1.66 * Math.sin(th), 0, DISC_CZ + 1.66 * Math.cos(th), 0.05, 0.34, 0.24, th);
  }
  // Grille bars breaking the strip up, and deck ribs above/below it.
  for (const th of [-0.44, -0.21, 0.21, 0.44]) {
    box(dark, 1.735 * Math.sin(th), 0, DISC_CZ + 1.735 * Math.cos(th), 0.035, 0.26, 0.05, th);
  }
  for (const th of [-0.52, -0.3, 0, 0.3, 0.52]) {
    for (const sy of [1, -1] as const) {
      box(
        mid,
        1.58 * Math.sin(th),
        sy * 0.175,
        DISC_CZ + 1.58 * Math.cos(th),
        0.09,
        0.05,
        0.22,
        th,
      );
    }
  }

  /* --- TOP QUAD-LASER TURRET ---------------------------------------------- */
  const TURRET_Z = DISC_CZ + 0.05;
  // Low lip ring around the flat crown.
  put(grey, src(new THREE.CylinderGeometry(0.52, 0.56, 0.06, 26)), trs(0, 0.335, DISC_CZ));
  put(grey, src(new THREE.CylinderGeometry(0.3, 0.34, 0.14, 20)), trs(0, 0.4, TURRET_Z));
  put(
    mid,
    src(new THREE.SphereGeometry(0.24, 18, 12)),
    trs(0, 0.47, TURRET_Z, 0, 0, 0, 1, 0.68, 1),
  );
  box(dark, 0, 0.56, TURRET_Z - 0.02, 0.32, 0.08, 0.11);
  for (const s of [1, -1] as const) {
    put(
      dark,
      src(new THREE.CylinderGeometry(0.026, 0.034, 0.36, 8)),
      trs(s * 0.075, 0.6, TURRET_Z - 0.06, -1.15, 0, 0),
    );
  }

  /* --- BELLY QUAD-LASER TURRET -------------------------------------------- */
  put(grey, src(new THREE.CylinderGeometry(0.34, 0.3, 0.14, 20)), trs(0, -0.4, TURRET_Z));
  put(
    mid,
    src(new THREE.SphereGeometry(0.22, 16, 10)),
    trs(0, -0.47, TURRET_Z, 0, 0, 0, 1, 0.7, 1),
  );
  box(dark, 0, -0.55, TURRET_Z - 0.02, 0.3, 0.07, 0.1);
  for (const s of [1, -1] as const) {
    put(
      dark,
      src(new THREE.CylinderGeometry(0.024, 0.032, 0.32, 8)),
      trs(s * 0.07, -0.58, TURRET_Z - 0.06, 1.15, 0, 0),
    );
  }

  /* --- SENSOR DISH MOUNT (port-forward) ----------------------------------- */
  put(dark, src(new THREE.CylinderGeometry(0.035, 0.05, 0.2, 8)), trs(-0.66, 0.34, -0.3));
  box(mid, -0.66, 0.27, -0.3, 0.2, 0.06, 0.2);

  /* --- COCKPIT: collar, ribbed corridor, pod, canopy frame ----------------- */
  const cp = (px: number, py: number, pz: number, rx = 0): THREE.Matrix4 =>
    mul(COCKPIT_M, trs(px, py, pz, rx, 0, 0));
  put(grey, src(new THREE.CylinderGeometry(0.3, 0.33, 0.18, 16)), cp(0, 0, 0.02, -Math.PI / 2));
  put(grey, src(new THREE.CylinderGeometry(0.235, 0.27, 1.04, 16)), cp(0, 0, -0.53, -Math.PI / 2));
  const rib = src(new THREE.TorusGeometry(0.256, 0.026, 6, 18));
  for (const z of [-0.2, -0.46, -0.72, -0.96]) put(mid, rib, cp(0, 0, z));
  // Pod body, then the shell under the canopy sector, then the nose cap.
  put(grey, src(new THREE.CylinderGeometry(0.295, 0.3, 0.26, 16)), cp(0, 0, -1.18, -Math.PI / 2));
  put(
    grey,
    src(new THREE.CylinderGeometry(0.115, 0.3, 0.27, 8, 1, true, 1.885, TAU - 3.77)),
    cp(0, 0, -1.445, -Math.PI / 2),
  );
  put(
    mid,
    src(new THREE.SphereGeometry(0.115, 12, 8)),
    mul(COCKPIT_M, trs(0, 0, -1.58, 0, 0, 0, 1, 1, 0.6)),
  );
  // Flat dark brow capping the canopy, and a frame rail at its base.
  put(dark, UNIT_BOX, mul(COCKPIT_M, trs(0, 0.215, -1.4, -0.5, 0, 0, 0.28, 0.04, 0.3)));
  put(dark, src(new THREE.TorusGeometry(0.3, 0.026, 6, 18)), cp(0, 0, -1.31));
  put(dark, UNIT_BOX, mul(COCKPIT_M, trs(0.2, 0.16, -1.2, 0, 0, 0, 0.1, 0.07, 0.22)));
  put(dark, UNIT_BOX, mul(COCKPIT_M, trs(-0.2, 0.16, -1.2, 0, 0, 0, 0.1, 0.07, 0.22)));

  /* --- DOCKING RINGS, both flanks ----------------------------------------- */
  for (const s of [1, -1] as const) {
    const dx = s * 1.52;
    const dz = s === 1 ? 0.72 : 0.34;
    put(grey, src(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 14)), trs(dx, 0, dz, 0, 0, Math.PI / 2));
    put(mid, src(new THREE.TorusGeometry(0.2, 0.03, 8, 20)), trs(dx + s * 0.15, 0, dz, 0, Math.PI / 2, 0));
  }

  /* --- BOARDING RAMP PLATE, underside front-centre ------------------------- */
  const rampY = -surfaceY(0, -0.55);
  put(dark, UNIT_BOX, trs(0, rampY - 0.008, -0.55, 0.14, 0, 0, 0.46, 0.05, 0.72));
  put(mid, UNIT_BOX, trs(0, rampY + 0.008, -0.55, 0.14, 0, 0, 0.54, 0.04, 0.8));

  /* --- LANDING-GEAR BAYS: dark recess + hinge rails (static) --------------- */
  GEAR_POS.forEach(([gx, gz]) => {
    const sy = -surfaceY(gx, gz);
    box(dark, gx, sy + 0.105, gz, 0.62, 0.2, 0.54);
    box(mid, gx - DOOR_HALF, sy + 0.02, gz, 0.05, 0.05, 0.58);
    box(mid, gx + DOOR_HALF, sy + 0.02, gz, 0.05, 0.05, 0.58);
  });

  /* --- REAR-DECK GREEBLE BANK + CONDUIT RUNS ------------------------------- */
  const rand = mulberry32(0x0fa1c05);

  // Dense mechanical clutter across the rear deck, both sides of the band.
  for (let i = 0; i < 34; i++) {
    const s = i % 2 === 0 ? 1 : -1;
    const th = s * (0.14 + rand() * 0.52);
    const rr = 0.78 + rand() * 0.6;
    const up = rand() < 0.62;
    const x = rr * Math.sin(th);
    const z = DISC_CZ + rr * Math.cos(th);
    const h = 0.04 + rand() * 0.07;
    const y = (up ? 1 : -1) * (surfaceY(x, z) + h * 0.35);
    const roll = rand();
    box(
      roll < 0.34 ? dark : roll < 0.7 ? mid : grey,
      x,
      y,
      z,
      0.08 + rand() * 0.18,
      h,
      0.09 + rand() * 0.26,
      th,
    );
  }

  // A few upright tanks / vents standing on the rear deck.
  for (const th of [-0.5, -0.28, 0.28, 0.5]) {
    const rr = 1.06 + (th > 0 ? 0.08 : 0);
    const x = rr * Math.sin(th);
    const z = DISC_CZ + rr * Math.cos(th);
    put(mid, src(new THREE.CylinderGeometry(0.055, 0.065, 0.11, 10)), trs(x, surfaceY(x, z) + 0.04, z));
  }

  // Larger conduit runs radiating from the core, top and bottom.
  for (const [th, up] of [
    [2.25, 1],
    [-2.25, 1],
    [1.55, 1],
    [-1.55, -1],
    [2.7, -1],
    [-2.7, -1],
  ] as ReadonlyArray<readonly [number, number]>) {
    const rr = 1.02;
    const x = rr * Math.sin(th);
    const z = DISC_CZ + rr * Math.cos(th);
    const y = up * (surfaceY(x, z) + 0.035);
    box(mid, x, y, z, 0.09, 0.08, 0.82, th);
    box(dark, x, y + up * 0.05, z, 0.05, 0.04, 0.68, th);
    const xe = 0.62 * Math.sin(th);
    const ze = DISC_CZ + 0.62 * Math.cos(th);
    box(dark, xe, up * (surfaceY(xe, ze) + 0.05), ze, 0.16, 0.1, 0.16, th);
  }

  // Scattered half-buried machinery across the rest of the hull.
  for (let i = 0; i < 22; i++) {
    const a = rand() * TAU;
    const rr = 0.48 + rand() * 0.92;
    const up = i < 14;
    const x = rr * Math.sin(a);
    const z = DISC_CZ + rr * Math.cos(a);
    const h = 0.04 + rand() * 0.07;
    box(
      i % 3 === 0 ? dark : i % 3 === 1 ? mid : grey,
      x,
      (up ? 1 : -1) * (surfaceY(x, z) + h * 0.3),
      z,
      0.08 + rand() * 0.2,
      h,
      0.08 + rand() * 0.26,
      a,
    );
  }

  const out = { GREY_GEO: bake(grey), MID_GEO: bake(mid), DARK_GEO: bake(dark) };
  for (const g of scrap) g.dispose();
  return out;
})();

/* Stern glow sprites, sitting on the band's arc. */
const GLOW_POS: ReadonlyArray<readonly [number, number, number]> = [
  [-0.72, 0, 1.96],
  [0, 0, 2.12],
  [0.72, 0, 1.96],
];
const GLOW_BASE = [0.85, 1.3, 0.85];

/* ---- world-space trail -----------------------------------------------------
 * The signature system, kept exactly in architecture: points live in SCENE
 * space (portal) so the wash arcs along the flight path; ring buffer recycled
 * in place; real-metre projected sizing via uH; screen-space smear along
 * travel RELATIVE to the camera. Emission is spread across the stern strip
 * following the band's arc — white-blue aging, 2.4 s life, alpha peak ~0.45.
 */
const T_COUNT = 260;
const T_LIFE = 2.4;
const T_RATE = 80; // particles/s at full thrust
const T_THRUST_MIN = 0.1;

// Seeded per-slot randomness — identical exhaust every visit.
const T_SPEED = new Float32Array(T_COUNT);
const T_SCAT = new Float32Array(T_COUNT * 3);
const T_SIZE = new Float32Array(T_COUNT);
const T_SOFT = new Float32Array(T_COUNT);
const T_SEED = new Float32Array(T_COUNT);
const T_EMIT = new Float32Array(T_COUNT * 3); // local emit point along the stern band
{
  const rand = mulberry32(0x7db8ff);
  for (let i = 0; i < T_COUNT; i++) {
    T_SPEED[i] = 2.8 + rand() * 1.7;
    T_SCAT[i * 3] = (rand() - 0.5) * 1.6;
    T_SCAT[i * 3 + 1] = (rand() - 0.5) * 1.6;
    T_SCAT[i * 3 + 2] = (rand() - 0.5) * 1.6;
    T_SIZE[i] = 0.16 + rand() * 0.24;
    T_SOFT[i] = 0.22 + rand() * 0.36;
    T_SEED[i] = rand() * 6.283;
    const ex = (rand() - 0.5) * 1.68; // spread across the strip, +-0.84
    T_EMIT[i * 3] = ex;
    T_EMIT[i * 3 + 1] = (rand() - 0.5) * 0.16;
    T_EMIT[i * 3 + 2] = DISC_CZ + Math.sqrt(Math.max(0.04, 1.8 * 1.8 - ex * ex));
  }
}

const TRAIL_VERT = /* glsl */ `
uniform float uH;
uniform float uAspect;
uniform vec3 uCamVel;
attribute vec4 aDrop; // [diameter, alpha, softness, seed]
attribute vec3 aVel;  // world velocity, for the motion smear
varying float vA;
varying float vLife;
varying float vCore;
varying float vRot;
varying float vStretch;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = max(0.05, -mv.z);
  // Projected pixel diameter from real world size (uH = render target height).
  float px = aDrop.x * projectionMatrix[1][1] * 0.5 * uH / depth;
  // Smear along motion RELATIVE to the lens — a particle pacing the camera
  // stays round however fast the world says it is going.
  vec4 cp2 = projectionMatrix * (mv + modelViewMatrix * vec4((aVel - uCamVel) * 0.02, 0.0));
  vec2 s1 = gl_Position.xy / max(1e-4, gl_Position.w);
  vec2 s2 = cp2.xy / max(1e-4, cp2.w);
  vec2 d = (s2 - s1) * vec2(uAspect, 1.0) * uH * 0.5;
  float dl = length(d);
  vStretch = clamp(dl / max(px, 1.5), 1.0, 2.6);
  vRot = dl > 0.75 ? atan(d.y, d.x) : aDrop.w;
  vCore = aDrop.z;
  vLife = clamp(aDrop.y * 2.223, 0.0, 1.0); // alpha peaks ~0.45 at birth -> 1..0 life proxy
  // Fade anything about to swallow the lens rather than splatting a disc.
  vA = aDrop.y * smoothstep(0.4, 1.6, depth) * mix(1.0, 0.04, smoothstep(22.0, 60.0, px));
  gl_PointSize = clamp(px * vStretch, 1.0, 40.0);
}`;

const TRAIL_FRAG = /* glsl */ `
varying float vA;
varying float vLife;
varying float vCore;
varying float vRot;
varying float vStretch;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float ca = cos(vRot), sa = sin(vRot);
  vec2 q = vec2(d.x * ca + d.y * sa, d.y * ca - d.x * sa);
  q.y *= vStretch; // long axis along travel, thin across it
  float r = length(q) * 2.0;
  float a = vA * (1.0 - smoothstep(vCore, 1.0, r));
  if (a < 0.004) discard;
  // White-blue at birth (#eaf4ff) through #7db8ff, dying to a faint #2c5fa8.
  vec3 col = mix(vec3(0.172, 0.373, 0.659), vec3(0.49, 0.722, 1.0), smoothstep(0.08, 0.6, vLife));
  col = mix(col, vec3(0.918, 0.957, 1.0) * 1.45, smoothstep(0.78, 1.0, vLife));
  gl_FragColor = vec4(col, a);
}`;

// Module-scope scratch — no per-frame allocation, ever.
const SCRATCH_POS = new THREE.Vector3();
const SCRATCH_DIR = new THREE.Vector3();
const SCRATCH_QUAT = new THREE.Quaternion();

type TrailState = {
  pos: Float32Array;
  drop: Float32Array;
  vel: Float32Array;
  ages: Float32Array;
  posAttr: THREE.BufferAttribute;
  dropAttr: THREE.BufferAttribute;
  velAttr: THREE.BufferAttribute;
  geo: THREE.BufferGeometry;
  cursor: number;
  accum: number;
  camPrev: THREE.Vector3;
  camInit: boolean;
};

function makeTrailState(): TrailState {
  const pos = new Float32Array(T_COUNT * 3);
  const drop = new Float32Array(T_COUNT * 4);
  const vel = new Float32Array(T_COUNT * 3);
  const ages = new Float32Array(T_COUNT).fill(T_LIFE); // born dead — no mount flash
  const posAttr = new THREE.BufferAttribute(pos, 3);
  const dropAttr = new THREE.BufferAttribute(drop, 4);
  const velAttr = new THREE.BufferAttribute(vel, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  dropAttr.setUsage(THREE.DynamicDrawUsage);
  velAttr.setUsage(THREE.DynamicDrawUsage);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aDrop', dropAttr);
  geo.setAttribute('aVel', velAttr);
  return {
    pos,
    drop,
    vel,
    ages,
    posAttr,
    dropAttr,
    velAttr,
    geo,
    cursor: 0,
    accum: 0,
    camPrev: new THREE.Vector3(),
    camInit: false,
  };
}

type Rocket3DProps = {
  /** 0..1 burn intensity (may spike ~1.2), written by the parent each frame. */
  thrustRef: { current: number };
  /** 0 = gear fully retracted (in flight) .. 1 = fully deployed (landed). */
  gearRef?: { current: number };
  /** True gates ALL continuous animation; value-tracking state still follows its ref. */
  reduced: boolean;
};

export const Rocket3D = forwardRef<THREE.Group, Rocket3DProps>(function Rocket3D(
  { thrustRef, gearRef, reduced },
  ref,
) {
  const scene = useThree((s) => s.scene);
  const groupRef = useRef<THREE.Group | null>(null);
  const dishRef = useRef<THREE.Group | null>(null);
  const gearGroupRef = useRef<THREE.Group | null>(null);
  const doorRefs = useRef<Array<THREE.Mesh | null>>([null, null, null, null, null, null]);
  const gearPrev = useRef(-1);
  const glowRefs = useRef<Array<THREE.Sprite | null>>([null, null, null]);
  const lightRef = useRef<THREE.PointLight | null>(null);
  const trail = useMemo(makeTrailState, []);

  const { mats, trailU } = useMemo(() => {
    const trailUniforms = {
      uH: { value: 720 },
      uAspect: { value: 16 / 9 },
      uCamVel: { value: new THREE.Vector3() },
    };
    return {
      trailU: trailUniforms,
      mats: {
        hull: new THREE.MeshStandardMaterial({
          map: hullTexture(),
          color: '#ffffff',
          roughness: 0.62,
          metalness: 0.25,
          envMapIntensity: 0.7,
        }),
        grey: new THREE.MeshStandardMaterial({
          color: '#b4b8bc',
          roughness: 0.62,
          metalness: 0.25,
          envMapIntensity: 0.7,
        }),
        greyDark: new THREE.MeshStandardMaterial({
          color: '#8e9296',
          roughness: 0.7,
          metalness: 0.3,
          envMapIntensity: 0.6,
        }),
        dark: new THREE.MeshStandardMaterial({
          color: '#3a3e46',
          roughness: 0.5,
          metalness: 0.6,
          side: THREE.DoubleSide,
        }),
        canopy: new THREE.MeshStandardMaterial({
          map: canopyTexture(),
          color: '#ffffff',
          emissive: '#1a2c42',
          emissiveIntensity: 0.45,
          roughness: 0.18,
          metalness: 0.25,
          side: THREE.DoubleSide,
        }),
        engineCore: new THREE.MeshStandardMaterial({
          color: '#0b111c',
          emissive: HYPER_CORE,
          emissiveIntensity: 1.2,
          roughness: 0.4,
          side: THREE.DoubleSide,
        }),
        engineHot: new THREE.MeshStandardMaterial({
          color: '#0b111c',
          emissive: HYPER_HOT,
          emissiveIntensity: 1.7,
          roughness: 0.4,
          side: THREE.DoubleSide,
        }),
        glow: new THREE.SpriteMaterial({
          map: glowTexture(),
          color: '#9cc8ff',
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
        underGlow: new THREE.SpriteMaterial({
          map: glowTexture(),
          color: HYPER_CORE,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
        trail: new THREE.ShaderMaterial({
          uniforms: trailUniforms,
          vertexShader: TRAIL_VERT,
          fragmentShader: TRAIL_FRAG,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      },
    };
  }, []);

  // Per-mount resources go away with the component; module-scope geometry
  // and cached canvas textures are shared across visits on purpose.
  useEffect(() => {
    return () => {
      trail.geo.dispose();
      for (const m of Object.values(mats)) m.dispose();
    };
  }, [trail, mats]);

  useFrame((state, rawDt) => {
    // Clamp dt: a backgrounded tab must not dump a giant step into the sim.
    const dt = Math.min(rawDt, 0.05);
    const thrust = thrustRef.current;
    const t = state.clock.elapsedTime;

    // ---- hyperdrive band: intensity TRACKS thrust (state, allowed under
    // reduced); the subtle flicker is motion, gated off.
    const flick = reduced ? 0 : 0.05 * Math.sin(t * 12.4) + 0.035 * Math.sin(t * 7.9 + 1.3);
    mats.engineCore.emissiveIntensity = (1.2 + thrust * 2.6) * (1 + flick);
    mats.engineHot.emissiveIntensity = (1.7 + thrust * 3.0) * (1 + flick);

    // ---- stern glow sprites + hyperdrive light: value-tracking state.
    mats.glow.opacity = Math.min(1, thrust * 0.95);
    const gs = 0.55 + thrust * 1.6;
    for (let i = 0; i < 3; i++) {
      const spr = glowRefs.current[i];
      if (spr) {
        const m = GLOW_BASE[i] ?? 1;
        spr.scale.set(gs * m * 1.2, gs * m * 0.7, 1);
      }
    }
    const light = lightRef.current;
    if (light) light.intensity = thrust * 22;

    // ---- belly repulsor under-glow: fades in above thrust 0.6 (landing read).
    mats.underGlow.opacity = thrust > 0.6 ? Math.min(0.5, (thrust - 0.6) * 1.2) : 0;

    // ---- LANDING GEAR: pure value-tracking off gearRef, so it still poses
    // correctly under reduced motion. 0 = stowed (hidden), 1 = soles at -1.0.
    const raw = gearRef ? gearRef.current : 0;
    // Written so a NaN falls through to 0 rather than poisoning the transform.
    const gear = raw > 0 ? (raw < 1 ? raw : 1) : 0;
    if (gear !== gearPrev.current) {
      gearPrev.current = gear;
      const gg = gearGroupRef.current;
      if (gg) {
        const shown = gear > 0.02;
        gg.visible = shown;
        if (shown) gg.position.y = (1 - gear) * GEAR_TUCK;
      }
      // Doors lead the legs: fully open by gear 0.4, smoothstepped.
      const o = Math.min(1, gear / 0.4);
      const angle = o * o * (3 - 2 * o) * DOOR_MAX;
      for (let i = 0; i < 6; i++) {
        const d = doorRefs.current[i];
        if (d) d.rotation.z = i % 2 === 0 ? angle : -angle;
      }
    }

    // Everything past here is pure motion — parked entirely under reduced.
    if (reduced) return;

    // ---- sensor dish: slow 0.1 rad/s sweep.
    const dish = dishRef.current;
    if (dish) dish.rotation.y = (dish.rotation.y + 0.1 * dt) % TAU;

    // ---- trail: camera velocity for the screen-space smear.
    const cam = state.camera;
    const camVel = trailU.uCamVel.value;
    if (trail.camInit && dt > 5e-4) {
      camVel.copy(cam.position).sub(trail.camPrev).divideScalar(dt);
      const m = camVel.length();
      if (m > 60) camVel.multiplyScalar(60 / m); // a camera snap must not smear the world
    }
    trail.camPrev.copy(cam.position);
    trail.camInit = true;

    const { pos, drop, vel, ages } = trail;

    // Age, integrate and fade every live particle in place.
    for (let i = 0; i < T_COUNT; i++) {
      const age = (ages[i] ?? T_LIFE) + dt;
      ages[i] = age;
      const q = i * 4;
      if (age >= T_LIFE) {
        drop[q + 1] = 0;
        continue;
      }
      const k = i * 3;
      pos[k] = (pos[k] ?? 0) + (vel[k] ?? 0) * dt;
      pos[k + 1] = (pos[k + 1] ?? 0) + (vel[k + 1] ?? 0) * dt;
      pos[k + 2] = (pos[k + 2] ?? 0) + (vel[k + 2] ?? 0) * dt;
      const u = age / T_LIFE;
      const inv = 1 - u;
      drop[q] = (T_SIZE[i] ?? 0.2) * (0.7 + u * 1.5); // wash expands as it cools
      drop[q + 1] = 0.45 * inv * inv * Math.min(1, age * 10); // peak ~0.45, quadratic fade
    }

    // Emit across the stern strip's WORLD position, aft along WORLD +Z.
    if (thrust > T_THRUST_MIN) {
      const g = groupRef.current;
      if (g) {
        g.updateWorldMatrix(true, false);
        g.getWorldQuaternion(SCRATCH_QUAT);
        SCRATCH_DIR.set(0, 0, 1).applyQuaternion(SCRATCH_QUAT).normalize();
        trail.accum += T_RATE * Math.min(thrust, 1.2) * dt;
        while (trail.accum >= 1) {
          trail.accum -= 1;
          const i = trail.cursor;
          trail.cursor = (i + 1) % T_COUNT;
          ages[i] = 0;
          const k = i * 3;
          const q = i * 4;
          // Per-slot emit point spread along the band's arc, to world space.
          SCRATCH_POS.set(T_EMIT[k] ?? 0, T_EMIT[k + 1] ?? 0, T_EMIT[k + 2] ?? 2.1).applyMatrix4(
            g.matrixWorld,
          );
          pos[k] = SCRATCH_POS.x + (T_SCAT[k] ?? 0) * 0.05;
          pos[k + 1] = SCRATCH_POS.y + (T_SCAT[k + 1] ?? 0) * 0.05;
          pos[k + 2] = SCRATCH_POS.z + (T_SCAT[k + 2] ?? 0) * 0.05;
          const spd = T_SPEED[i] ?? 3.5;
          vel[k] = SCRATCH_DIR.x * spd + (T_SCAT[k] ?? 0) * 0.6;
          vel[k + 1] = SCRATCH_DIR.y * spd + (T_SCAT[k + 1] ?? 0) * 0.6;
          vel[k + 2] = SCRATCH_DIR.z * spd + (T_SCAT[k + 2] ?? 0) * 0.6;
          drop[q + 2] = T_SOFT[i] ?? 0.3;
          drop[q + 3] = T_SEED[i] ?? 0;
        }
      }
    } else {
      trail.accum = 0; // a coast must not bank up a burst
    }

    trail.posAttr.needsUpdate = true;
    trail.dropAttr.needsUpdate = true;
    trail.velAttr.needsUpdate = true;
  });

  return (
    <group
      ref={(g: THREE.Group | null) => {
        groupRef.current = g;
        if (typeof ref === 'function') ref(g);
        else if (ref) ref.current = g;
      }}
    >
      {/* Hull: four lathe arcs merged into one textured shell — main body,
          stern engine deck, and the two short-radius engine-deck cutouts that
          bite the top-view outline either side of the band. */}
      <mesh geometry={HULL_GEO} material={mats.hull} />

      {/* Everything static: mandibles, cockpit corridor + pod, turret bumps,
          docking rings, ramp plate, cutout walls, engine housing, greebles. */}
      <mesh geometry={GREY_GEO} material={mats.grey} />
      <mesh geometry={MID_GEO} material={mats.greyDark} />
      <mesh geometry={DARK_GEO} material={mats.dark} />

      {/* Five trapezoid panes in a dark frame, flat across the top. */}
      <mesh geometry={CANOPY_GEO} material={mats.canopy} />

      {/* Sensor dish: slow sweep (parked under reduced), offset port-forward. */}
      <group position={[DISH_PIVOT[0], DISH_PIVOT[1], DISH_PIVOT[2]]}>
        <group
          ref={(g: THREE.Group | null) => {
            dishRef.current = g;
          }}
        >
          <group rotation={[-0.62, 0, 0]}>
            <mesh geometry={DISH_GEO} material={mats.dark} />
          </group>
        </group>
      </group>

      {/* THE HYPERDRIVE: the emissive strip, inset behind the housing lips. */}
      <mesh geometry={ENGINE_CORE_GEO} material={mats.engineCore} />
      <mesh geometry={ENGINE_HOT_GEO} material={mats.engineHot} />

      {/* Landing gear: one translating group, three legs, soles at EXACTLY
          y = -1.0 when gearRef is 1; hidden entirely below 0.02. */}
      <group
        ref={(g: THREE.Group | null) => {
          gearGroupRef.current = g;
          if (g) {
            // Pose imperatively, never declaratively — a re-render must not
            // stomp the gear back to stowed mid-deployment.
            g.visible = false;
            g.position.y = GEAR_TUCK;
          }
          gearPrev.current = -1; // force the next frame to re-apply gearRef
        }}
      >
        <mesh geometry={GEAR_MID_GEO} material={mats.greyDark} />
        <mesh geometry={GEAR_DARK_GEO} material={mats.dark} />
      </group>

      {/* Bay doors: hinged outboard, swinging down as the gear comes out. */}
      {DOOR_SLOTS.map((p, i) => (
        <mesh
          key={i}
          geometry={i % 2 === 0 ? DOOR_L_GEO : DOOR_R_GEO}
          material={mats.greyDark}
          position={[p[0], p[1], p[2]]}
          ref={(m: THREE.Mesh | null) => {
            doorRefs.current[i] = m;
          }}
        />
      ))}

      {/* Row of three stern glow sprites scaling with thrust. */}
      {GLOW_POS.map((p, i) => (
        <sprite
          key={i}
          material={mats.glow}
          position={[p[0], p[1], p[2]]}
          ref={(s: THREE.Sprite | null) => {
            glowRefs.current[i] = s;
          }}
        />
      ))}

      {/* The one hyperdrive light, painting blue onto nearby hull/planets. */}
      <pointLight
        color={HYPER_CORE}
        intensity={0}
        distance={26}
        decay={2}
        position={[0, 0, 2.15]}
        ref={(l) => {
          lightRef.current = l;
        }}
      />

      {/* Faint repulsor under-glow beneath the hull, thrust > 0.6 only. */}
      <sprite material={mats.underGlow} position={[0, -0.72, 0.3]} scale={[2.5, 1.25, 1]} />

      {/* World-space trail: portaled to the scene root so particles stay
          where they were emitted and the wash arcs along the flight path.
          Absent entirely under reduced motion. */}
      {!reduced &&
        createPortal(
          <points
            geometry={trail.geo}
            material={mats.trail}
            frustumCulled={false}
            ref={(p: THREE.Points | null) => {
              if (!p) return;
              // gl_PointSize is device pixels: read the height of whatever
              // target is being drawn into (bloom renders off-screen).
              p.onBeforeRender = (renderer) => {
                const rt = renderer.getRenderTarget();
                const w = rt ? rt.width : renderer.domElement.width;
                const h = rt ? rt.height : renderer.domElement.height;
                trailU.uH.value = h;
                trailU.uAspect.value = w / Math.max(1, h);
              };
            }}
          />,
          scene,
        )}
    </group>
  );
});
