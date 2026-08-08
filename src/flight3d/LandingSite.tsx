/* ==== LANDING SITE: NAVY PIER AT NIGHT ======================================
 *
 * The finale's ground truth. The voyage now ends where the author's own
 * River Racer game lives: the tip of Navy Pier after dark. The ship sets
 * down on a pier-end pad; the wooden deck runs back toward shore past the
 * Centennial Wheel, the Crystal Gardens glass vault and the 1916 Head House;
 * the Chicago skyline stands against a deep night sky over a calm Lake
 * Michigan, windows lit and the city's amber glow banked low on the horizon,
 * the moon silvering the lake. The pier shapes, the vertex-color "tintGeom"
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
 * beyond x=-175, the city glow banks low toward (-1, 0, -0.5), and the moon
 * hangs opposite, over the lake.
 *
 * Everything is procedural and seeded (mulberry32(0xC0FFEE), one rng, fixed
 * order), merged RR-style into 15 draw calls — the ENTIRE city (four depth
 * rows, ~84 fill towers, five signature masses, shoreline, piers, street
 * lights, beacons, billboards) lives in exactly TWO of them: the site-wide
 * opaque `archGeo` batch and the emissive `windowGeo` batch. The opacity ramp is STATE (it
 * tracks the flight position) times a camera-distance gate, so it runs under
 * reduced motion; the continuous animations — wheel spin, gull circling,
 * moon-path shimmer — are gated off and parked when `reduced` is true.
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
// Compressed from (0.70 + 0.22 / 0.80 + 0.16) after profiling the descent:
// while the site fades IN, every one of its surfaces is on the transparent
// path AND the whole solar system is still drawing behind it — the most
// expensive window in the entire experience. Reaching full opacity sooner
// shortens that overlap and lets Scene3D's deep-space cull fire earlier.
// The camera-distance gate (kCam), not this ramp, is what keeps the pier
// from ever being visible from orbit, so pulling these in is safe.
const VISIBLE_AT = 0.6;
const FADE_START = 0.62;
const FADE_SPAN = 0.16; // opaque by ramp 0.78
const DOME_START = 0.68; // the sky completes last: most readable "from outside"
const DOME_SPAN = 0.14; // opaque by ramp 0.82
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

// Skyline: seeded Chicago silhouettes on the shore arc beyond the pier root.
// FOUR depth rows — a continuous mid-rise waterfront wall, two rows carrying
// the bulk of the towers, and a tallest/haziest back row — plus five signature
// masses adapted from the user's river-racer landmarks (Willis / Hancock /
// Marina City / Aon / Crain analogues), which are lifted above the fill so
// they still read. Window grids come from ONE shared 1024² emissive atlas
// (16 variants); the whole city is ONE merged mesh plus its share of the
// site-wide opaque batch.
const SHORE_Y = -3.2; // tower bases sink just under the land surface

/** One depth row of the skyline. `fill > 0` makes each facade at least the
 *  slot chord wide, so the row closes into a continuous wall with no gaps to
 *  empty sky at its base; otherwise widths come from wMin/wSpan. */
type SkyRow = {
  count: number;
  rMin: number;
  rSpan: number;
  arc: number; // angular spread, radians
  jit: number; // slot jitter as a fraction of the angular step
  hMin: number;
  hSpan: number;
  hPow: number; // >1 biases toward hMin — a few giants, many mid-rises
  fill: number; // >0: width = slot chord × (fill + rng·wSpan)
  wMin: number;
  wSpan: number;
  dMin: number; // depth toward the camera
  dSpan: number;
  setback: number; // chance of a stacked setback tier
  yaw: number; // max off-grid rotation, radians
  pal: readonly number[];
  vBase: number; // first window-atlas variant this row draws from
  vSpan: number;
  refl: number; // water-reflection strength (0 = too far to reflect)
};

const SKY_ROWS: readonly SkyRow[] = [
  // 0 — the waterfront wall: continuous mid-rise, varied footprints/setbacks.
  {
    count: 28, rMin: 176, rSpan: 9, arc: 2.42, jit: 0.06,
    hMin: 8, hSpan: 14, hPow: 1.1,
    fill: 1.15, wMin: 0, wSpan: 0.5, dMin: 8, dSpan: 11,
    setback: 0.34, yaw: 0.1,
    pal: [0x1e2530, 0x222a35, 0x1a212b, 0x252d39], vBase: 0, vSpan: 8, refl: 0.85,
  },
  // 1 — first tower row.
  {
    count: 24, rMin: 192, rSpan: 15, arc: 2.5, jit: 0.3,
    hMin: 17, hSpan: 23, hPow: 1.25,
    fill: 0, wMin: 8, wSpan: 13, dMin: 8, dSpan: 11,
    setback: 0.5, yaw: 0.13,
    pal: [0x232b37, 0x27303d, 0x1f2732, 0x2a3340], vBase: 0, vSpan: 8, refl: 0.6,
  },
  // 2 — the bulk of the skyline.
  {
    count: 19, rMin: 216, rSpan: 20, arc: 2.6, jit: 0.32,
    hMin: 22, hSpan: 28, hPow: 1.3,
    fill: 0, wMin: 9, wSpan: 14, dMin: 9, dSpan: 12,
    setback: 0.55, yaw: 0.14,
    pal: [0x2b3242, 0x30374a, 0x282f3e, 0x333b4e], vBase: 4, vSpan: 8, refl: 0.34,
  },
  // 3 — back row: tallest and hazier, sampling the atlas' dimmest band.
  {
    count: 13, rMin: 248, rSpan: 34, arc: 2.72, jit: 0.34,
    hMin: 26, hSpan: 26, hPow: 1.2,
    fill: 0, wMin: 9, wSpan: 13, dMin: 9, dSpan: 12,
    setback: 0.45, yaw: 0.15,
    pal: [0x363c50, 0x3c4258, 0x333950, 0x414863], vBase: 8, vSpan: 8, refl: 0,
  },
];

// Shoreline: a continuous low embankment mass so the city sits on LAND and
// never floats over the lake — faceted chord segments along the arc (a box
// per facet keeps every face front-facing in the single opaque batch), a
// slightly lighter quay lip that catches the city light, and a handful of
// piers/breakwaters poking into the water.
const SHORE_R = 172; // waterline radius
const SHORE_TOP = -1.2; // land surface (the lake plane is at WATER_Y = -3.5)
const SHORE_DEPTH = 155; // land runs back from SHORE_R under every row
const SHORE_ARC = 2.98; // wider than any tower row
const SHORE_SEGS = 30;
const SHORE_LAMPS = 58; // tiny street-level lights strung along the waterfront
const SHORE_PIERS = 4;
const SHORE_BREAKS = 3;

// Horizon haze: a THIN additive band where the towers meet the water — not a
// tall cylinder (a 26-unit skirt was pure overdraw across the whole horizon).
const HAZE_R = 170;
const HAZE_H = 14;
const HAZE_Y = 2;
const HAZE_SEGS = 32;
const HAZE_OPACITY = 0.5;
const HAZE_CITY_U = 0.676; // cylinder-u of the city azimuth: glow warmest there

