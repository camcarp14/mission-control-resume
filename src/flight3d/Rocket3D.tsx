/* ==== ROCKET 3D — the crew shuttle ==========================================
 *
 * A crewed landing shuttle built entirely from primitives — no imported
 * meshes, everything shaped in code. The silhouette contract: STUBBY (a
 * lifting body, not a pencil), LEGGED (four always-deployed landing legs
 * whose feet are the aft-most geometry, so the finale can set it down
 * tail-first and it visibly stands), and CANOPIED (a wraparound cockpit
 * band plus portholes — people ride this thing).
 *
 * The component renders at local origin, nose along local -Z, spanning
 * z in [-2.2, +2.2] (nose tip to landing-foot soles) — the PARENT owns
 * position and orientation every frame. The ship only knows how hard it is
 * burning (thrustRef) and whether motion is allowed (reduced).
 *
 * Palette contract: warm-white hull greys; the single accent #ff5c37 appears
 * only where fire is allowed — one stripe, two fin flashes, the engine
 * flames, and the ember trail. Cockpit glass glows faint cool cyan.
 * ========================================================================= */

import * as THREE from 'three';
import { forwardRef, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { mulberry32 } from '../engine';

const ACCENT = '#ff5c37';
const TAU = Math.PI * 2;

/* ---- hull profile ----------------------------------------------------------
 * A body of revolution: elliptically rounded nose, widening mid-hull, gentle
 * boat-tail. One radius function drives the lathe AND every surface-mounted
 * part (portholes, stripe, belly panel), so nothing ever floats or sinks.
 * d is distance aft of the nose tip; local z = NOSE_TIP_Z + d.
 */
const NOSE_TIP_Z = -2.2;
const HULL_LEN = 3.55; // nose tip to stern shoulder
const STERN_RECESS = 0.07; // tiny inward step that closes the tail
const NOSE_ROUND = 0.95; // length of the elliptical nose cap
const R_NOSE = 0.6; // radius where the nose cap meets the mid-hull
const R_MAX = 0.92; // the stubby waistline
const WIDE_AT = 2.35; // where the waistline peaks
const R_STERN = 0.7;

function smooth01(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

function hullRadius(d: number): number {
  if (d <= NOSE_ROUND) {
    const u = (NOSE_ROUND - d) / NOSE_ROUND;
    return R_NOSE * Math.sqrt(Math.max(0, 1 - u * u));
  }
  if (d <= WIDE_AT) return R_NOSE + (R_MAX - R_NOSE) * smooth01((d - NOSE_ROUND) / (WIDE_AT - NOSE_ROUND));
  return R_MAX + (R_STERN - R_MAX) * smooth01((d - WIDE_AT) / (HULL_LEN - WIDE_AT));
}

function makeHullGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 30;
  for (let i = 0; i <= N; i++) {
    const d = (i / N) * HULL_LEN;
    pts.push(new THREE.Vector2(hullRadius(d), d));
  }
  // Close the stern with a small recessed step — the engine plate hides it.
  pts.push(new THREE.Vector2(R_STERN * 0.8, HULL_LEN + STERN_RECESS));
  pts.push(new THREE.Vector2(0, HULL_LEN + STERN_RECESS));
  return new THREE.LatheGeometry(pts, 48);
}
const HULL_GEO = makeHullGeometry();

// Darker belly panel: a partial lathe of the SAME profile, fractionally proud,
// so it hugs the hull curvature exactly. Lathe phi=0 lands on local -Y after
// the mesh's +90° X rotation — i.e. the belly — so a centered arc needs no
// extra phasing.
const BELLY_D0 = 1.35;
const BELLY_D1 = 3.35;
const BELLY_HALF_ARC = 0.62;
function makeBellyGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const d = BELLY_D0 + (i / N) * (BELLY_D1 - BELLY_D0);
    pts.push(new THREE.Vector2(hullRadius(d) * 1.02 + 0.006, d));
  }
  return new THREE.LatheGeometry(pts, 20, -BELLY_HALF_ARC, BELLY_HALF_ARC * 2);
}
const BELLY_GEO = makeBellyGeometry();

/* ---- canopy + portholes -------------------------------------------------- */
const CANOPY_Z = -1.35; // band centre — right where the nose cap blends in
const CANOPY_ARC = 4.2; // ~241°, wrapped around the top, gap at the belly
const CANOPY_GLASS_GEO = new THREE.TorusGeometry(0.52, 0.115, 10, 40, CANOPY_ARC);
const CANOPY_FRAME_GEO = new THREE.TorusGeometry(0.52, 0.135, 8, 40, CANOPY_ARC);
// Torus arcs sweep from +X toward +Y; this recenters the arc on +Y (dorsal).
const CANOPY_ROT_Z = Math.PI / 2 - CANOPY_ARC / 2;

