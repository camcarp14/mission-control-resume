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
import type { Waypoint } from '../engine';
import { mulberry32 } from '../engine';

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
const NEBULA_PUFF_COUNT = 40;
const NEBULA_DRIFT_X = 2.8; // per-puff orbit excursion, world units
const NEBULA_DRIFT_Y = 2.2;
const NEBULA_SPEED_BASE = 0.04; // per-puff orbit rate floor, rad/s
const NEBULA_SPEED_VAR = 0.08; // + seeded variance on top of the floor
const CLUSTER_POINT_COUNT = 300;
const RING_TILT = 0.45;
const NAV_LIGHT_STEADY = 1.4; // emissive intensity when reduced (never pulses)
const OUTPOST_TRACK_YAW = 0.02; // rad/s — solar panels crawling sunward
const SUN_LIGHT_COLOR = '#ffd9a0';
const SUN_LIGHT_BASE = 600; // local-drama pointLight, decay 0, at world scale
const SUN_LIGHT_PULSE = 0.12; // ± fraction, split across two detuned sines
const CORONA_BREATHE = 0.04; // ± scale fraction on the corona sprites
const CORONA_ROT = 0.01; // rad/s outer corona drift; inner counter-rotates

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

let emberTexCache: THREE.CanvasTexture | null = null;
/** Ember puff: faint white core through #ff5c37 into deep char — the accent
 *  is allowed here because the nebula IS the fire imagery. */
