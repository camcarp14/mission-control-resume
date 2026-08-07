/* ==== LANDING SITE ===========================================================
 *
 * The finale's ground truth. The homecoming used to end with a ~4-unit shuttle
 * touching a radius-17 globe — a toy on a marble. This layer fades in over the
 * final approach and turns the touchdown point into a PLACE: a meadow-dark
 * ground disc running to the horizon, a lit landing pad under the legs, a
 * dusk-band sky dome, silhouette hills breaking the rim, and a few slow
 * clouds. By the time the ship flips for its descent the world is fully
 * planted, so the last frame reads "rocket setting down on a landscape at
 * dusk", not "rocket on a globe".
 *
 * Everything is procedural (seeded canvas textures, mulberry32(0xC0FFEE)),
 * one local group oriented to the pad's surface normal, ~12 draw calls. The
 * opacity ramp is STATE (it tracks the flight position), so it runs under
 * reduced motion; the only continuous animation — cloud drift — is gated off
 * and parked when `reduced` is true.
 * ========================================================================= */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { MotionValue } from 'framer-motion';
import { legInto, mulberry32 } from '../engine';
import type { Waypoint } from '../engine';

/* ---- tunables ----------------------------------------------------------- */

const SEED = 0xc0ffee;

// Ground disc: must read flat-to-the-horizon from an eye height of ~1.3.
const GROUND_RADIUS = 90;
const GROUND_SEGMENTS = 64;
const GROUND_TEX_SIZE = 1024;
const GROUND_BASE = '#1c3527'; // night meadow
const GROUND_PATCHES = ['#244530', '#2e5040', '#16281e'] as const;
const GROUND_PATCH_COUNT = 140;
const GROUND_VEIN_COUNT = 4;
const GROUND_FADE_START = 0.75; // outer 25% of the disc dissolves into haze

// Landing pad, centred at the local origin — directly under the ship.
const PAD_RADIUS = 4.2;
const PAD_LIFT = 0.03; // above the ground plane
const PAD_TEX_SIZE = 512;
const PAD_ASPHALT = '#10171a';
const PAD_CYAN = '#7df9ff';
const PAD_RING_AT = 0.85; // outer ring radius fraction
const PAD_DASH_AT = 0.5; // inner dashed circle
const PAD_LABEL = 'CC-01';

// Sky dome: a dusk band hugging the horizon, transparent navy above.
const DOME_RADIUS = 130;
const DOME_ALPHA = 0.75; // band strength at the horizon

// Horizon hills: dark silhouette mounds that break the disc's perfect edge.
const HILL_COUNT = 5;
const HILL_COLOR = '#0d1a14';
const HILL_DIST_MIN = 55;
const HILL_DIST_MAX = 80;
const HILL_HEIGHT_MIN = 2;
const HILL_HEIGHT_MAX = 6;
const HILL_WIDTH_MIN = 8;
const HILL_WIDTH_MAX = 20;

// Clouds: soft sprite puffs on a very slow lateral drift.
const CLOUD_COUNT = 7;
const CLOUD_TEX_SIZE = 256;
const CLOUD_DIST_MIN = 14;
const CLOUD_DIST_MAX = 46;
const CLOUD_HEIGHT_MIN = 5;
const CLOUD_HEIGHT_MAX = 11;
const CLOUD_SCALE_MIN = 6;
const CLOUD_SCALE_MAX = 14;
const CLOUD_SPEED_MIN = 0.1; // u/s along local X
const CLOUD_SPEED_MAX = 0.25;
const CLOUD_WRAP = 50; // drift wraps at ±this

// Pad glow: one additive sprite so the pad reads lit.
const GLOW_TEX_SIZE = 128;
const GLOW_SCALE = 10;
const GLOW_OPACITY = 0.12;

// Ramp: 0 until the homecoming leg begins, 1 at touchdown. The site becomes
// visible almost immediately and is fully opaque well before the final
// descent (ramp 0.82+), so the flip and touchdown happen inside a complete
// world.
const VISIBLE_AT = 0.03;
const FADE_START = 0.3;
const FADE_SPAN = 0.55;

/* ---- module-scope scratch (zero per-frame allocs) ------------------------ */

