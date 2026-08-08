import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, invalidate } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';
import type { MotionValue } from 'framer-motion';
import { fovAt, legInto, makePath3, sunApproach, voyage, MOBILE_BREAKPOINT, STEP } from '../engine';
import { SpaceEnvironment } from './SpaceEnvironment';
import { SolarBodies } from './SolarBodies';
import { StationLabels } from './StationLabels';
import { Meteors } from './Meteors';
import { Rocket3D } from './Rocket3D';
import { Dressing } from './Dressing';
import { LandingSite } from './LandingSite';
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
// Panel-anchoring scratch: a shadow camera that holds the BASE pose (kick
// included, breathing excluded) so projected anchors are rock-still at rest.
const projCam = new THREE.PerspectiveCamera(50, 1, 0.5, 2600);
// Docked-formation scratch: camera basis + the parking spot.
const tmpCamR = new THREE.Vector3();
const tmpCamU = new THREE.Vector3();
const tmpCamF = new THREE.Vector3();
const tmpForm = new THREE.Vector3();
const tmpView = new THREE.Vector3();
const tmpNdc = new THREE.Vector3();
const tmpRightW = new THREE.Vector3();
const clampPx = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
  landingRef,
  anchors,
  tetherLine,
  tetherDot,
}: {
  t: MotionValue<number>;
  kick: MotionValue<number>;
  vel: MotionValue<number>;
  n: number;
  reduced: boolean;
  mobile: boolean;
  thrustRef: { current: number };
  boostRef: { current: number };
  landingRef: { current: number };
  anchors?: { current: Map<number, HTMLDivElement> } | undefined;
  tetherLine?: { current: SVGLineElement | null } | undefined;
  tetherDot?: { current: SVGCircleElement | null } | undefined;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const rocketRef = useRef<THREE.Group>(null);
  // Last-written anchor px per station — writes are skipped when unchanged,
  // which is what keeps the docked frame byte-for-byte still.
  const lastAnchor = useRef(new Map<number, { x: number; y: number }>());
  const lastTether = useRef('');
  // Panel heights, measured once per station (offsetHeight forces layout —
  // never per frame). Cleared on viewport change; transforms don't dirty it.
  const panelHeights = useRef(new Map<number, number>());
  const lastSizeKey = useRef('');

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
    // spring (departure lunge — bled off before arrival, so the dock frame
    // is motionless).
    const p = camPath.posAt(tv);
    const g = gazePath.posAt(tv);
    const tan = camPath.tangentAt(tv);
    tmpTan.set(tan[0], tan[1], tan[2]);
    // Low coupling: the kick is seasoning on the camera, never a shake.
    const k = kick.get() * 0.3;
    tmpPos.set(p[0], p[1], p[2]).addScaledVector(tmpTan, k);
    tmpGaze.set(g[0], g[1], g[2]);

    const fov = fovAt(points, tv) + (mobile ? 9 : 0);

    // ==== PANEL ANCHORS — "the artifact is ON the planet". Each mounted
    // panel's wrapper is pinned to a projected point beside its body, so
    // panels arrive WITH their planet and never move after dock. Projection
    // uses the BASE pose (kick yes, breathing no): at rest every input is
    // constant, the rounded px never change, and the write is skipped —
    // which is what the frame-stability check measures. ====
    const anchorMap = anchors?.current;
    if (anchorMap && !mobile && anchorMap.size > 0) {
      projCam.position.copy(tmpPos);
      projCam.up.copy(camera.up);
      projCam.fov = fov;
      projCam.aspect = size.width / size.height;
      projCam.lookAt(tmpGaze);
      projCam.updateMatrixWorld();
      projCam.updateProjectionMatrix();
      tmpRightW.setFromMatrixColumn(projCam.matrixWorld, 0).normalize();
      const w = size.width;
      const h = size.height;
      const sizeKey = `${w}x${h}`;
      if (lastSizeKey.current !== sizeKey) {
        lastSizeKey.current = sizeKey;
        panelHeights.current.clear();
        lastAnchor.current.clear();
      }
      const panelW = Math.min(560, w - 32);
      const cur = Math.round(tv);
      let tetherStr = '';

      anchorMap.forEach((el, i) => {
        const wp = points[i];
        if (!wp) return;
        let ph = panelHeights.current.get(i);
        if (ph === undefined || ph === 0) {
          ph = el.offsetHeight;
          panelHeights.current.set(i, ph);
        }
        // Vertical clamp keeps the WHOLE panel on-screen around its -50%
        // translate; an over-tall panel just centres in the safe band.
        const yLo = ph / 2 + 88;
        const yHi = h - ph / 2 - 118;
        let ax: number;
        let ay: number;
        let limbX = 0;
        let limbY = 0;
        let hasLimb = false;

        if (wp.kind === 'earthReturn') {
          // The landing camera sits ON the planet — projecting its centre is
          // meaningless. The homecoming panel docks centre-right, fixed.
          ax = clampPx(w * 0.52, w * 0.34, w - 24 - panelW);
          ay = yLo > yHi ? (88 + h - 118) / 2 : clampPx(h * 0.44, yLo, yHi);
        } else {
          tmpView
            .set(wp.bodyPos[0], wp.bodyPos[1], wp.bodyPos[2])
            .applyMatrix4(projCam.matrixWorldInverse);
          if (tmpView.z > -1) return; // behind the lens — keep last position
          tmpNdc.copy(tmpView).applyMatrix4(projCam.projectionMatrix);
          const by = (-tmpNdc.y * 0.5 + 0.5) * h;
          tmpView
            .set(wp.bodyPos[0], wp.bodyPos[1], wp.bodyPos[2])
            .addScaledVector(tmpRightW, wp.bodyRadius)
            .applyMatrix4(projCam.matrixWorldInverse);
          if (tmpView.z > -1) return;
          tmpNdc.copy(tmpView).applyMatrix4(projCam.projectionMatrix);
          limbX = (tmpNdc.x * 0.5 + 0.5) * w;
          limbY = (-tmpNdc.y * 0.5 + 0.5) * h;
          hasLimb = true;
          ax = clampPx(limbX + 42, w * 0.34, w - 24 - panelW);
          ay = yLo > yHi ? (88 + h - 118) / 2 : clampPx(by, yLo, yHi);
        }

        const rx = Math.round(ax);
        const ry = Math.round(ay);
        const prev = lastAnchor.current.get(i);
        if (!prev || prev.x !== rx || prev.y !== ry) {
          lastAnchor.current.set(i, { x: rx, y: ry });
          el.style.transform = `translate3d(${rx}px, ${ry}px, 0) translateY(-50%)`;
        }

        // The callout tether: current panel -> its planet's limb.
        if (i === cur && hasLimb) {
          const op = (1 - Math.min(Math.abs(tv - cur) / 0.45, 1)) * 0.8;
          tetherStr = `${rx},${ry},${Math.round(limbX)},${Math.round(limbY)},${op.toFixed(2)}`;
        }
      });

      if (tetherStr !== lastTether.current) {
        lastTether.current = tetherStr;
        const line = tetherLine?.current;
        const dot = tetherDot?.current;
        if (line && dot) {
          if (tetherStr === '') {
            line.setAttribute('stroke-opacity', '0');
            dot.setAttribute('fill-opacity', '0');
          } else {
            const parts = tetherStr.split(',');
            const [x1, y1, x2, y2, op] = [
              parts[0] ?? '0',
              parts[1] ?? '0',
              parts[2] ?? '0',
              parts[3] ?? '0',
              parts[4] ?? '0',
            ];
            line.setAttribute('x1', x1);
            line.setAttribute('y1', y1);
            line.setAttribute('x2', x2);
            line.setAttribute('y2', y2);
            line.setAttribute('stroke-opacity', op);
            dot.setAttribute('cx', x2);
            dot.setAttribute('cy', y2);
            dot.setAttribute('fill-opacity', op);
          }
        }
      }
    }

    camera.position.copy(tmpPos);
    if (!reduced) {
      // Docked breathing: the frame is never a freeze-frame. Slow, small,
      // and phase-offset so it reads as station-keeping, not wobble. Added
      // AFTER the anchor projection on purpose: panels hold still while the
      // world breathes behind them.
      const e = state.clock.elapsedTime;
      camera.position.y += Math.sin(e * 0.45) * 0.5;
      camera.position.x += Math.sin(e * 0.31 + 1.7) * 0.35;
      tmpGaze.y += Math.sin(e * 0.38 + 0.6) * 0.35;
    }
    camera.lookAt(tmpGaze);

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
      // "Make the rocket much larger" (verbatim): the craft is a main
      // character, not an accessory. 0.62 read as a distant prop.
      rk.scale.setScalar(0.95);

      // ==== THE LANDING — the finale is choreographed, not implied. Over
      // the homecoming leg the shuttle pulls ahead of the camera, flips
      // tail-down, rides a retro-burn to the pad, and settles onto its legs
      // as the engines cut. (Staging hoisted above — the camera rolls with
      // the same ramp.) ====

      // Cruise pose: ahead on the path, pulling further ahead as the
      // homecoming begins (it should visibly RACE you home).
      const ra = camPath.posAt(tv + 0.22 + ramp * 0.36);
      tmpRight.crossVectors(tmpTan, tmpUp).normalize();
      // Offsets push the ship low and LEFT of the flight line — at the old
      // -5.2 it parked over the right-edge telemetry column in the hero
      // frame (live screenshot finding).
      tmpRocket
        .set(ra[0], ra[1], ra[2])
        .addScaledVector(tmpUp, -3.2)
        .addScaledVector(tmpRight, mobile ? 0 : -7.6)
        .addScaledVector(tmpTan, kick.get() * 0.35);
      // ==== DOCKED FORMATION — the ship is a character, so it must be IN
      // SHOT at every station. The path-cruise pose above drifts out of
      // frame once the dock gaze swings toward the planet ("I can't even
      // see the rocket after like 3 artifacts", verbatim), so near every
      // dock the ship blends to a camera-relative parking spot: lower-left
      // of frame, holding formation, nose toward the road ahead. At the
      // hero it parks closer still — the opening frame showcases it. ====
      const nearest = Math.round(tv);
      const dockW = ramp > 0 ? 0 : 1 - Math.min(Math.abs(tv - nearest) / 0.35, 1);
      if (dockW > 0) {
        const heroW = 1 - Math.min(tv / 0.6, 1);
        const sW = dockW * dockW * (3 - 2 * dockW);
        tmpCamR.setFromMatrixColumn(camera.matrixWorld, 0);
        tmpCamU.setFromMatrixColumn(camera.matrixWorld, 1);
        tmpCamF.setFromMatrixColumn(camera.matrixWorld, 2).negate();
        tmpForm
          .copy(camera.position)
          .addScaledVector(tmpCamF, 16.5 - heroW * 4.5)
          // The hero parks nearer the frame centre — at the full -7.0 the
          // showcase pose clipped a quarter of the ship off frame-left.
          .addScaledVector(tmpCamR, mobile ? 0 : -(7.0 - heroW * 2.1))
          .addScaledVector(tmpCamU, -(4.3 - heroW * 0.8));
        tmpRocket.lerp(tmpForm, sW);
      }

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

    // Thrust for the flames + trail; bloom boost for the sun approach; the
    // landing ramp for the site fade-in and the atmosphere fade-out.
    thrustRef.current = thrust;
    boostRef.current = sunApproach(n, tv);
    landingRef.current = ramp;
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
  anchors,
  tetherLine,
  tetherDot,
}: {
  t: MotionValue<number>;
  kick: MotionValue<number>;
  vel: MotionValue<number>;
  n: number;
  reduced: boolean;
  vw: number;
  /** Panel anchor wrappers keyed by station index — the Rig writes their
   *  transforms so panels ride their planets (desktop flight only). */
  anchors?: { current: Map<number, HTMLDivElement> };
  tetherLine?: { current: SVGLineElement | null };
  tetherDot?: { current: SVGCircleElement | null };
}) {
  const mobile = vw < MOBILE_BREAKPOINT;
  const thrustRef = useRef(0);
  const boostRef = useRef(0);
  const landingRef = useRef(0);
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
        <SolarBodies waypoints={points} reduced={reduced} landingRef={landingRef} />
        {/* Floating section labels beside each body — the "ABOUT ME in space"
            read. Static world objects, so they render on every rung. */}
        <StationLabels waypoints={points} reduced={reduced} />
        {/* Comet streaks + velocity warp lines are pure motion — absent
            entirely under reduced. */}
        {!reduced && <Meteors vel={vel} extent={(n - 1) * STEP + 60} />}
        <Dressing waypoints={points} reduced={reduced} />
        {/* The homecoming's ground truth: pad, terrain, sky — fades in over
            the final approach so touchdown happens in a real place. */}
        <LandingSite waypoints={points} t={t} reduced={reduced} />
        <Rig
          t={t}
          kick={kick}
          vel={vel}
          n={n}
          reduced={reduced}
          mobile={mobile}
          thrustRef={thrustRef}
          boostRef={boostRef}
          landingRef={landingRef}
          anchors={anchors}
          tetherLine={tetherLine}
          tetherDot={tetherDot}
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
