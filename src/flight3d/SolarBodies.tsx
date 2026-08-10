/* ==== SOLAR BODIES ==========================================================
 *
 * Renders every celestial body the voyage contract emits — one component per
 * BodyKind, dispatched off the waypoint. All geometry parameters derive from
 * waypoint.bodyRadius so composition stays owned by src/engine/space.ts, and
 * all scatter is seeded off waypoint.index so the sky never reshuffles under
 * the visitor. Every continuous motion checks `reduced` inside its useFrame
 * so the reduced-motion scene is a perfect still, not a slower animation.
 * ========================================================================= */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vec3, Waypoint } from '../engine';
import { mulberry32 } from '../engine';
import { FILL_FROM, FILL_INTENSITY, SUN_LIGHT_INTENSITY } from './SpaceEnvironment';

export type SolarBodiesProps = {
  waypoints: Waypoint[];
  reduced: boolean;
  /** Landing ramp (0 → 1 over the homecoming leg), written by the Rig each
   *  frame. Earth's atmosphere shell and cloud sphere fade out with it —
   *  the touchdown camera sits almost exactly ON the shell radius, and the
   *  additive rim sliced a bright arc across the landing pad (screenshot
   *  finding). The LandingSite's own sky/clouds take over. */
  landingRef?: { current: number };
};

type BodyProps = { wp: Waypoint; reduced: boolean };
/** Bodies that carry an atmosphere also need to know where the light is. */
type LitBodyProps = BodyProps & { sunPos: Vec3 };

/* ---- tunable constants ---------------------------------------------------
 * Spin rates are rad/s — tuned so every body is unmistakably TURNING within
 * ~10 seconds of watching, without ever reading as a spin-top. (The previous
 * pass was 5x slower and photographed as a still — live-site finding.) */
const EARTH_SPIN = 0.09; // ~70s per revolution — a visible crawl
const CLOUD_COUNTER_SPIN = 0.03; // opposite sign to the globe — sells depth
const SUN_SPIN = 0.03;
const SATURN_SPIN = 0.2;
const ASTEROID_COUNT = 120;
const ASTEROID_DRIFT = 0.02; // collective field rotation — slow, but alive
const ASTEROID_VARIANT_SEEDS = [0xa57e, 0x0f1e, 0x9b0c] as const; // one rubble-pile geometry per seed
/* three's PolyhedronGeometry subdivides each icosa face into (detail+1)²
 * triangles — NOT the recursive 4^detail most references assume — so detail 7
 * is the classic "detail 3" 1280-tri icosphere and detail 3 the 320-tri one.
 * Three variants shared across ~120 instances keeps that budget trivial. */
const ASTEROID_DETAIL_BOULDER = 7; // 1280 tris / 642 welded verts — the hero boulders
const ASTEROID_DETAIL_SMALL = 3; // 320 tris / 162 welded verts — the two smaller variants
/* Multi-octave value noise over the sphere direction — irregular multi-scale
 * lumps (Itokawa/Bennu silhouettes), not gravel facets. */
const ASTEROID_NOISE_OCTAVES = 3;
const ASTEROID_NOISE_FREQ = 2.3; // base lattice frequency across the unit sphere
const ASTEROID_NOISE_LACUNARITY = 2.1;
const ASTEROID_NOISE_GAIN = 0.5;
const ASTEROID_NOISE_AMP = 0.22; // displacement, × unit radius
/* Seeded crater dents: smooth radial depressions with a raised rim annulus —
 * inward across the bowl, slightly outward at the lip. */
const ASTEROID_CRATER_MIN = 5; // craters per variant, seeded in [MIN, MAX]
const ASTEROID_CRATER_MAX = 7;
const ASTEROID_CRATER_RADIUS_MIN = 0.35; // rad — angular reach
const ASTEROID_CRATER_RADIUS_MAX = 0.7;
const ASTEROID_CRATER_DEPTH_MIN = 0.08; // inward push at the bowl centre
const ASTEROID_CRATER_DEPTH_MAX = 0.2;
const ASTEROID_CRATER_RIM = 0.35; // rim lift, × that crater's depth
/* Vertex-color AO + albedo: baked crevice shadow and regolith patchiness. */
const ASTEROID_AO_DARKEN = 0.45; // crevice/crater floors darken up to 45%
const ASTEROID_RIM_LIGHT = 0.08; // crater rims catch ~8% extra light
const ASTEROID_PATCH_FREQ = 1.3; // low-frequency warm/cool albedo field
const ASTEROID_PATCH_AMOUNT = 0.1; // ±10%
const ASTEROID_BOULDER_MIN = 1.5; // base scales above this get the high-detail variant
const ASTEROID_CLUMP_COUNT = 5; // seeded clump centres inside the belt
const ASTEROID_CLUMP_CHANCE = 0.72; // rocks that gather at a clump vs. loose belt scatter
const ASTEROID_CLUMP_SPREAD = 0.2; // clump scatter radius, × field radius
const ASTEROID_BELT_Y = 0.22; // vertical spread, × lateral spread — a belt, not a swarm
// Cool slate greys with a faint blue cast — real asteroid photography, not
// umber. The warm-brown pass read as, in the user's exact words, "pieces of
// shit"; browns are banned from the belt.
const ASTEROID_BASE_COLOR = '#5d6167'; // palette centre — slate grey
const ASTEROID_PALETTE = ['#4e5257', '#565a60', '#5d6167', '#6a6e74', '#71767c', '#454950'] as const;
const ASTEROID_DUST_COUNT = 140;
const ASTEROID_DUST_COLOR = '#8b929c';
const ASTEROID_DUST_SIZE = 0.5;
const ASTEROID_DUST_OPACITY = 0.18;
/* ---- nebula (the FIREFIGHT backdrop) --------------------------------------
 * Rebuilt as a layered emission nebula. The old field was 40 uniform ember
 * sprites at one tint, which photographed as a scatter of flat discs — the
 * user's word was "bad". The fix is three things at once: many more, much
 * LARGER, much FAINTER billboards on soft turbulent textures (so the gas
 * accumulates instead of tiling), a colour gradient from a hot ember heart out
 * to cool violet at the edges, and a sprinkle of tiny hard embers that read as
 * newly-lit stars inside the cloud.
 *
 * The whole field is exactly THREE draw calls: two instanced billboard layers
 * (far/near, drifting at different rates for parallax) plus one Points cloud.
 * Instancing is what makes 160 puffs cheaper than the old 40 sprites — sprites
 * cost one draw each. */
const NEBULA_TILES = 3; // texture variants packed side-by-side in one atlas
const NEBULA_TEX_SEEDS = [0x51a3, 0x9d40, 0x2ee7] as const;
const NEBULA_EMBER_COUNT = 220;
const NEBULA_EMBER_SIZE = 0.9;
// Gas knots. A purely radial scatter of soft cards averages out to a perfect
// gaussian ball — the first build of this field photographed as exactly that,
// a smooth red blob. Gathering most cards around a handful of seeded knots is
// what gives the cloud filaments and hollows, the same trick the asteroid belt
// above uses for its clumps.
const NEBULA_KNOTS = 6;
const NEBULA_KNOT_CHANCE = 0.7;
const NEBULA_KNOT_SPREAD = 0.3; // × field radius
// Master brightness. Additive cards accumulate, and this field overlaps ~40
// deep at the core, so per-card contributions live in the low hundredths;
// anything brighter clips the red channel and the whole gradient collapses to
// flat vermilion (which is exactly what the first build did).
const NEBULA_GAIN = 1.6;
// Layer drift rates, rad/s and world units — an order of magnitude slower than
// the old per-puff orbits. Two layers moving at different rates in opposite
// directions is what sells depth; a single field rotating reads as a decal.
const NEBULA_FAR_SPIN = 0.0055;
const NEBULA_NEAR_SPIN = 0.0105;
const NEBULA_FAR_SWAY: readonly [number, number, number, number] = [1.2, 0.017, 1.7, 0.021];
const NEBULA_NEAR_SWAY: readonly [number, number, number, number] = [2.2, 0.026, 2.6, 0.031];
// The gradient. Hot ember core, rust mid-field, cool dark violet at the rim.
const NEBULA_CORE = '#ff7a3c';
const NEBULA_MID = '#b4432a';
const NEBULA_EDGE = '#3a2350';
const NEBULA_EMBER_HOT = '#fff2e2';
// In LINEAR light the palette spans a ~14:1 luminance range — the ember core
// is vastly brighter than the violet rim — so a flat per-card opacity renders
// the outer gas literally invisible and the field reads as one orange ball.
// Dividing by luminance^0.75 (normalised to the core) restores the cool hue's
// PRESENCE while still leaving the rim dimmer than the heart, which is the
// falloff a real emission nebula has.
const NEBULA_TINT_EXP = 0.75;
// Where the gradient's stops land along normalised field radius. The ember
// zone is deliberately small: give it half the field and the violet never
// gets enough real estate to register as a colour at all.
const NEBULA_CORE_STOP = 0.4;
const CLUSTER_POINT_COUNT = 300;
const RING_TILT = 0.45;
const NAV_LIGHT_STEADY = 1.4; // emissive intensity when reduced (never pulses)
const OUTPOST_TRACK_YAW = 0.02; // rad/s — solar panels crawling sunward
/* ---- the outpost (BodyKind 'outpost') — an ISS-class station ---------------
 * The SILHOUETTE is the whole job. The International Space Station is
 * unmistakable for three reasons, in this order: a long lattice TRUSS spine,
 * an enormous area of solar array hung off its ends as four coplanar wings,
 * and a knot of white cylinders slung under the middle at right angles to the
 * spine. Everything below serves that read, and EVERY dimension stays a
 * fraction of wp.bodyRadius so the waypoint contract still owns the size.
 *
 * Local frame: +X runs the truss, ±Z is the extension axis shared by the array
 * wings and the pressurised stack, +Y is the array normal (zenith).
 *
 * Cost is held to ELEVEN draw calls — one instanced lattice bay for the entire
 * spine, four merged static buffers (hull / foil / alloy / dark), and six small
 * instanced sets (seams, handrails, wings, radiators, dishes, beacons). The
 * previous relay bird spent ~25 meshes on a fraction of this detail. */
const ISS = {
  /* truss: ONE bay geometry, instanced `bays` times along ±X */
  bays: 9,
  bayLen: 0.34, // × r, one lattice bay
  trussR: 0.115, // × r, half-width of the square lattice section
  memberT: 0.017, // × r, longeron / batten stock
  /* solar array wings: four, in symmetric coplanar pairs, deliberately BIG —
   * the ISS reads as "mostly solar array" and anything smaller loses it */
  jointX: 1.18, // × r, rotary-joint station along the truss
  wingLen: 1.34, // × r, root to tip along ±Z
  wingW: 0.56, // × r, across the wing
  wingT: 0.014, // × r
  wingRoot: 0.13, // × r, truss centreline to wing root
  wingSegs: 4, // cell-map repeats along the LENGTH — one blanket bay each
  sarjR: 0.1, // × r, solar alpha rotary joint barrel
  sarjL: 0.26, // × r
  betaR: 0.048, // × r, beta gimbal barrel at each wing root
  mastT: 0.026, // × r, folding mast down each wing's spine
  /* pressurised modules, slung under the truss and crosswise to it */
  modY: -0.4, // × r, stack centreline below the truss
  modR: 0.15, // × r
  labLen: 0.6, // × r
  hubLen: 0.34, // × r
  aftLen: 0.68, // × r
  fwdLen: 0.28, // × r, forward node
  sideR: 0.11, // × r, crosswise lab
  sideLen: 0.54, // × r
  sideX: 0.4, // × r, crosswise lab offset from the stack
  cupolaR: 0.08, // × r
  cupolaH: 0.075, // × r
  railT: 0.013, // × r, handrail stock
  seamT: 0.014, // × r, ring-seam tube
  /* thermal radiators: a FAN of narrow slats per side, not one broad sheet.
   * A single wide white rectangle merges with the modules at distance (it read
   * as a sail growing out of the stack in the first pass); parallel slats with
   * gaps between them are unmistakably a radiator, and tilting them out of the
   * array plane keeps them from reading as a fifth solar wing. */
  radSlats: 3,
  radLen: 0.72, // × r
  radW: 0.15, // × r, one slat
  radT: 0.013, // × r
  radX: 0.8, // × r, fan centre along the truss
  radGap: 0.17, // × r, slat pitch
  radTilt: 1.05, // rad below the array plane
  /* antennas and the docked visiting vehicle */
  dishR: 0.21, // × r
  dishDepth: 0.095, // × r
  capR: 0.105, // × r
  capLen: 0.34, // × r
  beaconR: 0.026, // × r
} as const;
const SAT_MLI_SEED = 0x4d11;
// A crewed station does not tumble — it holds attitude. The old two-axis
// accumulating spin read as a dead hulk (and swung the arrays away from the
// sun), so it is replaced by a shallow non-accumulating wander: the deadband
// of a live attitude-control system.
const SAT_WANDER_AMP = 0.045; // rad
const SAT_WANDER_RATE = 0.12; // rad/s
// Presentation pose. The x tilt is load-bearing: the array normal is local +Y,
// so a near-level station shows the visitor four wings EDGE-ON — a station made
// of pencils. Tipping the whole stack ~41° presents the blankets broadside at
// every phase of the tracking yaw while keeping the truss reading as a spine
// across the frame.
const SAT_POSE: readonly [number, number, number] = [-0.72, 0.6, 0.16];
/* ---- the sun's local drama light ------------------------------------------
 * This pointLight exists to set the SHIP on fire as it grazes the finale. It
 * was intensity 600 with decay 0 and a 8×radius window — which is to say no
 * meaningful falloff at all, so it also poured ~490 units of irradiance onto
 * the outpost a whole station away and blew the relay to flat white (live
 * screenshot). The scene's own rig totals ~4; nothing here should ever be two
 * orders of magnitude over it.
 *
 * The fix is honest falloff: decay 2 (inverse-square, so the pool INTENSIFIES
 * as the ship dives at the sun instead of sitting on a plateau) plus a finite
 * cutoff that reaches exactly zero inside the ~115-unit gap to the neighbouring
 * waypoint. Intensity is then DERIVED from the irradiance we want at the ship's
 * framing distance, so the drama at the sun dock is a stated number rather than
 * a magic one. */
