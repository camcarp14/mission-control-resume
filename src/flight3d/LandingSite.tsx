/* ==== LANDING SITE: NAVY PIER AT SUNSET =====================================
 *
 * The finale's ground truth. The voyage now ends where the author's own
 * River Racer game lives: the tip of Navy Pier at golden hour. The ship sets
 * down on a pier-end pad; the wooden deck runs back toward shore past the
 * Centennial Wheel, the Crystal Gardens glass vault and the 1916 Head House;
 * the Chicago skyline stands silhouetted against a warm sunset over a calm
 * Lake Michigan, windows lit. The pier shapes, the vertex-color "tintGeom"
 * shading and the sky-gradient structure are adapted directly from the
 * user's river-racer repo (js/world/lake.js, city.js, sky.js), inlined here
 * as self-contained TypeScript.
 *
 * Layout happens in a "pier space" child group whose +X axis is the engine's
 * landing-camera tangent tHat and whose -Z axis is bHat: the camera parks at
 * ~(+12, +2.6, 0) looking down -X with a -Z drift, so the deck runs to
 * x=-170, the wheel stands at (-60, z=-9.5), the skyline spreads across ±Z
 * beyond x=-175, and the sun sits low toward (-1, 0, -0.5).
 *
 * Everything is procedural and seeded (mulberry32(0xC0FFEE), one rng, fixed
 * order), merged RR-style into ~12 draw calls. The opacity ramp is STATE (it
 * tracks the flight position) times a camera-distance gate, so it runs under
 * reduced motion; the continuous animations — wheel spin, gull circling,
 * sun-path shimmer — are gated off and parked when `reduced` is true.
 * ========================================================================= */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { useFrame, useThree } from '@react-three/fiber';
import type { MotionValue } from 'framer-motion';
import { legInto, mulberry32 } from '../engine';
import type { Waypoint } from '../engine';

/* ---- tunables ----------------------------------------------------------- */

const SEED = 0xc0ffee;

// Staging: the site materializes only on final descent (the globe owns the
// approach), THEN a camera-distance gate keeps it invisible from outside —
// so the return arc never shows a pier floating in space.
const VISIBLE_AT = 0.72;
const FADE_START = 0.78;
const FADE_SPAN = 0.17;
const DOME_START = 0.84; // the sky completes last: most readable "from outside"
const DOME_SPAN = 0.13;
const CAM_FADE_NEAR = 60; // kCam = 1 inside this camera distance…
const CAM_FADE_SPAN = 50; // …fading to 0 by NEAR + SPAN

// Pier: pad at the local origin (deck top = y 0), deck running -X to shore.
const DECK_TIP = 8; // deck extends past the pad toward the lake
const DECK_END = -170; // pier root / shore end
const DECK_WIDTH = 12;
const DECK_THICK = 1.5;
const LAMP_STEP = 22;

// Landing pad, painted on the pier-tip deck under the ship.
const PAD_RADIUS = 4.0;
const PAD_LIFT = 0.02;
const PAD_CYAN = '#7df9ff';
const PAD_LABEL = 'CC-01';

// Centennial Wheel (scaled to the mini-pier).
const WHEEL_X = -60;
const WHEEL_Z = -9.5; // +bHat side of the deck edge — inside the camera frame
const WHEEL_R = 9;
const WHEEL_HUB_Y = 10.6;
const WHEEL_YAW = 0.9; // oblique to the pier axis so it reads from the pad
const WHEEL_SPOKES = 14;
const WHEEL_CABINS = 11;
const WHEEL_SPEED = 0.05; // rad/s — three revolutions in ~6 min, parked when reduced

// Crystal Gardens vault / Head House stations along the deck.
const CG_X = -95;
const HEAD_X = -150;

// Skyline: seeded silhouettes on the shore arc beyond the pier root.
const TOWER_COUNT = 22;
const TOWER_R_MIN = 178;
const TOWER_R_SPAN = 78;
const WINDOW_DENSITY = 0.2;
const MAX_WINDOWS = 168;

// Water: calm dusk lake, rim alpha baked so it dissolves into haze.
const WATER_Y = -3.5;
const WATER_RADIUS = 260;

// Sunset: azimuth is (-tHat + 0.5·bHat) → pier space (-1, 0, -0.5).
const SUN_AZ_X = -0.8944;
const SUN_AZ_Z = -0.4472;
const DOME_RADIUS = 420;
const SUN_SPRITE_SCALE = 120;
const SUN_SPRITE_OPACITY = 0.85;
const STREAK_OPACITY = 0.8;

// Gulls: three silhouettes on a slow circle over the water.
const GULL_X = -40;
const GULL_Y = 8.5;
const GULL_Z = -30;
const GULL_SPEED = 0.07;

// Site lights, ramped by the master fade k: warm low sun FROM the sunset
// azimuth so the ship at the pad reads rim-lit.
const SUN_COLOR = '#ffb27a';
const SUN_INTENSITY = 1.6;
const SUN_LIGHT_POS: [number, number, number] = [SUN_AZ_X * 150, 24, SUN_AZ_Z * 150];
const HEMI_SKY = '#ffc9a0';
const HEMI_GROUND = '#2a3340';
const HEMI_INTENSITY = 0.9;

/* ---- module-scope scratch (zero per-frame allocs) ------------------------ */

const _dummy = new THREE.Object3D();
const _sitePos = new THREE.Vector3();
const _tint = new THREE.Color();

