/* ==== DRESSING ===============================================================
 *
 * The "world is alive" layer — everything that makes the voyage feel occupied
 * and in motion without belonging to any one station: a dust corridor that
 * sweeps past the lens during travel (the single biggest "we are moving" cue),
 * a lost astronaut tumbling near the outpost, a distant ship crossing the deep
 * background, and the occasional rock cluster drifting off the flight line.
 *
 * Everything is seeded through mulberry32 so the scene is identical on every
 * visit, all continuous motion is gated behind `reduced` (which renders a
 * composed still instead), and every temp object is hoisted to module scope —
 * the frame loop allocates nothing.
 * ========================================================================= */

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useTexture } from '@react-three/drei';
import { mulberry32 } from '../engine';
import type { Vec3, Waypoint } from '../engine';

const ASTRONAUT_URL = '/models/astronaut.glb';
const SPACESHIP_URL = '/models/spaceship.glb';
const MOON_TEXTURE_URL = '/textures/2k_moon.webp'; // same vendored map SolarBodies uses

useGLTF.preload(ASTRONAUT_URL);
useGLTF.preload(SPACESHIP_URL);
useTexture.preload(MOON_TEXTURE_URL);

/* ---- tunables ----------------------------------------------------------- */

// Dust corridor: a long box hugging the whole flight line. Near points sweep
// past the camera during travel; at dock the additive shimmer reads as vacuum
// that is not quite empty.
const DUST_SEED = 0xd057;
const DUST_COUNT = 700;
const DUST_X = 70; // half-width of the corridor
const DUST_Y = 40; // half-height
const DUST_Z_NEAR = 40; // starts behind the departure camera
const DUST_Z_PAD = 60; // extends past the deepest waypoint
const DUST_SIZE = 0.35;
const DUST_OPACITY = 0.5;
const DUST_COLOR = '#cfe0f0'; // white-blue, additive
const DUST_SPIN = 0.004; // rad/s around the flight axis
const DUST_BOB_AMP = 1.4; // world units of vertical breathing
const DUST_BOB_FREQ = 0.07; // rad/s

// Astronaut: a tiny lost human near the outpost relay.
const ASTRONAUT_OFFSET: [number, number, number] = [14, 6, -8]; // from outpost bodyPos
const ASTRONAUT_HEIGHT = 2.5; // world units tall
const ASTRONAUT_TUMBLE_X = 0.06; // rad/s — slow end-over-end
const ASTRONAUT_TUMBLE_Y = 0.03;
const ASTRONAUT_STILL_POSE: [number, number, number] = [0.55, 0.9, 0.12];
const GLOW_COLOR = '#4cc9f0'; // permitted cool cyan, kept faint
const GLOW_OPACITY = 0.3;
const GLOW_SCALE = 5.5;

// Flyby: a silhouette ship crossing the deep background near mid-voyage.
const FLYBY_CROSS_S = 90; // seconds to cross
const FLYBY_REST_S = 46; // unseen pause before it loops
const FLYBY_PERIOD_S = FLYBY_CROSS_S + FLYBY_REST_S;
const FLYBY_SIZE = 4; // silhouette scale in world units
const FLYBY_BANK = 0.42; // rad of roll along its direction
const FLYBY_PARK = 0.4; // reduced-motion park fraction along the path

// Rock clusters: seeded 30% chance per mid-voyage leg, always 25-40 units off
// the flight line so the corridor itself stays clear.
const ROCK_SEED = 0x70c4;
const ROCK_CHANCE = 0.3;
const ROCK_OFFSET_MIN = 25;
const ROCK_OFFSET_MAX = 40;
const ROCK_COUNT_MIN = 5;
const ROCK_COUNT_MAX = 9;
const ROCK_SPREAD_MIN = 2.2; // cluster-local radius
const ROCK_SPREAD_MAX = 6.5;
const ROCK_SCALE_MIN = 0.6;
const ROCK_SCALE_MAX = 1.9;
const ROCK_COLOR = '#565b61'; // cool slate — matches the belt's de-browned palette
const ROCK_CRAG_SEED = 0x50c7; // shapes the one shared rubble geometry
// three's PolyhedronGeometry subdivides (detail+1)² triangles per icosa face,
// so detail 3 is the 320-tri icosphere — same budget as the belt's smaller
// variants in SolarBodies.
const ROCK_DETAIL = 3;
// Multi-octave value noise over the sphere direction — multi-scale lumps.
const ROCK_NOISE_OCTAVES = 3;
const ROCK_NOISE_FREQ = 2.3; // base lattice frequency across the unit sphere
const ROCK_NOISE_LACUNARITY = 2.1;
const ROCK_NOISE_GAIN = 0.5;
const ROCK_NOISE_AMP = 0.22; // displacement, × unit radius
// Seeded crater dents: smooth bowls with a raised rim annulus.
const ROCK_CRATER_MIN = 5; // craters, seeded in [MIN, MAX]
const ROCK_CRATER_MAX = 7;
const ROCK_CRATER_RADIUS_MIN = 0.35; // rad — angular reach
const ROCK_CRATER_RADIUS_MAX = 0.7;
const ROCK_CRATER_DEPTH_MIN = 0.08; // inward push at the bowl centre
const ROCK_CRATER_DEPTH_MAX = 0.2;
const ROCK_CRATER_RIM = 0.35; // rim lift, × that crater's depth
// Vertex-color AO + albedo, multiplying ROCK_COLOR.
const ROCK_AO_DARKEN = 0.45; // crevice/crater floors darken up to 45%
const ROCK_RIM_LIGHT = 0.08; // crater rims catch ~8% extra light
const ROCK_PATCH_FREQ = 1.3; // low-frequency warm/cool albedo field
const ROCK_PATCH_AMOUNT = 0.1; // ±10%

