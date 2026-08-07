/* ==== ROCKET 3D ==============================================================
 *
 * The craft itself, built entirely from primitives — the 2D SVG rocket it
 * replaces was hand-drawn, so its successor is hand-modelled: no imported
 * meshes, nothing we did not shape ourselves. The component renders at local
 * origin with the nose along local -Z and stays ~4 units long; the PARENT
 * owns position and orientation every frame, so nothing here reads the
 * flight path — the ship only knows how hard it is burning (thrustRef) and
 * whether motion is allowed (reduced).
 *
 * Palette contract: the hull is warm greys, and the single accent #ff5c37
 * appears exactly where fire is allowed — one paint stripe, the flame, and
 * the ember trail. The porthole glows cool so it never competes.
 * ========================================================================= */

import * as THREE from 'three';
import { forwardRef, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { mulberry32 } from '../engine';

const ACCENT = '#ff5c37';
const TAU = Math.PI * 2;

// Hull dimensions. The ship spans z in [-2.05, 2.05] — nose tip to bell lip —
// so the parent can treat "4 units" as the craft's whole envelope.
const NOSE_TIP_Z = -2.05;
const NOSE_LEN = 1.1;
const NOSE_R = 0.44;
const FUSELAGE_LEN = 2.5;
const FUSELAGE_R_NOSE = 0.44; // matches the nose cone base so the seam is clean
const FUSELAGE_R_TAIL = 0.5; // slight taper — wider at the tail reads "rocket"
const BELL_LEN = 0.5;
const BELL_R = 0.42;
const FUSELAGE_Z = NOSE_TIP_Z + NOSE_LEN + FUSELAGE_LEN / 2;
const BELL_Z = NOSE_TIP_Z + NOSE_LEN + FUSELAGE_LEN + BELL_LEN / 2;

// Fins: rooted slightly inside the hull so the joint never shows a gap, with
// one fin off the porthole's azimuth so the window is never occluded.
const FIN_THICKNESS = 0.05;
const FIN_ROOT_RADIUS = 0.4;
const FIN_ROOT_Z = 1.45;
const FIN_ANGLES = [Math.PI / 2, Math.PI / 2 + TAU / 3, Math.PI / 2 + (2 * TAU) / 3];

// Flame: unit-height cones inside a group whose scale.z IS the flame length,
// so thrust maps to one scalar write per frame. The flicker is two detuned
// sines (both inside the 8-14 Hz band) so the wobble never looks periodic.
const FLAME_ROOT_Z = 1.98; // tucked just inside the bell to hide the root
const FLAME_BASE_LEN = 0.5;
const FLAME_THRUST_GAIN = 2.2;
const FLICKER_HZ_A = 11;
const FLICKER_HZ_B = 8.3;
const FLICKER_AMP_A = 0.07;
const FLICKER_AMP_B = 0.05;

// Ember trail: a fixed ring buffer of points recycled in place — zero
// allocation per frame. Period x count leaves headroom over the particle
// life so a slot is always dead before it is reused.
const TRAIL_COUNT = 60;
const TRAIL_LIFE = 0.9; // seconds a particle takes to fade out
const TRAIL_EMIT_PERIOD = 0.018; // ~55 particles/s at full burn
const TRAIL_THRUST_MIN = 0.12; // coasting leaves no embers
const TRAIL_SPAWN_JITTER = 0.12;
// Accent #ff5c37 in linear-ish RGB — embers are fire, so accent is allowed.
const EMBER_R = 1.0;
const EMBER_G = 0.36;
const EMBER_B = 0.22;

// Seeded spawn jitter and drift so the ember cloud is identical every visit —
// the only "randomness" the ship is allowed comes from this table.
const TRAIL_SPAWN = new Float32Array(TRAIL_COUNT * 2);
const TRAIL_VEL = new Float32Array(TRAIL_COUNT * 3);
{
  const rand = mulberry32(0x0c4a7e);
  for (let i = 0; i < TRAIL_COUNT; i++) {
    TRAIL_SPAWN[i * 2] = (rand() - 0.5) * 2 * TRAIL_SPAWN_JITTER;
    TRAIL_SPAWN[i * 2 + 1] = (rand() - 0.5) * 2 * TRAIL_SPAWN_JITTER;
    TRAIL_VEL[i * 3] = (rand() - 0.5) * 0.6; // slight sideways scatter
    TRAIL_VEL[i * 3 + 1] = (rand() - 0.5) * 0.6;
    TRAIL_VEL[i * 3 + 2] = 2.6 + rand() * 1.4; // always drifting aft (+Z)
  }
}

// The fin is a swept triangle extruded once at module scope — shape x is the
// radial direction, shape y points toward the nose after the mesh rotation.
function makeFinGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.1);
  shape.lineTo(0, 1.15);
  shape.lineTo(0.55, 0.35);
  shape.lineTo(0.72, -0.18);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: FIN_THICKNESS, bevelEnabled: false });
  // Center the thickness so each fin sits symmetric on its radial plane.
  geo.translate(0, 0, -FIN_THICKNESS / 2);
  return geo;
}
const FIN_GEOMETRY = makeFinGeometry();

