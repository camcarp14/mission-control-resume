/* ==== ROCKET 3D — the hero prop ==============================================
 *
 * A Millennium-Falcon-style light freighter built entirely from primitives
 * and canvas textures: a flat weathered saucer-disc hull, two forward
 * mandible prongs with the notch between them, an offset cylindrical cockpit
 * tube on the starboard flank ending in a dark glazed canopy, a round radar
 * dish topside, panel-line greebles everywhere — and the signature: a
 * full-width curved engine strip across the stern glowing hyperdrive blue.
 *
 * Contract (unchanged from the craft it replaces): renders at local origin,
 * nose (mandibles) along local -Z. Envelope: z in [-2.2, +2.2] (mandible
 * tips exactly at -2.2, stern band at +2.15), x in [-1.9, +1.9], y in
 * [-1.0, +1.1]. The PARENT drives position/quaternion/scale.
 *
 * LANDING: this ship lands FLAT ON ITS BELLY. Three landing-gear pads hang
 * under the disc; their soles sit at exactly local y = -1.0 — the finale
 * stands the craft on that plane. No tail-sitting, no fins.
 *
 * thrustRef is 0..1 (may spike ~1.2); `reduced` gates every continuous
 * animation (band flicker, dish sweep, trail) — value-tracking state (glow
 * intensity, sprite scale) still follows thrust.
 * ========================================================================= */

import * as THREE from 'three';
import { forwardRef, useEffect, useMemo, useRef } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { mulberry32 } from '../engine';

const TAU = Math.PI * 2;

/* Hyperdrive palette — wash, not fire. */
const HYPER_CORE = '#7db8ff';
const HYPER_HOT = '#b9dcff';

/* ---- saucer disc -----------------------------------------------------------
 * One lathe (axis = local Y, no mesh rotation needed) sweeps the whole
 * profile: bottom centre -> bottom shell -> rim edge -> top shell -> top
 * centre. Thickness 0.75 at the core tapering to 0.35 at the rim, with a
 * near-flat crown and a straight conic slope — the Falcon read, not a lens.
 */
const DISC_R = 1.8;
const DISC_CORE_HALF = 0.375;
const DISC_RIM_HALF = 0.175;
const DISC_N = 20; // segments per shell
const DISC_LAST = DISC_N * 2 + 4; // last profile index (45 points total)

function discY(u: number): number {
  if (u <= 0.3) return DISC_CORE_HALF - u * 0.1; // near-flat crown
  const w = (u - 0.3) / 0.7;
  return DISC_CORE_HALF - 0.03 - (DISC_CORE_HALF - 0.03 - DISC_RIM_HALF) * w; // conic slope
}

function makeDiscGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= DISC_N; i++) {
    const u = i / DISC_N;
    pts.push(new THREE.Vector2(Math.max(0.001, u * DISC_R), -discY(u)));
  }
  // Rim edge with a subtle equator bulge.
  pts.push(new THREE.Vector2(DISC_R + 0.015, -0.09));
  pts.push(new THREE.Vector2(DISC_R + 0.028, 0));
  pts.push(new THREE.Vector2(DISC_R + 0.015, 0.09));
  for (let i = DISC_N; i >= 0; i--) {
    const u = i / DISC_N;
    pts.push(new THREE.Vector2(Math.max(0.001, u * DISC_R), discY(u)));
  }
  return new THREE.LatheGeometry(pts, 96);
}
const DISC_GEO = makeDiscGeometry();

/* ---- hull texture ----------------------------------------------------------
 * Lathe UVs: u wraps the azimuth (canvas x -> radial seams), v runs along
 * the profile (canvas y -> ring seams at constant radius, mirrored across
 * the rim band in the middle of the canvas). Light warm grey, panel grid,
 * darker patches, rust hints, scorch streaks, greeble dots — lived-in.
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
  for (let i = 0; i < 52; i++) {
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
    ctx.fillRect(i * 16 + 5, rimA + 10 + rand() * 40, 6, 34 + rand() * 30);
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
 * Near-black glaze with thin pale frame lines: u wraps the cone, so vertical
 * canvas lines become the pane mullions.
 */
