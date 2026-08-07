/* ==== SPACE ENVIRONMENT ======================================================
 *
 * The stage the voyage flies through: the milky-way backdrop, the deep star
 * field, and the three-light rig. Nothing here reacts to stations or scroll —
 * it is the constant behind every leg, which is why it renders once and only
 * the sun light takes a position from outside (the sun is the scene's key
 * light, so it must sit exactly where space.ts put the final waypoint).
 * ========================================================================= */

import * as THREE from 'three';
import { Stars, useTexture } from '@react-three/drei';
import type { Vec3 } from '../engine';

const MILKY_WAY_URL = '/textures/6k_stars_milky_way.webp';

// Big enough that camera travel (n stations x 95 units) never parallaxes
// against it — a sky that visibly slides reads as a wall, not the galaxy.
const SKY_RADIUS = 1000;

// Fixed aesthetic pose, not animation: the equirect galactic band sits on the
// texture's equator, so tilting X/Z lays it diagonally across the frame and
// the Y turn picks the densest stretch of the band to face the flight line.
const SKY_ROTATION: Vec3 = [0.18, 2.4, 0.58];

// Slight grey multiply on the backdrop so the band glows without competing
// with the DOM panels' text contrast — restraint is the palette contract.
const SKY_TINT = '#c8ccd2';

// Lighting rig. Ambient is dim and cool so shadowed hemispheres stay moody;
// the sun light is warm (the one place warmth is allowed) with decay 0 so it
// carries across the whole voyage; the fill is a whisper from the camera's
// general direction so dark sides shade to charcoal instead of void-black.
const AMBIENT_COLOR = '#aebccb';
const AMBIENT_INTENSITY = 0.18;
const SUN_LIGHT_COLOR = '#fff2e0';
const SUN_LIGHT_INTENSITY = 2.6;
const FILL_COLOR = '#b9c6d6';
const FILL_INTENSITY = 0.15;
// Direction only (directional lights ignore distance): high, right, and
// behind the flight line, roughly where the viewer's eye comes from.
const FILL_FROM: Vec3 = [4, 6, 10];

// Star-field shape: a shell well inside the sky sphere but far outside every
// body, so stars drift with parallax while the milky way holds still.
const STARS_RADIUS = 500;
const STARS_DEPTH = 300;
const STARS_FACTOR = 2; // size variance — kept small so no star reads as a body
const STARS_SPEED = 0.6; // slow twinkle drift; 0 would freeze it entirely

type SpaceEnvironmentProps = {
  /** True freezes all continuous motion — the star drift is the only mover here. */
  reduced: boolean;
  /** World position of the sun body — the key light must sit inside it. */
  sunPos: Vec3;
  starCount?: number;
};

export function SpaceEnvironment({ reduced, sunPos, starCount = 4000 }: SpaceEnvironmentProps) {
  // Configure once on load: sRGB because the map is authored for display, and
  // anisotropy because the sphere's poles otherwise smear at grazing angles.
  const sky = useTexture(MILKY_WAY_URL, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
  });

  return (
    <group>
      {/* Inverted sphere instead of a scene.background cube: it keeps the
          backdrop in world space so the fixed diagonal pose is one rotation,
          and depthWrite off means it can never occlude anything. */}
      <mesh rotation={SKY_ROTATION} frustumCulled={false}>
        <sphereGeometry args={[SKY_RADIUS, 64, 32]} />
        <meshBasicMaterial
          map={sky}
          color={SKY_TINT}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>

      {/* Saturation 0 keeps the field greyscale per the palette contract;
          fade softens the near shell so stars never pop at the camera. */}
      <Stars
        radius={STARS_RADIUS}
        depth={STARS_DEPTH}
        count={starCount}
        factor={STARS_FACTOR}
        saturation={0}
        fade
        speed={reduced ? 0 : STARS_SPEED}
      />

      <ambientLight color={AMBIENT_COLOR} intensity={AMBIENT_INTENSITY} />
      {/* Decay 0 + distance 0: physically the sun would inverse-square away
          to nothing across 1000 units — theatrically it must light Neptune
          and Earth alike, so falloff is switched off. */}
      <pointLight
        position={sunPos}
        color={SUN_LIGHT_COLOR}
        intensity={SUN_LIGHT_INTENSITY}
        decay={0}
        distance={0}
      />
      <directionalLight position={FILL_FROM} color={FILL_COLOR} intensity={FILL_INTENSITY} />
    </group>
  );
}