const ENV_MAP_INTENSITY = 0.55; // the single sanctioned GLB material mutation

// Hero neighborhood: the opening frame shows Earth filling the LEFT half and
// bare sky upper-right — these bodies densify that empty real estate so the
// first thing a visitor sees is a busy solar neighborhood. Everything sits
// past z = -55 or wide of the corridor so travel never clips it.
const HERO_SEED = 0x8e60;

// Earth's moon: orbits the hero Earth, position recomputed each frame from a
// phase angle; parked at its start position under reduced motion.
const MOON_RADIUS = 4.2;
const MOON_START: Vec3 = [2, 26, -80]; // high and near-central, floating clear above Earth's limb
const MOON_ORBIT_RATE = 0.008; // rad/s around Earth
const MOON_SPIN = 0.02; // rad/s self-rotation
const MOON_BUMP = 0.5; // mirrors SolarBodies' moon relief
const MOON_STILL_YAW = 1.9; // composed still pose for reduced motion
const EARTH_FALLBACK: Vec3 = [-47, 10.9, -39.6]; // hero Earth bodyPos, should the voyage thin out

// Decor planets: procedural canvas-banded spheres far beyond the corridor.
const GIANT_POS: Vec3 = [128, 30, -262]; // far upper-right and DEEP — distant ringed world, clear of the telemetry corridor
const GIANT_RADIUS = 9;
const GIANT_SPIN = 0.015; // rad/s
const GIANT_TILT: Vec3 = [0.35, 0, 0.45]; // the x tilt opens the ring to the camera
const GIANT_BANDS = ['#1d3a4f', '#24506b', '#2e6a86', '#1a2f40', '#24506b', '#1d3a4f'] as const;
const DWARF_POS: Vec3 = [-88, 30, -260]; // far left-high, pushed deep so it doesn't crowd Earth's upper limb
const DWARF_RADIUS = 5.5;
const DWARF_SPIN = 0.01; // rad/s
const DWARF_TILT: Vec3 = [0, 0, 0.3];
const DWARF_BANDS = ['#6b4a3a', '#5a3e30', '#6b4a3a', '#4e352a', '#6b4a3a', '#5a3e30'] as const;
const HERO_GLOW_SCALE = 3.4; // × body radius
const HERO_GLOW_OPACITY = 0.2;

// Mini-Saturn ring arc on the teal giant.
const HERO_RING_INNER = 1.5; // × radius
const HERO_RING_OUTER = 2.1;
const HERO_RING_OPACITY = 0.5;

// Two extra drifting rocks, high and deep in the hero frame's upper-right —
// above the telemetry corridor band.
const HERO_ROCK_COUNT = 2;
const HERO_ROCK_SCALE_MIN = 0.8;
const HERO_ROCK_SCALE_MAX = 1.6;
const HERO_ROCK_CLEARANCE = 12; // min world units from the camera flight path

/* ---- module-scope temps and shared resources (zero per-frame allocs) ---- */

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _dummy = new THREE.Object3D();

