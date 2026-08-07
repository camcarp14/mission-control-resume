import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, invalidate } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';
import type { MotionValue } from 'framer-motion';
import { fovAt, legInto, makePath3, sunApproach, voyage, MOBILE_BREAKPOINT } from '../engine';
import { SpaceEnvironment } from './SpaceEnvironment';
import { SolarBodies } from './SolarBodies';
import { Rocket3D } from './Rocket3D';
import { Dressing } from './Dressing';
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
const tmpQuatLand = new THREE.Quaternion();
const tmpMat = new THREE.Matrix4();
const tmpSite = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpHover = new THREE.Vector3();
const tmpAim = new THREE.Vector3();
const tmpNorm = new THREE.Vector3();

const smooth = (x: number, a: number, b: number) => {
  const s = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return s * s * (3 - 2 * s);
};

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

    // Homecoming staging is needed by BOTH the camera (roll) and the ship
    // (landing), so it hoists to the top of the frame.
    const home = points[n - 1];
    const landing = home && home.kind === 'earthReturn' && home.site ? home : null;
    const ramp = landing ? legInto(n, n - 1, tv) : 0;
    if (landing && ramp > 0) {
      tmpNorm
        .set(
          landing.site![0] - landing.bodyPos[0],
          landing.site![1] - landing.bodyPos[1],
          landing.site![2] - landing.bodyPos[2],
        )
        .normalize();
      // Roll the camera onto the pad's local vertical as the descent begins
      // — with world-up held, the horizon crossed the frame diagonally and
      // the "landed" read fell apart (screenshot finding).
      camera.up.set(0, 1, 0).lerp(tmpNorm, smooth(ramp, 0.45, 0.9)).normalize();
    } else {
      camera.up.set(0, 1, 0);
    }

    // Camera: ride the spline, displaced along the tangent by the kick
    // spring (departure lunge, arrival settle — the mass the eye expects).
    const p = camPath.posAt(tv);
    const g = gazePath.posAt(tv);
    const tan = camPath.tangentAt(tv);
    tmpTan.set(tan[0], tan[1], tan[2]);
    // Low coupling: the kick is seasoning on the camera, never a shake.
    const k = kick.get() * 0.3;
    tmpPos.set(p[0], p[1], p[2]).addScaledVector(tmpTan, k);
    camera.position.copy(tmpPos);
    tmpGaze.set(g[0], g[1], g[2]);
    if (!reduced) {
      // Docked breathing: the frame is never a freeze-frame. Slow, small,
      // and phase-offset so it reads as station-keeping, not wobble.
      const e = state.clock.elapsedTime;
      camera.position.y += Math.sin(e * 0.45) * 0.5;
      camera.position.x += Math.sin(e * 0.31 + 1.7) * 0.35;
      tmpGaze.y += Math.sin(e * 0.38 + 0.6) * 0.35;
    }
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
    const velThrust = THREE.MathUtils.clamp(Math.abs(vel.get()) / 0.85, 0, 1);
    let thrust = velThrust;

    if (rk) {
      rk.scale.setScalar(0.62);

      // ==== THE LANDING — the finale is choreographed, not implied. Over
      // the homecoming leg the shuttle pulls ahead of the camera, flips
      // tail-down, rides a retro-burn to the pad, and settles onto its legs
      // as the engines cut. (Staging hoisted above — the camera rolls with
      // the same ramp.) ====

      // Cruise pose: ahead on the path, pulling further ahead as the
      // homecoming begins (it should visibly RACE you home).
      const ra = camPath.posAt(tv + 0.24 + ramp * 0.34);
      tmpRight.crossVectors(tmpTan, tmpUp).normalize();
      tmpRocket
        .set(ra[0], ra[1], ra[2])
        .addScaledVector(tmpUp, -2.0)
        .addScaledVector(tmpRight, mobile ? 0 : -5.2)
        .addScaledVector(tmpTan, kick.get() * 0.35);
      if (!reduced) {
        // Idle float — barely there, sells zero-g. Fades out on approach; a
        // ship on final descent does not bob.
        tmpRocket.y += Math.sin(state.clock.elapsedTime * 1.1) * 0.14 * (1 - ramp);
      }
      tmpMat.lookAt(tmpRocket, tmpAim.copy(tmpRocket).add(tmpTan), tmpUp);
      tmpQuat.setFromRotationMatrix(tmpMat);

      if (ramp > 0 && landing && landing.site) {
        // The engine owns the landing pad (composed with the low-horizon
        // camera in space.ts); the rig just flies the descent to it. Local
        // "up" at the pad is the surface normal (tmpNorm, set above).
        tmpSite.set(landing.site[0], landing.site[1], landing.site[2]);
        tmpDir.copy(tmpNorm);
        tmpHover.copy(tmpSite).addScaledVector(tmpDir, 6.5);

        // Position: cruise → hover (approach) → surface (descent).
        const wApproach = smooth(ramp, 0.4, 0.82);
        const wDown = smooth(ramp, 0.82, 0.975);
        tmpHover.lerp(tmpSite, wDown);
        tmpRocket.lerp(tmpHover, wApproach);

        // Orientation: flip tail-down — nose (local -Z) points away from the
        // planet, legs at the surface.
        tmpMat.lookAt(tmpRocket, tmpAim.copy(tmpRocket).add(tmpDir), tmpUp);
        tmpQuatLand.setFromRotationMatrix(tmpMat);
        tmpQuat.slerp(tmpQuatLand, smooth(ramp, 0.42, 0.78));

        // Retro-burn envelope: braking flare through the flip, full burn on
        // descent, engines cut at touchdown (RCS puffs take over).
        const retro = 0.5 * smooth(ramp, 0.4, 0.7) + 0.5 * smooth(ramp, 0.82, 0.9);
        const cut = 1 - smooth(ramp, 0.965, 0.995);
        thrust = Math.max(velThrust * (1 - wApproach), retro * cut);
      }

      rk.position.copy(tmpRocket);
      rk.quaternion.slerp(tmpQuat, reduced ? 1 : ramp > 0 ? 0.2 : 0.12);
      const bank = THREE.MathUtils.clamp(-tan[0] * 0.55, -0.45, 0.45);
      if (!reduced && ramp === 0) rk.rotateZ(bank);
    }

    // Thrust for the flames + trail; bloom boost for the sun approach.
    thrustRef.current = thrust;
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
        {/* Image-based lighting from a CC0 night HDRI — this is most of the
            difference between "material" and "grey plastic" on the hull and
            planet dark sides. Lighting only, never the background. */}
        <Environment files="/hdri/dikhololo_night_1k.hdr" />
        <SpaceEnvironment reduced={reduced} sunPos={sunPos} starCount={mobile ? 3200 : 6400} />
        <SolarBodies waypoints={points} reduced={reduced} />
        <Dressing waypoints={points} reduced={reduced} />
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
