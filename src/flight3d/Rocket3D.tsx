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
 *   SURFACE     panel-line NORMALS on the hull and the plating sheet, so the
 *               seams the albedo paints are lit as real grooves and swap sides
 *               as the light travels; a wear sheet in roughness + metalness;
 *               and a fresnel rim that goes hot and hard where the direct
 *               light actually lands and stays cool starlight everywhere else.
 *   LAMPS       every glowing thing — the layered hyperdrive plume, the belly
 *               repulsor, nav lamps, anti-collision strobes and attitude jets
 *               — is ONE quad batch, one program, one draw, driven by two
 *               vec4 uniforms. See the EMISSIVE LAMP SYSTEM block below.
 *
 * Everything static is MERGED into five buffers (hull / grey / mid / dark /
 * gear) so the whole freighter is a handful of draw calls. In flight the
 * ship is 15 drawables and ~12.5k triangles, gear stowed.
 *
 * QUALITY: read once via useQuality(). low drops the normal maps and thins
 * the exhaust pool; mid is exactly what shipped before this pass (260
 * particles, anisotropy 8, no anisotropic hull); high adds a denser wash, a
 * hotter bloom-feeding filament, a long plume tail and a hint of azimuthal
 * anisotropy on the hull. Nothing here is sampled per frame.
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
 * animation (band flicker, plume idle, dish sweep, strobes, attitude jets,
 * gear spring, trail) — value-tracking state (plume and repulsor intensity,
 * nav lamps, GEAR POSE) still follows its ref, so the one frame a
 * reduced-motion visitor is given is still the good one.
 * ========================================================================= */

import * as THREE from 'three';
import { forwardRef, useEffect, useMemo, useRef } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../engine';
import { useQuality } from './quality';

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
/* ---- panel-line normal detail ----------------------------------------------
 * The albedo sheets PAINT the seams; a light moving across a painted seam does
 * nothing, which is why the hull held its shape but never caught the sun. A
 * tangent-space normal map costs one texture fetch and gives every panel line
 * a real pair of walls: the seam goes dark on the side facing away from the
 * key and bright on the side facing it, and it swaps as the camera travels.
 *
 * These are authored, not derived — a groove is two opposed slopes, so the
 * whole map is "flat everywhere, ramp one channel either side of a line", and
 * a bevelled plate is the same trick on four sides of a rectangle. Both sheets
 * are DATA (NoColorSpace); sRGB-decoding a normal map would bend every wall.
 */
const N_FLAT = 'rgb(128,128,255)';
/** Vertical seam at x: tilts the surface in +/-x either side of the line. */
function grooveV(ctx: CanvasRenderingContext2D, x: number, w: number, d: number, h: number): void {
  const k = Math.round(d * 127);
  ctx.fillStyle = `rgb(${128 - k},128,255)`;
  ctx.fillRect(x - w, 0, w, h);
  ctx.fillStyle = `rgb(${128 + k},128,255)`;
  ctx.fillRect(x, 0, w, h);
}
/** Horizontal seam at y. G is three's +v axis, so the sign convention matches. */
function grooveH(ctx: CanvasRenderingContext2D, y: number, w: number, d: number, s: number): void {
  const k = Math.round(d * 127);
  ctx.fillStyle = `rgb(128,${128 - k},255)`;
  ctx.fillRect(0, y - w, s, w);
  ctx.fillStyle = `rgb(128,${128 + k},255)`;
  ctx.fillRect(0, y, s, w);
}
/** A plate standing proud of its neighbours: bevel on all four edges. */
function bevelRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  b: number,
  d: number,
): void {
  const k = Math.round(d * 127);
  ctx.fillStyle = `rgb(${128 + k},128,255)`;
  ctx.fillRect(x, y, b, h);
  ctx.fillStyle = `rgb(${128 - k},128,255)`;
  ctx.fillRect(x + w - b, y, b, h);
  ctx.fillStyle = `rgb(128,${128 + k},255)`;
  ctx.fillRect(x, y, w, b);
  ctx.fillStyle = `rgb(128,${128 - k},255)`;
  ctx.fillRect(x, y + h - b, w, b);
}

/* Layout shared by the hull's ALBEDO and its normal map: the two sheets have
 * to put their seams in the same places or the panel lines painted in one
 * would be lit as flat plate by the other. Hoisted for exactly that reason. */
const HULL_SECTORS = 24;
const HULL_RING_US = [0.14, 0.28, 0.42, 0.56, 0.7, 0.84, 0.97];
/** v(profile index) -> canvas y, for a ring at radius fraction u on each shell. */
const hullTopY = (u: number, S: number): number => ((DISC_N * u) / DISC_LAST) * S;
const hullBotY = (u: number, S: number): number => S - ((DISC_N * u) / DISC_LAST) * S;

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

  const topY = (u: number): number => hullTopY(u, S);
  const botY = (u: number): number => hullBotY(u, S);

  ctx.fillStyle = '#b8bcc0';
  ctx.fillRect(0, 0, S, S);

  // Soft tonal mottling under everything.
  for (let i = 0; i < 170; i++) {
    const g = 140 + Math.floor(rand() * 80);
    ctx.fillStyle = `rgba(${g}, ${g + 3}, ${g + 6}, ${(0.04 + rand() * 0.07).toFixed(3)})`;
    ctx.fillRect(rand() * S, rand() * S, 14 + rand() * 90, 8 + rand() * 60);
  }

  const SECTORS = HULL_SECTORS;
  const secW = S / SECTORS;
  const RING_US = HULL_RING_US;

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

/** The hull's panel lines as geometry-for-free: the same 24 radial seams and
 *  seven ring seams the albedo paints, plus bevelled plates and the rim band's
 *  two lips, cut into the normal so a raking sun finds every one of them. */