/* ---- seeded noise for the rock shaper ------------------------------------
 * Runs once at module load — never per frame. */

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
  let freq = ROCK_NOISE_FREQ;
  for (let o = 0; o < ROCK_NOISE_OCTAVES; o++) {
    sum += amp * (valueNoise3(x * freq, y * freq, z * freq, seed + o * 0x9e37) * 2 - 1);
    norm += amp;
    amp *= ROCK_NOISE_GAIN;
    freq *= ROCK_NOISE_LACUNARITY;
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

/** Rock geometry with photographic asteroid character (think Itokawa/Bennu):
 *  a welded icosphere displaced by seeded 3-octave value noise (multi-scale
 *  lumps), dented by 5-7 seeded craters (smooth bowls with raised rims), then
 *  triaxially squashed (~1.0/0.82/0.68) so the silhouette never reads as a
 *  sphere. Per-vertex color bakes crevice self-shadow (floors darken up to
 *  45%), ~8% rim light, and a low-frequency warm/cool albedo field — all
 *  multiplying ROCK_COLOR. Smooth vertex normals: real rubble at this scale
 *  reads smooth-lumpy, never faceted. (SolarBodies' asteroid belt carries the
 *  same technique; the two files deliberately do not import each other's
 *  internals.) */
function makeCraggyRockGeometry(seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);

  type Crater = { dir: THREE.Vector3; radius: number; depth: number };
  const craters: Crater[] = [];
  const craterCount =
    ROCK_CRATER_MIN + Math.floor(rng() * (ROCK_CRATER_MAX - ROCK_CRATER_MIN + 1));
  for (let c = 0; c < craterCount; c++) {
    const z = rng() * 2 - 1;
    const a = rng() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    craters.push({
      dir: new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s, z),
      radius: ROCK_CRATER_RADIUS_MIN + rng() * (ROCK_CRATER_RADIUS_MAX - ROCK_CRATER_RADIUS_MIN),
      depth: ROCK_CRATER_DEPTH_MIN + rng() * (ROCK_CRATER_DEPTH_MAX - ROCK_CRATER_DEPTH_MIN),
    });
  }

  // Triaxial squash — potato-oid, never round.
  const squashY = 0.76 + rng() * 0.12;
  const squashZ = 0.6 + rng() * 0.16;

  // Independent integer seeds for the shape and albedo noise fields.
  const shapeSeed = Math.floor(rng() * 0xffffffff);
  const patchSeed = Math.floor(rng() * 0xffffffff);

  const geo = weldedIcosahedron(ROCK_DETAIL);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();

    // Multi-scale lumps from fbm over the sphere direction.
    let len = 1 + ROCK_NOISE_AMP * fbm3(v.x, v.y, v.z, shapeSeed);

    // Craters: inward across the bowl, slightly outward on the rim annulus.
    let rim = 0;
    for (const crater of craters) {
      const ang = Math.acos(Math.min(1, Math.max(-1, v.dot(crater.dir))));
      if (ang >= crater.radius) continue;
      const t = ang / crater.radius;
      const bowl = 1 - smooth01(0, 0.72, t);
      const lip = smooth01(0.55, 0.82, t) * (1 - smooth01(0.82, 1, t));
      len += crater.depth * (ROCK_CRATER_RIM * lip - bowl);
      rim += lip;
    }

    // Baked AO + albedo, multiplying the slate material color.
    const inward = Math.max(0, 1 - len);
    const ao = Math.min(1, inward / (ROCK_NOISE_AMP + ROCK_CRATER_DEPTH_MAX));
    const shade = (1 - ROCK_AO_DARKEN * ao) * (1 + ROCK_RIM_LIGHT * Math.min(1, rim));
    const patch =
      valueNoise3(v.x * ROCK_PATCH_FREQ, v.y * ROCK_PATCH_FREQ, v.z * ROCK_PATCH_FREQ, patchSeed) *
        2 -
      1;
    colors[i * 3] = shade * (1 + ROCK_PATCH_AMOUNT * patch);
    colors[i * 3 + 1] = shade * (1 + ROCK_PATCH_AMOUNT * 0.3 * patch);
    colors[i * 3 + 2] = shade * (1 - ROCK_PATCH_AMOUNT * 0.7 * patch);

    pos.setXYZ(i, v.x * len, v.y * len * squashY, v.z * len * squashZ);
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals(); // indexed + welded → smooth regolith normals
  return geo;
}

// One geometry + material for every rock in every cluster and the hero
// loners — a single seeded rubble variant with baked vertex-color AO.
const ROCK_GEOMETRY = makeCraggyRockGeometry(ROCK_CRAG_SEED);
const ROCK_MATERIAL = new THREE.MeshStandardMaterial({
  color: ROCK_COLOR,
  vertexColors: true,
  // Matte regolith: dust-blanketed rock has almost no specular sheen.
  roughness: 0.93,
  metalness: 0.04,
});

