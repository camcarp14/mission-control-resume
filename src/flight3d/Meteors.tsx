/* ==== METEORS + WARP =========================================================
 *
 * The "sky is alive" motion layer, two seeded systems:
 *
 *   1. COMET STREAKS — a handful of elongated additive quads (white-hot head,
 *      teal tail) drifting on a fixed diagonal through the whole voyage
 *      corridor, wrapping deterministically when they exit their box. These
 *      are the shooting stars that make deep space read as weather, not
 *      wallpaper.
 *
 *   2. WARP LINES — thin speed streaks parented to a group that rides the
 *      camera. Their shared material's opacity tracks |vel|: invisible while
 *      docked, streaking hard mid-leg — the hyperspace cue that sells travel.
 *
 * This component is PURE MOTION and is only mounted when reduced motion is
 * off (Scene3D gates it with `!reduced && <Meteors …/>`): there is no still
 * composition here worth keeping, so the reduced path omits it entirely.
 * All randomness is mulberry32-seeded; the frame loop allocates nothing.
 * ========================================================================= */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { MotionValue } from 'framer-motion';
import { mulberry32 } from '../engine';

/* ---- tunables ----------------------------------------------------------- */

// Comet streaks.
const COMET_SEED = 0xc0e7;
const COMET_COUNT = 14;
const COMET_DIR: [number, number, number] = [-0.55, -0.28, -0.8]; // normalized per streak
const COMET_DIR_JITTER = 0.14; // per-streak spread around the shared diagonal
const COMET_X = 140; // half-width of the drift box
const COMET_Y_MIN = -70;
const COMET_Y_MAX = 90;
const COMET_Z_NEAR = 20; // box extends behind the departure camera…
const COMET_Z_PAD = 40; // …and past the deepest waypoint (extent prop)
const COMET_LEN_MIN = 14;
const COMET_LEN_MAX = 30;
const COMET_THICK_MIN = 0.18;
const COMET_THICK_MAX = 0.35;
const COMET_SPEED_MIN = 24; // units/s along the diagonal
const COMET_SPEED_MAX = 40;
const COMET_OPACITY_MIN = 0.5;
const COMET_OPACITY_MAX = 0.85;

// Warp lines.
const WARP_SEED = 0x3a9b;
const WARP_COUNT = 36;
const WARP_RADIUS_MIN = 4; // distance from the camera axis
const WARP_RADIUS_MAX = 14;
const WARP_LEN_MIN = 6;
const WARP_LEN_MAX = 10;
const WARP_THICK = 0.05;
const WARP_Z_MIN = -40; // local cycling window along the flight axis
const WARP_Z_MAX = 8;
const WARP_SPAN = WARP_Z_MAX - WARP_Z_MIN;
const WARP_BASE_SPEED = 28; // units/s toward the viewer…
const WARP_VEL_SPEED = 40; // …plus this per station/s of |vel|
const WARP_VEL_FULL = 0.35; // |vel| at which the system hits full opacity
const WARP_MAX_OPACITY = 0.5;

const MAX_DELTA = 0.25; // tab-return spike clamp so wraps stay single-step

/* ---- shared geometry (module scope — created once, never disposed) ------- */

const COMET_GEOMETRY = new THREE.PlaneGeometry(1, 1); // U runs along local X
// Warp quad baked to run along Z (scale.z = length) with U along the length.
const WARP_GEOMETRY = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2);

/* ---- textures ------------------------------------------------------------ */

/** White-hot head at u=1 fading to a transparent teal tail at u=0, with a
 *  soft vertical falloff so the quad edges never read as cut paper. */
function makeCometTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const along = ctx.createLinearGradient(0, 0, 256, 0);
    along.addColorStop(0, 'rgba(76,201,240,0)');
    along.addColorStop(0.5, 'rgba(110,220,235,0.4)');
    along.addColorStop(0.86, 'rgba(214,248,255,0.9)');
    along.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = along;
    ctx.fillRect(0, 0, 256, 32);
    const across = ctx.createLinearGradient(0, 0, 0, 32);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.5, 'rgba(255,255,255,1)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, 256, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Transparent -> white-cyan -> transparent along the quad length. */
function makeWarpTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, 'rgba(154,220,255,0)');
    g.addColorStop(0.5, 'rgba(224,248,255,0.95)');
    g.addColorStop(1, 'rgba(154,220,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 8);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* ---- specs --------------------------------------------------------------- */

type CometSpec = {
  key: number;
  position: [number, number, number];
  quaternion: THREE.Quaternion;
  dir: [number, number, number];
  speed: number;
  length: number;
  thickness: number;
  opacity: number;
};

const X_AXIS = new THREE.Vector3(1, 0, 0);
const _dir = new THREE.Vector3();

function buildComets(extent: number): CometSpec[] {
  const rng = mulberry32(COMET_SEED);
  const zMin = -extent - COMET_Z_PAD;
  const out: CometSpec[] = [];
  for (let i = 0; i < COMET_COUNT; i++) {
    _dir
      .set(
        COMET_DIR[0] + (rng() - 0.5) * COMET_DIR_JITTER,
        COMET_DIR[1] + (rng() - 0.5) * COMET_DIR_JITTER,
        COMET_DIR[2] + (rng() - 0.5) * COMET_DIR_JITTER,
      )
      .normalize();
    // Local +X (the hot head end of the gradient) aims along the travel
    // direction, so the head leads and the teal tail trails.
    const quaternion = new THREE.Quaternion().setFromUnitVectors(X_AXIS, _dir);
    out.push({
      key: i,
      position: [
        (rng() * 2 - 1) * COMET_X,
        COMET_Y_MIN + rng() * (COMET_Y_MAX - COMET_Y_MIN),
        COMET_Z_NEAR - rng() * (COMET_Z_NEAR - zMin),
      ],
      quaternion,
      dir: [_dir.x, _dir.y, _dir.z],
      speed: COMET_SPEED_MIN + rng() * (COMET_SPEED_MAX - COMET_SPEED_MIN),
      length: COMET_LEN_MIN + rng() * (COMET_LEN_MAX - COMET_LEN_MIN),
      thickness: COMET_THICK_MIN + rng() * (COMET_THICK_MAX - COMET_THICK_MIN),
      opacity: COMET_OPACITY_MIN + rng() * (COMET_OPACITY_MAX - COMET_OPACITY_MIN),
    });
  }
  return out;
}

type WarpSpec = {
  key: number;
  x: number;
  y: number;
  z: number;
  roll: number;
  length: number;
};

function buildWarpLines(): WarpSpec[] {
  const rng = mulberry32(WARP_SEED);
  const out: WarpSpec[] = [];
  for (let i = 0; i < WARP_COUNT; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = WARP_RADIUS_MIN + rng() * (WARP_RADIUS_MAX - WARP_RADIUS_MIN);
    out.push({
      key: i,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      z: WARP_Z_MIN + rng() * WARP_SPAN, // staggered phases — no pulsing
      roll: angle, // width tangential, face toward the axis (double-sided)
      length: WARP_LEN_MIN + rng() * (WARP_LEN_MAX - WARP_LEN_MIN),
    });
  }
  return out;
}

/* ---- component ----------------------------------------------------------- */

export function Meteors({ vel, extent }: { vel: MotionValue<number>; extent: number }) {
  const cometsRef = useRef<THREE.Group>(null);
  const warpRef = useRef<THREE.Group>(null);

  const comets = useMemo(() => buildComets(extent), [extent]);
  const warpLines = useMemo(() => buildWarpLines(), []);

  const cometTexture = useMemo(() => makeCometTexture(), []);
  const warpTexture = useMemo(() => makeWarpTexture(), []);
  useEffect(
    () => () => {
      cometTexture.dispose();
      warpTexture.dispose();
    },
    [cometTexture, warpTexture],
  );

  // ONE material for all warp lines — its opacity is the whole system's
  // throttle, written once per frame from |vel|.
  const warpMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: warpTexture,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [warpTexture],
  );
  useEffect(() => () => warpMaterial.dispose(), [warpMaterial]);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, MAX_DELTA);

    // 1. Comets: drift along their diagonal; wrap by box size on exit —
    // deterministic, no random on wrap.
    const cg = cometsRef.current;
    if (cg) {
      const zMin = -extent - COMET_Z_PAD;
      const zSize = COMET_Z_NEAR - zMin;
      const xSize = COMET_X * 2;
      const ySize = COMET_Y_MAX - COMET_Y_MIN;
      for (let i = 0; i < cg.children.length; i++) {
        const mesh = cg.children[i];
        const spec = comets[i];
        if (!mesh || !spec) continue;
        const p = mesh.position;
        p.x += spec.dir[0] * spec.speed * delta;
        p.y += spec.dir[1] * spec.speed * delta;
        p.z += spec.dir[2] * spec.speed * delta;
        if (p.x < -COMET_X) p.x += xSize;
        else if (p.x > COMET_X) p.x -= xSize;
        if (p.y < COMET_Y_MIN) p.y += ySize;
        else if (p.y > COMET_Y_MAX) p.y -= ySize;
        if (p.z < zMin) p.z += zSize;
        else if (p.z > COMET_Z_NEAR) p.z -= zSize;
      }
    }

    // 2. Warp lines: ride the camera; cycle local z toward the viewer at a
    // velocity-boosted rate; the shared material's opacity tracks |vel| so
    // the system is invisible at dock and streaks during legs.
    const wg = warpRef.current;
    if (wg) {
      wg.position.copy(state.camera.position);
      const v = Math.abs(vel.get());
      const opacity = THREE.MathUtils.clamp(v / WARP_VEL_FULL, 0, 1) * WARP_MAX_OPACITY;
      warpMaterial.opacity = opacity;
      wg.visible = opacity > 0.003; // skip 36 draw calls while docked
      if (wg.visible) {
        const dz = (WARP_BASE_SPEED + v * WARP_VEL_SPEED) * delta;
        for (const line of wg.children) {
          line.position.z += dz;
          if (line.position.z > WARP_Z_MAX) line.position.z -= WARP_SPAN;
        }
      }
    }
  });

  return (
    <group>
      <group ref={cometsRef}>
        {comets.map((spec) => (
          <mesh
            key={spec.key}
            geometry={COMET_GEOMETRY}
            position={spec.position}
            quaternion={spec.quaternion}
            scale={[spec.length, spec.thickness, 1]}
          >
            <meshBasicMaterial
              map={cometTexture}
              transparent
              opacity={spec.opacity}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </group>

      {/* The warp group teleports to the camera every frame — bounding-sphere
          culling would flicker it, so culling is off for every line. */}
      <group ref={warpRef} frustumCulled={false} visible={false}>
        {warpLines.map((spec) => (
          <mesh
            key={spec.key}
            geometry={WARP_GEOMETRY}
            material={warpMaterial}
            position={[spec.x, spec.y, spec.z]}
            rotation={[0, 0, spec.roll]}
            scale={[1, WARP_THICK, spec.length]}
            frustumCulled={false}
          />
        ))}
      </group>
    </group>
  );
}
