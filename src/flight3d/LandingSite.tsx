/* ==== LANDING SITE: NAVY PIER AT SUNSET =====================================
 *
 * The finale's ground truth. The voyage now ends where the author's own
 * River Racer game lives: the tip of Navy Pier at golden hour. The ship sets
 * down on a pier-end pad; the wooden deck runs back toward shore past the
 * Centennial Wheel, the Crystal Gardens glass vault and the 1916 Head House;
 * the Chicago skyline stands silhouetted against a warm sunset over a calm
 * Lake Michigan, windows lit. The pier shapes, the vertex-color "tintGeom"
 * shading, the sky-gradient structure, the lit-window atlas technique and
 * the signature-tower silhouettes (Willis / Hancock / Marina City / Aon /
 * Crain analogues) are adapted directly from the user's river-racer repo
 * (js/world/lake.js, city.js, landmarks.js, sky.js, js/data/chicago.js),
 * inlined here as self-contained TypeScript.
 *
 * Layout happens in a "pier space" child group whose +X axis is the engine's
 * landing-camera tangent tHat and whose -Z axis is bHat: the camera parks at
 * ~(+12, +2.6, 0) looking down -X with a -Z drift, so the deck runs to
 * x=-170, the wheel stands at (-60, z=-9.5), the skyline spreads across ±Z
 * beyond x=-175, and the sun sits low toward (-1, 0, -0.5).
 *
 * Everything is procedural and seeded (mulberry32(0xC0FFEE), one rng, fixed
 * order), merged RR-style into ~15 draw calls. The opacity ramp is STATE (it
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
const VISIBLE_AT = 0.6;
const FADE_START = 0.7;
const FADE_SPAN = 0.22;
const DOME_START = 0.8; // the sky completes last: most readable "from outside"
const DOME_SPAN = 0.16;
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

// Skyline: seeded Chicago silhouettes on the shore arc beyond the pier root —
// two depth rows of background towers (near dark/cool, far lifted into the
// sunset haze) plus five signature masses adapted from the user's river-racer
// landmarks (Willis / Hancock / Marina City / Aon / Crain analogues). Window
// grids come from ONE shared 1024² emissive atlas; the whole skyline is ONE
// merged mesh.
const SKYLINE_NEAR_COUNT = 14;
const SKYLINE_FAR_COUNT = 12;
const TOWER_R_MIN = 178;
const TOWER_R_SPAN = 30;
const FAR_R_MIN = 230;
const FAR_R_SPAN = 42;
const SHORE_Y = -3.6; // tower bases sink just under the water plane

// Horizon haze: an additive gradient ring where the towers meet the water.
const HAZE_R = 171;
const HAZE_H = 26;
const HAZE_Y = 7;
const HAZE_OPACITY = 0.5;
const HAZE_SUN_U = 0.676; // cylinder-u of the sun azimuth: haze warmest there

// Skyline water reflection: one additive plane of smeared warm columns,
// painted FROM the seeded tower z-positions so light lands under towers.
const REFL_X = -138; // plane centre along the camera axis
const REFL_W = 84; // extent toward the camera (the smear direction)
const REFL_SPAN = 400; // extent across the skyline
const REFL_OPACITY = 0.25;

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

// Fireworks (adapted from the user's river-racer js/world/fireworks.js —
// "fireworks over Navy Pier at night"): ONE additive Points pool, armed when
// the ship first touches down (ramp >= FW_ARM_AT), re-armed after flying away
// and returning (latch resets below FW_DISARM_AT). Launch points sit on the
// water beside the skyline, clear of the deck. Everything is seeded — shells
// and spark directions come from mulberry32 tables built once; the useFrame
// choreography reads state.clock.elapsedTime epochs only.
const FW_MAX = 600; // pool size: rockets + trails + bursts share it
const FW_ARM_AT = 0.99; // ramp latch: touched down
const FW_DISARM_AT = 0.6; // ramp unlatch: flew away — return re-celebrates
const FW_SALVO = 3; // opening salvo size…
const FW_SHELL_COUNT = 24; // cyclic seeded shell table
const FW_SPARK_COUNT = 192; // seeded unit-sphere spark table
const FW_ASCENT_T = 1.2; // rocket flight time, seconds
const FW_LAUNCH_Y = WATER_Y + 0.4; // motes rise off the water surface
const FW_G = 9.0; // gravity on rockets and sparks
const FW_DRAG = 1.5; // exponential drag on burst sparks
const FW_LIFT = 1.6; // slight upward bias at burst
const FW_BIRTH_BRIGHT = 3.2; // >1 at birth so bloom catches the burst
const FW_ROCKET_BRIGHT = 2.0; // the ascending mote stays hot
const FW_ROCKET_SIZE = 1.5;
const FW_TRAIL_STEP = 0.07; // seconds between trail ticks up the ascent
const FW_TRAIL_LIFE = 0.38;
const FW_TRAIL_SIZE = 0.7;
const FW_SEED = 0xf17e0a11; // separate rng: the site's own seed order is sacred

// Shell palette — warm gold, ember, cyan-bright, soft white — routed through
// THREE.Color so the values land in the linear working space like every other
// color in the file.
const FW_PAL: Float32Array = (() => {
  const hex = [0xffd9a0, 0xff9a5a, 0x7df9ff, 0xfff3d0] as const;
  const out = new Float32Array(hex.length * 3);
  const c = new THREE.Color();
  for (let i = 0; i < hex.length; i++) {
    c.setHex(hex[i] ?? 0xffffff);
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  return out;
})();

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

/* ---- fireworks point shader ----------------------------------------------- */