// Soft radial disc, drawn once: map for the dust points (round, soft-edged
// sprites instead of hard GL squares) and for the astronaut's back-glow.
let glowTexture: THREE.CanvasTexture | null = null;
function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(196,226,244,0.55)');
    g.addColorStop(1, 'rgba(76,201,240,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

/* ---- GLB fitting -------------------------------------------------------- */

const preparedScenes = new WeakSet<THREE.Object3D>();

/** Traverse ONCE to set envMapIntensity (the only sanctioned mutation), then
 *  measure the scene so callers get a scale that hits a target world size and
 *  an offset that recentres the model on its bounds — a centred pivot is what
 *  makes the tumbles read as tumbles instead of orbits. */
function fitGltfScene(
  scene: THREE.Object3D,
  target: number,
  byHeight: boolean,
): { scale: number; offset: [number, number, number] } {
  if (!preparedScenes.has(scene)) {
    preparedScenes.add(scene);
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          (m as THREE.MeshStandardMaterial).envMapIntensity = ENV_MAP_INTENSITY;
        }
      }
    });
  }
  _box.setFromObject(scene);
  _box.getSize(_size);
  const dim = byHeight ? _size.y : Math.max(_size.x, _size.y, _size.z);
  const scale = dim > 1e-6 ? target / dim : 1;
  _box.getCenter(_center);
  return { scale, offset: [-_center.x * scale, -_center.y * scale, -_center.z * scale] };
}

/** Deepest z across all waypoints (camera anchors and bodies alike). */
function deepestZ(waypoints: Waypoint[]): number {
  let z = 0;
  for (const wp of waypoints) z = Math.min(z, wp.camPos[2], wp.bodyPos[2]);
  return z;
}

/* ---- 1. dust corridor --------------------------------------------------- */

