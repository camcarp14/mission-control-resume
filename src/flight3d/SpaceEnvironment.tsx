/* ==== SPACE ENVIRONMENT ======================================================
 *
 * The stage the voyage flies through: the milky-way backdrop, the deep star
 * field, and the three-light rig. Nothing here reacts to stations or scroll —
 * it is the constant behind every leg, which is why it renders once and only
 * the sun light takes a position from outside (the sun is the scene's key
 * light, so it must sit exactly where space.ts put the final waypoint).
 * ========================================================================= */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { mulberry32, type Vec3 } from '../engine';
import { useQuality } from './quality';

const MILKY_WAY_URL = '/textures/6k_stars_milky_way.webp';

// Big enough that camera travel never parallaxes against it — a sky that
// visibly slides reads as a wall, not the galaxy. It is also CENTRED ON THE
// CORRIDOR rather than on the world origin (see `centre` below): the flight
// runs ~950 units down -Z, so an origin-centred 1000-unit sphere ended the
// voyage with its far wall 50 units off the camera's nose. Measured symptom:
// the backdrop drained to flat black over the last three stations, which is
// exactly where the finale needed depth most.
const SKY_RADIUS = 1400;

// Fixed aesthetic pose, not animation: the equirect galactic band sits on the
// texture's equator, so tilting X/Z lays it diagonally across the frame and
// the Y turn picks the densest stretch of the band to face the flight line.
const SKY_ROTATION: Vec3 = [0.18, 2.4, 0.58];

// Slight grey multiply on the backdrop so the band glows without competing
// with the DOM panels' text contrast — restraint is the palette contract.
const SKY_TINT = '#c8ccd2';

// Lighting rig. Ambient is dim and cool so shadowed hemispheres stay moody;
// the sun light is warm (the one place warmth is allowed) with decay 0 so it
// carries across the whole voyage; the fill is a whisper from the camera's
// general direction so dark sides shade to charcoal instead of void-black.
const AMBIENT_COLOR = '#aebccb';
const AMBIENT_INTENSITY = 0.24;
const SUN_LIGHT_COLOR = '#fff2e0';
/** Exported so the planet limb shader can weight the same irradiance the
 *  surfaces themselves receive — an atmosphere that glows where its planet is
 *  dark reads as an outline stroke, not as air. See SolarBodies' Atmosphere. */
export const SUN_LIGHT_INTENSITY = 2.6;
// The KEY light: a cool-white directional from high over the viewer's right
// shoulder. This is what carves a real day/night terminator across every
// body — with only the far sun point light, mid-voyage planets photographed
// flat (live-site finding). Ambient dropped to let the shadow side breathe.
const FILL_COLOR = '#dfe8ff';
/** Also exported for the limb shader — same reason as SUN_LIGHT_INTENSITY. */
export const FILL_INTENSITY = 1.15;
// Direction only (directional lights ignore distance): high, right, and
// behind the flight line, roughly where the viewer's eye comes from.
export const FILL_FROM: Vec3 = [10, 7, 12];

/* ---- the deep star field --------------------------------------------------
 * Hand-built rather than drei's <Stars>, for four reasons that all showed up
 * in screenshots of the shipped field:
 *
 *   1. It was UNSEEDED (Math.random), so the sky reshuffled on every visit.
 *      Every other scatter in this project is seeded off a fixed constant so
 *      the composition a visitor describes is the composition the next one
 *      sees; the sky was the one place that broke the rule.
 *   2. Every star was the SAME brightness — magnitude lived only in point
 *      size, and additive blending then rendered a field of identical dots.
 *      Real depth comes from a handful of obviously bright stars over a haze
 *      of faint ones.
 *   3. Every star was the SAME colour (setHSL at saturation 0), so the field
 *      had no colour temperature at all. Restrained blue-white through amber
 *      is what separates a sky from a screensaver.
 *   4. The whole field breathed IN UNISON — drei multiplies every point size
 *      by (3 + sin(time)), which is a synchronised 2x-4x pulse. Read exactly
 *      like a loading indicator, which is the same verdict the star cluster
 *      component records for twinkle. This field does not animate at all;
 *      its motion is the parallax of a camera actually travelling through it,
 *      and that also means there is nothing here to gate on reduced motion.
 *
 * Cost is unchanged: one Points draw, one program, no bytes on the wire. */