// Per-particle color AND size (PointsMaterial has no per-point size, and the
// spec wants sparks that shrink as they fade). uK is the site's master fade:
// the show dims and dies exactly with the rest of the pier. Additive
// blending: the frag alpha (soft radial sprite) scales the HDR color into the
// framebuffer, so birth brightness > 1 survives for bloom.
const FW_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uK;
  varying vec3 vColor;
  void main() {
    vColor = aColor * uK;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (340.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;
const FW_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a;
    gl_FragColor = vec4(vColor, a);
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

/** Soft round spark sprite for the fireworks points (the RR fireworks.js
 *  64px radial: hot white core, feathered edge — only alpha is sampled). */
function paintSpark(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const c = w / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/* ---- skyline window atlas (technique adapted from RR city.js nightTile) -- */

// One 1024² canvas split into 4×2 facade-grid variants. Top row: near-depth
// variants at full brightness; bottom row: the same grids dimmed and sparser
// for the far row — aerial perspective without a second material. Every tower
// facade samples one variant at a seeded, bay-aligned UV offset, so ~30
// towers share ONE texture and ONE merged draw.
const ATLAS_PX = 1024;
const CELL_W = 256;
const CELL_H = 512;
const CELL_MARGIN = 8;
const ATLAS_PPX = 10; // atlas px per world unit across a facade (bay ≈ 1.6–2.4u)
const ATLAS_PPY = 7; // atlas px per world unit up a facade (floor ≈ 2.3–3.4u)

type AtlasVariant = {
  col: number;
  row: number;
  bayPx: number;
  floorPx: number;
  density: number;
  dim: number;
};

const ATLAS_VARIANTS: readonly AtlasVariant[] = [
  { col: 0, row: 0, bayPx: 19, floorPx: 18, density: 0.52, dim: 1 },
  { col: 1, row: 0, bayPx: 24, floorPx: 20, density: 0.44, dim: 1 },
  { col: 2, row: 0, bayPx: 16, floorPx: 16, density: 0.55, dim: 1 },
  { col: 3, row: 0, bayPx: 21, floorPx: 23, density: 0.38, dim: 1 },
  { col: 0, row: 1, bayPx: 19, floorPx: 18, density: 0.4, dim: 0.55 },
  { col: 1, row: 1, bayPx: 24, floorPx: 20, density: 0.34, dim: 0.5 },
  { col: 2, row: 1, bayPx: 16, floorPx: 16, density: 0.44, dim: 0.55 },
  { col: 3, row: 1, bayPx: 22, floorPx: 24, density: 0.3, dim: 0.45 },
];

function variantAt(i: number): AtlasVariant {
  return ATLAS_VARIANTS[i] ?? { col: 0, row: 0, bayPx: 19, floorPx: 18, density: 0.5, dim: 1 };
}

function dimHex(hex: string, k: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) * k) | 0;
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) * k) | 0;
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) * k) | 0;
  return `rgb(${r},${g},${b})`;
}

/** Lit-window grids with realistic clumping: whole dark floors, lit runs and
 *  dark gaps carried by a run-length state, per-cell brightness jitter, upper
 *  floors sparser (facades anchor to each cell's bottom edge). The RR
 *  nightTile insight applies: offices are not all lit to the same level, so
 *  every cell gets its own dim factor or the tower reads as one slab. */
function paintWindowAtlas(ctx: CanvasRenderingContext2D, rng: () => number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, ATLAS_PX, ATLAS_PX);
  const lit = ['#ffd9a0', '#ffca7a', '#fff3d0'] as const;
  for (const v of ATLAS_VARIANTS) {
    const x0 = v.col * CELL_W;
    const y0 = v.row * CELL_H;
    const cols = Math.floor((CELL_W - 2 * CELL_MARGIN) / v.bayPx);
    const rows = Math.floor((CELL_H - 2 * CELL_MARGIN) / v.floorPx);
    for (let r = 0; r < rows; r++) {
      if (rng() < 0.15) continue; // a whole dark floor
      const height = 1 - r / rows; // 1 at the cell top (upper floors)
      const density = v.density * (0.62 + 0.38 * (1 - height));
      let run = 0;
      let on = false;
      for (let c = 0; c < cols; c++) {
        if (run <= 0) {
          on = rng() < density;
          run = 1 + Math.floor(rng() * (on ? 3 : 4)); // lit clusters / dark gaps
        }
        run--;
        if (!on) continue;
        const hex = lit[Math.floor(rng() * lit.length)] ?? '#ffca7a';
        ctx.fillStyle = dimHex(hex, (0.66 + rng() * 0.38) * v.dim);
        ctx.fillRect(
          x0 + CELL_MARGIN + c * v.bayPx + 2,
          y0 + CELL_MARGIN + r * v.floorPx + 2,
          v.bayPx - 4,
          v.floorPx - 5,
        );
      }
    }
  }
}

/** Horizon haze band for the haze ring: vertical warm-rose gradient (bottom of
 *  the canvas = bottom of the cylinder), alpha-shaped around the ring so the
 *  glow peaks on the sun azimuth. Seam-safe: the horizontal factor depends on
 *  wrapped distance from HAZE_SUN_U only. */
function paintHaze(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, 'rgba(255,152,95,0.6)');
  g.addColorStop(0.42, 'rgba(214,122,128,0.28)');
  g.addColorStop(0.78, 'rgba(150,92,122,0.09)');
  g.addColorStop(1, 'rgba(150,92,122,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const m = ctx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    let dU = Math.abs(u - HAZE_SUN_U);
    if (dU > 0.5) dU = 1 - dU;
    const f = 0.45 + 0.55 * (0.5 + 0.5 * Math.cos(dU * Math.PI * 2));
    m.addColorStop(u, `rgba(0,0,0,${f.toFixed(3)})`);
  }
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = m;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

/** Skyline water reflection: smeared warm columns painted FROM the same
 *  seeded tower positions the skyline was built with (u runs toward the
 *  camera — the smear direction; v spans the skyline's z). Each streak gets a
 *  soft body plus a narrower brighter core. */
