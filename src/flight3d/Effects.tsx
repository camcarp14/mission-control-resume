/* ==== EFFECTS ================================================================
 *
 * The single post chain: bloom so emissives (sun, thrust flame, nav lights)
 * glow, and a whisper of vignette to pull the eye centre-frame. Kept to two
 * passes with multisampling off because the composer runs every frame on
 * whatever GPU the visitor brought — the voyage must stay cheap.
 * ========================================================================= */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import type { BloomEffect } from 'postprocessing';

// Threshold sits above anything a lit grey material can reach, so only
// deliberately emissive surfaces bloom — a glowing planet would break the
// near-black restraint the whole palette is built on.
const BLOOM_THRESHOLD = 0.9;
const BLOOM_SMOOTHING = 0.12;
const BLOOM_BASE = 0.7;
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
        ref={bloomRef}
        mipmapBlur
        intensity={BLOOM_BASE}
        luminanceThreshold={BLOOM_THRESHOLD}
        luminanceSmoothing={BLOOM_SMOOTHING}
      />
      <Vignette darkness={VIGNETTE_DARKNESS} offset={VIGNETTE_OFFSET} />
    </EffectComposer>
  );
}
