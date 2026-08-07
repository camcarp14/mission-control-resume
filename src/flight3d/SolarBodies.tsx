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
};

type BodyProps = { wp: Waypoint; reduced: boolean };

/* ---- tunable constants ---------------------------------------------------
 * Spin rates are rad/s; they are deliberately an order of magnitude slower
 * than "screensaver" speed because the bodies are vistas, not toys. */
const EARTH_SPIN = 0.02;
const CLOUD_COUNTER_SPIN = 0.006; // opposite sign to the globe — sells depth
const SUN_SPIN = 0.006;
const ASTEROID_COUNT = 120;
const ASTEROID_DRIFT = 0.004; // collective field rotation, barely perceptible
const NEBULA_PUFF_COUNT = 40;
const CLUSTER_POINT_COUNT = 300;
const RING_TILT = 0.45;
const NAV_LIGHT_STEADY = 1.4; // emissive intensity when reduced (never pulses)

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

/* ==== EARTH ==== */

function Earth({ wp, reduced }: BodyProps) {
  const day = useSurfaceTexture(TEX.earthDay);
  const night = useSurfaceTexture(TEX.earthNight);
  // Clouds drive alpha, not color, so they stay in linear space.
  const clouds = useSurfaceTexture(TEX.earthClouds, false);
  const globeRef = useRef<THREE.Mesh>(null);
  const cloudRef = useRef<THREE.Mesh>(null);

  useFrame((_state, delta) => {
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
            cities without washing out the lit side. */}
        <meshStandardMaterial
          map={day}
          emissiveMap={night}
          emissive="#ffffff"
          emissiveIntensity={0.6}
          roughness={0.9}
          metalness={0}
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
    </group>
  );
}

/* ==== TEXTURED ROCKY / GAS PLANETS ==== */

type RockyKind = 'moon' | 'mars' | 'jupiter' | 'neptune';

/* Distinct spin rates and tilts so the four simple spheres never read as
 * copies of one another. Jupiter spins fastest — the real one does too. */
const PLANET_TUNING: Record<RockyKind, { url: string; spin: number; tilt: number }> = {
  moon: { url: '/textures/2k_moon.webp', spin: 0.006, tilt: 0.03 },
  mars: { url: '/textures/2k_mars.webp', spin: 0.024, tilt: 0.44 },
  jupiter: { url: '/textures/2k_jupiter.webp', spin: 0.058, tilt: 0.06 },
  neptune: { url: '/textures/2k_neptune.webp', spin: 0.042, tilt: 0.49 },
};

function Planet({ wp, reduced, kind }: BodyProps & { kind: RockyKind }) {
  const spec = PLANET_TUNING[kind];
  const tex = useSurfaceTexture(spec.url);
  const ref = useRef<THREE.Mesh>(null);

  useFrame((_state, delta) => {
    if (reduced) return;
    if (ref.current) ref.current.rotation.y += spec.spin * delta;
  });

  return (
    <group position={wp.bodyPos} rotation={[0, 0, spec.tilt]}>
      <mesh ref={ref}>
        <sphereGeometry args={[wp.bodyRadius, 48, 36]} />
        <meshStandardMaterial map={tex} roughness={0.95} metalness={0} />
      </mesh>
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
    if (sphereRef.current) sphereRef.current.rotation.y += 0.05 * delta;
  });

  return (
    // One tilt on the group keeps the ring plane and the spin axis agreeing.
    <group position={wp.bodyPos} rotation={[0.08, 0, RING_TILT]}>
      <mesh ref={sphereRef}>
        <sphereGeometry args={[wp.bodyRadius, 48, 36]} />
        <meshStandardMaterial map={tex} roughness={0.95} metalness={0} />
      </mesh>
      <mesh geometry={ringGeo} rotation={[Math.PI / 2, 0, 0]}>
        {/* depthWrite off so the translucent ring never punches sorting holes
            against the globe behind it. */}
        <meshStandardMaterial
          map={ringTex}
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
          roughness={0.9}
          metalness={0}
        />
      </mesh>
    </group>
  );
}

/* ==== ASTEROID FIELD ==== */

function Asteroids({ wp, reduced }: BodyProps) {
  const ref = useRef<THREE.InstancedMesh>(null);

  // Instance matrices are written once — a static field only needs its
  // collective drift, never per-rock updates.
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rand = mulberry32(wp.index * 7919 + 3);
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const ang = rand() * Math.PI * 2;
      // sqrt keeps the disc density uniform instead of center-clumped.
      const r = Math.sqrt(rand()) * wp.bodyRadius;
      scratchObj.position.set(
        Math.cos(ang) * r,
        (rand() - 0.5) * wp.bodyRadius * 0.28, // flattened — a belt, not a swarm
        Math.sin(ang) * r,
      );
      scratchObj.rotation.set(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2);
      scratchObj.scale.setScalar(0.3 + rand() * 1.3);
      scratchObj.updateMatrix();
      mesh.setMatrixAt(i, scratchObj.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [wp.index, wp.bodyRadius]);

  useFrame((_state, delta) => {
    if (reduced) return;
    if (ref.current) ref.current.rotation.y += ASTEROID_DRIFT * delta;
  });

  return (
    // Culling is off because the instances spread far beyond the unit
    // geometry's bounding sphere — three would cull the whole field.
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, ASTEROID_COUNT]}
      position={wp.bodyPos}
      frustumCulled={false}
    >
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#8d8d8d" roughness={0.95} metalness={0.05} />
    </instancedMesh>
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
        speed: 0.02 + rand() * 0.04,
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
      // Each puff orbits its own seed point a little — smoke shifting, not
      // a field spinning.
      child.position.x = p.x + Math.cos(t * p.speed + p.phase) * 1.4;
      child.position.y = p.y + Math.sin(t * p.speed * 0.8 + p.phase) * 1.1;
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
  const groupRef = useRef<THREE.Group>(null);
  const lampRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (g && !reduced) {
      // Two-axis tumble reads as an object adrift, not a turntable.
      g.rotation.y += 0.03 * delta;
      g.rotation.x += 0.011 * delta;
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
    <group ref={groupRef} position={wp.bodyPos} rotation={[0.2, 0.6, 0.1]}>
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

  useFrame((_state, delta) => {
    if (reduced) return;
    if (ref.current) ref.current.rotation.y += SUN_SPIN * delta;
  });

  return (
    <group position={wp.bodyPos}>
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
      {/* Two corona layers at different scales avoid a hard halo edge. */}
      <sprite scale={[wp.bodyRadius * 3.6, wp.bodyRadius * 3.6, 1]}>
        <spriteMaterial
          map={emberTexture()}
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
      <sprite scale={[wp.bodyRadius * 2.5, wp.bodyRadius * 2.5, 1]}>
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

function Body({ wp, reduced }: BodyProps) {
  switch (wp.kind) {
    case 'earth':
      return <Earth wp={wp} reduced={reduced} />;
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
  }
}

export function SolarBodies({ waypoints, reduced }: SolarBodiesProps) {
  return (
    <group>
      {waypoints.map((wp) => (
        <Body key={wp.index} wp={wp} reduced={reduced} />
      ))}
    </group>
  );
}