/* DEPTH. The field used to live on a 420-unit-thick shell at 700-1120 — a
 * ratio of 1.6 between the nearest and furthest star, which is close enough
 * to a DOME that the whole sky slid as one rigid body when the camera
 * translated. That is the difference between "the sky rotated" and "we
 * travelled": a field with no internal depth has no parallax to give.
 *
 * So the shell is now a VOLUME, 380 → 1290, a ratio of 3.4. Near stars sweep
 * measurably faster than far ones as the camera moves down the corridor, and
 * that differential IS the sense of travel. Three details make it free:
 *
 *   · SIZE IS SCALED BY THE STAR'S OWN RADIUS (aSize ∝ r), so at the opening
 *     pose every star subtends exactly the angle it did before. Depth costs
 *     nothing in the still frame and pays only in motion — which is the
 *     honest place for it to pay, and it means the near layer cannot quietly
 *     turn into a row of fat foreground dots.
 *   · THE DISTRIBUTION IS BY VOLUME, not by radius. r = (near^p + u·(far^p −
 *     near^p))^(1/p): p = 3 is a uniform-density starfield, and the p below
 *     is a shade under that, which puts a few more stars in the near layer
 *     than physics would — the near layer is the one carrying the parallax,
 *     and a handful of far-field stars cannot show it on their own.
 *   · A NEAR FADE IN THE VERTEX SHADER retires any star the camera gets close
 *     to. The corridor runs ~900 units and the field is centred near its
 *     start, so late in the voyage the camera IS inside the volume; without
 *     the fade a passed star swells to the point-size clamp and reads as a
 *     firefly. Costs one smoothstep and no CPU at all. */
const STARS_NEAR = 380;
const STARS_FAR = 1290; // comfortably inside SKY_RADIUS, so stars never punch the backdrop
const STARS_DEPTH_POW = 2.2;
/** The distance at which STAR_SIZE_* are literal world units. Everything
 *  nearer or further is scaled to hold the same angular size, so this is the
 *  one number that ties the new depth back to the shipped composition. */
const STARS_SIZE_REF = 900;
/** Near fade, in world units of view depth: invisible at x, whole at y. */
const STARS_FADE_IN = 110;
const STARS_FADE_FULL = 320;
// Magnitude curve. u^POW pushes the population hard toward faint, so the few
// stars that do reach 1.0 read as genuinely bright rather than as "the big
// ones". FLOOR keeps the faintest visible — at 0 they vanish under the
// backdrop tint and the count stops buying anything.
const STAR_MAG_POW = 3.4;
const STAR_MAG_FLOOR = 0.16;
// World-unit sprite size at STARS_SIZE_REF, faint → brightest. The vertex
// shader converts to pixels through the live projection, so stars keep their
// angular size when the flight's fov breathes.
const STAR_SIZE_MIN = 1.1;
const STAR_SIZE_MAX = 5.4;
// Colour temperature ramp: hot blue-white at one end, cool amber at the
// other, neutral in the middle where most of the population lands. Deviation
// from white is then scaled by STAR_TINT — this is deep space in a telemetry
// palette, so the spread must be FELT rather than seen; at full saturation a
// star field reads as confetti.
const STAR_COOL = '#b6d2ff';
const STAR_WARM = '#ffc98c';
const STAR_TINT = 0.62;
/** How much of STAR_TINT the FAINTEST star keeps. Colour is carried by the
 *  bright end on purpose, and that is not a stylisation: the eye resolves hue
 *  only above a brightness floor, which is exactly why a real night sky is a
 *  grey haze with a few coloured anchors in it. Scaling tint by magnitude
 *  therefore buys a wider temperature spread at the top — the anchors get
 *  MORE colour than before — without the faint majority turning to confetti. */
const STAR_TINT_FLOOR = 0.42;
// Above this magnitude a star also gets the wide soft halo in the fragment
// shader — that is the "a few of these are real suns" cue, and it is what
// hands the bloom pass something to catch.
const STAR_HALO_FROM = 0.62;
const STAR_HALO_GAIN = 0.5;
const STARS_SEED = 0x5ee0d;
const STAR_WHITE = new THREE.Color('#ffffff');

