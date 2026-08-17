import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, invalidate } from '@react-three/fiber';
import { Environment, PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';
import type { MotionValue } from 'framer-motion';
import { fovAt, legInto, makePath3, sunApproach, voyage, MOBILE_BREAKPOINT, STEP } from '../engine';
import { SpaceEnvironment } from './SpaceEnvironment';
import {
  SolarBodies,
  SUN_LIGHT_COLOR,
  SUN_LIGHT_CUTOFF,
  SUN_LIGHT_DECAY,
  SUN_LIGHT_PULSE,
  sunLightIntensity,
} from './SolarBodies';
import { MOBILE_FOV_BONUS, StationLabels } from './StationLabels';
import { Meteors } from './Meteors';
import { Rocket3D } from './Rocket3D';
import { Dressing } from './Dressing';
import { LandingSite } from './LandingSite';
import { Effects } from './Effects';
import { QualityContext, useQualityTier, type QualityTier } from './quality';

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
const tmpEarthV = new THREE.Vector3();
const tmpTHat = new THREE.Vector3();
const tmpDescent = new THREE.Vector3();
// Turn-anticipation scratch: the look-ahead tangent and the path's own up.
const tmpAhead = new THREE.Vector3();
const tmpPathUp = new THREE.Vector3();
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

/** Frame-rate-independent exponential approach: x moves toward target with
 *  time constant 1/k. Unconditionally stable for any dt (the factor is always
 *  in [0,1)), which matters because this app is regularly asked to render a
 *  frame that costs half a second on a software rasteriser. */
const approach = (x: number, target: number, k: number, dt: number) =>
  x + (target - x) * (1 - Math.exp(-k * dt));

/* ==== CAMERA CHOREOGRAPHY ===================================================
 *
 * Everything below is the difference between a camera that is DRIVEN along a
 * spline and one that is FLOWN down it. The spline says where the lens is; the
 * constants here say how it behaves getting there — how it falls behind under
 * thrust and glides to a stop, how it rolls into a turn it can already see
 * coming, how the lens opens under acceleration and closes as the ship comes
 * to rest, and how it never quite holds perfectly still while docked.
 *
 * TWO RULES GOVERN ALL OF IT.
 *
 * 1. `t` IS NEVER TOUCHED. It is a monotone tween toward an integer station,
 *    and the moment anything here nudged it — a lag, an overshoot, a spring —
 *    the sample would cross the knot into the NEXT spline segment and the
 *    flight path would visibly hook at every dock. So every term below is a
 *    displacement in CAMERA-LOCAL or PATH-LOCAL space, applied to the pose the
 *    spline already produced. Arrival timing is unchanged: `t` still lands
 *    exactly when Flight.tsx says it does, the panel still docks on that
 *    frame, and what settles afterwards is the lens, not the mission clock.
 *
 * 2. EVERY TERM IS ZERO AT REST AND ZERO UNDER REDUCED MOTION. All of them are
 *    scaled by measured world speed, which is exactly 0 at a dock — so the
 *    docked frame is the same composed frame it was before, the projected
 *    panel anchors stop moving, and the "byte-for-byte still" property the
 *    anchor cache depends on survives. Under `reduced` the loop runs on
 *    demand and `t` snaps, so a per-frame smoother would be sampling noise:
 *    the whole block is skipped and the state held at rest.
 *
 * The speeds are measured in WORLD UNITS, from the spline sample's own
 * displacement, never in units of `t`. The homecoming leg covers four times
 * the distance of a cruise leg in the same one unit of `t`; normalising on `t`
 * would have made the flight home read as the slowest part of the voyage.
 */

/** World units/sec that counts as full cruise. Measured against the shipped
 *  voyage: a 2.6s leg peaks at 120-145 u/s and the homecoming at ~500, so every
 *  real leg saturates these effects for most of its length and only the ends —
 *  the burn and the dock — ride the ramp. That is the intent: legs should feel
 *  alike, and what differs between them is where they turn, not whether the
 *  camera bothers to fly. */
const SPEED_REF = 78;
const SPEED_ATTACK = 6.5; // 1/s — the rig notices thrust immediately
const SPEED_RELEASE = 2.3; // 1/s — and lets go of it slowly. This is the settle.
/** Seconds of world speed the lens trails behind the spline sample. */
const TRAIL_SECONDS = 0.038;
/** Hard cap in world units. The homecoming peaks near 500 u/s — four times a
 *  cruise leg — and must not be able to fling the lens down the route. */
const TRAIL_MAX = 5;
const TRAIL_ATTACK = 11; // falls behind fast under burn, so the kick still reads
const TRAIL_RELEASE = 1.6; // catches up slowly: the last few units of the dock
/** An exponential release never actually ARRIVES, and this one is projected
 *  through to the panel anchors — a lens that asymptotes forever keeps nudging
 *  their rounded pixels forever. Under this many units the release hands over
 *  to a constant creep at exactly the rate the exponential was already moving,
 *  so it is smooth in value AND in velocity and it finishes in finite time
 *  (measured: fully at rest 1.6s after arrival). */
const TRAIL_CLOSE = 0.15;
/** How far ahead (in stations) the turn is read. Derivative only — the POSITION
 *  is never sampled past `t`. */
const LOOK_AHEAD = 0.34;
const BEND_SMOOTH = 5.5;
/** World units of gaze lead into a turn at full cruise, lateral and vertical.
 *  Applied along the PATH frame, so a straight leg gets none of it and a bend
 *  gets all of it — anticipation, not a permanent offset. */
const LEAD_LAT = 11;
const LEAD_VERT = 7;
/** Camera roll per unit of lateral bend, and its ceiling: 0.075 rad, 4.3°.
 *  Measured on the shipped route that is 2.1° through an ordinary leg and the
 *  full 4.3° through the sharpest bend. A film camera banks; it does not
 *  barrel-roll. */
const BANK_CAM = 0.095;
const BANK_CAM_MAX = 0.075;
/** Roll per unit of the departure kick spring (which peaks at 7) — about a
 *  degree, so leaving a station has a beat of its own. */
const DEPART_ROLL = 0.0026;
/** The roll spring. Slightly under-damped ON PURPOSE: roll is camera-local, so
 *  a touch of overshoot is a horizon that rocks back to level, not a path that
 *  hooks past its knot. */
const ROLL_OMEGA = 7.2;
const ROLL_ZETA = 0.72;
const ROLL_EPS = 1.5e-4; // ~0.009°: below one pixel of anchor error, so it snaps
/** Ship bank. The old term was `-tan.x` — pure HEADING, which is not a bank at
 *  all: on this route the heading and the curvature are in quadrature, so at
 *  the sharpest point of every turn the heading term was rolling the ship the
 *  WRONG WAY (measured: -6.9° of right-wing-down at the top of a left-hand
 *  bend). Heading stays at rest, because it is what makes the parked ship read
 *  as a craft and not a diagram, and every docked screenshot was composed with
 *  it — but it FADES with speed and hands the roll to the curvature the
 *  look-ahead measured, which is what an aircraft actually does. */
const BANK_SHIP = 0.52;
const BANK_HEADING_FADE = 0.62;
const BANK_SHIP_MAX = 0.58;
const BANK_SHIP_SMOOTH = 4.5;
/** Degrees the lens opens at full cruise, and how much of fovAt's POSITIONAL
 *  mid-leg bump (`5 * sin(π s)` in engine/space.ts) is handed over to it. */
const FOV_SPEED = 3.6;
const FOV_BUMP_TRIM = 2.25;
/** Handheld drift while docked, in radians. Sums to ~0.13° of yaw — a tenth of
 *  a degree, deliberately below the threshold where anyone can point at it and
 *  say what moved. */
const DRIFT_YAW = 0.0014;
const DRIFT_PITCH = 0.0011;
const DRIFT_ROLL = 0.0016;

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
  gearRef,
  deepSpaceRef,
  detailRef,
  sunLightRef,
  sunLightBase,
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
  gearRef: { current: number };
  deepSpaceRef: { current: THREE.Group | null };
  detailRef: { current: THREE.Group | null };
  sunLightRef: { current: THREE.PointLight | null };
  sunLightBase: number;
  anchors?: { current: Map<number, HTMLDivElement> } | undefined;
  tetherLine?: { current: SVGLineElement | null } | undefined;
  tetherDot?: { current: SVGCircleElement | null } | undefined;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const rocketRef = useRef<THREE.Group>(null);
  // ==== THE RIG'S MOTION STATE. Refs, mutated in place, read by nobody but
  // the frame loop — there is no React state here and there must never be.
  // Every field is a smoothed derivative of how the spline sample is actually
  // MOVING, which is a thing `t` alone cannot tell you: the same 1.0 of `t`
  // buys 95 world units on a cruise leg and four times that on the flight
  // home. All of it is held at rest under reduced motion.
  const mo = useRef({
    hasPrev: false,
    prevTv: 0,
    prevX: 0,
    prevY: 0,
    prevZ: 0,
    /** Normalised world speed, 0..1. Fast attack, slow release. */
    speed: 0,
    /** +1 outbound, -1 back down the route. Held through a stop. */
    dir: 1,
    /** Signed world units the lens lags behind the spline sample, along the
     *  path tangent. Never a `t` offset — see the choreography note above. */
    trail: 0,
    /** Camera roll and its spring velocity, radians. */
    roll: 0,
    rollV: 0,
    /** Smoothed bend of the look-ahead tangent in the path frame: how far the
     *  road turns to the traveller's right (`bend`) and rises (`bendUp`). */
    bend: 0,
    bendUp: 0,
    /** Smoothed ship bank, radians. */
    shipBank: 0,
  });
  // Last-written anchor px per station — writes are skipped when unchanged,
  // which is what keeps the docked frame byte-for-byte still.
  const lastAnchor = useRef(new Map<number, { x: number; y: number }>());
  const lastTether = useRef('');
  // Panel heights, measured once per station (offsetHeight forces layout —
  // never per frame). Cleared on viewport change; transforms don't dirty it.
  const panelHeights = useRef(new Map<number, number>());
  // Panel WIDTHS, measured the same way. Assuming the CSS max-width here was
  // fragile — the stylesheet owns the measure and it changes by breakpoint —
  // so the horizontal clamp reads the real box instead of a duplicated
  // constant that silently drifts out of sync with polish.css.
  const panelWidths = useRef(new Map<number, number>());
  const lastSizeKey = useRef('');
  // Right-hand safe edge for panel anchors, in px. The instrument column
  // (Telemetry.tsx) is `fixed right-5 lg:right-8` and only exists at lg and
  // up, so its footprint can't be assumed — it has to be measured. Without
  // this the panel's right bound was `w - 24`, which put the body copy
  // straight through the ALT/VEL/SEC readouts at 1280 and 1440 (audit
  // finding, reproduced in screenshots at both widths). Measured once per
  // viewport size, alongside the panel heights, never per frame.
  const rightSafe = useRef(0);
  // Panel heights were measured ONCE per station because offsetHeight forces
  // layout and must never run per frame. That was sound while a panel's height
  // was a function of its content and the viewport alone — and it stopped being
  // sound the moment the station detail became collapsible, because a stale
  // height puts the vertical clamp around a box that no longer exists and the
  // panel drifts off its planet.
  //
  // A ResizeObserver is the cheap correct answer: it fires only when a box
  // actually changes, so the common case (nothing toggling) costs nothing, and
  // the toggle case pays exactly the one-off measurement the initial dock
  // already pays. It clears rather than recomputes — the next frame re-measures
  // whatever is mounted, which keeps the read inside the existing code path
  // instead of duplicating it in a callback that runs outside the frame.
  const panelRO = useRef<ResizeObserver | null>(null);
  const observedAnchors = useRef(new WeakSet<Element>());

  const { points, camPath, gazePath } = useMemo(() => {
    const pts = voyage(n);
    return {
      points: pts,
      camPath: makePath3(pts.map((p) => p.camPos)),
      gazePath: makePath3(pts.map((p) => p.gaze)),
    };
  }, [n]);

  // Dev-only telemetry for the scripted review harness, in the same spirit as
  // `window.__perf` below and `window.__t` in Flight.tsx: the choreography's
  // live state, read out of the running rig instead of guessed at from a
  // screenshot on a software rasteriser. Assigned once — the object is a ref
  // and is mutated in place — and dead-code-eliminated from production.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __rig?: unknown }).__rig = mo.current;
  }, []);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      panelHeights.current.clear();
      panelWidths.current.clear();
      // lastAnchor too, or the "skip the write when the rounded px are
      // unchanged" optimisation would happily skip the corrected write.
      lastAnchor.current.clear();
      // Under reduced motion the loop runs on demand, so a resize that nothing
      // else is animating would otherwise never be drawn.
      invalidate();
    });
    panelRO.current = ro;
    return () => {
      ro.disconnect();
      panelRO.current = null;
    };
  }, []);

  useFrame((state, delta) => {
    const tv = t.get();
    const m = mo.current;
    // Two clocks. `dtRaw` measures — a frame that genuinely took half a second
    // moved the world half a second's worth and the speed reading must say so.
    // `dtS` integrates, capped so a stalled tab cannot step a spring off a
    // cliff when the loop resumes.
    const dtRaw = Math.max(1 / 240, delta);
    const dtS = Math.min(dtRaw, 0.25);

    // Homecoming staging is needed by BOTH the camera (roll) and the ship
    // (landing), so it hoists to the top of the frame.
    const home = points[n - 1];
    const landing = home && home.kind === 'earthReturn' && home.site ? home : null;
    const ramp = landing ? legInto(n, n - 1, tv) : 0;
    const homeRawHoist = landing ? Math.min(1, Math.max(0, tv - (n - 2))) : 0;
    // The choreography's own fade. The homecoming is COMPOSED — a ballistic
    // arc, a gaze handoff and a descent column that took several live reports
    // to stop reading as chop — so every term this rig adds is gone before the
    // descent column takes over at homeRaw 0.5. The landing is not a place to
    // be clever.
    const cine = landing ? 1 - smooth(homeRawHoist, 0.26, 0.52) : 1;
    if (landing && ramp > 0) {
      tmpNorm
        .set(
          landing.site![0] - landing.bodyPos[0],
          landing.site![1] - landing.bodyPos[1],
          landing.site![2] - landing.bodyPos[2],
        )
        .normalize();
      // Roll the camera onto the pad's local vertical DURING the top-down
      // stretch of the descent column, where a roll is invisible — finishing
      // it late overlapped the gaze release and read as a choppy whip on
      // final approach (live report).
      camera.up.set(0, 1, 0).lerp(tmpNorm, smooth(homeRawHoist, 0.5, 0.74)).normalize();
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
    // The PATH FRAME: screen-right of the flight line, and the path's own up.
    // (cross(forward, up) is +X in a right-handed y-up basis.) Hoisted here
    // from the rocket block below, which used to build the same vector from
    // the same two inputs — the bank, the lead and the ship all read the turn
    // out of this one basis, so they cannot disagree about which way it bends.
    tmpRight.crossVectors(tmpTan, tmpUp).normalize();
    tmpPathUp.crossVectors(tmpRight, tmpTan).normalize();

    // ==== THE PHYSICS OF THE LENS ====================================
    if (reduced) {
      // Held at rest, not merely unused: the preference can be toggled
      // mid-session, and the first frame after it goes back off must start
      // from a clean pose rather than from whatever a demand-driven loop left
      // in these accumulators.
      m.speed = 0;
      m.trail = 0;
      m.roll = 0;
      m.rollV = 0;
      m.bend = 0;
      m.bendUp = 0;
      m.hasPrev = false;
    } else {
      // Speed, in world units per second, straight off the spline sample's own
      // displacement — no analytic arc length, no assumption that one unit of
      // `t` is one unit of distance (it emphatically is not).
      let world = 0;
      if (m.hasPrev) {
        world =
          Math.hypot(p[0] - m.prevX, p[1] - m.prevY, p[2] - m.prevZ) / dtRaw;
        if (tv > m.prevTv + 1e-6) m.dir = 1;
        else if (tv < m.prevTv - 1e-6) m.dir = -1;
      }
      const speedTarget = Math.min(1, world / SPEED_REF);
      m.speed = approach(
        m.speed,
        speedTarget,
        speedTarget > m.speed ? SPEED_ATTACK : SPEED_RELEASE,
        dtS,
      );
      if (speedTarget === 0 && m.speed < 1e-3) m.speed = 0;

      // ---- ARRIVAL. The lens trails the spline by a speed-proportional
      // distance ALONG THE TANGENT — inertia, not a `t` offset — and the
      // release is four times slower than the attack. So the burn still snaps
      // (the kick spring reads as it always did) and the dock does not: when
      // `t` stops, the camera is still a couple of units short and glides the
      // rest in over about a second, most of it in the last few tenths. That
      // glide IS the arrival easing. It costs the flight nothing, because `t`
      // — and therefore the panel, the rail and the announcement — still lands
      // on exactly the frame Flight.tsx scheduled.
      const trailTarget = -m.dir * Math.min(TRAIL_MAX, TRAIL_SECONDS * world);
      const rising =
        Math.abs(trailTarget) >= Math.abs(m.trail) || trailTarget * m.trail < 0;
      m.trail = approach(
        m.trail,
        trailTarget,
        rising ? TRAIL_ATTACK : TRAIL_RELEASE,
        dtS,
      );
      if (Math.abs(m.trail) < TRAIL_CLOSE) {
        const creep = TRAIL_RELEASE * TRAIL_CLOSE * dtS;
        m.trail = Math.abs(m.trail) <= creep ? 0 : m.trail - Math.sign(m.trail) * creep;
      }

      // ---- LOOK-AHEAD. The DERIVATIVE is sampled ahead; the position never
      // is. Reading the tangent a third of a station down the route says which
      // way the road turns before the camera gets there, which is the whole
      // difference between anticipating a turn and reacting to one.
      const ta = camPath.tangentAt(tv + LOOK_AHEAD * m.dir);
      tmpAhead.set(ta[0], ta[1], ta[2]);
      m.bend = approach(m.bend, tmpAhead.dot(tmpRight), BEND_SMOOTH, dtS);
      m.bendUp = approach(m.bendUp, m.dir * tmpAhead.dot(tmpPathUp), BEND_SMOOTH, dtS);

      // ---- BANK + DEPARTURE BEAT. Roll into the turn, scaled by how fast we
      // are actually taking it, plus a degree of roll off the departure kick
      // so leaving a station has a beat of its own. Integrated as a spring so
      // the horizon rocks back to level instead of snapping there.
      const rollTarget =
        THREE.MathUtils.clamp(-BANK_CAM * m.bend * m.speed, -BANK_CAM_MAX, BANK_CAM_MAX) +
        kick.get() * DEPART_ROLL;
      let rem = dtS;
      while (rem > 1e-6) {
        const h = Math.min(rem, 1 / 120);
        m.rollV +=
          (ROLL_OMEGA * ROLL_OMEGA * (rollTarget - m.roll) -
            2 * ROLL_ZETA * ROLL_OMEGA * m.rollV) *
          h;
        m.roll += m.rollV * h;
        rem -= h;
      }
      // Snapped at rest, and it must be: the panel anchors project through
      // this roll, and a roll that only ASYMPTOTES to zero would keep nudging
      // their rounded pixel positions forever.
      if (
        Math.abs(rollTarget) < 1e-6 &&
        Math.abs(m.roll) < ROLL_EPS &&
        Math.abs(m.rollV) < ROLL_EPS * 4
      ) {
        m.roll = 0;
        m.rollV = 0;
      }

      m.prevX = p[0];
      m.prevY = p[1];
      m.prevZ = p[2];
      m.prevTv = tv;
      m.hasPrev = true;
    }

    // Low coupling: the kick is seasoning on the camera, never a shake.
    const k = kick.get() * 0.3;
    tmpPos.set(p[0], p[1], p[2]).addScaledVector(tmpTan, k + m.trail * cine);
    tmpGaze.set(g[0], g[1], g[2]);
    // ---- LEAD. The eye moves into the bend before the ship does, along the
    // path frame — so a straight leg gets none of this and a hard turn gets
    // all of it. Zero at every dock, which is what keeps the composed docked
    // framing exactly the framing that was composed.
    if (m.speed > 0 && cine > 0) {
      const lead = m.speed * cine;
      tmpGaze
        .addScaledVector(tmpRight, m.bend * LEAD_LAT * lead)
        .addScaledVector(tmpPathUp, m.bendUp * LEAD_VERT * lead);
    }
    // The bank the rest of the frame actually applies — faded out with
    // everything else before the homecoming's own roll (camera.up onto the
    // pad normal) begins, because two rolls running at once is precisely the
    // "choppy whip on final approach" this scene has already been bitten by.
    const camRoll = m.roll * cine;

    // ==== THE FLIGHT HOME — a ballistic arc OVER the system. The raw
    // spline cut straight back through the middle of the voyage, planets
    // and labels whipping past sideways ("the return back to earth looks
    // really strange", verbatim). Instead: climb high off the ecliptic,
    // eyes on Earth, then descend into the landing shot. The arc is fully
    // spent (sin hits π) before the low-horizon landing framing takes
    // over, so the composed touchdown camera is untouched. ====
    const homeRaw = landing ? Math.min(1, Math.max(0, tv - (n - 2))) : 0;
    const arcProg = Math.min(1, homeRaw / 0.78);
    const arc = landing && homeRaw > 0 ? Math.sin(Math.PI * arcProg) * 52 : 0;
    if (arc > 0.01 && landing) {
      tmpPos.y += arc;
      tmpEarthV.set(landing.bodyPos[0], landing.bodyPos[1], landing.bodyPos[2]);
      // Earth-centre gaze dies BEFORE the descent column's pad gaze takes
      // over — two overlapping gaze targets mid-descent read as a wobble.
      tmpGaze.lerp(
        tmpEarthV,
        Math.sin(Math.PI * arcProg) * 0.6 * (1 - smooth(homeRaw, 0.42, 0.52)),
      );
    }
    if (landing && homeRaw > 0) {
      // The dive must never enter the globe — the raw spline's last segment
      // clipped straight through it, near-plane slicing the planet into a
      // see-through shell ("you go right through the earth", verbatim).
      // Continuous radial clearance: push the camera out to a minimum
      // altitude whenever the trajectory dips inside it.
      tmpEarthV.set(landing.bodyPos[0], landing.bodyPos[1], landing.bodyPos[2]);
      const dEarth = tmpPos.distanceTo(tmpEarthV);
      const minD = landing.bodyRadius + 2.4;
      if (dEarth < minD && dEarth > 1e-4) {
        tmpPos.sub(tmpEarthV).multiplyScalar(minD / dEarth).add(tmpEarthV);
      }
      // ==== THE GOOGLE-EARTH DESCENT. From halfway down the homecoming the
      // camera leaves the spline and rides a column above the PAD: high on
      // the surface normal looking down, altitude bleeding off as the site
      // assembles beneath, then sliding out to the composed low landing
      // pose. Ground always below, horizon arriving last — never through
      // the water plane, never under the deck (both prior live reports).
      // At homeRaw=1 the column pose EQUALS the engine's landing camPos
      // (site + n̂·3.25 + tHat·32), so the handoff is exact. ====
      if (landing.site && homeRaw > 0.5) {
        tmpTHat.set(-tmpNorm.z, 0, tmpNorm.x).normalize(); // engine tHat
        const alt = 3.25 + (45 - 3.25) * (1 - smooth(homeRaw, 0.5, 0.97));
        const side = 18 + 14 * smooth(homeRaw, 0.8, 0.99);
        tmpDescent
          .set(landing.site[0], landing.site[1], landing.site[2])
          .addScaledVector(tmpNorm, alt)
          .addScaledVector(tmpTHat, side);
        tmpPos.lerp(tmpDescent, smooth(homeRaw, 0.5, 0.66));
        // ONE gaze bump: eyes on the pad through the drop, released back to
        // the composed gaze in a single smooth window — the old
        // grab-then-late-release overlapped the up-roll and read as chop.
        const gW = smooth(homeRaw, 0.52, 0.68) * (1 - smooth(homeRaw, 0.84, 0.97));
        tmpEarthV.set(landing.site[0], landing.site[1], landing.site[2]);
        tmpGaze.lerp(tmpEarthV, gW);
      }
    }

    // Travel breathes the fov wider mid-leg — but a zoom breathing on top
    // of the descent read as chop, so the landing leg locks to its final
    // fov early.
    let fov = fovAt(points, tv) + (mobile ? MOBILE_FOV_BONUS : 0);
    // ---- FOV BREATHING, off VELOCITY rather than position. fovAt's widening
    // is a fixed `5 * sin(π s)` bump at mid-leg — it opens the same amount
    // whether the ship is tearing through the middle of a leg or parked there.
    // Half of that bump is handed to measured speed instead: the lens opens
    // under acceleration and closes as the ship comes to rest, which reads as
    // speed without anything actually moving faster. Both terms are zero at a
    // dock (s = 0 and speed = 0), so no docked fov changes by a hundredth of a
    // degree — and `s` is recomputed exactly as fovAt computes it.
    if (!reduced) {
      const fc = Math.min(n - 1, Math.max(0, tv));
      const fs = fc - Math.min(n - 2, Math.floor(fc));
      fov += (FOV_SPEED * m.speed - FOV_BUMP_TRIM * Math.sin(Math.PI * fs)) * cine;
    }
    if (landing && homeRaw > 0) {
      fov = fov + (landing.fov + (mobile ? MOBILE_FOV_BONUS : 0) - fov) * smooth(homeRaw, 0.45, 0.75);
    }

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
      // The bank goes into the PROJECTION too. It has to: the panel anchors
      // and the tether are pinned to where their planet actually lands on
      // screen, and a lens that rolls without telling the projection would
      // slide every tether off its limb through the whole turn. The handheld
      // drift below is deliberately NOT here — that one is meant to move the
      // world behind panels that hold still.
      if (camRoll !== 0) projCam.rotateZ(camRoll);
      projCam.updateMatrixWorld();
      projCam.updateProjectionMatrix();
      tmpRightW.setFromMatrixColumn(projCam.matrixWorld, 0).normalize();
      const w = size.width;
      const h = size.height;
      const sizeKey = `${w}x${h}`;
      if (lastSizeKey.current !== sizeKey) {
        lastSizeKey.current = sizeKey;
        panelHeights.current.clear();
        panelWidths.current.clear();
        lastAnchor.current.clear();
        // The column only exists from `xl` up, so at narrower widths it has
        // no box at all and getBoundingClientRect() returns zeros — fall back
        // to the plain 24px inset in that case. The extra 20px is breathing
        // room: type that stops exactly at another element's edge still reads
        // as a collision.
        const tel = document.querySelector('.telemetry');
        const box = tel?.getBoundingClientRect();
        rightSafe.current = box && box.width > 0 ? Math.round(box.left) - 20 : w - 24;
      }
      const cur = Math.round(tv);
      let tetherStr = '';

      anchorMap.forEach((el, i) => {
        const wp = points[i];
        if (!wp) return;
        // Panels mount and unmount as the flight window moves, so they are
        // observed the first time the rig sees them rather than from a list
        // that would have to be kept in sync. A WeakSet because the anchors
        // outlive nothing: when React drops the element, both the set entry
        // and the observation go with it.
        if (!observedAnchors.current.has(el)) {
          observedAnchors.current.add(el);
          panelRO.current?.observe(el);
        }
        let ph = panelHeights.current.get(i);
        if (ph === undefined || ph === 0) {
          ph = el.offsetHeight;
          panelHeights.current.set(i, ph);
        }
        let pw = panelWidths.current.get(i);
        if (pw === undefined || pw === 0) {
          pw = el.offsetWidth;
          panelWidths.current.set(i, pw);
        }
        // Vertical clamp keeps the WHOLE panel on-screen around its -50%
        // translate; an over-tall panel just centres in the safe band.
        const yLo = ph / 2 + 88;
        const yHi = h - ph / 2 - 118;
        // Horizontal: the panel's LEFT edge, so its right edge lands on the
        // safe line. At viewports too narrow to seat both the panel and the
        // instrument column the bound can fall left of the minimum — take
        // the minimum and let the column overlap rather than shoving the
        // panel off the left of the frame.
        const xHi = Math.max(w * 0.34, rightSafe.current - pw);
        let ax: number;
        let ay: number;
        let limbX = 0;
        let limbY = 0;
        let hasLimb = false;

        if (wp.kind === 'earthReturn') {
          // The landing camera sits ON the planet — projecting its centre is
          // meaningless. The homecoming panel docks centre-right, fixed.
          ax = clampPx(w * 0.52, w * 0.34, xHi);
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
          ax = clampPx(limbX + 42, w * 0.34, xHi);
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
      // world breathes behind them. Weighted DOWN with speed — at rest it is
      // exactly the amplitude it always was, and under way it gets out of the
      // way of the travel, where it was only ever competing with real motion.
      const e = state.clock.elapsedTime;
      const still = 1 - m.speed * 0.72;
      camera.position.y += Math.sin(e * 0.45) * 0.5 * still;
      camera.position.x += Math.sin(e * 0.31 + 1.7) * 0.35 * still;
      tmpGaze.y += Math.sin(e * 0.38 + 0.6) * 0.35 * still;
    }
    camera.lookAt(tmpGaze);
    if (camRoll !== 0) camera.rotateZ(camRoll);
    if (!reduced) {
      // ---- IDLE LIFE. A station being READ is still a shot, and a shot that
      // is bit-identical for forty seconds stops looking photographed and
      // starts looking paused. So: a handheld drift — two detuned sines on
      // each of yaw and pitch, at incommensurable rates, so the cycle never
      // visibly repeats — summing to about a tenth of a degree. Enough that
      // the frame is alive, far too little to point at. Strongest docked,
      // gone on approach; camera-LOCAL, so it can only ever tilt the lens,
      // never move it off the composed pose.
      const hand = (1 - m.speed) * (1 - ramp);
      if (hand > 1e-3) {
        const e = state.clock.elapsedTime;
        camera.rotateY((Math.sin(e * 0.23) + 0.6 * Math.sin(e * 0.61 + 2.1)) * DRIFT_YAW * hand);
        camera.rotateX(
          (Math.sin(e * 0.29 + 1.3) + 0.6 * Math.sin(e * 0.53 + 0.4)) * DRIFT_PITCH * hand,
        );
        camera.rotateZ(Math.sin(e * 0.19 + 2.7) * DRIFT_ROLL * hand);
      }
    }

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
    // The engines never fully die in flight — a docked ship holds station on
    // a soft idle burn ("always boostin somewhat, even when stopped",
    // verbatim). Only the landing's touchdown cut takes it to zero.
    let thrust = Math.max(velThrust, 0.34);

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
      // homecoming begins (it should visibly RACE you home). The sample is
      // capped just past the NEXT dock — uncapped, approaching the sun it
      // sampled deep into the return curve and visibly swung all the way
      // around the sun before the visitor had even arrived (live report).
      const aheadT = Math.min(tv + 0.22 + ramp * 0.36, Math.floor(tv + 1e-4) + 1.02);
      const ra = camPath.posAt(aheadT);
      // (tmpRight — screen-right of the flight line — is built once at the top
      // of the frame now; the camera bank and the ship's read the same one.)
      // Offsets push the ship low and LEFT of the flight line — at the old
      // -5.2 it parked over the right-edge telemetry column in the hero
      // frame (live screenshot finding).
      tmpRocket
        .set(ra[0], ra[1], ra[2])
        .addScaledVector(tmpUp, -3.2)
        .addScaledVector(tmpRight, mobile ? 0 : -7.6)
        .addScaledVector(tmpTan, kick.get() * 0.35);
      // The ship rides the homecoming arc with the camera — racing you home
      // above the system, not crawling along the old flat route below.
      tmpRocket.y += arc * 0.85;
      // ==== BODY AVOIDANCE — the cruise path must never pierce a planet
      // (the ship flew straight through Neptune, live report). Continuous
      // radial clearance against every solid body; fields are fine to fly
      // through, that's the fun of them.
      for (let bi = 0; bi < n; bi++) {
        const bw = points[bi];
        if (!bw) continue;
        const bk = bw.kind;
        if (
          bk === 'asteroids' ||
          bk === 'nebula' ||
          bk === 'cluster' ||
          bk === 'outpost' ||
          bk === 'earthReturn'
        ) {
          continue;
        }
        const dx = tmpRocket.x - bw.bodyPos[0];
        const dy = tmpRocket.y - bw.bodyPos[1];
        const dz = tmpRocket.z - bw.bodyPos[2];
        const d = Math.hypot(dx, dy, dz);
        const clearD = bw.bodyRadius * 1.12 + 1.8;
        if (d < clearD && d > 1e-4) {
          const s = clearD / d;
          tmpRocket.set(
            bw.bodyPos[0] + dx * s,
            bw.bodyPos[1] + dy * s,
            bw.bodyPos[2] + dz * s,
          );
        }
      }
      // ==== DOCKED FORMATION — the ship is a character, so it must be IN
      // SHOT at every station. The path-cruise pose above drifts out of
      // frame once the dock gaze swings toward the planet ("I can't even
      // see the rocket after like 3 artifacts", verbatim), so near every
      // dock the ship blends to a camera-relative parking spot: lower-left
      // of frame, holding formation, nose toward the road ahead. At the
      // hero it parks closer still — the opening frame showcases it. ====
      const nearest = Math.round(tv);
      let dockW = ramp > 0 ? 0 : 1 - Math.min(Math.abs(tv - nearest) / 0.35, 1);
      if (ramp === 0) {
        // The sun approach holds formation from MID-LEG: the spline's bend
        // at the sun knot is the sharpest on the route, and even a capped
        // ahead-sample swept the ship around the sun's limb before arrival
        // (two live reports). Camera-relative from halfway in, it cannot.
        const sunIdx = n - 2;
        const wSun =
          smooth(tv, sunIdx - 0.55, sunIdx - 0.18) *
          (1 - smooth(tv, sunIdx + 0.18, sunIdx + 0.55));
        dockW = Math.max(dockW, wSun);
      }
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
        // The engine owns the landing pad (composed with the wide night
        // camera in space.ts); the rig just flies the descent to it. Local
        // "up" at the pad is the surface normal (tmpNorm, set above).
        // BELLY LANDER: this ship sets down FLAT like the freighter it is —
        // gear soles sit at local y=-1.0 (0.95 world at rk.scale 0.95). The
        // pier DECK TOP lies 1.35 beneath the engine's `site` point (site is
        // the legacy touchdown reference at bodyRadius+1.35; the deck is
        // built at bodyRadius), so the origin rests at site - 1.35 + 0.95 —
        // parked on the planks, not hovering (screenshot finding).
        tmpSite
          .set(landing.site[0], landing.site[1], landing.site[2])
          .addScaledVector(tmpNorm, -0.4);
        tmpDir.copy(tmpNorm);
        tmpHover.copy(tmpSite).addScaledVector(tmpDir, 6.5);

        // Position: cruise → hover (approach) → surface (descent).
        const wApproach = smooth(ramp, 0.4, 0.82);
        const wDown = smooth(ramp, 0.82, 0.975);
        tmpHover.lerp(tmpSite, wDown);
        tmpRocket.lerp(tmpHover, wApproach);

        // Orientation: level off horizontal — belly to the pad (up = the
        // surface normal), nose toward the city so the stern's hyperdrive
        // strip faces the landing camera.
        tmpTHat.set(-tmpNorm.z, 0, tmpNorm.x).normalize();
        tmpMat.lookAt(tmpRocket, tmpAim.copy(tmpRocket).sub(tmpTHat), tmpNorm);
        tmpQuatLand.setFromRotationMatrix(tmpMat);
        tmpQuat.slerp(tmpQuatLand, smooth(ramp, 0.42, 0.78));

        // Descent-burn envelope: braking flare on approach, repulsor glow on
        // the drop, engines cut at touchdown.
        const retro = 0.5 * smooth(ramp, 0.4, 0.7) + 0.5 * smooth(ramp, 0.82, 0.9);
        const cut = 1 - smooth(ramp, 0.965, 0.995);
        thrust = Math.max(velThrust * (1 - wApproach), retro * cut);
      }

      rk.position.copy(tmpRocket);
      rk.quaternion.slerp(tmpQuat, reduced ? 1 : ramp > 0 ? 0.2 : 0.12);
      // BANK — see BANK_SHIP above. Heading owns the parked pose and hands
      // the roll to curvature as the ship picks up speed; both terms are
      // smoothed so a knot cannot step them. At rest `m.speed` is exactly 0,
      // so every docked ship pose is bit-for-bit the pose it was before.
      const bankTarget = THREE.MathUtils.clamp(
        -tan[0] * 0.55 * (1 - BANK_HEADING_FADE * m.speed) - BANK_SHIP * m.bend * m.speed,
        -BANK_SHIP_MAX,
        BANK_SHIP_MAX,
      );
      m.shipBank = reduced ? bankTarget : approach(m.shipBank, bankTarget, BANK_SHIP_SMOOTH, dtS);
      if (!reduced && ramp === 0) rk.rotateZ(m.shipBank);
    }

    // Thrust for the flames + trail; bloom boost for the sun approach; the
    // landing ramp for the site fade-in and the atmosphere fade-out.
    thrustRef.current = thrust;
    boostRef.current = sunApproach(n, tv);
    landingRef.current = ramp;
    // Gear: a freighter flies clean and drops its legs on final approach.
    gearRef.current = smooth(ramp, 0.7, 0.94);

    // ==== DEEP-SPACE CULL — the fix for "the return to chicago lagged a
    // ton". Measured on the descent: 42 draw calls / 41k triangles / 958ms
    // a frame at the worst pose, against 14 / 6.5k docked. The solar system
    // was drawing at full cost behind a night scene that already occludes
    // it. Two stages, earliest-safe first:
    //   · detail (labels, meteors, dust, decor bodies) goes at 0.74 — the
    //     camera is diving at a planet surface, none of it is in frame;
    //   · the bodies themselves go at 0.90, by which point the ground disc
    //     is opaque and the dome has the sky.
    // The starfield is deliberately NOT culled: the dome stays translucent
    // at the zenith so real stars show over the city. ====
    const det = detailRef.current;
    if (det) {
      // Aligned with the site's FADE_START: the instant ground appears
      // beneath the dive, the incidental space detail is done contributing.
      const want = ramp < 0.62;
      if (det.visible !== want) det.visible = want;
    }
    const ds = deepSpaceRef.current;
    if (ds) {
      // Just past the ground's full opacity (0.78) — never sooner, or space
      // would show THROUGH the half-faded terrain as a black hole.
      const want = ramp < 0.82;
      if (ds.visible !== want) ds.visible = want;
    }
    // The sun's breath — hoisted out of SolarBodies so the cull never drops
    // a light. Two slow detuned sines: the furnace inhaling, not a strobe.
    const sl = sunLightRef.current;
    if (sl && !reduced) {
      const e = state.clock.elapsedTime;
      sl.intensity =
        sunLightBase * (1 + SUN_LIGHT_PULSE * 0.5 * (Math.sin(e * 0.31) + Math.sin(e * 0.47)));
    }
  });

  return <Rocket3D ref={rocketRef} thrustRef={thrustRef} gearRef={gearRef} reduced={reduced} />;
}