// Skyline water reflection: one additive plane of smeared warm columns,
// painted FROM the seeded tower z-positions so light lands under towers.
// Sized to the water it actually covers — at x = REFL_X the night lake is
// only ±sqrt(WATER_RADIUS² - REFL_X²) ≈ ±220 wide, and the plane must not
// spill additive pixels past the disc it is supposed to be lying on.
const REFL_X = -138; // plane centre along the camera axis
const REFL_W = 70; // extent toward the camera (the smear direction)
const REFL_SPAN = 340; // extent across the skyline
const REFL_OPACITY = 0.34; // night: the lit skyline owns more of the water

// Water: calm night lake, rim alpha baked so it dissolves into haze.
const WATER_Y = -3.5;
const WATER_RADIUS = 260;

// Night azimuths: the CITY (residual skyglow) sits toward (-tHat + 0.5·bHat)
// → pier space (-1, 0, -0.5); the MOON hangs on the opposite azimuth, high
// over the lake, and owns the water streak.
const CITY_AZ_X = -0.8944;
const CITY_AZ_Z = -0.4472;
const MOON_AZ_X = 0.8944;
const MOON_AZ_Z = 0.4472;
const DOME_RADIUS = 420;
// The dome is a BAND, not a cap: its alpha is already 0 above h ≈ 0.72, so
// everything from the zenith down to theta 0.21π rasterized fully transparent
// pixels every frame. Starting the sphere segment below that line deletes the
// whole cap from the fill budget and still lets the real starfield through.
const DOME_THETA_START = Math.PI * 0.21;
const DOME_THETA_LEN = Math.PI * 0.37;
// The moon is drawn BY the dome shader (a disc + tight halo on uMoonDir)
// rather than by its own additive sprite: one fewer draw call, one fewer
// material/program, one fewer canvas texture, identical fade schedule.
const MOON_ALT_Y = 150; // high over the lake
const MOON_R = 385; // ground-plane radius of the moon's azimuth
const STREAK_OPACITY = 0.5; // moon path: subtler than the old sun path

// Gulls: three silhouettes on a slow circle over the water.
const GULL_X = -40;
const GULL_Y = 8.5;
const GULL_Z = -30;
const GULL_SPEED = 0.07;

// Site lights, ramped by the master fade k: cool low moonlight FROM the moon
// azimuth so the ship at the pad reads rim-lit in silver, a deep night
// hemisphere fill, and ONE warm amber point light hung low over the city so
// the skyline base catches the glow (decay 0: the classic stylized falloff —
// physical decay would kill a 0.9 light across tens of units).
const MOON_COLOR = '#9fb4d8';
const MOON_INTENSITY = 0.5;
const MOON_LIGHT_POS: [number, number, number] = [MOON_AZ_X * 150, 24, MOON_AZ_Z * 150];
const HEMI_SKY = '#1a2434';
const HEMI_GROUND = '#241d18';
const HEMI_INTENSITY = 0.55;
const CITY_LIGHT_COLOR = '#ffb46a';
const CITY_LIGHT_INTENSITY = 0.9;
const CITY_LIGHT_DIST = 240;
const CITY_LIGHT_POS: [number, number, number] = [CITY_AZ_X * 190, 6, CITY_AZ_Z * 190];
// Pier-lamp bulbs get a 1.5x color boost over the base palette so the deck
// reads lamp-lit against the darker night (the glow material is unclamped:
// toneMapped false + vertex colors > 1).
const LAMP_BOOST = 1.5;

// Fireworks (adapted from the user's river-racer js/world/fireworks.js —
// "fireworks over Navy Pier at night"): ONE additive Points pool, armed when
// the ship first touches down (ramp >= FW_ARM_AT), re-armed after flying away
// and returning (latch resets below FW_DISARM_AT). Launch points sit on the
// water beside the skyline, clear of the deck. Everything is seeded — shells
// and spark directions come from mulberry32 tables built once; the useFrame
// choreography reads state.clock.elapsedTime epochs only.
const FW_MAX = 600; // pool size: rockets + trails + bursts share it
const FW_LIVE_CAP = 380; // hard ceiling on simultaneously live particles
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
const FW_BIRTH_BRIGHT = 3.6; // >1 at birth so bloom catches the burst (night pop)
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

/* ---- night sky dome shader (structure adapted from RR js/world/sky.js) --- */

