/* ==== SPACE ENVIRONMENT ======================================================
 *
 * The stage the voyage flies through: the milky-way backdrop, the deep star
 * field, and the three-light rig. Nothing here reacts to stations or scroll —
 * it is the constant behind every leg, which is why it renders once and only
 * the sun light takes a position from outside (the sun is the scene's key
 * light, so it must sit exactly where space.ts put the final waypoint).
 * ========================================================================= */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { mulberry32, type Vec3 } from '../engine';

const MILKY_WAY_URL = '/textures/6k_stars_milky_way.webp';

// Big enough that camera travel never parallaxes against it — a sky that
// visibly slides reads as a wall, not the galaxy. It is also CENTRED ON THE
// CORRIDOR rather than on the world origin (see `centre` below): the flight
// runs ~950 units down -Z, so an origin-centred 1000-unit sphere ended the
// voyage with its far wall 50 units off the camera's nose. Measured symptom:
// the backdrop drained to flat black over the last three stations, which is
// exactly where the finale needed depth most.
const SKY_RADIUS = 1400;

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
const AMBIENT_INTENSITY = 0.24;
const SUN_LIGHT_COLOR = '#fff2e0';
/** Exported so the planet limb shader can weight the same irradiance the
 *  surfaces themselves receive — an atmosphere that glows where its planet is
 *  dark reads as an outline stroke, not as air. See SolarBodies' Atmosphere. */
export const SUN_LIGHT_INTENSITY = 2.6;
// The KEY light: a cool-white directional from high over the viewer's right
// shoulder. This is what carves a real day/night terminator across every
// body — with only the far sun point light, mid-voyage planets photographed
// flat (live-site finding). Ambient dropped to let the shadow side breathe.
const FILL_COLOR = '#dfe8ff';
/** Also exported for the limb shader — same reason as SUN_LIGHT_INTENSITY. */
export const FILL_INTENSITY = 1.15;
// Direction only (directional lights ignore distance): high, right, and
// behind the flight line, roughly where the viewer's eye comes from.
export const FILL_FROM: Vec3 = [10, 7, 12];

/* ---- the deep star field --------------------------------------------------
 * Hand-built rather than drei's <Stars>, for four reasons that all showed up
 * in screenshots of the shipped field:
 *
 *   1. It was UNSEEDED (Math.random), so the sky reshuffled on every visit.
 *      Every other scatter in this project is seeded off a fixed constant so
 *      the composition a visitor describes is the composition the next one
 *      sees; the sky was the one place that broke the rule.
 *   2. Every star was the SAME brightness — magnitude lived only in point
 *      size, and additive blending then rendered a field of identical dots.
 *      Real depth comes from a handful of obviously bright stars over a haze
 *      of faint ones.
 *   3. Every star was the SAME colour (setHSL at saturation 0), so the field
 *      had no colour temperature at all. Restrained blue-white through amber
 *      is what separates a sky from a screensaver.
 *   4. The whole field breathed IN UNISON — drei multiplies every point size
 *      by (3 + sin(time)), which is a synchronised 2x-4x pulse. Read exactly
 *      like a loading indicator, which is the same verdict the star cluster
 *      component records for twinkle. This field does not animate at all;
 *      its motion is the parallax of a camera actually travelling through it,
 *      and that also means there is nothing here to gate on reduced motion.
 *
 * Cost is unchanged: one Points draw, one program, no bytes on the wire. */
const STARS_SHELL_INNER = 700; // from the corridor centre
const STARS_SHELL_DEPTH = 420; // stars fill [INNER, INNER+DEPTH]
// Magnitude curve. u^POW pushes the population hard toward faint, so the few
// stars that do reach 1.0 read as genuinely bright rather than as "the big
// ones". FLOOR keeps the faintest visible — at 0 they vanish under the
// backdrop tint and the count stops buying anything.
const STAR_MAG_POW = 3.4;
const STAR_MAG_FLOOR = 0.16;
// World-unit sprite size at the star's own distance, faint → brightest. The
// vertex shader converts to pixels through the live projection, so stars keep
// their angular size when the flight's fov breathes.
const STAR_SIZE_MIN = 1.1;
const STAR_SIZE_MAX = 5.4;
// Colour temperature ramp: hot blue-white at one end, cool amber at the
// other, neutral in the middle where most of the population lands. Deviation
// from white is then scaled by STAR_TINT — this is deep space in a telemetry
// palette, so the spread must be FELT rather than seen; at full saturation a
// star field reads as confetti.
const STAR_COOL = '#b6d2ff';
const STAR_WARM = '#ffc98c';
const STAR_TINT = 0.55;
// Above this magnitude a star also gets the wide soft halo in the fragment
// shader — that is the "a few of these are real suns" cue, and it is what
// hands the bloom pass something to catch.
const STAR_HALO_FROM = 0.62;
const STAR_HALO_GAIN = 0.5;
const STARS_SEED = 0x5ee0d;
const STAR_WHITE = new THREE.Color('#ffffff');

const STARS_VERT = `
uniform float uPx;
attribute float aSize;
attribute float aHalo;
varying vec3 vColor;
varying float vHalo;
void main() {
  vColor = color;
  vHalo = aHalo;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Physically-sized points: world size projected through the live camera, so
  // a fov change zooms the field the way it zooms everything else.
  gl_PointSize = clamp(aSize * uPx * projectionMatrix[1][1] / -mv.z, 0.6, 24.0);
  gl_Position = projectionMatrix * mv;
}`;