function paintReflections(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  entries: { z: number; w: number; s: number }[],
  rng: () => number,
): void {
  const wash = ctx.createLinearGradient(0, 0, w * 0.6, 0);
  wash.addColorStop(0, 'rgba(255,150,88,0.14)'); // the city-glow base wash
  wash.addColorStop(1, 'rgba(255,150,88,0)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);
  for (const e of entries) {
    if (Math.abs(e.z) > REFL_SPAN * 0.42) continue; // off the water disc
    const y = (0.5 + e.z / REFL_SPAN) * h;
    const half = Math.max(2, (e.w * 0.55 * h) / REFL_SPAN);
    const len = w * (0.3 + 0.55 * Math.min(1, e.s));
    const a = 0.3 + 0.45 * Math.min(1, e.s);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, `rgba(255,196,130,${a.toFixed(3)})`);
    g.addColorStop(0.55, `rgba(255,170,110,${(a * 0.4).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,170,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - half, len, half * 2);
    ctx.fillRect(0, y - half * 0.35, len * (0.75 + rng() * 0.35), half * 0.7);
  }
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

/** Remap a BoxGeometry's UVs so each SIDE facade samples one window-atlas
 *  variant at a seeded, bay/floor-aligned offset (whole windows, never cut
 *  cells), scaled so the grid keeps a constant world pitch across every
 *  tower. Roof and underside collapse onto a black atlas texel. */
function mapTowerUVs(
  geo: THREE.BufferGeometry,
  sx: number,
  sy: number,
  sz: number,
  v: AtlasVariant,
  rng: () => number,
): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const cellX = v.col * CELL_W;
  const cellY = v.row * CELL_H;
  const hPx = Math.min(sy * ATLAS_PPY, CELL_H - 2 * CELL_MARGIN);
  for (let face = 0; face < 6; face++) {
    // box face order: +x, -x, +y, -y, +z, -z — faces 2/3 are roof/underside
    if (face === 2 || face === 3) {
      for (let i = 0; i < 4; i++) uv.setXY(face * 4 + i, 3 / ATLAS_PX, 1 - 3 / ATLAS_PX);
      continue;
    }
    const fw = face < 2 ? sz : sx; // ±x faces span the z extent and vice versa
    const wPx = Math.min(fw * ATLAS_PPX, CELL_W - 2 * CELL_MARGIN);
    const bayOff = Math.floor((rng() * (CELL_W - 2 * CELL_MARGIN - wPx)) / v.bayPx) * v.bayPx;
    const floorSlack = Math.floor((CELL_H - 2 * CELL_MARGIN - hPx) / v.floorPx);
    const floorOff = Math.floor(rng() * (Math.min(3, floorSlack) + 1)) * v.floorPx;
    const yBot = cellY + CELL_H - CELL_MARGIN - floorOff; // canvas y of the facade base
    for (let i = 0; i < 4; i++) {
      const k = face * 4 + i;
      uv.setXY(
        k,
        (cellX + CELL_MARGIN + bayOff + uv.getX(k) * wPx) / ATLAS_PX,
        1 - (yBot - uv.getY(k) * hPx) / ATLAS_PX,
      );
    }
  }
  uv.needsUpdate = true;
}

/** Skyline tower mass: an atlas-windowed box with its base at yBase. sx runs
 *  toward the camera (depth), sz across the skyline (facade width). */
function towerTo(
  list: THREE.BufferGeometry[],
  rng: () => number,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  yBase: number,
  z: number,
  hex: number,
  v: AtlasVariant,
  rotY: number,
  jitter = 0.1,
): void {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  mapTowerUVs(g, sx, sy, sz, v, rng);
  if (rotY) g.rotateY(rotY);
  g.translate(x, yBase + sy / 2, z);
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

/* ---- fireworks: seeded tables + pool simulation (RR fireworks.js) --------- */

// A seeded "shell": where it launches on the water, how it drifts and how
// high it climbs, its palette color, burst size, where it starts reading the
// spark table, and how long after it the NEXT rocket waits.
type FwShell = {
  lx: number; // launch x, pier-local [-130, -55] — over the water
  lz: number; // launch z, ±[12, 60] — clear of the deck (and the wheel)
  dx: number; // lateral drift during ascent
  dz: number;
  ascent: number; // rise height, 26–44 units in ~1.2 s
  ci: number; // palette index
  count: number; // burst particles, 40–70
  off: number; // starting offset into the spark table
  gap: number; // seconds to the next rocket while docked, 7–9
  salvoGap: number; // stagger inside the opening salvo, ~0.8
};

// A seeded spark: unit-sphere direction plus speed / life / brightness / size
// jitter. Each shell reads `count` consecutive entries from its own offset.
type FwSpark = {
  dx: number;
  dy: number;
  dz: number;
  spd: number;
  life: number; // 1.6–2.4 s
  jit: number; // per-spark brightness jitter
  size: number;
};

// Pool particle (RR's pool-of-structs, allocated once — never per frame).
// kind: 0 = ascending rocket mote, 1 = burst spark, 2 = trail tick.
type FwParticle = {
  kind: number;
  shell: number; // rocket only: which shell to burst as
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  r: number;
  g: number;
  b: number;
  size: number;
  trail: number; // rocket only: trail-tick accumulator
};

type FwSim = {
  geo: THREE.BufferGeometry;
  mat: THREE.ShaderMaterial;
  tex: THREE.CanvasTexture;
  uniforms: { uK: { value: number }; uMap: { value: THREE.Texture } };
  posAttr: THREE.BufferAttribute;
  colAttr: THREE.BufferAttribute;
  sizeAttr: THREE.BufferAttribute;
  posArr: Float32Array;
  colArr: Float32Array;
  sizeArr: Float32Array;
  pool: FwParticle[];
  shells: FwShell[];
  sparks: FwSpark[];
  // mutable choreography state (the memoized sim object IS the ref)
  cursor: number;
  armed: boolean;
  live: boolean;
  salvoLeft: number;
  counter: number;
  nextLaunch: number; // elapsedTime epoch of the next launch
  lastE: number; // previous elapsedTime, for dt
};

/** Seeded tables + pool + ONE Points geometry/material, built once. A
 *  separate mulberry32 stream so the site's own fixed rng order is
 *  untouched — the pier looks identical with or without this system. */
function buildFireworks(): FwSim {
  const rng = mulberry32(FW_SEED);

  const shells: FwShell[] = [];
  for (let i = 0; i < FW_SHELL_COUNT; i++) {
    shells.push({
      // Closer to the pad and higher into the darker upper sky than the
      // first pass — bursts at the old range washed out against the bright
      // horizon band (screenshot finding).
      lx: -95 + rng() * 55,
      lz: (rng() < 0.5 ? -1 : 1) * (12 + rng() * 48),
      dx: (rng() - 0.5) * 3,
      dz: (rng() - 0.5) * 3,
      ascent: 34 + rng() * 20,
      ci: Math.floor(rng() * 4),
      count: 60 + Math.floor(rng() * 31),
      off: Math.floor(rng() * FW_SPARK_COUNT),
      gap: 7 + rng() * 2,
      salvoGap: 0.7 + rng() * 0.25,
    });
  }

  const sparks: FwSpark[] = [];
  for (let i = 0; i < FW_SPARK_COUNT; i++) {
    const u = rng() * 2 - 1;
    const th = rng() * Math.PI * 2;
    const rr = Math.sqrt(Math.max(0, 1 - u * u));
    sparks.push({
      dx: rr * Math.cos(th),
      dy: u,
      dz: rr * Math.sin(th),
      spd: 13 + rng() * 7,
      life: 1.6 + rng() * 0.8,
      jit: 0.8 + rng() * 0.5,
      size: 1.8 + rng() * 1.0,
    });
  }

  const pool: FwParticle[] = [];
  for (let i = 0; i < FW_MAX; i++) {
    pool.push({
      kind: 1,
      shell: 0,
      x: 0,
      y: -9999,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      age: 1,
      life: 0,
      r: 0,
      g: 0,
      b: 0,
      size: 0,
      trail: 0,
    });
  }

  const posArr = new Float32Array(FW_MAX * 3);
  for (let i = 0; i < FW_MAX; i++) posArr[i * 3 + 1] = -9999;
  const colArr = new Float32Array(FW_MAX * 3);
  const sizeArr = new Float32Array(FW_MAX);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(posArr, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(colArr, 3);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  const sizeAttr = new THREE.BufferAttribute(sizeArr, 1);
  sizeAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aColor', colAttr);
  geo.setAttribute('aSize', sizeAttr);
  geo.setDrawRange(0, 0); // free until the first touchdown arms it
  // Static generous bounds over the launch water — never recomputed.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(-92, 20, 0), 200);

  const tex = makeCanvasTexture(64, 64, paintSpark);
  const uniforms = { uK: { value: 0 }, uMap: { value: tex as THREE.Texture } };
  const mat = new THREE.ShaderMaterial({
    vertexShader: FW_VERT,
    fragmentShader: FW_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  return {
    geo,
    mat,
    tex,
    uniforms,
    posAttr,
    colAttr,
    sizeAttr,
    posArr,
    colArr,
    sizeArr,
    pool,
    shells,
    sparks,
    cursor: 0,
    armed: false,
    live: false,
    salvoLeft: 0,
    counter: 0,
    nextLaunch: 0,
    lastE: 0,
  };
}

/** Ring-cursor allocation (RR alloc), refusing to cannibalize a rocket that
 *  is still mid-ascent — losing a spark is invisible, losing a shell is not. */
function fwAlloc(fw: FwSim): FwParticle | undefined {
  for (let tries = 0; tries < 4; tries++) {
    const p = fw.pool[fw.cursor];
    fw.cursor = (fw.cursor + 1) % FW_MAX;
    if (!p) continue;
    if (p.kind === 0 && p.age < p.life) continue;
    return p;
  }
  return undefined;
}

function fwLaunch(fw: FwSim, sh: FwShell, shellIdx: number): void {
  const p = fwAlloc(fw);
  if (!p) return;
  p.kind = 0;
  p.shell = shellIdx;
  p.x = sh.lx;
  p.y = FW_LAUNCH_Y;
  p.z = sh.lz;
  p.vx = sh.dx;
  p.vz = sh.dz;
  // vy chosen so the mote rises exactly `ascent` against gravity in ASCENT_T.
  p.vy = (sh.ascent + 0.5 * FW_G * FW_ASCENT_T * FW_ASCENT_T) / FW_ASCENT_T;
  p.age = 0;
  p.life = FW_ASCENT_T;
  const c = sh.ci * 3;
  p.r = FW_PAL[c] ?? 1;
  p.g = FW_PAL[c + 1] ?? 0.9;
  p.b = FW_PAL[c + 2] ?? 0.7;
  p.size = FW_ROCKET_SIZE;
  p.trail = 0;
}

/** Faint ember tick left behind the ascending mote — pool particles reused
 *  as the trail, per the spec. */
function fwTrailTick(fw: FwSim, src: FwParticle): void {
  const p = fwAlloc(fw);
  if (!p) return;
  p.kind = 2;
  p.shell = 0;
  p.x = src.x;
  p.y = src.y;
  p.z = src.z;
  p.vx = 0;
  p.vy = -0.9;
  p.vz = 0;
  p.age = 0;
  p.life = FW_TRAIL_LIFE;
  p.r = src.r * 0.8; // ember-warm behind the hot mote
  p.g = src.g * 0.65;
  p.b = src.b * 0.5;
  p.size = FW_TRAIL_SIZE;
  p.trail = 0;
}

function fwBurst(fw: FwSim, x: number, y: number, z: number, shellIdx: number): void {
  const sh = fw.shells[shellIdx % fw.shells.length];
  if (!sh) return;
  const c = sh.ci * 3;
  const br = FW_PAL[c] ?? 1;
  const bg = FW_PAL[c + 1] ?? 0.9;
  const bb = FW_PAL[c + 2] ?? 0.7;
  for (let j = 0; j < sh.count; j++) {
    const sp = fw.sparks[(sh.off + j) % fw.sparks.length];
    if (!sp) continue;
    const p = fwAlloc(fw);
    if (!p) continue;
    p.kind = 1;
    p.shell = 0;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = sp.dx * sp.spd;
    p.vy = sp.dy * sp.spd + FW_LIFT;
    p.vz = sp.dz * sp.spd;
    p.age = 0;
    p.life = sp.life;
    p.r = br * sp.jit;
    p.g = bg * sp.jit;
    p.b = bb * sp.jit;
    p.size = sp.size;
    p.trail = 0;
  }
}

/** Arm on touchdown: schedule the opening salvo and open the draw range. */
function fwArm(fw: FwSim, e: number): void {
  fw.armed = true;
  fw.live = true;
  fw.salvoLeft = FW_SALVO;
  fw.nextLaunch = e + 0.35;
  fw.geo.setDrawRange(0, FW_MAX);
}

/** Disarm and clear: kill every particle, hide the buffers, close the draw
 *  range. Called when the ship flies away (ramp < FW_DISARM_AT) and when
 *  reduced motion switches on mid-show. */
function fwKill(fw: FwSim): void {
  fw.armed = false;
  fw.live = false;
  fw.salvoLeft = 0;
  for (const p of fw.pool) {
    p.age = 1;
    p.life = 0;
  }
  for (let i = 0; i < FW_MAX; i++) {
    fw.posArr[i * 3 + 1] = -9999;
    fw.colArr[i * 3] = fw.colArr[i * 3 + 1] = fw.colArr[i * 3 + 2] = 0;
    fw.sizeArr[i] = 0;
  }
  fw.posAttr.needsUpdate = true;
  fw.colAttr.needsUpdate = true;
  fw.sizeAttr.needsUpdate = true;
  fw.geo.setDrawRange(0, 0);
}

/** Per-frame choreography + integration (RR F.update, zero allocation).
 *  e = state.clock.elapsedTime, k = the site's master fade, docked = ramp is
 *  still at touchdown (new launches happen only while docked; in-flight
 *  particles finish naturally as the ship pulls away). */
function fwUpdate(fw: FwSim, e: number, k: number, docked: boolean): void {
  fw.uniforms.uK.value = k;
  const rawDt = e - fw.lastE;
  fw.lastE = e;
  if (!fw.armed && !fw.live) return; // idle: no buffer writes at all
  const dt = rawDt < 0 ? 0 : rawDt > 0.1 ? 0.1 : rawDt;

  // Launch scheduling: the 3-rocket salvo at ~0.8 s stagger, then one rocket
  // every 7–9 s from the seeded gap table, all on elapsedTime epochs.
  if (fw.armed && docked && e >= fw.nextLaunch) {
    const si = fw.counter % fw.shells.length;
    const sh = fw.shells[si];
    if (sh) {
      fwLaunch(fw, sh, si);
      fw.counter++;
      if (fw.salvoLeft > 0) {
        fw.salvoLeft--;
        fw.nextLaunch = e + (fw.salvoLeft > 0 ? sh.salvoGap : sh.gap);
      } else {
        fw.nextLaunch = e + sh.gap;
      }
    }
  }

  const pos = fw.posArr;
  const col = fw.colArr;
  const siz = fw.sizeArr;
  const dr = Math.exp(-FW_DRAG * dt); // spark drag, once per frame
  let alive = 0;
  for (let i = 0; i < FW_MAX; i++) {
    const p = fw.pool[i];
    if (!p) continue;
    if (p.age < p.life) {
      p.age += dt;
      if (p.kind === 0) {
        // Rocket: gravity-decelerated ascent, trail ticks, burst at apex.
        p.vy -= FW_G * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.trail += dt;
        while (p.trail >= FW_TRAIL_STEP) {
          p.trail -= FW_TRAIL_STEP;
          fwTrailTick(fw, p);
        }
        if (p.age >= p.life) {
          fwBurst(fw, p.x, p.y, p.z, p.shell);
          pos[i * 3 + 1] = -9999;
          col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
          siz[i] = 0;
          continue;
        }
        alive++;
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = p.z;
        col[i * 3] = p.r * FW_ROCKET_BRIGHT;
        col[i * 3 + 1] = p.g * FW_ROCKET_BRIGHT;
        col[i * 3 + 2] = p.b * FW_ROCKET_BRIGHT;
        siz[i] = p.size;
      } else if (p.kind === 1) {
        // Spark: gravity + drag, quadratic alpha fade, shrinking size,
        // brightness starting over 1.0 so bloom catches the burst.
        alive++;
        p.vy -= FW_G * dt;
        p.vx *= dr;
        p.vy *= dr;
        p.vz *= dr;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const u0 = 1 - p.age / p.life;
        const u = u0 < 0 ? 0 : u0;
        const a = u * u;
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = p.z;
        col[i * 3] = p.r * FW_BIRTH_BRIGHT * a;
        col[i * 3 + 1] = p.g * FW_BIRTH_BRIGHT * a;
        col[i * 3 + 2] = p.b * FW_BIRTH_BRIGHT * a;
        siz[i] = p.size * (0.35 + 0.65 * u);
      } else {
        // Trail tick: sinks slightly, fades fast, shrinks to nothing.
        alive++;
        p.y += p.vy * dt;
        const u0 = 1 - p.age / p.life;
        const u = u0 < 0 ? 0 : u0;
        const a = u * u;
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = p.z;
        col[i * 3] = p.r * 1.1 * a;
        col[i * 3 + 1] = p.g * 1.1 * a;
        col[i * 3 + 2] = p.b * 1.1 * a;
        siz[i] = p.size * u;
      }
    } else {
      pos[i * 3 + 1] = -9999;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
      siz[i] = 0;
    }
  }
  fw.posAttr.needsUpdate = true;
  fw.colAttr.needsUpdate = true;
  fw.sizeAttr.needsUpdate = true;
  fw.live = fw.armed || alive > 0;
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
  windowGeo: THREE.BufferGeometry;
  hazeGeo: THREE.BufferGeometry;
  reflGeo: THREE.BufferGeometry;
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
  windowMat: THREE.MeshStandardMaterial;
  hazeMat: THREE.MeshBasicMaterial;
  reflMat: THREE.MeshBasicMaterial;
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
  fw: FwSim;
};

/** Everything seeded and built ONCE, drawing from a single rng in a fixed
 *  order so the site is identical on every visit. All merged batches follow
 *  the RR budget discipline: one vertex-colored mesh for ALL opaque
 *  architecture, one for every emissive bulb + beacon, and one atlas-windowed
 *  mesh for the ENTIRE skyline. */
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
  const atlasTex = makeCanvasTexture(ATLAS_PX, ATLAS_PX, (ctx) => paintWindowAtlas(ctx, rng));
  atlasTex.anisotropy = 4;
  const hazeTex = makeCanvasTexture(256, 128, (ctx, w, h) => paintHaze(ctx, w, h));
  // (the reflection texture is painted at the end of section 5, from the
  // tower positions generated there — same rng, same fixed order)

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

  /* -- 5. shore band + the Chicago skyline -------------------------------- */
  boxTo(arch, rng, 30, 3.2, 340, -186, -1.9, 0, 0x232b36, 0.08); // dark shoreline band

  const winParts: THREE.BufferGeometry[] = []; // every atlas-windowed facade
  const refl: { z: number; w: number; s: number }[] = []; // reflection seeds

  // 5a. two depth rows of varied background towers with setbacks: the near
  // row darker/cooler, the far row lifted toward the sunset haze and sampling
  // the atlas' dimmed variants. Real skylines are layered, not a picket fence.
  const NEAR_PAL = [0x232b36, 0x27303c, 0x1f2731, 0x2b3441] as const;
  const FAR_PAL = [0x4a3a4a, 0x52404f, 0x453a4d, 0x4e4452] as const;
  let spikes = 0;
  for (let row = 0; row < 2; row++) {
    const count = row === 0 ? SKYLINE_NEAR_COUNT : SKYLINE_FAR_COUNT;
    const rMin = row === 0 ? TOWER_R_MIN : FAR_R_MIN;
    const rSpan = row === 0 ? TOWER_R_SPAN : FAR_R_SPAN;
    const arc = row === 0 ? 2.1 : 2.4;
    const pal = row === 0 ? NEAR_PAL : FAR_PAL;
    for (let i = 0; i < count; i++) {
      const fu = (i + 0.5) / count;
      const phi = (fu - 0.5) * arc + (rng() - 0.5) * 0.1;
      const R = rMin + rng() * rSpan;
      const w = 7 + rng() * 11; // facade width
      const d = 6 + rng() * 9; // depth toward the camera
      const h = 11 + Math.pow(rng(), 1.3) * (row === 0 ? 30 : 33);
      const px = -Math.cos(phi) * R;
      const pz = Math.sin(phi) * R;
      const hex = pal[i % pal.length] ?? 0x232b36;
      const v = variantAt(row * 4 + Math.floor(rng() * 4));
      towerTo(winParts, rng, d, h, w, px, SHORE_Y, pz, hex, v, phi, 0.14);
      let topY = SHORE_Y + h;
      let tw = w;
      let td = d;
      if (rng() < 0.5) {
        // setbacks: stacked shrinking boxes, slightly offset off-axis
        const tiers = rng() < 0.3 ? 2 : 1;
        for (let s2 = 0; s2 < tiers; s2++) {
          tw *= 0.55 + rng() * 0.2;
          td *= 0.6 + rng() * 0.2;
          const th = h * (0.16 + rng() * 0.2);
          const o = rotXZ((rng() - 0.5) * 1.2, (rng() - 0.5) * 2.4, phi);
          towerTo(winParts, rng, td, th, tw, px + o.x, topY, pz + o.z, hex, v, phi, 0.1);
          topY += th;
        }
      }
      // rooflines: mechanical penthouses, a few antenna spikes with steady
      // RED aircraft-warning beacons merged into the glow batch.
      if (rng() < 0.6) {
        const ph = 1.2 + rng() * 1.8;
        const o = rotXZ((rng() - 0.5) * td * 0.3, (rng() - 0.5) * tw * 0.3, phi);
        const mechHex = row === 0 ? 0x1a2028 : 0x3a3244;
        boxTo(arch, rng, td * 0.42, ph, tw * 0.4, px + o.x, topY + ph / 2, pz + o.z, mechHex, 0.08, phi);
      }
      if (spikes < 4 && h > 26 && rng() < 0.45) {
        spikes++;
        const ah = 4 + rng() * 4;
        boxTo(arch, rng, 0.22, ah, 0.22, px, topY + ah / 2, pz, 0x1e242e, 0, phi);
        bulbTo(glow, rng, px, topY + ah + 0.3, pz, 0xff2a1e, 0.4);
      }
      refl.push({ z: pz, w, s: Math.min(1, h / 40) * (row === 0 ? 0.85 : 0.35) });
    }
  }

  // 5b. signature silhouettes, adapted from river-racer landmarks.js.
  // Willis-like: bundled dark tubes at staggered heights (9→7→5→2 collapsed
  // to four masses) + two white antennas of DIFFERENT lengths — the RR
  // builder's most-photographed detail — on the sunset (south/-z) side.
  {
    const phi = -0.34;
    const R = 210;
    const px = -Math.cos(phi) * R;
    const pz = Math.sin(phi) * R;
    const v = variantAt(4); // dim grid: it silhouettes against the sun
    const hex = 0x1d222c;
    towerTo(winParts, rng, 13, 27, 15, px, SHORE_Y, pz, hex, v, phi, 0.04);
    towerTo(winParts, rng, 10.5, 44, 12, px, SHORE_Y, pz, hex, v, phi, 0.04);
    const oT = rotXZ(0, 1.8, phi);
    towerTo(winParts, rng, 8, 60, 7.5, px + oT.x, SHORE_Y, pz + oT.z, hex, v, phi, 0.04);
    const oB = rotXZ(0, -2.8, phi);
    towerTo(winParts, rng, 8.5, 52, 6.5, px + oB.x, SHORE_Y, pz + oB.z, hex, v, phi, 0.04);
    for (const [zo, ah] of [
      [0.6, 12.5],
      [3.0, 10.6],
    ] as const) {
      const o = rotXZ(0, zo, phi);
      const g = new THREE.CylinderGeometry(0.14, 0.3, ah, 5);
      g.translate(px + o.x, SHORE_Y + 60 + ah / 2, pz + o.z);
      tintGeom(g, 0xe8eaec, 0, rng);
      arch.push(g);
      bulbTo(glow, rng, px + o.x, SHORE_Y + 60 + ah + 0.3, pz + o.z, 0xff2a1e, 0.42);
    }
    refl.push({ z: pz, w: 15, s: 0.95 });
  }

  // Hancock-like: broad-shouldered tapered obelisk (five shrinking sections,
  // as in the RR builder) with a two-antenna crown, north (+z) of the pier.
  {
    const phi = 0.52;
    const R = 240;
    const px = -Math.cos(phi) * R;
    const pz = Math.sin(phi) * R;
    const v = variantAt(6);
    const hex = 0x232733;
    const H = 52;
    const W0 = 16;
    const D0 = 11;
    const secs = [
      [1, 1, 0, 0.3],
      [0.85, 0.88, 0.3, 0.55],
      [0.72, 0.78, 0.55, 0.76],
      [0.6, 0.68, 0.76, 0.92],
      [0.52, 0.6, 0.92, 1],
    ] as const;
    for (const [sw, sd, f0, f1] of secs) {
      towerTo(winParts, rng, D0 * sd, H * (f1 - f0), W0 * sw, px, SHORE_Y + H * f0, pz, hex, v, phi, 0.04);
    }
    for (const s of [-1, 1] as const) {
      const o = rotXZ(0, s * 2.2, phi);
      const g = new THREE.CylinderGeometry(0.13, 0.26, 9, 5);
      g.translate(px + o.x, SHORE_Y + H + 4.5, pz + o.z);
      tintGeom(g, 0xe8eaec, 0, rng);
      arch.push(g);
      bulbTo(glow, rng, px + o.x, SHORE_Y + H + 9.3, pz + o.z, 0xff2a1e, 0.4);
    }
    refl.push({ z: pz, w: 16, s: 0.8 });
  }

  // Marina City-like: the twin scalloped concrete cylinders right at the
  // river mouth — a ribbed drum reads as the corncob at this distance.
  {
    const phi = -0.06;
    const R = 190;
    const cx = -Math.cos(phi) * R;
    const cz = Math.sin(phi) * R;
    for (const s of [-1, 1] as const) {
      const o = rotXZ(0, s * 5.6, phi);
      const x = cx + o.x;
      const z = cz + o.z;
      const core = new THREE.CylinderGeometry(3.1, 3.1, 26, 14);
      core.translate(x, SHORE_Y + 13, z);
      tintGeom(core, 0x6b5f57, 0.05, rng);
      arch.push(core);
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + s;
        const rib = new THREE.CylinderGeometry(0.62, 0.62, 24.4, 5);
        rib.translate(x + Math.cos(a) * 3.0, SHORE_Y + 12.2, z + Math.sin(a) * 3.0);
        tintGeom(rib, 0x776a5f, 0.08, rng);
        arch.push(rib);
      }
      const cap = new THREE.CylinderGeometry(2.6, 3.2, 1.4, 10);
      cap.translate(x, SHORE_Y + 26.6, z);
      tintGeom(cap, 0x5a5049, 0, rng);
      arch.push(cap);
    }
    refl.push({ z: cz, w: 9, s: 0.55 });
  }

  // Aon-like: sheer pale shaft with the flat white crown, tall in the far
  // row where the haze lifts it.
  {
    const phi = -0.17;
    const R = 235;
    const px = -Math.cos(phi) * R;
    const pz = Math.sin(phi) * R;
    towerTo(winParts, rng, 9.5, 47, 9.5, px, SHORE_Y, pz, 0x8b8088, variantAt(7), phi, 0.04);
    boxTo(arch, rng, 10.3, 1.9, 10.3, px, SHORE_Y + 47 + 0.95, pz, 0xded6c6, 0.03, phi);
    bulbTo(glow, rng, px, SHORE_Y + 49.4, pz, 0xff2a1e, 0.34);
    refl.push({ z: pz, w: 9.5, s: 0.7 });
  }

  // Crain-like: modest shaft with the sloped diamond top glinting at the sky.
  {
    const phi = 0.2;
    const R = 198;
    const px = -Math.cos(phi) * R;
    const pz = Math.sin(phi) * R;
    const cw = 11; // facade width (and the wedge ridge length)
    const cd = 8;
    const ch = 24;
    towerTo(winParts, rng, cd, ch, cw, px, SHORE_Y, pz, 0x2c3140, variantAt(1), phi, 0.05);
    const r = cd / 1.732; // triangular prism sized so its base spans the depth
    const k = 5.5 / (1.5 * r); // slope height 5.5 over the prism's natural 1.5r
    const wedge = new THREE.CylinderGeometry(r, r, cw, 3, 1);
    wedge.rotateX(Math.PI / 2); // axis onto z (the ridge runs across the facade)
    wedge.rotateZ(Math.PI / 2); // apex up, flat bottom
    wedge.scale(1, k, 1);
    wedge.rotateY(phi);
    wedge.translate(px, SHORE_Y + ch + 0.5 * r * k, pz);
    tintGeom(wedge, 0x565d78, 0.05, rng);
    arch.push(wedge);
    refl.push({ z: pz, w: cw, s: 0.5 });
  }

  // 5c. the reflection streaks, painted FROM the tower positions above.
  const reflTex = makeCanvasTexture(256, 512, (ctx, rw, rh) => paintReflections(ctx, rw, rh, refl, rng));

  const archGeo = mergeAll(arch);
  const glowGeo = mergeAll(glow);
  const windowGeo = mergeAll(winParts);

  /* -- 6. pad, water, sun path, dome, gulls ------------------------------- */
  const padGeo = new THREE.CircleGeometry(PAD_RADIUS, 48);
  padGeo.rotateX(-Math.PI / 2);

  const waterGeo = new THREE.CircleGeometry(WATER_RADIUS, 64);
  waterGeo.rotateX(-Math.PI / 2);

  const streakGeo = new THREE.PlaneGeometry(16, 170);
  streakGeo.rotateX(-Math.PI / 2); // flat on the water, long axis on Z…
  streakGeo.rotateY(Math.atan2(SUN_AZ_X, SUN_AZ_Z)); // …swung onto the sun azimuth

  const domeGeo = new THREE.SphereGeometry(DOME_RADIUS, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.58);

  // Horizon haze ring (open cylinder, seen from inside) + the reflection
  // plane lying just above the water: u runs toward the camera on it.
  const hazeGeo = new THREE.CylinderGeometry(HAZE_R, HAZE_R, HAZE_H, 48, 1, true);
  const reflGeo = new THREE.PlaneGeometry(REFL_W, REFL_SPAN);
  reflGeo.rotateX(-Math.PI / 2); // flat on the water: u → +x, v → -z

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
  // The skyline: dark albedo from the per-tower vertex tints, lit window
  // grids from the shared emissive atlas — windows glow against the dusk.
  const windowMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    emissive: 0xffc9a0,
    emissiveMap: atlasTex,
    emissiveIntensity: 1.5,
    transparent: true,
    opacity: 0,
  });
  const hazeMat = new THREE.MeshBasicMaterial({
    map: hazeTex,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
    toneMapped: false,
  });
  const reflMat = new THREE.MeshBasicMaterial({
    map: reflTex,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
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

  // Fireworks: separate seeded stream, built after every draw from the site
  // rng above so the pier's fixed seed order is untouched. Its texture,
  // geometry and material join the shared precompile/dispose lists; its fade
  // rides the uK uniform (a ShaderMaterial has no meaningful .opacity for the
  // fade list to drive).
  const fw = buildFireworks();

  const textures: THREE.Texture[] = [deckTex, padTex, waterTex, sunTex, streakTex, atlasTex, hazeTex, reflTex, fw.tex];
  const geometries: THREE.BufferGeometry[] = [
    deckGeo,
    padGeo,
    archGeo,
    glowGeo,
    windowGeo,
    hazeGeo,
    reflGeo,
    glassGeo,
    spinGeo,
    cabinGeo,
    waterGeo,
    streakGeo,
    domeGeo,
    gullGeo,
    fw.geo,
  ];
  const materials: THREE.Material[] = [
    deckMat,
    padMat,
    archMat,
    glowMat,
    windowMat,
    hazeMat,
    reflMat,
    glassMat,
    steelMat,
    cabinMat,
    waterMat,
    streakMat,
    sunMat,
    gullMat,
    domeMat,
    fw.mat,
  ];

  // The per-frame fade list: master k times each material's resting opacity.
  const fade: { m: THREE.Material; mul: number }[] = [
    { m: deckMat, mul: 1 },
    { m: padMat, mul: 1 },
    { m: archMat, mul: 1 },
    { m: glowMat, mul: 1 },
    { m: windowMat, mul: 1 },
    { m: steelMat, mul: 1 },
    { m: cabinMat, mul: 1 },
    { m: waterMat, mul: 1 },
    { m: glassMat, mul: 0.3 }, // glass rests translucent
    { m: hazeMat, mul: HAZE_OPACITY }, // additive: opacity IS the strength
    { m: reflMat, mul: REFL_OPACITY },
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
    windowGeo,
    hazeGeo,
    reflGeo,
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
    windowMat,
    hazeMat,
    reflMat,
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
    fw,
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
  // including when the preference flips mid-spin — and clears the fireworks
  // outright: the docked finale stays a still.
  useEffect(() => {
    if (!reduced) return;
    if (spinnerRef.current) spinnerRef.current.rotation.z = 0;
    const cab = cabinsRef.current;
    if (cab) poseCabins(cab, 0);
    if (gullsRef.current) gullsRef.current.rotation.y = 0;
    fwKill(assets.fw);
  }, [reduced, assets]);

  // The ramp is STATE (flight position along the homecoming leg) times a
  // camera-distance gate, so it runs every rung — reduced motion included.
  // Only the wheel/gull/shimmer motion below is gated.
  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const n = waypoints.length;
    const ramp = legInto(n, n - 1, t.get());

    // Fireworks latch — BEFORE the visibility gate so flying away (ramp
    // collapsing below FW_DISARM_AT, which is also where the group hides)
    // resets it, and a return to the pad re-celebrates. Reduced motion never
    // arms: the whole system stays cold.
    const fw = assets.fw;
    if (!reduced) {
      if (!fw.armed && ramp >= FW_ARM_AT) fwArm(fw, state.clock.elapsedTime);
      else if (fw.armed && ramp < FW_DISARM_AT) fwKill(fw);
    }

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
      // The celebration: launches while docked, integration while anything
      // is alive, brightness times the master k so it dies with the site.
      fwUpdate(fw, e, k, ramp >= FW_ARM_AT);
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

        {/* 3. All opaque architecture: ONE merged vertex-colored draw
            (caisson, pilings, railings, lamp posts, wheel base+struts,
            Crystal Gardens plinth+ribs, sheds, Head House, shore, tower
            antennas/penthouses, Marina drums, the Crain wedge). */}
        <mesh geometry={assets.archGeo} material={assets.archMat} />

        {/* 4. Every light that is ON: pier lamps, wheel hub, Crystal Gardens
            interior, red aircraft-warning beacons. ONE merged draw. */}
        <mesh geometry={assets.glowGeo} material={assets.glowMat} />

        {/* 4b. The Chicago skyline: every facade in ONE merged mesh — dark
            vertex-tinted albedo, lit window grids sampled from the shared
            1024² emissive atlas, near/far depth rows, signature silhouettes. */}
        <mesh geometry={assets.windowGeo} material={assets.windowMat} />

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

        {/* 8b. Skyline reflection: smeared warm columns on the water, painted
            from the same seeded tower positions as the skyline itself. */}
        <mesh
          geometry={assets.reflGeo}
          material={assets.reflMat}
          position={[REFL_X, WATER_Y + 0.1, 0]}
          renderOrder={2}
        />

        {/* 9. Sunset sky dome: drawn after the depth-writing pier/skyline so
            the architecture silhouettes against it. */}
        <mesh geometry={assets.domeGeo} material={assets.domeMat} renderOrder={1} />

        {/* 9b. Horizon haze: a soft additive ring where the skyline meets the
            water, warmest toward the sun — cheap aerial perspective. Drawn
            after the dome (renderOrder 2) so it adds over the sky; the
            depth-written pier and towers clip it where they stand in front. */}
        <mesh geometry={assets.hazeGeo} material={assets.hazeMat} position={[0, HAZE_Y, 0]} renderOrder={2} />

        {/* 10. The sun: one big additive glow just above the horizon. */}
        <sprite
          position={[SUN_AZ_X * 385, 17, SUN_AZ_Z * 385]}
          scale={[SUN_SPRITE_SCALE, SUN_SPRITE_SCALE, 1]}
          renderOrder={2}
        >
          <primitive object={assets.sunMat} attach="material" />
        </sprite>

        {/* 10b. Fireworks over the water beside the skyline (adapted from the
            user's RR js/world/fireworks.js): ONE additive Points pool, armed
            at touchdown — salvo of three, then a shell every 7–9 s while
            docked. Draw range is 0 until armed, so the extra draw call only
            exists during the show; always mounted so the precompile pass
            covers its shader. Reduced motion never arms it. */}
        <points
          geometry={assets.fw.geo}
          material={assets.fw.mat}
          frustumCulled={false}
          renderOrder={3}
        />

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