const DOME_VERT = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Height-blended night: a low horizon band of residual city-glow amber with
// a whisper of late-dusk teal, lifting through deep navy to near-black by
// ~55% height, with a subtle BROAD skyglow lobe centred on the city azimuth
// (uCityDir) and the same thin baked cloud strips darkened to near-silhouette
// with faint underlit amber edges cityward. Alpha fades out toward the zenith
// so the real starfield shows; uOpacity is the sky's master fade.
const DOME_FRAG = /* glsl */ `
  uniform float uOpacity;
  uniform vec3 uCityDir;
  uniform vec3 uMoonDir;
  varying vec3 vPos;
  void main() {
    vec3 D = normalize(vPos);
    float h = clamp(D.y, 0.0, 1.0);
    vec3 glow = vec3(0.165, 0.122, 0.078); /* #2a1f14 residual city-glow amber */
    vec3 teal = vec3(0.063, 0.133, 0.180); /* #10222e late-dusk teal */
    vec3 mid  = vec3(0.039, 0.071, 0.125); /* #0a1220 */
    vec3 zen  = vec3(0.020, 0.031, 0.059); /* #05080f near-black navy */
    vec3 col = mix(glow, teal, smoothstep(0.0, 0.10, h) * 0.5); /* teal whisper over the amber */
    col = mix(col, mid, smoothstep(0.05, 0.28, h));
    col = mix(col, zen, smoothstep(0.24, 0.55, h));
    /* subtle broad skyglow lobe over the city azimuth, low intensity */
    float azl = max(length(D.xz), 1e-4);
    float sc = max(dot(D.xz / azl, normalize(uCityDir.xz)), 0.0);
    float lobe = pow(sc, 2.0) * (1.0 - smoothstep(0.0, 0.30, h));
    col += vec3(0.42, 0.27, 0.12) * lobe * 0.30;
    /* thin cloud strips: near-silhouette, faint underlit amber edge cityward */
    float ang = atan(D.z, D.x);
    float amp = 0.35 + 0.65 * sc * sc;
    float s1 = 1.0 - smoothstep(0.004, 0.012, abs(h - 0.075 - 0.014 * sin(ang * 2.0 + 1.7)));
    float s2 = 1.0 - smoothstep(0.003, 0.010, abs(h - 0.120 - 0.011 * sin(ang * 3.1 + 0.4)));
    float s3 = 1.0 - smoothstep(0.003, 0.009, abs(h - 0.175 - 0.016 * sin(ang * 2.4 + 2.6)));
    float strips = min(1.0, s1 * 0.55 + s2 * 0.45 + s3 * 0.35) * amp;
    col = mix(col, vec3(0.012, 0.016, 0.026), strips * 0.7);
    col += vec3(0.35, 0.22, 0.10) * strips * sc * 0.12;
    /* the moon itself: small cool disc + a tight halo, on the azimuth
       opposite the city. Chord length (not dot) keeps the precision sane at
       these angular radii — a dot-product test near 1.0 has ~6e-8 of float
       headroom and bands badly. Rides the dome's alpha, so it fades on the
       same kd schedule the sprite used to. */
    float md = length(D - uMoonDir);
    float disc = 1.0 - smoothstep(0.009, 0.014, md);
    float halo = exp(-md * 52.0);
    col += vec3(0.94, 0.962, 1.0) * (disc * 0.90 + halo * 0.26);
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
 *  warm wash (the pier lamps own the deck's color at night). Tiled ~5x along
 *  the deck so planks read ~6 units long. */
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

/** Calm night lake: near-black navy base, soft elongated swell mottling,
 *  darkening toward the rim, and the outer 22% alpha-faded so the disc
 *  dissolves into horizon haze instead of ending in an edge. */
function paintWater(ctx: CanvasRenderingContext2D, w: number, h: number, rng: () => number): void {
  ctx.fillStyle = '#0a1622';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 130; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const long = 30 + rng() * 130; // elongated across the camera's view
    const short = 4 + rng() * 12;
    ctx.fillStyle = rng() < 0.5 ? 'rgba(5,12,20,0.18)' : 'rgba(24,50,72,0.12)';
    ctx.beginPath();
    ctx.ellipse(x, y, short, long, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const c = w / 2;
  const ring = ctx.createRadialGradient(c, c, 0, c, c, c);
  ring.addColorStop(0.6, 'rgba(4,10,18,0)');
  ring.addColorStop(1, 'rgba(4,10,18,0.5)');
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

/** Elongated cool silver blob (long axis = canvas y) for the moon's specular
 *  path lying flat on the water, pointed at the moon azimuth — narrower and
 *  subtler than the old sun path. */
function paintStreak(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(0.4, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, h / 2);
  g.addColorStop(0, 'rgba(223,232,245,0.42)');
  g.addColorStop(0.5, 'rgba(186,202,226,0.16)');
  g.addColorStop(1, 'rgba(186,202,226,0)');
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

// One 1024² canvas repacked from 4×2 cells into 8×2 — SIXTEEN facade-grid
// variants for the same pixel budget. The variants are ordered by MOOD, not
// just by pitch: index 0 is ablaze, index 7 is nearly dark, indices 8–15 are
// the same ladder dimmed for the hazy back row. Every building rolls its own
// variant, so some towers burn and some are black — a uniform sprinkle across
// every facade is exactly what reads as fake. ~90 buildings share ONE texture.
//
// The atlas' unused TOP margin (never sampled by a facade — floor offsets are
// bounded by the cell's slack) carries four solid utility swatches. Beacons,
// street lights and billboards are quads whose four UVs collapse onto ONE
// texel centre: a constant UV means zero derivatives, hence LOD 0, hence the
// exact swatch colour with no mip bleed — the same trick the roof faces use.
const ATLAS_PX = 1024;
const CELL_W = 128;
const CELL_H = 512;
const CELL_MARGIN = 8;
const ATLAS_PPX = 4.2; // atlas px per world unit across a facade (bay ≈ 2.4–3.6u)
const ATLAS_PPY = 6.2; // atlas px per world unit up a facade (floor ≈ 1.9–2.7u)

// Utility swatch texel centres (top margin, x well clear of the black roof
// texel at (3,3)). Values are the UV pairs the emissive quads collapse onto.
const SW_Y = 4;
const SW_RED = 200; // aircraft-warning beacon
const SW_WARM = 214; // street-level / pier lamp
const SW_CYAN = 228; // billboard
const SW_MAG = 242; // billboard
function swUV(px: number): [number, number] {
  return [(px + 0.5) / ATLAS_PX, 1 - (SW_Y + 0.5) / ATLAS_PX];
}

type AtlasVariant = {
  col: number;
  row: number;
  bayPx: number;
  floorPx: number;
  density: number;
  dim: number;
  cool: number; // fraction of panes on fluorescent white-green instead of amber
  core: number; // chance of an always-lit stairwell/lift column
};

const ATLAS_VARIANTS: readonly AtlasVariant[] = [
  // 0–7: the near/mid ladder, ablaze → nearly dark.
  { col: 0, row: 0, bayPx: 12, floorPx: 14, density: 0.74, dim: 1.15, cool: 0.1, core: 0.5 },
  { col: 1, row: 0, bayPx: 15, floorPx: 17, density: 0.63, dim: 1.05, cool: 0.3, core: 0.4 },
  { col: 2, row: 0, bayPx: 11, floorPx: 12, density: 0.55, dim: 1.0, cool: 0.08, core: 0.5 },
  { col: 3, row: 0, bayPx: 17, floorPx: 19, density: 0.47, dim: 0.95, cool: 0.22, core: 0.35 },
  { col: 4, row: 0, bayPx: 13, floorPx: 15, density: 0.39, dim: 0.9, cool: 0.14, core: 0.55 },
  { col: 5, row: 0, bayPx: 12, floorPx: 13, density: 0.31, dim: 0.85, cool: 0.35, core: 0.45 },
  { col: 6, row: 0, bayPx: 16, floorPx: 18, density: 0.23, dim: 0.8, cool: 0.1, core: 0.6 },
  { col: 7, row: 0, bayPx: 11, floorPx: 14, density: 0.15, dim: 0.7, cool: 0.2, core: 0.65 },
  // 8–15: the same ladder pulled back for the hazy far rows.
  { col: 0, row: 1, bayPx: 12, floorPx: 14, density: 0.56, dim: 0.6, cool: 0.12, core: 0.3 },
  { col: 1, row: 1, bayPx: 15, floorPx: 17, density: 0.47, dim: 0.56, cool: 0.28, core: 0.25 },
  { col: 2, row: 1, bayPx: 11, floorPx: 12, density: 0.39, dim: 0.52, cool: 0.1, core: 0.3 },
  { col: 3, row: 1, bayPx: 17, floorPx: 19, density: 0.31, dim: 0.5, cool: 0.2, core: 0.2 },
  { col: 4, row: 1, bayPx: 13, floorPx: 15, density: 0.25, dim: 0.46, cool: 0.15, core: 0.35 },
  { col: 5, row: 1, bayPx: 12, floorPx: 13, density: 0.19, dim: 0.42, cool: 0.3, core: 0.3 },
  { col: 6, row: 1, bayPx: 16, floorPx: 18, density: 0.13, dim: 0.4, cool: 0.1, core: 0.4 },
  { col: 7, row: 1, bayPx: 11, floorPx: 14, density: 0.09, dim: 0.35, cool: 0.18, core: 0.4 },
];

function variantAt(i: number): AtlasVariant {
  return (
    ATLAS_VARIANTS[i] ??
    { col: 0, row: 0, bayPx: 12, floorPx: 14, density: 0.5, dim: 1, cool: 0.15, core: 0.4 }
  );
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
  const warm = ['#ffd7a2', '#ffc07a', '#ffe9c4', '#ffb968'] as const;
  const cool = ['#e2f0e6', '#cfe2f2'] as const;
  for (const v of ATLAS_VARIANTS) {
    const x0 = v.col * CELL_W;
    const y0 = v.row * CELL_H;
    const cols = Math.floor((CELL_W - 2 * CELL_MARGIN) / v.bayPx);
    const rows = Math.floor((CELL_H - 2 * CELL_MARGIN) / v.floorPx);
    // A stairwell / lift core: one bay lit on nearly every floor. Real towers
    // have exactly this vertical thread and it is what stops a sparse tower
    // from reading as random noise.
    const coreCol = rng() < v.core ? Math.floor(rng() * cols) : -1;
    for (let r = 0; r < rows; r++) {
      const darkFloor = rng() < 0.12; // a whole dark floor (fewer at night)
      const height = 1 - r / rows; // 1 at the cell top (upper floors)
      // Night: slightly more of the grid lit — the skyline carries the scene.
      const density = Math.min(0.9, v.density * 1.12 * (0.62 + 0.38 * (1 - height)));
      let run = 0;
      let on = false;
      for (let c = 0; c < cols; c++) {
        if (run <= 0) {
          on = rng() < density;
          run = 1 + Math.floor(rng() * (on ? 3 : 4)); // lit clusters / dark gaps
        }
        run--;
        const isCore = c === coreCol && rng() < 0.88;
        if ((!on || darkFloor) && !isCore) continue;
        const pal = rng() < v.cool ? cool : warm;
        const hex = pal[Math.floor(rng() * pal.length)] ?? '#ffc07a';
        // 1.3x lit-cell brightness against the darker night sky (dimHex clamps);
        // the core thread runs dimmer, like the corridor light it is.
        const k = (0.66 + rng() * 0.38) * 1.3 * v.dim * (isCore && !on ? 0.55 : 1);
        ctx.fillStyle = dimHex(hex, k);
        ctx.fillRect(
          x0 + CELL_MARGIN + c * v.bayPx + 2,
          y0 + CELL_MARGIN + r * v.floorPx + 2,
          v.bayPx - 4,
          v.floorPx - 5,
        );
      }
    }
  }
  // Utility swatches in the never-sampled top margin: sampled by degenerate
  // (single-texel) UVs, so mip level is always 0 and the colour is exact.
  const sw: readonly (readonly [number, string])[] = [
    [SW_RED, '#ff3020'],
    [SW_WARM, '#ffd9a0'],
    [SW_CYAN, '#7df9ff'],
    [SW_MAG, '#ff86c4'],
  ];
  for (const [px, hex] of sw) {
    ctx.fillStyle = hex;
    ctx.fillRect(px - 4, SW_Y - 3, 10, 7);
  }
}

/** Horizon haze band for the haze ring: vertical amber city-glow gradient
 *  (bottom of the canvas = bottom of the cylinder), alpha-shaped around the
 *  ring so the glow peaks on the city azimuth. Seam-safe: the horizontal
 *  factor depends on wrapped distance from HAZE_CITY_U only. */
function paintHaze(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, 'rgba(255,170,100,0.4)');
  g.addColorStop(0.42, 'rgba(150,102,74,0.18)');
  g.addColorStop(0.78, 'rgba(52,66,88,0.07)');
  g.addColorStop(1, 'rgba(52,66,88,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const m = ctx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    let dU = Math.abs(u - HAZE_CITY_U);
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
    if (Math.abs(e.z) > REFL_SPAN * 0.48) continue; // off the water disc
    const y = (0.5 + e.z / REFL_SPAN) * h;
    const half = Math.max(2, (e.w * 0.55 * h) / REFL_SPAN);
    const len = w * (0.3 + 0.55 * Math.min(1, e.s));
    // Three times as many towers now feed this pass, so each streak carries
    // proportionally less alpha — otherwise the whole strip blows out white.
    const a = 0.14 + 0.3 * Math.min(1, e.s);
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

/** A camera-facing emissive quad for the window batch: street-level lights,
 *  aircraft-warning beacons and rooftop billboards. All four UVs collapse onto
 *  ONE atlas texel, so the fragment derivatives are zero, the mip level is 0
 *  and the swatch colour arrives exact however small the quad gets on screen.
 *  Albedo is near-black — the emissive map is the whole point. `rotY` is the
 *  tower yaw: PlaneGeometry's +Z normal turns to face the pier origin at
 *  rotY + π/2, matching the box convention where rotateY(phi) aims +X home. */
function emitQuadTo(
  list: THREE.BufferGeometry[],
  rng: () => number,
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  rotY: number,
  uv: readonly [number, number],
): void {
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, uv[0], uv[1]);
  a.needsUpdate = true;
  g.rotateY(rotY + Math.PI / 2);
  g.translate(x, y, z);
  tintGeom(g, 0x05070a, 0, rng);
  list.push(g);
}

/** Emissive bulb. `boost` scales the tinted vertex colors AFTER tintGeom (no
 *  extra rng draws — the seeded order is untouched); the glow material is
 *  toneMapped:false so values > 1 read as hotter, not clipped hue-shifts. */
function bulbTo(
  list: THREE.BufferGeometry[],
  rng: () => number,
  x: number,
  y: number,
  z: number,
  hex: number,
  r: number,
  boost = 1,
): void {
  const g = new THREE.SphereGeometry(r, 8, 6);
  g.translate(x, y, z);
  tintGeom(g, hex, 0.1, rng);
  if (boost !== 1) {
    const col = g.getAttribute('color');
    const arr = col.array as Float32Array;
    for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] ?? 0) * boost;
  }
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
  aliveEst: number; // running live count, so bursts can be budget-capped
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
    aliveEst: 0,
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
    if (p.age >= p.life) fw.aliveEst++; // reviving a dead slot adds one live
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
  // Hard live-particle ceiling: overlapping salvos used to be able to push the
  // pool to its full 600 at once, which is 600 additive full-screen-ish point
  // sprites in a single blended pass. A clipped burst is invisible; the frame
  // spike is not.
  const budget = FW_LIVE_CAP - fw.aliveEst;
  const n = sh.count < budget ? sh.count : budget;
  for (let j = 0; j < n; j++) {
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
  // The draw range is NOT opened to the whole pool here — fwUpdate sets it to
  // the live high-water mark every frame, so the opening salvo draws ~200
  // points, not 600.
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
  fw.aliveEst = 0;
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
  let hi = -1; // highest live pool index → the tight Points draw range
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
        hi = i;
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
        hi = i;
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
        hi = i;
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
  fw.aliveEst = alive;
  fw.geo.setDrawRange(0, hi + 1); // tight: never rasterize dead pool slots
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
  deckMat: THREE.MeshLambertMaterial;
  padMat: THREE.MeshLambertMaterial;
  archMat: THREE.MeshLambertMaterial;
  glowMat: THREE.MeshBasicMaterial;
  windowMat: THREE.MeshLambertMaterial;
  hazeMat: THREE.MeshBasicMaterial;
  reflMat: THREE.MeshBasicMaterial;
  glassMat: THREE.MeshStandardMaterial;
  steelMat: THREE.MeshStandardMaterial;
  cabinMat: THREE.MeshLambertMaterial;
  waterMat: THREE.MeshLambertMaterial;
  streakMat: THREE.MeshBasicMaterial;
  domeMat: THREE.ShaderMaterial;
  gullMat: THREE.MeshBasicMaterial;
  domeUniforms: {
    uOpacity: { value: number };
    uCityDir: { value: THREE.Vector3 };
    uMoonDir: { value: THREE.Vector3 };
  };
  fade: { m: THREE.Material; mul: number }[];
  solid: THREE.Material[];
  solidState: { opaque: boolean };
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
  // Texture budget: the atlas doubled its variant count (8 → 16) at the SAME
  // 1024², paid for by shrinking the surfaces that are seen at a glancing
  // angle or are pure soft gradients — the lake 1024² → 512² and the moon
  // path 256² → 128². Net budget DOWN ~30% (2.92 Mpx → 2.04 Mpx).
  const waterTex = makeCanvasTexture(512, 512, (ctx, w, h) => paintWater(ctx, w, h, rng));
  const streakTex = makeCanvasTexture(128, 128, paintStreak);
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

  // Warm pier lamps every ~22 units, both edges: post + emissive sphere,
  // boosted 1.5x at night so the deck reads lamp-lit.
  for (let x = 6; x > DECK_END; x -= LAMP_STEP) {
    for (const s of [-1, 1]) {
      boxTo(arch, rng, 0.15, 2.5, 0.15, x, 1.25, s * 5.25, 0x4c463e, 0.06);
      bulbTo(glow, rng, x, 2.66, s * 5.25, 0xffd9a0, 0.27, LAMP_BOOST);
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

  /* -- 5. shoreline + the Chicago skyline --------------------------------- */

  const winParts: THREE.BufferGeometry[] = []; // every atlas-windowed facade
  const refl: { z: number; w: number; s: number }[] = []; // reflection seeds
  const UV_RED = swUV(SW_RED);
  const UV_WARM = swUV(SW_WARM);
  const BILLBOARD_UV = [swUV(SW_CYAN), swUV(SW_WARM), swUV(SW_MAG)] as const;

  // 5a. the shoreline. A continuous faceted embankment so the city stands on
  // LAND: one box per chord facet (boxes keep every face front-facing inside
  // the single opaque batch — an open cylinder would need DoubleSide and
  // double the fill), a lighter quay lip at the waterline, and piers and
  // detached breakwaters poking into the lake so the edge is not a clean arc.
  {
    const step = SHORE_ARC / SHORE_SEGS;
    const rMid = SHORE_R + SHORE_DEPTH / 2;
    for (let i = 0; i < SHORE_SEGS; i++) {
      const phi = (i + 0.5 - SHORE_SEGS / 2) * step;
      const chord = step * rMid * 1.14; // overlap: no slivers between facets
      const px = -Math.cos(phi) * rMid;
      const pz = Math.sin(phi) * rMid;
      boxTo(arch, rng, SHORE_DEPTH, 3.8, chord, px, SHORE_TOP - 1.9, pz, 0x151b23, 0.1, phi);
      // quay lip at the waterline, a shade lighter so the city point light
      // catches it and the land edge reads as built, not as a cut.
      const lx = -Math.cos(phi) * (SHORE_R + 1.1);
      const lz = Math.sin(phi) * (SHORE_R + 1.1);
      boxTo(arch, rng, 2.4, 1.1, chord * 0.99, lx, SHORE_TOP - 0.2, lz, 0x2b3444, 0.09, phi);
    }
    // piers / jetties reaching out over the water toward the pad
    for (let i = 0; i < SHORE_PIERS; i++) {
      const phi = (rng() - 0.5) * SHORE_ARC * 0.82;
      const len = 20 + rng() * 18;
      const R = SHORE_R - len / 2;
      boxTo(arch, rng, len, 1.1, 4 + rng() * 3, -Math.cos(phi) * R, -2.7, Math.sin(phi) * R, 0x1b222c, 0.1, phi);
      emitQuadTo(winParts, rng, 0.9, 0.7, -Math.cos(phi) * (R - len / 2 + 1), -1.4, Math.sin(phi) * (R - len / 2 + 1), phi, UV_WARM);
    }
    // detached breakwaters lying across the swell
    for (let i = 0; i < SHORE_BREAKS; i++) {
      const phi = (rng() - 0.5) * SHORE_ARC * 0.7;
      const R = SHORE_R - 16 - rng() * 16;
      boxTo(arch, rng, 3.4, 1.0, 34 + rng() * 26, -Math.cos(phi) * R, -2.7, Math.sin(phi) * R, 0x141a22, 0.12, phi + (rng() - 0.5) * 0.25);
    }
    // a sparse string of street-level lights along the waterfront: the base of
    // a night city is a line of little dots, and without them the towers look
    // like they are standing in a void.
    for (let i = 0; i < SHORE_LAMPS; i++) {
      if (rng() < 0.22) continue; // sparse, not a runway
      const phi = (i + 0.5 - SHORE_LAMPS / 2) * (SHORE_ARC * 0.96 / SHORE_LAMPS) + (rng() - 0.5) * 0.012;
      const R = SHORE_R - 0.4 + rng() * 2.5;
      emitQuadTo(winParts, rng, 0.75 + rng() * 0.5, 0.6, -Math.cos(phi) * R, SHORE_TOP + 0.6 + rng() * 0.5, Math.sin(phi) * R, phi, UV_WARM);
    }
  }

  // 5b. FOUR depth rows of background towers. Row 0 is a continuous mid-rise
  // waterfront wall (facade width is forced to at least the angular slot's
  // chord, so the row closes and no sky shows at the base); rows 1–2 carry the
  // bulk of the towers with stepped setbacks and a few degrees of off-grid
  // yaw; row 3 is tallest and haziest. Real skylines are layered masses, not a
  // picket fence — and the layering is also what hides the horizon behind
  // opaque depth-writing geometry instead of another transparent pass.
  let beacons = 0;
  let boards = 0;
  for (let row = 0; row < SKY_ROWS.length; row++) {
    const R0 = SKY_ROWS[row];
    if (!R0) continue;
    const step = R0.arc / R0.count;
    for (let i = 0; i < R0.count; i++) {
      const phi = (i + 0.5 - R0.count / 2) * step + (rng() - 0.5) * step * R0.jit;
      const R = R0.rMin + rng() * R0.rSpan;
      const w = R0.fill > 0 ? step * R * (R0.fill + rng() * R0.wSpan) : R0.wMin + rng() * R0.wSpan;
      const d = R0.dMin + rng() * R0.dSpan;
      const h = R0.hMin + Math.pow(rng(), R0.hPow) * R0.hSpan;
      const px = -Math.cos(phi) * R;
      const pz = Math.sin(phi) * R;
      const hex = R0.pal[i % R0.pal.length] ?? 0x232b36;
      const v = variantAt(R0.vBase + Math.floor(rng() * R0.vSpan));
      const yaw = phi + (rng() - 0.5) * R0.yaw;
      towerTo(winParts, rng, d, h, w, px, SHORE_Y, pz, hex, v, yaw, 0.13);
      let topY = SHORE_Y + h;
      let tw = w;
      let td = d;
      if (rng() < R0.setback) {
        // setbacks: stacked shrinking boxes, slightly offset off-axis
        const tiers = rng() < 0.32 ? 2 : 1;
        for (let s2 = 0; s2 < tiers; s2++) {
          tw *= 0.55 + rng() * 0.2;
          td *= 0.6 + rng() * 0.2;
          const th = h * (0.16 + rng() * 0.2);
          const o = rotXZ((rng() - 0.5) * 1.2, (rng() - 0.5) * 2.4, yaw);
          towerTo(winParts, rng, td, th, tw, px + o.x, topY, pz + o.z, hex, v, yaw, 0.1);
          topY += th;
        }
      }
      // rooflines: mechanical penthouses, bulkheads and water tanks.
      if (rng() < 0.62) {
        const ph = 1.2 + rng() * 1.8;
        const o = rotXZ((rng() - 0.5) * td * 0.3, (rng() - 0.5) * tw * 0.3, yaw);
        const mechHex = row < 2 ? 0x161c24 : 0x272d3a;
        boxTo(arch, rng, td * 0.42, ph, tw * 0.4, px + o.x, topY + ph / 2, pz + o.z, mechHex, 0.08, yaw);
      }
      if (row < 2 && rng() < 0.3) {
        const o = rotXZ((rng() - 0.5) * td * 0.4, (rng() - 0.5) * tw * 0.4, yaw);
        boxTo(arch, rng, 1.5, 1.5 + rng() * 1.1, 1.5, px + o.x, topY + 1.1, pz + o.z, 0x11161d, 0.1, yaw);
      }
      // a handful of antenna spikes with steady RED aircraft-warning beacons —
      // the beacons are emissive quads in the WINDOW batch, so the whole city
      // still costs exactly two merged meshes.
      if (beacons < 7 && h > 34 && rng() < 0.5) {
        beacons++;
        const ah = 4 + rng() * 4;
        boxTo(arch, rng, 0.22, ah, 0.22, px, topY + ah / 2, pz, 0x1e242e, 0, yaw);
        emitQuadTo(winParts, rng, 0.7, 0.7, px, topY + ah + 0.35, pz, yaw, UV_RED);
      }
      // 2–3 rooftop billboards as tiny emissive rectangles on the near rows.
      if (boards < 3 && row <= 1 && h > 15 && rng() < 0.14) {
        const bu = BILLBOARD_UV[boards] ?? UV_WARM;
        boards++;
        emitQuadTo(winParts, rng, 4.6 + rng() * 2, 2.0, px, topY + 1.5, pz, yaw, bu);
      }
      if (R0.refl > 0) refl.push({ z: pz, w, s: Math.min(1, h / 42) * R0.refl });
    }
  }

  // 5c. signature silhouettes, adapted from river-racer landmarks.js. Every
  // one is taller than the fill rows' ceiling (row 3 tops out at 52) so the
  // buildout behind them never swallows the skyline's recognisable shapes.
  // Willis-like: bundled dark tubes at staggered heights (9→7→5→2 collapsed
  // to four masses) + two white antennas of DIFFERENT lengths — the RR
  // builder's most-photographed detail — on the city (south/-z) side.
  const WILLIS_H = 68;
  {
    const phi = -0.34;
    const R = 206;
    const px = -Math.cos(phi) * R;
    const pz = Math.sin(phi) * R;
    const v = variantAt(6); // dim grid: it silhouettes against the city glow
    const hex = 0x1d222c;
    towerTo(winParts, rng, 15, 30, 17, px, SHORE_Y, pz, hex, v, phi, 0.04);
    towerTo(winParts, rng, 12, 50, 13.5, px, SHORE_Y, pz, hex, v, phi, 0.04);
    const oT = rotXZ(0, 2.0, phi);
    towerTo(winParts, rng, 9, WILLIS_H, 8.5, px + oT.x, SHORE_Y, pz + oT.z, hex, v, phi, 0.04);
    const oB = rotXZ(0, -3.1, phi);
    towerTo(winParts, rng, 9.5, 59, 7.5, px + oB.x, SHORE_Y, pz + oB.z, hex, v, phi, 0.04);
    for (const [zo, ah] of [
      [0.6, 13.5],
      [3.2, 11.4],
    ] as const) {
      const o = rotXZ(0, zo, phi);
      const g = new THREE.CylinderGeometry(0.14, 0.3, ah, 5);
      g.translate(px + o.x, SHORE_Y + WILLIS_H + ah / 2, pz + o.z);
      tintGeom(g, 0xe8eaec, 0, rng);
      arch.push(g);
      emitQuadTo(winParts, rng, 0.8, 0.8, px + o.x, SHORE_Y + WILLIS_H + ah + 0.35, pz + o.z, phi, UV_RED);
    }
    refl.push({ z: pz, w: 17, s: 0.95 });
  }

  // Hancock-like: broad-shouldered tapered obelisk (five shrinking sections,
  // as in the RR builder) with a two-antenna crown, north (+z) of the pier.
  {
    const phi = 0.52;
    const R = 238;
    const px = -Math.cos(phi) * R;
    const pz = Math.sin(phi) * R;
    const v = variantAt(10);
    const hex = 0x232733;
    const H = 60;
    const W0 = 17;
    const D0 = 12;
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
      emitQuadTo(winParts, rng, 0.75, 0.75, px + o.x, SHORE_Y + H + 9.35, pz + o.z, phi, UV_RED);
    }
    refl.push({ z: pz, w: 17, s: 0.8 });
  }

  // Marina City-like: the twin scalloped concrete cylinders right at the
  // river mouth — a ribbed drum reads as the corncob at this distance.
  {
    const phi = -0.06;
    const R = 188;
    const cx = -Math.cos(phi) * R;
    const cz = Math.sin(phi) * R;
    for (const s of [-1, 1] as const) {
      const o = rotXZ(0, s * 5.8, phi);
      const x = cx + o.x;
      const z = cz + o.z;
      const core = new THREE.CylinderGeometry(3.2, 3.2, 31, 14);
      core.translate(x, SHORE_Y + 15.5, z);
      tintGeom(core, 0x6b5f57, 0.05, rng);
      arch.push(core);
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + s;
        const rib = new THREE.CylinderGeometry(0.64, 0.64, 29.2, 5);
        rib.translate(x + Math.cos(a) * 3.1, SHORE_Y + 14.6, z + Math.sin(a) * 3.1);
        tintGeom(rib, 0x776a5f, 0.08, rng);
        arch.push(rib);
      }
      const cap = new THREE.CylinderGeometry(2.7, 3.3, 1.4, 10);
      cap.translate(x, SHORE_Y + 31.7, z);
      tintGeom(cap, 0x5a5049, 0, rng);
      arch.push(cap);
    }
    refl.push({ z: cz, w: 10, s: 0.55 });
  }

  // Aon-like: sheer pale shaft with the flat white crown, tall in the far
  // row where the haze lifts it.
  {
    const phi = -0.17;
    const R = 233;
    const px = -Math.cos(phi) * R;
    const pz = Math.sin(phi) * R;
    towerTo(winParts, rng, 10, 55, 10, px, SHORE_Y, pz, 0x8b8088, variantAt(3), phi, 0.04);
    boxTo(arch, rng, 10.8, 1.9, 10.8, px, SHORE_Y + 55.95, pz, 0xded6c6, 0.03, phi);
    emitQuadTo(winParts, rng, 0.7, 0.7, px, SHORE_Y + 57.4, pz, phi, UV_RED);
    refl.push({ z: pz, w: 10, s: 0.7 });
  }

  // Crain-like: modest shaft with the sloped diamond top glinting at the sky.
  {
    const phi = 0.2;
    const R = 196;
    const px = -Math.cos(phi) * R;
    const pz = Math.sin(phi) * R;
    const cw = 12; // facade width (and the wedge ridge length)
    const cd = 8.5;
    const ch = 30;
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

  /* -- 6. pad, water, moon path, dome, gulls ------------------------------ */
  const padGeo = new THREE.CircleGeometry(PAD_RADIUS, 48);
  padGeo.rotateX(-Math.PI / 2);

  const waterGeo = new THREE.CircleGeometry(WATER_RADIUS, 64);
  waterGeo.rotateX(-Math.PI / 2);

  const streakGeo = new THREE.PlaneGeometry(9, 170); // narrower than the old sun path
  streakGeo.rotateX(-Math.PI / 2); // flat on the water, long axis on Z…
  streakGeo.rotateY(Math.atan2(MOON_AZ_X, MOON_AZ_Z)); // …swung onto the moon azimuth

  // Sky dome: a BAND, not a cap. Everything above theta 0.21π had alpha 0 and
  // was rasterizing transparent fragments for free every frame.
  const domeGeo = new THREE.SphereGeometry(
    DOME_RADIUS, 28, 10, 0, Math.PI * 2, DOME_THETA_START, DOME_THETA_LEN,
  );

  // Horizon haze ring (open cylinder, seen from inside) + the reflection
  // plane lying just above the water: u runs toward the camera on it.
  const hazeGeo = new THREE.CylinderGeometry(HAZE_R, HAZE_R, HAZE_H, HAZE_SEGS, 1, true);
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

  /* -- materials (all fade-ramped per frame, refs cached below) -----------
   *
   * Everything that covers real screen area is MeshLambert, not MeshStandard.
   * At roughness 0.8–0.9 / metalness 0 with no env map, Standard's GGX lobe
   * and IBL path buy essentially nothing at night and cost a full PBR BRDF on
   * every one of these fragments — the lake alone is a 260-unit disc. This is
   * exactly the recipe the user's own river-racer city.js uses for its towers
   * (MeshLambertMaterial + emissive 0xffffff + emissiveMap). Only the wheel
   * steel (metalness 0.5) and the Crystal Gardens glass, both tiny on screen,
   * stay Standard. */
  const deckMat = new THREE.MeshLambertMaterial({
    map: deckTex,
    transparent: true,
    opacity: 0,
  });
  const padMat = new THREE.MeshLambertMaterial({
    map: padTex,
    transparent: true,
    opacity: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const archMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
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
  // grids from the shared emissive atlas — windows burn against the night.
  // emissive is WHITE and the warmth lives in the atlas paint (RR city.js
  // does the same), so the utility swatches can carry a saturated red beacon
  // and cyan/magenta billboards through the very same map.
  const windowMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: 0xffffff,
    emissiveMap: atlasTex,
    emissiveIntensity: 1.75,
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
  // The wheel spinner: cool steel plus a subtle steady blue emissive ring
  // tint — the Centennial Wheel's LED rim at night. No blink, no pulse.
  const steelMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.35,
    metalness: 0.5,
    emissive: 0x7db8ff,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0,
  });
  const cabinMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
  });
  // The single biggest fragment bill in the scene (a 260-unit disc filling the
  // lower half of the frame). The night lake's look lives in its texture and
  // in the additive moon path lying on top of it, not in a PBR specular lobe.
  const waterMat = new THREE.MeshLambertMaterial({
    map: waterTex,
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
  const gullMat = new THREE.MeshBasicMaterial({
    color: 0x26222b,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
  });
  const domeUniforms = {
    uOpacity: { value: 0 },
    uCityDir: { value: new THREE.Vector3(CITY_AZ_X, 0.05, CITY_AZ_Z).normalize() },
    uMoonDir: {
      value: new THREE.Vector3(MOON_AZ_X * MOON_R, MOON_ALT_Y, MOON_AZ_Z * MOON_R).normalize(),
    },
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

  const textures: THREE.Texture[] = [deckTex, padTex, waterTex, streakTex, atlasTex, hazeTex, reflTex, fw.tex];
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

  // Materials whose alpha exists ONLY to serve the fade ramp: at rest they are
  // solid. transparent:true costs the blend, forfeits early-Z and pushes them
  // into the sorted transparent pass — for the deck, the whole city and the
  // lake that is most of the frame. Once k saturates we flip them opaque (both
  // program variants are precompiled at mount, so the flip never stalls).
  const solid: THREE.Material[] = [deckMat, padMat, archMat, glowMat, windowMat, cabinMat, waterMat];
  const solidState = { opaque: false };

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
    domeMat,
    gullMat,
    domeUniforms,
    fade,
    solid,
    solidState,
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
  const moonLightRef = useRef<THREE.DirectionalLight>(null);
  const cityLightRef = useRef<THREE.PointLight>(null);

  // The moonlight's aim point: parented into the site at the pad origin, so
  // the low cool light rakes across the pad (and rim-lights the ship silver).
  const moonTarget = useMemo(() => new THREE.Object3D(), []);

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
  // use, the whole night pipeline would compile at the exact moment the
  // site becomes visible mid-descent — a multi-second stall on software
  // rendering and a visible hitch on real GPUs.
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    const wasVisible = g.visible;
    g.visible = true;
    gl.compile(g, camera);
    // …and the OPAQUE variant of every fade-only material too. three bakes
    // `transparent` into the program (#define OPAQUE), so the flip at full
    // fade would otherwise compile a second program set at the exact moment
    // the ship touches down. Warm both, then leave them transparent.
    for (const m of assets.solid) {
      m.transparent = false;
      m.needsUpdate = true;
    }
    gl.compile(g, camera);
    for (const m of assets.solid) {
      m.transparent = true;
      m.needsUpdate = true;
    }
    gl.compile(g, camera);
    assets.solidState.opaque = false;
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
    if (!visible) {
      // Hidden: make sure the fade-only materials are back on the transparent
      // path. The flip below normally reverts on the way out, but a scrubbed
      // MotionValue can jump the ramp straight past the gate in one frame —
      // and coming back opaque would pop the whole site in at full strength
      // instead of fading it up.
      const s = assets.solidState;
      if (s.opaque) {
        s.opaque = false;
        for (const m of assets.solid) {
          m.transparent = true;
          m.needsUpdate = true;
        }
      }
      return;
    }

    // Master opacity: flight ramp times how close the camera actually is —
    // the pier only exists once the descent is INSIDE its bubble.
    group.getWorldPosition(_sitePos);
    const dist = state.camera.position.distanceTo(_sitePos);
    const kCam = 1 - sstep((dist - CAM_FADE_NEAR) / CAM_FADE_SPAN);
    const k = sstep((ramp - FADE_START) / FADE_SPAN) * kCam;
    const kd = sstep((ramp - DOME_START) / DOME_SPAN) * kCam;

    for (const f of assets.fade) f.m.opacity = f.mul * k;
    assets.domeUniforms.uOpacity.value = kd;

    // Once the ramp saturates, the fade-only materials go OPAQUE: early-Z
    // comes back for the deck, the whole city and the lake, and they leave the
    // sorted transparent pass. Hysteresis (0.999 up / 0.99 down) keeps it from
    // chattering at the gate boundary; both programs are already compiled.
    const st = assets.solidState;
    const wantOpaque = st.opaque ? k >= 0.99 : k >= 0.999;
    if (wantOpaque !== st.opaque) {
      st.opaque = wantOpaque;
      for (const m of assets.solid) {
        m.transparent = !wantOpaque;
        m.needsUpdate = true;
      }
    }

    const e = state.clock.elapsedTime;
    // Moon-path shimmer: a slow breathing of the specular streak. Parked
    // (steady) under reduced motion.
    assets.streakMat.opacity = STREAK_OPACITY * k * (reduced ? 1 : 0.85 + 0.15 * Math.sin(e * 0.6));

    if (hemiRef.current) hemiRef.current.intensity = HEMI_INTENSITY * k;
    if (moonLightRef.current) moonLightRef.current.intensity = MOON_INTENSITY * k;
    if (cityLightRef.current) cityLightRef.current.intensity = CITY_LIGHT_INTENSITY * k;

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
          skyline across ±Z, city glow low toward (-1, 0, -0.5), the moon
          opposite over the lake. */}
      <group quaternion={frame.yawQuat}>
        {/* 1. Wooden deck, pier tip at the origin. */}
        <mesh geometry={assets.deckGeo} material={assets.deckMat} />

        {/* 2. Landing pad painted on the pier tip, under the ship. */}
        <mesh geometry={assets.padGeo} material={assets.padMat} position={[0, PAD_LIFT, 0]} />

        {/* 3. All opaque architecture: ONE merged vertex-colored draw
            (caisson, pilings, railings, lamp posts, wheel base+struts,
            Crystal Gardens plinth+ribs, sheds, Head House, the whole
            shoreline embankment + quay + piers + breakwaters, and every
            tower's antennas/penthouses/water tanks, the Marina drums and
            the Crain wedge). This is city batch 1 of 2. */}
        <mesh geometry={assets.archGeo} material={assets.archMat} />

        {/* 4. Every light that is ON: pier lamps, wheel hub, Crystal Gardens
            interior, red aircraft-warning beacons. ONE merged draw. */}
        <mesh geometry={assets.glowGeo} material={assets.glowMat} />

        {/* 4b. The Chicago skyline, city batch 2 of 2: every facade of all
            ~90 buildings in ONE merged mesh — dark vertex-tinted albedo, lit
            window grids sampled from the shared 1024²/16-variant emissive
            atlas (per-building mood, so some towers blaze and some are near
            black), four depth rows, the signature silhouettes, and the
            street-level lights / red beacons / rooftop billboards riding the
            same map through single-texel UVs. */}
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

        {/* 7. The lake: calm night water, rim baked to dissolve into haze. */}
        <mesh geometry={assets.waterGeo} material={assets.waterMat} position={[0, WATER_Y, 0]} />

        {/* 8. The moon's specular path: one additive silver streak lying on
            the water, pointing at the moon azimuth over the lake. */}
        <mesh
          geometry={assets.streakGeo}
          material={assets.streakMat}
          position={[MOON_AZ_X * 92, WATER_Y + 0.14, MOON_AZ_Z * 92]}
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

        {/* 9. Night sky dome: drawn after the depth-writing pier/skyline so
            the architecture silhouettes against it; its zenith alpha fades so
            the real starfield shows through. */}
        <mesh geometry={assets.domeGeo} material={assets.domeMat} renderOrder={1} />

        {/* 9b. Horizon haze: a THIN warm additive band where the skyline meets
            the water, warmest toward the city — cheap aerial perspective for a
            fraction of the fill the old 26-unit skirt cost. Drawn after the
            dome (renderOrder 2) so it adds over the sky; the depth-written
            pier and towers clip it where they stand in front. */}
        <mesh geometry={assets.hazeGeo} material={assets.hazeMat} position={[0, HAZE_Y, 0]} renderOrder={2} />

        {/* 10. The moon is drawn BY the dome shader (uMoonDir) — it used to be
            its own additive sprite, which cost a draw call, a material/program
            and a 256² canvas for one small disc on a surface that was already
            being rasterized behind it. */}

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
            untouched until the descent: deep night hemisphere fill, low cool
            moonlight FROM the moon azimuth (the ship at the pad reads
            rim-lit in silver), and one warm amber point light hung low over
            the city so the skyline base catches the glow. */}
        <hemisphereLight ref={hemiRef} args={[HEMI_SKY, HEMI_GROUND, 0]} />
        <directionalLight
          ref={moonLightRef}
          color={MOON_COLOR}
          intensity={0}
          position={MOON_LIGHT_POS}
          target={moonTarget}
        />
        <pointLight
          ref={cityLightRef}
          color={CITY_LIGHT_COLOR}
          intensity={0}
          distance={CITY_LIGHT_DIST}
          decay={0}
          position={CITY_LIGHT_POS}
        />
        <primitive object={moonTarget} />
      </group>
    </group>
  );
}