export const SUN_LIGHT_COLOR = '#ffd9a0';
export const SUN_LIGHT_DECAY = 2;
const SUN_LIGHT_REF_D = 2.6; // × bodyRadius (≈68u) — where the ship sits at the sun dock
const SUN_LIGHT_AT_REF = 30; // irradiance delivered there: ~7× the base rig — hot, not clipped flat
export const SUN_LIGHT_CUTOFF = 4.2; // × bodyRadius (≈109u) — hard zero, well short of STN 09 at ~115u
export const SUN_LIGHT_PULSE = 0.12; // ± fraction, split across two detuned sines
const CORONA_BREATHE = 0.04; // ± scale fraction on the corona sprites
const CORONA_ROT = 0.01; // rad/s outer corona drift; inner counter-rotates
/* ---- the sun's photosphere and corona --------------------------------------
 * The finale was a textured sphere with the emissive channel turned up and two
 * gaussian halos over it, and the screenshots said so: a flat pancake, edge as
 * bright as the middle, sitting in a frame-wide brown haze that lifted the
 * black out of the whole shot and took the in-scene label plates with it.
 *
 * Two fixes, and they are the same fix seen from either end.
 *
 * LIMB DARKENING. A star is a ball of gas, and a sightline at its edge passes
 * through a longer, cooler column than one at its centre — so the disc falls
 * off toward the rim and reddens as it goes. That is the entire difference
 * between "sphere" and "sticker", and it costs one dot product. It also does
 * the contrast work for free: the darkened limb drops under the bloom pass's
 * luminance threshold, so the halo stops swelling off the edge of the disc and
 * the silhouette becomes crisp.
 *
 * A CORONA WITH STRUCTURE. The old halo was a radial gradient with a long
 * shallow tail — the shape that, spread over a sprite two body-radii wide,
 * paints the sky beige. The replacement is drawn to a real profile: an
 * exponential aureole hugging the limb (the light that appears to bend around
 * the edge) plus seeded radial streamers reaching much further out at a
 * fraction of the brightness. Same two sprites, same draw calls, no shipped
 * bytes — and the sky between the streamers goes back to black. */
const SUN_LIMB_DARKEN = 0.58; // Eddington-ish; 0 is a flat disc, 1 a black rim
const SUN_GAIN = 2.3; // disc-centre emission — above the bloom threshold on purpose
const SUN_CELL_CONTRAST = 1.12; // granulation expansion about the map's mid grey
/* Both are MULTIPLIERS over the map, not replacements for it: white leaves
 * the photosphere its own colour at disc centre, and the limb value is the
 * reddening a longer sightline through the gas actually does to it. */
const SUN_CORE = '#fffdf4';
const SUN_LIMB = '#ff8c3c';
/* Sprite reach, in body radii from the centre. The sprite's SCALE is twice
 * this, since three sizes sprites by full width. */
const CORONA_REACH = 2.3; // streamers
const AUREOLE_REACH = 1.34; // the hot ring on the limb
const CORONA_STREAMERS = 9;
const CORONA_SEED = 0x50143;

/* Bump relief per textured body — the surface map doubles as its own bump
 * map, which is cheap and honest for these albedos. three r150+ treats
 * bumpScale in world-ish units at these radii, so TUNE BY EYE. */
const BUMP = {
  earth: 0.15,
  moon: 0.5,
  mars: 0.4,
  jupiter: 0.1,
  neptune: 0.1,
  saturn: 0.1,
} as const;

const TEX = {
  earthDay: '/textures/4k_earth_daymap.webp',
  earthNight: '/textures/4k_earth_nightmap.webp',
  earthClouds: '/textures/4k_earth_clouds.webp',
  saturn: '/textures/2k_saturn.webp',
  saturnRing: '/textures/2k_saturn_ring_alpha.png',
  sun: '/textures/4k_sun.webp',
} as const;

/* Hoisted scratch objects — useFrame and the instancing loops must never
 * allocate, so every temp lives at module scope and is reused. */
const scratchObj = new THREE.Object3D();
const scratchCol = new THREE.Color();
const CLUSTER_WHITE = new THREE.Color('#ffffff');
const CLUSTER_WARM = new THREE.Color('#ffc9a0');

/* ---- three's point-light falloff, evaluated on the CPU --------------------
 * getDistanceAttenuation() in the shader is
 *   1/max(d^decay, 0.01) × pow2(saturate(1 − pow4(d / cutoff)))
 * — an inverse-square term times a window that drives the whole light to zero
 * at the cutoff. Mirroring it here lets the sun state its drama as "this much
 * irradiance at this distance" and solve for intensity, instead of shipping a
 * hand-tuned magic number that nobody can check. */
function pointLightAttenuation(d: number, cutoff: number, decay: number): number {
  const w = Math.max(0, 1 - (d / cutoff) ** 4);
  return (w * w) / Math.max(d ** decay, 0.01);
}

/** Intensity that lands SUN_LIGHT_AT_REF of irradiance on the ship at the sun
 *  dock. Both distances scale with the body radius, so the finale looks the
 *  same whatever radius the voyage contract hands over. */
export function sunLightIntensity(radius: number): number {
  const d = SUN_LIGHT_REF_D * radius;
  return SUN_LIGHT_AT_REF / pointLightAttenuation(d, SUN_LIGHT_CUTOFF * radius, SUN_LIGHT_DECAY);
}

/* ---- merge helpers (station construction, run once per mount) -------------
 * Same technique Rocket3D uses for the shuttle: bake each primitive's
 * transform into its vertices and collapse the batch into ONE buffer, so a
 * station assembled from seventy boxes still costs a handful of draw calls.
 * mergeGeometries refuses a mixed indexed/non-indexed batch, so everything is
 * normalised on the way in. Sources are disposed as they are consumed — they
 * exist only to feed the merge and never reach the GPU. */
const _bakeV = new THREE.Vector3();
const _bakeQ = new THREE.Quaternion();
const _bakeE = new THREE.Euler();
const _bakeS = new THREE.Vector3();

function bakeTrs(
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
    _bakeV.set(px, py, pz),
    _bakeQ.setFromEuler(_bakeE.set(rx, ry, rz)),
    _bakeS.set(sx, sy, sz),
  );
}

function bakePart(
  out: THREE.BufferGeometry[],
  geo: THREE.BufferGeometry,
  m?: THREE.Matrix4,
): void {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (m) g.applyMatrix4(m);
  geo.dispose();
  out.push(g);
}

function bakeMerge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged: THREE.BufferGeometry | null = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged ?? new THREE.BufferGeometry();
}

/* One instanced placement. All three channels are required rather than
 * optional: exactOptionalPropertyTypes makes half-filled literals a chore, and
 * every call site here knows exactly what it is placing. */
type Placement = {
  p: readonly [number, number, number];
  r: readonly [number, number, number];
  s: readonly [number, number, number];
};

function place(
  px: number,
  py: number,
  pz: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): Placement {
  return { p: [px, py, pz], r: [rx, ry, rz], s: [sx, sy, sz] };
}

/** Write a placement list into an InstancedMesh. Runs in a layout effect, not
 *  per frame, so the shared scratch Object3D is safe to reuse. */