let canopyCache: THREE.CanvasTexture | null = null;
function canopyTexture(): THREE.CanvasTexture {
  if (canopyCache) return canopyCache;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#10141a';
  ctx.fillRect(0, 0, S, S);
  const sheen = ctx.createLinearGradient(0, 0, 0, S);
  sheen.addColorStop(0, 'rgba(140, 180, 220, 0.1)');
  sheen.addColorStop(0.5, 'rgba(140, 180, 220, 0.02)');
  sheen.addColorStop(1, 'rgba(140, 180, 220, 0.08)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(150, 160, 175, 0.8)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    const x = i * 32 + 16;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, S);
    ctx.stroke();
  }
  for (const y of [86, 170]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(S, y);
    ctx.stroke();
  }
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
 * Two tapered prongs extruded in the (x, forward) plane, thickness 0.3 in y,
 * rooted inside the disc at z = -1.0 and running to tips at exactly -2.2.
 * Gap between inner faces: 0.5 (x = +-0.25 .. +-0.70 at the root).
 */
function makeMandibleGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.225, 0);
  s.lineTo(0.225, 0);
  s.lineTo(0.19, 1.06);
  s.quadraticCurveTo(0.17, 1.2, 0.1, 1.2);
  s.lineTo(-0.1, 1.2);
  s.quadraticCurveTo(-0.17, 1.2, -0.19, 1.06);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false });
  g.translate(0, 0, -0.15); // center the thickness
  return g;
}
const MANDIBLE_GEO = makeMandibleGeometry();

/* ---- cockpit tube ---------------------------------------------------------- */
const COCKPIT_ANGLE = -0.205; // yawed slightly outboard, like the real thing
const COCKPIT_TUBE_GEO = new THREE.CylinderGeometry(0.26, 0.285, 1.04, 18);
const COCKPIT_RING_GEO = new THREE.TorusGeometry(0.285, 0.022, 8, 22);
const CANOPY_GEO = new THREE.CylinderGeometry(0.14, 0.26, 0.32, 14, 1, true);
const CANOPY_TIP_GEO = new THREE.SphereGeometry(0.14, 14, 10);

/* ---- topside / belly furniture --------------------------------------------- */
const CORE_DISC_GEO = new THREE.CylinderGeometry(0.55, 0.64, 0.16, 28);
const CORE_DOME_GEO = new THREE.SphereGeometry(0.24, 20, 14);
const GUN_GEO = new THREE.CylinderGeometry(0.022, 0.032, 0.34, 8);
const BELLY_TURRET_GEO = new THREE.CylinderGeometry(0.3, 0.34, 0.12, 20);
const BELLY_DOME_GEO = new THREE.SphereGeometry(0.2, 16, 12);
const DISH_POST_GEO = new THREE.CylinderGeometry(0.03, 0.04, 0.16, 8);
const DISH_GEO = new THREE.ConeGeometry(0.28, 0.1, 22, 1, true);
const DISH_FEED_GEO = new THREE.CylinderGeometry(0.014, 0.014, 0.16, 6);
const DOCK_GEO = new THREE.CylinderGeometry(0.2, 0.2, 0.34, 16);
const DOCK_RING_GEO = new THREE.TorusGeometry(0.2, 0.028, 8, 22);
const GREEBLE_GEO = new THREE.BoxGeometry(1, 1, 1);