const PORTHOLE_ZS = [-0.35, 0.1, 0.55]; // three cabins down the flank
const PORTHOLE_TILT = -0.28; // radians below the horizontal flank line
const PORTHOLE_RIM_GEO = new THREE.TorusGeometry(0.085, 0.02, 8, 20);
const PORTHOLE_GLASS_GEO = new THREE.CircleGeometry(0.07, 18);

/* ---- stripe, canards, fins ------------------------------------------------ */
const STRIPE_Z = -0.6; // the one paint band, just behind the canopy
const STRIPE_GEO = new THREE.TorusGeometry(hullRadius(STRIPE_Z - NOSE_TIP_Z) + 0.012, 0.03, 8, 44);

// Stub canards: a flattened capsule reads as a small rounded winglet for one
// draw call each. Local axes before rotation: Y = span, X = thickness, Z = chord.
const CANARD_GEO = new THREE.CapsuleGeometry(0.07, 0.42, 4, 12);
const CANARD_POS_X = 0.76;
const CANARD_Z = -0.85;
const CANARD_SCALE: [number, number, number] = [0.4, 1, 2.2];

// Aft delta fins: swept, ROUND-tipped (quadratic edges — nothing missile-sharp).
// Shape x = outboard span, y = toward the nose; extruded thin then laid flat.
const FIN_T = 0.07;
function makeFinGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.95); // root, leading
  s.lineTo(0, -0.55); // root, trailing
  s.quadraticCurveTo(0.6, -0.52, 0.98, -0.28); // trailing edge sweeps out
  s.quadraticCurveTo(1.16, -0.16, 1.06, 0.06); // rounded tip
  s.quadraticCurveTo(0.6, 0.5, 0, 0.95); // swept leading edge home
  const g = new THREE.ExtrudeGeometry(s, { depth: FIN_T, bevelEnabled: false });
  g.translate(0, 0, -FIN_T / 2);
  return g;
}
const FIN_GEO = makeFinGeometry();
const FIN_POS: [number, number, number] = [0.7, 0, 0.72];
const FLASH_GEO = new THREE.BoxGeometry(0.3, 0.02, 0.14); // tiny accent chip on the fin

/* ---- landing legs ----------------------------------------------------------
 * Four legs at the diagonal azimuths (clear of fins, belly panel, and bells),
 * each a main strut + drag brace + foot pad, splaying outward and AFT. The
 * pad soles sit at exactly z = +2.2 — the aft-most geometry on the craft, so
 * a tail-down landing visibly stands on them.
 */
const LEG_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
// Main strut: hull (0.72, z 0.8) -> foot (1.28, z 2.02).
const STRUT_MAIN_GEO = new THREE.CylinderGeometry(0.058, 0.048, 1.42, 10);
const STRUT_MAIN_MID: [number, number, number] = [1.0, 0, 1.41];
const STRUT_MAIN_TILT = Math.atan2(0.56, 1.22);
// Drag brace: stern shoulder (0.55, z 1.32) -> same foot.
const STRUT_BRACE_GEO = new THREE.CylinderGeometry(0.028, 0.028, 1.06, 8);
const STRUT_BRACE_MID: [number, number, number] = [0.915, 0, 1.67];
const STRUT_BRACE_TILT = Math.atan2(0.73, 0.7);
const PAD_GEO = new THREE.CylinderGeometry(0.17, 0.17, 0.08, 14);
const PAD_POS: [number, number, number] = [1.28, 0, 2.16]; // sole at z = +2.2

/* ---- engine cluster --------------------------------------------------------
 * Three bells in a triangle on a stern mount plate, three independent flames.
 * Flame groups have unit-height cone pairs so thrust maps to one scale.z
 * write per flame per frame.
 */
const PLATE_GEO = new THREE.CylinderGeometry(0.58, 0.62, 0.16, 24);
const PLATE_Z = 1.36;
const BELL_GEO = new THREE.CylinderGeometry(0.24, 0.12, 0.42, 20, 1, true);
const BELL_Z = 1.52; // lip at 1.73 — well clear of the leg soles at 2.2
const BELL_RADIAL = 0.3;
const BELL_XY: [number, number][] = [Math.PI / 2, Math.PI / 2 + TAU / 3, Math.PI / 2 + (2 * TAU) / 3].map(
  (a) => [BELL_RADIAL * Math.cos(a), BELL_RADIAL * Math.sin(a)],
);