function sstep(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/* ---- sunset sky dome shader (structure adapted from RR js/world/sky.js) -- */

const DOME_VERT = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Height-blended sunset: hot orange horizon band lifting through rose and
// violet to deep navy by ~60% height, with the warmest+brightest lobe
// centred on the sun azimuth (uSunDir) and a few thin dark cloud strips
// baked analytically near the horizon. Alpha fades out toward the zenith so
// stars still peek through; uOpacity is the sky's master fade.
const DOME_FRAG = /* glsl */ `
  uniform float uOpacity;
  uniform vec3 uSunDir;
  varying vec3 vPos;
  void main() {
    vec3 D = normalize(vPos);
    float h = clamp(D.y, 0.0, 1.0);
    vec3 band0 = vec3(1.000, 0.604, 0.353); /* #ff9a5a */
    vec3 band1 = vec3(1.000, 0.435, 0.322); /* #ff6f52 */
    vec3 rose  = vec3(0.788, 0.416, 0.486); /* #c96a7c */
    vec3 viol  = vec3(0.478, 0.290, 0.541); /* #7a4a8a */
    vec3 navy  = vec3(0.063, 0.102, 0.180); /* #101a2e */
    vec3 col = mix(band0, band1, smoothstep(0.0, 0.10, h));
    col = mix(col, rose, smoothstep(0.06, 0.24, h));
    col = mix(col, viol, smoothstep(0.20, 0.42, h));
    col = mix(col, navy, smoothstep(0.38, 0.60, h));
    /* warm lobe on the sun azimuth, hottest right at the horizon */
    float azl = max(length(D.xz), 1e-4);
    float sc = max(dot(D.xz / azl, normalize(uSunDir.xz)), 0.0);
    float lobe = pow(sc, 3.0) * (1.0 - smoothstep(0.0, 0.34, h));
    col = mix(col, vec3(1.0, 0.80, 0.55), lobe * 0.6);
    col += vec3(1.0, 0.62, 0.35) * pow(sc, 9.0) * pow(1.0 - h, 4.0) * 0.5;
    /* thin dark cloud strips, strongest near the sun (baked, no drift) */
    float ang = atan(D.z, D.x);
    float amp = 0.35 + 0.65 * sc * sc;
    float s1 = 1.0 - smoothstep(0.004, 0.012, abs(h - 0.075 - 0.014 * sin(ang * 2.0 + 1.7)));
    float s2 = 1.0 - smoothstep(0.003, 0.010, abs(h - 0.120 - 0.011 * sin(ang * 3.1 + 0.4)));
    float s3 = 1.0 - smoothstep(0.003, 0.009, abs(h - 0.175 - 0.016 * sin(ang * 2.4 + 2.6)));
    float strips = min(1.0, s1 * 0.55 + s2 * 0.45 + s3 * 0.35) * amp;
    col = mix(col, vec3(0.30, 0.16, 0.24), strips * 0.55);
    float a = 1.0 - smoothstep(0.45, 0.72, h);
    gl_FragColor = vec4(col, a * uOpacity);
  }
`;

/* ---- seeded canvas painting ---------------------------------------------- */

function rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function makeCanvasTexture(
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Wooden pier deck: warm brown planks running along the pier (canvas u),
 *  dark seams, faint grain, a few weathered runs and knots, and a subtle
 *  sunset wash. Tiled ~5x along the deck so planks read ~6 units long. */
function paintDeck(ctx: CanvasRenderingContext2D, w: number, h: number, rng: () => number): void {
  ctx.fillStyle = '#33261a'; // seam gaps between planks
  ctx.fillRect(0, 0, w, h);
  const rows = 8;
  const rowH = h / rows;
  const palette = ['#7c5c3c', '#8a6844', '#6f5236', '#94714c', '#7a5a3a', '#856048'] as const;
  for (let r = 0; r < rows; r++) {
    let x = -Math.floor(rng() * 120);
    while (x < w) {
      const len = 140 + Math.floor(rng() * 130);
      ctx.fillStyle = palette[Math.floor(rng() * palette.length)] ?? '#7c5c3c';
      ctx.fillRect(x + 1, r * rowH + 1, len - 2, rowH - 2);
      ctx.fillStyle = 'rgba(40,28,16,0.18)'; // grain streaks
      for (let g = 0; g < 2; g++) {
        const gy = r * rowH + 3 + rng() * (rowH - 6);
        ctx.fillRect(x + 4, gy, len - 8, 1.2);
      }
      if (rng() < 0.3) {
        ctx.fillStyle = 'rgba(30,20,10,0.5)'; // knot
        ctx.beginPath();
        ctx.arc(x + 20 + rng() * Math.max(4, len - 40), r * rowH + rowH * (0.3 + rng() * 0.4), 1.5 + rng() * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      x += len;
    }
    if (rng() < 0.28) {
      ctx.fillStyle = 'rgba(28,20,12,0.22)'; // weathered darker plank run
      ctx.fillRect(0, r * rowH + 1, w, rowH - 2);
    }
  }
  const wash = ctx.createLinearGradient(0, 0, 0, h);
  wash.addColorStop(0, 'rgba(255,150,90,0.10)');
  wash.addColorStop(0.5, 'rgba(255,150,90,0.04)');
  wash.addColorStop(1, 'rgba(255,150,90,0.10)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);
}

/** The pad: concrete over the pier-tip deck, one bold glowing cyan ring, an
 *  inner dashed circle, four corner ticks, and 'CC-01' stencilled twice. */
function paintPad(ctx: CanvasRenderingContext2D, size: number, rng: () => number): void {
  const S = size;
  const c = S / 2;
  const R = S / 2;
  ctx.fillStyle = '#23262a';
  ctx.fillRect(0, 0, S, S);

  // Concrete mottle so the pad reads poured, not flat-shaded.
  for (let i = 0; i < 46; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 8 + rng() * 30;
    ctx.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bold outer ring with a slight glow — high contrast against the wood.
  ctx.strokeStyle = PAD_CYAN;
  ctx.lineWidth = 12;
  ctx.shadowColor = PAD_CYAN;
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(c, c, R * 0.85, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Inner dashed circle.
  ctx.strokeStyle = rgba(PAD_CYAN, 0.65);
  ctx.lineWidth = 5;
  ctx.setLineDash([26, 18]);
  ctx.beginPath();
  ctx.arc(c, c, R * 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Four corner tick marks between ring and rim.
  ctx.strokeStyle = rgba(PAD_CYAN, 0.9);
  ctx.lineWidth = 8;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * R * 0.9, c + Math.sin(a) * R * 0.9);
    ctx.lineTo(c + Math.cos(a) * R * 0.98, c + Math.sin(a) * R * 0.98);
    ctx.stroke();
  }

  // Pad designation, twice, tangent to the edge.
  ctx.fillStyle = rgba(PAD_CYAN, 0.85);
  ctx.font = '600 26px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const a of [-Math.PI / 2, Math.PI / 2]) {
    ctx.save();
    ctx.translate(c + Math.cos(a) * R * 0.68, c + Math.sin(a) * R * 0.68);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(PAD_LABEL, 0, 0);
    ctx.restore();
  }
}

/** Calm dusk lake: deep blue base, soft elongated swell mottling, darkening
 *  toward the rim, and the outer 22% alpha-faded so the disc dissolves into
 *  horizon haze instead of ending in an edge. */
function paintWater(ctx: CanvasRenderingContext2D, w: number, h: number, rng: () => number): void {
  ctx.fillStyle = '#16324a';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 130; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const long = 30 + rng() * 130; // elongated across the camera's view
    const short = 4 + rng() * 12;
    ctx.fillStyle = rng() < 0.5 ? 'rgba(12,32,50,0.16)' : 'rgba(38,86,120,0.14)';
    ctx.beginPath();
    ctx.ellipse(x, y, short, long, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const c = w / 2;
  const ring = ctx.createRadialGradient(c, c, 0, c, c, c);
  ring.addColorStop(0.6, 'rgba(8,20,34,0)');
  ring.addColorStop(1, 'rgba(8,20,34,0.5)');
  ctx.fillStyle = ring;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-out';
  const fade = ctx.createRadialGradient(c, c, 0, c, c, c);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.78, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

/** Big warm radial glow for the sun sprite just above the horizon. */
function paintSunGlow(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const c = w / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,246,224,0.95)');
  g.addColorStop(0.22, 'rgba(255,217,160,0.55)');
  g.addColorStop(0.55, 'rgba(255,154,90,0.18)');
  g.addColorStop(1, 'rgba(255,154,90,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Elongated warm blob (long axis = canvas y) for the sun's specular path
 *  lying flat on the water, pointed at the sun azimuth. */
function paintStreak(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(0.5, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, h / 2);
  g.addColorStop(0, 'rgba(255,217,160,0.55)');
  g.addColorStop(0.5, 'rgba(255,154,90,0.22)');
  g.addColorStop(1, 'rgba(255,154,90,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-w, -h / 2, w * 2, h);
  ctx.restore();
}

/* ---- RR-style geometry helpers (tintGeom / merged batches, inlined) ------ */

/** Per-geometry vertex-color tint with seeded brightness jitter — the RR
 *  "high tier shading" look (js/world/city.js tintGeom). Colors land in the
 *  linear working space via THREE.Color's managed setHex. */
function tintGeom(geo: THREE.BufferGeometry, hex: number, jitter: number, rng: () => number): THREE.BufferGeometry {
  _tint.setHex(hex);
  let r = _tint.r;
  let g = _tint.g;
  let b = _tint.b;
  if (jitter > 0) {
    const f = 1 + (rng() - 0.5) * jitter;
    r = Math.min(1, Math.max(0, r * f));
    g = Math.min(1, Math.max(0, g * f));
    b = Math.min(1, Math.max(0, b * f));
  }
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  if (!merged) throw new Error('LandingSite: geometry merge failed');
  return merged;
}

function boxTo(
  list: THREE.BufferGeometry[],
  rng: () => number,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  hex: number,
  jitter = 0.06,
  rotY = 0,
): void {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  tintGeom(g, hex, jitter, rng);
  list.push(g);
}

function bulbTo(
  list: THREE.BufferGeometry[],
  rng: () => number,
  x: number,
  y: number,
  z: number,
  hex: number,
  r: number,
): void {
  const g = new THREE.SphereGeometry(r, 8, 6);
  g.translate(x, y, z);
  tintGeom(g, hex, 0.1, rng);
  list.push(g);
}

/** Cylinder strut between two points (RR wheel-support technique). */
function strutTo(
  list: THREE.BufferGeometry[],
  rng: () => number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  rad: number,
  hex: number,
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  const g = new THREE.CylinderGeometry(rad, rad * 1.3, len, 6);
  g.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(dx, dy, dz).normalize(),
    ),
  );
  g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  tintGeom(g, hex, 0.05, rng);
  list.push(g);
}

/** Rotate a local XZ offset by a yaw angle (rotY convention). */
function rotXZ(lx: number, lz: number, ang: number): { x: number; z: number } {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

/** Hang the wheel cabins upright at the rim for a given spin angle. The
 *  cabins live in the (yawed, non-spinning) wheel group, so only their rim
 *  position changes — a real wheel keeps its cars level however far it has
 *  turned (RR js/world/lake.js gondola pass). */
function poseCabins(mesh: THREE.InstancedMesh, spin: number): void {
  for (let i = 0; i < WHEEL_CABINS; i++) {
    const a = (i / WHEEL_CABINS) * Math.PI * 2 + spin;
    _dummy.position.set(Math.cos(a) * WHEEL_R, Math.sin(a) * WHEEL_R, 0);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/* ---- seeded site build ---------------------------------------------------- */

type SiteAssets = {
  textures: THREE.Texture[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  deckGeo: THREE.BufferGeometry;
  padGeo: THREE.BufferGeometry;
  archGeo: THREE.BufferGeometry;
  glowGeo: THREE.BufferGeometry;
  glassGeo: THREE.BufferGeometry;
  spinGeo: THREE.BufferGeometry;
  cabinGeo: THREE.BufferGeometry;
  waterGeo: THREE.BufferGeometry;
  streakGeo: THREE.BufferGeometry;
  domeGeo: THREE.BufferGeometry;
  gullGeo: THREE.BufferGeometry;
  deckMat: THREE.MeshStandardMaterial;
  padMat: THREE.MeshStandardMaterial;
  archMat: THREE.MeshStandardMaterial;
  glowMat: THREE.MeshBasicMaterial;
  glassMat: THREE.MeshStandardMaterial;
  steelMat: THREE.MeshStandardMaterial;
  cabinMat: THREE.MeshStandardMaterial;
  waterMat: THREE.MeshStandardMaterial;
  streakMat: THREE.MeshBasicMaterial;
  sunMat: THREE.SpriteMaterial;
  domeMat: THREE.ShaderMaterial;
  gullMat: THREE.MeshBasicMaterial;
  domeUniforms: { uOpacity: { value: number }; uSunDir: { value: THREE.Vector3 } };
  fade: { m: THREE.Material; mul: number }[];
};

/** Everything seeded and built ONCE, drawing from a single rng in a fixed
 *  order so the site is identical on every visit. All merged batches follow
 *  the RR budget discipline: one vertex-colored mesh for ALL opaque
 *  architecture + skyline, one for every emissive bulb + lit window. */
function buildAssets(): SiteAssets {
  const rng = mulberry32(SEED);

  /* -- textures (one rng, fixed order) -- */
  const deckTex = makeCanvasTexture(1024, 256, (ctx, w, h) => paintDeck(ctx, w, h, rng));
  deckTex.wrapS = THREE.RepeatWrapping;
  deckTex.repeat.set(5, 1);
  deckTex.anisotropy = 4;
  const padTex = makeCanvasTexture(512, 512, (ctx, w) => paintPad(ctx, w, rng));
  const waterTex = makeCanvasTexture(1024, 1024, (ctx, w, h) => paintWater(ctx, w, h, rng));
  const sunTex = makeCanvasTexture(256, 256, paintSunGlow);
  const streakTex = makeCanvasTexture(256, 256, paintStreak);

  const arch: THREE.BufferGeometry[] = []; // all opaque architecture + skyline
  const glow: THREE.BufferGeometry[] = []; // all emissive bulbs + lit windows

  /* -- 1. pier deck + understructure ------------------------------------- */
  const deckLen = DECK_TIP - DECK_END;
  const deckMid = (DECK_TIP + DECK_END) / 2;
  const deckGeo = new THREE.BoxGeometry(deckLen, DECK_THICK, DECK_WIDTH);
  deckGeo.translate(deckMid, -DECK_THICK / 2, 0);

  // Pier-head caisson under the pad: covers the planet's surface bulge near
  // the tangent point (the globe pokes ~2u above the lake plane within ~10u
  // of the pad) and reads as the stone base the pad stands on.
  {
    const caisson = new THREE.CylinderGeometry(11.5, 12.2, 3.5, 20);
    caisson.translate(-1, -2.05, 0);
    tintGeom(caisson, 0x3a4048, 0.06, rng);
    arch.push(caisson);
  }

  // Wooden pilings along both deck faces — the working-wharf read.
  for (let x = -18; x > DECK_END + 2; x -= LAMP_STEP) {
    for (const s of [-1, 1]) {
      const pile = new THREE.CylinderGeometry(0.32, 0.4, 2.6, 5);
      pile.translate(x, -2.3, s * 5.2);
      tintGeom(pile, 0x4a3c2c, 0.08, rng);
      arch.push(pile);
    }
  }

  // Low railings both edges: two rails + posts (RR deck-edge treatment).
  for (const s of [-1, 1]) {
    boxTo(arch, rng, deckLen - 2, 0.08, 0.1, deckMid, 1.04, s * 5.55, 0x6f6154, 0.04);
    boxTo(arch, rng, deckLen - 2, 0.07, 0.09, deckMid, 0.62, s * 5.55, 0x5e5348, 0.04);
    for (let x = DECK_TIP - 1; x > DECK_END + 1; x -= 5.5) {
      boxTo(arch, rng, 0.09, 1.06, 0.09, x, 0.5, s * 5.55, 0x55493d, 0.08);
    }
  }

  // Warm pier lamps every ~22 units, both edges: post + emissive sphere.
  for (let x = 6; x > DECK_END; x -= LAMP_STEP) {
    for (const s of [-1, 1]) {
      boxTo(arch, rng, 0.15, 2.5, 0.15, x, 1.25, s * 5.25, 0x4c463e, 0.06);
      bulbTo(glow, rng, x, 2.66, s * 5.25, 0xffd9a0, 0.27);
    }
  }

  /* -- 2. Centennial Wheel platform + splayed support struts -------------- */
  boxTo(arch, rng, 12, 3.9, 9, WHEEL_X, -1.85, WHEEL_Z, 0x454b54, 0.06);
  {
    const cy = Math.cos(WHEEL_YAW);
    const sy = Math.sin(WHEEL_YAW);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const lx = sx * 6.4;
        const lz = sz * 2.1;
        const fx = WHEEL_X + lx * cy + lz * sy;
        const fz = WHEEL_Z - lx * sy + lz * cy;
        const hx = WHEEL_X + sz * 1.0 * sy;
        const hz = WHEEL_Z + sz * 1.0 * cy;
        strutTo(arch, rng, fx, 0.1, fz, hx, WHEEL_HUB_Y, hz, 0.16, 0xd5dbe1);
      }
    }
    bulbTo(glow, rng, WHEEL_X, WHEEL_HUB_Y, WHEEL_Z, 0xfff1d6, 0.42); // warm hub light
  }

  // The spinner: rim torus + spokes + axle hub, merged, wheel-local X-Y
  // plane with the axle along local Z (RR Centennial Wheel, scaled down).
  const spinParts: THREE.BufferGeometry[] = [];
  {
    const rim = new THREE.TorusGeometry(WHEEL_R, 0.32, 6, 40);
    tintGeom(rim, 0xe8ecf0, 0.05, rng);
    spinParts.push(rim);
    for (let i = 0; i < WHEEL_SPOKES; i++) {
      const a = (i / WHEEL_SPOKES) * Math.PI * 2;
      const sp = new THREE.CylinderGeometry(0.09, 0.09, WHEEL_R - 0.1, 4);
      sp.rotateZ(a - Math.PI / 2);
      sp.translate((Math.cos(a) * WHEEL_R) / 2, (Math.sin(a) * WHEEL_R) / 2, 0);
      tintGeom(sp, 0xc9d2da, 0.06, rng);
      spinParts.push(sp);
    }
    const hub = new THREE.CylinderGeometry(0.7, 0.7, 1.7, 10);
    hub.rotateX(Math.PI / 2);
    tintGeom(hub, 0xe8ecf0, 0, rng);
    spinParts.push(hub);
  }
  const spinGeo = mergeAll(spinParts);

  // One cabin (bail + car + blue skirt like the real gondolas), instanced.
  const cabinParts: THREE.BufferGeometry[] = [];
  {
    const bail = new THREE.CylinderGeometry(0.06, 0.06, 0.55, 4);
    bail.translate(0, -0.28, 0);
    tintGeom(bail, 0xd8dde2, 0, rng);
    cabinParts.push(bail);
    const car = new THREE.BoxGeometry(0.95, 0.8, 0.75);
    car.translate(0, -1.0, 0);
    tintGeom(car, 0xf0f3f5, 0.05, rng);
    cabinParts.push(car);
    const skirt = new THREE.BoxGeometry(1.0, 0.24, 0.8);
    skirt.translate(0, -1.5, 0);
    tintGeom(skirt, 0x1f5fa8, 0.05, rng);
    cabinParts.push(skirt);
  }
  const cabinGeo = mergeAll(cabinParts);

  /* -- 3. Crystal Gardens: plinth + steel arch ribs + glass barrel vault -- */
  boxTo(arch, rng, 20, 1.0, 8.4, CG_X, 0.5, 0, 0xcabfa8, 0.04); // limestone plinth
  for (let x = CG_X - 8; x <= CG_X + 8; x += 4) {
    const rib = new THREE.TorusGeometry(3.6, 0.07, 4, 12, Math.PI);
    rib.rotateY(Math.PI / 2);
    rib.translate(x, 1.0, 0);
    tintGeom(rib, 0xd8dce0, 0.04, rng);
    arch.push(rib);
  }
  const glassParts: THREE.BufferGeometry[] = [];
  {
    // Half-cylinder vault, axis along the pier (RR: rotateX(-PI/2) puts the
    // arc up with the axis on Z, then a quarter yaw turns the axis onto X).
    const vault = new THREE.CylinderGeometry(3.6, 3.6, 18, 16, 1, true, -Math.PI / 2, Math.PI);
    vault.rotateX(-Math.PI / 2);
    vault.rotateY(Math.PI / 2);
    vault.translate(CG_X, 1.0, 0);
    glassParts.push(vault);
    for (const s of [-1, 1]) {
      const end = new THREE.CircleGeometry(3.6, 16, 0, Math.PI);
      end.rotateY(s * (Math.PI / 2));
      end.translate(CG_X + s * 9, 1.0, 0);
      glassParts.push(end);
    }
  }
  const glassGeo = mergeAll(glassParts);
  bulbTo(glow, rng, CG_X - 4, 2.2, 0, 0xd8f0e0, 0.3); // lit from inside all night
  bulbTo(glow, rng, CG_X + 4, 2.2, 0, 0xd8f0e0, 0.3);

  /* -- 4. Festival Hall shed + Head House with twin towers ---------------- */
  boxTo(arch, rng, 12, 3.2, 8.6, -122, 1.6, 0, 0xc7b59a, 0.05); // exhibition shed
  boxTo(arch, rng, 12.2, 0.8, 8.8, -122, 1.8, 0, 0x22333d, 0); // window ribbon
  boxTo(arch, rng, 12.6, 0.5, 9.0, -122, 3.4, 0, 0x8f9298, 0.05); // parapet
  boxTo(arch, rng, 10, 0.8, 3.2, -122, 3.9, 0, 0x6e737a, 0.05); // roof monitor

  boxTo(arch, rng, 16, 6.4, 11, HEAD_X, 3.2, 0, 0x9c5a40, 0.06); // brick block
  boxTo(arch, rng, 16.6, 0.7, 11.6, HEAD_X, 6.7, 0, 0xc7b59a, 0.04); // terracotta cornice
  boxTo(arch, rng, 13, 1.4, 9, HEAD_X, 7.7, 0, 0x8c5039, 0.05); // attic mass
  for (const s of [-1, 1]) {
    const tz = s * 4.3;
    boxTo(arch, rng, 3.4, 10.5, 3.4, HEAD_X - 5.5, 5.25, tz, 0xa86448, 0.06); // twin tower
    const cap = new THREE.ConeGeometry(2.6, 2.4, 4);
    cap.rotateY(Math.PI / 4);
    cap.translate(HEAD_X - 5.5, 11.7, tz);
    tintGeom(cap, 0x5e8f72, 0.05, rng); // patinated copper cone
    arch.push(cap);
  }

  /* -- 5. shore band + skyline silhouettes with lit windows --------------- */
  boxTo(arch, rng, 30, 3.2, 340, -186, -1.9, 0, 0x232b36, 0.08); // dark shoreline band

  const towerPalette = [0x2a3340, 0x2e3846, 0x263039, 0x323d4d] as const;
  let windowCount = 0;
  let antennaBudget = 2;
  for (let i = 0; i < TOWER_COUNT; i++) {
    const u = (i + 0.5) / TOWER_COUNT;
    const phi = (u - 0.5) * 2.3 + (rng() - 0.5) * 0.08;
    const R = TOWER_R_MIN + rng() * TOWER_R_SPAN;
    const w = 6 + rng() * 12; // facade width
    const d = 6 + rng() * 10; // depth toward the camera
    const forcedTall = i === 7 || i === 14;
    const h = forcedTall ? 40 + rng() * 6 : 10 + Math.pow(rng(), 1.35) * 36;
    const px = -Math.cos(phi) * R;
    const pz = Math.sin(phi) * R;

    const tower = new THREE.BoxGeometry(d, h, w);
    tower.rotateY(phi); // front face (+X) turned back toward the pier
    tower.translate(px, -3.6 + h / 2, pz);
    tintGeom(tower, towerPalette[i % towerPalette.length] ?? 0x2a3340, 0.14, rng);
    arch.push(tower);

    // Sparse warm windows on the camera-facing facade: tiny emissive boxes
    // merged into the single glow draw.
    const rows = Math.max(1, Math.floor((h - 3) / 2.5));
    const cols = Math.max(1, Math.floor((w - 1.6) / 1.9));
    for (let r = 0; r < rows; r++) {
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        if (rng() >= WINDOW_DENSITY || windowCount >= MAX_WINDOWS) continue;
        const lx = d / 2 + 0.1;
        const lz = -w / 2 + 1.3 + cIdx * 1.9;
        const o = rotXZ(lx, lz, phi);
        const win = new THREE.BoxGeometry(0.22, 1.15, 0.9);
        win.rotateY(phi);
        win.translate(px + o.x, -3.6 + 2.1 + r * 2.5, pz + o.z);
        tintGeom(win, 0xffca7a, 0.25, rng);
        glow.push(win);
        windowCount++;
      }
    }

    // RR-style crowns on the two tallest: antenna spikes + warm beacons.
    if (forcedTall && antennaBudget > 0) {
      antennaBudget--;
      const topY = -3.6 + h;
      boxTo(arch, rng, 0.5, 8, 0.5, px, topY + 4, pz, 0x1e242e, 0, phi);
      const o = rotXZ(0, w * 0.22, phi);
      boxTo(arch, rng, 0.3, 4.6, 0.3, px + o.x, topY + 2.3, pz + o.z, 0x1e242e, 0, phi);
      bulbTo(glow, rng, px, topY + 8.2, pz, 0xff7a5a, 0.35);
    }
  }

  const archGeo = mergeAll(arch);
  const glowGeo = mergeAll(glow);

  /* -- 6. pad, water, sun path, dome, gulls ------------------------------- */
  const padGeo = new THREE.CircleGeometry(PAD_RADIUS, 48);
  padGeo.rotateX(-Math.PI / 2);

  const waterGeo = new THREE.CircleGeometry(WATER_RADIUS, 64);
  waterGeo.rotateX(-Math.PI / 2);

  const streakGeo = new THREE.PlaneGeometry(16, 170);
  streakGeo.rotateX(-Math.PI / 2); // flat on the water, long axis on Z…
  streakGeo.rotateY(Math.atan2(SUN_AZ_X, SUN_AZ_Z)); // …swung onto the sun azimuth

  const domeGeo = new THREE.SphereGeometry(DOME_RADIUS, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.58);

  // Three gull silhouettes (two-triangle chevrons) seeded around the pivot.
  const gullVerts: number[] = [];
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2;
    const rr = 9 + rng() * 7;
    const gx = Math.cos(a) * rr;
    const gz = Math.sin(a) * rr;
    const gy = rng() * 2.4;
    const half = 0.85 + rng() * 0.4;
    // (A,B,L) + (B,A,R): body chord along z, wingtips lifted on ±x.
    gullVerts.push(gx, gy, gz - 0.32, gx, gy, gz + 0.32, gx - half, gy + 0.42, gz);
    gullVerts.push(gx, gy, gz + 0.32, gx, gy, gz - 0.32, gx + half, gy + 0.42, gz);
  }
  const gullGeo = new THREE.BufferGeometry();
  gullGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gullVerts), 3));

  /* -- materials (all fade-ramped per frame, refs cached below) ----------- */
  const deckMat = new THREE.MeshStandardMaterial({
    map: deckTex,
    roughness: 0.85,
    metalness: 0,
    transparent: true,
    opacity: 0,
  });
  const padMat = new THREE.MeshStandardMaterial({
    map: padTex,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    opacity: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const archMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0,
    transparent: true,
    opacity: 0,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    toneMapped: false,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbfe0e8,
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.35,
    metalness: 0.5,
    transparent: true,
    opacity: 0,
  });
  const cabinMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.4,
    metalness: 0.15,
    transparent: true,
    opacity: 0,
  });
  const waterMat = new THREE.MeshStandardMaterial({
    map: waterTex,
    roughness: 0.25,
    metalness: 0.1,
    transparent: true,
    opacity: 0,
  });
  const streakMat = new THREE.MeshBasicMaterial({
    map: streakTex,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const sunMat = new THREE.SpriteMaterial({
    map: sunTex,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const gullMat = new THREE.MeshBasicMaterial({
    color: 0x26222b,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
  });
  const domeUniforms = {
    uOpacity: { value: 0 },
    uSunDir: { value: new THREE.Vector3(SUN_AZ_X, 0.05, SUN_AZ_Z).normalize() },
  };
  const domeMat = new THREE.ShaderMaterial({
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    uniforms: domeUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
  });

  const textures: THREE.Texture[] = [deckTex, padTex, waterTex, sunTex, streakTex];
  const geometries: THREE.BufferGeometry[] = [
    deckGeo,
    padGeo,
    archGeo,
    glowGeo,
    glassGeo,
    spinGeo,
    cabinGeo,
    waterGeo,
    streakGeo,
    domeGeo,
    gullGeo,
  ];
  const materials: THREE.Material[] = [
    deckMat,
    padMat,
    archMat,
    glowMat,
    glassMat,
    steelMat,
    cabinMat,
    waterMat,
    streakMat,
    sunMat,
    gullMat,
    domeMat,
  ];

  // The per-frame fade list: master k times each material's resting opacity.
  const fade: { m: THREE.Material; mul: number }[] = [
    { m: deckMat, mul: 1 },
    { m: padMat, mul: 1 },
    { m: archMat, mul: 1 },
    { m: glowMat, mul: 1 },
    { m: steelMat, mul: 1 },
    { m: cabinMat, mul: 1 },
    { m: waterMat, mul: 1 },
    { m: glassMat, mul: 0.3 }, // glass rests translucent
    { m: gullMat, mul: 0.9 },
  ];

  return {
    textures,
    geometries,
    materials,
    deckGeo,
    padGeo,
    archGeo,
    glowGeo,
    glassGeo,
    spinGeo,
    cabinGeo,
    waterGeo,
    streakGeo,
    domeGeo,
    gullGeo,
    deckMat,
    padMat,
    archMat,
    glowMat,
    glassMat,
    steelMat,
    cabinMat,
    waterMat,
    streakMat,
    sunMat,
    domeMat,
    gullMat,
    domeUniforms,
    fade,
  };
}

/* ---- component ----------------------------------------------------------- */

export function LandingSite({
  waypoints,
  t,
  reduced,
}: {
  waypoints: Waypoint[];
  t: MotionValue<number>;
  reduced: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const spinnerRef = useRef<THREE.Mesh>(null);
  const cabinsRef = useRef<THREE.InstancedMesh>(null);
  const gullsRef = useRef<THREE.Group>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const sunLightRef = useRef<THREE.DirectionalLight>(null);

  // The sun light's aim point: parented into the site at the pad origin, so
  // the low sunset light rakes across the pad (and rim-lights the ship).
  const sunTarget = useMemo(() => new THREE.Object3D(), []);

  // The site's frames. Outer group: local +Y is the pad's surface normal,
  // origin is the sphere-surface point under the pad. Inner group: the
  // ENGINE'S landing-camera tangent frame — tHat = norm(cross(nHat, +Y)),
  // bHat = cross(nHat, tHat) — pulled into outer-local space (qInverse) and
  // turned into a yaw basis with +X = tLocal and +Z = -bLocal, so the scene
  // is guaranteed to face the landing camera however the pad normal points.
  const frame = useMemo(() => {
    const wp = waypoints[waypoints.length - 1];
    if (!wp || wp.kind !== 'earthReturn' || !wp.site) return null;
    const nHat = new THREE.Vector3(
      wp.site[0] - wp.bodyPos[0],
      wp.site[1] - wp.bodyPos[1],
      wp.site[2] - wp.bodyPos[2],
    ).normalize();
    const position = new THREE.Vector3(wp.bodyPos[0], wp.bodyPos[1], wp.bodyPos[2]).addScaledVector(
      nHat,
      wp.bodyRadius,
    );
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, nHat);

    const tHat = new THREE.Vector3().crossVectors(nHat, up);
    if (tHat.lengthSq() < 1e-6) tHat.set(1, 0, 0); // pad at a pole: any tangent
    tHat.normalize();
    const bHat = new THREE.Vector3().crossVectors(nHat, tHat);
    const qInv = quaternion.clone().invert();
    const tLocal = tHat.clone().applyQuaternion(qInv);
    tLocal.y = 0;
    tLocal.normalize();
    const bLocal = bHat.clone().applyQuaternion(qInv);
    bLocal.y = 0;
    bLocal.normalize();
    const basis = new THREE.Matrix4().makeBasis(tLocal, up, bLocal.clone().negate());
    const yawQuat = new THREE.Quaternion().setFromRotationMatrix(basis);
    return { position, quaternion, yawQuat };
  }, [waypoints]);

  const assets = useMemo(buildAssets, []);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  // Precompile every landing material and upload the canvas textures at
  // MOUNT, while the boot overlay still covers the canvas. Left to first
  // use, the whole sunset pipeline would compile at the exact moment the
  // site becomes visible mid-descent — a multi-second stall on software
  // rendering and a visible hitch on real GPUs.
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    const wasVisible = g.visible;
    g.visible = true;
    gl.compile(g, camera);
    for (const tex of assets.textures) gl.initTexture(tex);
    g.visible = wasVisible;
  }, [gl, camera, assets]);

  // Everything imperative gets disposed imperatively.
  useEffect(
    () => () => {
      for (const tex of assets.textures) tex.dispose();
      for (const geo of assets.geometries) geo.dispose();
      for (const mat of assets.materials) mat.dispose();
    },
    [assets],
  );

  // Cabins start parked at spin 0 — also the resting pose under reduced.
  useLayoutEffect(() => {
    const cab = cabinsRef.current;
    if (cab) poseCabins(cab, 0);
  }, [assets, frame]);

  // Reduced motion parks the wheel, cabins and gulls at their build pose —
  // including when the preference flips mid-spin.
  useEffect(() => {
    if (!reduced) return;
    if (spinnerRef.current) spinnerRef.current.rotation.z = 0;
    const cab = cabinsRef.current;
    if (cab) poseCabins(cab, 0);
    if (gullsRef.current) gullsRef.current.rotation.y = 0;
  }, [reduced]);

  // The ramp is STATE (flight position along the homecoming leg) times a
  // camera-distance gate, so it runs every rung — reduced motion included.
  // Only the wheel/gull/shimmer motion below is gated.
  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const n = waypoints.length;
    const ramp = legInto(n, n - 1, t.get());
    const visible = ramp > VISIBLE_AT;
    group.visible = visible;
    if (!visible) return;

    // Master opacity: flight ramp times how close the camera actually is —
    // the pier only exists once the descent is INSIDE its bubble.
    group.getWorldPosition(_sitePos);
    const dist = state.camera.position.distanceTo(_sitePos);
    const kCam = 1 - sstep((dist - CAM_FADE_NEAR) / CAM_FADE_SPAN);
    const k = sstep((ramp - FADE_START) / FADE_SPAN) * kCam;
    const kd = sstep((ramp - DOME_START) / DOME_SPAN) * kCam;

    for (const f of assets.fade) f.m.opacity = f.mul * k;
    assets.domeUniforms.uOpacity.value = kd;
    assets.sunMat.opacity = SUN_SPRITE_OPACITY * kd;

    const e = state.clock.elapsedTime;
    // Sun-path shimmer: a slow breathing of the specular streak. Parked
    // (steady) under reduced motion.
    assets.streakMat.opacity = STREAK_OPACITY * k * (reduced ? 1 : 0.85 + 0.15 * Math.sin(e * 0.6));

    if (hemiRef.current) hemiRef.current.intensity = HEMI_INTENSITY * k;
    if (sunLightRef.current) sunLightRef.current.intensity = SUN_INTENSITY * k;

    if (!reduced) {
      const spin = e * WHEEL_SPEED;
      if (spinnerRef.current) spinnerRef.current.rotation.z = spin;
      const cab = cabinsRef.current;
      if (cab) poseCabins(cab, spin);
      if (gullsRef.current) gullsRef.current.rotation.y = e * GULL_SPEED;
    }
  });

  if (!frame) return null;

  return (
    <group ref={groupRef} position={frame.position} quaternion={frame.quaternion} visible={false}>
      {/* Pier space: +X toward the landing camera, deck running -X to shore,
          skyline across ±Z, sunset low toward (-1, 0, -0.5). */}
      <group quaternion={frame.yawQuat}>
        {/* 1. Wooden deck, pier tip at the origin. */}
        <mesh geometry={assets.deckGeo} material={assets.deckMat} />

        {/* 2. Landing pad painted on the pier tip, under the ship. */}
        <mesh geometry={assets.padGeo} material={assets.padMat} position={[0, PAD_LIFT, 0]} />

        {/* 3. All opaque architecture + skyline: ONE merged vertex-colored
            draw (caisson, pilings, railings, lamp posts, wheel base+struts,
            Crystal Gardens plinth+ribs, sheds, Head House, shore, towers). */}
        <mesh geometry={assets.archGeo} material={assets.archMat} />

        {/* 4. Every light that is ON: pier lamps, wheel hub, Crystal Gardens
            interior, tower beacons, ~150 lit windows. ONE merged draw. */}
        <mesh geometry={assets.glowGeo} material={assets.glowMat} />

        {/* 5. Crystal Gardens glass vault: translucent, drawn over the sky. */}
        <mesh geometry={assets.glassGeo} material={assets.glassMat} renderOrder={2} />

        {/* 6. Centennial Wheel: spinner (1 draw) + upright cabins (1 draw). */}
        <group position={[WHEEL_X, WHEEL_HUB_Y, WHEEL_Z]} rotation={[0, WHEEL_YAW, 0]}>
          <mesh ref={spinnerRef} geometry={assets.spinGeo} material={assets.steelMat} />
          <instancedMesh
            ref={cabinsRef}
            args={[assets.cabinGeo, assets.cabinMat, WHEEL_CABINS]}
            frustumCulled={false}
          />
        </group>

        {/* 7. The lake: calm dusk water, rim baked to dissolve into haze. */}
        <mesh geometry={assets.waterGeo} material={assets.waterMat} position={[0, WATER_Y, 0]} />

        {/* 8. The sun's specular path: one additive streak lying on the
            water, pointing at the sun azimuth. */}
        <mesh
          geometry={assets.streakGeo}
          material={assets.streakMat}
          position={[SUN_AZ_X * 92, WATER_Y + 0.14, SUN_AZ_Z * 92]}
          renderOrder={2}
        />

        {/* 9. Sunset sky dome: drawn after the depth-writing pier/skyline so
            the architecture silhouettes against it. */}
        <mesh geometry={assets.domeGeo} material={assets.domeMat} renderOrder={1} />

        {/* 10. The sun: one big additive glow just above the horizon. */}
        <sprite
          position={[SUN_AZ_X * 385, 17, SUN_AZ_Z * 385]}
          scale={[SUN_SPRITE_SCALE, SUN_SPRITE_SCALE, 1]}
          renderOrder={2}
        >
          <primitive object={assets.sunMat} attach="material" />
        </sprite>

        {/* 11. Gulls: three silhouettes on a slow circle over the water,
            parked under reduced motion. */}
        <group ref={gullsRef} position={[GULL_X, GULL_Y, GULL_Z]}>
          <mesh geometry={assets.gullGeo} material={assets.gullMat} />
        </group>

        {/* 12. Site lights, intensities ramped with k so deep space stays
            untouched until the descent: warm hemisphere fill + the low sun
            FROM the sunset azimuth. The ship at the pad reads rim-lit. */}
        <hemisphereLight ref={hemiRef} args={[HEMI_SKY, HEMI_GROUND, 0]} />
        <directionalLight
          ref={sunLightRef}
          color={SUN_COLOR}
          intensity={0}
          position={SUN_LIGHT_POS}
          target={sunTarget}
        />
        <primitive object={sunTarget} />
      </group>
    </group>
  );
}