/* Scattered hull greebles — seeded, identical every visit. */
type Greeble = { x: number; y: number; z: number; ry: number; sx: number; sy: number; sz: number };
const GREEBLES: Greeble[] = [];
{
  const rand = mulberry32(0x0fa1c05);
  for (let i = 0; i < 16; i++) {
    const a = rand() * TAU;
    const rr = 0.45 + rand() * 1.0;
    const top = i < 11;
    GREEBLES.push({
      x: Math.cos(a) * rr,
      y: (top ? 1 : -1) * discY(rr / DISC_R),
      z: Math.sin(a) * rr,
      ry: a,
      sx: 0.08 + rand() * 0.2,
      sy: 0.05 + rand() * 0.08,
      sz: 0.08 + rand() * 0.26,
    });
  }
}

/* ---- landing gear ----------------------------------------------------------
 * Three pads under the disc: one forward, two aft. Foot boxes are 0.10 tall,
 * centered at y = -0.95, so every sole sits at EXACTLY local y = -1.0 — the
 * belly-landing plane the finale stands on. Struts bury into the lower shell.
 */
const GEAR_STRUT_GEO = new THREE.BoxGeometry(0.15, 0.68, 0.2); // y -0.22 .. -0.90
const GEAR_KNEE_GEO = new THREE.BoxGeometry(0.26, 0.14, 0.3);
const GEAR_FOOT_GEO = new THREE.BoxGeometry(0.46, 0.1, 0.58); // sole at -1.0
const GEAR_POS: Array<[number, number]> = [
  [0, -0.85],
  [-1.0, 0.8],
  [1.0, 0.8],
];

/* ---- the hyperdrive strip --------------------------------------------------
 * A curved band wrapped along the disc's rear arc, standing just proud of
 * the rim: dark backing wall + top/bottom deck plates bridging to the hull,
 * with the emissive core band (and a hotter centre stripe) as the outermost
 * rear-facing surface. Chord width ~2.6 (x +-1.3), rear-most z = 2.15.
 */
const BAND_HALF = 0.66; // asin(1.3 / 2.10)
const WALL_HALF = BAND_HALF + 0.04;
const ENGINE_WALL_GEO = new THREE.CylinderGeometry(2.04, 2.04, 0.44, 40, 1, true, -WALL_HALF, 2 * WALL_HALF);
const ENGINE_CORE_GEO = new THREE.CylinderGeometry(2.1, 2.1, 0.26, 40, 1, true, -BAND_HALF, 2 * BAND_HALF);
const ENGINE_HOT_GEO = new THREE.CylinderGeometry(2.13, 2.13, 0.11, 32, 1, true, -0.5, 1.0);
const ENGINE_PLATE_GEO = new THREE.RingGeometry(1.66, 2.15, 30, 1, -Math.PI / 2 - WALL_HALF, 2 * WALL_HALF);
const ENGINE_CAP_GEO = new THREE.BoxGeometry(0.1, 0.44, 0.36);

const GLOW_POS: Array<[number, number, number]> = [
  [-0.85, 0, 2.06],
  [0, 0, 2.3],
  [0.85, 0, 2.06],
];
const GLOW_BASE = [0.85, 1.3, 0.85];

/* ---- world-space trail -----------------------------------------------------
 * The signature system, kept exactly in architecture: points live in SCENE
 * space (portal) so the wash arcs along the flight path; ring buffer recycled
 * in place; real-metre projected sizing via uH; screen-space smear along
 * travel RELATIVE to the camera. Re-tuned: emission spread across the stern
 * strip (+-1.1 local x, following the band's arc), white-blue aging, 2.4 s
 * life, alpha peak ~0.45 — hyperdrive wash, not fire.
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
    const ex = (rand() - 0.5) * 2.2; // spread across the strip, +-1.1
    T_EMIT[i * 3] = ex;
    T_EMIT[i * 3 + 1] = (rand() - 0.5) * 0.16;
    T_EMIT[i * 3 + 2] = Math.sqrt(2.12 * 2.12 - ex * ex) + 0.05; // just behind the band's arc
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
  /** True gates ALL continuous animation; value-tracking state still follows thrust. */
  reduced: boolean;
};