function emberTexture(): THREE.CanvasTexture {
  emberTexCache ??= makeRadialTexture([
    [0, 'rgba(255,241,230,0.85)'],
    [0.22, 'rgba(255,92,55,0.5)'],
    [0.55, 'rgba(42,14,8,0.32)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  return emberTexCache;
}

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

/* ==== ATMOSPHERE — the fresnel limb glow that makes a sphere read as a
   world. Rendered on a slightly larger BackSide shell so only the rim
   survives; additive, so it costs one draw and never occludes. ==== */

const ATMOS_VERT = `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const ATMOS_FRAG = `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uFade;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.6) * uFade;
  gl_FragColor = vec4(uColor * rim * uIntensity, rim * uIntensity);
}`;

function Atmosphere({
  radius,
  color,
  intensity = 1,
  fadeRef,
}: {
  radius: number;
  color: string;
  intensity?: number;
  /** 0 = full shell, 1 = invisible — driven by the landing ramp. */
  fadeRef?: { current: number };
}) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(color) },
          uIntensity: { value: intensity },
          uFade: { value: 1 },
        },
        vertexShader: ATMOS_VERT,
        fragmentShader: ATMOS_FRAG,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      }),
    [color, intensity],
  );
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
      <sphereGeometry args={[radius, 48, 36]} />
    </mesh>
  );
}

/* Limb tints per world — restrained, never neon; the moon gets none (it has
 * no atmosphere and pretending otherwise reads as a rendering bug). */
const ATMOS_TINT: Partial<Record<RockyKind, { color: string; intensity: number }>> = {
  mars: { color: '#c77b57', intensity: 0.5 },
  jupiter: { color: '#d8c2a0', intensity: 0.55 },
  neptune: { color: '#5f86e8', intensity: 0.7 },
};

/* ==== EARTH ==== */

function Earth({ wp, reduced, landingRef }: BodyProps & { landingRef?: { current: number } }) {
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
          as the landing glow on the return approach. */}
      <Atmosphere
        radius={wp.bodyRadius * 1.07}
        color="#6f9fe8"
        intensity={1.15}
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

function Planet({ wp, reduced, kind }: BodyProps & { kind: RockyKind }) {
  const spec = PLANET_TUNING[kind];
  const tex = useSurfaceTexture(spec.url);
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
        <Atmosphere radius={wp.bodyRadius * 1.06} color={tint.color} intensity={tint.intensity} />
      )}
    </group>
  );
}

/* ==== SATURN ==== */

function Saturn({ wp, reduced }: BodyProps) {
  const tex = useSurfaceTexture(TEX.saturn);
  const ringTex = useSurfaceTexture(TEX.saturnRing);
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
      <Atmosphere radius={wp.bodyRadius * 1.06} color="#e0cf9e" intensity={0.5} />
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

type PuffSpec = {
  x: number;
  y: number;
  z: number;
  scale: number;
  opacity: number;
  phase: number;
  speed: number;
};

function Nebula({ wp, reduced }: BodyProps) {
  const groupRef = useRef<THREE.Group>(null);

  const puffs = useMemo<PuffSpec[]>(() => {
    const rand = mulberry32(wp.index * 1013 + 11);
    const out: PuffSpec[] = [];
    for (let i = 0; i < NEBULA_PUFF_COUNT; i++) {
      out.push({
        x: (rand() - 0.5) * 2 * wp.bodyRadius,
        y: (rand() - 0.5) * 2 * wp.bodyRadius * 0.8,
        z: (rand() - 0.5) * 2 * wp.bodyRadius * 0.6, // shallow — reads as a wall of smoke
        scale: 6 + rand() * 22,
        // Low opacities on additive blending smoulder instead of glowing neon.
        opacity: 0.05 + rand() * 0.17,
        phase: rand() * Math.PI * 2,
        speed: NEBULA_SPEED_BASE + rand() * NEBULA_SPEED_VAR,
      });
    }
    return out;
  }, [wp.index, wp.bodyRadius]);

  useFrame((state) => {
    if (reduced) return;
    const g = groupRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < g.children.length; i++) {
      const child = g.children[i];
      const p = puffs[i];
      if (!child || !p) continue;
      // Each puff orbits its own seed point — smoke shifting, not a field
      // spinning. Excursion and rate are ~2x the first pass so the backdrop
      // visibly smoulders instead of freezing on camera (live-site finding).
      child.position.x = p.x + Math.cos(t * p.speed + p.phase) * NEBULA_DRIFT_X;
      child.position.y = p.y + Math.sin(t * p.speed * 0.8 + p.phase) * NEBULA_DRIFT_Y;
    }
  });

  return (
    <group ref={groupRef} position={wp.bodyPos}>
      {puffs.map((p, i) => (
        <sprite key={i} position={[p.x, p.y, p.z]} scale={[p.scale, p.scale, 1]}>
          <spriteMaterial
            map={emberTexture()}
            transparent
            opacity={p.opacity}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </sprite>
      ))}
    </group>
  );
}

/* ==== OUTPOST — procedural relay station ==== */

function Outpost({ wp, reduced }: BodyProps) {
  const r = wp.bodyRadius;
  const trackRef = useRef<THREE.Group>(null);
  const groupRef = useRef<THREE.Group>(null);
  const lampRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((state, delta) => {
    if (!reduced) {
      // Whole-station yaw: the solar panels slowly tracking the sun — a
      // deliberate, mechanical motion layered under the drift tumble.
      const track = trackRef.current;
      if (track) track.rotation.y += OUTPOST_TRACK_YAW * delta;
      const g = groupRef.current;
      if (g) {
        // Two-axis tumble reads as an object adrift, not a turntable.
        g.rotation.y += 0.03 * delta;
        g.rotation.x += 0.011 * delta;
      }
    }
    const lamp = lampRef.current;
    if (lamp) {
      // Under reduced motion the nav light holds steady — a pulse is motion.
      lamp.emissiveIntensity = reduced
        ? NAV_LIGHT_STEADY
        : 0.5 + Math.max(0, Math.sin(state.clock.elapsedTime * 2.2)) ** 6 * 2.4;
    }
  });

  return (
    <group ref={trackRef} position={wp.bodyPos}>
      <group ref={groupRef} rotation={[0.2, 0.6, 0.1]}>
      {/* Central hull */}
      <mesh>
        <cylinderGeometry args={[r * 0.16, r * 0.16, r * 0.95, 20]} />
        <meshStandardMaterial color="#9aa0a8" metalness={0.55} roughness={0.4} />
      </mesh>
      {/* Solar-panel wings; the glossy face against rough spars fakes a grid
          without a texture. */}
      {[1, -1].map((side) => (
        <group key={side} position={[side * r * 0.72, 0, 0]}>
          <mesh>
            <boxGeometry args={[r * 1.05, r * 0.02, r * 0.42]} />
            <meshStandardMaterial color="#39424f" metalness={0.8} roughness={0.22} />
          </mesh>
          <mesh position={[0, r * 0.012, 0]}>
            <boxGeometry args={[r * 1.05, r * 0.006, r * 0.03]} />
            <meshStandardMaterial color="#2b323c" metalness={0.3} roughness={0.9} />
          </mesh>
          <mesh position={[0, r * 0.012, 0]} rotation={[0, Math.PI / 2, 0]}>
            <boxGeometry args={[r * 0.42, r * 0.006, r * 0.03]} />
            <meshStandardMaterial color="#2b323c" metalness={0.3} roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* Comms dish: open cone with a torus rim, aimed off-axis so it reads
          as pointing somewhere. */}
      <group position={[0, r * 0.55, 0]} rotation={[0.7, 0, 0]}>
        <mesh>
          <coneGeometry args={[r * 0.22, r * 0.1, 24, 1, true]} />
          <meshStandardMaterial color="#c2c6cc" side={THREE.DoubleSide} roughness={0.5} metalness={0.4} />
        </mesh>
        <mesh position={[0, r * 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[r * 0.22, r * 0.012, 8, 32]} />
          <meshStandardMaterial color="#7d838c" roughness={0.5} metalness={0.5} />
        </mesh>
      </group>
      {/* Nav light — white, because the accent belongs to fire and sun. */}
      <mesh position={[0, -r * 0.52, 0]}>
        <sphereGeometry args={[r * 0.05, 12, 10]} />
        <meshStandardMaterial
          ref={lampRef}
          color="#111111"
          emissive="#ffffff"
          emissiveIntensity={NAV_LIGHT_STEADY}
        />
      </mesh>
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

function Sun({ wp, reduced }: BodyProps) {
  const tex = useSurfaceTexture(TEX.sun);
  const ref = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const coronaOuterRef = useRef<THREE.Sprite>(null);
  const coronaInnerRef = useRef<THREE.Sprite>(null);

  useFrame((state, delta) => {
    // Under reduced motion the JSX props already hold the still: base light
    // intensity, base corona scales, zero rotation.
    if (reduced) return;
    if (ref.current) ref.current.rotation.y += SUN_SPIN * delta;
    const t = state.clock.elapsedTime;
    const light = lightRef.current;
    if (light) {
      // Two slow detuned sines sum to a ±SUN_LIGHT_PULSE breath that never
      // reads as a strobe — the furnace inhaling, not a warning light.
      light.intensity =
        SUN_LIGHT_BASE *
        (1 + SUN_LIGHT_PULSE * 0.5 * (Math.sin(t * 0.31) + Math.sin(t * 0.47)));
    }
    const outer = coronaOuterRef.current;
    if (outer) {
      const s = wp.bodyRadius * 3.6 * (1 + CORONA_BREATHE * Math.sin(t * 0.23));
      outer.scale.set(s, s, 1);
      outer.material.rotation = t * CORONA_ROT;
    }
    const inner = coronaInnerRef.current;
    if (inner) {
      const s = wp.bodyRadius * 2.5 * (1 + CORONA_BREATHE * Math.sin(t * 0.31 + 1.7));
      inner.scale.set(s, s, 1);
      // Counter-rotation against the outer layer — the two halos slide over
      // each other, which is what makes the corona read as plasma, not decal.
      inner.material.rotation = -t * CORONA_ROT * 1.6;
    }
  });

  return (
    <group position={wp.bodyPos}>
      {/* Local drama light: the SpaceEnvironment key light stays authoritative
          for the scene; this warm pool makes anything that flies NEAR the sun
          (the ship, the corona-side limb) catch fire. decay 0 with a distance
          cutoff keeps it a local pool rather than a second global key. */}
      <pointLight
        ref={lightRef}
        color={SUN_LIGHT_COLOR}
        intensity={SUN_LIGHT_BASE}
        decay={0}
        distance={wp.bodyRadius * 8}
      />
      <mesh ref={ref}>
        <sphereGeometry args={[wp.bodyRadius, 64, 48]} />
        {/* The texture doubles as emissiveMap so granulation survives into
            the emissive channel; intensity 1.6 is what the Bloom pass keys
            off for the finale swell. */}
        <meshStandardMaterial
          map={tex}
          emissiveMap={tex}
          emissive="#ffffff"
          emissiveIntensity={1.6}
          roughness={1}
          metalness={0}
        />
      </mesh>
      {/* Two corona layers at different scales avoid a hard halo edge; they
          breathe ±4% and counter-rotate in useFrame (frozen under reduced). */}
      <sprite ref={coronaOuterRef} scale={[wp.bodyRadius * 3.6, wp.bodyRadius * 3.6, 1]}>
        <spriteMaterial
          map={emberTexture()}
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
      <sprite ref={coronaInnerRef} scale={[wp.bodyRadius * 2.5, wp.bodyRadius * 2.5, 1]}>
        <spriteMaterial
          map={glowTexture()}
          transparent
          opacity={0.5}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
    </group>
  );
}

/* ==== DISPATCH ==== */

function Body({ wp, reduced, landingRef }: BodyProps & { landingRef?: { current: number } }) {
  switch (wp.kind) {
    case 'earth':
      return <Earth wp={wp} reduced={reduced} {...(landingRef ? { landingRef } : {})} />;
    case 'moon':
    case 'mars':
    case 'jupiter':
    case 'neptune':
      return <Planet wp={wp} reduced={reduced} kind={wp.kind} />;
    case 'saturn':
      return <Saturn wp={wp} reduced={reduced} />;
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
  return (
    <group>
      {waypoints.map((wp) => (
        <Body
          key={wp.index}
          wp={wp}
          reduced={reduced}
          {...(landingRef ? { landingRef } : {})}
        />
      ))}
    </group>
  );
}