const FLAME_ROOT_Z = 1.68; // tucked just inside the bell lips
const FLAME_BASE_LEN = 0.45;
const FLAME_THRUST_GAIN = 2.1;
const FLAME_SHEATH_GEO = new THREE.ConeGeometry(0.2, 1, 18, 1, true);
const FLAME_CORE_GEO = new THREE.ConeGeometry(0.1, 0.72, 12, 1, true);
// Two detuned sines inside the 9-13 Hz band; per-bell phase offsets so the
// three flames never wobble in lockstep.
const FLICKER_HZ_A = 12.3;
const FLICKER_HZ_B = 9.7;
const FLICKER_AMP_A = 0.08;
const FLICKER_AMP_B = 0.055;
const FLAME_PHASE = [0, 2.1, 4.2];

/* ---- RCS puffs -------------------------------------------------------------
 * Two faint white nose jets that only light while the mains are near-idle —
 * attitude control while docked or settling onto the legs. One shared
 * material, so the per-frame cost is a single opacity write.
 */
const RCS_GEO = new THREE.ConeGeometry(0.055, 0.36, 10, 1, true);
const RCS_AZIMUTH = 0.75; // radians off dorsal, one jet each side of the nose
const RCS_THRUST_MAX = 0.25;
const RCS_OPACITY_GAIN = 0.8;

/* ---- exhaust trail ---------------------------------------------------------
 * Ring buffer of points recycled in place — zero allocation per frame.
 * Period x count leaves headroom over particle life so a slot is always dead
 * before it is reused. Spawn cycles across the three bells.
 */
const TRAIL_COUNT = 80;
const TRAIL_LIFE = 0.8;
const TRAIL_EMIT_PERIOD = 0.013; // ~77 particles/s at full burn, ~62 alive max
const TRAIL_THRUST_MIN = 0.12;
const TRAIL_ROOT_Z = 1.7;

// Seeded spawn jitter and drift — the only randomness the ship is allowed,
// so the exhaust is identical every visit.
const TRAIL_SPAWN = new Float32Array(TRAIL_COUNT * 2);
const TRAIL_VEL = new Float32Array(TRAIL_COUNT * 3);
{
  const rand = mulberry32(0xc0ffee);
  for (let i = 0; i < TRAIL_COUNT; i++) {
    const bell = BELL_XY[i % 3] ?? [0, 0];
    TRAIL_SPAWN[i * 2] = (bell[0] ?? 0) + (rand() - 0.5) * 0.18;
    TRAIL_SPAWN[i * 2 + 1] = (bell[1] ?? 0) + (rand() - 0.5) * 0.18;
    TRAIL_VEL[i * 3] = (rand() - 0.5) * 1.1; // sideways scatter
    TRAIL_VEL[i * 3 + 1] = (rand() - 0.5) * 1.1;
    TRAIL_VEL[i * 3 + 2] = 2.8 + rand() * 1.6; // always drifting aft (+Z)
  }
}

type TrailState = {
  positions: Float32Array;
  colors: Float32Array;
  ages: Float32Array;
  posAttr: THREE.BufferAttribute;
  colAttr: THREE.BufferAttribute;
  geo: THREE.BufferGeometry;
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  return { positions, colors, ages, posAttr, colAttr, geo, cursor: 0, accum: 0 };
}

type Rocket3DProps = {
  /** 0..1 burn intensity, written by the parent every frame — read, never set. */
  thrustRef: { current: number };
  /** True freezes flicker and removes trail + RCS; flame length still tracks thrust. */
  reduced: boolean;
};