export const Rocket3D = forwardRef<THREE.Group, Rocket3DProps>(function Rocket3D(
  { thrustRef, reduced },
  ref,
) {
  const scene = useThree((s) => s.scene);
  const groupRef = useRef<THREE.Group | null>(null);
  const dishRef = useRef<THREE.Group | null>(null);
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
        }),
        glassDark: new THREE.MeshStandardMaterial({
          color: '#10141a',
          roughness: 0.15,
          metalness: 0.3,
          envMapIntensity: 1.0,
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

    // Everything past here is pure motion — parked entirely under reduced.
    if (reduced) return;

    // ---- radar dish: slow 0.1 rad/s sweep.
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
      {/* Saucer disc — lathe axis is already local Y, no rotation needed. */}
      <mesh geometry={DISC_GEO} material={mats.hull} />

      {/* Raised core disc + dome + gun stubs at top centre. */}
      <mesh geometry={CORE_DISC_GEO} material={mats.grey} position={[0, 0.43, 0]} />
      <mesh geometry={CORE_DOME_GEO} material={mats.greyDark} position={[0, 0.53, 0]} scale={[1, 0.75, 1]} />
      {([-1, 1] as const).map((s) => (
        <mesh
          key={s}
          geometry={GUN_GEO}
          material={mats.dark}
          position={[s * 0.05, 0.64, -0.08]}
          rotation={[-1.0, 0, s * 0.12]}
        />
      ))}

      {/* Belly turret bump at bottom centre. */}
      <group position={[0, -0.42, 0]}>
        <mesh geometry={BELLY_TURRET_GEO} material={mats.grey} />
        <mesh geometry={BELLY_DOME_GEO} material={mats.greyDark} position={[0, -0.07, 0]} scale={[1, 0.7, 1]} />
      </group>

      {/* Mandibles: tapered prongs, roots buried in the disc at z = -1.0,
          tips at exactly -2.2, notch 0.5 wide between the inner faces. */}
      {([-1, 1] as const).map((s) => (
        <group key={s} position={[s * 0.475, 0, -1.0]}>
          <mesh geometry={MANDIBLE_GEO} material={mats.grey} rotation={[-Math.PI / 2, 0, 0]} />
          {/* Inner detail plate facing the notch. */}
          <mesh
            geometry={GREEBLE_GEO}
            material={mats.greyDark}
            position={[-s * 0.24, 0, -0.62]}
            scale={[0.05, 0.2, 0.85]}
          />
          {/* Jaw pad at the tip, pointing at its twin. */}
          <mesh
            geometry={GREEBLE_GEO}
            material={mats.dark}
            position={[-s * 0.19, 0, -1.08]}
            scale={[0.09, 0.31, 0.2]}
          />
          {/* Greeble boxes along the top and bottom faces. */}
          <mesh geometry={GREEBLE_GEO} material={mats.greyDark} position={[0, 0.16, -0.32]} scale={[0.2, 0.07, 0.3]} />
          <mesh
            geometry={GREEBLE_GEO}
            material={mats.dark}
            position={[-s * 0.05, 0.16, -0.72]}
            scale={[0.14, 0.05, 0.2]}
          />
          <mesh
            geometry={GREEBLE_GEO}
            material={mats.greyDark}
            position={[s * 0.04, -0.16, -0.5]}
            scale={[0.16, 0.05, 0.22]}
          />
        </group>
      ))}

      {/* Cockpit: starboard tube yawed slightly outboard, dark glazed canopy
          cone + tip cap overhanging the front-starboard rim. */}
      <group position={[1.3, 0.02, 0.3]} rotation={[0, COCKPIT_ANGLE, 0]}>
        <mesh geometry={COCKPIT_TUBE_GEO} material={mats.grey} position={[0, 0, -0.52]} rotation={[-Math.PI / 2, 0, 0]} />
        <mesh geometry={COCKPIT_RING_GEO} material={mats.greyDark} position={[0, 0, -0.28]} />
        <mesh geometry={COCKPIT_RING_GEO} material={mats.greyDark} position={[0, 0, -0.72]} />
        <mesh geometry={CANOPY_GEO} material={mats.canopy} position={[0, 0, -1.2]} rotation={[-Math.PI / 2, 0, 0]} />
        <mesh geometry={CANOPY_TIP_GEO} material={mats.glassDark} position={[0, 0, -1.36]} scale={[1, 1, 0.55]} />
      </group>

      {/* Port-side docking ring stub, balancing the cockpit. */}
      <group position={[-1.72, 0, 0.1]}>
        <mesh geometry={DOCK_GEO} material={mats.grey} rotation={[0, 0, Math.PI / 2]} />
        <mesh geometry={DOCK_RING_GEO} material={mats.greyDark} position={[-0.14, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
      </group>

      {/* Radar dish: slow sweep (parked under reduced), slight tilt. */}
      <group position={[-0.6, 0.32, -0.2]}>
        <mesh geometry={DISH_POST_GEO} material={mats.dark} position={[0, 0.07, 0]} />
        <group
          ref={(g: THREE.Group | null) => {
            dishRef.current = g;
          }}
          position={[0, 0.17, 0]}
        >
          <group rotation={[-0.6, 0, 0]}>
            <mesh geometry={DISH_GEO} material={mats.dark} rotation={[Math.PI, 0, 0]} />
            <mesh geometry={DISH_FEED_GEO} material={mats.dark} position={[0, 0.07, 0]} />
          </group>
        </group>
      </group>

      {/* Scattered hull greebles, seeded — half-buried machinery boxes. */}
      {GREEBLES.map((g, i) => (
        <mesh
          key={i}
          geometry={GREEBLE_GEO}
          material={i % 3 === 0 ? mats.dark : i % 3 === 1 ? mats.greyDark : mats.grey}
          position={[g.x, g.y, g.z]}
          rotation={[0, g.ry, 0]}
          scale={[g.sx, g.sy, g.sz]}
        />
      ))}

      {/* Landing gear: three pads, soles at EXACTLY y = -1.0. */}
      {GEAR_POS.map(([gx, gz], i) => (
        <group key={i} position={[gx, 0, gz]}>
          <mesh geometry={GEAR_STRUT_GEO} material={mats.dark} position={[0, -0.56, 0]} />
          <mesh geometry={GEAR_KNEE_GEO} material={mats.greyDark} position={[0, -0.3, 0]} />
          <mesh geometry={GEAR_FOOT_GEO} material={mats.dark} position={[0, -0.95, 0]} />
        </group>
      ))}

      {/* THE HYPERDRIVE: curved stern band along the rear arc — dark housing,
          deck plates bridging to the rim, emissive core + hotter centre. */}
      <mesh geometry={ENGINE_WALL_GEO} material={mats.dark} />
      <mesh geometry={ENGINE_PLATE_GEO} material={mats.dark} position={[0, 0.19, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      <mesh geometry={ENGINE_PLATE_GEO} material={mats.dark} position={[0, -0.19, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      <mesh geometry={ENGINE_CORE_GEO} material={mats.engineCore} />
      <mesh geometry={ENGINE_HOT_GEO} material={mats.engineHot} />
      {([-1, 1] as const).map((s) => (
        <mesh
          key={s}
          geometry={ENGINE_CAP_GEO}
          material={mats.dark}
          position={[s * 1.31, 0, 1.62]}
          rotation={[0, s * 0.7, 0]}
        />
      ))}

      {/* Row of three stern glow sprites scaling with thrust. */}
      {GLOW_POS.map((p, i) => (
        <sprite
          key={i}
          material={mats.glow}
          position={p}
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
        position={[0, 0, 2.35]}
        ref={(l) => {
          lightRef.current = l;
        }}
      />

      {/* Faint repulsor under-glow beneath the hull, thrust > 0.6 only. */}
      <sprite material={mats.underGlow} position={[0, -0.72, 0.1]} scale={[2.6, 1.3, 1]} />

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
