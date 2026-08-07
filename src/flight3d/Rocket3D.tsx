/* ==== ROCKET 3D — the hero prop ==============================================
 *
 * A friendly cartoon spacecraft built entirely from primitives and canvas
 * textures: chunky white lathe hull with painted livery, glossy black ogive
 * nose, one big porthole, three strapped side boosters, three swept bulbous
 * fins it lands on, and a teal exhaust — shader plume + nozzle glow + a
 * long world-space particle trail that arcs along the flight path.
 *
 * Contract (unchanged from the shuttle it replaces): renders at local origin,
 * nose along local -Z, envelope z in [-2.2, +2.2]; the PARENT drives
 * position/quaternion/scale and for the finale stands the craft tail-down on
 * the three fin feet, whose soles are the aft-most geometry at exactly
 * z = +2.2. thrustRef is 0..1 (may spike ~1.2); `reduced` gates every
 * continuous animation — value-tracking state (flame length, glow intensity)
 * still follows thrust.
 * ========================================================================= */

import * as THREE from 'three';
import { forwardRef, useMemo, useRef } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { mulberry32 } from '../engine';

const TEAL = '#4cc9f0';
const TEAL_BRIGHT = '#7df9ff';
const VIOLET = '#7c3aed';
const BEACON = '#ff5c37';
const TAU = Math.PI * 2;

function smooth01(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/* ---- hull profile ----------------------------------------------------------
 * One body-of-revolution radius function drives the hull lathe, the nose
 * cone lathe AND every surface-mounted part, so nothing floats or sinks.
 * d = distance aft of the ogive tip; local z = TIP_Z + d.
 * The ogive tip sits at -1.98, not -2.2 — the antenna spike + beacon carry
 * the silhouette out to the -2.2 envelope edge.
 */
const TIP_Z = -1.98;
const PROFILE_LEN = 3.48; // tip -> skirt trailing edge (z = +1.5)
const R_MAX = 0.85; // chunky waistline, peaks near z = +0.4
const OGIVE_LEN = 2.38; // tip to max radius
const WAIST_D = 2.98; // gentle waist at z = +1.0
const R_WAIST = 0.76;
const R_SKIRT = 0.88; // flared base skirt

function profileRadius(d: number): number {
  if (d <= OGIVE_LEN) {
    const u = Math.max(0, d) / OGIVE_LEN;
    // pow < 1 blunts the tip — rounded and friendly, nothing missile-sharp.
    return R_MAX * Math.pow(Math.sin((u * Math.PI) / 2), 0.72);
  }
  if (d <= WAIST_D) return R_MAX + (R_WAIST - R_MAX) * smooth01((d - OGIVE_LEN) / (WAIST_D - OGIVE_LEN));
  return R_WAIST + (R_SKIRT - R_WAIST) * smooth01((d - WAIST_D) / (PROFILE_LEN - WAIST_D));
}

/* Nose cone: separate lathe over d in [0, NOSE_END_D], fractionally proud so
 * the seam reads as a paint break, never a gap. */
const NOSE_END_D = 1.26; // seam at z = -0.72
function makeNoseGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 26;
  for (let i = 0; i <= N; i++) {
    const d = (i / N) * NOSE_END_D;
    pts.push(new THREE.Vector2(profileRadius(d) * 1.012 + 0.004, d));
  }
  return new THREE.LatheGeometry(pts, 48);
}
const NOSE_GEO = makeNoseGeometry();

/* Hull: starts slightly under the nose edge (overlap, no gap), runs to the
 * skirt, then steps inward to a recessed base plate the engine hides. */