export const Rocket3D = forwardRef<THREE.Group, Rocket3DProps>(function Rocket3D(
  { thrustRef, reduced },
  ref,
) {
  const flameRefs = useRef<(THREE.Group | null)[]>([null, null, null]);
  const trail = useMemo(makeTrailState, []);

  // Every material shared across its meshes — one canopy/porthole glass, one
  // hull, one dark metal for legs + bells + plate — keeps the craft's state
  // small and lets the parent's HDRI environment light everything alike.
  const mats = useMemo(
    () => ({
      hull: new THREE.MeshStandardMaterial({ color: '#dfe0e2', roughness: 0.45, metalness: 0.18 }),
      belly: new THREE.MeshStandardMaterial({
        color: '#8b8d91',
        roughness: 0.6,
        metalness: 0.22,
        side: THREE.DoubleSide,
      }),
      frame: new THREE.MeshStandardMaterial({ color: '#a7a9ad', roughness: 0.5, metalness: 0.35 }),
      metal: new THREE.MeshStandardMaterial({ color: '#4a4c50', roughness: 0.42, metalness: 0.65, side: THREE.DoubleSide }),
      glass: new THREE.MeshStandardMaterial({
        color: '#05080b',
        emissive: '#173a4d',
        emissiveIntensity: 0.5,
        roughness: 0.18,
        metalness: 0.1,
      }),
      accent: new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.5, metalness: 0.1 }),
      flameSheath: new THREE.MeshStandardMaterial({
        color: '#000000',
        emissive: ACCENT,
        emissiveIntensity: 2.6,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      flameCore: new THREE.MeshStandardMaterial({
        color: '#000000',
        emissive: '#fff3e4',
        emissiveIntensity: 3.6,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      rcs: new THREE.MeshBasicMaterial({
        color: '#e8f2f8',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      trail: new THREE.PointsMaterial({
        size: 0.085,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    }),
    [],
  );

  useFrame((state, rawDt) => {
    // Clamp dt so a backgrounded tab does not dump a giant step into the
    // emitter loop or teleport the embers on return.
    const dt = Math.min(rawDt, 0.05);
    const thrust = thrustRef.current;
    const t = state.clock.elapsedTime;

    // Flame length always tracks thrust — that is state, not animation — but
    // the flicker is motion, so it is gated behind reduced.
    for (let i = 0; i < 3; i++) {
      const flame = flameRefs.current[i];
      if (!flame) continue;
      let flicker = 1;
      if (!reduced) {
        const p = FLAME_PHASE[i] ?? 0;
        flicker =
          1 +
          FLICKER_AMP_A * Math.sin(t * FLICKER_HZ_A * TAU + p) +
          FLICKER_AMP_B * Math.sin(t * FLICKER_HZ_B * TAU + p * 1.7 + 0.9);
      }
      flame.scale.z = (FLAME_BASE_LEN + thrust * FLAME_THRUST_GAIN) * flicker;
    }

    // Everything past here is pure motion — under reduced neither the RCS
    // jets nor the trail are even rendered, so nothing to simulate either.
    if (reduced) return;

    // RCS lights up only near idle: docked/landing attitude control.
    mats.rcs.opacity = thrust < RCS_THRUST_MAX ? (RCS_THRUST_MAX - thrust) * RCS_OPACITY_GAIN : 0;

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
      // Quadratic fade, whitish at birth cooling to the accent ember colour.
      const life = 1 - age / TRAIL_LIFE;
      const f = life * life;
      const hot = f * life;
      colors[k] = f;
      colors[k + 1] = f * (0.36 + 0.5 * hot);
      colors[k + 2] = f * (0.22 + 0.45 * hot);
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
        positions[k + 2] = 0; // born at the bell lips, drifts aft from there
      }
    } else {
      trail.accum = 0;
    }

    trail.posAttr.needsUpdate = true;
    trail.colAttr.needsUpdate = true;
  });

  return (
    <group ref={ref}>
      {/* Hull + belly panel — lathes share the one profile function. The +90°
          X rotation maps the lathe axis onto local Z, nose tip at NOSE_TIP_Z. */}
      <mesh geometry={HULL_GEO} material={mats.hull} position={[0, 0, NOSE_TIP_Z]} rotation={[Math.PI / 2, 0, 0]} />
      <mesh geometry={BELLY_GEO} material={mats.belly} position={[0, 0, NOSE_TIP_Z]} rotation={[Math.PI / 2, 0, 0]} />

      {/* Crew canopy: frame ring behind, glass band proud of it, wrapped over
          the top of the nose. Faint cool emissive — a lit flight deck, not a
          lamp; it must never compete with the flames. */}
      <group position={[0, 0, CANOPY_Z]} rotation={[0, 0, CANOPY_ROT_Z]}>
        <mesh geometry={CANOPY_FRAME_GEO} material={mats.frame} scale={[1, 1, 2.5]} />
        <mesh geometry={CANOPY_GLASS_GEO} material={mats.glass} scale={[1, 1, 2.1]} />
      </group>

      {/* The one paint stripe — matte accent band just behind the canopy. */}
      <mesh
        geometry={STRIPE_GEO}
        material={mats.accent}
        position={[0, 0, STRIPE_Z]}
        scale={[1, 1, 1.4]}
      />

      {/* Three portholes down the starboard flank, just under the shoulder
          line — cabin windows for the people who live in this thing. */}
      <group rotation={[0, 0, PORTHOLE_TILT]}>
        {PORTHOLE_ZS.map((z) => {
          const r = hullRadius(z - NOSE_TIP_Z);
          return (
            <group key={z} position={[r + 0.004, 0, z]} rotation={[0, Math.PI / 2, 0]}>
              <mesh geometry={PORTHOLE_RIM_GEO} material={mats.frame} />
              <mesh geometry={PORTHOLE_GLASS_GEO} material={mats.glass} position={[0, 0, 0.006]} />
            </group>
          );
        })}
      </group>

      {/* Stub canards near the nose — flattened capsules, rounded by nature. */}
      {[1, -1].map((s) => (
        <mesh
          key={s}
          geometry={CANARD_GEO}
          material={mats.frame}
          position={[s * CANARD_POS_X, 0.02, CANARD_Z]}
          rotation={[0, 0, (s * Math.PI) / 2]}
          scale={CANARD_SCALE}
        />
      ))}

      {/* Aft delta fins with their tiny accent flashes — the mirror group
          flips the whole pair to the port side. */}
      {[0, Math.PI].map((flip) => (
        <group key={flip} rotation={[0, 0, flip]}>
          <mesh geometry={FIN_GEO} material={mats.frame} position={FIN_POS} rotation={[-Math.PI / 2, 0, 0]} />
          <mesh geometry={FLASH_GEO} material={mats.accent} position={[0.95, 0.042, 0.82]} />
        </group>
      ))}

      {/* Four landing legs, always deployed: main strut + drag brace + pad,
          splayed outward and aft. Pad soles at z = +2.2 — the aft-most
          geometry, so the tail-down finale stands on them. */}
      {LEG_ANGLES.map((a) => (
        <group key={a} rotation={[0, 0, a]}>
          <group position={STRUT_MAIN_MID} rotation={[0, STRUT_MAIN_TILT, 0]}>
            <mesh geometry={STRUT_MAIN_GEO} material={mats.metal} rotation={[Math.PI / 2, 0, 0]} />
          </group>
          <group position={STRUT_BRACE_MID} rotation={[0, STRUT_BRACE_TILT, 0]}>
            <mesh geometry={STRUT_BRACE_GEO} material={mats.metal} rotation={[Math.PI / 2, 0, 0]} />
          </group>
          <mesh geometry={PAD_GEO} material={mats.metal} position={PAD_POS} rotation={[Math.PI / 2, 0, 0]} />
        </group>
      ))}

      {/* Engine cluster: stern mount plate and three bells in a triangle. */}
      <mesh geometry={PLATE_GEO} material={mats.metal} position={[0, 0, PLATE_Z]} rotation={[Math.PI / 2, 0, 0]} />
      {BELL_XY.map(([bx, by], i) => (
        <mesh
          key={i}
          geometry={BELL_GEO}
          material={mats.metal}
          position={[bx, by, BELL_Z]}
          rotation={[Math.PI / 2, 0, 0]}
        />
      ))}

      {/* Three flames — nested unit cones stretched aft by scale.z each frame.
          Additive, no depth writes, emissive hot enough for bloom; initial
          scale matches idle thrust so mount does not pop. */}
      {BELL_XY.map(([bx, by], i) => (
        <group
          key={i}
          position={[bx, by, FLAME_ROOT_Z]}
          scale={[1, 1, FLAME_BASE_LEN]}
          ref={(g) => {
            flameRefs.current[i] = g;
          }}
        >
          <mesh geometry={FLAME_SHEATH_GEO} material={mats.flameSheath} position={[0, 0, 0.5]} rotation={[Math.PI / 2, 0, 0]} />
          <mesh geometry={FLAME_CORE_GEO} material={mats.flameCore} position={[0, 0, 0.36]} rotation={[Math.PI / 2, 0, 0]} />
        </group>
      ))}

      {/* RCS nose jets — only visible near idle thrust (opacity driven in the
          frame loop), and pure motion, so absent entirely under reduced. */}
      {!reduced &&
        [1, -1].map((s) => (
          <group key={s} rotation={[0, 0, s * RCS_AZIMUTH]}>
            <mesh
              geometry={RCS_GEO}
              material={mats.rcs}
              position={[0, 0.66, -1.87]}
              rotation={[Math.PI - 0.55, 0, 0]}
            />
          </group>
        ))}

      {/* Ember trail — absent entirely under reduced motion. Culling is off
          because the buffer's resting bounds are a point at the origin. */}
      {!reduced && (
        <points
          geometry={trail.geo}
          material={mats.trail}
          position={[0, 0, TRAIL_ROOT_Z]}
          frustumCulled={false}
        />
      )}
    </group>
  );
});
