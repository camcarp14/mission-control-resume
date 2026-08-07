/* ==== EFFECTS ================================================================
 *
 * The single post chain: bloom so emissives (sun, thrust flame, nav lights)
 * glow, and a whisper of vignette to pull the eye centre-frame. Kept to two
 * passes with multisampling off because the composer runs every frame on
 * whatever GPU the visitor brought — the voyage must stay cheap.
 * ========================================================================= */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode, type BloomEffect } from 'postprocessing';

// Threshold sits above anything a lit grey material can reach, so only
// deliberately emissive surfaces bloom — a glowing planet would break the
// near-black restraint the whole palette is built on. (Eased from 0.9 when
// the exhaust went teal: the plume/trail shaders peak lower than the old
// emissive cones, and the reference look leans on visible glow.)
const BLOOM_THRESHOLD = 0.85;
const BLOOM_SMOOTHING = 0.12;
const BLOOM_BASE = 0.8;
// Full sun approach nearly quadruples the glow — the finale should feel hot.
const BLOOM_BOOST = 1.8;
const VIGNETTE_DARKNESS = 0.25;
const VIGNETTE_OFFSET = 0.22;

type EffectsProps = {
  /** Accepted for scene-wide signature parity; the bloom swell tracks the
   *  camera (stepwise under reduced motion, since it never self-oscillates),
   *  so there is nothing here to gate. */
  reduced: boolean;
  /** Sun-approach ramp, 0 far away to 1 at the final dock. */
  getBoost: () => number;
};

export function Effects({ getBoost }: EffectsProps) {
  const bloomRef = useRef<BloomEffect>(null);

  // Mutate the effect directly: bloom swell is per-frame continuous state,
  // and routing it through React would re-render the whole canvas tree.
  useFrame(() => {
    const bloom = bloomRef.current;
    if (bloom) bloom.intensity = BLOOM_BASE + getBoost() * BLOOM_BOOST;
  });

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        // CALLBACK ref, not an object ref, and it is load-bearing: React 19
        // passes `ref` through props, and @react-three/postprocessing memoizes
        // effect args with JSON.stringify(props). Once an object ref holds the
        // (circular) BloomEffect instance, the next re-render throws
        // "Converting circular structure to JSON" and takes the whole app
        // down. JSON.stringify skips function values — a callback ref is
        // invisible to the memo.
        ref={(b: BloomEffect | null) => {
          bloomRef.current = b;
        }}
        mipmapBlur
        intensity={BLOOM_BASE}
        luminanceThreshold={BLOOM_THRESHOLD}
        luminanceSmoothing={BLOOM_SMOOTHING}
      />
      <Vignette darkness={VIGNETTE_DARKNESS} offset={VIGNETTE_OFFSET} />
      {/* Mounting an EffectComposer sets the renderer to NoToneMapping, so
          without this final pass the whole scene renders in raw linear —
          washed, flat, and visibly worse than the same scene un-composed
          (live-site screenshot finding). ACES filmic restores the contrast
          and highlight roll-off every real GPU pipeline expects. */}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
