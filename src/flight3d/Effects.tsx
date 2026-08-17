/* ==== EFFECTS ================================================================
 *
 * The single post chain, and the only thing in the app that touches EVERY
 * pixel of EVERY frame. It grades the whole voyage, so it is also the first
 * place a weak device drowns — which is why the chain is TIERED rather than
 * fixed.
 *
 * WHAT EVERY TIER GETS (this is the shipped baseline, unchanged):
 *   bloom  so emissives (sun, thrust flame, nav lights, the night skyline)
 *          glow — the one effect the art direction actually depends on;
 *   vignette  a whisper, to pull the eye centre-frame;
 *   ACES tone mapping, LAST, always. Mounting an EffectComposer sets the
 *          renderer to NoToneMapping, so without that final pass the scene
 *          renders in raw linear: washed, flat and visibly worse than the
 *          same scene un-composed.
 *
 * WHAT THE TIER BUYS (both arrive as PROPS, from the RUNTIME budget — see the
 * note above the component for why this file does not call useQuality()):
 *   bloomLevels  mipmap bloom quality. Each level is a downsample plus an
 *          upsample of the whole frame, so this is fill rate, straight up:
 *          5 at low, 8 at mid (the postprocessing default, i.e. exactly what
 *          shipped before this file was tiered), 9 at high.
 *   extraPasses  desktop-high only. Two things a capable machine can afford
 *          and a phone can never: MSAA on the composer's target, and two more
 *          effects merged into the EXISTING pass (see below).
 *
 * WHY THE EXTRA EFFECTS ARE NEARLY FREE. @react-three/postprocessing merges
 * consecutive NON-convolution effects into ONE EffectPass — one fullscreen
 * quad, one fragment shader. Bloom is a convolution effect so it keeps its own
 * pass; chromatic aberration, vignette, grain and tone mapping all fold into a
 * single merged pass together. So the high tier's extra passes are not extra
 * PASSES at all — they are extra instructions in a shader that was already
 * running. The one genuinely new cost at high is the multisampled target.
 *
 * WHAT IS DELIBERATELY *NOT* HERE: depth of field. It was considered and
 * rejected on the merits, not skipped. DoF is a real pass (CoC + bokeh, not
 * mergeable), it needs a focus distance that tracks the ship, and the failure
 * mode is catastrophic in a way the other effects' are not: a soft ship reads
 * as a broken renderer, not as a style. Nearly this entire voyage is at
 * optical infinity — planets, sun, star field — so a correctly-focused shot
 * would blur almost nothing, and an incorrectly-focused one would blur the
 * subject. Paying a full pass for that trade is the wrong call; the same
 * budget buys MSAA, which improves every frame instead.
 * ========================================================================= */

import { type JSX, useRef } from 'react';
import { Vector2 } from 'three';
import { useFrame } from '@react-three/fiber';
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Noise,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode, type BloomEffect } from 'postprocessing';

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

// Chromatic aberration, high tier only. UV units, so it scales with the
// viewport the way a real lens artifact does. `radialModulation` multiplies
// the shift by (2·distance-from-centre − modulationOffset), clamped at zero,
// so there is a mathematically untouched disc in the middle of the frame and
// the fringing only ever grows outward from it.
//
// THE NUMBERS ARE A TENTH OF WHAT THEY WERE, and the reason is what this
// effect is actually aimed at. The old pair (0.001 / 0.45) worked out to
// ~2.6px of RED-to-BLUE separation at the corner — and the dominant subject at
// every frame edge in this piece is a field of six to nine thousand ONE-PIXEL
// point lights on pure black, which is maximal hard contrast at exactly the
// scale of the offset. A 1px star displaced 1.3px one way in red and 1.3px the
// other in blue is not a fringed star; it is three disjoint coloured dots, and
// a sky full of them reads as a badly registered three-colour print rather
// than as glass. Measured, not theorised: 643 sky pixels above 0.45 saturation
// in one 650x180 corner crop, the brightest of them fully saturated pure red.
//
// So the constraint this pair is solved against is: TOTAL red-to-blue
// separation stays under one pixel everywhere, including the extreme corner.
// At the corner (uv distance 0.707 from centre) the modulation factor is
// 2·0.707 − 0.75 = 0.664, so separation = 2 · 0.00018 · 0.664 · width, i.e.
// 0.38px on a 1600-wide frame — sub-pixel by a factor of two and a half, which
// is the only regime where this reads as chromatic softening of an edge rather
// than as a colour-separated copy of it. The clean disc is also nearly twice
// as wide as before. Kept rather than cut: at this strength it still does the
// thing it was added for — taking the mechanical hardness off the frame's
// outer edge — it just no longer does it to individual stars.
const CA_OFFSET = new Vector2(0.00018, 0.000126);
const CA_MODULATION = 0.75;

// Film grain, high tier only. SOFT_LIGHT rather than the effect's default
// SCREEN, and that choice is the whole reason this reads as film rather than
// as television: soft light leaves black at black and only modulates the
// midtones, so the grain lives where there is actually exposed image — planet
// limbs, the hull, the lit skyline.
//
// HALVED, because the "black stays black" argument was only half true and the
// other half is new this round. On a genuinely black patch it holds — median
// adjacent-pixel delta is 0 at both tiers, measured. But the nebula band added
// this round lifts large regions of the deep field OFF zero (mean luminance
// ~15 across a patch that used to be near-nothing), and soft light modulates
// everything it finds above the floor. So the round added a soft dark field
// and then made it noisy, on the finale sky, which is the one shot that most
// needs to look photographed. At 0.045 the tooth is still there on the hull
// and the skyline and it no longer resolves as digital noise over the sky.
//
// (Known wart, accepted: postprocessing's noise samples rand(uv·(1+time))
// with an unbounded time uniform, so after a very long session the hash loses
// float precision and the pattern coarsens. At this opacity in soft light over
// a near-black frame that degrades to "slightly different invisible", which is
// why it is not worth a custom effect to avoid.)
const GRAIN_OPACITY = 0.045;