const HULL_D0 = 1.18;
const HULL_STEPS = 36;
const HULL_EXTRA = 3; // stern-closure points appended after the profile
function makeHullGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= HULL_STEPS; i++) {
    const d = HULL_D0 + (i / HULL_STEPS) * (PROFILE_LEN - HULL_D0);
    pts.push(new THREE.Vector2(profileRadius(d), d));
  }
  pts.push(new THREE.Vector2(R_SKIRT * 0.8, 3.56));
  pts.push(new THREE.Vector2(0.3, 3.58));
  pts.push(new THREE.Vector2(0, 3.58));
  return new THREE.LatheGeometry(pts, 64);
}
const HULL_GEO = makeHullGeometry();

/* ---- livery texture --------------------------------------------------------
 * Lathe UVs: u wraps the axis (canvas x), v runs point-index-wise along the
 * profile (canvas y, flipped). Horizontal canvas bands therefore become
 * rings. v(d) accounts for the 3 stern-closure points sharing the v range.
 */
const LIVERY_SIZE = 1024;
function dToCanvasY(d: number): number {
  const v = ((d - HULL_D0) / (PROFILE_LEN - HULL_D0)) * (HULL_STEPS / (HULL_STEPS + HULL_EXTRA));
  return Math.round(LIVERY_SIZE * (1 - v));
}

let liveryCache: THREE.CanvasTexture | null = null;
function liveryTexture(): THREE.CanvasTexture {
  if (liveryCache) return liveryCache;
  const canvas = document.createElement('canvas');
  canvas.width = LIVERY_SIZE;
  canvas.height = LIVERY_SIZE;
  // 2d context only fails where WebGL could not have rendered either.
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  // Warm-white base coat.
  ctx.fillStyle = '#f2f3f7';
  ctx.fillRect(0, 0, LIVERY_SIZE, LIVERY_SIZE);

  // Faint vertical panel seams (lines of constant u = along the hull axis).
  ctx.strokeStyle = 'rgba(30, 36, 52, 0.09)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const x = i * 128 + 64;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, LIVERY_SIZE);
    ctx.stroke();
  }
  // Two faint ring seams on the lower hull.
  for (const d of [2.62, 3.18]) {
    const y = dToCanvasY(d);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(LIVERY_SIZE, y);
    ctx.stroke();
  }
  // Rivet dots flanking the seams along two rings.
  ctx.fillStyle = 'rgba(30, 36, 52, 0.14)';
  for (const d of [2.56, 3.24]) {
    const y = dToCanvasY(d);
    for (let i = 0; i < 32; i++) {
      ctx.beginPath();
      ctx.arc(i * 32 + 16, y, 2.4, 0, TAU);
      ctx.fill();
    }
  }

  // The bold teal band ringing the upper hull, violet pinstripe just aft.
  const bandTop = dToCanvasY(1.86);
  const bandBot = dToCanvasY(1.52);
  ctx.fillStyle = TEAL;
  ctx.fillRect(0, bandTop, LIVERY_SIZE, bandBot - bandTop);
  ctx.fillStyle = VIOLET;
  ctx.fillRect(0, dToCanvasY(2.0), LIVERY_SIZE, 7);

  // Callsign twice, opposite flanks. Drawn rotated 180° so it reads upright
  // when the craft stands tail-down on the pad (v increases AFT).
  for (const cx of [256, 768]) {
    ctx.save();
    ctx.translate(cx, dToCanvasY(2.38));
    ctx.rotate(Math.PI);
    ctx.fillStyle = '#1a1e2b';
    ctx.font = "700 88px ui-monospace, 'Space Grotesk', Menlo, monospace";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CC-01', 0, 0);
    ctx.restore();

    // Rotated-diamond gradient mark "below" the callsign (aft when standing).
    ctx.save();
    ctx.translate(cx, dToCanvasY(2.78));
    ctx.rotate(Math.PI / 4);
    const g = ctx.createLinearGradient(-26, -26, 26, 26);
    g.addColorStop(0, TEAL);
    g.addColorStop(1, VIOLET);
    ctx.fillStyle = g;
    ctx.fillRect(-26, -26, 52, 52);
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  liveryCache = tex;
  return tex;
}