let hullNormalCache: THREE.CanvasTexture | null = null;
function hullNormalTexture(): THREE.CanvasTexture {
  if (hullNormalCache) return hullNormalCache;
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const rand = mulberry32(0x0fa1c17);

  ctx.fillStyle = N_FLAT;
  ctx.fillRect(0, 0, S, S);

  const secW = S / HULL_SECTORS;
  // Bevelled replacement plates first, so the seams cut across them.
  for (let i = 0; i < 46; i++) {
    const bi = Math.floor(rand() * (HULL_RING_US.length - 1));
    const u1 = HULL_RING_US[bi] ?? 0.2;
    const u2 = HULL_RING_US[bi + 1] ?? 0.9;
    const topHalf = rand() < 0.55;
    const ya = topHalf ? hullTopY(u1, S) : hullBotY(u2, S);
    const yb = topHalf ? hullTopY(u2, S) : hullBotY(u1, S);
    const x = Math.floor(rand() * HULL_SECTORS) * secW;
    const w = (rand() < 0.3 ? 2 : 1) * secW;
    bevelRect(ctx, x + 2, Math.min(ya, yb) + 2, w - 4, Math.abs(yb - ya) - 4, 2, 0.5);
  }

  // Radial seams (spokes), deeper every fourth — the structural frames.
  for (let i = 0; i < HULL_SECTORS; i++) {
    grooveV(ctx, i * secW, i % 4 === 0 ? 2 : 1, i % 4 === 0 ? 0.62 : 0.4, S);
  }
  // Ring seams, mirrored on both shells.
  for (const u of HULL_RING_US) {
    grooveH(ctx, hullTopY(u, S), 1.5, 0.42, S);
    grooveH(ctx, hullBotY(u, S), 1.5, 0.42, S);
  }
  // The rim band reads as a wrapped belt: a hard lip top and bottom.
  grooveH(ctx, hullTopY(1, S), 2.5, 0.72, S);
  grooveH(ctx, hullBotY(1, S), 2.5, 0.72, S);
  // Vent ticks in the band itself, matching the albedo's cadence.
  const rimA = hullTopY(1, S);
  for (let i = 0; i < 32; i++) {
    if (rand() < 0.35) continue;
    bevelRect(ctx, i * 16 + 3, rimA + 5 + rand() * 16, 4, 16 + rand() * 14, 1.5, 0.5);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  hullNormalCache = tex;
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

/* ---- machined plating ------------------------------------------------------
 * One tileable sheet, shared by every material that is not the lathe hull.
 * The audit's words were that the ship "reads as an untextured blockout", and
 * it was right: the hull carried a painted texture but the mandibles, cockpit,
 * turrets, greebles, housing and gear were all FLAT COLOUR, and flat colour
 * under two lights is a value with no information in it — no scale cue, no
 * craft, nothing for a highlight to travel across.
 *
 * The merged greebles are boxes, so every face carries its own 0..1 UV square
 * and this sheet lands once per face at whatever size that face happens to be.
 * That rules out large features (a bay door and a 6 cm greeble would show the
 * same panel at wildly different scales); what survives that constraint is a
 * FINE, self-similar grid with rivets and wear, which reads as machined metal
 * at any face size. One texture object on four materials: no new draw calls,
 * one upload, and the descent budget is untouched.
 */
let platingCache: THREE.CanvasTexture | null = null;
function platingTexture(): THREE.CanvasTexture {
  if (platingCache) return platingCache;
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const rand = mulberry32(0x0fa1c11);

  // Base sits high (0.92) because this sheet MULTIPLIES each material's
  // colour: authored dark, it would drag the whole freighter down a value.
  ctx.fillStyle = '#ebecef';
  ctx.fillRect(0, 0, S, S);

  const CELLS = 16;
  const cw = S / CELLS;

  // Per-cell tonal drift, so no two plates on a face read as the same alloy.
  for (let y = 0; y < CELLS; y++) {
    for (let x = 0; x < CELLS; x++) {
      const r = rand();
      ctx.fillStyle =
        r < 0.16
          ? `rgba(96, 102, 112, ${(0.06 + rand() * 0.1).toFixed(3)})` // swapped plate
          : `rgba(255, 255, 255, ${(rand() * 0.05).toFixed(3)})`;
      ctx.fillRect(x * cw, y * cw, cw, cw);
    }
  }

  // Seam grid, heavier every fourth line so a face reads as plating rather
  // than as graph paper. Drawn on the cell boundaries, both axes.
  for (let i = 0; i < CELLS; i++) {
    const heavy = i % 4 === 0;
    ctx.strokeStyle = heavy ? 'rgba(52, 58, 68, 0.32)' : 'rgba(52, 58, 68, 0.16)';
    ctx.lineWidth = heavy ? 2.4 : 1.4;
    const p = i * cw;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, S);
    ctx.moveTo(0, p);
    ctx.lineTo(S, p);
    ctx.stroke();
  }

  // Rivet runs along the heavy seams — the detail that says "fabricated".
  ctx.fillStyle = 'rgba(74, 80, 90, 0.34)';
  for (let i = 0; i < CELLS; i += 4) {
    for (let j = 0; j < S; j += 11) {
      if (rand() < 0.3) continue;
      ctx.beginPath();
      ctx.arc(i * cw + 4, j, 1.5, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(j, i * cw + 4, 1.5, 0, TAU);
      ctx.fill();
    }
  }

  // Scuffs and grime streaks, aligned to nothing in particular.
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(84, 82, 76, ${(0.03 + rand() * 0.07).toFixed(3)})`;
    ctx.fillRect(rand() * S, rand() * S, 3 + rand() * 40, 2 + rand() * 9);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  platingCache = tex;
  return tex;
}

/** The plating sheet's seams and rivets, in normals. Same 16-cell grid, same
 *  every-fourth emphasis, so a face lit from the side shows the plate edges
 *  the albedo only draws. Deliberately shallower than the hull's: this sheet
 *  lands once per box FACE at whatever size that face is, and a deep bevel on
 *  a 6 cm greeble would read as a dent. */
let platingNormalCache: THREE.CanvasTexture | null = null;
function platingNormalTexture(): THREE.CanvasTexture {
  if (platingNormalCache) return platingNormalCache;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const rand = mulberry32(0x0fa1c19);

  ctx.fillStyle = N_FLAT;
  ctx.fillRect(0, 0, S, S);

  const CELLS = 16;
  const cw = S / CELLS;
  // A few plates standing proud, on the cell grid.
  for (let i = 0; i < 22; i++) {
    const x = Math.floor(rand() * CELLS) * cw;
    const y = Math.floor(rand() * CELLS) * cw;
    const w = (1 + Math.floor(rand() * 3)) * cw;
    const h = (1 + Math.floor(rand() * 2)) * cw;
    bevelRect(ctx, x + 1, y + 1, w - 2, h - 2, 1.5, 0.34);
  }
  for (let i = 0; i < CELLS; i++) {
    const heavy = i % 4 === 0;
    grooveV(ctx, i * cw, heavy ? 1.5 : 1, heavy ? 0.5 : 0.3, S);
    grooveH(ctx, i * cw, heavy ? 1.5 : 1, heavy ? 0.5 : 0.3, S);
  }
  // Rivets: a lit crescent and a shadowed one, two pixels apart. At the size
  // these land on screen that is all a rivet ever is.
  for (let i = 0; i < CELLS; i += 4) {
    for (let j = 0; j < S; j += 11) {
      if (rand() < 0.3) continue;
      for (const [px, py] of [
        [i * cw + 4, j],
        [j, i * cw + 4],
      ] as ReadonlyArray<readonly [number, number]>) {
        ctx.fillStyle = 'rgb(96,150,255)';
        ctx.fillRect(px - 1.5, py - 1.5, 3, 1.5);
        ctx.fillStyle = 'rgb(160,106,255)';
        ctx.fillRect(px - 1.5, py, 3, 1.5);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  platingNormalCache = tex;
  return tex;
}

/* ---- wear map: roughness in G, metalness in B ------------------------------
 * three multiplies material.roughness by roughnessMap.g and material.metalness
 * by metalnessMap.b, so ONE sheet in both slots breaks up the uniform sheen
 * that made the freighter look injection-moulded. Grimy patches go rough and
 * matte, bare plate stays tighter and more metallic, and the HDRI reflection
 * finally has something to catch on as the ship turns. Every material's base
 * roughness/metalness is raised to cover this sheet's mean, so the average
 * lands where it was already tuned — only the VARIANCE is new.
 */
const WEAR_G = 0.82; // mean of the green channel, as a fraction
const WEAR_B = 0.75; // mean of the blue channel
let wearCache: THREE.CanvasTexture | null = null;
function wearTexture(): THREE.CanvasTexture {
  if (wearCache) return wearCache;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const rand = mulberry32(0x0fa1c13);

  ctx.fillStyle = `rgb(255, ${Math.round(WEAR_G * 255)}, ${Math.round(WEAR_B * 255)})`;
  ctx.fillRect(0, 0, S, S);

  // Overlapping low-alpha rects instead of a blur filter: ctx.filter is not
  // universal, and stacking soft rectangles gets the same cloudy field with
  // nothing to feature-detect at runtime.
  for (let i = 0; i < 240; i++) {
    const rough = rand() < 0.55;
    // Rough patches: high G (dull), low B (the plate's coating is gone).
    // Polished patches: low G, high B — bare metal that has been rubbed.
    const g = rough ? 210 + rand() * 45 : 120 + rand() * 70;
    const b = rough ? 90 + rand() * 70 : 200 + rand() * 55;
    ctx.fillStyle = `rgba(255, ${Math.round(g)}, ${Math.round(b)}, ${(0.06 + rand() * 0.1).toFixed(3)})`;
    const w = 10 + rand() * 90;
    const h = 8 + rand() * 70;
    ctx.fillRect(rand() * S - w / 2, rand() * S - h / 2, w, h);
  }

  // Seams and edges collect grime: a rougher, less metallic grid that lines up
  // with the plating sheet's cell boundaries.
  ctx.strokeStyle = 'rgba(255, 255, 110, 0.26)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const p = (i * S) / 8;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, S);
    ctx.moveTo(0, p);
    ctx.lineTo(S, p);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  // Data, not colour: sRGB-decoding a roughness sheet would skew every value.
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  wearCache = tex;
  return tex;
}

/* ---- fresnel rim -----------------------------------------------------------
 * The other half of "the ship loses all separation against bright bodies": at
 * Saturn and Jupiter the freighter is a mid-grey shape on a pale disc, and no
 * amount of albedo detail draws the OUTLINE. A grazing-angle term adds a thin
 * cool edge all the way round the silhouette — the light every real render has
 * from the sky behind the subject, and the cheapest possible way to buy it: a
 * dot product and a pow in the fragment shader, no extra geometry, no extra
 * draw call, no extra pass.
 *
 * Injected at <opaque_fragment>, which is the first point where three has both
 * geometryNormal and geometryViewDir in scope and outgoingLight assembled.
 */
const RIM_TINT = 'vec3(0.44, 0.62, 0.88)'; // cool starlight, a cousin of HYPER_CORE
/* The half of the ship the sun is actually on gets a HARDER, warmer edge —
 * the hot key-light wrap every practical render has and this one did not,
 * because a constant fresnel lights the shadow side exactly as brightly as the
 * lit side and so says nothing about where the light is.
 *
 * It needs no sun position and no uniform to update: by the time three reaches
 * <opaque_fragment> it has already summed every direct light into
 * reflectedLight, so the fragment can simply ASK how lit it is. That keeps the
 * term correct through the whole flight — the sun's pulse, the hyperdrive's
 * own point light, the swing from Earth to the sun and back — with no plumbing
 * between this file and Scene3D's light rig at all. */
const RIM_SUN = 'vec3(1.00, 0.83, 0.62)'; // the sun light's colour, warmed
const RIM_KEY_K = 2.6; // how fast "lit" saturates; higher = harder terminator
// The exponent is the whole difference between an edge light and a wash. The
// hull is a flattened DISC, so at the docked three-quarter views most of its
// upper shell already sits at a shallow angle to the lens: at pow 3.2 the term
// lifted the entire top of the ship and the freighter came out BRIGHTER than
// the sun behind it — measured, the sun frame's median went the wrong way. At
// 5.0 the term collapses onto the last few degrees before the silhouette,
// which is the only place it was ever meant to be.
const RIM_POWER = 5.0;

function withRim(mat: THREE.MeshStandardMaterial, strength: number, sunGain: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float rimK = pow(1.0 - abs(dot(geometryNormal, geometryViewDir)), ${RIM_POWER.toFixed(1)});
       // How much DIRECT light reached this fragment, as a 0..1 key term. The
       // shadow side keeps the cool starlight edge; the sunward side gets a
       // hotter, brighter one, and the terminator between them is the shape.
       float rimLit = dot(reflectedLight.directDiffuse + reflectedLight.directSpecular,
                          vec3(0.2126, 0.7152, 0.0722));
       float rimKey = 1.0 - exp2(-rimLit * ${RIM_KEY_K.toFixed(1)});
       outgoingLight += mix(${RIM_TINT}, ${RIM_SUN}, rimKey) * rimK *
                        (${strength.toFixed(3)} + rimKey * ${sunGain.toFixed(3)});
       #include <opaque_fragment>`,
    );
  };
  // three caches compiled programs against the material's PARAMETERS, not the
  // source onBeforeCompile handed back, so the cache key has to name the patch
  // or a rim-patched material and an unpatched one with identical parameters
  // would silently share whichever program compiled first. Keying on the
  // STRENGTH rather than on the material is the point: every material that
  // asks for the same rim compiles one program between them, and Scene3D's
  // warm-up pays for that program once per light signature instead of once per
  // material per light signature.
  mat.customProgramCacheKey = () => `falcon-rim-${strength.toFixed(3)}-${sunGain.toFixed(3)}`;
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

/* ==== EMISSIVE LAMP SYSTEM ===================================================
 * Everything on this ship that GLOWS — the hyperdrive plume, the belly
 * repulsor, the nav lamps, the strobes and the attitude jets — is one mesh,
 * one draw call, one program. Three sprites used to cost three draws between
 * them and could only ever be a texture stretched two ways; a quad batch with
 * a falloff EXPONENT per quad buys a real layered plume (a tight hot core, a
 * soft shroud, a wide wash) plus a dozen lamps for fewer draws than the
 * sprites cost, and every one of them is driven by an eight-float uniform
 * rather than by touching a material per frame.
 *
 * Two billboard modes:
 *   SCREEN  the quad faces the lens outright. Lamps and jets: point sources,
 *           which look the same from everywhere.
 *   AXIAL   the quad's long axis is pinned to the ship's local X — the line
 *           of the stern band — and it spins about that axis to face the
 *           lens. A screen-facing plume rotates with the camera and slides off
 *           the engine; an axial one stays welded to the strip it comes out of.
 * ========================================================================= */

/** Channel index. A quad's brightness is uChanA/uChanB dotted with its one-hot
 *  pair, so adding a behaviour never touches the shader's structure. */
const CH_PLUME = 0;
const CH_HOT = 1;
const CH_BELLY = 2;
const CH_NAV = 3;
const CH_STROBE = 4;
const CH_RCS_P = 5;
const CH_RCS_S = 6;
const CH_SHROUD = 7;

type Lamp = {
  /** Centre, ship-local. */
  p: readonly [number, number, number];
  /** Half-extents along the quad's own axes, in ship units. */
  w: number;
  h: number;
  /** Falloff exponent: 1 is a soft wash, 3+ is a hard point. */
  e: number;
  /** 0 = screen billboard, 1 = axial about ship X. */
  mode: 0 | 1;
  /** Peak colour. Over 1.0 on purpose where the lamp should feed bloom. */
  c: readonly [number, number, number];
  ch: number;
};

const HOT_RGB = [0.78, 0.9, 1.05] as const; // #b9dcff, hot end
const CORE_RGB = [0.33, 0.56, 0.98] as const; // #7db8ff, the wash
const NAV_PORT = [1.0, 0.3, 0.13] as const; // accent orange, the console's own
const NAV_STBD = [0.34, 0.7, 1.0] as const; // hud cyan, ditto
const STROBE_RGB = [1.35, 1.42, 1.55] as const;
const RCS_RGB = [0.72, 0.86, 1.15] as const;

/** A point on the stern band's arc at angle th, radius r from the disc centre. */
function bandPt(th: number, r: number): readonly [number, number, number] {
  return [r * Math.sin(th), 0, DISC_CZ + r * Math.cos(th)] as const;
}

function buildLamps(high: boolean): Lamp[] {
  const L: Lamp[] = [];

  /* --- PLUME: three layers, all axial on the band's line ------------------
   * The exponents are the whole design. A low exponent is a FOG — it fills a
   * big soft area with low alpha, and five of them stacked turn the stern into
   * a weather system rather than an engine. The layers are therefore tight
   * (2.5-3) and small, and they get their depth from being three distinct
   * shells at three radii, not from any one of them being broad. */
  // Core: five tight, hot licks sitting just aft of the emissive strip.
  for (const th of [-0.5, -0.25, 0, 0.25, 0.5]) {
    L.push({ p: bandPt(th, 1.82), w: 0.27, h: 0.125, e: 2.7, mode: 1, c: HOT_RGB, ch: CH_PLUME });
  }
  // Shroud: the cooler envelope the core burns inside, further aft and softer.
  for (const th of [-0.44, -0.15, 0.15, 0.44]) {
    L.push({ p: bandPt(th, 2.08), w: 0.44, h: 0.24, e: 2.1, mode: 1, c: CORE_RGB, ch: CH_SHROUD });
  }
  // Wash: one wider, softer body so the plume has a far edge instead of
  // stopping dead where the shroud quads end.
  L.push({
    p: [0, 0, DISC_CZ + 2.5],
    w: 1.05,
    h: 0.34,
    e: 1.9,
    mode: 1,
    c: [0.13, 0.24, 0.52],
    ch: CH_SHROUD,
  });
  // The bloom feeder: a thin white-hot line ON the strip. Authored over 1.0 so
  // it crosses the bloom threshold and the engine reads as a light SOURCE
  // rather than as a bright surface. High only — this is the one lamp whose
  // whole job is to make the post chain work harder.
  L.push({
    p: [0, 0, DISC_CZ + 1.78],
    w: 0.92,
    h: 0.075,
    e: 3.2,
    mode: 1,
    c: high ? [1.75, 1.95, 2.2] : [1.15, 1.35, 1.6],
    ch: CH_HOT,
  });
  if (high) {
    // A long, almost-not-there tail. It costs one quad and it is the whole
    // difference between an engine that glows and an engine that is throwing
    // something out the back.
    L.push({
      p: [0, 0, DISC_CZ + 3.75],
      w: 1.45,
      h: 0.3,
      e: 1.7,
      mode: 1,
      c: [0.07, 0.14, 0.32],
      ch: CH_SHROUD,
    });
  }

  /* --- BELLY REPULSOR ----------------------------------------------------- */
  L.push({
    p: [0, -0.74, 0.3],
    w: 1.25,
    h: 0.6,
    e: 1.3,
    mode: 0,
    c: CORE_RGB,
    ch: CH_BELLY,
  });

  /* --- NAV LAMPS: port red-orange, starboard cyan, on the mandible tips ---
   * Aviation convention, in the console's own palette rather than in traffic
   * colours. Each is a hard point PLUS a soft companion at the same spot: the
   * companion is the light pooling on the plate around it, which is what sells
   * a lamp as being ON the hull instead of floating in front of it. */
  const navSides: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
    [1, NAV_STBD],
    [-1, NAV_PORT],
  ];
  for (const [side, col] of navSides) {
    // Clear of the slab (half-thickness 0.14) and of the dorsal spine that
    // runs out to the tip at y 0.18 — a lamp buried in its own hull is a lamp
    // the depth test eats from every angle but one.
    L.push({
      p: [side * 0.6, 0.215, -2.1],
      w: 0.06,
      h: 0.06,
      e: 3.0,
      mode: 0,
      c: col,
      ch: CH_NAV,
    });
    L.push({
      p: [side * 0.6, 0.185, -2.04],
      w: 0.3,
      h: 0.23,
      e: 1.7,
      mode: 0,
      c: [col[0] * 0.32, col[1] * 0.32, col[2] * 0.32],
      ch: CH_NAV,
    });
  }

  /* --- STROBES: dorsal and ventral, on the hull's own surface -------------- */
  for (const up of [1, -1] as const) {
    const y = up * (surfaceY(0, -0.75) + 0.02);
    L.push({ p: [0, y, -0.75], w: 0.07, h: 0.07, e: 3.0, mode: 0, c: STROBE_RGB, ch: CH_STROBE });
    // The pool of light the flash throws on the plate around it. Kept well
    // under the lamp itself: at parity the flash reads as a white patch
    // painted on the deck rather than as a beacon sitting on it.
    L.push({
      p: [0, y + up * 0.01, -0.75],
      w: 0.36,
      h: 0.27,
      e: 1.9,
      mode: 0,
      c: [0.26, 0.29, 0.36],
      ch: CH_STROBE,
    });
  }

  /* --- ATTITUDE JETS: two couples, fore-outboard + aft-opposite ------------
   * A yaw is a COUPLE, so the jets fire in diagonal pairs: nose pushed one way
   * by the forward thruster, tail the other by the aft one. Which pair lights
   * is read from the ship's own angular velocity, so they answer the spline's
   * curvature and the bank without the Rig having to tell them anything. */
  for (const [ch, sFore, sAft] of [
    [CH_RCS_P, -1, 1],
    [CH_RCS_S, 1, -1],
  ] as ReadonlyArray<readonly [number, number, number]>) {
    L.push({
      p: [sFore * 1.13, 0, -0.83],
      w: 0.115,
      h: 0.115,
      e: 2.2,
      mode: 0,
      c: RCS_RGB,
      ch,
    });
    L.push({ p: [sAft * 1.6, 0, 0.84], w: 0.115, h: 0.115, e: 2.2, mode: 0, c: RCS_RGB, ch });
  }

  return L;
}

