/* ==== METEORS + WARP =========================================================
 *
 * The "sky is alive" motion layer, three seeded systems:
 *
 *   1. COMET STREAKS — elongated additive quads (white-hot head, tapering
 *      teal tail) drifting on a fixed diagonal through the whole voyage
 *      corridor, wrapping deterministically when they exit their box. These
 *      are the shooting stars that make deep space read as weather, not
 *      wallpaper.
 *
 *   2. NEAR MOTES — fine particulate riding the camera, always faintly
 *      present and STRETCHED along the flight axis by |vel|. This is the
 *      strongest speed cue in the scene: the eye reads speed from things it
 *      can resolve passing close, not from a distant field sliding.
 *
 *   3. WARP LINES — long speed streaks, also camera-parented. Their shared
 *      material's opacity AND their length track |vel|: invisible while
 *      docked, streaking hard mid-leg — the hyperspace cue that sells travel.
 *
 * EVERY SYSTEM IS ONE INSTANCED DRAW. The three populations used to be 50
 * separate meshes (14 comets + 36 warp lines) against 15 materials; they are
 * now three InstancedMeshes against three materials, which is what buys the
 * headroom for the mote layer to exist at all. Per-instance opacity rides on
 * instanceColor — under additive blending, scaling a fragment's colour and
 * scaling its alpha are the same operation.
 *
 * This component is PURE MOTION and is only mounted when reduced motion is
 * off (Scene3D gates it with `!reduced && <Meteors …/>`): there is no still
 * composition here worth keeping, so the reduced path omits it entirely.
 * All randomness is mulberry32-seeded; the frame loop allocates nothing.
 * ========================================================================= */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { MotionValue } from 'framer-motion';
import { mulberry32 } from '../engine';
import { useQuality } from './quality';

/* ---- tunables ----------------------------------------------------------- */

// Comet streaks.
const COMET_SEED = 0xc0e7;
const COMET_COUNT = 14;
const COMET_DIR: [number, number, number] = [-0.55, -0.28, -0.8]; // normalized per streak
const COMET_DIR_JITTER = 0.22; // per-streak spread around the shared diagonal
const COMET_X = 140; // half-width of the drift box
const COMET_Y_MIN = -70;
const COMET_Y_MAX = 90;
const COMET_Z_NEAR = 20; // box extends behind the departure camera…
const COMET_Z_PAD = 40; // …and past the deepest waypoint (extent prop)
// Speed spread is much wider than it was (24-40): a field where everything
// moves at one rate reads as a scrolling texture. Length and thickness are
// DERIVED from speed rather than drawn independently, because a fast streak
// with a stubby tail is the one combination that looks wrong.
const COMET_SPEED_MIN = 16; // units/s along the diagonal
const COMET_SPEED_MAX = 54;
const COMET_LEN_MIN = 9;
const COMET_LEN_MAX = 25;
const COMET_THICK_MIN = 0.12;
const COMET_THICK_MAX = 0.28;
const COMET_OPACITY_MIN = 0.3;
const COMET_OPACITY_MAX = 0.58;
// Rare bright ones. A field of equal streaks has no hierarchy; two or three
// obvious ones over a dozen faint ones is what a real sky does. The thickness
// bonus is deliberately small: the corridor runs THROUGH this box, so a hero
// streak can pass within a few units of the lens, and length is the axis that
// survives that pass gracefully while thickness is the one that turns into a
// bright slab across the frame.
const COMET_HERO_CHANCE = 0.14;
const COMET_HERO_LEN = 1.4;
const COMET_HERO_OPACITY = 1.15;
const COMET_HERO_THICK = 1.12;