function applyPlacements(mesh: THREE.InstancedMesh | null, list: readonly Placement[]): void {
  if (!mesh) return;
  let i = 0;
  for (const it of list) {
    scratchObj.position.set(it.p[0], it.p[1], it.p[2]);
    scratchObj.rotation.set(it.r[0], it.r[1], it.r[2]);
    scratchObj.scale.set(it.s[0], it.s[1], it.s[2]);
    scratchObj.updateMatrix();
    mesh.setMatrixAt(i++, scratchObj.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/* ---- shared texture prep -------------------------------------------------
 * The drei loader caches one texture per url, so mutating during render is
 * idempotent and every consumer wants the same setup. Doing it before the
 * first GPU upload also avoids a needsUpdate re-upload on the 4k maps. */
function useSurfaceTexture(url: string, srgb = true): THREE.Texture {
  const tex = useTexture(url);
  const want = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (tex.anisotropy !== 8 || tex.colorSpace !== want) {
    tex.anisotropy = 8;
    tex.colorSpace = want;
    tex.needsUpdate = true;
  }
  return tex;
}

/* ---- generated billboard textures ----------------------------------------
 * Radial gradients drawn ONCE on a canvas and cached at module level — forty
 * nebula sprites sharing one 128px texture costs almost nothing, and canvas
 * output is deterministic so the cache never changes the look between visits. */
function makeRadialTexture(stops: ReadonlyArray<readonly [number, string]>): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  // The 2d context only fails in contexts that could not render WebGL either.
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* The ember puff that used to live here — a soft #ff5c37 gradient with a long
 * shallow tail — was the sun's outer corona, and the tail is precisely what
 * painted the finale's sky beige. The corona now draws its own profile (see
 * coronaTexture), and the nebula has always had its own atlas, so nothing is
 * left that wants a gradient shaped like that. */

let glowTexCache: THREE.CanvasTexture | null = null;
/** Neutral warm-white glow for star haze — warm enough to sit near the ember
 *  palette without stealing the accent. */
function glowTexture(): THREE.CanvasTexture {
  glowTexCache ??= makeRadialTexture([
    [0, 'rgba(255,255,255,0.9)'],
    [0.35, 'rgba(255,214,170,0.35)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  return glowTexCache;
}

/* ---- spacecraft surface maps ---------------------------------------------
 * Two canvas textures painted ONCE at module level and shared by every
 * satellite in the scene. Both are seeded through mulberry32 so the craft is
 * pixel-identical on every visit, and both double as their own bumpMap — the
 * cheapest possible way to get crinkle relief and cell relief with no shipped
 * assets. 256px is power-of-two, so mipmapping and RepeatWrapping both work. */

let mliTexCache: THREE.CanvasTexture | null = null;
/** Gold multi-layer insulation. An amber base under a few hundred seeded
 *  facets that alternately catch light and fold into shadow, bright crease
 *  hairlines, and aluminised tape bands with stitch ticks. This one texture is
 *  most of what separates "spacecraft" from "painted crate". */
function mliTexture(): THREE.CanvasTexture {
  if (mliTexCache) return mliTexCache;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const rand = mulberry32(SAT_MLI_SEED);

  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, '#c98f27');
  base.addColorStop(0.4, '#ffce6b');
  base.addColorStop(0.72, '#e2a63c');
  base.addColorStop(1, '#a97b22');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Crinkle facets: irregular polygons, half of them catching a highlight and
  // half dropping into a fold shadow. Vacuum-deposited foil is never flat.
  // FEWER and LARGER than the first pass: the bus is only ~2 world units, so
  // fine facets averaged into a muddy brown smear instead of reading as gold.
  for (let i = 0; i < 130; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const rr = size * (0.07 + rand() * 0.16);
    const sides = 3 + Math.floor(rand() * 3);
    ctx.beginPath();
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2 + rand() * 0.8;
      const d = rr * (0.4 + rand() * 0.8);
      const px = cx + Math.cos(a) * d;
      const py = cy + Math.sin(a) * d;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    // Highlights outnumber shadows 2:1 — foil scatters far more light than it
    // swallows, and an even split reads as dirt rather than metal.
    ctx.fillStyle =
      rand() > 0.34
        ? `rgba(255,241,196,${0.1 + rand() * 0.26})`
        : `rgba(96,58,6,${0.06 + rand() * 0.16})`;
    ctx.fill();
  }

  // Creases: the hairlines where the blanket actually folds.
  ctx.lineCap = 'round';
  for (let i = 0; i < 120; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI * 2;
    const len = size * (0.08 + rand() * 0.28);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.strokeStyle = rand() > 0.4 ? 'rgba(255,250,226,0.44)' : 'rgba(84,52,6,0.32)';
    ctx.lineWidth = 0.8 + rand() * 2.2;
    ctx.stroke();
  }

  // Aluminised tape bands pinning the blanket down — bright silver, so the
  // bus gets horizontal structure instead of reading as a plain slab.
  for (let b = 0; b < 3; b++) {
    const y = size * (0.16 + b * 0.31 + rand() * 0.05);
    const h = size * 0.045;
    ctx.fillStyle = 'rgba(238,238,230,0.5)';
    ctx.fillRect(0, y, size, h);
    ctx.fillStyle = 'rgba(52,36,8,0.42)';
    ctx.fillRect(0, y + h, size, 2);
    for (let s = 0; s < 26; s++) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect((s / 26) * size + 2, y + h * 0.35, 3, h * 0.3);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  mliTexCache = tex;
  return tex;
}

let cellTexCache: THREE.CanvasTexture | null = null;
/** Solar array face: dark blue-violet PV cells on a thin silver grid, two
 *  busbar ribbons per cell, and a hard dark seam down each tile edge. The
 *  wings repeat this ISS.wingSegs times along their length, so the seams read
 *  as the hinge lines between deployed blanket bays. */
function solarCellTexture(): THREE.CanvasTexture {
  if (cellTexCache) return cellTexCache;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  ctx.fillStyle = '#12162e';
  ctx.fillRect(0, 0, size, size);

  const cols = 6;
  const rows = 4;
  const cw = size / cols;
  const ch = size / rows;
  const pad = 2.5;
  for (let cx = 0; cx < cols; cx++) {
    for (let cy = 0; cy < rows; cy++) {
      const x = cx * cw + pad;
      const y = cy * ch + pad;
      const w = cw - pad * 2;
      const h = ch - pad * 2;
      // Diagonal gradient per cell: silicon wafers are directional, so the
      // grid glints unevenly as the array tracks instead of reading as paint.
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#3b4189');
      g.addColorStop(0.45, '#242a63');
      g.addColorStop(1, '#161b42');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(196,206,222,0.45)';
      ctx.fillRect(x + w * 0.3, y, 1.2, h);
      ctx.fillRect(x + w * 0.7, y, 1.2, h);
    }
  }

  // The interconnect grid between cells.
  ctx.strokeStyle = 'rgba(172,184,202,0.4)';
  ctx.lineWidth = 1;
  for (let cx = 0; cx <= cols; cx++) {
    ctx.beginPath();
    ctx.moveTo(cx * cw, 0);
    ctx.lineTo(cx * cw, size);
    ctx.stroke();
  }
  for (let cy = 0; cy <= rows; cy++) {
    ctx.beginPath();
    ctx.moveTo(0, cy * ch);
    ctx.lineTo(size, cy * ch);
    ctx.stroke();
  }

  // Panel seam: a dark gap with a bright structural edge on each side, so a
  // repeat lands hinge-to-hinge rather than smearing the grid.
  ctx.fillStyle = 'rgba(8,10,22,0.92)';
  ctx.fillRect(0, 0, 3.5, size);
  ctx.fillRect(size - 3.5, 0, 3.5, size);
  ctx.fillStyle = 'rgba(158,168,186,0.4)';
  ctx.fillRect(3.5, 0, 1.5, size);
  ctx.fillRect(size - 5, 0, 1.5, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // Repeat runs along V, not U: a BoxGeometry's ±Y faces map U across the
  // wing's WIDTH and V along its LENGTH, and the blanket bays of an ISS wing
  // step down its length.
  tex.repeat.set(1, ISS.wingSegs); // the wings are this map's only consumer
  tex.anisotropy = 8;
  cellTexCache = tex;
  return tex;
}

/* ---- the corona pair ------------------------------------------------------
 * Both are painted per pixel because the profile that matters here — a hard
 * exponential off the limb, not a gaussian — is exactly what a canvas radial
 * gradient cannot express, and the shallow tail of a gradient is what washed
 * the old finale beige. All randomness is precomputed OUTSIDE the pixel loop,
 * so this stays a few hundred thousand cheap flops at load and never calls
 * the PRNG per pixel (the same discipline the nebula atlas records). */

/** Shared painter: `profile(x, angle)` returns alpha at x body-radii out. */
function paintCorona(
  reach: number,
  profile: (x: number, ang: number) => number,
  ramp: ReadonlyArray<readonly [number, readonly [number, number, number]]>,
): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const c = size / 2;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = (px + 0.5 - c) / c;
      const dy = (py + 0.5 - c) / c;
      const u = Math.sqrt(dx * dx + dy * dy);
      const i = (py * size + px) * 4;
      if (u >= 1) continue; // ImageData starts zeroed — outside is already clear
      // Feather the sprite's own circular edge to nothing, or the quad's
      // corners cut a visible disc out of the sky.
      const edge = smooth01(1, 0.84, u);
      const a = profile(u * reach, Math.atan2(dy, dx)) * edge;
      if (a <= 0.002) continue;
      // Colour by distance, not by alpha: the aureole is near-white and the
      // far streamers are ember, and interpolating in between is what keeps
      // the corona from reading as one flat tint.
      const x = u * reach;
      let lo = ramp[0] as readonly [number, readonly [number, number, number]];
      let hi = lo;
      for (let k = 1; k < ramp.length; k++) {
        const stop = ramp[k] as readonly [number, readonly [number, number, number]];
        if (stop[0] >= x) {
          hi = stop;
          break;
        }
        lo = stop;
        hi = stop;
      }
      const span = hi[0] - lo[0];
      const t = span > 1e-4 ? Math.min(1, Math.max(0, (x - lo[0]) / span)) : 0;
      data[i] = lo[1][0] + (hi[1][0] - lo[1][0]) * t;
      data[i + 1] = lo[1][1] + (hi[1][1] - lo[1][1]) * t;
      data[i + 2] = lo[1][2] + (hi[1][2] - lo[1][2]) * t;
      data[i + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let coronaTexCache: THREE.CanvasTexture | null = null;
/** The outer corona: a short bright body off the limb plus seeded streamers
 *  that carry structure out to CORONA_REACH at a fraction of the brightness.
 *  Nine lobes of varying width and weight, which is enough for the eye to
 *  read "plasma following a field" and few enough that the counter-rotating
 *  pair never turns into moiré. */
function coronaTexture(): THREE.CanvasTexture {
  if (coronaTexCache) return coronaTexCache;
  const rand = mulberry32(CORONA_SEED);
  const lobes = Array.from({ length: CORONA_STREAMERS }, (_, k) => ({
    // Evenly spaced then jittered: a purely random set clumps, and a clump of
    // streamers reads as one lopsided smear.
    ang: (k / CORONA_STREAMERS) * Math.PI * 2 + (rand() - 0.5) * 0.5,
    // NARROW, and that is the whole point: a first pass at half a radian
    // apiece overlapped its neighbours into a perfectly smooth ring, which
    // is the beige donut this work exists to get rid of. At a tenth of a
    // radian the gaps between them stay black.
    width: 0.05 + rand() * 0.1,
    weight: 0.5 + rand() * 0.5,
  }));
  coronaTexCache = paintCorona(
    CORONA_REACH,
    (x, ang) => {
      if (x < 0.94) return 0;
      const h = x - 1;
      let s = 0;
      for (const l of lobes) {
        let d = ang - l.ang;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        s += l.weight * Math.exp((-d * d) / (2 * l.width * l.width));
      }
      // Aureole first, streamers second, and the streamer term is the only
      // one with a long tail — so what survives past ~1.4 radii is structure
      // rather than haze. Subtracting a floor off the lobe sum is what stops
      // nine overlapping tails from adding back up into a ring.
      const plume = Math.max(0, s - 0.12);
      return Math.min(1, Math.exp(-h / 0.19) * 0.85 + Math.exp(-h / 0.8) * 0.34 * Math.min(1.5, plume));
    },
    [
      [0.94, [255, 244, 216]],
      [1.15, [255, 190, 108]],
      [1.6, [235, 108, 46]],
      [2.3, [128, 44, 20]],
    ],
  );
  return coronaTexCache;
}

let aureoleTexCache: THREE.CanvasTexture | null = null;
/** The inner ring: a very tight, very hot band sitting on the silhouette.
 *  This is the "light bending around the edge" read, and it is also what
 *  replaces the brightness the limb darkening just took off the disc — the
 *  sun ends up hotter at the rim than before, over a much smaller area. */
function aureoleTexture(): THREE.CanvasTexture {
  if (aureoleTexCache) return aureoleTexCache;
  aureoleTexCache = paintCorona(
    AUREOLE_REACH,
    (x) => (x < 0.9 ? 0 : Math.exp(-(x - 0.98) / 0.1)),
    [
      [0.9, [255, 250, 233]],
      [1.08, [255, 214, 143]],
      [1.34, [255, 150, 72]],
    ],
  );
  return aureoleTexCache;
}

let nebulaAtlasCache: THREE.CanvasTexture | null = null;
/** Three soft turbulent gas blobs packed side by side in one 384x128 atlas —
 *  one texture, so the whole billboard layer stays a single draw call.
 *
 *  Each tile is an fbm SILHOUETTE built out of stacked seeded radial gradients
 *  (4 octaves, 3→26 lumps at descending radii) rather than per-pixel noise:
 *  visually equivalent, and ~50k per-pixel mulberry32 calls cheaper on load.
 *  A `destination-in` radial mask then drives every tile to zero alpha well
 *  inside its border — that is what kills the hard-edged disc look, and it
 *  also means atlas bleed between tiles is a non-issue. Alpha only; all colour
 *  comes from the per-instance tint. */
function nebulaAtlas(): THREE.CanvasTexture {
  if (nebulaAtlasCache) return nebulaAtlasCache;
  const tile = 128;
  const canvas = document.createElement('canvas');
  canvas.width = tile * NEBULA_TILES;
  canvas.height = tile;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const octaves = [
    { n: 3, r: 0.42, a: 0.3, off: 0.22 },
    { n: 8, r: 0.24, a: 0.26, off: 0.3 },
    { n: 16, r: 0.13, a: 0.2, off: 0.34 },
    { n: 30, r: 0.07, a: 0.15, off: 0.36 },
  ] as const;

  for (let v = 0; v < NEBULA_TILES; v++) {
    const ox = v * tile;
    const rand = mulberry32(NEBULA_TEX_SEEDS[v] ?? 0x51a3);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, 0, tile, tile);
    ctx.clip();
    for (const oct of octaves) {
      for (let i = 0; i < oct.n; i++) {
        const ang = rand() * Math.PI * 2;
        // Finer octaves reach further out, so the blob gains ragged edges
        // instead of settling into a centre-weighted gaussian.
        const rad = Math.sqrt(rand()) * tile * oct.off;
        const cx = ox + tile / 2 + Math.cos(ang) * rad;
        const cy = tile / 2 + Math.sin(ang) * rad;
        const rr = tile * oct.r * (0.6 + rand() * 0.8);
        const a = oct.a * (0.55 + rand() * 0.7);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(0.42, `rgba(255,255,255,${a * 0.42})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(ox, 0, tile, tile);
      }
    }
    // Global falloff — clipped, so it only touches this tile.
    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createRadialGradient(ox + tile / 2, tile / 2, 0, ox + tile / 2, tile / 2, tile * 0.5);
    mask.addColorStop(0, 'rgba(255,255,255,1)');
    mask.addColorStop(0.34, 'rgba(255,255,255,0.96)');
    mask.addColorStop(0.66, 'rgba(255,255,255,0.5)');
    mask.addColorStop(0.87, 'rgba(255,255,255,0.1)');
    mask.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = mask;
    ctx.fillRect(ox, 0, tile, tile);
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  // Alpha channel only — no colour is sampled, so no colour management.
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // No mip chain. Three tiles share one 384x128 image, so the coarse mips
  // average them into each other — a card seen small (the field is visible
  // from neighbouring waypoints) would sample a flat blend of all three and
  // render as a uniform rectangle. The content is soft and low-contrast, so
  // dropping mips costs nothing in aliasing.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  nebulaAtlasCache = tex;
  return tex;
}

/* ==== ATMOSPHERE — the limb glow that makes a sphere read as a world ========
 *
 * Still one additive BackSide shell and one draw call, but the glow is now
 * shaped by the two things a real limb is shaped by, because the previous
 * fresnel model got both of them backwards and photographed as an outline
 * stroke rather than as air (live screenshots of Mars and Neptune):
 *
 *   ALTITUDE. A fresnel term peaks where the SHELL is tangent to the eye —
 *   i.e. at the outer edge of the glow — and falls to ~36% of that at the
 *   planet's own silhouette. So the band was dimmest against the planet,
 *   brightest in the void, and then cut off hard at the shell's rim: a ring
 *   standing off the planet with a visible gap under it. Real air is DENSEST
 *   at the surface and thins away exponentially. So the shader recovers the
 *   ray's impact parameter — its closest approach to the body centre — and
 *   drives density off altitude above the limb instead, peaking against the
 *   surface and dying out well inside the shell so there is no outer edge to
 *   see at all.
 *
 *   THE SUN. The old shell glowed identically all the way round, including
 *   across the unlit crescent, which is exactly where the eye reads it as a
 *   drawn outline. Modulating by the limb's own angle to the key light gives
 *   a bright arc on the day side falling to a whisper of airglow on the night
 *   side — and, at the crossing, a warm terminator band, which is the
 *   sunrise line you know from every photograph taken from orbit.
 *
 * Both are a handful of ALU on a thin annulus, no new geometry, and every
 * instance still compiles to the SAME program because the source is shared. */

const ATMOS_VERT = `
varying vec3 vWorld;
varying vec3 vCentre;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  // modelMatrix's translation IS the body centre: every Atmosphere is a
  // direct child of the group parked at waypoint.bodyPos, so the centre
  // needs no uniform of its own and can never drift out of sync with it.
  // (three declares modelMatrix in the vertex prefix only, hence the varying
  // rather than reading it again in the fragment stage.)
  vCentre = modelMatrix[3].xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const ATMOS_FRAG = `
uniform vec3 uColor;
uniform vec3 uWarm;
uniform vec3 uLight;
uniform float uIntensity;
uniform float uDusk;
uniform float uFade;
uniform float uInner;
uniform float uOuter;
varying vec3 vWorld;
varying vec3 vCentre;
void main() {
  vec3 view = normalize(cameraPosition - vWorld);
  vec3 d = vWorld - vCentre;
  // Impact parameter: how far this ray passes from the body centre. On a
  // sphere's silhouette that is exactly the sphere's radius, which is what
  // makes the altitude below an honest number rather than a fudge.
  vec3 perp = d - dot(d, view) * view;
  float b = length(perp);
  float alt = (b - uInner) / max(uOuter - uInner, 1e-4);

  // Exponential thinning with height, ramped in across the planet's own limb
  // so the shell can never paint a disc over the globe if depth sorting ever
  // puts it in front.
  float density = exp(-max(alt, 0.0) * 3.4) * smoothstep(-0.05, 0.06, alt);

  // Which way this piece of limb faces relative to the key light.
  float ndl = dot(perp / max(b, 1e-4), uLight);
  float day = smoothstep(-0.28, 0.34, ndl);
  // The terminator band: a narrow lobe either side of the crossing, where a
  // real atmosphere is both thickest along the ray and reddened by it.
  float dusk = exp(-ndl * ndl * 11.0) * uDusk;
  vec3 tint = mix(uColor, uWarm, dusk * 0.75);

  // 0.07 of night-side airglow — a limb that cuts to pure black reads as a
  // clipped shape, and the faintest rim is what keeps the sphere round.
  float lit = 0.07 + 0.93 * day;
  // Belt and braces for the landing. A shell you are INSIDE has no limb, and
  // the impact parameter above would happily smear a bright band across the
  // touchdown pad instead — which is the exact artefact the landing fade was
  // added to kill once already. Folding the guard into the shader means it
  // does not depend on that ramp staying tuned, and it only bites in the last
  // few units of the descent, long after the fade has taken over.
  float clear = smoothstep(uOuter, uOuter * 1.35, length(cameraPosition - vCentre));
  float a = density * lit * (1.0 + 0.55 * dusk * day) * clear * uIntensity * uFade;
  gl_FragColor = vec4(tint * a, a);
}`;

/* Shell height as a fraction of the body radius. Generous on purpose: the
 * glow now dies out inside the shell instead of at it, so the extra room is
 * headroom for the falloff, not a thicker-looking band. */
const ATMOS_THICKNESS = 0.1;
/* The warm end of every limb — one shared terminator colour, because the
 * reddening is Rayleigh scattering doing the same thing to every atmosphere
 * and giving each world its own sunset colour would read as decoration. */
const ATMOS_WARM = '#ffa869';

function Atmosphere({
  radius,
  color,
  light,
  intensity = 1,
  dusk = 1,
  fadeRef,
}: {
  /** The BODY's radius — the shell is derived, so the shader knows both. */
  radius: number;
  color: string;
  /** World-space direction toward the key light for this body. */
  light: readonly [number, number, number];
  intensity?: number;
  /** How much sunrise the terminator gets. Earth earns all of it — it is the
   *  body the camera closes on, and the warm crossing line is the single
   *  detail that says "photographed from orbit". The gas giants get a
   *  fraction: at full strength a salmon band around Neptune reads as a
   *  colour grade rather than as weather. */
  dusk?: number;
  /** 0 = full shell, 1 = invisible — driven by the landing ramp. */
  fadeRef?: { current: number };
}) {
  const outer = radius * (1 + ATMOS_THICKNESS);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(color) },
          uWarm: { value: new THREE.Color(ATMOS_WARM) },
          uLight: { value: new THREE.Vector3() },
          uIntensity: { value: intensity },
          uDusk: { value: dusk },
          uFade: { value: 1 },
          uInner: { value: radius },
          uOuter: { value: outer },
        },
        vertexShader: ATMOS_VERT,
        fragmentShader: ATMOS_FRAG,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      }),
    [color, intensity, dusk, radius, outer],
  );
  // The key direction is written, never memo-keyed: a fresh [x,y,z] literal
  // from the caller would otherwise rebuild the material on every render and
  // hand the compiler a new program mid-flight.
  useLayoutEffect(() => {
    const u = material.uniforms['uLight'];
    if (u) (u.value as THREE.Vector3).set(light[0], light[1], light[2]);
  }, [material, light]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    const u = material.uniforms['uFade'];
    if (fadeRef && u) {
      // Hold the blue limb through the whole return arc — Earth should look
      // like Earth until the final descent, when the LandingSite's own sky
      // takes over. (An early linear fade stripped the glow mid-approach.)
      const r = (fadeRef.current - 0.75) / 0.2;
      const s = r < 0 ? 0 : r > 1 ? 1 : r;
      u.value = 1 - s * s * (3 - 2 * s);
    }
  });
  return (
    <mesh material={material}>
      <sphereGeometry args={[outer, 48, 36]} />
    </mesh>
  );
}

/* ---- where the light comes from, per body ---------------------------------
 * The limb shader needs ONE direction, and guessing it would be worse than a
 * uniform ring: an atmosphere lit from the wrong side is a lie the eye spots
 * immediately. So it is derived from the rig itself — the sun point light
 * (decay 0, so it delivers its full intensity at any range) plus the cool
 * directional that actually carves the terminators — weighted by the exact
 * intensities SpaceEnvironment ships. That sum is the dominant irradiance
 * direction on a lambertian surface, which is to say: the direction the
 * planet's own shading is already using. */
const FILL_DIR = new THREE.Vector3(FILL_FROM[0], FILL_FROM[1], FILL_FROM[2]).normalize();
const _keyV = new THREE.Vector3();

function keyLight(bodyPos: Vec3, sunPos: Vec3): readonly [number, number, number] {
  _keyV
    .set(sunPos[0] - bodyPos[0], sunPos[1] - bodyPos[1], sunPos[2] - bodyPos[2])
    .normalize()
    .multiplyScalar(SUN_LIGHT_INTENSITY)
    .addScaledVector(FILL_DIR, FILL_INTENSITY)
    .normalize();
  return [_keyV.x, _keyV.y, _keyV.z];
}

/* Limb tints per world — restrained, never neon; the moon gets none (it has
 * no atmosphere and pretending otherwise reads as a rendering bug). */
const ATMOS_TINT: Partial<Record<RockyKind, { color: string; intensity: number; dusk: number }>> =
  {
    mars: { color: '#c77b57', intensity: 0.85, dusk: 0.8 },
    jupiter: { color: '#d8c2a0', intensity: 0.9, dusk: 0.45 },
    neptune: { color: '#5f86e8', intensity: 1.15, dusk: 0.4 },
  };

/* ==== EARTH ==== */

function Earth({
  wp,
  reduced,
  sunPos,
  landingRef,
}: LitBodyProps & { landingRef?: { current: number } }) {
  const light = useMemo(() => keyLight(wp.bodyPos, sunPos), [wp.bodyPos, sunPos]);
  const day = useSurfaceTexture(TEX.earthDay);
  const night = useSurfaceTexture(TEX.earthNight);
  // Clouds drive alpha, not color, so they stay in linear space.
  const clouds = useSurfaceTexture(TEX.earthClouds, false);
  const globeRef = useRef<THREE.Mesh>(null);
  const cloudRef = useRef<THREE.Mesh>(null);

  useFrame((_state, delta) => {
    // The orbital cloud shell fades late in the landing approach — state,
    // not motion, so it runs on every rung. Earth keeps its clouds through
    // the return arc; LandingSite's cumulus takes over on final descent.
    if (landingRef && cloudRef.current) {
      const r = (landingRef.current - 0.75) / 0.2;
      const s = r < 0 ? 0 : r > 1 ? 1 : r;
      (cloudRef.current.material as THREE.MeshStandardMaterial).opacity =
        0.55 * (1 - s * s * (3 - 2 * s));
    }
    if (reduced) return;
    if (globeRef.current) globeRef.current.rotation.y += EARTH_SPIN * delta;
    if (cloudRef.current) cloudRef.current.rotation.y -= CLOUD_COUNTER_SPIN * delta;
  });

  return (
    // Axial tilt lives on the group so the spin axis stays tilted while the
    // children rotate on local Y.
    <group position={wp.bodyPos} rotation={[0, 0, 0.41]}>
      <mesh ref={globeRef}>
        <sphereGeometry args={[wp.bodyRadius, 64, 48]} />
        {/* White emissive + the night map makes the dark limb glitter with
            cities without washing out the lit side. The day map re-used as a
            bump map gives the terminator texture, and the lowered roughness
            puts a specular sheen on the oceans — the single cheapest "that is
            a real planet" upgrade. */}
        <meshStandardMaterial
          map={day}
          bumpMap={day}
          bumpScale={BUMP.earth}
          emissiveMap={night}
          emissive="#ffffff"
          emissiveIntensity={0.6}
          roughness={0.55}
          metalness={0.02}
        />
      </mesh>
      <mesh ref={cloudRef}>
        <sphereGeometry args={[wp.bodyRadius * 1.03, 48, 36]} />
        {/* The clouds map is greyscale with no alpha channel, so it feeds
            alphaMap under a white color — using it as a plain map would grey
            the whole planet. */}
        <meshStandardMaterial
          color="#ffffff"
          alphaMap={clouds}
          transparent
          opacity={0.55}
          depthWrite={false}
          roughness={1}
          metalness={0}
        />
      </mesh>
      {/* The blue limb is most of what makes it read as HOME — and it doubles
          as the landing glow on the return approach. Earth is the one body
          the camera gets close to, so it is also where the warm terminator
          band the shader draws actually reads as a sunrise. */}
      <Atmosphere
        radius={wp.bodyRadius}
        color="#6f9fe8"
        light={light}
        intensity={1.7}
        {...(landingRef ? { fadeRef: landingRef } : {})}
      />
    </group>
  );
}

/* ==== TEXTURED ROCKY / GAS PLANETS ==== */

type RockyKind = 'moon' | 'mars' | 'jupiter' | 'neptune';

/* Distinct spin rates and tilts so the four simple spheres never read as
 * copies of one another. Jupiter spins fastest — the real one does too. */
const PLANET_TUNING: Record<RockyKind, { url: string; spin: number; tilt: number }> = {
  moon: { url: '/textures/2k_moon.webp', spin: 0.03, tilt: 0.03 },
  mars: { url: '/textures/2k_mars.webp', spin: 0.1, tilt: 0.44 },
  jupiter: { url: '/textures/2k_jupiter.webp', spin: 0.24, tilt: 0.06 },
  neptune: { url: '/textures/2k_neptune.webp', spin: 0.18, tilt: 0.49 },
};

function Planet({ wp, reduced, sunPos, kind }: LitBodyProps & { kind: RockyKind }) {
  const spec = PLANET_TUNING[kind];
  const tex = useSurfaceTexture(spec.url);
  const light = useMemo(() => keyLight(wp.bodyPos, sunPos), [wp.bodyPos, sunPos]);
  const ref = useRef<THREE.Mesh>(null);

  useFrame((_state, delta) => {
    if (reduced) return;
    if (ref.current) ref.current.rotation.y += spec.spin * delta;
  });

  const tint = ATMOS_TINT[kind];
  return (
    <group position={wp.bodyPos} rotation={[0, 0, spec.tilt]}>
      <mesh ref={ref}>
        <sphereGeometry args={[wp.bodyRadius, 48, 36]} />
        {/* Self-bump: craters and cloud bands catch the key light instead of
            rendering as flat decals. */}
        <meshStandardMaterial
          map={tex}
          bumpMap={tex}
          bumpScale={BUMP[kind]}
          roughness={0.95}
          metalness={0}
        />
      </mesh>
      {tint && (
        <Atmosphere
          radius={wp.bodyRadius}
          color={tint.color}
          light={light}
          intensity={tint.intensity}
          dusk={tint.dusk}
        />
      )}
    </group>
  );
}

/* ==== SATURN ==== */

function Saturn({ wp, reduced, sunPos }: LitBodyProps) {
  const tex = useSurfaceTexture(TEX.saturn);
  const ringTex = useSurfaceTexture(TEX.saturnRing);
  const light = useMemo(() => keyLight(wp.bodyPos, sunPos), [wp.bodyPos, sunPos]);
  const sphereRef = useRef<THREE.Mesh>(null);

  const inner = wp.bodyRadius * 1.35;
  const outer = wp.bodyRadius * 2.3;

  const ringGeo = useMemo(() => {
    const geo = new THREE.RingGeometry(inner, outer, 96, 1);
    // RingGeometry ships planar UVs, which smear the band texture across the
    // disc. Rewriting u to run RADIALLY (inner edge 0, outer edge 1, constant
    // v) makes the alpha strip read as concentric rings.
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos as THREE.BufferAttribute, i);
      uv.setXY(i, (v.length() - inner) / (outer - inner), 0.5);
    }
    return geo;
  }, [inner, outer]);

  // R3F only auto-disposes JSX-created objects, so the memoized geometry
  // cleans up after itself.
  useEffect(() => () => ringGeo.dispose(), [ringGeo]);

  useFrame((_state, delta) => {
    if (reduced) return;
    if (sphereRef.current) sphereRef.current.rotation.y += SATURN_SPIN * delta;
  });

  return (
    // One tilt on the group keeps the ring plane and the spin axis agreeing.
    <group position={wp.bodyPos} rotation={[0.08, 0, RING_TILT]}>
      <mesh ref={sphereRef}>
        <sphereGeometry args={[wp.bodyRadius, 48, 36]} />
        <meshStandardMaterial
          map={tex}
          bumpMap={tex}
          bumpScale={BUMP.saturn}
          roughness={0.95}
          metalness={0}
        />
      </mesh>
      <mesh geometry={ringGeo} rotation={[Math.PI / 2, 0, 0]}>
        {/* depthWrite off so the translucent ring never punches sorting holes
            against the globe behind it. A touch of self-emission keeps the
            bands legible even when the sun key light rakes them edge-on —
            unlit they photographed as washed grey (live-site finding). */}
        <meshStandardMaterial
          map={ringTex}
          emissiveMap={ringTex}
          emissive="#cbbfa4"
          emissiveIntensity={0.38}
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
          roughness={0.9}
          metalness={0}
        />
      </mesh>
      <Atmosphere radius={wp.bodyRadius} color="#e0cf9e" light={light} intensity={0.8} dusk={0.6} />
    </group>
  );
}

/* ==== ASTEROID FIELD ==== */

/* ---- seeded noise for the rock shaper ------------------------------------
 * All of it runs once per variant inside useMemo — never per frame. */

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Seeded value at an integer lattice point. mulberry32 is the hash core, so
 *  the whole noise field stays on the project's one sanctioned PRNG. */
function latticeValue(ix: number, iy: number, iz: number, seed: number): number {
  return mulberry32((seed + ix * 374761393 + iy * 668265263 + iz * 1274126177) >>> 0)();
}

/** Trilinearly interpolated value noise in [0, 1] over 3D space. */
function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const c000 = latticeValue(ix, iy, iz, seed);
  const c100 = latticeValue(ix + 1, iy, iz, seed);
  const c010 = latticeValue(ix, iy + 1, iz, seed);
  const c110 = latticeValue(ix + 1, iy + 1, iz, seed);
  const c001 = latticeValue(ix, iy, iz + 1, seed);
  const c101 = latticeValue(ix + 1, iy, iz + 1, seed);
  const c011 = latticeValue(ix, iy + 1, iz + 1, seed);
  const c111 = latticeValue(ix + 1, iy + 1, iz + 1, seed);
  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

/** 3-octave fbm of valueNoise3, normalized to roughly [-1, 1]. */
function fbm3(x: number, y: number, z: number, seed: number): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = ASTEROID_NOISE_FREQ;
  for (let o = 0; o < ASTEROID_NOISE_OCTAVES; o++) {
    sum += amp * (valueNoise3(x * freq, y * freq, z * freq, seed + o * 0x9e37) * 2 - 1);
    norm += amp;
    amp *= ASTEROID_NOISE_GAIN;
    freq *= ASTEROID_NOISE_LACUNARITY;
  }
  return sum / norm;
}

/** IcosahedronGeometry ships unwelded corner vertices (a flat-shading layout);
 *  welding them into an indexed mesh is what lets computeVertexNormals blend
 *  across faces — smooth-lumpy regolith instead of facets. */
function weldedIcosahedron(detail: number): THREE.BufferGeometry {
  const src = new THREE.IcosahedronGeometry(1, detail);
  const srcPos = src.getAttribute('position') as THREE.BufferAttribute;
  const seen = new Map<string, number>();
  const verts: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < srcPos.count; i++) {
    const x = srcPos.getX(i);
    const y = srcPos.getY(i);
    const z = srcPos.getZ(i);
    const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
    let idx = seen.get(key);
    if (idx === undefined) {
      idx = verts.length / 3;
      seen.set(key, idx);
      verts.push(x, y, z);
    }
    index.push(idx);
  }
  src.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(index);
  return geo;
}

/** Asteroid geometry with photographic character (think Itokawa/Bennu): a
 *  welded icosphere displaced by seeded 3-octave value noise (multi-scale
 *  lumps), dented by 5-7 seeded craters (smooth bowls with raised rims), then
 *  triaxially squashed (~1.0/0.82/0.68) so no silhouette reads as a sphere.
 *  Per-vertex color bakes the lighting the mesh cannot afford at runtime:
 *  crevice floors darken up to 45% (soft self-shadow), crater rims lighten
 *  ~8%, and a low-frequency warm/cool field breaks the monochrome. Smooth
 *  vertex normals — real asteroids at this scale read smooth-lumpy, never
 *  faceted. (Dressing carries the same technique for its rock props; the two
 *  files deliberately do not import each other's internals.) */
function makeAsteroidGeometry(seed: number, detail: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);

  type Crater = { dir: THREE.Vector3; radius: number; depth: number };
  const craters: Crater[] = [];
  const craterCount =
    ASTEROID_CRATER_MIN + Math.floor(rand() * (ASTEROID_CRATER_MAX - ASTEROID_CRATER_MIN + 1));
  for (let c = 0; c < craterCount; c++) {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    craters.push({
      dir: new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s, z),
      radius:
        ASTEROID_CRATER_RADIUS_MIN +
        rand() * (ASTEROID_CRATER_RADIUS_MAX - ASTEROID_CRATER_RADIUS_MIN),
      depth:
        ASTEROID_CRATER_DEPTH_MIN +
        rand() * (ASTEROID_CRATER_DEPTH_MAX - ASTEROID_CRATER_DEPTH_MIN),
    });
  }

  // Triaxial squash — potato-oid, never round. Seeded per variant around
  // the 1.0 / 0.82 / 0.68 target so the three variants differ in build.
  const squashY = 0.76 + rand() * 0.12;
  const squashZ = 0.6 + rand() * 0.16;

  // Independent integer seeds for the shape and albedo noise fields.
  const shapeSeed = Math.floor(rand() * 0xffffffff);
  const patchSeed = Math.floor(rand() * 0xffffffff);

  const geo = weldedIcosahedron(detail);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();

    // Multi-scale lumps from fbm over the sphere direction.
    let len = 1 + ASTEROID_NOISE_AMP * fbm3(v.x, v.y, v.z, shapeSeed);

    // Craters: inward across the bowl, slightly outward on the rim annulus.
    let rim = 0;
    for (const crater of craters) {
      const ang = Math.acos(Math.min(1, Math.max(-1, v.dot(crater.dir))));
      if (ang >= crater.radius) continue;
      const t = ang / crater.radius;
      const bowl = 1 - smooth01(0, 0.72, t);
      const lip = smooth01(0.55, 0.82, t) * (1 - smooth01(0.82, 1, t));
      len += crater.depth * (ASTEROID_CRATER_RIM * lip - bowl);
      rim += lip;
    }

    // Baked AO + albedo. These multiply the material color AND the
    // per-instance palette, so the belt keeps its slate range while every
    // crevice self-shadows and every rim catches light.
    const inward = Math.max(0, 1 - len);
    const ao = Math.min(1, inward / (ASTEROID_NOISE_AMP + ASTEROID_CRATER_DEPTH_MAX));
    const shade = (1 - ASTEROID_AO_DARKEN * ao) * (1 + ASTEROID_RIM_LIGHT * Math.min(1, rim));
    const patch =
      valueNoise3(
        v.x * ASTEROID_PATCH_FREQ,
        v.y * ASTEROID_PATCH_FREQ,
        v.z * ASTEROID_PATCH_FREQ,
        patchSeed,
      ) *
        2 -
      1;
    colors[i * 3] = shade * (1 + ASTEROID_PATCH_AMOUNT * patch);
    colors[i * 3 + 1] = shade * (1 + ASTEROID_PATCH_AMOUNT * 0.3 * patch);
    colors[i * 3 + 2] = shade * (1 - ASTEROID_PATCH_AMOUNT * 0.7 * patch);

    pos.setXYZ(i, v.x * len, v.y * len * squashY, v.z * len * squashZ);
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals(); // indexed + welded → smooth regolith normals
  return geo;
}