/** Under frameloop='demand' (reduced motion), render exactly one new frame
 *  whenever the station snaps. */
function InvalidateOnT({ t }: { t: MotionValue<number> }) {
  useEffect(() => t.on('change', () => invalidate()), [t]);
  return null;
}

/**
 * SHADER WARM-UP — the fix for "the return to chicago lagged... notably the
 * first time a user is on the site", which is exactly when a recruiter is
 * watching.
 *
 * three compiles a GPU program the first time a material is actually drawn
 * in a given configuration. Half this app's materials — the landing site,
 * the city, the fireworks, the ship's landing gear — do not appear until the
 * final seconds of an eleven-station flight, so their compiles all landed
 * mid-descent as one long hitch.
 *
 * compile() only walks VISIBLE objects, so warming "what is on screen at
 * boot" misses precisely the things that show up late. This forces every
 * object in the scene visible, compiles, and restores — so the flight home
 * draws nothing the GPU has not already seen. It runs a few times across the
 * boot window because scene content (models, suspended textures) is still
 * streaming in, and each arrival brings materials of its own.
 */
function WarmUp({ gearRef }: { gearRef: { current: number } }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  // ==== THE DRESS REHEARSAL ====================================================
  // compile() warms programs from a material's declared state, but the only
  // thing that PROVES a program exists is drawing it. So once, at boot, fly
  // the whole thing to the landing for a single frame and render it to a
  // throwaway 32px target: the pier, the city, the fireworks and the deployed
  // gear all draw for real, off-screen, and the flight home later draws
  // nothing the GPU has not already seen.
  //
  // Gated on the boot overlay still being up. That overlay is opaque and
  // covers the canvas, so the one on-screen frame that also lands cannot be
  // seen; if the overlay has already gone (warm cache, instant boot) the
  // rehearsal is skipped rather than risk a visible flash of the finale.
  // The rehearsal must never touch the flight itself. An earlier version
  // posed the scene by writing the real `t` MotionValue for a frame — which
  // also drives the DOM panels, and a breakpoint check caught a station
  // panel yanked 167px off the top of a 390px viewport during that window.
  // Forcing visibility is enough: three draws a material whose opacity is
  // still 0, so the programs compile all the same.
  const stage = useRef(0);
  useFrame(() => {
    if (stage.current !== 0) return;
    if (document.querySelector('div.fixed.z-30') === null) return; // overlay gone: skip
    stage.current = 1;
    const gearWas = gearRef.current;
    gearRef.current = 1; // so the gear's own materials draw at least once
    const saved: [THREE.Object3D, boolean][] = [];
    scene.traverse((o) => {
      saved.push([o, o.visible]);
      o.visible = true;
    });
    const rt = new THREE.WebGLRenderTarget(32, 32);
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(rt);
    gl.render(scene, camera);
    gl.setRenderTarget(prev);
    rt.dispose();
    for (const [o, v] of saved) o.visible = v;
    gearRef.current = gearWas;
  });

  useEffect(() => {
    const warm = () => {
      // The gear is hidden by its own frame loop off gearRef; deploy it for
      // the warm pass so its materials compile here and not on final
      // approach. The Rig overwrites this on the next frame.
      const gearWas = gearRef.current;
      gearRef.current = 1;
      const saved: [THREE.Object3D, boolean][] = [];
      scene.traverse((o) => {
        saved.push([o, o.visible]);
        o.visible = true;
      });
      gl.compile(scene, camera);
      for (const [o, v] of saved) o.visible = v;
      gearRef.current = gearWas;
    };
    const raf = requestAnimationFrame(warm);
    const t1 = window.setTimeout(warm, 1200);
    const t2 = window.setTimeout(warm, 4000);
    const t3 = window.setTimeout(warm, 10000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [gl, scene, camera, gearRef]);
  return null;
}

/** Dev-only render telemetry for the scripted review harness: draw calls,
 *  triangles and a rolling frame time on `window.__perf`. Compiled out of
 *  production entirely — the whole component is behind import.meta.env.DEV
 *  at the call site. Guessing at where a frame goes is how you end up
 *  optimizing the wrong thing. */
function PerfProbe({
  build,
  live,
  mobile,
}: {
  /** Tier the scene was BUILT from — frozen at detection. */
  build: QualityTier;
  /** Tier in force for the post chain — build, minus runtime step-downs. */
  live: QualityTier;
  mobile: boolean;
}) {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ frames: 0, ms: 0, last: 0 });
  // autoReset clears the counters at the START of every renderer.render(),
  // and the post chain renders several times per frame — so the default
  // reading is just the composer's final fullscreen quad. Own the reset and
  // the totals become the whole frame's real cost.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  useFrame(() => {
    const a = acc.current;
    const now = performance.now();
    if (a.last > 0) {
      a.ms += now - a.last;
      a.frames += 1;
    }
    a.last = now;
    // Short window: this harness runs on a software rasteriser where a frame
    // can cost half a second, and a 20-frame window would report data older
    // than the pose being measured.
    if (a.frames >= 4) {
      const info = gl.info.render;
      (window as unknown as { __perf?: unknown }).__perf = {
        fps: +((1000 * a.frames) / a.ms).toFixed(1),
        ms: +(a.ms / a.frames).toFixed(1),
        // calls/tris are ONE frame's totals, not a windowed average: the
        // gl.info.reset() at the bottom of this callback clears them on every
        // frame, so by the time the 4-frame TIMING window closes these hold
        // the last frame alone. Dividing them by a.frames (as this did until
        // the round-28 integration pass) understated every draw-call and
        // triangle reading by exactly 4x. fps/ms genuinely are windowed.
        calls: info.calls,
        tris: info.triangles,
        // The number that proves the warm-up worked: if this climbs during
        // the flight home, shaders are still compiling mid-descent and the
        // visitor feels it as a stall.
        programs: gl.info.programs?.length ?? -1,
        // Which budget these numbers came from. `build` and `live` differing
        // means the runtime demoted mid-session, and the split is the point:
        // only `live` moves, and only the post chain reads it.
        build,
        live,
        mobile,
      };
      a.frames = 0;
      a.ms = 0;
    }
    gl.info.reset();
  });
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
  const gearRef = useRef(0);
  const deepSpaceRef = useRef<THREE.Group>(null);
  const detailRef = useRef<THREE.Group>(null);
  const points = useMemo(() => voyage(n), [n]);
  const sunPos = (points[n - 1]?.bodyPos ?? [0, 0, 0]) as [number, number, number];
  // The sun body sits at n-2 (n-1 is the homecoming, which reuses Earth).
  const sunWp = points[n - 2];
  const sunLightPos = (sunWp?.bodyPos ?? [0, 0, 0]) as [number, number, number];
  const sunRadius = sunWp?.bodyRadius ?? 26;
  const sunLightBase = useMemo(() => sunLightIntensity(sunRadius), [sunRadius]);
  const sunLightRef = useRef<THREE.PointLight>(null);

  /* ---- ADAPTIVE RESOLUTION ------------------------------------------------
   * `dpr={[1, 2]}` is a CLAMP, not a strategy: it pins the buffer to the
   * device's own pixel ratio capped at 2 and then never reconsiders. That is
   * the right answer for a machine that can hold 60fps at that size and the
   * wrong one for every machine that cannot — and the machines that cannot are
   * exactly the mid-range phones this is most likely to be opened on, from a
   * LinkedIn message, on a train. A phone at devicePixelRatio 3 was rendering
   * 2.25x the pixels of a 1.0 buffer, forever, with no way to give any of them
   * back.
   *
   * The ceiling below reproduces the old behaviour EXACTLY — same cap, same
   * min against the real device ratio — so a capable machine sees no change at
   * all. Only a machine that measurably fails to keep up ever renders smaller,
   * and it climbs back the moment it can. Resolution is the right thing to
   * spend here because it is the one quality axis a visitor does not consciously
   * notice; dropped frames on a camera move are the one they do.
   *
   * Quantised to quarter steps, because dpr is a live drawing-buffer resize:
   * reacting to every sample would trade a frame-rate problem for a churn one.
   * Under reduced motion the loop runs on demand, so there is no frame rate to
   * measure and the monitor is not mounted — a sampler starved of frames would
   * conclude the device is dying and drop a still scene to its floor. */
  const dprCeil = useMemo(() => {
    const cap = mobile ? 1.5 : 2;
    return Math.min(cap, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  }, [mobile]);
  const dprFloor = Math.min(1, dprCeil);
  const [dpr, setDpr] = useState(dprCeil);
  useEffect(() => setDpr(dprCeil), [dprCeil]);
  const stepDpr = useCallback(
    (delta: number) =>
      setDpr((d) => {
        const next = Math.min(dprCeil, Math.max(dprFloor, Math.round((d + delta) * 4) / 4));
        return next === d ? d : next;
      }),
    [dprCeil, dprFloor],
  );

  /* ---- QUALITY TIER — the coarse lever UNDER the ladder above --------------
   * The dpr ladder is the right first response to a slow frame and the wrong
   * only one: it can trade pixels, but by the time it measures anything the
   * nine thousand stars are uploaded and the shaders are compiled. The tier
   * decides what gets BUILT; the ladder keeps trimming inside whatever the
   * tier allowed. So the two compose rather than compete — `dprCap` is the
   * lower of the device ceiling and the tier's ceiling, and the ladder's own
   * state is left exactly as it was.
   *
   * Ordering matters here: the tier only ever steps DOWN (quality.ts explains
   * why at length), so `dprCap` is monotone non-increasing within a session
   * and a tier step can never hand pixels BACK to a device that is already
   * drowning. The ladder state is clamped to the new cap on the way down for
   * the same reason — otherwise a demoted device would sit with a stale
   * ladder value above its cap and absorb the next few decline events with no
   * visible effect. */
  const quality = useQualityTier(mobile, reduced);
  // Two budgets, and the split is load-bearing (quality.ts documents it in
  // full): `budget` is FROZEN at the detected tier and is what the whole 3D
  // tree builds from, so a runtime decline cannot re-tessellate a planet or
  // recompile a material in the frame that detected it. `runtime` carries the
  // knobs a step-down may actually move — the post chain and this dpr ceiling
  // — because neither of those rebuilds anything.
  const budget = quality.budget;
  const runtime = quality.runtime;
  const dprCap = Math.min(dprCeil, runtime.maxDpr);
  const effectiveDpr = Math.min(dpr, dprCap);
  useEffect(() => {
    setDpr((d) => Math.min(d, dprCap));
  }, [dprCap]);
  // Read inside the monitor callbacks without re-subscribing them every time
  // the ladder moves — PerformanceMonitor keeps its own sampling state and
  // remounting it mid-decline would throw that away.
  const dprRef = useRef(dpr);
  useEffect(() => {
    dprRef.current = dpr;
  }, [dpr]);
  const stepQuality = quality.stepDown;
  // Consecutive declines observed while the ladder is ALREADY at its floor.
  // The guard matters most on a 1x display, where dprCeil and dprFloor are
  // both 1 and the ladder has no room at all: without it the very first
  // sub-40fps sampling window — a 1.5s dip on the sun approach, a background
  // tab waking up — would demote the tier on a machine that is fine, and the
  // demotion is deliberately one-way. Two in a row means sustained trouble at
  // the cheapest resolution this device can render, which is the honest
  // threshold for spending the only other lever there is. An incline clears
  // it, so unrelated dips minutes apart never add up to a demotion.
  const floorDeclines = useRef(0);
  const onDecline = useCallback(() => {
    // Pixels first — a smaller buffer is invisible and instant. Only once the
    // ladder has nothing left to give does the tier drop a notch, which is
    // the expensive, visible, one-way move.
    if (dprRef.current > dprFloor + 1e-6) {
      floorDeclines.current = 0;
      stepDpr(-0.25);
      return;
    }
    floorDeclines.current += 1;
    if (floorDeclines.current >= 2) {
      floorDeclines.current = 0;
      stepQuality();
    }
  }, [dprFloor, stepDpr, stepQuality]);
  const onIncline = useCallback(() => {
    floorDeclines.current = 0;
    stepDpr(0.25);
  }, [stepDpr]);
  const onFallback = useCallback(() => {
    // The monitor has given up: floor the buffer AND shed a tier. This is the
    // one path where both levers move at once, because a device that keeps
    // crossing the line in both directions has already proved that trimming
    // pixels alone is not enough.
    setDpr(dprFloor);
    stepQuality();
  }, [dprFloor, stepQuality]);

  return (
    <Canvas
      // The visual layer is decoration; every fact it shows exists in the DOM
      // panels. Screen readers skip it entirely.
      aria-hidden
      frameloop={reduced ? 'demand' : 'always'}
      dpr={effectiveDpr}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 50, near: 0.5, far: 2600, position: [0, 0, 6] }}
      style={{ position: 'absolute', inset: 0 }}
    >
      {/* Measured, not assumed. `bounds` says what this scene considers healthy:
          a refresh rate at or above 55 is fine and below 40 is not, which is
          deliberately generous at the top — the goal is to catch a device that
          is genuinely drowning, not to chase the last few frames on one that is
          merely busy. `flipflops` is the give-up count: a device that keeps
          crossing the line in both directions is not one step from healthy, it
          is oscillating, and pinning it to the floor is kinder than resizing
          its drawing buffer every second forever. */}
      {!reduced && (
        <PerformanceMonitor
          bounds={() => [40, 55]}
          flipflops={3}
          onDecline={onDecline}
          onIncline={onIncline}
          onFallback={onFallback}
        />
      )}
      {/* The whole 3D tree reads its budget from here. Mounted INSIDE the
          canvas deliberately: r3f renders through its own reconciler root, so
          a provider left outside would be one more thing depending on context
          bridging to keep working. The value is memoised per tier, so a
          component that useMemos off a knob rebuilds only when the tier
          genuinely moves — which, by design, is at most twice in a session
          and only ever downward. */}
      <QualityContext.Provider value={budget}>
        <Suspense fallback={null}>
          {/* Image-based lighting from a CC0 night HDRI — this is most of the
              difference between "material" and "grey plastic" on the hull and
              planet dark sides. Lighting only, never the background. */}
          <Environment files="/hdri/dikhololo_night_1k.hdr" />
          {/* Star count comes from the budget now. Mid reproduces the old
              literals exactly (6400 desktop / 3200 mobile) — this is one
              draw call either way, so what the tier is buying is buffer
              build time and fill, not draw calls. */}
          <SpaceEnvironment reduced={reduced} sunPos={sunPos} starCount={budget.starCount} />
          {/* DEEP SPACE — everything the night sky and the ground DISC hide once
              the landing site is planted. The Rig switches this whole group off
              at touchdown: eleven textured bodies (Earth alone carries three 4k
              maps), ten label billboards, the meteor layer and the dressing
              were all still drawing behind an opaque scene, which is most of
              why the return "lagged a ton" (verbatim). The starfield stays —
              the dome is deliberately translucent at the zenith. */}
          {/* The sun's drama light lives OUTSIDE the culled group on purpose:
              a light that disappears with its group changes the scene's light
              counts, and three recompiles every shader program the next frame.
              Hoisted, the light set is constant and the cull costs nothing. */}
          <pointLight
            ref={sunLightRef}
            position={sunLightPos}
            color={SUN_LIGHT_COLOR}
            intensity={sunLightBase}
            decay={SUN_LIGHT_DECAY}
            distance={sunRadius * SUN_LIGHT_CUTOFF}
          />
          <group ref={deepSpaceRef}>
            <SolarBodies waypoints={points} reduced={reduced} landingRef={landingRef} />
          </group>
          {/* Incidental deep-space detail — labels, comet streaks, dust, the
              decor neighbourhood. Culled EARLIER than the bodies: once the
              descent is diving at a planet surface, none of it is in frame,
              and it is a third of the draw calls. */}
          <group ref={detailRef}>
            {/* Floating section labels beside each body — the "ABOUT ME in
                space" read. Static world objects, so they render on every rung. */}
            <StationLabels waypoints={points} reduced={reduced} />
            {/* Comet streaks + velocity warp lines are pure motion — absent
                entirely under reduced. */}
            {!reduced && <Meteors vel={vel} extent={(n - 1) * STEP + 60} />}
            <Dressing waypoints={points} reduced={reduced} />
          </group>
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
            gearRef={gearRef}
            deepSpaceRef={deepSpaceRef}
            detailRef={detailRef}
            sunLightRef={sunLightRef}
            sunLightBase={sunLightBase}
            anchors={anchors}
            tetherLine={tetherLine}
            tetherDot={tetherDot}
          />
          {/* The post chain is the one consumer handed the RUNTIME budget
              rather than the frozen one, and it takes it as props rather than
              through the context so the distinction is impossible to get
              wrong by reaching for useQuality(). Bloom mips and the extra
              passes are the only knobs a runtime decline moves, precisely
              because dropping them rebuilds nothing but the effect chain. */}
          <Effects
            reduced={reduced}
            getBoost={() => boostRef.current}
            bloomLevels={runtime.bloomLevels}
            extraPasses={runtime.extraPasses}
          />
          <WarmUp gearRef={gearRef} />
        </Suspense>
      </QualityContext.Provider>
      {reduced && <InvalidateOnT t={t} />}
      {/* The probe is handed both budgets so a counter reading can say WHICH
          budget produced it. Without that, a before/after comparison on a box
          whose PerformanceMonitor demotes within seconds is measuring the
          demotion rather than the change — which is a mistake that has already
          been made against this file once. */}
      {import.meta.env.DEV && (
        <PerfProbe build={budget.tier} live={quality.tier} mobile={budget.mobile} />
      )}
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