function DustCorridor({ waypoints, reduced }: { waypoints: Waypoint[]; reduced: boolean }) {
  const pointsRef = useRef<THREE.Points>(null);

  const geometry = useMemo(() => {
    const rng = mulberry32(DUST_SEED);
    const zFar = deepestZ(waypoints) - DUST_Z_PAD;
    const positions = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      positions[i * 3] = (rng() * 2 - 1) * DUST_X;
      positions[i * 3 + 1] = (rng() * 2 - 1) * DUST_Y;
      positions[i * 3 + 2] = DUST_Z_NEAR + rng() * (zFar - DUST_Z_NEAR);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [waypoints]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => {
    if (reduced) return;
    const pts = pointsRef.current;
    if (!pts) return;
    const t = state.clock.elapsedTime;
    // Whole-field drift about the flight axis: near dust sweeps past the lens
    // during travel, and at dock the field shimmers instead of freezing.
    pts.rotation.z = t * DUST_SPIN;
    pts.position.y = Math.sin(t * DUST_BOB_FREQ) * DUST_BOB_AMP;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        map={getGlowTexture()}
        color={DUST_COLOR}
        size={DUST_SIZE}
        sizeAttenuation
        transparent
        opacity={DUST_OPACITY}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

/* ---- 2. drifting astronaut ---------------------------------------------- */

function LostAstronaut({ anchor, reduced }: { anchor: Waypoint; reduced: boolean }) {
  const { scene } = useGLTF(ASTRONAUT_URL);
  const fit = useMemo(() => fitGltfScene(scene, ASTRONAUT_HEIGHT, true), [scene]);
  const tumbleRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (reduced) return;
    const g = tumbleRef.current;
    if (!g) return;
    g.rotation.x += delta * ASTRONAUT_TUMBLE_X;
    g.rotation.y += delta * ASTRONAUT_TUMBLE_Y;
  });

  return (
    <group
      position={[
        anchor.bodyPos[0] + ASTRONAUT_OFFSET[0],
        anchor.bodyPos[1] + ASTRONAUT_OFFSET[1],
        anchor.bodyPos[2] + ASTRONAUT_OFFSET[2],
      ]}
    >
      {/* Faint cool halo behind the figure so the silhouette-dark suit still
          reads against near-black space. */}
      <sprite scale={[GLOW_SCALE, GLOW_SCALE, 1]} position={[0, 0.3, -2.2]}>
        <spriteMaterial
          map={getGlowTexture()}
          color={GLOW_COLOR}
          transparent
          opacity={GLOW_OPACITY}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
      {/* The still pose doubles as the tumble's starting phase, so reduced
          motion sees a composed drift, not a T-pose. */}
      <group ref={tumbleRef} rotation={ASTRONAUT_STILL_POSE}>
        <primitive object={scene} scale={fit.scale} position={fit.offset} />
      </group>
    </group>
  );
}

/* ---- 3. distant ship flyby ---------------------------------------------- */

function DeepFlyby({ waypoints, reduced }: { waypoints: Waypoint[]; reduced: boolean }) {
  const { scene } = useGLTF(SPACESHIP_URL);
  const fit = useMemo(() => fitGltfScene(scene, FLYBY_SIZE, false), [scene]);
  const groupRef = useRef<THREE.Group>(null);

  const path = useMemo(() => {
    const midZ = deepestZ(waypoints) / 2;
    const start = new THREE.Vector3(80, 16, midZ - 40);
    const end = new THREE.Vector3(-80, 4, midZ + 30);
    // Nose along the travel direction (+Z at the destination), then a fixed
    // bank about that axis — a straight crossing with level wings reads as a
    // prop on rails; the bank sells intent.
    _m4.lookAt(end, start, _up);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(_m4);
    quaternion.multiply(_q.setFromAxisAngle(_zAxis, FLYBY_BANK));
    const park: [number, number, number] = [
      start.x + (end.x - start.x) * FLYBY_PARK,
      start.y + (end.y - start.y) * FLYBY_PARK,
      start.z + (end.z - start.z) * FLYBY_PARK,
    ];
    return { start, end, quaternion, park };
  }, [waypoints]);

  // Reduced motion parks the ship mid-crossing forever — including when the
  // preference flips while the ship happens to be in its unseen reset window.
  useEffect(() => {
    const g = groupRef.current;
    if (!g || !reduced) return;
    g.position.set(path.park[0], path.park[1], path.park[2]);
    g.visible = true;
  }, [reduced, path]);

  useFrame((state) => {
    if (reduced) return;
    const g = groupRef.current;
    if (!g) return;
    const phase = state.clock.elapsedTime % FLYBY_PERIOD_S;
    const f = phase / FLYBY_CROSS_S;
    if (f >= 1) {
      // The long unseen reset: hidden, so it never visibly teleports back.
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.lerpVectors(path.start, path.end, f);
  });

  return (
    <group ref={groupRef} position={path.park} quaternion={path.quaternion}>
      <primitive object={scene} scale={fit.scale} position={fit.offset} />
    </group>
  );
}

/* ---- 4. mid-leg rock clusters ------------------------------------------- */

type RockSpec = {
  p: [number, number, number];
  r: [number, number, number];
  s: number;
};

type ClusterSpec = {
  key: number;
  center: [number, number, number];
  pose: [number, number, number];
  spin: [number, number];
  rocks: RockSpec[];
};

function buildClusters(waypoints: Waypoint[]): ClusterSpec[] {
  const rng = mulberry32(ROCK_SEED);
  const out: ClusterSpec[] = [];
  // Every leg between consecutive waypoints EXCEPT the final homecoming leg
  // (that one is the emotional beat home — no clutter).
  for (let i = 0; i < waypoints.length - 2; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    if (!a || !b) continue;
    if (rng() >= ROCK_CHANCE) continue;

    // Off the flight line: a random bearing in the cross-section plane at a
    // radius that clears the travel corridor by construction.
    const bearing = rng() * Math.PI * 2;
    const radius = ROCK_OFFSET_MIN + rng() * (ROCK_OFFSET_MAX - ROCK_OFFSET_MIN);
    const center: [number, number, number] = [
      (a.camPos[0] + b.camPos[0]) / 2 + Math.cos(bearing) * radius,
      (a.camPos[1] + b.camPos[1]) / 2 + Math.sin(bearing) * radius,
      (a.camPos[2] + b.camPos[2]) / 2,
    ];

    const count = ROCK_COUNT_MIN + Math.floor(rng() * (ROCK_COUNT_MAX - ROCK_COUNT_MIN + 1));
    const rocks: RockSpec[] = [];
    for (let k = 0; k < count; k++) {
      const ang = rng() * Math.PI * 2;
      const elev = (rng() - 0.5) * Math.PI;
      const rr = ROCK_SPREAD_MIN + rng() * (ROCK_SPREAD_MAX - ROCK_SPREAD_MIN);
      rocks.push({
        p: [
          Math.cos(ang) * Math.cos(elev) * rr,
          Math.sin(elev) * rr * 0.8,
          Math.sin(ang) * Math.cos(elev) * rr,
        ],
        r: [rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2],
        s: ROCK_SCALE_MIN + rng() * (ROCK_SCALE_MAX - ROCK_SCALE_MIN),
      });
    }

    out.push({
      key: i,
      center,
      pose: [rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2],
      spin: [0.03 + rng() * 0.05, 0.02 + rng() * 0.04],
      rocks,
    });
  }
  return out;
}

function RockCluster({ spec, reduced }: { spec: ClusterSpec; reduced: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < spec.rocks.length; i++) {
      const rock = spec.rocks[i];
      if (!rock) continue;
      _dummy.position.set(rock.p[0], rock.p[1], rock.p[2]);
      _dummy.rotation.set(rock.r[0], rock.r[1], rock.r[2]);
      _dummy.scale.setScalar(rock.s);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [spec]);

  useFrame((_, delta) => {
    if (reduced) return;
    const g = groupRef.current;
    if (!g) return;
    // Collective tumble: the cluster rotates as one body, which reads as a
    // loose gravitational clump rather than nine independent props.
    g.rotation.x += delta * spec.spin[0];
    g.rotation.y += delta * spec.spin[1];
  });

  return (
    <group ref={groupRef} position={spec.center} rotation={spec.pose}>
      <instancedMesh
        ref={meshRef}
        args={[ROCK_GEOMETRY, ROCK_MATERIAL, spec.rocks.length]}
        frustumCulled={false}
      />
    </group>
  );
}

/* ---- 5. hero neighborhood ------------------------------------------------ */

/* Deterministic canvas textures for the hero bodies — each drawn once and
 * cached at module scope, exactly like getGlowTexture above. */

function makeRadialHeroTexture(
  stops: ReadonlyArray<readonly [number, string]>,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [at, color] of stops) g.addColorStop(at, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 8x256 vertical strip of soft horizontal bands — canvas y maps to latitude
 *  on default sphere UVs, so the strip reads as gas-giant banding. Double
 *  gradient stops per band give plateaus with soft transitions. */
function makeBandTexture(bands: readonly string[]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    const n = bands.length;
    for (let i = 0; i < n; i++) {
      const band = bands[i];
      if (!band) continue;
      g.addColorStop((i + 0.2) / n, band);
      g.addColorStop((i + 0.8) / n, band);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let giantBandTex: THREE.CanvasTexture | null = null;
function getGiantBandTexture(): THREE.CanvasTexture {
  giantBandTex ??= makeBandTexture(GIANT_BANDS);
  return giantBandTex;
}

let dwarfBandTex: THREE.CanvasTexture | null = null;
function getDwarfBandTexture(): THREE.CanvasTexture {
  dwarfBandTex ??= makeBandTexture(DWARF_BANDS);
  return dwarfBandTex;
}

let tealGlowTex: THREE.CanvasTexture | null = null;
function getTealGlowTexture(): THREE.CanvasTexture {
  tealGlowTex ??= makeRadialHeroTexture([
    [0, 'rgba(214,240,248,0.85)'],
    [0.4, 'rgba(46,106,134,0.4)'],
    [1, 'rgba(46,106,134,0)'],
  ]);
  return tealGlowTex;
}

let amberGlowTex: THREE.CanvasTexture | null = null;
function getAmberGlowTexture(): THREE.CanvasTexture {
  amberGlowTex ??= makeRadialHeroTexture([
    [0, 'rgba(255,232,204,0.85)'],
    [0.4, 'rgba(198,138,88,0.38)'],
    [1, 'rgba(198,138,88,0)'],
  ]);
  return amberGlowTex;
}

let heroRingTex: THREE.CanvasTexture | null = null;
/** Concentric alpha bands for the ring arc. RingGeometry ships planar UVs
 *  normalized by outerRadius (outer edge lands at UV radius 0.5), so a radial
 *  gradient centred on the canvas lines up with the annulus by construction —
 *  band stops live between innerR/outerR (~0.71) and 1 of the gradient. */
function getHeroRingTexture(): THREE.CanvasTexture {
  heroRingTex ??= makeRadialHeroTexture([
    [0, 'rgba(0,0,0,0)'],
    [0.7, 'rgba(0,0,0,0)'],
    [0.735, 'rgba(196,220,232,0.85)'],
    [0.78, 'rgba(150,180,200,0.2)'],
    [0.83, 'rgba(196,220,232,0.75)'],
    [0.88, 'rgba(140,170,190,0.12)'],
    [0.93, 'rgba(186,212,226,0.55)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  return heroRingTex;
}

/* Earth's moon, sharing the hero frame with Earth itself. */

function HeroMoon({ earthPos, reduced }: { earthPos: Vec3; reduced: boolean }) {
  const tex = useTexture(MOON_TEXTURE_URL);
  // Mirror SolarBodies' surface-texture prep (anisotropy + sRGB) without
  // importing from it — drei caches one texture per url, so this mutation
  // during render is idempotent.
  if (tex.anisotropy !== 8 || tex.colorSpace !== THREE.SRGBColorSpace) {
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
  }
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  // Orbit parameters derive from the prescribed start position, so the moon
  // begins exactly where the hero frame wants it — high and near-central,
  // clear above Earth's limb — then swings around Earth.
  const orbit = useMemo(() => {
    const dx = MOON_START[0] - earthPos[0];
    const dz = MOON_START[2] - earthPos[2];
    return { radius: Math.hypot(dx, dz), phase: Math.atan2(dz, dx) };
  }, [earthPos]);

  // Reduced motion parks the moon at its start position in the still pose —
  // including when the preference flips mid-orbit.
  useEffect(() => {
    if (!reduced) return;
    groupRef.current?.position.set(MOON_START[0], MOON_START[1], MOON_START[2]);
    if (meshRef.current) meshRef.current.rotation.y = MOON_STILL_YAW;
  }, [reduced]);

  useFrame((state, delta) => {
    if (reduced) return;
    const g = groupRef.current;
    if (g) {
      // Negative phase direction: the moon sweeps up and away from the
      // corridor's near pinch (the +x bend of the station-0→1 leg) instead
      // of into it.
      const a = orbit.phase - state.clock.elapsedTime * MOON_ORBIT_RATE;
      g.position.set(
        earthPos[0] + Math.cos(a) * orbit.radius,
        MOON_START[1],
        earthPos[2] + Math.sin(a) * orbit.radius,
      );
    }
    if (meshRef.current) meshRef.current.rotation.y += MOON_SPIN * delta;
  });

  return (
    <group ref={groupRef} position={MOON_START}>
      <mesh ref={meshRef} rotation={[0, MOON_STILL_YAW, 0]}>
        <sphereGeometry args={[MOON_RADIUS, 48, 36]} />
        <meshStandardMaterial
          map={tex}
          bumpMap={tex}
          bumpScale={MOON_BUMP}
          roughness={0.95}
          metalness={0}
          envMapIntensity={ENV_MAP_INTENSITY}
        />
      </mesh>
    </group>
  );
}

/* Decor planets: cheap procedural spheres that fill the deep background. */

function HeroRing({ radius }: { radius: number }) {
  const geometry = useMemo(
    () => new THREE.RingGeometry(radius * HERO_RING_INNER, radius * HERO_RING_OUTER, 64, 1),
    [radius],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} rotation={[Math.PI / 2, 0, 0]}>
      <meshBasicMaterial
        map={getHeroRingTexture()}
        transparent
        opacity={HERO_RING_OPACITY}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

type DecorPlanetProps = {
  position: Vec3;
  tilt: Vec3;
  radius: number;
  spin: number;
  map: THREE.Texture;
  glowMap: THREE.Texture;
  withRing?: boolean;
  reduced: boolean;
};

function DecorPlanet({
  position,
  tilt,
  radius,
  spin,
  map,
  glowMap,
  withRing = false,
  reduced,
}: DecorPlanetProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (reduced) return;
    if (meshRef.current) meshRef.current.rotation.y += spin * delta;
  });

  return (
    <group position={position} rotation={tilt}>
      {/* Soft additive halo — depth-tested against the sphere so only the
          limb glow survives, a cheap stand-in for the fresnel atmosphere the
          station planets get. */}
      <sprite scale={[radius * HERO_GLOW_SCALE, radius * HERO_GLOW_SCALE, 1]}>
        <spriteMaterial
          map={glowMap}
          transparent
          opacity={HERO_GLOW_OPACITY}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
      <mesh ref={meshRef}>
        <sphereGeometry args={[radius, 40, 28]} />
        <meshStandardMaterial
          map={map}
          roughness={0.9}
          metalness={0}
          envMapIntensity={ENV_MAP_INTENSITY}
        />
      </mesh>
      {withRing ? <HeroRing radius={radius} /> : null}
    </group>
  );
}

/* Hero rocks: two loners, high and deep in the opening frame's upper-right. */

type HeroRockSpec = {
  p: Vec3;
  r: Vec3;
  s: number;
  spin: [number, number];
};

/** Min distance from a point to the engine's camera flight path
 *  (camPos = [38·sin(2.4i), 13·sin(1.7i + 1), -95i]), sampled across the legs
 *  the hero rocks share z-range with. */
function flightPathClearance(p: Vec3): number {
  let best = Infinity;
  for (let i = 0.5; i <= 1.6; i += 0.05) {
    const dx = p[0] - 38 * Math.sin(i * 2.4);
    const dy = p[1] - 13 * Math.sin(i * 1.7 + 1);
    const dz = p[2] + 95 * i;
    const d = Math.hypot(dx, dy, dz);
    if (d < best) best = d;
  }
  return best;
}

function buildHeroRocks(): HeroRockSpec[] {
  const rng = mulberry32(HERO_SEED);
  const out: HeroRockSpec[] = [];
  for (let i = 0; i < HERO_ROCK_COUNT; i++) {
    // The prescribed box (x 34-48, y 18-28, z -95..-130) skirts the
    // station-1 leg of the camera path, so seeded rejection sampling keeps
    // every rock clear of the flight line; the fallbacks are hand-checked
    // clear. Draw counts vary per rock but stay deterministic — one seed,
    // one sequence.
    let p: Vec3 = [42, 24, -108 - i * 14];
    for (let tries = 0; tries < 20; tries++) {
      const cand: Vec3 = [34 + rng() * 14, 18 + rng() * 10, -95 - rng() * 35];
      if (flightPathClearance(cand) >= HERO_ROCK_CLEARANCE) {
        p = cand;
        break;
      }
    }
    out.push({
      p,
      r: [rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2],
      s: HERO_ROCK_SCALE_MIN + rng() * (HERO_ROCK_SCALE_MAX - HERO_ROCK_SCALE_MIN),
      spin: [0.03 + rng() * 0.05, 0.02 + rng() * 0.04],
    });
  }
  return out;
}

function HeroRocks({ reduced }: { reduced: boolean }) {
  const specs = useMemo(buildHeroRocks, []);
  const refs = useRef<Array<THREE.Mesh | null>>([]);

  useFrame((_, delta) => {
    if (reduced) return;
    for (let i = 0; i < specs.length; i++) {
      const mesh = refs.current[i];
      const spec = specs[i];
      if (!mesh || !spec) continue;
      mesh.rotation.x += delta * spec.spin[0];
      mesh.rotation.y += delta * spec.spin[1];
    }
  });

  return (
    <group>
      {specs.map((spec, i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          geometry={ROCK_GEOMETRY}
          material={ROCK_MATERIAL}
          position={spec.p}
          rotation={spec.r}
          scale={spec.s}
        />
      ))}
    </group>
  );
}

function HeroNeighborhood({ waypoints, reduced }: { waypoints: Waypoint[]; reduced: boolean }) {
  const earthPos = useMemo<Vec3>(() => {
    const earth = waypoints.find((w) => w.kind === 'earth');
    return earth ? earth.bodyPos : EARTH_FALLBACK;
  }, [waypoints]);

  return (
    <group>
      <DecorPlanet
        position={GIANT_POS}
        tilt={GIANT_TILT}
        radius={GIANT_RADIUS}
        spin={GIANT_SPIN}
        map={getGiantBandTexture()}
        glowMap={getTealGlowTexture()}
        withRing
        reduced={reduced}
      />
      <DecorPlanet
        position={DWARF_POS}
        tilt={DWARF_TILT}
        radius={DWARF_RADIUS}
        spin={DWARF_SPIN}
        map={getDwarfBandTexture()}
        glowMap={getAmberGlowTexture()}
        reduced={reduced}
      />
      <HeroRocks reduced={reduced} />
      {/* useTexture suspends on first load; the procedural bodies above must
          not wait on the network. */}
      <Suspense fallback={null}>
        <HeroMoon earthPos={earthPos} reduced={reduced} />
      </Suspense>
    </group>
  );
}

/* ---- public surface ------------------------------------------------------ */

export function Dressing({ waypoints, reduced }: { waypoints: Waypoint[]; reduced: boolean }) {
  const outpost = useMemo(() => waypoints.find((w) => w.kind === 'outpost') ?? null, [waypoints]);
  const clusters = useMemo(() => buildClusters(waypoints), [waypoints]);

  if (waypoints.length === 0) return null;

  return (
    <group>
      <DustCorridor waypoints={waypoints} reduced={reduced} />
      {clusters.map((spec) => (
        <RockCluster key={spec.key} spec={spec} reduced={reduced} />
      ))}
      <HeroNeighborhood waypoints={waypoints} reduced={reduced} />
      {/* GLBs suspend while loading; the dust and rocks above must not wait
          on the network, so the model props get their own boundary. */}
      <Suspense fallback={null}>
        {outpost ? <LostAstronaut anchor={outpost} reduced={reduced} /> : null}
        <DeepFlyby waypoints={waypoints} reduced={reduced} />
      </Suspense>
    </group>
  );
}