type AsteroidSpec = {
  p: readonly [number, number, number];
  r: readonly [number, number, number];
  s: readonly [number, number, number];
  c: readonly [number, number, number];
};

function Asteroids({ wp, reduced }: BodyProps) {
  const driftRef = useRef<THREE.Group>(null);
  const meshRefs = useRef<Array<THREE.InstancedMesh | null>>([]);

  // Three lumpy variants shared across all instances (index 0 is higher
  // detail, reserved for the boulders) — the whole belt stays ≤3 rock draw
  // calls plus one Points veil.
  const geometries = useMemo(
    () =>
      ASTEROID_VARIANT_SEEDS.map((seed, i) =>
        makeAsteroidGeometry(seed, i === 0 ? ASTEROID_DETAIL_BOULDER : ASTEROID_DETAIL_SMALL),
      ),
    [],
  );
  // Instance colors MULTIPLY the material color, so the base stays white and
  // the albedo lives in the per-instance palette (centred on
  // ASTEROID_BASE_COLOR) — a tinted base would double-darken every rock. The
  // baked vertex colors multiply on top of BOTH: near-white with crevice
  // darkening and warm/cool patchiness, never a second grey.
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        vertexColors: true,
        // Matte regolith: dust-blanketed rubble has almost no specular sheen —
        // the earlier mineral glint read as game gravel.
        roughness: 0.93,
        metalness: 0.04,
      }),
    [],
  );
  useEffect(
    () => () => {
      for (const g of geometries) g.dispose();
      material.dispose();
    },
    [geometries, material],
  );

  // Belt layout, computed once per waypoint: seeded clump centres inside a
  // flattened ellipsoid disc, most rocks gathered around them and the rest
  // scattered loose — a belt with structure, not confetti.
  const field = useMemo(() => {
    const rand = mulberry32(wp.index * 7919 + 3);
    const lateral = wp.bodyRadius;
    const ySpread = lateral * ASTEROID_BELT_Y;

    const centres: Array<readonly [number, number, number]> = [];
    for (let cIdx = 0; cIdx < ASTEROID_CLUMP_COUNT; cIdx++) {
      const ang = rand() * Math.PI * 2;
      // sqrt keeps clump density uniform across the disc, not centre-piled.
      const r = Math.sqrt(rand()) * lateral * 0.85;
      centres.push([Math.cos(ang) * r, (rand() - 0.5) * ySpread * 0.7, Math.sin(ang) * r]);
    }

    const variants: AsteroidSpec[][] = ASTEROID_VARIANT_SEEDS.map(() => []);
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      let x: number;
      let y: number;
      let z: number;
      if (rand() < ASTEROID_CLUMP_CHANCE) {
        const centre = centres[Math.floor(rand() * centres.length)] ?? [0, 0, 0];
        // Triangular falloff (sum of two rands) piles rocks toward the core.
        const spread = lateral * ASTEROID_CLUMP_SPREAD;
        x = centre[0] + (rand() + rand() - 1) * spread;
        y = centre[1] + (rand() + rand() - 1) * ySpread * 0.5;
        z = centre[2] + (rand() + rand() - 1) * spread;
      } else {
        const ang = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * lateral;
        x = Math.cos(ang) * r;
        y = (rand() - 0.5) * ySpread;
        z = Math.sin(ang) * r;
      }

      // Power law: most rocks small, a few genuine boulders.
      const base = 0.35 + Math.pow(rand(), 2.6) * 2.3;

      // Dark warm/cool greys and rusty umbers with a little lightness jitter.
      scratchCol.set(
        ASTEROID_PALETTE[Math.floor(rand() * ASTEROID_PALETTE.length)] ?? ASTEROID_BASE_COLOR,
      );
      scratchCol.offsetHSL(0, 0, (rand() - 0.5) * 0.08);

      const spec: AsteroidSpec = {
        p: [x, y, z],
        r: [rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2],
        // ±18% per-axis jitter so nothing reads as a scaled sphere.
        s: [
          base * (0.82 + rand() * 0.36),
          base * (0.82 + rand() * 0.36),
          base * (0.82 + rand() * 0.36),
        ],
        c: [scratchCol.r, scratchCol.g, scratchCol.b],
      };
      const vi = base > ASTEROID_BOULDER_MIN ? 0 : 1 + Math.floor(rand() * 2);
      variants[vi]?.push(spec);
    }

    // Dust veil positions, threaded through the same belt volume.
    const dust = new Float32Array(ASTEROID_DUST_COUNT * 3);
    for (let i = 0; i < ASTEROID_DUST_COUNT; i++) {
      const ang = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * lateral * 1.05;
      dust[i * 3] = Math.cos(ang) * r;
      dust[i * 3 + 1] = (rand() - 0.5) * ySpread * 1.4;
      dust[i * 3 + 2] = Math.sin(ang) * r;
    }

    return { variants, dust };
  }, [wp.index, wp.bodyRadius]);

  // Matrices and colors are written once per field — a static belt only needs
  // its collective drift, never per-instance updates.
  useLayoutEffect(() => {
    for (let vi = 0; vi < field.variants.length; vi++) {
      const mesh = meshRefs.current[vi];
      const specs = field.variants[vi];
      if (!mesh || !specs) continue;
      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        if (!spec) continue;
        scratchObj.position.set(spec.p[0], spec.p[1], spec.p[2]);
        scratchObj.rotation.set(spec.r[0], spec.r[1], spec.r[2]);
        scratchObj.scale.set(spec.s[0], spec.s[1], spec.s[2]);
        scratchObj.updateMatrix();
        mesh.setMatrixAt(i, scratchObj.matrix);
        scratchCol.setRGB(spec.c[0], spec.c[1], spec.c[2]);
        mesh.setColorAt(i, scratchCol);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [field]);

  useFrame((_state, delta) => {
    if (reduced) return;
    if (driftRef.current) driftRef.current.rotation.y += ASTEROID_DRIFT * delta;
  });

  return (
    // The drift group carries rocks AND dust so the veil rides the same slow
    // rotation. Culling is off because the instances spread far beyond each
    // unit geometry's bounding sphere — three would cull the whole field.
    <group ref={driftRef} position={wp.bodyPos}>
      {geometries.map((geo, vi) => {
        const specs = field.variants[vi];
        if (!specs || specs.length === 0) return null;
        return (
          <instancedMesh
            key={vi}
            ref={(el) => {
              meshRefs.current[vi] = el;
            }}
            args={[geo, material, specs.length]}
            frustumCulled={false}
          />
        );
      })}
      {/* Dust veil: faint additive haze through the belt volume — the same
          soft-disc technique as the star-cluster halos. */}
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[field.dust, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={glowTexture()}
          color={ASTEROID_DUST_COLOR}
          size={ASTEROID_DUST_SIZE}
          sizeAttenuation
          transparent
          opacity={ASTEROID_DUST_OPACITY}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  );
}

/* ==== NEBULA — the FIREFIGHT backdrop ==== */

/* ---- instanced billboards -------------------------------------------------
 * A sprite costs one draw call each, which is why the old 40-puff field could
 * never afford to get bigger. These are instanced quads billboarded in the
 * VERTEX SHADER (the quad corner is offset in view space, so the card always
 * squares up to the camera no matter what the drift group has done to its
 * centre), which puts a whole layer — scale, roll, tint and texture variant
 * all varying per instance — into ONE draw call.
 *
 * Under AdditiveBlending (SRC_ALPHA, ONE) the destination gains rgb * a, so
 * per-instance opacity is folded straight into the instance colour and costs
 * no extra attribute. Additive is also order-independent by construction:
 * nothing here needs sorting, which is what lets 160 overlapping soft cards
 * composite cleanly with depthWrite off. */

const GAS_VERT = `
attribute vec3 iPos;
attribute vec3 iColor;
attribute vec3 iParam; // x = world scale, y = roll (rad), z = atlas tile index
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vColor = iColor;
  // Atlas lookup, inset a hair so neighbouring tiles can never bleed at low mips.
  vUv = vec2((iParam.z + 0.006 + uv.x * 0.988) * ${(1 / NEBULA_TILES).toFixed(8)}, uv.y);
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iParam.y);
  float s = sin(iParam.y);
  mv.xy += vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iParam.x;
  gl_Position = projectionMatrix * mv;
}`;

const GAS_FRAG = `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float a = texture2D(uMap, vUv).a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// One unit quad, shared as source data by both layers. Each geometry wraps it
// in its own BufferAttribute so disposing one layer never frees the other's
// GPU buffers.
const QUAD_POS = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
const QUAD_UV = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_INDEX = [0, 1, 2, 0, 2, 3];

const NEB_CORE_C = new THREE.Color(NEBULA_CORE);
const NEB_MID_C = new THREE.Color(NEBULA_MID);
const NEB_EDGE_C = new THREE.Color(NEBULA_EDGE);
const NEB_HOT_C = new THREE.Color(NEBULA_EMBER_HOT);

const NEB_CORE_LUM = 0.2126 * NEB_CORE_C.r + 0.7152 * NEB_CORE_C.g + 0.0722 * NEB_CORE_C.b;

/** The field's colour law: a pale-hot heart bleaching into the ember core,
 *  through rust, out to a cool violet rim — keyed on normalised distance from
 *  the field centre. The innermost bleach matters: pure #ff7a3c accumulating
 *  additively saturates the red channel long before green and blue catch up,
 *  so without a whiter heart the core photographs as flat primary red. */
function nebulaTint(t: number, out: THREE.Color): THREE.Color {
  if (t < NEBULA_CORE_STOP) {
    out.copy(NEB_CORE_C).lerp(NEB_MID_C, t / NEBULA_CORE_STOP);
    out.lerp(NEB_HOT_C, Math.max(0, 1 - t / (NEBULA_CORE_STOP * 0.7)) * 0.38);
  } else {
    out.copy(NEB_MID_C).lerp(NEB_EDGE_C, (t - NEBULA_CORE_STOP) / (1 - NEBULA_CORE_STOP));
  }
  return out;
}

/** Per-card brightness for a tint, normalised so a dark hue is as PRESENT as
 *  a bright one without fully flattening the field's core-to-rim falloff. */
function nebulaWeight(c: THREE.Color): number {
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return Math.pow(NEB_CORE_LUM / Math.max(lum, 0.004), NEBULA_TINT_EXP);
}

type GasLayerSpec = {
  /** Mixed into the waypoint seed so the two layers never share a scatter. */
  seed: number;
  count: number;
  /** Field extent multipliers on wp.bodyRadius. Combined they preserve the
   *  original x ±R, y ±0.8R, z ±0.6R envelope. */
  xk: number;
  yk: number;
  zMin: number;
  zMax: number;
  /** Billboard scale range, × wp.bodyRadius. The power law between them is
   *  steep on purpose: a handful of vast faint envelopes carrying the cloud's
   *  outline, and many mid-sized cards carrying its structure. */
  scaleMin: number;
  scaleSpan: number;
  scalePow: number;
  /** Per-card peak contribution before the tint weighting. Deliberately tiny —
   *  see NEBULA_GAIN. */
  opMin: number;
  opMax: number;
};

// FAR: the body and outline of the cloud, deep and faint.
const NEBULA_FAR: GasLayerSpec = {
  seed: 0x1013,
  count: 100,
  xk: 1.05,
  yk: 0.84,
  zMin: -0.62,
  zMax: 0.02,
  scaleMin: 0.28,
  scaleSpan: 1.35,
  scalePow: 2.2,
  opMin: 0.006,
  opMax: 0.022,
};
// NEAR: smaller, hotter, closer to the lens — where the eye reads detail.
const NEBULA_NEAR: GasLayerSpec = {
  seed: 0x1b77,
  count: 115,
  xk: 0.86,
  yk: 0.64,
  zMin: -0.04,
  zMax: 0.58,
  scaleMin: 0.14,
  scaleSpan: 0.62,
  scalePow: 2,
  opMin: 0.01,
  opMax: 0.034,
};

function makeGasGeometry(spec: GasLayerSpec, wpIndex: number, radius: number) {
  const rand = mulberry32((wpIndex * 1013 + spec.seed) >>> 0);
  const n = spec.count;
  const iPos = new Float32Array(n * 3);
  const iColor = new Float32Array(n * 3);
  const iParam = new Float32Array(n * 3);

  // Knot centres, drawn first so the whole layer gathers around the same
  // structure regardless of how many cards land loose.
  const knots: Array<readonly [number, number]> = [];
  for (let k = 0; k < NEBULA_KNOTS; k++) {
    const ang = rand() * Math.PI * 2;
    // sqrt keeps knots spread evenly across the disc instead of centre-piled.
    const rr = Math.sqrt(rand()) * 0.72;
    knots.push([Math.cos(ang) * rr * spec.xk, Math.sin(ang) * rr * spec.yk]);
  }

  for (let i = 0; i < n; i++) {
    // Normalised (unit-ellipse) coordinates, so the colour law can key off a
    // single distance whatever the layer's aspect is.
    let ux: number;
    let uy: number;
    if (rand() < NEBULA_KNOT_CHANCE) {
      const knot = knots[Math.floor(rand() * knots.length)] ?? [0, 0];
      // Triangular falloff (sum of two rands) piles gas toward the knot core.
      ux = knot[0] + (rand() + rand() - 1) * NEBULA_KNOT_SPREAD * spec.xk;
      uy = knot[1] + (rand() + rand() - 1) * NEBULA_KNOT_SPREAD * spec.yk;
    } else {
      const ang = rand() * Math.PI * 2;
      const rr = Math.pow(rand(), 0.72);
      ux = Math.cos(ang) * rr * spec.xk;
      uy = Math.sin(ang) * rr * spec.yk;
    }
    iPos[i * 3] = ux * radius;
    iPos[i * 3 + 1] = uy * radius;
    iPos[i * 3 + 2] = radius * (spec.zMin + rand() * (spec.zMax - spec.zMin));

    const t = Math.min(
      1,
      Math.max(0, Math.hypot(ux / spec.xk, uy / spec.yk) + (rand() - 0.5) * 0.18),
    );
    nebulaTint(t, scratchCol);
    const op =
      (spec.opMin + rand() * (spec.opMax - spec.opMin)) *
      nebulaWeight(scratchCol) *
      NEBULA_GAIN;
    iColor[i * 3] = scratchCol.r * op;
    iColor[i * 3 + 1] = scratchCol.g * op;
    iColor[i * 3 + 2] = scratchCol.b * op;

    // Outer gas is diffuse and vast; knotted core gas is smaller and denser.
    iParam[i * 3] =
      radius *
      (spec.scaleMin + Math.pow(rand(), spec.scalePow) * spec.scaleSpan) *
      (0.8 + t * 0.5);
    iParam[i * 3 + 1] = rand() * Math.PI * 2;
    iParam[i * 3 + 2] = Math.floor(rand() * NEBULA_TILES);
  }

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(QUAD_POS, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(QUAD_UV, 2));
  geo.setIndex(QUAD_INDEX);
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
  geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(iColor, 3));
  geo.setAttribute('iParam', new THREE.InstancedBufferAttribute(iParam, 3));
  geo.instanceCount = n;
  return geo;
}

/** Tiny hard embers threaded through the gas — newly-lit stars in the cloud.
 *  Piled hard toward the core (pow 1.8) and bleached toward white there, so
 *  the heart of the nebula has something SHARP in it; without these the field
 *  is all soft falloff and reads as fog rather than fire. */
function makeEmbers(wpIndex: number, radius: number) {
  const rand = mulberry32((wpIndex * 1013 + 0x2c5f) >>> 0);
  const positions = new Float32Array(NEBULA_EMBER_COUNT * 3);
  const colors = new Float32Array(NEBULA_EMBER_COUNT * 3);
  for (let i = 0; i < NEBULA_EMBER_COUNT; i++) {
    const ang = rand() * Math.PI * 2;
    const rr = Math.pow(rand(), 1.8);
    positions[i * 3] = Math.cos(ang) * rr * radius * 0.95;
    positions[i * 3 + 1] = Math.sin(ang) * rr * radius * 0.75;
    positions[i * 3 + 2] = (rand() - 0.5) * radius * 0.9;
    nebulaTint(Math.min(1, rr * 1.15), scratchCol);
    // Hot white core, cooling with distance; the outer embers also dim, so
    // the eye reads a light source rather than an even sprinkle.
    scratchCol.lerp(NEB_HOT_C, Math.max(0, 1 - rr * 1.6) * 0.85);
    const b = 0.35 + (1 - rr) * 0.65;
    colors[i * 3] = scratchCol.r * b;
    colors[i * 3 + 1] = scratchCol.g * b;
    colors[i * 3 + 2] = scratchCol.b * b;
  }
  return { positions, colors };
}

function Nebula({ wp, reduced }: BodyProps) {
  const farRef = useRef<THREE.Group>(null);
  const nearRef = useRef<THREE.Group>(null);

  const farGeo = useMemo(
    () => makeGasGeometry(NEBULA_FAR, wp.index, wp.bodyRadius),
    [wp.index, wp.bodyRadius],
  );
  const nearGeo = useMemo(
    () => makeGasGeometry(NEBULA_NEAR, wp.index, wp.bodyRadius),
    [wp.index, wp.bodyRadius],
  );
  const embers = useMemo(() => makeEmbers(wp.index, wp.bodyRadius), [wp.index, wp.bodyRadius]);

  // One material for both layers — the tint lives entirely in the instance
  // data, so the two draws differ only by their vertex buffers.
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: nebulaAtlas() } },
        vertexShader: GAS_VERT,
        fragmentShader: GAS_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  // R3F only auto-disposes JSX-created objects; these are memoized, so they
  // clean up after themselves. The atlas is module-cached and shared — never
  // disposed here.
  useEffect(
    () => () => {
      farGeo.dispose();
      nearGeo.dispose();
      material.dispose();
    },
    [farGeo, nearGeo, material],
  );

  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;
    // Parallax: two layers churning in opposite directions at different rates.
    // Very slow — the gas should be perceptibly alive over ~30s, never busy.
    const far = farRef.current;
    if (far) {
      far.rotation.z = t * NEBULA_FAR_SPIN;
      far.position.x = Math.cos(t * NEBULA_FAR_SWAY[1]) * NEBULA_FAR_SWAY[0];
      far.position.y = Math.sin(t * NEBULA_FAR_SWAY[3]) * NEBULA_FAR_SWAY[2];
    }
    const near = nearRef.current;
    if (near) {
      near.rotation.z = -t * NEBULA_NEAR_SPIN;
      near.position.x = Math.cos(t * NEBULA_NEAR_SWAY[1] + 0.6) * NEBULA_NEAR_SWAY[0];
      near.position.y = Math.sin(t * NEBULA_NEAR_SWAY[3] + 1.7) * NEBULA_NEAR_SWAY[2];
    }
  });

  return (
    <group position={wp.bodyPos}>
      {/* Draw 1 — the deep body of the cloud. */}
      <group ref={farRef}>
        <mesh geometry={farGeo} material={material} frustumCulled={false} />
      </group>
      {/* Draws 2 and 3 — near gas plus the embers riding with it. Culling is
          off on both: the instances spread far beyond the unit quad's bounds,
          so three would cull the whole layer the moment its origin left frame. */}
      <group ref={nearRef}>
        <mesh geometry={nearGeo} material={material} frustumCulled={false} />
        <points frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[embers.positions, 3]} />
            <bufferAttribute attach="attributes-color" args={[embers.colors, 3]} />
          </bufferGeometry>
          <pointsMaterial
            map={glowTexture()}
            size={NEBULA_EMBER_SIZE}
            sizeAttenuation
            vertexColors
            transparent
            opacity={0.95}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </points>
      </group>
    </group>
  );
}

/* ==== OUTPOST — the station ================================================
 *
 * An ISS-class station, built entirely from primitives + the two canvas maps
 * above. What makes the International Space Station instantly recognisable is
 * a specific stack of features, in this order of legibility:
 *
 *   1. a long LATTICE TRUSS spine — one bay geometry, instanced along ±X
 *   2. FOUR big solar array wings, symmetric coplanar pairs on rotary joints,
 *      mounted toward the truss ends (the station reads as MOSTLY array)
 *   3. a cluster of white pressurised cylinders slung under the middle at
 *      right angles to the spine, with MLI sections, ring seams, handrails
 *      and a cupola bump
 *   4. flat white thermal radiators angled well off the array plane
 *   5. dish antennas and a docked visiting-vehicle capsule
 *
 * ELEVEN draw calls against six shared materials: one instanced lattice bay
 * for the entire spine, four merged static buffers (hull / foil / alloy /
 * dark), and six small instanced sets (seams, handrails, wings, radiators,
 * dishes, beacons). The previous relay bird spent ~25 draws on far less
 * craft. The waypoint contract is untouched: position is wp.bodyPos and EVERY
 * dimension is a fraction of wp.bodyRadius, so src/engine/space.ts still owns
 * the size.
 * ======================================================================== */

const HALF_PI = Math.PI / 2;

/** The dish: a true paraboloid of revolution (y = depth·(x/R)²), not a cone.
 *  A cone has a straight profile and photographs as a lampshade; the curved
 *  profile is what catches the key light as a bright crescent across the
 *  bowl, which is the single tell that says "antenna". */
function makeDishGeometry(radius: number, depth: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Never exactly zero: a degenerate lathe pole yields NaN normals.
    pts.push(new THREE.Vector2(Math.max(radius * t, radius * 1e-3), depth * t * t));
  }
  return new THREE.LatheGeometry(pts, 32);
}

/** ONE lattice bay: four longerons, a closing end frame, and a diagonal on
 *  every face with alternating sense so the lattice zig-zags instead of
 *  reading as four parallel bars. Instanced ISS.bays times, this single buffer
 *  is the whole truss — and the truss is what makes the silhouette read as the
 *  ISS rather than as a generic satellite. */
function makeTrussBay(r: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const len = r * ISS.bayLen;
  const w = r * ISS.trussR;
  const t = r * ISS.memberT;
  for (const sy of [1, -1]) {
    for (const sz of [1, -1]) {
      bakePart(parts, new THREE.BoxGeometry(len, t, t), bakeTrs(0, sy * w, sz * w));
    }
  }
  const x0 = -len / 2 + t * 0.5;
  for (const sy of [1, -1]) {
    bakePart(parts, new THREE.BoxGeometry(t, t, w * 2), bakeTrs(x0, sy * w, 0));
  }
  for (const sz of [1, -1]) {
    bakePart(parts, new THREE.BoxGeometry(t, w * 2, t), bakeTrs(x0, 0, sz * w));
  }
  const span = Math.hypot(len, w * 2);
  const ang = Math.atan2(w * 2, len);
  const d = t * 0.82;
  bakePart(parts, new THREE.BoxGeometry(span, d, d), bakeTrs(0, w, 0, 0, -ang, 0));
  bakePart(parts, new THREE.BoxGeometry(span, d, d), bakeTrs(0, -w, 0, 0, ang, 0));
  bakePart(parts, new THREE.BoxGeometry(span, d, d), bakeTrs(0, 0, w, 0, 0, ang));
  bakePart(parts, new THREE.BoxGeometry(span, d, d), bakeTrs(0, 0, -w, 0, 0, -ang));
  return bakeMerge(parts);
}

type StationBuild = {
  bay: THREE.BufferGeometry;
  hull: THREE.BufferGeometry;
  foil: THREE.BufferGeometry;
  alloy: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
  wing: THREE.BufferGeometry;
  radiator: THREE.BufferGeometry;
  dish: THREE.BufferGeometry;
  seam: THREE.BufferGeometry;
  greeble: THREE.BufferGeometry;
  trussAt: Placement[];
  seamAt: Placement[];
  greebleAt: Placement[];
  wingAt: Placement[];
  radiatorAt: Placement[];
  dishAt: Placement[];
  beacon: THREE.BufferGeometry;
  beaconAt: Placement[];
};

/** Assemble the whole station once per mount. Nothing in here runs per frame;
 *  the return value is a bundle of GPU-ready buffers plus the instance tables
 *  that place them. */
function buildStation(r: number): StationBuild {
  const S = ISS;
  const trussHalf = (S.bays * S.bayLen * r) / 2;
  const hullParts: THREE.BufferGeometry[] = [];
  const foilParts: THREE.BufferGeometry[] = [];
  const alloyParts: THREE.BufferGeometry[] = [];
  const darkParts: THREE.BufferGeometry[] = [];
  const trussAt: Placement[] = [];
  const seamAt: Placement[] = [];
  const greebleAt: Placement[] = [];
  const wingAt: Placement[] = [];
  const radiatorAt: Placement[] = [];

  /* ---- 1. the spine ---------------------------------------------------- */
  for (let i = 0; i < S.bays; i++) {
    trussAt.push(place((i - (S.bays - 1) / 2) * S.bayLen * r, 0, 0));
  }
  for (const sx of [1, -1]) {
    // Blanketed equipment pallet capping each end of the spine.
    bakePart(
      foilParts,
      new THREE.BoxGeometry(r * 0.16, r * 0.19, r * 0.19),
      bakeTrs(sx * (trussHalf - r * 0.08), 0, 0),
    );
  }

  /* ---- 2. rotary joints, gimbals, masts, wings -------------------------- */
  const wingMid = (S.wingRoot + S.wingLen / 2) * r;
  for (const sx of [1, -1]) {
    const jx = sx * S.jointX * r;
    // Solar alpha rotary joint: the barrel the outboard array section turns
    // on. It lies ALONG the truss, which is what makes it read as a joint
    // rather than as another equipment can.
    bakePart(
      alloyParts,
      new THREE.CylinderGeometry(S.sarjR * r, S.sarjR * r, S.sarjL * r, 16),
      bakeTrs(jx, 0, 0, 0, 0, HALF_PI),
    );
    bakePart(
      darkParts,
      new THREE.CylinderGeometry(S.sarjR * r * 1.07, S.sarjR * r * 1.07, S.sarjL * r * 0.28, 16),
      bakeTrs(jx, 0, 0, 0, 0, HALF_PI),
    );
    for (const sz of [1, -1]) {
      // Beta gimbal barrel at each wing root — the second axis.
      bakePart(
        alloyParts,
        new THREE.CylinderGeometry(S.betaR * r, S.betaR * r, S.wingRoot * r * 1.5, 12),
        bakeTrs(jx, 0, sz * S.wingRoot * r * 0.55, HALF_PI, 0, 0),
      );
      // Folding mast down the back of the blanket, proud of the -Y face so
      // the wing has a visible spine from below and clean cells from above.
      bakePart(
        alloyParts,
        new THREE.BoxGeometry(S.mastT * r, S.mastT * r, S.wingLen * r * 0.98),
        bakeTrs(jx, -(S.wingT / 2 + S.mastT * 0.6) * r, sz * wingMid),
      );
      wingAt.push(place(jx, 0, sz * wingMid));
    }
  }

  /* ---- 3. thermal radiators -------------------------------------------- */
  // Rotating about X tips the fan out of the array plane entirely, which is
  // the whole point: white rectangles parallel to the blue ones would just
  // read as a fifth wing that lost its cells. Starboard deploys forward,
  // port aft — the asymmetry is what a real heat-rejection system looks like.
  const radDrop = -Math.sin(S.radTilt);
  const radRun = Math.cos(S.radTilt);
  for (const sx of [1, -1]) {
    const sz = sx; // starboard fan forward, port fan aft
    // Beam the slats hang off, running along the truss.
    bakePart(
      alloyParts,
      new THREE.BoxGeometry(S.radGap * (S.radSlats + 0.4) * r, r * 0.04, r * 0.045),
      bakeTrs(sx * S.radX * r, -S.trussR * r, 0),
    );
    for (let k = 0; k < S.radSlats; k++) {
      const x = sx * S.radX * r + (k - (S.radSlats - 1) / 2) * S.radGap * r;
      radiatorAt.push(
        place(
          x,
          -S.trussR * r + radDrop * S.radLen * r * 0.5,
          sz * radRun * S.radLen * r * 0.5,
          sz > 0 ? S.radTilt : -S.radTilt,
          sz > 0 ? 0 : Math.PI,
          0,
        ),
      );
    }
  }

  /* ---- 4. the pressurised stack ----------------------------------------- */
  const my = S.modY * r;
  const seg = 18;
  // Contiguous end-to-end: aft service module, node with the cupola, lab,
  // forward node. Each module's seam rings sit on its end faces.
  const stack = [
    { rad: S.modR * 0.95, len: S.aftLen, z: 0.64 },
    { rad: S.modR, len: S.hubLen, z: 0.13 },
    { rad: S.modR * 0.93, len: S.labLen, z: -0.34 },
    { rad: S.modR * 0.99, len: S.fwdLen, z: -0.78 },
  ];
  for (const m of stack) {
    bakePart(
      hullParts,
      new THREE.CylinderGeometry(m.rad * r, m.rad * r, m.len * r, seg),
      bakeTrs(0, my, m.z * r, HALF_PI, 0, 0),
    );
    const k = m.rad / S.modR;
    for (const e of [-1, 1]) {
      seamAt.push(place(0, my, (m.z + (e * m.len) / 2) * r, 0, 0, 0, k, k, k));
    }
  }
  // MLI wraps on the aft service module — the gold that says "Russian segment"
  // and breaks the white run of cylinders.
  for (const z of [0.44, 0.84]) {
    bakePart(
      foilParts,
      new THREE.CylinderGeometry(S.modR * r * 0.98, S.modR * r * 0.98, r * 0.14, seg, 1, true),
      bakeTrs(0, my, z * r, HALF_PI, 0, 0),
    );
  }
  // Crosswise labs off the forward node — the perpendicular pair that stops
  // the stack reading as one long tube.
  for (const sx of [1, -1]) {
    bakePart(
      hullParts,
      new THREE.CylinderGeometry(S.sideR * r, S.sideR * r, S.sideLen * r, 14),
      bakeTrs(sx * S.sideX * r, my, -0.78 * r, 0, 0, HALF_PI),
    );
    bakePart(
      foilParts,
      new THREE.CylinderGeometry(
        S.sideR * r * 1.04,
        S.sideR * r * 1.04,
        S.sideLen * r * 0.32,
        14,
        1,
        true,
      ),
      bakeTrs(sx * (S.sideX + S.sideLen * 0.26) * r, my, -0.78 * r, 0, 0, HALF_PI),
    );
    const k = S.sideR / S.modR;
    seamAt.push(
      place(sx * (S.sideX + S.sideLen * 0.5) * r, my, -0.78 * r, 0, HALF_PI, 0, k, k, k),
    );
  }
  // Cupola: drum plus a dark glass dome, hanging off the node's nadir face.
  const cupY = my - S.modR * r - S.cupolaH * r * 0.5;
  bakePart(
    hullParts,
    new THREE.CylinderGeometry(S.cupolaR * r, S.cupolaR * r * 1.15, S.cupolaH * r, 14),
    bakeTrs(0, cupY, 0.13 * r),
  );
  bakePart(
    darkParts,
    new THREE.SphereGeometry(S.cupolaR * r * 0.95, 14, 8, 0, Math.PI * 2, 0, HALF_PI),
    bakeTrs(0, cupY - S.cupolaH * r * 0.5, 0.13 * r, Math.PI, 0, 0),
  );
  // Forward docking target.
  bakePart(
    darkParts,
    new THREE.CylinderGeometry(S.modR * r * 0.42, S.modR * r * 0.42, r * 0.03, 14),
    bakeTrs(0, my, -0.93 * r, HALF_PI, 0, 0),
  );
  // Struts tying the stack up to the spine — without them the modules float.
  const strutTop = -S.trussR * r;
  const strutBot = my + S.modR * r * 0.6;
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      bakePart(
        alloyParts,
        new THREE.BoxGeometry(r * 0.022, strutTop - strutBot, r * 0.022),
        bakeTrs(sx * r * 0.17, (strutTop + strutBot) / 2, sz * r * 0.22),
      );
    }
  }

  /* ---- 5. docked visiting vehicle --------------------------------------- */
  // Narrow end toward the station, ablative shield out — cheap, and it tells
  // the visitor the place is CREWED.
  const capZ = 1.15 * r;
  bakePart(
    hullParts,
    new THREE.CylinderGeometry(S.capR * r * 0.72, S.capR * r, S.capLen * r, 16),
    bakeTrs(0, my, capZ, -HALF_PI, 0, 0),
  );
  bakePart(
    foilParts,
    new THREE.CylinderGeometry(S.capR * r * 1.03, S.capR * r * 1.03, r * 0.09, 16, 1, true),
    bakeTrs(0, my, capZ - S.capLen * r * 0.22, HALF_PI, 0, 0),
  );
  bakePart(
    darkParts,
    new THREE.SphereGeometry(S.capR * r, 16, 8, 0, Math.PI * 2, 0, 1.1),
    bakeTrs(0, my, capZ + S.capLen * r * 0.5, HALF_PI, 0, 0),
  );

  /* ---- 6. handrails and truss greebles (one instanced unit box) ---------- */
  const railR = S.modR * r + S.railT * r * 0.9;
  for (const a of [-0.72, 0.72, 2.45, -2.45]) {
    for (const z of [0.62, -0.34]) {
      greebleAt.push(
        place(
          Math.sin(a) * railR,
          my + Math.cos(a) * railR,
          z * r,
          0,
          0,
          0,
          S.railT * r,
          S.railT * r,
          r * 0.5,
        ),
      );
    }
  }
  for (const sx of [1, -1]) {
    greebleAt.push(
      place(
        sx * S.sideX * r,
        my + S.sideR * r * 1.1,
        -0.78 * r,
        0,
        HALF_PI,
        0,
        S.railT * r,
        S.railT * r,
        S.sideLen * r * 0.7,
      ),
    );
    for (const k of [0.34, 0.74]) {
      greebleAt.push(
        place(sx * k * r, S.trussR * r * 1.35, 0, 0, 0, 0, r * 0.09, r * 0.07, r * 0.14),
      );
    }
  }

  /* ---- 7. antennas ------------------------------------------------------ */
  const dishAt: Placement[] = [
    place(-0.34 * r, S.trussR * r + r * 0.19, 0.16 * r, -0.55, 0.4, 0),
    place(0.92 * r, -S.trussR * r - r * 0.2, -0.12 * r, 2.4, -0.6, 0),
  ];
  bakePart(
    alloyParts,
    new THREE.CylinderGeometry(r * 0.018, r * 0.018, r * 0.16, 8),
    bakeTrs(-0.34 * r, S.trussR * r + r * 0.08, 0.16 * r),
  );
  bakePart(
    alloyParts,
    new THREE.CylinderGeometry(r * 0.018, r * 0.018, r * 0.16, 8),
    bakeTrs(0.92 * r, -S.trussR * r - r * 0.08, -0.12 * r),
  );

  return {
    bay: makeTrussBay(r),
    hull: bakeMerge(hullParts),
    foil: bakeMerge(foilParts),
    alloy: bakeMerge(alloyParts),
    dark: bakeMerge(darkParts),
    wing: new THREE.BoxGeometry(S.wingW * r, S.wingT * r, S.wingLen * r),
    radiator: new THREE.BoxGeometry(S.radW * r, S.radT * r, S.radLen * r),
    dish: makeDishGeometry(r * S.dishR, r * S.dishDepth),
    seam: new THREE.TorusGeometry(S.modR * r, S.seamT * r, 6, 22),
    greeble: new THREE.BoxGeometry(1, 1, 1),
    trussAt,
    seamAt,
    greebleAt,
    wingAt,
    radiatorAt,
    dishAt,
    // A nav lamp on BOTH truss tips, instanced into one draw. One lamp was
    // enough until the tracking yaw swung that tip behind the docked panel and
    // the station lost its only light — a station with no running light reads
    // as derelict.
    beacon: new THREE.SphereGeometry(r * S.beaconR, 10, 8),
    beaconAt: [
      place(trussHalf - r * 0.06, S.trussR * r * 1.6, 0),
      place(-(trussHalf - r * 0.06), S.trussR * r * 1.6, 0),
    ],
  };
}

function Outpost({ wp, reduced }: BodyProps) {
  const r = wp.bodyRadius;
  const trackRef = useRef<THREE.Group>(null);
  const attitudeRef = useRef<THREE.Group>(null);
  const trussRef = useRef<THREE.InstancedMesh>(null);
  const seamRef = useRef<THREE.InstancedMesh>(null);
  const greebleRef = useRef<THREE.InstancedMesh>(null);
  const wingRef = useRef<THREE.InstancedMesh>(null);
  const radiatorRef = useRef<THREE.InstancedMesh>(null);
  const dishRef = useRef<THREE.InstancedMesh>(null);
  const beaconRef = useRef<THREE.InstancedMesh>(null);

  const mli = mliTexture();
  const cells = solarCellTexture();

  const build = useMemo(() => buildStation(r), [r]);

  /* Six materials, each shared by every mesh that wears it.
   *
   * THE BRIGHTNESS CONTRACT: nothing on this craft is a light source except
   * the nav beacon. The old build wore near-white paint (#eef1f5) and a
   * glossy 0.22-roughness blanket, both of which clip the moment anything
   * warm reaches them — and the scene's Bloom keys off 0.85 luminance, so a
   * clipped face does not just go white, it SMEARS. Albedos here are grey,
   * roughnesses are high, and every emissive is a floor-fill (so no face goes
   * to void-black against the night HDRI) rather than a glow. No material on
   * the station sets toneMapped:false — that flag is what lets a surface
   * bypass ACES entirely and blow out on its own. */
  const mats = useMemo(() => {
    const foil = new THREE.MeshStandardMaterial({
      map: mli,
      bumpMap: mli,
      bumpScale: 0.3,
      // The MLI map is authored bright gold; multiplying it down is what keeps
      // the blanket under the bloom threshold when the key light hits it.
      color: '#9a9a9a',
      emissiveMap: mli,
      emissive: '#6b5320',
      emissiveIntensity: 0.09,
      metalness: 0.6,
      roughness: 0.55,
      envMapIntensity: 0.6,
    });
    const cell = new THREE.MeshStandardMaterial({
      map: cells,
      emissiveMap: cells,
      emissive: '#1e2452',
      emissiveIntensity: 0.09,
      // Roughness raised from 0.22: a mirror-smooth blanket threw a specular
      // hotspot that clipped and then bloomed into a white smear.
      metalness: 0.28,
      roughness: 0.46,
      envMapIntensity: 0.5,
    });
    const alloy = new THREE.MeshStandardMaterial({
      color: '#8f959d',
      emissive: '#2c3238',
      emissiveIntensity: 0.16,
      metalness: 0.78,
      roughness: 0.55,
      envMapIntensity: 0.55,
    });
    const hull = new THREE.MeshStandardMaterial({
      // Real ISS modules photograph as light GREY, never paper white.
      color: '#b9bec6',
      emissive: '#39414c',
      emissiveIntensity: 0.1,
      metalness: 0.05,
      roughness: 0.75,
      side: THREE.DoubleSide, // the dish is a shell: both faces must light
      envMapIntensity: 0.5,
    });
    const radiator = new THREE.MeshStandardMaterial({
      // Cooler and a shade darker than the module hull on purpose: at this
      // distance an identical grey merges the radiator fan into the pressurised
      // stack and both stop reading as anything.
      color: '#98a2ae',
      emissive: '#2f3742',
      emissiveIntensity: 0.09,
      metalness: 0.04,
      roughness: 0.88,
      side: THREE.DoubleSide,
      envMapIntensity: 0.45,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: '#23282e',
      emissive: '#161a1f',
      emissiveIntensity: 0.4,
      metalness: 0.45,
      roughness: 0.72,
      envMapIntensity: 0.5,
    });
    // The nav lamp. Not a ref on a JSX material any more: both truss tips wear
    // it through one InstancedMesh, so useFrame drives the material directly.
    const lamp = new THREE.MeshStandardMaterial({
      color: '#111111',
      emissive: '#ffffff',
      emissiveIntensity: NAV_LIGHT_STEADY,
    });
    return { foil, cell, alloy, hull, radiator, dark, lamp };
  }, [mli, cells]);

  useLayoutEffect(() => {
    applyPlacements(trussRef.current, build.trussAt);
    applyPlacements(seamRef.current, build.seamAt);
    applyPlacements(greebleRef.current, build.greebleAt);
    applyPlacements(wingRef.current, build.wingAt);
    applyPlacements(radiatorRef.current, build.radiatorAt);
    applyPlacements(dishRef.current, build.dishAt);
    applyPlacements(beaconRef.current, build.beaconAt);
  }, [build]);

  useEffect(
    () => () => {
      build.bay.dispose();
      build.hull.dispose();
      build.foil.dispose();
      build.alloy.dispose();
      build.dark.dispose();
      build.wing.dispose();
      build.radiator.dispose();
      build.dish.dispose();
      build.seam.dispose();
      build.greeble.dispose();
      build.beacon.dispose();
    },
    [build],
  );

  useEffect(
    () => () => {
      for (const m of Object.values(mats)) m.dispose();
    },
    [mats],
  );

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (!reduced) {
      // The existing contract: a slow whole-station yaw, the arrays crawling
      // sunward. This is the only accumulating rotation on the craft.
      const track = trackRef.current;
      if (track) track.rotation.y += OUTPOST_TRACK_YAW * delta;
      // Attitude wander: a shallow, NON-accumulating sway around the base
      // pose. A crewed station holds its arrays on the sun and its dishes on
      // the link — it does not tumble — so this is the deadband of a working
      // control system, not a drift.
      const g = attitudeRef.current;
      if (g) {
        g.rotation.x = SAT_POSE[0] + Math.sin(t * SAT_WANDER_RATE) * SAT_WANDER_AMP;
        g.rotation.z = SAT_POSE[2] + Math.sin(t * SAT_WANDER_RATE * 0.63 + 2.1) * SAT_WANDER_AMP;
      }
    }
    // Under reduced motion the nav light holds steady — a pulse is motion.
    mats.lamp.emissiveIntensity = reduced
      ? NAV_LIGHT_STEADY
      : 0.5 + Math.max(0, Math.sin(t * 2.2)) ** 6 * 2.4;
  });

  return (
    <group ref={trackRef} position={wp.bodyPos}>
      <group ref={attitudeRef} rotation={[SAT_POSE[0], SAT_POSE[1], SAT_POSE[2]]}>
        {/* 1 — the spine: one lattice bay, instanced end to end. Culling is
            off because the instances spread far past the bay's own bounding
            sphere. */}
        <instancedMesh
          ref={trussRef}
          args={[build.bay, mats.alloy, build.trussAt.length]}
          frustumCulled={false}
        />
        {/* 2-5 — the merged static buffers. Every cylinder, cone and box that
            wears one material arrives here as a single pre-transformed
            buffer. */}
        <mesh geometry={build.hull} material={mats.hull} />
        <mesh geometry={build.foil} material={mats.foil} />
        <mesh geometry={build.alloy} material={mats.alloy} />
        <mesh geometry={build.dark} material={mats.dark} />
        {/* 6-10 — the repeated kit. */}
        <instancedMesh
          ref={seamRef}
          args={[build.seam, mats.alloy, build.seamAt.length]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={greebleRef}
          args={[build.greeble, mats.alloy, build.greebleAt.length]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={wingRef}
          args={[build.wing, mats.cell, build.wingAt.length]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={radiatorRef}
          args={[build.radiator, mats.radiator, build.radiatorAt.length]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={dishRef}
          args={[build.dish, mats.hull, build.dishAt.length]}
          frustumCulled={false}
        />
        {/* 11 — nav beacons: the ONLY thing on this station that is allowed to
            be a light source. White, because the accent belongs to fire and
            sun. One at each truss tip so the tracking yaw can never hide the
            station's only running light. Steady under reduced motion, a slow
            blink otherwise. */}
        <instancedMesh
          ref={beaconRef}
          args={[build.beacon, mats.lamp, build.beaconAt.length]}
          frustumCulled={false}
        />
      </group>
    </group>
  );
}

/* ==== STAR CLUSTER ==== */

function Cluster({ wp }: { wp: Waypoint }) {
  // Deliberately no useFrame: a still cluster reads premium, twinkle reads
  // like a loading indicator. No motion also means no reduced gate needed.
  const { positions, colors } = useMemo(() => {
    const rand = mulberry32(wp.index * 5417 + 29);
    const positions = new Float32Array(CLUSTER_POINT_COUNT * 3);
    const colors = new Float32Array(CLUSTER_POINT_COUNT * 3);
    for (let i = 0; i < CLUSTER_POINT_COUNT; i++) {
      // Power falloff piles stars toward the core the way real clusters do.
      const r = Math.pow(rand(), 1.6) * wp.bodyRadius;
      const theta = rand() * Math.PI * 2;
      const zUnit = rand() * 2 - 1;
      const s = Math.sqrt(1 - zUnit * zUnit);
      positions[i * 3] = Math.cos(theta) * s * r;
      positions[i * 3 + 1] = Math.sin(theta) * s * r;
      positions[i * 3 + 2] = zUnit * r;
      scratchCol.copy(CLUSTER_WHITE).lerp(CLUSTER_WARM, rand());
      colors[i * 3] = scratchCol.r;
      colors[i * 3 + 1] = scratchCol.g;
      colors[i * 3 + 2] = scratchCol.b;
    }
    return { positions, colors };
  }, [wp.index, wp.bodyRadius]);

  const halos = useMemo(() => {
    const rand = mulberry32(wp.index * 271 + 5);
    return Array.from({ length: 4 }, () => ({
      x: (rand() - 0.5) * wp.bodyRadius,
      y: (rand() - 0.5) * wp.bodyRadius,
      z: (rand() - 0.5) * wp.bodyRadius * 0.5,
      scale: wp.bodyRadius * (0.45 + rand() * 0.45),
      opacity: 0.1 + rand() * 0.08,
    }));
  }, [wp.index, wp.bodyRadius]);

  return (
    <group position={wp.bodyPos}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.8}
          sizeAttenuation
          vertexColors
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
      {/* A few soft halos lift the field from "dots" to "gas and light". */}
      {halos.map((h, i) => (
        <sprite key={i} position={[h.x, h.y, h.z]} scale={[h.scale, h.scale, 1]}>
          <spriteMaterial
            map={glowTexture()}
            transparent
            opacity={h.opacity}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </sprite>
      ))}
    </group>
  );
}

/* ==== SUN — the finale ==== */

const SUN_VERT = `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const SUN_FRAG = `
uniform sampler2D uMap;
uniform vec3 uCore;
uniform vec3 uLimb;
uniform float uGain;
uniform float uDarken;
uniform float uContrast;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  // mu: 1 looking straight down at the disc centre, 0 at the silhouette.
  float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  // The map keeps its own colour — an earlier pass replaced it with a ramp
  // driven by luminance and the disc photographed as ASH, because a granular
  // greyscale under a near-white core is a cinder, not a star. The map is a
  // good orange; all this needs to do is expand its cells a little and then
  // redden them toward the edge.
  vec3 cell = texture2D(uMap, vUv).rgb;
  cell = clamp((cell - 0.5) * uContrast + 0.5, 0.0, 1.5);
  // Eddington limb darkening. The rim of a star is seen through a longer,
  // cooler column of gas, so it is both dimmer and redder than the centre —
  // and the dimming is what drops the silhouette back under the bloom pass's
  // threshold, which is how the disc gets a hard edge instead of a fuzz.
  float ld = 1.0 - uDarken + uDarken * mu;
  vec3 tint = mix(uLimb, uCore, pow(mu, 0.6));
  gl_FragColor = vec4(cell * tint * ld * uGain, 1.0);
}`;

function Sun({ wp, reduced }: BodyProps) {
  const tex = useSurfaceTexture(TEX.sun);
  const ref = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: tex },
          uCore: { value: new THREE.Color(SUN_CORE) },
          uLimb: { value: new THREE.Color(SUN_LIMB) },
          uGain: { value: SUN_GAIN },
          uDarken: { value: SUN_LIMB_DARKEN },
          uContrast: { value: SUN_CELL_CONTRAST },
        },
        vertexShader: SUN_VERT,
        fragmentShader: SUN_FRAG,
      }),
    [tex],
  );
  useEffect(() => () => material.dispose(), [material]);
  const coronaOuterRef = useRef<THREE.Sprite>(null);
  const coronaInnerRef = useRef<THREE.Sprite>(null);
  // Solved, not guessed: the intensity that lands SUN_LIGHT_AT_REF on the ship
  // at the sun dock, given decay 2 and the cutoff window.

  useFrame((state, delta) => {
    // Under reduced motion the JSX props already hold the still: base light
    // intensity, base corona scales, zero rotation.
    if (reduced) return;
    if (ref.current) ref.current.rotation.y += SUN_SPIN * delta;
    const t = state.clock.elapsedTime;
    const outer = coronaOuterRef.current;
    if (outer) {
      const s = wp.bodyRadius * CORONA_REACH * 2 * (1 + CORONA_BREATHE * Math.sin(t * 0.23));
      outer.scale.set(s, s, 1);
      outer.material.rotation = t * CORONA_ROT;
    }
    const inner = coronaInnerRef.current;
    if (inner) {
      // The aureole breathes at a fraction of the streamers' amplitude: it
      // sits ON the silhouette, and a ring that visibly pumps in and out
      // against a hard edge reads as a rendering wobble, not as plasma.
      const s =
        wp.bodyRadius * AUREOLE_REACH * 2 * (1 + CORONA_BREATHE * 0.35 * Math.sin(t * 0.31 + 1.7));
      inner.scale.set(s, s, 1);
      // Counter-rotation against the outer layer — the two halos slide over
      // each other, which is what makes the corona read as plasma, not decal.
      inner.material.rotation = -t * CORONA_ROT * 1.6;
    }
  });

  return (
    <group position={wp.bodyPos}>
      {/* The sun's local drama light does NOT live here — Scene3D renders it
          at this body's position, outside the group it culls during the
          landing. A light inside a hidden group leaves the scene's light
          set, three re-derives every program's light-count defines, and the
          whole pipeline recompiles mid-descent (measured: 41 programs, a
          visible stall on the first flight home). Keeping the light at scene
          level makes the light signature constant, which is what lets the
          cull be free. See SUN_LIGHT_* + sunLightIntensity(), exported. */}
      {/* The photosphere: unlit by construction. The star IS the light, and
          a standard material here was quietly asking the rig to shade it —
          which is why the disc had no shape of its own to lose. */}
      <mesh ref={ref} material={material}>
        <sphereGeometry args={[wp.bodyRadius, 64, 48]} />
      </mesh>
      {/* Streamers outside, hot ring on the limb inside. They breathe and
          counter-rotate in useFrame (frozen under reduced motion), so the two
          structures slide across each other — which is what sells plasma
          rather than a decal. */}
      <sprite
        ref={coronaOuterRef}
        scale={[wp.bodyRadius * CORONA_REACH * 2, wp.bodyRadius * CORONA_REACH * 2, 1]}
      >
        <spriteMaterial
          map={coronaTexture()}
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
      <sprite
        ref={coronaInnerRef}
        scale={[wp.bodyRadius * AUREOLE_REACH * 2, wp.bodyRadius * AUREOLE_REACH * 2, 1]}
      >
        <spriteMaterial
          map={aureoleTexture()}
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
    </group>
  );
}