const _dummy = new THREE.Object3D();

/* ---- sky dome shader ----------------------------------------------------- */

const DOME_VERT = /* glsl */ `
  varying float vH;
  void main() {
    vH = position.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Height-blended dusk: transparent navy at the top, a glowing #1a3b52 band
// near the ground with a thin #4cc9f0 line right at the horizon. Alpha peaks
// at ~DOME_ALPHA at y=0 and is gone by 40% height. uOpacity is the master
// fade for the whole site.
const DOME_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying float vH;
  void main() {
    float h = clamp(vH / ${DOME_RADIUS.toFixed(1)}, 0.0, 1.0);
    float band = 1.0 - smoothstep(0.0, 0.4, h);
    vec3 navy = vec3(0.024, 0.039, 0.071);  /* #060a12 */
    vec3 dusk = vec3(0.102, 0.231, 0.322);  /* #1a3b52 */
    vec3 line = vec3(0.298, 0.788, 0.941);  /* #4cc9f0 */
    vec3 col = mix(navy, dusk, band);
    float horizon = 1.0 - smoothstep(0.0, 0.045, abs(h));
    col = mix(col, line, horizon * 0.85);
    gl_FragColor = vec4(col, ${DOME_ALPHA.toFixed(2)} * band * uOpacity);
  }
`;

/* ---- seeded canvas painting ---------------------------------------------- */

function rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function makeCanvasTexture(size: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Night-meadow ground: mottled seeded patches over a dark green base, faint
 *  water-ish veins, a darker ring near the rim, and the outer 25% fading to
 *  transparent so the disc dissolves into haze instead of ending in an edge.
 *  NO grid lines — this is terrain, not a hologram. */
function paintGround(ctx: CanvasRenderingContext2D, rng: () => number): void {
  const S = GROUND_TEX_SIZE;
  const c = S / 2;
  ctx.fillStyle = GROUND_BASE;
  ctx.fillRect(0, 0, S, S);

  // Mottled patches: many overlapping soft radial blobs, varied sizes.
  for (let i = 0; i < GROUND_PATCH_COUNT; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 18 + rng() * 110;
    const color = GROUND_PATCHES[Math.floor(rng() * GROUND_PATCHES.length)] ?? GROUND_BASE;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, 0.35 + rng() * 0.25));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Faint darker water-ish veins wandering across the meadow.
  ctx.strokeStyle = 'rgba(9,20,26,0.22)';
  ctx.lineCap = 'round';
  for (let v = 0; v < GROUND_VEIN_COUNT; v++) {
    ctx.lineWidth = 5 + rng() * 9;
    ctx.beginPath();
    let px = rng() * S;
    let py = rng() * S;
    ctx.moveTo(px, py);
    for (let s = 0; s < 4; s++) {
      const cx = px + (rng() - 0.5) * 320;
      const cy = py + (rng() - 0.5) * 320;
      px += (rng() - 0.5) * 420;
      py += (rng() - 0.5) * 420;
      ctx.quadraticCurveTo(cx, cy, px, py);
    }
    ctx.stroke();
  }

  // Darker ring near the rim — the land visibly recedes before it dissolves.
  const ring = ctx.createRadialGradient(c, c, 0, c, c, c);
  ring.addColorStop(0.55, 'rgba(10,18,14,0)');
  ring.addColorStop(0.82, 'rgba(10,18,14,0.28)');
  ring.addColorStop(1, 'rgba(10,18,14,0.55)');
  ctx.fillStyle = ring;
  ctx.fillRect(0, 0, S, S);

  // Bake the rim's alpha fade: outer 25% of the disc goes transparent.
  ctx.globalCompositeOperation = 'destination-out';
  const fade = ctx.createRadialGradient(c, c, 0, c, c, c);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(GROUND_FADE_START, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';
}

/** The pad: dark asphalt, one bold glowing cyan ring, an inner dashed circle,
 *  four corner ticks, and 'CC-01' stencilled twice at the edge. */
function paintPad(ctx: CanvasRenderingContext2D): void {
  const S = PAD_TEX_SIZE;
  const c = S / 2;
  const R = S / 2;
  ctx.fillStyle = PAD_ASPHALT;
  ctx.fillRect(0, 0, S, S);

  // Bold outer ring with a slight glow.
  ctx.strokeStyle = PAD_CYAN;
  ctx.lineWidth = 10;
  ctx.shadowColor = PAD_CYAN;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(c, c, R * PAD_RING_AT, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Inner dashed circle.
  ctx.strokeStyle = rgba(PAD_CYAN, 0.5);
  ctx.lineWidth = 5;
  ctx.setLineDash([26, 18]);
  ctx.beginPath();
  ctx.arc(c, c, R * PAD_DASH_AT, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Four corner tick marks between ring and rim.
  ctx.strokeStyle = rgba(PAD_CYAN, 0.8);
  ctx.lineWidth = 8;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * R * 0.9, c + Math.sin(a) * R * 0.9);
    ctx.lineTo(c + Math.cos(a) * R * 0.98, c + Math.sin(a) * R * 0.98);
    ctx.stroke();
  }

  // Pad designation, twice, tangent to the edge.
  ctx.fillStyle = rgba(PAD_CYAN, 0.75);
  ctx.font = '600 26px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const a of [-Math.PI / 2, Math.PI / 2]) {
    ctx.save();
    ctx.translate(c + Math.cos(a) * R * 0.68, c + Math.sin(a) * R * 0.68);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(PAD_LABEL, 0, 0);
    ctx.restore();
  }
}