// Near-field motes: fine particulate close enough to resolve, riding the
// camera. Present at rest (a vacuum with nothing in it at all reads as a
// missing layer), streaking hard under velocity.
/* THE NEAR FIELD, AND THE HYPERSPACE TUNNEL IT WAS.
 *
 * This layer sits between 2.4 and 11 units from the lens, which is close
 * enough that ANGULAR size, not world size, is the only unit that matters:
 * at radius 2.4 a 0.16-thick quad already subtends ~3.8° of a ~76° frame. The
 * first pass at these numbers multiplied that quad's length by ten at speed
 * and ran it up to 0.42 opacity, and the result — measured, one script, one
 * browser, same leg, same 700ms offset, only these constants differing — was
 * 4,940 bright pixels in an empty 480×560 region of the frame against 345 with
 * the layer off. Fourteen times. On screen that was roughly six thick evenly
 * spaced pale-blue bars fanning across the left half and running off both
 * edges, one of them drawn straight through the hero planet's disc. That is
 * the screensaver failure mode exactly, and at 390px wide it is worse, because
 * the bars keep their angular size on a fifth of the canvas.
 *
 * So every constant that controls how much SCREEN a mote can own has come
 * down, and the ones that control whether the layer exists at all have not:
 *   length at speed  ×10 → ×3.6   (a streak, not a bar across the frame)
 *   thickness        0.16 → 0.06  (~1.4° at the near radius, not 3.8°)
 *   peak opacity     0.42 → 0.15  (present in the read, never the subject)
 *   near radius      2.4 → 3.6    (nothing passes that close to the lens)
 * The rest-state numbers barely move: a vacuum with nothing in it at all still
 * reads as a missing layer, and that was always the right instinct. What was
 * wrong was what happened when the ship got moving. */
const MOTE_SEED = 0x5d17;
const MOTE_COUNT = 30;
const MOTE_RADIUS_MIN = 3.6; // distance from the camera axis…
const MOTE_RADIUS_MAX = 11; // …kept off the axis so none lands on the lens
const MOTE_LEN_MIN = 0.5; // at rest: near-round specks
const MOTE_LEN_MAX = 1.3;
const MOTE_THICK = 0.06;
const MOTE_STRETCH = 2.6; // extra length multiplier at FULL speed (see the ramp note)
const MOTE_Z_MIN = -34;
const MOTE_Z_MAX = 7;
const MOTE_SPAN = MOTE_Z_MAX - MOTE_Z_MIN;
const MOTE_BASE_SPEED = 7; // units/s at rest — enough to drift, not to distract
const MOTE_VEL_SPEED = 62;
const MOTE_REST_OPACITY = 0.07;
const MOTE_MAX_OPACITY = 0.15;

// Warp lines.
const WARP_SEED = 0x3a9b;
const WARP_COUNT = 36;
const WARP_RADIUS_MIN = 4; // distance from the camera axis
const WARP_RADIUS_MAX = 14;
const WARP_LEN_MIN = 6;
const WARP_LEN_MAX = 10;
const WARP_THICK = 0.05;
const WARP_Z_MIN = -40; // local cycling window along the flight axis
const WARP_Z_MAX = 8;
const WARP_SPAN = WARP_Z_MAX - WARP_Z_MIN;
const WARP_BASE_SPEED = 28; // units/s toward the viewer…
const WARP_VEL_SPEED = 40; // …plus this per station/s of |vel|
const WARP_VEL_FULL = 0.35; // |vel| at which the system hits full opacity
const WARP_MAX_OPACITY = 0.5;
// Streaks that only FADE in are a dissolve; streaks that also ELONGATE are
// speed. One extra multiply per instance per frame. Rolled back from 1.6 for
// the same reason as MOTE_STRETCH above: these start at 6–10 units long, so
// even a modest multiplier here is a very long object, and the two layers were
// stretching together into one continuous tunnel. At 0.55 the elongation is
// still legible as acceleration without the far field turning into rails.
const WARP_STRETCH = 0.55; // extra length multiplier at FULL speed

/* THE RAMP, AND WHY EVERYTHING RIDES IT.
 *
 * `vel` is a derivative of a MotionValue, so it is only as smooth as the
 * frame rate feeding it. A rail click that crosses two stations inside one
 * long frame reports |vel| = 63 STATIONS PER SECOND — 180× the value the
 * system is tuned for. Measured on a slow frame, not hypothesised: the probe
 * that caught it also caught what it did, which was multiply the near-field
 * quads by 1638 and lay a translucent slab hundreds of units long across the
 * middle of the shot.
 *
 * So nothing consumes raw |vel|. Everything — opacity, cycling speed and
 * length — consumes `clamp(|vel| / WARP_VEL_FULL, 0, 1)`, which bounds every
 * derived quantity by construction. The cost of a frame hitch is then that
 * the streaks are briefly at full stretch, which is exactly what they should
 * be at speed, instead of geometry escaping the scene. */
const MAX_DELTA = 0.25; // tab-return spike clamp so wraps stay single-step

/* ---- shared geometry (module scope — created once, never disposed) ------- */