// Per-instance mutable trail state — arrays preallocated once, attributes
// reused forever, cursor/accumulator advance in place.
type TrailState = {
  positions: Float32Array;
  colors: Float32Array;
  ages: Float32Array;
  posAttr: THREE.BufferAttribute;
  colAttr: THREE.BufferAttribute;
  cursor: number;
  accum: number;
};

function makeTrailState(): TrailState {
  const positions = new Float32Array(TRAIL_COUNT * 3);
  const colors = new Float32Array(TRAIL_COUNT * 3);
  // Born dead: every slot starts past its life so nothing flashes on mount.
  const ages = new Float32Array(TRAIL_COUNT).fill(TRAIL_LIFE);
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  return { positions, colors, ages, posAttr, colAttr, cursor: 0, accum: 0 };
}

type Rocket3DProps = {
  /** 0..1 burn intensity, written by the parent every frame — read, never set. */
  thrustRef: { current: number };
  /** True freezes flicker and removes the ember trail; flame length still tracks thrust. */
  reduced: boolean;
};

export const Rocket3D = forwardRef<THREE.Group, Rocket3DProps>(function Rocket3D(
  { thrustRef, reduced },
  ref,
) {
  const flameRef = useRef<THREE.Group>(null);
  const trail = useMemo(makeTrailState, []);

  useFrame((state, rawDt) => {
    // Clamp dt so a backgrounded tab does not dump a giant step into the
    // emitter loop or teleport the embers on return.
    const dt = Math.min(rawDt, 0.05);
    const thrust = thrustRef.current;

    // Flame length always tracks thrust — that is state, not animation — but
    // the flicker is motion, so it is gated behind reduced.
    const flame = flameRef.current;
    if (flame) {
      let flicker = 1;
      if (!reduced) {
        const t = state.clock.elapsedTime;
        flicker =
          1 +
          FLICKER_AMP_A * Math.sin(t * FLICKER_HZ_A * TAU) +
          FLICKER_AMP_B * Math.sin(t * FLICKER_HZ_B * TAU + 1.7);
      }
      flame.scale.z = (FLAME_BASE_LEN + thrust * FLAME_THRUST_GAIN) * flicker;
    }

    // The trail is pure motion — under reduced it is not even rendered, so
    // there is nothing to simulate either.
    if (reduced) return;

    const { positions, colors, ages } = trail;

    // Age, drift, and fade every live particle in place. Dead slots get their
    // color zeroed, which with additive blending makes them invisible.
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const age = (ages[i] ?? TRAIL_LIFE) + dt;
      ages[i] = age;
      const k = i * 3;
      if (age >= TRAIL_LIFE) {
        colors[k] = 0;
        colors[k + 1] = 0;
        colors[k + 2] = 0;
        continue;
      }
      positions[k] = (positions[k] ?? 0) + (TRAIL_VEL[k] ?? 0) * dt;
      positions[k + 1] = (positions[k + 1] ?? 0) + (TRAIL_VEL[k + 1] ?? 0) * dt;
      positions[k + 2] = (positions[k + 2] ?? 0) + (TRAIL_VEL[k + 2] ?? 0) * dt;
      // Quadratic fade so embers die with a long dim tail, not a hard cut.
      const life = 1 - age / TRAIL_LIFE;
      const f = life * life;
      colors[k] = EMBER_R * f;
      colors[k + 1] = EMBER_G * f;
      colors[k + 2] = EMBER_B * f;
    }

    // Emit on a fixed cadence while burning; the accumulator resets when the
    // burn stops so a coast does not bank up a burst of embers.
    if (thrust > TRAIL_THRUST_MIN) {
      trail.accum += dt;
      while (trail.accum >= TRAIL_EMIT_PERIOD) {
        trail.accum -= TRAIL_EMIT_PERIOD;
        const i = trail.cursor;
        trail.cursor = (i + 1) % TRAIL_COUNT;
        ages[i] = 0;
        const k = i * 3;
        positions[k] = TRAIL_SPAWN[i * 2] ?? 0;
        positions[k + 1] = TRAIL_SPAWN[i * 2 + 1] ?? 0;
        positions[k + 2] = 0; // born at the bell lip, drifts aft from there
      }
    } else {
      trail.accum = 0;
    }

    trail.posAttr.needsUpdate = true;
    trail.colAttr.needsUpdate = true;
  });

  return (
    <group ref={ref}>
      {/* Nose cone — tip forward along -Z. */}
      <mesh position={[0, 0, NOSE_TIP_Z + NOSE_LEN / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[NOSE_R, NOSE_LEN, 32]} />
        <meshStandardMaterial color="#b7b2ab" roughness={0.55} metalness={0.2} />
      </mesh>

      {/* Fuselage — radiusTop lands on the tail end after the +90° X turn. */}
      <mesh position={[0, 0, FUSELAGE_Z]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[FUSELAGE_R_TAIL, FUSELAGE_R_NOSE, FUSELAGE_LEN, 32]} />
        <meshStandardMaterial color="#c9c4bc" roughness={0.6} metalness={0.15} />
      </mesh>

      {/* The one paint stripe — a thin proud band, matte so it never blooms. */}
      <mesh position={[0, 0, -0.55]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.458, 0.456, 0.07, 32]} />
        <meshStandardMaterial color={ACCENT} roughness={0.5} metalness={0.1} />
      </mesh>

      {/* Porthole: rim ring plus a faint cool glow — below the bloom
          threshold on purpose, it should read as a lit cabin, not a lamp. */}
      <group position={[0.46, 0, -0.2]} rotation={[0, Math.PI / 2, 0]}>
        <mesh>
          <torusGeometry args={[0.1, 0.022, 12, 24]} />
          <meshStandardMaterial color="#8f8b86" roughness={0.4} metalness={0.5} />
        </mesh>
        <mesh position={[0, 0, 0.004]}>
          <circleGeometry args={[0.078, 20]} />
          <meshStandardMaterial
            color="#171a1f"
            emissive="#dfe8f2"
            emissiveIntensity={0.7}
            roughness={0.3}
          />
        </mesh>
      </group>

      {/* Three fins at 120°, each rotated onto its radial plane. */}
      {FIN_ANGLES.map((angle) => (
        <group key={angle} rotation={[0, 0, angle]}>
          <mesh
            geometry={FIN_GEOMETRY}
            position={[FIN_ROOT_RADIUS, 0, FIN_ROOT_Z]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <meshStandardMaterial color="#9b9791" roughness={0.6} metalness={0.25} />
          </mesh>
        </group>
      ))}

      {/* Engine bell — open cone flaring aft, darker so the flame owns the eye. */}
      <mesh position={[0, 0, BELL_Z]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[BELL_R, BELL_LEN, 28, 1, true]} />
        <meshStandardMaterial
          color="#46464a"
          roughness={0.45}
          metalness={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Flame — nested unit cones stretched aft by scale.z each frame.
          Additive, no depth writes, emissive hot enough to cross the bloom
          threshold; initial scale matches idle thrust so mount does not pop. */}
      <group ref={flameRef} position={[0, 0, FLAME_ROOT_Z]} scale={[1, 1, FLAME_BASE_LEN]}>
        <mesh position={[0, 0, 0.5]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.34, 1, 24, 1, true]} />
          <meshStandardMaterial
            color="#000000"
            emissive={ACCENT}
            emissiveIntensity={2.4}
            transparent
            opacity={0.55}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, 0, 0.36]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.16, 0.72, 16, 1, true]} />
          <meshStandardMaterial
            color="#000000"
            emissive="#fff3e4"
            emissiveIntensity={3.6}
            transparent
            opacity={0.85}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* Ember trail — absent entirely under reduced motion. Culling is off
          because the buffer's resting bounds are a point at the origin. */}
      {!reduced && (
        <points position={[0, 0, FLAME_ROOT_Z]} frustumCulled={false}>
          <bufferGeometry>
            <primitive object={trail.posAttr} attach="attributes-position" />
            <primitive object={trail.colAttr} attach="attributes-color" />
          </bufferGeometry>
          <pointsMaterial
            size={0.09}
            sizeAttenuation
            vertexColors
            transparent
            opacity={0.9}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </points>
      )}
    </group>
  );
});