/* ==== DISPATCH ==== */

function Body({
  wp,
  reduced,
  sunPos,
  landingRef,
}: LitBodyProps & { landingRef?: { current: number } }) {
  switch (wp.kind) {
    case 'earth':
      return (
        <Earth
          wp={wp}
          reduced={reduced}
          sunPos={sunPos}
          {...(landingRef ? { landingRef } : {})}
        />
      );
    case 'moon':
    case 'mars':
    case 'jupiter':
    case 'neptune':
      return <Planet wp={wp} reduced={reduced} sunPos={sunPos} kind={wp.kind} />;
    case 'saturn':
      return <Saturn wp={wp} reduced={reduced} sunPos={sunPos} />;
    case 'asteroids':
      return <Asteroids wp={wp} reduced={reduced} />;
    case 'nebula':
      return <Nebula wp={wp} reduced={reduced} />;
    case 'outpost':
      return <Outpost wp={wp} reduced={reduced} />;
    case 'cluster':
      return <Cluster wp={wp} />;
    case 'sun':
      return <Sun wp={wp} reduced={reduced} />;
    case 'earthReturn':
      // The landing waypoint shares waypoint 0's Earth — one planet, rendered
      // once. Painting a second globe at the same coordinates would z-fight.
      return null;
  }
}

export function SolarBodies({ waypoints, reduced, landingRef }: SolarBodiesProps) {
  // The limb shader wants the sun's world position, and the waypoint contract
  // already carries it — reading it from the roster here keeps SolarBodies'
  // props unchanged and means the two can never disagree about where the
  // scene's key light is.
  const sunPos = useMemo<Vec3>(
    () => waypoints.find((w) => w.kind === 'sun')?.bodyPos ?? [0, 0, -1000],
    [waypoints],
  );
  return (
    <group>
      {waypoints.map((wp) => (
        <Body
          key={wp.index}
          wp={wp}
          reduced={reduced}
          sunPos={sunPos}
          {...(landingRef ? { landingRef } : {})}
        />
      ))}
    </group>
  );
}