const COMET_GEOMETRY = new THREE.PlaneGeometry(1, 1); // U runs along local X
// Warp/mote quad baked to run along Z (scale.z = length) with U along it.
const WARP_GEOMETRY = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2);

/* ---- module-scope temps (the frame loop allocates nothing) --------------- */

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

/* ---- textures ------------------------------------------------------------ */

/** GLSL's smoothstep, on the CPU — the texture painters below shape profiles
 *  with it and hand-rolling the same three lines twice invites drift. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** A real meteor shape rather than a rectangle with a gradient on it: a hot
 *  point head, an exponential brightness taper down the tail, AND a WIDTH
 *  that narrows with it, so the quad silhouette is a wedge closing to nothing.
 *  The old texture faded along its length at constant width, which is why the
 *  streaks read as scratches — a scratch is a stroke of uniform thickness.
 *  Painted per-pixel into ImageData; 256×32 once, at module load. */
function makeCometTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 32;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(w, h);
    const data = img.data;
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1); // 1 = head
      // Head: a tight hot cap in the last few percent of the quad.
      const head = Math.exp(-Math.pow((1 - u) / 0.055, 1.35)) * 0.92;
      // Tail: brightness falling away behind it, never reaching the far end.
      const tail = Math.pow(u, 2.6) * 0.78;
      const intensity = Math.min(1, head + tail);
      // Half-width in [0,1] of the quad's half-height. Two terms: a taper that
      // closes the TAIL to a thread, and a second that pinches the HEAD back
      // to a point. Without the second term the brightest part of the streak
      // is also the widest, and a fully-lit square at the leading end is what
      // made the first cut of this read as a fat dash rather than a meteor.
      const half =
        (0.15 + 0.85 * Math.pow(u, 0.45)) * (1 - 0.62 * smoothstep(0.86, 1, u));
      // Colour: teal in the cold tail running white-hot at the head.
      const warm = Math.pow(u, 3);
      const r = 76 + (255 - 76) * warm;
      const g = 201 + (255 - 201) * warm;
      const b = 240 + (255 - 240) * warm;
      for (let y = 0; y < h; y++) {
        const v = ((y + 0.5) / h) * 2 - 1;
        const across = Math.exp(-((v / half) * (v / half)) * 2.6);
        const a = intensity * across;
        const i = (y * w + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Transparent -> white-cyan -> transparent along the quad length. Shared by
 *  the warp lines and the near motes; at mote lengths it reads as a soft
 *  speck, at warp lengths as a streak. */
function makeWarpTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, 'rgba(154,220,255,0)');
    g.addColorStop(0.5, 'rgba(224,248,255,0.95)');
    g.addColorStop(1, 'rgba(154,220,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 8);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* ---- specs --------------------------------------------------------------- */

/** Flat, index-addressed comet state. Positions are mutated in place by the
 *  frame loop; everything else is fixed at build time. */
type CometBuild = {
  count: number;
  /** xyz per comet, MUTATED per frame. */
  position: Float32Array;
  /** unit xyz per comet. */
  dir: Float32Array;
  speed: Float32Array;
  /** xyzw per comet — local +X aims along `dir`. */
  quat: Float32Array;
  /** length, thickness per comet. */
  size: Float32Array;
  opacity: Float32Array;
};

const X_AXIS = new THREE.Vector3(1, 0, 0);
const _dir = new THREE.Vector3();

function buildComets(extent: number, count: number): CometBuild {
  const rng = mulberry32(COMET_SEED);
  const zMin = -extent - COMET_Z_PAD;
  const position = new Float32Array(count * 3);
  const dir = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  const quat = new Float32Array(count * 4);
  const size = new Float32Array(count * 2);
  const opacity = new Float32Array(count);
  const q = new THREE.Quaternion();

  for (let i = 0; i < count; i++) {
    _dir
      .set(
        COMET_DIR[0] + (rng() - 0.5) * COMET_DIR_JITTER,
        COMET_DIR[1] + (rng() - 0.5) * COMET_DIR_JITTER,
        COMET_DIR[2] + (rng() - 0.5) * COMET_DIR_JITTER,
      )
      .normalize();
    // Local +X (the hot head end of the gradient) aims along the travel
    // direction, so the head leads and the teal tail trails.
    q.setFromUnitVectors(X_AXIS, _dir);
    quat[i * 4] = q.x;
    quat[i * 4 + 1] = q.y;
    quat[i * 4 + 2] = q.z;
    quat[i * 4 + 3] = q.w;
    dir[i * 3] = _dir.x;
    dir[i * 3 + 1] = _dir.y;
    dir[i * 3 + 2] = _dir.z;

    position[i * 3] = (rng() * 2 - 1) * COMET_X;
    position[i * 3 + 1] = COMET_Y_MIN + rng() * (COMET_Y_MAX - COMET_Y_MIN);
    position[i * 3 + 2] = COMET_Z_NEAR - rng() * (COMET_Z_NEAR - zMin);

    // Speed first; length and thickness follow it, so fast streaks are long
    // and thin and slow ones are short and soft.
    const fast = rng();
    speed[i] = COMET_SPEED_MIN + fast * (COMET_SPEED_MAX - COMET_SPEED_MIN);
    let length = COMET_LEN_MIN + fast * (COMET_LEN_MAX - COMET_LEN_MIN);
    let thickness = COMET_THICK_MIN + (1 - fast) * (COMET_THICK_MAX - COMET_THICK_MIN);
    let alpha = COMET_OPACITY_MIN + rng() * (COMET_OPACITY_MAX - COMET_OPACITY_MIN);
    if (rng() < COMET_HERO_CHANCE) {
      length *= COMET_HERO_LEN;
      thickness *= COMET_HERO_THICK;
      alpha = Math.min(1, alpha * COMET_HERO_OPACITY);
    }
    size[i * 2] = length;
    size[i * 2 + 1] = thickness;
    opacity[i] = alpha;
  }
  return { count, position, dir, speed, quat, size, opacity };
}

/** Camera-parented streak population — the motes and the warp lines share a
 *  layout and differ only in their tunables. `z` is MUTATED per frame. */
type StreakBuild = {
  count: number;
  /** x, y per streak (fixed offsets from the camera axis). */
  offset: Float32Array;
  /** local z, MUTATED per frame. */
  z: Float32Array;
  /** xyzw per streak — a roll about the flight axis. */
  quat: Float32Array;
  length: Float32Array;
  /** per-streak brightness, baked into instanceColor once. */
  bright: Float32Array;
};

function buildStreaks(
  seed: number,
  count: number,
  radiusMin: number,
  radiusMax: number,
  lenMin: number,
  lenMax: number,
  zMin: number,
  span: number,
): StreakBuild {
  const rng = mulberry32(seed);
  const offset = new Float32Array(count * 2);
  const z = new Float32Array(count);
  const quat = new Float32Array(count * 4);
  const length = new Float32Array(count);
  const bright = new Float32Array(count);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();

  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    // sqrt on the radius keeps the population evenly spread over the annulus
    // instead of crowding the inner edge, where streaks are biggest on screen.
    const radius = radiusMin + Math.sqrt(rng()) * (radiusMax - radiusMin);
    offset[i * 2] = Math.cos(angle) * radius;
    offset[i * 2 + 1] = Math.sin(angle) * radius;
    z[i] = zMin + rng() * span; // staggered phases — no pulsing
    q.setFromEuler(e.set(0, 0, angle)); // width tangential, face the axis
    quat[i * 4] = q.x;
    quat[i * 4 + 1] = q.y;
    quat[i * 4 + 2] = q.z;
    quat[i * 4 + 3] = q.w;
    length[i] = lenMin + rng() * (lenMax - lenMin);
    bright[i] = 0.55 + rng() * 0.45;
  }
  return { count, offset, z, quat, length, bright };
}

/** Bake per-instance brightness into instanceColor once. Additive blending
 *  makes this exactly equivalent to a per-instance opacity, which an
 *  InstancedMesh has no other way to express. */
function paintBrightness(mesh: THREE.InstancedMesh | null, values: Float32Array): void {
  if (!mesh) return;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 1;
    _color.setRGB(v, v, v);
    mesh.setColorAt(i, _color);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** True modulo wrap into [min, min+span). A single subtract is only correct
 *  while one frame's travel is smaller than the window — which is the
 *  assumption a frame hitch breaks, stranding a streak far behind the camera
 *  for dozens of frames while it walks back one span at a time. */
function wrapZ(z: number, min: number, span: number): number {
  return min + (((z - min) % span) + span) % span;
}

/** Write one camera-parented streak's matrix. */
function writeStreak(
  mesh: THREE.InstancedMesh,
  build: StreakBuild,
  i: number,
  thickness: number,
  stretch: number,
): void {
  _pos.set(build.offset[i * 2] ?? 0, build.offset[i * 2 + 1] ?? 0, build.z[i] ?? 0);
  _quat.set(
    build.quat[i * 4] ?? 0,
    build.quat[i * 4 + 1] ?? 0,
    build.quat[i * 4 + 2] ?? 0,
    build.quat[i * 4 + 3] ?? 1,
  );
  _scale.set(1, thickness, (build.length[i] ?? 1) * stretch);
  _mat.compose(_pos, _quat, _scale);
  mesh.setMatrixAt(i, _mat);
}

/* ---- component ----------------------------------------------------------- */

export function Meteors({ vel, extent }: { vel: MotionValue<number>; extent: number }) {
  // One read, at mount. `meteorScale` is the tier's knob for exactly this
  // layer: ambient motion populations that nobody is looking directly at.
  const quality = useQuality();
  const scale = quality.meteorScale;

  const cometsRef = useRef<THREE.InstancedMesh>(null);
  const motesRef = useRef<THREE.InstancedMesh>(null);
  const warpRef = useRef<THREE.InstancedMesh>(null);
  const riderRef = useRef<THREE.Group>(null);

  const cometCount = Math.max(4, Math.round(COMET_COUNT * scale));
  const moteCount = Math.max(8, Math.round(MOTE_COUNT * scale));
  const warpCount = Math.max(10, Math.round(WARP_COUNT * scale));

  const comets = useMemo(() => buildComets(extent, cometCount), [extent, cometCount]);
  const motes = useMemo(
    () =>
      buildStreaks(
        MOTE_SEED,
        moteCount,
        MOTE_RADIUS_MIN,
        MOTE_RADIUS_MAX,
        MOTE_LEN_MIN,
        MOTE_LEN_MAX,
        MOTE_Z_MIN,
        MOTE_SPAN,
      ),
    [moteCount],
  );
  const warpLines = useMemo(
    () =>
      buildStreaks(
        WARP_SEED,
        warpCount,
        WARP_RADIUS_MIN,
        WARP_RADIUS_MAX,
        WARP_LEN_MIN,
        WARP_LEN_MAX,
        WARP_Z_MIN,
        WARP_SPAN,
      ),
    [warpCount],
  );

  const cometTexture = useMemo(() => makeCometTexture(), []);
  const warpTexture = useMemo(() => makeWarpTexture(), []);
  useEffect(
    () => () => {
      cometTexture.dispose();
      warpTexture.dispose();
    },
    [cometTexture, warpTexture],
  );

  // Three materials for three populations. The two camera-parented ones use
  // their material's opacity as the whole system's throttle, written once per
  // frame from |vel|; the comets' opacity is per-instance and never animates.
  const materials = useMemo(() => {
    const comet = new THREE.MeshBasicMaterial({
      map: cometTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const mote = new THREE.MeshBasicMaterial({
      map: warpTexture,
      transparent: true,
      opacity: MOTE_REST_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const warp = new THREE.MeshBasicMaterial({
      map: warpTexture,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    return { comet, mote, warp };
  }, [cometTexture, warpTexture]);
  useEffect(
    () => () => {
      for (const m of Object.values(materials)) m.dispose();
    },
    [materials],
  );

  // Per-instance brightness, written once per rebuild. The comets carry their
  // magnitude here; the streak systems carry a subtle spread so a warp burst
  // is not 36 identical lines.
  useLayoutEffect(() => {
    paintBrightness(cometsRef.current, comets.opacity);
  }, [comets]);
  useLayoutEffect(() => {
    paintBrightness(motesRef.current, motes.bright);
  }, [motes]);
  useLayoutEffect(() => {
    paintBrightness(warpRef.current, warpLines.bright);
  }, [warpLines]);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, MAX_DELTA);
    // The one normalised speed every velocity-driven quantity below reads —
    // see THE RAMP above. Raw |vel| is never used for anything but this.
    const ramp = THREE.MathUtils.clamp(Math.abs(vel.get()) / WARP_VEL_FULL, 0, 1);

    // 1. Comets: drift along their diagonal; wrap by box size on exit —
    // deterministic, no random on wrap.
    const cm = cometsRef.current;
    if (cm) {
      const zMin = -extent - COMET_Z_PAD;
      const zSize = COMET_Z_NEAR - zMin;
      const xSize = COMET_X * 2;
      const ySize = COMET_Y_MAX - COMET_Y_MIN;
      const p = comets.position;
      for (let i = 0; i < comets.count; i++) {
        const step = (comets.speed[i] ?? 0) * delta;
        let x = (p[i * 3] ?? 0) + (comets.dir[i * 3] ?? 0) * step;
        let y = (p[i * 3 + 1] ?? 0) + (comets.dir[i * 3 + 1] ?? 0) * step;
        let z = (p[i * 3 + 2] ?? 0) + (comets.dir[i * 3 + 2] ?? 0) * step;
        if (x < -COMET_X) x += xSize;
        else if (x > COMET_X) x -= xSize;
        if (y < COMET_Y_MIN) y += ySize;
        else if (y > COMET_Y_MAX) y -= ySize;
        if (z < zMin) z += zSize;
        else if (z > COMET_Z_NEAR) z -= zSize;
        p[i * 3] = x;
        p[i * 3 + 1] = y;
        p[i * 3 + 2] = z;
        _pos.set(x, y, z);
        _quat.set(
          comets.quat[i * 4] ?? 0,
          comets.quat[i * 4 + 1] ?? 0,
          comets.quat[i * 4 + 2] ?? 0,
          comets.quat[i * 4 + 3] ?? 1,
        );
        _scale.set(comets.size[i * 2] ?? 1, comets.size[i * 2 + 1] ?? 1, 1);
        _mat.compose(_pos, _quat, _scale);
        cm.setMatrixAt(i, _mat);
      }
      cm.instanceMatrix.needsUpdate = true;
    }

    // The camera rider: both near systems hang off this, so the camera's
    // position is copied once rather than twice.
    const rider = riderRef.current;
    if (rider) rider.position.copy(state.camera.position);

    // 2. Near motes: always drifting, stretching with |vel|. This is the layer
    // the eye actually reads speed from, so it never fully switches off.
    const mm = motesRef.current;
    if (mm) {
      materials.mote.opacity =
        MOTE_REST_OPACITY + ramp * (MOTE_MAX_OPACITY - MOTE_REST_OPACITY);
      const stretch = 1 + ramp * MOTE_STRETCH;
      const dz = (MOTE_BASE_SPEED + ramp * MOTE_VEL_SPEED) * delta;
      for (let i = 0; i < motes.count; i++) {
        motes.z[i] = wrapZ((motes.z[i] ?? 0) + dz, MOTE_Z_MIN, MOTE_SPAN);
        writeStreak(mm, motes, i, MOTE_THICK, stretch);
      }
      mm.instanceMatrix.needsUpdate = true;
    }

    // 3. Warp lines: cycle local z toward the viewer at a velocity-boosted
    // rate; the shared material's opacity tracks the ramp so the system is
    // invisible at dock and streaks during legs — and the streaks ELONGATE,
    // which is the difference between a dissolve and a speed cue.
    const wm = warpRef.current;
    if (wm) {
      const opacity = ramp * WARP_MAX_OPACITY;
      materials.warp.opacity = opacity;
      wm.visible = opacity > 0.003; // skip the draw entirely while docked
      if (wm.visible) {
        const stretch = 1 + ramp * WARP_STRETCH;
        const dz = (WARP_BASE_SPEED + ramp * WARP_VEL_SPEED) * delta;
        for (let i = 0; i < warpLines.count; i++) {
          warpLines.z[i] = wrapZ((warpLines.z[i] ?? 0) + dz, WARP_Z_MIN, WARP_SPAN);
          writeStreak(wm, warpLines, i, WARP_THICK, stretch);
        }
        wm.instanceMatrix.needsUpdate = true;
      }
    }
  });

  return (
    <group>
      {/* Comets span the whole corridor, but an InstancedMesh is culled
          against its BASE geometry's bounding sphere — one unit quad — so
          leaving culling on would drop the entire population. */}
      <instancedMesh
        ref={cometsRef}
        args={[COMET_GEOMETRY, materials.comet, comets.count]}
        frustumCulled={false}
      />

      {/* The rider teleports to the camera every frame — bounding-sphere
          culling would flicker it, so culling is off for both systems. */}
      <group ref={riderRef} frustumCulled={false}>
        <instancedMesh
          ref={motesRef}
          args={[WARP_GEOMETRY, materials.mote, motes.count]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={warpRef}
          args={[WARP_GEOMETRY, materials.warp, warpLines.count]}
          frustumCulled={false}
          visible={false}
        />
      </group>
    </group>
  );
}