/* Radial glow sprite texture: white-hot core through cyan to nothing. */
let glowCache: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
  if (glowCache) return glowCache;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.25, 'rgba(125,249,255,0.6)');
  g.addColorStop(0.6, 'rgba(76,201,240,0.2)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  glowCache = tex;
  return tex;
}

/* ---- antenna + beacon ------------------------------------------------------ */
const ANTENNA_GEO = new THREE.CylinderGeometry(0.03, 0.012, 0.22, 8); // thin end forward after rotation
const BEACON_GEO = new THREE.SphereGeometry(0.05, 14, 10);
const BEACON_Z = -2.15; // forward face at -2.2: the envelope edge

/* ---- portholes ------------------------------------------------------------- */
const PORT_Z = -0.12;
const PORT_R = profileRadius(PORT_Z - TIP_Z); // hull radius at the big window
const PORT_RIM_GEO = new THREE.TorusGeometry(0.3, 0.05, 12, 36);
// Slightly-domed glass: a spherical cap (base radius ≈ rim inner radius).
const PORT_GLASS_GEO = new THREE.SphereGeometry(0.62, 28, 12, 0, TAU, 0, 0.51);
const PORT_GLASS_OFFSET = 0.01 - 0.62 * Math.cos(0.51); // cap base flush with the rim
const SMALL_PORTS: ReadonlyArray<readonly [number, number]> = [
  [0.45, profileRadius(0.45 - TIP_Z) - 0.006],
  [0.95, profileRadius(0.95 - TIP_Z) - 0.006],
];
const SMALL_RIM_GEO = new THREE.TorusGeometry(0.095, 0.022, 8, 22);
const SMALL_GLASS_GEO = new THREE.CircleGeometry(0.08, 18);

/* ---- side boosters ---------------------------------------------------------
 * Three capsules strapped at 120° azimuths around the lower hull, offset 60°
 * from the fins. Each: rounded body, black sphere tip echoing the nose, a
 * thin teal ring, tiny nozzle, two strut stubs into the hull.
 */
const BOOSTER_ANGLES = [Math.PI / 2 + Math.PI / 3, Math.PI / 2 + Math.PI, Math.PI / 2 + (5 * Math.PI) / 3];
const BOOSTER_R = 1.0; // radial stand-off of the capsule axis
const BOOSTER_Z = 0.78;
const BOOSTER_BODY_GEO = new THREE.CapsuleGeometry(0.22, 0.68, 6, 16);
const BOOSTER_TIP_GEO = new THREE.SphereGeometry(0.15, 16, 12);
const BOOSTER_RING_GEO = new THREE.TorusGeometry(0.228, 0.02, 8, 26);
const BOOSTER_NOZZLE_GEO = new THREE.CylinderGeometry(0.09, 0.13, 0.14, 12, 1, true);
const BOOSTER_STRUT_GEO = new THREE.BoxGeometry(0.3, 0.05, 0.05);

/* ---- fins ------------------------------------------------------------------
 * Three swept, slightly bulbous fins (extruded with bevel, ~0.07 thick) at
 * the azimuths between the boosters, rooted in the skirt and sweeping
 * outboard + AFT. The fin tips flatten toward small landing pads whose sole
 * plane is exactly z = +2.2 — the aft-most geometry on the craft.
 * Shape coords: x = outboard, y = aft; extrude depth = tangential thickness.
 */
