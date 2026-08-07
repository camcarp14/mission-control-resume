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
import { useGLTF } from '@react-three/drei';
import { mulberry32 } from '../engine';
import type { Waypoint } from '../engine';

const ASTRONAUT_URL = '/models/astronaut.glb';
const SPACESHIP_URL = '/models/spaceship.glb';

useGLTF.preload(ASTRONAUT_URL);
useGLTF.preload(SPACESHIP_URL);

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
const ROCK_COLOR = '#7d8187'; // greyscale per the palette contract

const ENV_MAP_INTENSITY = 0.55; // the single sanctioned GLB material mutation

/* ---- module-scope temps and shared resources (zero per-frame allocs) ---- */

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _dummy = new THREE.Object3D();

// One geometry + material for every rock in every cluster — flat-shaded
// dodecahedra read as rubble at silhouette distance.
const ROCK_GEOMETRY = new THREE.DodecahedronGeometry(1, 0);
const ROCK_MATERIAL = new THREE.MeshStandardMaterial({
  color: ROCK_COLOR,
  roughness: 0.95,
  metalness: 0.05,
  flatShading: true,
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
      {/* GLBs suspend while loading; the dust and rocks above must not wait
          on the network, so the model props get their own boundary. */}
      <Suspense fallback={null}>
        {outpost ? <LostAstronaut anchor={outpost} reduced={reduced} /> : null}
        <DeepFlyby waypoints={waypoints} reduced={reduced} />
      </Suspense>
    </group>
  );
}