const STARS_VERT = `
uniform float uPx;
uniform vec2 uFade;
attribute float aSize;
attribute float aHalo;
varying vec3 vColor;
varying float vHalo;
varying float vFade;
void main() {
  vColor = color;
  vHalo = aHalo;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Guarded: a star behind the camera is clipped by w anyway, but the
  // reciprocal below would be an inf on the way there.
  float depth = max(-mv.z, 0.001);
  // Retire stars the camera has effectively flown past — see the DEPTH note.
  // Measured RADIALLY, not by view depth: view depth shrinks with the cosine
  // of the off-axis angle, so a fade keyed on it would dim the corners of the
  // frame more than the centre — a vignette nobody asked for.
  vFade = smoothstep(uFade.x, uFade.y, length(mv.xyz));
  // Physically-sized points: world size projected through the live camera, so
  // a fov change zooms the field the way it zooms everything else. This one
  // IS view depth — that is what the perspective divide uses.
  gl_PointSize = clamp(aSize * uPx * projectionMatrix[1][1] / depth, 0.6, 24.0);
  gl_Position = projectionMatrix * mv;
}`;

const STARS_FRAG = `
varying vec3 vColor;
varying float vHalo;
varying float vFade;
void main() {
  // Two gaussians in one quad: a tight core every star gets, and a wide faint
  // halo only the bright ones get. One draw call still, and the halo is what
  // makes a first-magnitude star read as a light source instead of a pixel.
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (exp(-d * d * 8.0) + exp(-d * d * 1.9) * vHalo) * vFade;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

/** Seeded star buffers. Position in a volume, magnitude on a steep power law,
 *  colour on a bell-weighted temperature ramp whose strength follows
 *  magnitude — all correlated, because in a real field the bright stars are
 *  also the ones whose colour you can actually see. */
function buildStars(count: number): {
  position: Float32Array;
  color: Float32Array;
  size: Float32Array;
  halo: Float32Array;
} {
  const rand = mulberry32(STARS_SEED);
  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const halo = new Float32Array(count);
  const cool = new THREE.Color(STAR_COOL);
  const warm = new THREE.Color(STAR_WARM);
  const c = new THREE.Color();
  const nearP = Math.pow(STARS_NEAR, STARS_DEPTH_POW);
  const farP = Math.pow(STARS_FAR, STARS_DEPTH_POW);

  for (let i = 0; i < count; i++) {
    // Uniform on the sphere: acos of a uniform z, never a naive lat/long,
    // which would pile the field at the poles.
    const z = rand() * 2 - 1;
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    const a = rand() * Math.PI * 2;
    const r = Math.pow(nearP + rand() * (farP - nearP), 1 / STARS_DEPTH_POW);
    position[i * 3] = Math.cos(a) * s * r;
    position[i * 3 + 1] = Math.sin(a) * s * r;
    position[i * 3 + 2] = z * r;

    const mag = STAR_MAG_FLOOR + (1 - STAR_MAG_FLOOR) * Math.pow(rand(), STAR_MAG_POW);
    // Three samples averaged is a cheap bell — most stars land near neutral
    // and the saturated ends stay rare, which is the real distribution.
    const temp = (rand() + rand() + rand()) / 3;
    c.copy(cool).lerp(warm, temp);
    // Pull every tint back toward white: the palette contract wants the field
    // felt as temperature, not seen as confetti, and the faint majority is
    // pulled back hardest (STAR_TINT_FLOOR).
    const tint = STAR_TINT * (STAR_TINT_FLOOR + (1 - STAR_TINT_FLOOR) * mag);
    c.lerp(STAR_WHITE, 1 - tint);
    color[i * 3] = c.r * mag;
    color[i * 3 + 1] = c.g * mag;
    color[i * 3 + 2] = c.b * mag;

    // Angular size held constant against depth — see the DEPTH note above.
    const angular = STAR_SIZE_MIN + (STAR_SIZE_MAX - STAR_SIZE_MIN) * Math.pow(mag, 1.8);
    size[i] = (angular * r) / STARS_SIZE_REF;
    const h = (mag - STAR_HALO_FROM) / (1 - STAR_HALO_FROM);
    halo[i] = h <= 0 ? 0 : h * h * STAR_HALO_GAIN;
  }
  return { position, color, size, halo };
}

/* ---- the nebula band ------------------------------------------------------
 * The void behind the voyage photographed as FLAT BLACK everywhere the milky
 * way texture is dark, which is most of the frame — and flat black has no
 * distance in it. Real deep space has structure at the threshold of vision:
 * dust that is barely a shade off the background until you look for it.
 *
 * Cheapest honest way to get that: a handful of very large, very faint
 * additive quads parked out on the backdrop shell. NOT a second full sky
 * sphere, for two reasons — a sphere is one guaranteed screenful of fill on
 * every frame of the flight (the star layer is deliberately never culled, so
 * anything added here is paid on the descent too), and a sphere can only tint
 * the dome uniformly, which is the one thing this is supposed to fix. Quads
 * frustum-cull: typically two or three of them are on screen at once, and
 * during the landing dive almost none are.
 *
 * They lie in a SWATH AIMED AT THE CORRIDOR, not scattered over the sphere.
 * That is a measured decision, not a taste one. The first cut scattered seven
 * clouds over 4π steradians; against a 76°×50° frustum the mean sky luminance
 * moved by 0.01/255 — a layer that cost draw calls and rendered a rounding
 * error. The second cut put them on a great circle, which sounds like a
 * galactic band and behaves like one: a great circle tilted off the horizon
 * reaches ±60° of world latitude, so a scene probe found six of the seven
 * clouds hundreds of units above or below the flight line and one clipping
 * the bottom of frame. Both times the geometry was fine and the aim was
 * wrong.
 *
 * So the swath is built in the camera's own frame. NEBULA_AXIS is where the
 * flight actually looks — forward down the corridor and left, because the
 * bodies sit left of the line and the gaze is weighted to them at every
 * station. Clouds spread WIDE along a diagonal in that frame and NARROW
 * across it, lifted above the axis so the band rakes the upper frame instead
 * of cutting the shot in half. Two or three land in view at any pose, which
 * is the difference between a feature and a rounding error.
 *
 * Restraint is the whole brief here. Peak additive contribution is a couple
 * of percent of a mid grey; near-black with a hint of colour, never a purple
 * poster, and far under the 0.85 bloom threshold so none of this can flare. */
const NEBULA_SEED = 0x9b13;
const NEBULA_RADIUS_MIN = 1010;
const NEBULA_RADIUS_MAX = 1240;
const NEBULA_SPAN_MIN = 430; // world units across, at that radius
const NEBULA_SPAN_MAX = 940;
const NEBULA_OPACITY_MIN = 0.14;
const NEBULA_OPACITY_MAX = 0.26;
/** The flight's average look direction, in world space. */
const NEBULA_AXIS = new THREE.Vector3(-0.52, 0.05, -0.85).normalize();
/** Roll of the swath within the frame — the diagonal, in radians. */
const NEBULA_TILT = 0.55;
/** Half-length of the swath along that diagonal, in radians of view angle. */
const NEBULA_ALONG = 1.05;
/** Half-thickness across it. Small: this is a band, not a fog bank. */
const NEBULA_ACROSS = 0.26;
/** How far the swath's centreline sits off the look axis, in radians. */
const NEBULA_LIFT = 0.22;
/** Deep slate blues and one bruised rust. Every one of these is darker than
 *  the #12151a "raised" panel colour; additive at ~0.15 they land as a hint
 *  of temperature, which is the whole point. */
const NEBULA_TINTS = ['#2a3a56', '#1e3742', '#37293a', '#243049', '#2c2f3f'] as const;
/* The population used to live here, as a private `{ low: 4, mid: 7, high: 10 }`
 * table. It is on the QUALITY BUDGET now (`budget.nebula`) and low reads ZERO,
 * for two reasons that are really one reason. First, these quads are the only
 * genuinely NEW fill this file added: each is a 430–940 unit additive,
 * double-sided, depthWrite:false sheet at radius ~1010–1240, so one of them
 * subtends roughly 46° against a ~76° frustum — four of them at low is not
 * "at or below today", it is four screen-filling transparent layers a weak
 * device never used to draw. Second, and worse, quality.test.ts's "low is at
 * or below today on every axis" invariant iterates the fields of
 * QualityBudget, so a population living in a private module table was
 * structurally invisible to the one test written to catch exactly this. A knob
 * nobody can see is a knob nobody is holding. */

const NEBULA_GEOMETRY = new THREE.PlaneGeometry(1, 1);
const NEBULA_FACE = new THREE.Vector3(0, 0, 1);

/** GLSL's smoothstep on the CPU — the cloud mask below shapes its falloff
 *  with the same curve the shaders use. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** One soft cloud, painted once into ImageData: a sum of seeded gaussian
 *  blobs clustered around a few cores, then masked by a radial falloff so the
 *  quad's own edges can never show. White — every tint comes from the
 *  material, so all the clouds share this one texture.
 *
 *  Computed per-pixel rather than composited from canvas gradients. The
 *  gradient version of this was invisible on screen while still costing its
 *  draw calls, and per-pixel alpha is the version whose output can be reasoned
 *  about without a screenshot: the peak is a number in this function, not an
 *  emergent property of forty overlapping `lighter` fills. */
/* SIZE, AND WHY IT IS NOT 256. This was a 256² canvas evaluated as a triple
 * nested loop — 65,536 pixels × 44 blobs — which measured 60.5ms cold and
 * 39.1ms warm in Chromium on the build box, synchronously, on the main thread,
 * inside SpaceEnvironment's FIRST render: the same moment the boot is already
 * paying for its shader links. On a mid-range phone at 3–4× that cost it is a
 * fifth of a second of blocked main thread at the worst possible instant.
 *
 * 128² is the honest resolution for this content. The narrowest gaussian in
 * the field has σ ≈ 6.4px at this size, so there is nothing here above the
 * sampler's own Nyquist — the quad is magnified 5–6× on screen either way and
 * bilinear filtering reconstructs a sum-of-gaussians exactly as well from the
 * smaller grid. Four times fewer pixels, and the SCATTER below turns the
 * remaining work from O(pixels × blobs) into O(Σ blob areas). */
const NEBULA_TEX_SIZE = 128;

function makeNebulaTexture(): THREE.CanvasTexture {
  const size = NEBULA_TEX_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const rng = mulberry32(NEBULA_SEED);
    type Blob = { x: number; y: number; inv2s2: number; amp: number; reach: number };
    const blobs: Blob[] = [];
    for (let k = 0; k < 4; k++) {
      const cx = size * (0.3 + rng() * 0.4);
      const cy = size * (0.3 + rng() * 0.4);
      const spread = size * (0.09 + rng() * 0.13);
      for (let i = 0; i < 11; i++) {
        // Two uniforms averaged is a cheap bell — blobs bunch on the core and
        // thin out from it, which is what makes the result read as cloud
        // rather than as a ring of circles.
        const sigma = size * (0.05 + rng() * 0.13);
        blobs.push({
          x: cx + (rng() + rng() - 1) * spread * 2,
          y: cy + (rng() + rng() - 1) * spread * 2,
          inv2s2: 1 / (2 * sigma * sigma),
          amp: 0.16 + rng() * 0.2,
          // 3σ, the same cutoff the old inner loop applied per pixel as
          // `if (e < 9)`. Hoisting it out of the pixel loop and into a
          // bounding box is what makes this a scatter rather than a gather:
          // the identical term is skipped, but now without visiting the pixel
          // to discover that it should be.
          reach: Math.ceil(3 * sigma),
        });
      }
    }
    // SCATTER, not gather. The old loop visited every pixel and asked all 44
    // blobs; this visits each blob and touches only the pixels inside its own
    // 3σ box. Same sum, same seed, same output — the ~10× is entirely the
    // pixel/blob pairs that were only ever going to contribute zero.
    const acc = new Float32Array(size * size);
    for (const b of blobs) {
      const x0 = Math.max(0, Math.floor(b.x - b.reach));
      const x1 = Math.min(size - 1, Math.ceil(b.x + b.reach));
      const y0 = Math.max(0, Math.floor(b.y - b.reach));
      const y1 = Math.min(size - 1, Math.ceil(b.y + b.reach));
      for (let y = y0; y <= y1; y++) {
        const dy = y - b.y;
        const row = y * size;
        const ey = dy * dy * b.inv2s2;
        for (let x = x0; x <= x1; x++) {
          const dx = x - b.x;
          const e = dx * dx * b.inv2s2 + ey;
          if (e < 9) acc[row + x] = (acc[row + x] ?? 0) + b.amp * Math.exp(-e);
        }
      }
    }
    const img = ctx.createImageData(size, size);
    const data = img.data;
    const half = size / 2;
    // The radial mask is separable-ish but not worth it at this size; what it
    // IS worth is hoisting the row term out of the inner loop.
    for (let y = 0; y < size; y++) {
      const dy = y - half;
      const dy2 = dy * dy;
      for (let x = 0; x < size; x++) {
        const dx = x - half;
        // Radial mask: whole in the middle, gone before the border.
        const rr = Math.sqrt(dx * dx + dy2) / half;
        const a = (acc[y * size + x] ?? 0) * (1 - smoothstep(0.24, 0.98, rr));
        const i = (y * size + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let nebulaTexture: THREE.CanvasTexture | null = null;
function getNebulaTexture(): THREE.CanvasTexture {
  nebulaTexture ??= makeNebulaTexture();
  return nebulaTexture;
}

type NebulaSpec = {
  key: number;
  position: Vec3;
  quaternion: THREE.Quaternion;
  scale: number;
  tint: string;
  opacity: number;
};

/** Seeded cloud placement. The quads face the field centre rather than the
 *  camera: at ~1100 units out, with the camera never more than ~900 from the
 *  centre, the difference is a few degrees of foreshortening on a shape with
 *  no edges — and a fixed pose means zero per-frame work and real frustum
 *  culling, which a billboard would give up. */
function buildNebula(count: number): NebulaSpec[] {
  const rng = mulberry32(NEBULA_SEED ^ 0x1f);
  const dir = new THREE.Vector3();
  // A screen-like basis about the look axis: `right` is horizontal in world
  // terms, `up` completes the frame. The swath is then laid out in (along,
  // across) view angles and only converted to a world direction at the end,
  // which is why this aims where it is supposed to.
  const right = new THREE.Vector3().crossVectors(NEBULA_AXIS, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, NEBULA_AXIS).normalize();
  // Roll that basis by the tilt to get the swath's own diagonal axes.
  const along = right
    .clone()
    .multiplyScalar(Math.cos(NEBULA_TILT))
    .addScaledVector(up, Math.sin(NEBULA_TILT));
  const across = right
    .clone()
    .multiplyScalar(-Math.sin(NEBULA_TILT))
    .addScaledVector(up, Math.cos(NEBULA_TILT));
  const out: NebulaSpec[] = [];
  for (let i = 0; i < count; i++) {
    // Even coverage down the swath (stratified, so seven clouds cannot all
    // clump at one end), a bell across it.
    const a = ((i + rng()) / count) * 2 - 1;
    const b = (rng() + rng() - 1) * NEBULA_ACROSS + NEBULA_LIFT;
    dir
      .copy(NEBULA_AXIS)
      .addScaledVector(along, Math.tan(a * NEBULA_ALONG))
      .addScaledVector(across, Math.tan(b))
      .normalize();
    const r = NEBULA_RADIUS_MIN + rng() * (NEBULA_RADIUS_MAX - NEBULA_RADIUS_MIN);
    // Face inward, then roll about that normal so the shared texture never
    // repeats its silhouette twice in the same orientation.
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      NEBULA_FACE,
      dir.clone().multiplyScalar(-1),
    );
    quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(NEBULA_FACE, rng() * Math.PI * 2),
    );
    out.push({
      key: i,
      position: [dir.x * r, dir.y * r, dir.z * r],
      quaternion,
      scale: NEBULA_SPAN_MIN + rng() * (NEBULA_SPAN_MAX - NEBULA_SPAN_MIN),
      tint: NEBULA_TINTS[i % NEBULA_TINTS.length] ?? '#2a3a56',
      opacity: NEBULA_OPACITY_MIN + rng() * (NEBULA_OPACITY_MAX - NEBULA_OPACITY_MIN),
    });
  }
  return out;
}

type SpaceEnvironmentProps = {
  /** True freezes all continuous motion. The star field is a still by
   *  construction now, so nothing here needs the gate — kept in the signature
   *  because every scene layer takes it and dropping it would make this the
   *  one component a reader has to check. */
  reduced: boolean;
  /** World position of the sun body — the key light must sit inside it. */
  sunPos: Vec3;
  starCount?: number;
};

export function SpaceEnvironment({ sunPos, starCount = 4000 }: SpaceEnvironmentProps) {
  // Read once, branch once — never per frame. `starCount` already arrives
  // pre-scaled from Scene3D; the tier is consulted here only for the nebula
  // population, which is the one thing in this file that costs fill rather
  // than buffer bytes.
  const quality = useQuality();
  const anisotropy = quality.anisotropy;

  // Configure once on load: sRGB because the map is authored for display, and
  // anisotropy because the sphere's poles otherwise smear at grazing angles.
  const sky = useTexture(MILKY_WAY_URL, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
  });

  // Both shells sit on the MIDPOINT of the flight corridor rather than on the
  // world origin. The voyage runs from the origin out to the sun, so halving
  // the sun's z puts the camera no further than ~half the corridor from the
  // centre at either end — the backdrop keeps its clearance at station 01 and
  // at the sun alike, and the deep field no longer runs out from under the
  // finale. Derived from the waypoint contract, so it re-solves itself if the
  // station count ever changes.
  const centre = useMemo<Vec3>(() => [0, 0, sunPos[2] * 0.5], [sunPos]);

  const stars = useMemo(() => buildStars(starCount), [starCount]);
  const starMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uPx: { value: 450 },
          uFade: { value: new THREE.Vector2(STARS_FADE_IN, STARS_FADE_FULL) },
        },
        vertexShader: STARS_VERT,
        fragmentShader: STARS_FRAG,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        vertexColors: true,
      }),
    [],
  );
  useEffect(() => () => starMaterial.dispose(), [starMaterial]);

  // Zero at low, and the zero is real: `buildNebula(0)` returns an empty array,
  // the map below never runs, and `getNebulaTexture()` — the lazy singleton
  // that pays for the canvas — is therefore never called on the floor tier.
  // The gate is the population, not a separate flag, which is why it cannot
  // drift out of agreement with itself.
  const nebula = useMemo(() => buildNebula(quality.nebula), [quality.nebula]);

  // Half the drawing buffer's height in device pixels — the one number the
  // point-size projection needs. Read from React state rather than per frame
  // so it also lands under reduced motion, where the frameloop is "demand"
  // and useFrame does not run.
  const height = useThree((s) => s.size.height);
  const dpr = useThree((s) => s.viewport.dpr);
  const uPx = starMaterial.uniforms['uPx'];
  if (uPx) uPx.value = height * dpr * 0.5;

  return (
    <group>
      {/* Inverted sphere instead of a scene.background cube: it keeps the
          backdrop in world space so the fixed diagonal pose is one rotation,
          and depthWrite off means it can never occlude anything. */}
      <mesh position={centre} rotation={SKY_ROTATION} frustumCulled={false}>
        <sphereGeometry args={[SKY_RADIUS, 64, 32]} />
        <meshBasicMaterial
          map={sky}
          color={SKY_TINT}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>

      {/* Faint dust clouds along a band aimed across the corridor. Frustum
          culling is ON here (unlike the star points): these are the only
          things in this file that can be culled, and they are the only ones
          that cost fill. */}
      <group position={centre}>
        {nebula.map((spec) => (
          <mesh
            key={spec.key}
            geometry={NEBULA_GEOMETRY}
            position={spec.position}
            quaternion={spec.quaternion}
            scale={spec.scale}
          >
            <meshBasicMaterial
              map={getNebulaTexture()}
              color={spec.tint}
              transparent
              opacity={spec.opacity}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              /* Double-sided on purpose. These are flat additive sheets with
                 no lighting and no thickness, so a back face costs nothing —
                 and single-siding them makes the whole layer's visibility
                 hostage to the sign of one quaternion. */
              side={THREE.DoubleSide}
              fog={false}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      <points position={centre} material={starMaterial} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[stars.position, 3]} />
          <bufferAttribute attach="attributes-color" args={[stars.color, 3]} />
          <bufferAttribute attach="attributes-aSize" args={[stars.size, 1]} />
          <bufferAttribute attach="attributes-aHalo" args={[stars.halo, 1]} />
        </bufferGeometry>
      </points>

      <ambientLight color={AMBIENT_COLOR} intensity={AMBIENT_INTENSITY} />
      {/* Decay 0 + distance 0: physically the sun would inverse-square away
          to nothing across 1000 units — theatrically it must light Neptune
          and Earth alike, so falloff is switched off. */}
      <pointLight
        position={sunPos}
        color={SUN_LIGHT_COLOR}
        intensity={SUN_LIGHT_INTENSITY}
        decay={0}
        distance={0}
      />
      <directionalLight position={FILL_FROM} color={FILL_COLOR} intensity={FILL_INTENSITY} />
    </group>
  );
}