const FIN_ANGLES = [Math.PI / 2, Math.PI / 2 + TAU / 3, Math.PI / 2 + (2 * TAU) / 3];
const FIN_ROOT_X = 0.55; // root plane buried inside the hull — no gap, ever
const FIN_ROOT_Z = 1.0;
function makeFinGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -0.78); // root, leading (z = 0.22 — inside the skirt shoulder)
  s.quadraticCurveTo(0.5, -0.5, 0.78, 0.1); // leading edge sweeps out and aft
  s.quadraticCurveTo(1.02, 0.62, 0.94, 1.0); // bulbous outboard belly
  s.quadraticCurveTo(0.9, 1.11, 0.78, 1.13); // flattening toward the foot
  s.lineTo(0.62, 1.13); // foot underside (z = 2.13, pad takes over below)
  s.quadraticCurveTo(0.3, 0.9, 0.02, 0.55); // inner trailing edge home
  s.lineTo(0, -0.78);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.046,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.014,
    bevelSegments: 2,
  });
  g.translate(0, 0, -0.035); // center the thickness
  return g;
}
const FIN_GEO = makeFinGeometry();
// Teal leading-edge stripe: a thin box laid along the leading edge, a hair
// thicker than the fin so it wraps the edge from both sides.
const FIN_STRIPE_GEO = new THREE.BoxGeometry(1.1, 0.084, 0.12);
const FIN_STRIPE_POS: [number, number, number] = [FIN_ROOT_X + 0.445, 0, FIN_ROOT_Z - 0.42];
const FIN_STRIPE_YAW = -Math.atan2(0.88, 0.78);
// Foot pad: squat cylinder under the fin tip, sole at exactly +2.2.
const PAD_GEO = new THREE.CylinderGeometry(0.16, 0.19, 0.08, 16);
const PAD_POS: [number, number, number] = [FIN_ROOT_X + 0.78, 0, 2.16];

/* ---- main engine ----------------------------------------------------------- */
const BELL_PTS = [
  new THREE.Vector2(0.3, 0),
  new THREE.Vector2(0.19, 0.1),
  new THREE.Vector2(0.17, 0.16),
  new THREE.Vector2(0.22, 0.24),
  new THREE.Vector2(0.33, 0.33),
  new THREE.Vector2(0.42, 0.4),
];
const BELL_GEO = new THREE.LatheGeometry(BELL_PTS, 32);
const BELL_Z = 1.45; // lip at 1.85 — well inboard of the fin soles at 2.2

/* ---- plume -----------------------------------------------------------------
 * Teardrop lathe, nozzle at local 0, tip at +1 before scaling; scale.z maps
 * thrust to length. v (uv.y) IS the tail coordinate the shader colors by.
 */
function makePlumeGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = t <= 0.22 ? 0.16 + 0.2 * smooth01(t / 0.22) : 0.36 * Math.pow(1 - (t - 0.22) / 0.78, 0.8);
    pts.push(new THREE.Vector2(Math.max(0, r), t));
  }
  return new THREE.LatheGeometry(pts, 28);
}
const PLUME_GEO = makePlumeGeometry();
const PLUME_Z = 1.7;

const PLUME_VERT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vFres;
void main() {
  vUv = uv;
  float tail = uv.y;
  // Wobble: the sheath breathes sideways, more toward the tail.
  float w = sin(uv.x * 18.8 + uTime * 9.0 + tail * 8.0) * 0.05 * tail;
  vec3 p = position + normal * w;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vec3 vdir = normalize(-mv.xyz);
  vFres = pow(abs(dot(n, vdir)), 1.3);
  gl_Position = projectionMatrix * mv;
}`;

const PLUME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uThrust;
varying vec2 vUv;
varying float vFres;
void main() {
  float tail = vUv.y;
  vec3 col = mix(vec3(1.0), vec3(0.49, 0.976, 1.0), smoothstep(0.0, 0.45, tail)); // white-hot -> #7df9ff
  col = mix(col, vec3(0.486, 0.227, 0.929), smoothstep(0.35, 0.95, tail));         // -> #7c3aed edge
  float flicker = 0.82 + 0.18 * sin(uTime * 21.0 + vUv.x * 12.6) * sin(uTime * 15.0 - tail * 10.0);
  float a = (1.0 - smoothstep(0.1, 1.0, tail)) * vFres * flicker * clamp(uThrust, 0.0, 1.0);
  gl_FragColor = vec4(col * (1.35 + 1.1 * (1.0 - tail)), a);
}`;