/** Cloud puff: layered soft white blobs with low baked alpha. */
function paintCloud(ctx: CanvasRenderingContext2D, rng: () => number): void {
  const S = CLOUD_TEX_SIZE;
  for (let i = 0; i < 10; i++) {
    // Blobs cluster into a horizontal drift of vapor: wide in x, shallow in y.
    const x = S * (0.5 + (rng() - 0.5) * 0.55);
    const y = S * (0.5 + (rng() - 0.5) * 0.3);
    const r = S * (0.1 + rng() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(0.6, 'rgba(235,244,248,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Radial teal gradient for the pad's additive glow sprite. */
function paintGlow(ctx: CanvasRenderingContext2D): void {
  const S = GLOW_TEX_SIZE;
  const c = S / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(125,249,255,0.9)');
  g.addColorStop(0.4, 'rgba(76,201,240,0.35)');
  g.addColorStop(1, 'rgba(76,201,240,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
}

/* ---- seeded specs -------------------------------------------------------- */

type HillSpec = { x: number; z: number; w: number; h: number };
type CloudSpec = { x0: number; y: number; z: number; scale: number; speed: number; base: number };

type SiteAssets = {
  groundTex: THREE.CanvasTexture;
  padTex: THREE.CanvasTexture;
  cloudTex: THREE.CanvasTexture;
  glowTex: THREE.CanvasTexture;
  domeMaterial: THREE.ShaderMaterial;
  domeUniforms: { uOpacity: { value: number } };
  hillGeometry: THREE.SphereGeometry;
  hills: HillSpec[];
  clouds: CloudSpec[];
};

/** Everything seeded and built ONCE, drawing from a single rng in a fixed
 *  order so the site is identical on every visit. */
function buildAssets(): SiteAssets {
  const rng = mulberry32(SEED);

  const groundTex = makeCanvasTexture(GROUND_TEX_SIZE, (ctx) => paintGround(ctx, rng));
  const padTex = makeCanvasTexture(PAD_TEX_SIZE, paintPad);
  const cloudTex = makeCanvasTexture(CLOUD_TEX_SIZE, (ctx) => paintCloud(ctx, rng));
  const glowTex = makeCanvasTexture(GLOW_TEX_SIZE, paintGlow);

  const domeUniforms = { uOpacity: { value: 0 } };
  const domeMaterial = new THREE.ShaderMaterial({
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    uniforms: domeUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
  });

  // One unit hemisphere shared by all hills; per-instance matrices flatten
  // and widen it into mounds.
  const hillGeometry = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);

  // Hills: jittered around the full circle so a few always break the horizon
  // whichever way the finale camera looks.
  const hills: HillSpec[] = [];
  for (let i = 0; i < HILL_COUNT; i++) {
    const a = ((i + 0.15 + rng() * 0.7) / HILL_COUNT) * Math.PI * 2;
    const d = HILL_DIST_MIN + rng() * (HILL_DIST_MAX - HILL_DIST_MIN);
    hills.push({
      x: Math.cos(a) * d,
      z: Math.sin(a) * d,
      w: HILL_WIDTH_MIN + rng() * (HILL_WIDTH_MAX - HILL_WIDTH_MIN),
      h: HILL_HEIGHT_MIN + rng() * (HILL_HEIGHT_MAX - HILL_HEIGHT_MIN),
    });
  }

  const clouds: CloudSpec[] = [];
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const a = rng() * Math.PI * 2;
    const d = CLOUD_DIST_MIN + rng() * (CLOUD_DIST_MAX - CLOUD_DIST_MIN);
    clouds.push({
      x0: Math.cos(a) * d,
      y: CLOUD_HEIGHT_MIN + rng() * (CLOUD_HEIGHT_MAX - CLOUD_HEIGHT_MIN),
      z: Math.sin(a) * d,
      scale: CLOUD_SCALE_MIN + rng() * (CLOUD_SCALE_MAX - CLOUD_SCALE_MIN),
      speed: CLOUD_SPEED_MIN + rng() * (CLOUD_SPEED_MAX - CLOUD_SPEED_MIN),
      base: 0.75 + rng() * 0.25,
    });
  }

  return {
    groundTex,
    padTex,
    cloudTex,
    glowTex,
    domeMaterial,
    domeUniforms,
    hillGeometry,
    hills,
    clouds,
  };
}

/* ---- component ----------------------------------------------------------- */

export function LandingSite({
  waypoints,
  t,
  reduced,
}: {
  waypoints: Waypoint[];
  t: MotionValue<number>;
  reduced: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const hillsRef = useRef<THREE.InstancedMesh>(null);
  const groundMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const padMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const hillMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const glowMatRef = useRef<THREE.SpriteMaterial>(null);
  const cloudRefs = useRef<Array<THREE.Sprite | null>>([]);

  // The site's local frame: local +Y is the pad's surface normal, origin is
  // the sphere-surface point directly under the pad (the ship's fin soles
  // land exactly there). One group carries the whole site.
  const frame = useMemo(() => {
    const wp = waypoints[waypoints.length - 1];
    if (!wp || wp.kind !== 'earthReturn' || !wp.site) return null;
    const nHat = new THREE.Vector3(
      wp.site[0] - wp.bodyPos[0],
      wp.site[1] - wp.bodyPos[1],
      wp.site[2] - wp.bodyPos[2],
    ).normalize();
    const position = new THREE.Vector3(wp.bodyPos[0], wp.bodyPos[1], wp.bodyPos[2]).addScaledVector(
      nHat,
      wp.bodyRadius,
    );
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      nHat,
    );
    return { position, quaternion };
  }, [waypoints]);

  const assets = useMemo(buildAssets, []);

  // Canvas textures, the dome material and the shared hill geometry are
  // created imperatively, so they are disposed imperatively.
  useEffect(
    () => () => {
      assets.groundTex.dispose();
      assets.padTex.dispose();
      assets.cloudTex.dispose();
      assets.glowTex.dispose();
      assets.domeMaterial.dispose();
      assets.hillGeometry.dispose();
    },
    [assets],
  );

  // Flatten + widen the shared hemisphere into each mound.
  useLayoutEffect(() => {
    const mesh = hillsRef.current;
    if (!mesh) return;
    for (let i = 0; i < assets.hills.length; i++) {
      const hill = assets.hills[i];
      if (!hill) continue;
      _dummy.position.set(hill.x, 0, hill.z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(hill.w, hill.h, hill.w);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [assets, frame]);

  // Reduced motion parks every cloud at its seeded start — including when the
  // preference flips mid-drift.
  useEffect(() => {
    if (!reduced) return;
    for (let i = 0; i < assets.clouds.length; i++) {
      const spec = assets.clouds[i];
      const sprite = cloudRefs.current[i];
      if (spec && sprite) sprite.position.x = spec.x0;
    }
  }, [reduced, assets]);

  // The ramp is STATE (it tracks the flight position along the homecoming
  // leg), so it runs every rung — reduced motion included. Only the cloud
  // drift below is motion, and it is gated.
  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const n = waypoints.length;
    const ramp = legInto(n, n - 1, t.get());
    const visible = ramp > VISIBLE_AT;
    group.visible = visible;
    if (!visible) return;

    // Master opacity: fully planted before the ship's final descent (0.82+).
    let k = (ramp - FADE_START) / FADE_SPAN;
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    k = k * k * (3 - 2 * k);

    if (groundMatRef.current) groundMatRef.current.opacity = k;
    if (padMatRef.current) padMatRef.current.opacity = k;
    if (hillMatRef.current) hillMatRef.current.opacity = k;
    if (glowMatRef.current) glowMatRef.current.opacity = GLOW_OPACITY * k;
    assets.domeUniforms.uOpacity.value = k;

    const e = state.clock.elapsedTime;
    for (let i = 0; i < assets.clouds.length; i++) {
      const spec = assets.clouds[i];
      const sprite = cloudRefs.current[i];
      if (!spec || !sprite) continue;
      sprite.material.opacity = spec.base * k;
      if (!reduced) {
        // Slow lateral drift along local X, wrapping at ±CLOUD_WRAP. The
        // seeded x0 is ≥ -46, so the modulus argument stays positive.
        sprite.position.x =
          ((spec.x0 + e * spec.speed + CLOUD_WRAP) % (CLOUD_WRAP * 2)) - CLOUD_WRAP;
      }
    }
  });

  if (!frame) return null;

  return (
    <group ref={groupRef} position={frame.position} quaternion={frame.quaternion} visible={false}>
      {/* 1. Ground: flat to the horizon, rim baked to dissolve into haze. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[GROUND_RADIUS, GROUND_SEGMENTS]} />
        <meshStandardMaterial
          ref={groundMatRef}
          map={assets.groundTex}
          transparent
          opacity={0}
          roughness={1}
          metalness={0}
          depthWrite
        />
      </mesh>

      {/* 2. Landing pad, directly under the ship's touchdown point. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, PAD_LIFT, 0]}>
        <circleGeometry args={[PAD_RADIUS, GROUND_SEGMENTS]} />
        <meshStandardMaterial
          ref={padMatRef}
          map={assets.padTex}
          transparent
          opacity={0}
          roughness={1}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={-1}
        />
      </mesh>

      {/* 3. Sky dome: dusk band at the horizon, transparent navy above.
          Drawn after the depth-writing ground/hills so the land occludes it,
          before the clouds so they read in front of the sky. */}
      <mesh renderOrder={1}>
        <sphereGeometry args={[DOME_RADIUS, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <primitive object={assets.domeMaterial} attach="material" />
      </mesh>

      {/* 4. Horizon hills: one instanced draw of five silhouette mounds. */}
      <instancedMesh
        ref={hillsRef}
        args={[assets.hillGeometry, undefined, HILL_COUNT]}
        frustumCulled={false}
      >
        <meshStandardMaterial
          ref={hillMatRef}
          color={HILL_COLOR}
          transparent
          opacity={0}
          roughness={1}
          metalness={0}
        />
      </instancedMesh>

      {/* 5. Clouds: seven soft puffs, parked under reduced motion. */}
      {assets.clouds.map((spec, i) => (
        <sprite
          key={i}
          ref={(el) => {
            cloudRefs.current[i] = el;
          }}
          position={[spec.x0, spec.y, spec.z]}
          scale={[spec.scale, spec.scale * 0.6, 1]}
          renderOrder={2}
        >
          <spriteMaterial map={assets.cloudTex} transparent opacity={0} depthWrite={false} />
        </sprite>
      ))}

      {/* 6. Pad glow: the pad reads lit from below the ship. */}
      <sprite position={[0, 0.35, 0]} scale={[GLOW_SCALE, GLOW_SCALE, 1]} renderOrder={3}>
        <spriteMaterial
          ref={glowMatRef}
          map={assets.glowTex}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
    </group>
  );
}
