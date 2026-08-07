import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, invalidate } from '@react-three/fiber';
import * as THREE from 'three';
import type { MotionValue } from 'framer-motion';
import { fovAt, makePath3, sunApproach, voyage, MOBILE_BREAKPOINT } from '../engine';
import { SpaceEnvironment } from './SpaceEnvironment';
import { SolarBodies } from './SolarBodies';
import { Rocket3D } from './Rocket3D';
import { Effects } from './Effects';

/**
 * The WebGL voyage. Same philosophy as the 2D deck it replaces: ONE
 * MotionValue `t` (continuous station index, driven by the deliberate-advance
 * mechanics in Flight.tsx) is the sole source of truth — the camera, the
 * rocket, the fov and the bloom all derive from it inside useFrame, so React
 * renders nothing per frame. The kick spring displaces the camera along the
 * flight tangent, which is how the arrival overshoot-and-settle survives the
 * jump to 3D.
 *
 * Under reduced motion the canvas still renders — a still solar system is
 * ambience, not motion — but frameloop drops to 'demand' and every
 * continuous animation below is gated off; frames are produced only when `t`
 * snaps to a new station.
 */

const tmpPos = new THREE.Vector3();
const tmpGaze = new THREE.Vector3();
const tmpTan = new THREE.Vector3();
const tmpUp = new THREE.Vector3(0, 1, 0);
const tmpRight = new THREE.Vector3();
const tmpRocket = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpMat = new THREE.Matrix4();

function Rig({
  t,
  kick,
  vel,
  n,
  reduced,
  mobile,
  thrustRef,
  boostRef,
}: {
  t: MotionValue<number>;
  kick: MotionValue<number>;
  vel: MotionValue<number>;
  n: number;
  reduced: boolean;
  mobile: boolean;
  thrustRef: { current: number };
  boostRef: { current: number };
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const rocketRef = useRef<THREE.Group>(null);

  const { points, camPath, gazePath } = useMemo(() => {
    const pts = voyage(n);
    return {
      points: pts,
      camPath: makePath3(pts.map((p) => p.camPos)),
      gazePath: makePath3(pts.map((p) => p.gaze)),
    };
  }, [n]);

  useFrame((state) => {
    const tv = t.get();

    // Camera: ride the spline, displaced along the tangent by the kick
    // spring (departure lunge, arrival settle — the mass the eye expects).
    const p = camPath.posAt(tv);
    const g = gazePath.posAt(tv);
    const tan = camPath.tangentAt(tv);
    tmpTan.set(tan[0], tan[1], tan[2]);
    const k = kick.get() * 0.55;
    tmpPos.set(p[0], p[1], p[2]).addScaledVector(tmpTan, k);
    camera.position.copy(tmpPos);
    tmpGaze.set(g[0], g[1], g[2]);
    camera.lookAt(tmpGaze);

    const fov = fovAt(points, tv) + (mobile ? 9 : 0);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    // The ship cruises ahead of the camera, low in the frame (lower-left on
    // desktop where the panel docks right; low-centre on mobile), nose into
    // the travel direction, banking gently into lateral turns. Scaled down —
    // at full size it read as a prop shoved at the lens, not a craft under
    // way (screenshot finding).
    const rk = rocketRef.current;
    if (rk) {
      rk.scale.setScalar(0.62);
      const ra = camPath.posAt(tv + 0.24);
      tmpRight.crossVectors(tmpTan, tmpUp).normalize();
      tmpRocket
        .set(ra[0], ra[1], ra[2])
        .addScaledVector(tmpUp, -2.0)
        .addScaledVector(tmpRight, mobile ? 0 : -5.2)
        .addScaledVector(tmpTan, kick.get() * 0.35);
      if (!reduced) {
        // Idle float — barely there, sells zero-g.
        tmpRocket.y += Math.sin(state.clock.elapsedTime * 1.1) * 0.14;
      }
      rk.position.copy(tmpRocket);
      // Nose along the tangent: build a look-at basis facing -Z forward.
      tmpMat.lookAt(tmpRocket, tmpPos.copy(tmpRocket).add(tmpTan), tmpUp);
      tmpQuat.setFromRotationMatrix(tmpMat);
      rk.quaternion.slerp(tmpQuat, reduced ? 1 : 0.12); // heading lag, ported from 2D
      const bank = THREE.MathUtils.clamp(-tan[0] * 0.55, -0.45, 0.45);
      if (!reduced) rk.rotateZ(bank);
    }

    // Thrust for the flame + trail; bloom boost for the sun approach.
    thrustRef.current = THREE.MathUtils.clamp(Math.abs(vel.get()) / 3.2, 0, 1);
    boostRef.current = sunApproach(n, tv);
  });

  return <Rocket3D ref={rocketRef} thrustRef={thrustRef} reduced={reduced} />;
}

/** Under frameloop='demand' (reduced motion), render exactly one new frame
 *  whenever the station snaps. */
function InvalidateOnT({ t }: { t: MotionValue<number> }) {
  useEffect(() => t.on('change', () => invalidate()), [t]);
  return null;
}

export function Scene3D({
  t,
  kick,
  vel,
  n,
  reduced,
  vw,
}: {
  t: MotionValue<number>;
  kick: MotionValue<number>;
  vel: MotionValue<number>;
  n: number;
  reduced: boolean;
  vw: number;
}) {
  const mobile = vw < MOBILE_BREAKPOINT;
  const thrustRef = useRef(0);
  const boostRef = useRef(0);
  const points = useMemo(() => voyage(n), [n]);
  const sunPos = (points[n - 1]?.bodyPos ?? [0, 0, 0]) as [number, number, number];

  return (
    <Canvas
      // The visual layer is decoration; every fact it shows exists in the DOM
      // panels. Screen readers skip it entirely.
      aria-hidden
      frameloop={reduced ? 'demand' : 'always'}
      dpr={mobile ? [1, 1.5] : [1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 50, near: 0.5, far: 2600, position: [0, 0, 6] }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Suspense fallback={null}>
        <SpaceEnvironment reduced={reduced} sunPos={sunPos} starCount={mobile ? 2200 : 4200} />
        <SolarBodies waypoints={points} reduced={reduced} />
        <Rig
          t={t}
          kick={kick}
          vel={vel}
          n={n}
          reduced={reduced}
          mobile={mobile}
          thrustRef={thrustRef}
          boostRef={boostRef}
        />
        <Effects reduced={reduced} getBoost={() => boostRef.current} />
      </Suspense>
      {reduced && <InvalidateOnT t={t} />}
    </Canvas>
  );
}

/** WebGL capability probe — no context, no voyage; the crossfade deck takes
 *  over (which is also the reduced-motion DOM path, already built and
 *  verified). */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