/** Quad batch: four corners per lamp, centre in `position`, corner sign in
 *  `aCorner`, and the rest as flat per-vertex constants. */
function buildLampGeometry(lamps: readonly Lamp[]): THREE.BufferGeometry {
  const n = lamps.length;
  const pos = new Float32Array(n * 12);
  const corner = new Float32Array(n * 8);
  const spec = new Float32Array(n * 16);
  const col = new Float32Array(n * 12);
  const chA = new Float32Array(n * 16);
  const chB = new Float32Array(n * 16);
  const idx = new Uint16Array(n * 6);
  const CORNERS = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  lamps.forEach((l, i) => {
    for (let v = 0; v < 4; v++) {
      const c = CORNERS[v] ?? [0, 0];
      const p3 = (i * 4 + v) * 3;
      const p2 = (i * 4 + v) * 2;
      const p4 = (i * 4 + v) * 4;
      pos[p3] = l.p[0];
      pos[p3 + 1] = l.p[1];
      pos[p3 + 2] = l.p[2];
      corner[p2] = c[0];
      corner[p2 + 1] = c[1];
      spec[p4] = l.w;
      spec[p4 + 1] = l.h;
      spec[p4 + 2] = l.e;
      spec[p4 + 3] = l.mode;
      col[p3] = l.c[0];
      col[p3 + 1] = l.c[1];
      col[p3 + 2] = l.c[2];
      if (l.ch < 4) chA[p4 + l.ch] = 1;
      else chB[p4 + (l.ch - 4)] = 1;
    }
    const o = i * 4;
    idx.set([o, o + 1, o + 2, o, o + 2, o + 3], i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aSpec', new THREE.BufferAttribute(spec, 4));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aChanA', new THREE.BufferAttribute(chA, 4));
  g.setAttribute('aChanB', new THREE.BufferAttribute(chB, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // The corners live in the shader, so a bounding sphere off the centres alone
  // would cull the plume the moment its centre left frame. Sized to the
  // envelope by hand instead.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, DISC_CZ), 9);
  return g;
}

const LAMP_VERT = /* glsl */ `
uniform vec4 uChanA;
uniform vec4 uChanB;
attribute vec2 aCorner;
attribute vec4 aSpec;   // [halfW, halfH, falloff exponent, mode]
attribute vec3 aColor;
attribute vec4 aChanA;
attribute vec4 aChanB;
varying vec2 vC;
varying vec3 vCol;
varying float vExp;
void main() {
  float k = dot(uChanA, aChanA) + dot(uChanB, aChanB);
  vCol = aColor * k;
  vExp = aSpec.z;
  vC = aCorner;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // The parent scales the whole freighter, so the lamps have to read that
  // scale off the matrix or they would swell as the ship shrank.
  float sc = length(modelViewMatrix[0].xyz);
  // A hotter lamp is also a BIGGER one — the bloom of a real light source
  // grows with its output, and a plume that only brightens reads as painted.
  float g = sc * (0.74 + 0.4 * clamp(k, 0.0, 1.6));
  vec3 off;
  if (aSpec.w < 0.5) {
    off = vec3(aCorner.x * aSpec.x, aCorner.y * aSpec.y, 0.0) * g;
  } else {
    vec3 axis = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
    vec3 up = cross(axis, normalize(-mv.xyz));
    float ul = length(up);
    // Dead-on down the axis there is no perpendicular to pick; anything
    // stable will do, because the quad is edge-on and about to vanish anyway.
    up = ul > 1e-3 ? up / ul : vec3(0.0, 1.0, 0.0);
    off = (axis * (aCorner.x * aSpec.x) + up * (aCorner.y * aSpec.y)) * g;
  }
  gl_Position = projectionMatrix * vec4(mv.xyz + off, 1.0);
}`;

const LAMP_FRAG = /* glsl */ `
varying vec2 vC;
varying vec3 vCol;
varying float vExp;
void main() {
  float r = length(vC);
  if (r > 1.0) discard;
  // pow() on a 0..1 ramp IS the falloff: 1.1 is a fog, 3+ is a filament.
  float a = pow(1.0 - r, vExp);
  float lum = max(max(vCol.r, vCol.g), vCol.b) * a;
  if (lum < 0.004) discard;
  gl_FragColor = vec4(vCol, a);
}`;

/* ---- world-space trail -----------------------------------------------------
 * The signature system, kept exactly in architecture: points live in SCENE
 * space (portal) so the wash arcs along the flight path; ring buffer recycled
 * in place; real-metre projected sizing via uH; screen-space smear along
 * travel RELATIVE to the camera. Emission is spread across the stern strip
 * following the band's arc — white-blue aging, 2.4 s life, alpha peak ~0.45.
 */
/* Pool CAPACITY, and the slice of it a mid-tier machine runs. 260 is what has
 * always shipped, so mid draws exactly that many; the extra slots exist only
 * so the high tier has somewhere to put its denser wash. Every per-slot array
 * below is seeded in one pass, so the first 260 slots hold the same values
 * they always did — the buffer grew, the shipped exhaust did not change. */
const T_COUNT = 360;
const T_ACTIVE_MID = 260;
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
const SCRATCH_DQ = new THREE.Quaternion();
const SCRATCH_STEP = new THREE.Vector3();

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
  /** Emitter world position last frame — the step a birth is backdated along. */
  emitPrev: THREE.Vector3;
  emitInit: boolean;
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
    emitPrev: new THREE.Vector3(),
    emitInit: false,
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
  // Read ONCE. Every branch below is a build-time decision — which maps get
  // bound, how many particles the pool runs, how hot the bloom feeder is —
  // and none of them is ever re-read inside useFrame.
  const q = useQuality();
  const rich = q.tier !== 'low'; // normal-mapped panel lines cost a fetch
  // `&& !q.mobile`: what `high` unlocks below is a MeshPhysicalMaterial with a
  // clearcoat and anisotropy on the hull — a materially more expensive shader
  // over the one object that is on screen in every single frame of the
  // voyage. That is a fill-rate spend, and fill rate is exactly where a
  // handheld and a desktop at the same nominal tier are least alike.
  const high = q.tier === 'high' && !q.mobile;
  const groupRef = useRef<THREE.Group | null>(null);
  const dishRef = useRef<THREE.Group | null>(null);
  const gearGroupRef = useRef<THREE.Group | null>(null);
  const doorRefs = useRef<Array<THREE.Mesh | null>>([null, null, null, null, null, null]);
  /** Damped follower for the gear pose, and its velocity — see the spring in
   *  useFrame. -1 forces the first frame to adopt gearRef outright. */
  const gearVis = useRef(-1);
  const gearVel = useRef(0);
  const gearPrev = useRef(-1);
  const lightRef = useRef<THREE.PointLight | null>(null);
  /** Ship attitude last frame, for the angular velocity the jets answer to. */
  const attPrev = useRef(new THREE.Quaternion());
  const attInit = useRef(false);
  /** Slow average of the turn rate — the baseline a jet burst is measured
   *  against, so a steady sweep reads as no thrust at all. */
  const turnAvg = useRef(0);
  const jetP = useRef(0);
  const jetS = useRef(0);
  const trail = useMemo(makeTrailState, []);

  /** How much of the trail pool this tier runs. The buffers are module-scope
   *  and full size; the draw range and the ring cursor are what move, so a
   *  demotion mid-flight costs nothing and drops no live particle. */
  const trailCount = Math.min(
    T_COUNT,
    Math.max(72, Math.round(T_ACTIVE_MID * q.particleScale)),
  );
  const lampGeo = useMemo(() => buildLampGeometry(buildLamps(high)), [high]);
  useEffect(() => () => lampGeo.dispose(), [lampGeo]);

  const { mats, trailU, lampU } = useMemo(() => {
    const lampUniforms = {
      // [plume, hot core, belly repulsor, nav lamps]
      uChanA: { value: new THREE.Vector4(0, 0, 0, 0) },
      // [strobe, jets port couple, jets starboard couple, plume shroud]
      uChanB: { value: new THREE.Vector4(0, 0, 0, 0) },
    };
    const trailUniforms = {
      uH: { value: 720 },
      uAspect: { value: 16 / 9 },
      uCamVel: { value: new THREE.Vector3() },
    };
    // Surface treatment, shared across the freighter: the plating sheet on
    // everything that used to be flat colour, the wear sheet in both the
    // roughness and metalness slots, and a fresnel rim on all four hull
    // materials. Base roughness/metalness are divided by the wear sheet's
    // mean so the AVERAGE stays exactly where it was tuned across twelve
    // rounds — the variance is the only new thing. Colours are lifted part of
    // the way to cover the plating sheet's mean: only part, because the ship
    // sitting a shade below Saturn's cream disc is precisely the separation
    // the audit asked for.
    const plating = platingTexture();
    const wear = wearTexture();
    // Texture filtering is a budget knob now: 8 is what shipped, 16 is close
    // to free on a desktop GPU and distinctly not on a tiler. Anisotropy is
    // SAMPLER state, so it is set and NOT flagged — three picks it up in
    // setTextureParameters on the next bind, and flagging needsUpdate here
    // would re-upload the hull, plating and normal canvases (module-cached
    // singletons shared across every mount) to change one integer. The tier's
    // build budget is frozen at mount now, so this value settles once, before
    // the first upload, and never moves again within a session.
    const setAniso = (tex: THREE.Texture): void => {
      tex.anisotropy = q.anisotropy;
    };
    const hullMap = hullTexture();
    // Panel-line normals: the raking-light detail. Skipped entirely at low,
    // where the fetch buys less than it costs — and the canvas is never even
    // built there, so the memory goes with it.
    const hullN = rich ? hullNormalTexture() : null;
    const plateN = rich ? platingNormalTexture() : null;
    // The normal sheets want the filtering MORE than the albedo does: a panel
    // line seen at a grazing angle is exactly the case anisotropy exists for,
    // and it is also exactly where an unfiltered normal map turns to noise.
    for (const tex of [hullMap, plating, hullN, plateN]) if (tex) setAniso(tex);
    const nScale = (x: number): THREE.Vector2 => new THREE.Vector2(x, x);

    const hullParams = {
      map: hullMap,
      roughnessMap: wear,
      metalnessMap: wear,
      color: '#ffffff',
      roughness: 0.62 / WEAR_G,
      metalness: 0.25 / WEAR_B,
      envMapIntensity: 0.7,
      ...(hullN ? { normalMap: hullN, normalScale: nScale(0.7) } : {}),
    };
    // A HINT of anisotropy, desktop-high only. The hull's UVs run u around the
    // azimuth, so brushing along u is brushing in rings about the ship's axis
    // — which is how a lathed plate is actually finished, and it means the sun
    // travels along the hull as an arc rather than sitting on it as a spot.
    // It is a MeshPhysicalMaterial branch and therefore a second program, so
    // it is the one piece of surface treatment gated on the top tier alone.
    const hull: THREE.MeshStandardMaterial = high
      ? new THREE.MeshPhysicalMaterial({ ...hullParams, anisotropy: 0.34, anisotropyRotation: 0 })
      : new THREE.MeshStandardMaterial(hullParams);
    const grey = new THREE.MeshStandardMaterial({
      map: plating,
      roughnessMap: wear,
      metalnessMap: wear,
      color: '#b8bcc1',
      roughness: 0.62 / WEAR_G,
      metalness: 0.25 / WEAR_B,
      envMapIntensity: 0.7,
      ...(plateN ? { normalMap: plateN, normalScale: nScale(0.55) } : {}),
    });
    const greyDark = new THREE.MeshStandardMaterial({
      map: plating,
      roughnessMap: wear,
      metalnessMap: wear,
      color: '#92969b',
      roughness: 0.7 / WEAR_G,
      metalness: 0.3 / WEAR_B,
      envMapIntensity: 0.6,
      ...(plateN ? { normalMap: plateN, normalScale: nScale(0.55) } : {}),
    });
    const dark = new THREE.MeshStandardMaterial({
      map: plating,
      roughnessMap: wear,
      metalnessMap: wear,
      color: '#3a3e46',
      roughness: 0.5 / WEAR_G,
      metalness: 0.6 / WEAR_B,
      side: THREE.DoubleSide,
      ...(plateN ? { normalMap: plateN, normalScale: nScale(0.4) } : {}),
    });
    // Two tiers, not four. The plate materials own the outline and take the
    // full rim; the dark furniture is edges and recesses all the way down, and
    // at full strength every greeble picked out its own corners until the
    // stern deck read as a glowing wireframe. Two tiers is also two shader
    // programs instead of four — see withRim on why the strength is the key.
    // The second number is the SUNWARD bonus: the plates take a hard hot edge
    // where the key hits them, the dark furniture almost none, because a
    // recess that catches the sun as brightly as the plate around it stops
    // reading as a recess.
    for (const m of [hull, grey, greyDark]) withRim(m, 0.22, 0.42);
    withRim(dark, 0.12, 0.16);

    return {
      trailU: trailUniforms,
      lampU: lampUniforms,
      mats: {
        hull,
        grey,
        greyDark,
        dark,
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
        // Plume, repulsor, nav lamps, strobes and jets — one material, one
        // program, one draw. Depth-TESTED (the hull must occlude a lamp on its
        // far side) but never depth-writing, because everything here is light.
        lamps: new THREE.ShaderMaterial({
          uniforms: lampUniforms,
          vertexShader: LAMP_VERT,
          fragmentShader: LAMP_FRAG,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
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
    // Tier is the only dependency, and it moves at most twice a session and
    // only downward — so this rebuilds materials essentially never.
  }, [rich, high, q.anisotropy]);

  // Per-mount resources go away with the component; module-scope geometry
  // and cached canvas textures are shared across visits on purpose.
  useEffect(() => {
    return () => {
      trail.geo.dispose();
      for (const m of Object.values(mats)) m.dispose();
    };
  }, [trail, mats]);

  // The pool is allocated once at full size; the tier only decides how much of
  // it is drawn and how far the ring cursor walks. A demotion mid-flight is
  // therefore free and cannot strand a live particle outside the draw range.
  useEffect(() => {
    trail.geo.setDrawRange(0, trailCount);
    if (trail.cursor >= trailCount) trail.cursor = 0;
  }, [trail, trailCount]);

  useFrame((state, rawDt) => {
    // Clamp dt: a backgrounded tab must not dump a giant step into the sim.
    const dt = Math.min(rawDt, 0.05);
    const thrust = thrustRef.current;
    const t = state.clock.elapsedTime;

    // ---- hyperdrive band: intensity TRACKS thrust (state, allowed under
    // reduced); the flicker is motion, gated off.
    //
    // TWO SUMMED SINES, NOT NOISE. A random-per-frame flicker is what a
    // screensaver does: it is frame-rate dependent, it never repeats a shape,
    // and it reads as a fault in the render rather than as combustion. Two
    // detuned sines beat against each other on a period neither of them has,
    // which is what an unstable burn actually looks like, and it is identical
    // at 30fps and at 120. The fast pair is the burn; the slow pair below is
    // the IDLE — a calm breath so a coasting ship is never quite dead.
    const flick = reduced ? 0 : 0.05 * Math.sin(t * 12.4) + 0.035 * Math.sin(t * 7.9 + 1.3);
    const idle = reduced ? 0 : 0.045 * Math.sin(t * 1.31) + 0.03 * Math.sin(t * 2.07 + 2.2);
    mats.engineCore.emissiveIntensity = (1.2 + thrust * 2.6) * (1 + flick);
    mats.engineHot.emissiveIntensity = (1.7 + thrust * 3.0) * (1 + flick);

    // ---- THE PLUME. Three layers off one thrust value, each with its own
    // curve: the shroud is broad and lags behind the throttle, the core tracks
    // it, and the hot filament is quadratic so it only shows up when the
    // engine is really working. The 0.13 floor is the idle glow — the strip
    // is emissive at rest, so the air in front of it has to be too.
    const burn = thrust > 0 ? thrust : 0;
    const chA = lampU.uChanA.value;
    const chB = lampU.uChanB.value;
    chA.x = (0.13 + burn * 0.92) * (1 + flick * burn + idle); // plume core
    chA.y = 0.05 + burn * burn * 1.15; // hot filament (bloom feeder)
    chA.z = burn > 0.6 ? Math.min(0.62, (burn - 0.6) * 1.3) : 0; // belly repulsor
    chA.w = 1; // nav lamps: steady, always lit, cheap and still under reduced
    chB.w = (0.09 + burn * 0.62) * (1 + idle * 0.6); // plume shroud

    const light = lightRef.current;
    if (light) light.intensity = thrust * 22;

    // ---- LANDING GEAR. The value comes from gearRef, but what the legs
    // actually do is chase it through a spring: gear that arrives exactly when
    // the ramp says so arrives with zero velocity and reads as a prop being
    // slid into place. Slightly under-damped, so the struts overshoot by a
    // hair and settle — the weight of the thing, which is the only reason to
    // animate this at all. Under reduced the spring is skipped outright and
    // the pose snaps, as every other animation here does.
    const raw = gearRef ? gearRef.current : 0;
    // Written so a NaN falls through to 0 rather than poisoning the transform.
    const gear = raw > 0 ? (raw < 1 ? raw : 1) : 0;
    if (reduced || gearVis.current < 0) {
      gearVis.current = gear;
      gearVel.current = 0;
    } else if (Math.abs(gear - gearVis.current) > 1e-4 || Math.abs(gearVel.current) > 1e-4) {
      // Semi-implicit Euler at a stiffness the clamped dt cannot destabilise.
      // k=34, c=8.2 is zeta 0.70: about 4.6% overshoot, settled inside a
      // second. The ceiling is 1.03 and not the spring's natural peak because
      // over-extension pushes the soles BELOW the plane the finale stands the
      // craft on — 1.3cm for a fifth of a second, mid-descent and metres off
      // the deck, is a settle; 4.6% at the wrong moment would be a foot
      // through the pier.
      gearVel.current += ((gear - gearVis.current) * 34 - gearVel.current * 8.2) * dt;
      gearVis.current += gearVel.current * dt;
      if (gearVis.current < 0) gearVis.current = 0;
      else if (gearVis.current > 1.03) gearVis.current = 1.03;
    }
    const gv = gearVis.current;
    if (Math.abs(gv - gearPrev.current) > 1e-4) {
      gearPrev.current = gv;
      const gg = gearGroupRef.current;
      if (gg) {
        const shown = gv > 0.02;
        gg.visible = shown;
        if (shown) gg.position.y = (1 - gv) * GEAR_TUCK;
      }
      // Doors lead the legs: fully open by gear 0.4, smoothstepped.
      const o = Math.min(1, gv / 0.4);
      const angle = o * o * (3 - 2 * o) * DOOR_MAX;
      for (let i = 0; i < 6; i++) {
        const d = doorRefs.current[i];
        if (d) d.rotation.z = i % 2 === 0 ? angle : -angle;
      }
    }

    // Everything past here is pure motion — parked entirely under reduced.
    if (reduced) {
      chB.x = 0;
      chB.y = 0;
      chB.z = 0;
      return;
    }

    // ---- STROBE: two hard flashes 0.19s apart, then 2.4s of nothing. That
    // double-blink is the cadence every anti-collision beacon in the sky uses
    // and the reason a light on a hull reads as a VEHICLE; a sine here would
    // read as a pulsing prop. Shaped as a squared triangle so the flash has an
    // edge on it without needing an exp().
    const cyc = t % 2.62;
    let strobe = 0;
    for (const at of [0, 0.19]) {
      const d = Math.abs(cyc - at);
      if (d < 0.075) {
        const s = 1 - d / 0.075;
        strobe = Math.max(strobe, s * s);
      }
    }
    chB.x = strobe;

    // ---- ATTITUDE JETS. Nothing tells this component that the ship is
    // turning, so it measures: the delta between this frame's orientation and
    // the last one IS the angular velocity, and for a small rotation the
    // quaternion's vector part is half the axis-angle. Yaw and roll are summed
    // because the Rig banks INTO its turns, so both say "manoeuvring", and the
    // sign says which way.
    const g0 = groupRef.current;
    let turn = 0;
    if (g0) {
      if (attInit.current && dt > 5e-4) {
        SCRATCH_DQ.copy(attPrev.current).invert().multiply(g0.quaternion);
        // A quaternion and its negation are the same rotation; pick the one
        // whose vector part has the sign of the actual motion.
        const sgn = SCRATCH_DQ.w < 0 ? -1 : 1;
        turn = ((SCRATCH_DQ.y * 2 + SCRATCH_DQ.z * 1.1) * sgn) / dt;
      }
      attPrev.current.copy(g0.quaternion);
      attInit.current = true;
    }
    // A thruster fires to CHANGE a rotation, never to hold one — nothing in
    // vacuum needs thrust to keep turning. So the jets answer the rate's
    // DEVIATION from its own slow average, not the rate: entering a bend and
    // coming out of it both spike, the long steady sweep in between does not,
    // and a docked ship is silent. Cheaper and far more stable than
    // differentiating a per-frame quaternion delta twice.
    turnAvg.current += (turn - turnAvg.current) * Math.min(1, dt * 1.6);
    const dev = turn - turnAvg.current;
    // Deadband first, then an attack/decay follower so each burst is a PUFF
    // that fades rather than a lamp that tracks.
    const fire = Math.min(1, Math.max(0, (Math.abs(dev) - 0.05) * 3.2));
    const fade = Math.max(0, 1 - dt * 3.4);
    jetP.current = Math.max(dev > 0 ? fire : 0, jetP.current * fade);
    jetS.current = Math.max(dev < 0 ? fire : 0, jetS.current * fade);
    chB.y = jetP.current;
    chB.z = jetS.current;

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
    for (let i = 0; i < trailCount; i++) {
      const age = (ages[i] ?? T_LIFE) + dt;
      ages[i] = age;
      const qi = i * 4;
      if (age >= T_LIFE) {
        drop[qi + 1] = 0;
        continue;
      }
      const k = i * 3;
      pos[k] = (pos[k] ?? 0) + (vel[k] ?? 0) * dt;
      pos[k + 1] = (pos[k + 1] ?? 0) + (vel[k + 1] ?? 0) * dt;
      pos[k + 2] = (pos[k + 2] ?? 0) + (vel[k + 2] ?? 0) * dt;
      const u = age / T_LIFE;
      const inv = 1 - u;
      drop[qi] = (T_SIZE[i] ?? 0.2) * (0.7 + u * 1.5); // wash expands as it cools
      drop[qi + 1] = 0.45 * inv * inv * Math.min(1, age * 10); // peak ~0.45, quadratic fade
    }

    // Emit across the stern strip's WORLD position, aft along WORLD +Z.
    if (thrust > T_THRUST_MIN) {
      const g = groupRef.current;
      if (g) {
        g.updateWorldMatrix(true, false);
        g.getWorldQuaternion(SCRATCH_QUAT);
        SCRATCH_DIR.set(0, 0, 1).applyQuaternion(SCRATCH_QUAT).normalize();
        // CONTINUITY. Every particle born this frame used to be stamped at the
        // ship's CURRENT position, so a frame where the freighter crossed four
        // metres laid all four of that frame's particles on top of each other
        // and left four metres of nothing behind them — a string of beads that
        // slides instead of a wash that trails. Each birth is now backdated
        // along the ship's own step by its share of the frame, which turns the
        // same particles into an even ribbon and costs one subtraction. It
        // matters most exactly where it shows most: a slow frame.
        SCRATCH_STEP.set(0, 0, 0);
        SCRATCH_POS.setFromMatrixPosition(g.matrixWorld);
        if (trail.emitInit) SCRATCH_STEP.subVectors(SCRATCH_POS, trail.emitPrev);
        trail.emitPrev.copy(SCRATCH_POS);
        trail.emitInit = true;

        const want = trail.accum + T_RATE * q.particleScale * Math.min(thrust, 1.2) * dt;
        const born = Math.floor(want);
        trail.accum = want - born;
        for (let j = 0; j < born; j++) {
          const i = trail.cursor;
          trail.cursor = (i + 1) % trailCount;
          // Fraction of the frame ago this one was born: the first of the
          // batch is the oldest, so it sits furthest back along the step.
          const back = (born - j - 0.5) / born;
          ages[i] = back * dt;
          const k = i * 3;
          const qi = i * 4;
          // Per-slot emit point spread along the band's arc, to world space.
          SCRATCH_POS.set(T_EMIT[k] ?? 0, T_EMIT[k + 1] ?? 0, T_EMIT[k + 2] ?? 2.1).applyMatrix4(
            g.matrixWorld,
          );
          pos[k] = SCRATCH_POS.x + (T_SCAT[k] ?? 0) * 0.05 - SCRATCH_STEP.x * back;
          pos[k + 1] = SCRATCH_POS.y + (T_SCAT[k + 1] ?? 0) * 0.05 - SCRATCH_STEP.y * back;
          pos[k + 2] = SCRATCH_POS.z + (T_SCAT[k + 2] ?? 0) * 0.05 - SCRATCH_STEP.z * back;
          const spd = T_SPEED[i] ?? 3.5;
          vel[k] = SCRATCH_DIR.x * spd + (T_SCAT[k] ?? 0) * 0.6;
          vel[k + 1] = SCRATCH_DIR.y * spd + (T_SCAT[k + 1] ?? 0) * 0.6;
          vel[k + 2] = SCRATCH_DIR.z * spd + (T_SCAT[k + 2] ?? 0) * 0.6;
          drop[qi + 2] = T_SOFT[i] ?? 0.3;
          drop[qi + 3] = T_SEED[i] ?? 0;
        }
      }
    } else {
      trail.accum = 0; // a coast must not bank up a burst
      trail.emitInit = false; // and must not backdate across the gap
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

      {/* EVERY light on the ship, in one draw: the layered hyperdrive plume,
          the belly repulsor, the nav lamps and their spill, the anti-collision
          strobes and the attitude jets. Driven entirely by two vec4 uniforms
          written in useFrame — no material is touched per frame and no lamp
          costs a draw call of its own. */}
      <mesh geometry={lampGeo} material={mats.lamps} renderOrder={2} />

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