// Plume length flicker: two detuned sines in the 9-13 Hz band.
const FLICKER_HZ_A = 12.3;
const FLICKER_HZ_B = 9.7;
const FLICKER_AMP_A = 0.08;
const FLICKER_AMP_B = 0.055;

/* ---- RCS puffs ------------------------------------------------------------- */
const RCS_GEO = new THREE.ConeGeometry(0.055, 0.36, 10, 1, true);
const RCS_AZIMUTH = 0.75;
const RCS_THRUST_MAX = 0.25;

/* ---- world-space trail -----------------------------------------------------
 * The signature. Points live in SCENE space (portal), so the exhaust arcs
 * along the flight path instead of swinging rigidly with the ship. Ring
 * buffer recycled in place — zero allocation per frame. Shader adapted from
 * the author's own River-Racer spray system: real-metre projected sizing via
 * uH, and a screen-space smear along travel RELATIVE to the camera.
 */
const T_COUNT = 240;
const T_LIFE = 2.0;
const T_RATE = 90; // particles/s at full thrust
const T_THRUST_MIN = 0.1;

// Seeded per-slot randomness — identical exhaust every visit.
const T_SPEED = new Float32Array(T_COUNT);
const T_SCAT = new Float32Array(T_COUNT * 3);
const T_SIZE = new Float32Array(T_COUNT);
const T_SOFT = new Float32Array(T_COUNT);
const T_SEED = new Float32Array(T_COUNT);
{
  const rand = mulberry32(0x7df9ff);
  for (let i = 0; i < T_COUNT; i++) {
    T_SPEED[i] = 3.2 + rand() * 1.8;
    T_SCAT[i * 3] = (rand() - 0.5) * 1.6; // ±0.8 lateral scatter
    T_SCAT[i * 3 + 1] = (rand() - 0.5) * 1.6;
    T_SCAT[i * 3 + 2] = (rand() - 0.5) * 1.6;
    T_SIZE[i] = 0.13 + rand() * 0.2;
    T_SOFT[i] = 0.22 + rand() * 0.36;
    T_SEED[i] = rand() * 6.283;
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
  vLife = clamp(aDrop.y * 2.0, 0.0, 1.0); // alpha peaks 0.5 at birth -> 1..0 life proxy
  // Fade anything about to swallow the lens rather than splatting a disc.
  // Floor near zero: at 0.15 the residual still read as pale ovals drifting
  // across the landing shot (screenshot finding).
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
  // White-hot at birth through #7df9ff, dying to a faint violet.
  vec3 col = mix(vec3(0.42, 0.25, 0.8), vec3(0.49, 0.976, 1.0), smoothstep(0.1, 0.65, vLife));
  col = mix(col, vec3(1.6, 1.6, 1.5), smoothstep(0.8, 1.0, vLife));
  gl_FragColor = vec4(col, a);
}`;

// Module-scope scratch — no per-frame allocation, ever.
const SCRATCH_POS = new THREE.Vector3();
const SCRATCH_DIR = new THREE.Vector3();
const SCRATCH_QUAT = new THREE.Quaternion();
const BELL_LOCAL = new THREE.Vector3(0, 0, 1.9);

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
  const plumeRef = useRef<THREE.Group | null>(null);
  const glowARef = useRef<THREE.Sprite | null>(null);
  const glowBRef = useRef<THREE.Sprite | null>(null);
  const lightRef = useRef<THREE.PointLight | null>(null);
  const trail = useMemo(makeTrailState, []);

  const { mats, plumeU, trailU } = useMemo(() => {
    const plumeUniforms = { uTime: { value: 0 }, uThrust: { value: 0 } };
    const trailUniforms = {
      uH: { value: 720 },
      uAspect: { value: 16 / 9 },
      uCamVel: { value: new THREE.Vector3() },
    };
    return {
      plumeU: plumeUniforms,
      trailU: trailUniforms,
      mats: {
        hull: new THREE.MeshStandardMaterial({
          map: liveryTexture(),
          color: '#ffffff',
          roughness: 0.35,
          metalness: 0.05,
          envMapIntensity: 0.8,
        }),
        white: new THREE.MeshStandardMaterial({
          color: '#f2f3f7',
          roughness: 0.4,
          metalness: 0.05,
          envMapIntensity: 0.8,
        }),
        nose: new THREE.MeshStandardMaterial({
          color: '#14161f',
          roughness: 0.22,
          metalness: 0.3,
          envMapIntensity: 1.1,
        }),
        silver: new THREE.MeshStandardMaterial({ color: '#c9ccd4', roughness: 0.25, metalness: 0.8 }),
        metal: new THREE.MeshStandardMaterial({
          color: '#33363e',
          roughness: 0.4,
          metalness: 0.7,
          side: THREE.DoubleSide,
        }),
        teal: new THREE.MeshStandardMaterial({ color: TEAL, roughness: 0.4, metalness: 0.1 }),
        glass: new THREE.MeshStandardMaterial({
          color: '#04070c',
          emissive: '#1b4a5c',
          emissiveIntensity: 0.8,
          roughness: 0.15,
          metalness: 0.1,
        }),
        beacon: new THREE.MeshStandardMaterial({
          color: '#2a1410',
          emissive: BEACON,
          emissiveIntensity: 1.4,
        }),
        bellInner: new THREE.MeshStandardMaterial({
          color: '#050505',
          emissive: '#ff8a50',
          emissiveIntensity: 1.4,
          side: THREE.BackSide,
        }),
        plume: new THREE.ShaderMaterial({
          uniforms: plumeUniforms,
          vertexShader: PLUME_VERT,
          fragmentShader: PLUME_FRAG,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
        glowA: new THREE.SpriteMaterial({
          map: glowTexture(),
          color: '#bffcff',
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
        glowB: new THREE.SpriteMaterial({
          map: glowTexture(),
          color: '#ffffff',
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
        rcs: new THREE.MeshBasicMaterial({
          color: '#e8f2f8',
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
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

  useFrame((state, rawDt) => {
    // Clamp dt: a backgrounded tab must not dump a giant step into the sim.
    const dt = Math.min(rawDt, 0.05);
    const thrust = thrustRef.current;
    const t = state.clock.elapsedTime;

    // ---- plume: length/swell track thrust (state, allowed under reduced);
    // the shader time + length flicker are motion, gated off.
    plumeU.uThrust.value = Math.min(Math.max(thrust, 0), 1.2);
    plumeU.uTime.value = reduced ? 0 : t;
    const plume = plumeRef.current;
    if (plume) {
      let flick = 1;
      if (!reduced) {
        flick =
          1 +
          FLICKER_AMP_A * Math.sin(t * FLICKER_HZ_A * TAU) +
          FLICKER_AMP_B * Math.sin(t * FLICKER_HZ_B * TAU + 0.9);
      }
      const swell = 1 + thrust * 0.25;
      plume.scale.set(swell, swell, (0.5 + thrust * 2.6) * flick);
    }

    // ---- nozzle glow sprites + exhaust light: value-tracking state.
    const ga = glowARef.current;
    if (ga) {
      const s = 0.7 + thrust * 1.7;
      ga.scale.set(s, s, 1);
    }
    const gb = glowBRef.current;
    if (gb) {
      const s = 0.35 + thrust * 0.9;
      gb.scale.set(s, s, 1);
    }
    mats.glowA.opacity = Math.min(1, thrust * 0.85);
    mats.glowB.opacity = Math.min(1, thrust * 1.1);
    const light = lightRef.current;
    if (light) light.intensity = thrust * 26;

    // ---- beacon: gentle 1.2 Hz pulse; steady glow under reduced.
    mats.beacon.emissiveIntensity = reduced ? 1.4 : 1.1 + 0.7 * Math.sin(t * 1.2 * TAU);

    // Everything past here is pure motion — under reduced neither the RCS
    // jets nor the trail even render, so there is nothing to simulate.
    if (reduced) return;

    // ---- RCS: attitude puffs only near idle thrust.
    mats.rcs.opacity = thrust < RCS_THRUST_MAX ? (RCS_THRUST_MAX - thrust) * 0.8 : 0;

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
      drop[q] = (T_SIZE[i] ?? 0.2) * (0.65 + u * 1.35); // exhaust expands as it cools
      drop[q + 1] = 0.5 * inv * inv * Math.min(1, age * 12); // peak ~0.5, quadratic fade
    }

    // Emit from the bell's WORLD position, aft along the ship's WORLD +Z.
    if (thrust > T_THRUST_MIN) {
      const g = groupRef.current;
      if (g) {
        g.updateWorldMatrix(true, false);
        g.localToWorld(SCRATCH_POS.copy(BELL_LOCAL));
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
          pos[k] = SCRATCH_POS.x + (T_SCAT[k] ?? 0) * 0.06;
          pos[k + 1] = SCRATCH_POS.y + (T_SCAT[k + 1] ?? 0) * 0.06;
          pos[k + 2] = SCRATCH_POS.z + (T_SCAT[k + 2] ?? 0) * 0.06;
          const spd = T_SPEED[i] ?? 4;
          vel[k] = SCRATCH_DIR.x * spd + (T_SCAT[k] ?? 0) * 0.8;
          vel[k + 1] = SCRATCH_DIR.y * spd + (T_SCAT[k + 1] ?? 0) * 0.8;
          vel[k + 2] = SCRATCH_DIR.z * spd + (T_SCAT[k + 2] ?? 0) * 0.8;
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
      {/* Hull + nose cone — lathes share one profile function; the +90° X
          rotation maps the lathe axis onto local Z, tip toward -Z. */}
      <mesh geometry={HULL_GEO} material={mats.hull} position={[0, 0, TIP_Z]} rotation={[Math.PI / 2, 0, 0]} />
      <mesh geometry={NOSE_GEO} material={mats.nose} position={[0, 0, TIP_Z]} rotation={[Math.PI / 2, 0, 0]} />

      {/* Antenna spike + beacon carrying the silhouette to the -2.2 edge. */}
      <mesh geometry={ANTENNA_GEO} material={mats.silver} position={[0, 0, -2.08]} rotation={[Math.PI / 2, 0, 0]} />
      <mesh geometry={BEACON_GEO} material={mats.beacon} position={[0, 0, BEACON_Z]} />

      {/* The big porthole — polished rim, slightly-domed glass, faint cyan
          interior. Someone rides this thing. */}
      <group position={[PORT_R - 0.02, 0, PORT_Z]} rotation={[0, Math.PI / 2, 0]}>
        <mesh geometry={PORT_RIM_GEO} material={mats.silver} scale={[1, 1, 1.6]} />
        <mesh
          geometry={PORT_GLASS_GEO}
          material={mats.glass}
          position={[0, 0, PORT_GLASS_OFFSET]}
          rotation={[Math.PI / 2, 0, 0]}
        />
      </group>

      {/* Two small secondary portholes lower down the same flank. */}
      <group rotation={[0, 0, -0.3]}>
        {SMALL_PORTS.map(([z, r]) => (
          <group key={z} position={[r, 0, z]} rotation={[0, Math.PI / 2, 0]}>
            <mesh geometry={SMALL_RIM_GEO} material={mats.silver} />
            <mesh geometry={SMALL_GLASS_GEO} material={mats.glass} position={[0, 0, 0.008]} />
          </group>
        ))}
      </group>

      {/* Three side boosters at 120° azimuths, offset 60° from the fins. */}
      {BOOSTER_ANGLES.map((a) => (
        <group key={a} rotation={[0, 0, a]}>
          <mesh
            geometry={BOOSTER_BODY_GEO}
            material={mats.white}
            position={[BOOSTER_R, 0, BOOSTER_Z]}
            rotation={[Math.PI / 2, 0, 0]}
          />
          <mesh geometry={BOOSTER_TIP_GEO} material={mats.nose} position={[BOOSTER_R, 0, 0.24]} />
          <mesh geometry={BOOSTER_RING_GEO} material={mats.teal} position={[BOOSTER_R, 0, 0.6]} />
          <mesh
            geometry={BOOSTER_NOZZLE_GEO}
            material={mats.metal}
            position={[BOOSTER_R, 0, 1.42]}
            rotation={[Math.PI / 2, 0, 0]}
          />
          {[0.42, 1.1].map((z) => (
            <mesh key={z} geometry={BOOSTER_STRUT_GEO} material={mats.silver} position={[0.88, 0, z]} />
          ))}
        </group>
      ))}

      {/* Three swept fins + landing pads. Pad soles at exactly z = +2.2 —
          the aft-most geometry, so the tail-down finale stands on them. */}
      {FIN_ANGLES.map((a) => (
        <group key={a} rotation={[0, 0, a]}>
          <mesh
            geometry={FIN_GEO}
            material={mats.white}
            position={[FIN_ROOT_X, 0, FIN_ROOT_Z]}
            rotation={[Math.PI / 2, 0, 0]}
          />
          <mesh
            geometry={FIN_STRIPE_GEO}
            material={mats.teal}
            position={FIN_STRIPE_POS}
            rotation={[0, FIN_STRIPE_YAW, 0]}
          />
          <mesh geometry={PAD_GEO} material={mats.metal} position={PAD_POS} rotation={[Math.PI / 2, 0, 0]} />
        </group>
      ))}

      {/* Main engine bell: dark flared shell, warm emissive throat. */}
      <mesh geometry={BELL_GEO} material={mats.metal} position={[0, 0, BELL_Z]} rotation={[Math.PI / 2, 0, 0]} />
      <mesh
        geometry={BELL_GEO}
        material={mats.bellInner}
        position={[0, 0, BELL_Z]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[0.92, 1, 0.92]}
      />

      {/* Shader plume — teardrop stretched aft by one scale write per frame. */}
      <group
        position={[0, 0, PLUME_Z]}
        scale={[1, 1, 0.5]}
        ref={(g) => {
          plumeRef.current = g;
        }}
      >
        <mesh geometry={PLUME_GEO} material={mats.plume} rotation={[Math.PI / 2, 0, 0]} frustumCulled={false} />
      </group>

      {/* Nozzle glow: two additive sprites + the exhaust light that paints
          teal onto nearby hull and planets. */}
      <sprite
        material={mats.glowA}
        position={[0, 0, 1.92]}
        ref={(s) => {
          glowARef.current = s;
        }}
      />
      <sprite
        material={mats.glowB}
        position={[0, 0, 1.86]}
        ref={(s) => {
          glowBRef.current = s;
        }}
      />
      <pointLight
        color={TEAL_BRIGHT}
        intensity={0}
        distance={30}
        decay={2}
        position={[0, 0, 2.05]}
        ref={(l) => {
          lightRef.current = l;
        }}
      />

      {/* RCS nose puffs — only near idle (opacity in the frame loop), pure
          motion, absent entirely under reduced. */}
      {!reduced &&
        [1, -1].map((s) => (
          <group key={s} rotation={[0, 0, s * RCS_AZIMUTH]}>
            <mesh geometry={RCS_GEO} material={mats.rcs} position={[0, 0.46, -1.52]} rotation={[Math.PI - 0.5, 0, 0]} />
          </group>
        ))}

      {/* World-space trail: portaled to the scene root so particles stay
          where they were emitted and the exhaust arcs along the flight path.
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