const STARS_FRAG = `
varying vec3 vColor;
varying float vHalo;
void main() {
  // Two gaussians in one quad: a tight core every star gets, and a wide faint
  // halo only the bright ones get. One draw call still, and the halo is what
  // makes a first-magnitude star read as a light source instead of a pixel.
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 8.0) + exp(-d * d * 1.9) * vHalo;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

/** Seeded star buffers. Position on a shell, magnitude on a steep power law,
 *  colour on a bell-weighted temperature ramp — all three correlated, because
 *  in a real field the bright stars are also the ones whose colour you can
 *  actually see. */
function buildStars(count: number): {
  position: Float32Array;
  color: Float32Array;
  size: Float32Array;
  halo: Float32Array;
} {
  const rand = mulberry32(STARS_SEED);
  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const halo = new Float32Array(count);
  const cool = new THREE.Color(STAR_COOL);
  const warm = new THREE.Color(STAR_WARM);
  const c = new THREE.Color();

  for (let i = 0; i < count; i++) {
    // Uniform on the sphere: acos of a uniform z, never a naive lat/long,
    // which would pile the field at the poles.
    const z = rand() * 2 - 1;
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    const a = rand() * Math.PI * 2;
    const r = STARS_SHELL_INNER + rand() * STARS_SHELL_DEPTH;
    position[i * 3] = Math.cos(a) * s * r;
    position[i * 3 + 1] = Math.sin(a) * s * r;
    position[i * 3 + 2] = z * r;

    const mag = STAR_MAG_FLOOR + (1 - STAR_MAG_FLOOR) * Math.pow(rand(), STAR_MAG_POW);
    // Three samples averaged is a cheap bell — most stars land near neutral
    // and the saturated ends stay rare, which is the real distribution.
    const temp = (rand() + rand() + rand()) / 3;
    c.copy(cool).lerp(warm, temp);
    // Pull every tint back toward white by (1 - STAR_TINT): the palette
    // contract wants the field felt as temperature, not seen as confetti.
    c.lerp(STAR_WHITE, 1 - STAR_TINT);
    color[i * 3] = c.r * mag;
    color[i * 3 + 1] = c.g * mag;
    color[i * 3 + 2] = c.b * mag;

    size[i] = STAR_SIZE_MIN + (STAR_SIZE_MAX - STAR_SIZE_MIN) * Math.pow(mag, 1.8);
    const h = (mag - STAR_HALO_FROM) / (1 - STAR_HALO_FROM);
    halo[i] = h <= 0 ? 0 : h * h * STAR_HALO_GAIN;
  }
  return { position, color, size, halo };
}

type SpaceEnvironmentProps = {
  /** True freezes all continuous motion. The star field is a still by
   *  construction now, so nothing here needs the gate — kept in the signature
   *  because every scene layer takes it and dropping it would make this the
   *  one component a reader has to check. */
  reduced: boolean;
  /** World position of the sun body — the key light must sit inside it. */
  sunPos: Vec3;
  starCount?: number;
};

export function SpaceEnvironment({ sunPos, starCount = 4000 }: SpaceEnvironmentProps) {
  // Configure once on load: sRGB because the map is authored for display, and
  // anisotropy because the sphere's poles otherwise smear at grazing angles.
  const sky = useTexture(MILKY_WAY_URL, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
  });

  // Both shells sit on the MIDPOINT of the flight corridor rather than on the
  // world origin. The voyage runs from the origin out to the sun, so halving
  // the sun's z puts the camera no further than ~half the corridor from the
  // centre at either end — the backdrop keeps its clearance at station 01 and
  // at the sun alike, and the deep field no longer runs out from under the
  // finale. Derived from the waypoint contract, so it re-solves itself if the
  // station count ever changes.
  const centre = useMemo<Vec3>(() => [0, 0, sunPos[2] * 0.5], [sunPos]);

  const stars = useMemo(() => buildStars(starCount), [starCount]);
  const starMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uPx: { value: 450 } },
        vertexShader: STARS_VERT,
        fragmentShader: STARS_FRAG,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        vertexColors: true,
      }),
    [],
  );
  useEffect(() => () => starMaterial.dispose(), [starMaterial]);

  // Half the drawing buffer's height in device pixels — the one number the
  // point-size projection needs. Read from React state rather than per frame
  // so it also lands under reduced motion, where the frameloop is "demand"
  // and useFrame does not run.
  const height = useThree((s) => s.size.height);
  const dpr = useThree((s) => s.viewport.dpr);
  const uPx = starMaterial.uniforms['uPx'];
  if (uPx) uPx.value = height * dpr * 0.5;

  return (
    <group>
      {/* Inverted sphere instead of a scene.background cube: it keeps the
          backdrop in world space so the fixed diagonal pose is one rotation,
          and depthWrite off means it can never occlude anything. */}
      <mesh position={centre} rotation={SKY_ROTATION} frustumCulled={false}>
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

      <points position={centre} material={starMaterial} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[stars.position, 3]} />
          <bufferAttribute attach="attributes-color" args={[stars.color, 3]} />
          <bufferAttribute attach="attributes-aSize" args={[stars.size, 1]} />
          <bufferAttribute attach="attributes-aHalo" args={[stars.halo, 1]} />
        </bufferGeometry>
      </points>

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