// MSAA on the composer's render target, high tier only. Note what this
// actually restores: the Canvas asks for `antialias: true`, but a scene drawn
// THROUGH an EffectComposer never touches the default framebuffer, so that
// request buys nothing and every edge in the flight has been aliased. This
// scene is full of exactly the geometry aliasing ruins — wheel spokes, deck
// railings, tower antennas, the ship's struts and gear. 4 samples is the
// honest cost here (a multisampled HDR target plus a resolve, every frame),
// and it is the single biggest image-quality difference available.
const HIGH_MULTISAMPLING = 4;

type EffectsProps = {
  /** Accepted for scene-wide signature parity; the bloom swell tracks the
   *  camera (stepwise under reduced motion, since it never self-oscillates),
   *  so there is nothing here to gate. The tier already answers for reduced
   *  motion anyway — `reduced` always resolves to `low`, which is the cheapest
   *  chain and never enables the extras. */
  reduced: boolean;
  /** Sun-approach ramp, 0 far away to 1 at the final dock. */
  getBoost: () => number;
  /** mipmapBlur levels — from the RUNTIME budget, not the frozen build one.
   *  This is one of the two knobs a mid-flight tier decline is allowed to
   *  move, because moving it rebuilds one effect and nothing else in the
   *  scene. */
  bloomLevels: number;
  /** The other one. Gates MSAA on the composer target plus the two merged
   *  lens/film effects below. */
  extraPasses: boolean;
};

/* PROPS, NOT useQuality(), AND THAT IS DELIBERATE. Everything else in the 3D
 * tree reads the FROZEN build budget from QualityContext, because a runtime
 * tier decline must not re-tessellate a planet or recompile a material in the
 * frame that detected it. The post chain is the exception — it is the one
 * consumer whose knobs cost nothing to change — so Scene3D hands it the live
 * runtime budget directly. Taking them as props rather than reaching for the
 * context is what keeps that distinction from being undone by a future reader
 * who "tidies up" the one component not using the hook. */
export function Effects({ getBoost, bloomLevels, extraPasses }: EffectsProps) {
  const bloomRef = useRef<BloomEffect>(null);

  // Mutate the effect directly: bloom swell is per-frame continuous state,
  // and routing it through React would re-render the whole canvas tree.
  useFrame(() => {
    const bloom = bloomRef.current;
    if (bloom) bloom.intensity = BLOOM_BASE + getBoost() * BLOOM_BOOST;
  });

  // The chain is assembled as an ARRAY rather than as inline JSX children,
  // because EffectComposer types its children as `JSX.Element | JSX.Element[]`
  // — there is no room in that type for the `false` a `cond && <X/>` guard
  // produces. One array expression keeps the order explicit and readable, and
  // the composer's own child walk (which reads the mounted three objects, not
  // the React children) is indifferent to how they were expressed.
  //
  // ORDER IS THE GRADE. Lens artifacts first (aberration is a property of the
  // glass), then the exposure falloff, then the film, then the print. Putting
  // aberration or grain AFTER tone mapping would work on the graded image
  // instead of the captured one, which is exactly when this sort of thing
  // stops reading as photography and starts reading as a filter.
  const lens: JSX.Element[] = extraPasses
    ? [
        <ChromaticAberration
          key="aberration"
          offset={CA_OFFSET}
          radialModulation
          modulationOffset={CA_MODULATION}
          blendFunction={BlendFunction.NORMAL}
        />,
      ]
    : [];
  const film: JSX.Element[] = extraPasses
    ? [<Noise key="grain" blendFunction={BlendFunction.SOFT_LIGHT} opacity={GRAIN_OPACITY} />]
    : [];

  return (
    <EffectComposer multisampling={extraPasses ? HIGH_MULTISAMPLING : 0}>
      {[
        <Bloom
          key="bloom"
          // CALLBACK ref, not an object ref, and it is load-bearing: React 19
          // passes `ref` through props, and @react-three/postprocessing
          // memoizes effect args with JSON.stringify(props). Once an object
          // ref holds the (circular) BloomEffect instance, the next re-render
          // throws "Converting circular structure to JSON" and takes the whole
          // app down. JSON.stringify skips function values — a callback ref is
          // invisible to the memo.
          ref={(b: BloomEffect | null) => {
            bloomRef.current = b;
          }}
          mipmapBlur
          // The one knob that moves at every tier. It IS serialisable, so the
          // memo above rebuilds the effect when the tier steps down — which is
          // correct: shedding mip levels is the point of stepping down.
          levels={bloomLevels}
          intensity={BLOOM_BASE}
          luminanceThreshold={BLOOM_THRESHOLD}
          luminanceSmoothing={BLOOM_SMOOTHING}
        />,
        ...lens,
        <Vignette key="vignette" darkness={VIGNETTE_DARKNESS} offset={VIGNETTE_OFFSET} />,
        ...film,
        // Mounting an EffectComposer sets the renderer to NoToneMapping, so
        // without this final pass the whole scene renders in raw linear —
        // washed, flat, and visibly worse than the same scene un-composed
        // (live-site screenshot finding). ACES filmic restores the contrast
        // and highlight roll-off every real GPU pipeline expects. It stays
        // LAST at every tier: everything above it is capture, this is the
        // print, and anything after it is grading a graded image.
        <ToneMapping key="tone" mode={ToneMappingMode.ACES_FILMIC} />,
      ]}
    </EffectComposer>
  );
}
