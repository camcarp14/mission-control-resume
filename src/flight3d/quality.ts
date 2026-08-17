/* ==== ADAPTIVE QUALITY TIERS =================================================
 *
 * One shared, honest answer to "how much can this machine afford?", read once
 * per component and branched on — never sampled per frame.
 *
 * The scene already has a fine-grained lever: the adaptive-dpr ladder in
 * Scene3D, which measures real frame rate and quietly resizes the drawing
 * buffer. That lever is good and it stays. What it cannot do is stop the app
 * from BUILDING nine thousand stars, a 64-segment sphere per planet and a
 * second post pass on a machine that was never going to draw them — by the
 * time the monitor notices, the geometry is uploaded and the shaders are
 * compiled. So this module sits UNDER the dpr ladder as a second, coarser
 * lever: dpr trades pixels continuously at runtime, the tier decides what gets
 * built in the first place.
 *
 * Three tiers, calibrated against what the site renders TODAY:
 *
 *   low   at or below today, everywhere. The weakest device must never come
 *         out of this change rendering MORE than it did before.
 *   mid   today. This is the default and the fallback, and every knob in it
 *         is locked to a shipped constant by quality.test.ts.
 *   high  the headroom. Nothing spends this unless the device volunteered
 *         evidence that it can pay.
 *
 * Everything here except the two hooks and the one GL probe is a pure
 * function of its arguments, so the calibration is unit-testable rather than
 * something you have to boot a browser to argue about.
 * ========================================================================= */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type QualityTier = 'low' | 'mid' | 'high';

/** Cheapest → richest. The order is load-bearing: `demoteTier` walks it. */
export const TIERS = ['low', 'mid', 'high'] as const;

/** Position of a tier in TIERS. `low` is 0. */
export function tierRank(tier: QualityTier): number {
  const i = TIERS.indexOf(tier);
  return i < 0 ? 1 : i;
}

/** Step a tier DOWN by n notches, clamped at `low`. Never moves up: n is
 *  taken as a magnitude, so a negative argument cannot be used to climb. */
export function demoteTier(tier: QualityTier, notches: number): QualityTier {
  const steps = Math.max(0, Math.floor(notches));
  return TIERS[Math.max(0, tierRank(tier) - steps)] ?? 'low';
}

/* ---- device signals ------------------------------------------------------ */

/** What `detectTier` is allowed to look at. Every hardware field is optional
 *  because every hardware field is genuinely missing somewhere. */
export type DeviceSignals = {
  /** Viewport is below the mobile breakpoint. A LAYOUT fact, and only that:
   *  it says how many CSS pixels there are to fill, which is why it still
   *  picks the star-count and dpr columns. It is explicitly NOT the form
   *  factor — a phone in landscape is 800–950 CSS px and answers false — so
   *  nothing about thermal or fill-rate headroom may be inferred from it.
   *  `handheld` is the signal for that. */
  mobile: boolean;
  /** The primary pointer is coarse and/or cannot hover — i.e. this is a phone,
   *  a tablet or a TV, whatever the viewport currently measures. This is the
   *  honest form-factor test and the one the promotion consults: a landscape
   *  phone must not be able to buy a multisampled HDR target by turning
   *  sideways. Undefined only where matchMedia is missing entirely (SSR), in
   *  which case `mobile` stands in as the backstop. */
  handheld?: boolean | undefined;
  /** prefers-reduced-motion. Overrides all hardware evidence (see below). */
  reduced: boolean;
  /** navigator.deviceMemory, in GB. Chromium only, quantised to 0.25/0.5/1/
   *  2/4/8 and CAPPED AT 8 for fingerprinting reasons — so 8 means "8 or
   *  more", not "exactly 8". Absent in Safari and Firefox. */
  deviceMemory?: number | undefined;
  /** navigator.hardwareConcurrency. Widely supported but widely lied about:
   *  Safari clamps it, privacy modes freeze it at a constant, and a core
   *  count says nothing about the GPU, which is what actually draws this. */
  hardwareConcurrency?: number | undefined;
  /** window.devicePixelRatio. A fact, not a hint — but a fact about the
   *  screen, not about the machine's ability to fill it. */
  dpr?: number | undefined;
  /** GL_MAX_TEXTURE_SIZE. The only signal here that comes from the actual
   *  renderer, which makes it the one worth trusting most. */
  maxTextureSize?: number | undefined;
};

/** The hardware half of DeviceSignals — what `readHardwareSignals` can find
 *  out on its own. `mobile` and `reduced` are the app's to decide. */
export type HardwareSignals = Omit<DeviceSignals, 'mobile' | 'reduced'>;

/* Thresholds. All of them are deliberately far from the middle of the
 * distribution: this heuristic is asked to recognise the two ENDS of the
 * device population, and to say "I don't know" (which resolves to mid) about
 * everything in between. A tier system that guesses aggressively about the
 * middle is a tier system that ships the wrong quality to most visitors. */
const LOW_MEMORY_GB = 2; // 2GB reported means 2GB or less; that machine is struggling before we arrive.
const LOW_CORES = 2;
const DENSE_DPR = 2.5; // a >=2.5x screen on a <=4GB device is the mid-range Android that drowns
const DENSE_DPR_MEMORY_GB = 4;
const MIN_TEXTURE_SIZE = 4096; // Earth alone carries 4k maps; a renderer under this cannot hold the scene
const HIGH_MEMORY_GB = 8; // i.e. the top of the reported range
const HIGH_CORES = 8;
/* THE ONE SIGNAL THAT ACTUALLY SEPARATES THE ENDS, and why it is 16384 rather
 * than 8192. `deviceMemory` is capped at 8 by spec (see DeviceSignals), so its
 * top bucket holds everything from a budget phone to a workstation and cannot
 * discriminate; `hardwareConcurrency` is 8 on an ordinary octa-core Android.
 * Promotion on those two alone was therefore promotion on "is a modern
 * device", which is not the question. GL_MAX_TEXTURE_SIZE comes from the
 * renderer itself and it must be PRESENT and >= 16384 — the value desktop
 * GL_ES/WebGL2 implementations report and the one an 8192-limited tiler or a
 * software rasteriser cannot fake. It is a veto AND a vouch now, which is a
 * deliberate change from "it only ever vetoes": a machine that will not open a
 * GL context to answer gets mid, which is today's shipped experience. */
const HIGH_TEXTURE_SIZE = 16384;

/**
 * Map device signals to a tier. PURE — every input is an argument.
 *
 * Three rules do all the work here, and all of them are about what we are
 * NOT willing to assume:
 *
 * 1. REDUCED MOTION ALWAYS RESOLVES TO LOW. Not because a reduced-motion
 *    visitor deserves less, but because under `reduced` the canvas runs
 *    frameloop="demand" and the scene is a still: dust that does not drift,
 *    meteors that do not streak and particle pools that never step are cost
 *    with no payoff. The low budget below is written with exactly this in
 *    mind — it scales motion populations down and pixel/geometry cost down,
 *    and it never removes anything that defines the STILL image (the
 *    atmospheres, the city lights and the star field all survive at low).
 *
 * 2. MISSING SIGNALS FALL BACK TO MID, NEVER HIGH. deviceMemory and
 *    hardwareConcurrency are hints, not truth. deviceMemory does not exist
 *    in Safari or Firefox at all, and hardwareConcurrency is clamped or
 *    frozen by several privacy modes. Treating "no answer" as "fast" is how
 *    you hand the high budget to the exact machine that could not report it
 *    because it was in a locked-down browser on old hardware. The cost of
 *    this conservatism is real and accepted: a Mac Pro on Safari gets mid,
 *    forever, because it never says how much memory it has. Mid is today's
 *    shipped experience, so that visitor loses nothing they have now — they
 *    simply do not get the extras. That is the correct side to be wrong on.
 *
 * 3. FORM FACTOR IS A POINTER QUESTION, NOT A VIEWPORT QUESTION. `mobile`
 *    says how wide the window is, which is a layout fact and nothing more —
 *    a phone in landscape reports 800-950 CSS px and would sail past a
 *    width test. `handheld` is what the promotion actually consults, and it
 *    is a hard veto: no phone, tablet or TV gets the high budget, however
 *    good its reported memory and core count are, because what that budget
 *    buys is fill rate and heat.
 */
export function detectTier(signals: DeviceSignals): QualityTier {
  const { mobile, handheld, reduced, deviceMemory, hardwareConcurrency, dpr, maxTextureSize } =
    signals;

  if (reduced) return 'low';

  // ---- demotion. Only POSITIVE evidence of weakness demotes; an absent
  // signal is never read as a bad one either.
  if (deviceMemory !== undefined && deviceMemory <= LOW_MEMORY_GB) return 'low';
  if (hardwareConcurrency !== undefined && hardwareConcurrency <= LOW_CORES) return 'low';
  if (maxTextureSize !== undefined && maxTextureSize < MIN_TEXTURE_SIZE) return 'low';
  if (
    dpr !== undefined &&
    dpr >= DENSE_DPR &&
    deviceMemory !== undefined &&
    deviceMemory <= DENSE_DPR_MEMORY_GB
  ) {
    return 'low';
  }

  // ---- promotion. Every signal consulted must be PRESENT and strong, and no
  // signal may merely be "not weak" — see HIGH_TEXTURE_SIZE above for why the
  // memory/core pair on its own describes a mid-range phone just as well as it
  // describes a workstation.
  const strongMemory = deviceMemory !== undefined && deviceMemory >= HIGH_MEMORY_GB;
  const strongCores = hardwareConcurrency !== undefined && hardwareConcurrency >= HIGH_CORES;
  const bigTextures = maxTextureSize !== undefined && maxTextureSize >= HIGH_TEXTURE_SIZE;
  // FORM FACTOR VETO. The high budget's headline spend is fill rate — a 4x
  // multisampled HDR target, a ninth bloom mip, a 1024² lake — which is
  // precisely what a handheld has least of and sheds heat for. `handheld` is a
  // pointer-media query, not a viewport measurement, so turning a phone
  // sideways cannot buy any of it. Where matchMedia cannot answer at all the
  // narrow viewport stands in, which is strictly the old (weaker) test rather
  // than a new hole.
  const pocket = handheld === true || (handheld === undefined && mobile);

  if (!pocket && strongMemory && strongCores && bigTextures) return 'high';

  return 'mid';
}

/* ---- the budget ---------------------------------------------------------- */

/**
 * The knobs a component reads. Every field here is one a real component can
 * branch on today — a knob nobody can act on is a lie about how configurable
 * the scene is.
 *
 * TYPES ARE CHOSEN SO THE NAIVE USE IS SAFE. The three "feature" knobs
 * (`atmosphere`, `cityLights`, `dust`) are NUMBERS but are non-zero at every
 * tier, so a component that writes `if (budget.dust)` gets today's behaviour
 * on every device instead of a silently gutted scene, while a component that
 * writes `DUST_COUNT * budget.dust` gets the tier scaling. The booleans
 * (`extraPasses`, `shadows`) gate things that do NOT exist today, so false is
 * the shipped state and true is the headroom.
 */
export type QualityBudget = {
  /** The tier this budget was built from. Useful for logging and for the
   *  rare component that wants a three-way branch rather than a knob. */
  tier: QualityTier;
  /** The FORM FACTOR this budget was built for: a handheld device, or a
   *  viewport too narrow to be anything else. Not a knob — it does not get
   *  cheaper or dearer between tiers, it says which column the knobs were read
   *  from — which is why quality.test.ts excludes it from the ordering
   *  invariants alongside `tier`. A component pairs it with `tier` when the
   *  thing it is gating is fill-bound rather than tier-bound: `tier === 'high'
   *  && !mobile` is the honest test for "may I spend a megabyte of texture or
   *  a second material layer here". */
  mobile: boolean;
  /** Points in the deep star field (SpaceEnvironment). One draw call either
   *  way; the cost is the buffer build and the fill. */
  starCount: number;
  /** Width segments for a STANDARD planet sphere. Today's bodies are built
   *  at 48x36, so mid is 48. Height segments are conventionally three
   *  quarters of this. For an art-directed base (Earth is 64) use
   *  `scaleSegments(budget, 64)` so one knob still moves everything. */
  sphereSegments: number;
  /** Atmospheric limb shells per body: 1 is today's single shell, 2 is the
   *  layered scattering the high tier can afford. Never 0 — an airless Earth
   *  is a worse picture, not a cheaper one, and the shell is one draw. */
  atmosphere: number;
  /** Multiplier on the night city's emissive window population. */
  cityLights: number;
  /** Multiplier on the dust corridor's point count. */
  dust: number;
  /** Multiplier on the comet/warp-line populations in Meteors. */
  meteorScale: number;
  /** Soft cloud quads in the deep field (SpaceEnvironment). A COUNT, not a
   *  multiplier, and it is the one population here that may legitimately be
   *  ZERO: the clouds are large additive double-sided sheets that did not
   *  exist before this round, so "low is at or below today" is only true if
   *  low renders none of them. Living on the budget rather than in a private
   *  table in SpaceEnvironment is the point — the ordering tests can only see
   *  what is on this type. */
  nebula: number;
  /** Multiplier on every other seeded particle pool — exhaust, sparks,
   *  fireworks. Separate from meteorScale because meteors are ambient and
   *  these are attached to the two things the eye is actually on. */
  particleScale: number;
  /** mipmapBlur levels on the bloom pass. Each level is a downsample plus an
   *  upsample of the whole frame, so this is fill rate, straight up. */
  bloomLevels: number;
  /** May the post chain add passes beyond today's bloom + vignette + tone
   *  mapping? False at low AND mid — today's chain is deliberately two
   *  passes deep and that is the shipped baseline. */
  extraPasses: boolean;
  /** May a light cast a real shadow map? Nothing does today. */
  shadows: boolean;
  /** Texture anisotropy. Today every map is configured at 8. */
  anisotropy: number;
  /** Ceiling handed to Scene3D's adaptive-dpr ladder. The ladder still owns
   *  the moment-to-moment value; this only says how high it may climb. */
  maxDpr: number;
};

/** The segment count `sphereSegments` reports at mid — i.e. today's standard
 *  body, built at 48x36 in SolarBodies. `scaleSegments` measures against it. */
const SEGMENTS_MID = 48;

/** Segment count for a body whose art direction wants more (or less) than a
 *  standard sphere, scaled by the same one knob and rounded to an even number
 *  because sphereGeometry looks wrong on odd rings. Floors at 8 so a low-tier
 *  planet is still a planet. Earth is built at 64 today, so it asks for
 *  `scaleSegments(budget, 64)` and keeps its extra density at every tier. */
export function scaleSegments(budget: QualityBudget, base: number): number {
  const scaled = (base * budget.sphereSegments) / SEGMENTS_MID;
  return Math.max(8, Math.round(scaled / 2) * 2);
}

/* The calibration table. Read the mid column as "what the site renders on
 * 2026-08-17": starCount 6400/3200 (Scene3D), sphereSegments 48 (SolarBodies),
 * anisotropy 8 (every useTexture callback), bloomLevels 8 (postprocessing's
 * BloomEffect default, which Effects.tsx does not override), maxDpr 2/1.5
 * (Scene3D's dprCeil cap). quality.test.ts asserts those equalities, so this
 * table cannot drift away from the scene without a test going red. */
type TierRow = Omit<QualityBudget, 'tier' | 'mobile' | 'starCount' | 'maxDpr'>;

const ROWS: Record<QualityTier, TierRow> = {
  low: {
    sphereSegments: 32,
    atmosphere: 1,
    cityLights: 0.8,
    dust: 0.55,
    meteorScale: 0.55,
    particleScale: 0.6,
    nebula: 0,
    bloomLevels: 5,
    extraPasses: false,
    shadows: false,
    anisotropy: 4,
  },
  mid: {
    sphereSegments: SEGMENTS_MID,
    atmosphere: 1,
    cityLights: 1,
    dust: 1,
    meteorScale: 1,
    particleScale: 1,
    nebula: 7,
    bloomLevels: 8,
    extraPasses: false,
    shadows: false,
    anisotropy: 8,
  },
  high: {
    sphereSegments: 64,
    atmosphere: 2,
    cityLights: 1.5,
    dust: 1.4,
    meteorScale: 1.4,
    particleScale: 1.35,
    nebula: 10,
    bloomLevels: 9,
    extraPasses: true,
    shadows: true,
    anisotropy: 16,
  },
};

/* THE MOBILE CEILING. Every knob here is FILL — pixels touched per frame —
 * and fill is the one resource a handheld has categorically less of than the
 * desktop sitting at the same tier. So the mobile column is not "the tier
 * minus a bit", it is "the tier, clamped at what today already ships", and a
 * phone that earns `high` spends it only where a tiler is actually strong:
 * more stars (buffer bytes, one draw), finer texture filtering, a slightly
 * higher dpr ceiling.
 *
 * This table used to gate three knobs — extraPasses, shadows and anisotropy —
 * which left a phone drawing 64-segment spheres, two atmosphere shells, nine
 * bloom mips, 1.5x city lights and 1.4x dust and meteors on the strength of a
 * memory reading that is capped at 8 by spec. Everything fill-heavy is in
 * here now. Values are the MID row's, so "mobile high is at worst today" is
 * true by construction rather than by inspection. */
const MOBILE_CEILING = {
  sphereSegments: SEGMENTS_MID,
  atmosphere: 1,
  cityLights: 1,
  dust: 1,
  meteorScale: 1,
  particleScale: 1,
  nebula: 4,
  bloomLevels: 8,
  anisotropy: 8,
} as const satisfies Partial<TierRow>;

/** `Math.min` against the mobile ceiling when the budget is a mobile one. */
function capped<K extends keyof typeof MOBILE_CEILING>(
  row: TierRow,
  key: K,
  mobile: boolean,
): number {
  return mobile ? Math.min(row[key], MOBILE_CEILING[key]) : row[key];
}

/** Star counts split by form factor: the desktop mid value is the 6400 that
 *  ships today, the mobile mid value is the 3200 that ships today. */
const STAR_COUNT: Record<QualityTier, { desktop: number; mobile: number }> = {
  low: { desktop: 4200, mobile: 2000 },
  mid: { desktop: 6400, mobile: 3200 },
  high: { desktop: 9000, mobile: 4200 },
};

/** dpr ceilings. Mid reproduces Scene3D's existing cap exactly (2 desktop,
 *  1.5 mobile). High does NOT raise the desktop cap past 2 — a retina desktop
 *  at 3x is 2.25x the fragments for a difference nobody sees, and the headroom
 *  is better spent on geometry and light. */
const MAX_DPR: Record<QualityTier, { desktop: number; mobile: number }> = {
  low: { desktop: 1.5, mobile: 1 },
  mid: { desktop: 2, mobile: 1.5 },
  high: { desktop: 2, mobile: 1.75 },
};

/**
 * The budget for a tier. PURE: no globals, no navigator, no clock — the same
 * two arguments always produce an equal (and freshly allocated, so a caller
 * that mutates it cannot poison anyone else's) budget.
 */
export function budgetFor(tier: QualityTier, mobile = false): QualityBudget {
  const row = ROWS[tier];
  const form = mobile ? 'mobile' : 'desktop';
  return {
    tier,
    mobile,
    starCount: STAR_COUNT[tier][form],
    sphereSegments: capped(row, 'sphereSegments', mobile),
    atmosphere: capped(row, 'atmosphere', mobile),
    cityLights: capped(row, 'cityLights', mobile),
    dust: capped(row, 'dust', mobile),
    meteorScale: capped(row, 'meteorScale', mobile),
    particleScale: capped(row, 'particleScale', mobile),
    nebula: capped(row, 'nebula', mobile),
    bloomLevels: capped(row, 'bloomLevels', mobile),
    // Fullscreen passes and shadow maps are fill-rate and bandwidth, which is
    // exactly what a phone has least of — so the mobile column never enables
    // them, not even at high.
    extraPasses: row.extraPasses && !mobile,
    shadows: row.shadows && !mobile,
    anisotropy: capped(row, 'anisotropy', mobile),
    maxDpr: MAX_DPR[tier][form],
  };
}

/* ---- the context --------------------------------------------------------- */

/**
 * The default handed to any component rendered outside a provider. It is the
 * MOBILE MID budget on purpose: mid is today, and mobile is the cheaper of
 * the two form factors, so a component that somehow escapes the provider
 * renders something the weakest supported device can draw rather than
 * throwing or quietly picking the expensive branch. A missing provider is a
 * wiring bug; it should degrade, not crash, and it should never cost more
 * than it saves.
 */
export const DEFAULT_BUDGET: QualityBudget = budgetFor('mid', true);

export const QualityContext = createContext<QualityBudget>(DEFAULT_BUDGET);

/**
 * Read the budget. Call it ONCE per component, near the top, and branch on
 * what it says — never inside useFrame. The value is referentially stable
 * for as long as the tier is, so a useMemo keyed on a knob rebuilds only when
 * the tier actually moves.
 */
export function useQuality(): QualityBudget {
  return useContext(QualityContext);
}

/* ---- the runtime controller ---------------------------------------------- */

export type QualityControl = {
  /** The tier in force: detected, minus any runtime step-downs. Governs the
   *  POST CHAIN and the dpr ceiling — see `budget` for why it does not govern
   *  what gets built. */
  tier: QualityTier;
  /** THE BUILD BUDGET, and it is frozen: it answers for the DETECTED tier and
   *  a runtime step-down does not move it. Feed this to the provider. Its
   *  identity is stable for the life of the session (barring an explicit
   *  preference or form-factor change), which is the whole point — see
   *  `useQualityTier`. */
  budget: QualityBudget;
  /** THE RUNTIME BUDGET, for the two consumers that can act on a step-down
   *  without rebuilding anything: the post chain (bloom mips, extra passes)
   *  and the dpr ladder. Never hand this to the provider. */
  runtime: QualityBudget;
  /** How many notches the runtime has taken off. 0, 1 or 2. */
  steps: number;
  /** True once the tier has bottomed out — there is nothing left to shed. */
  atFloor: boolean;
  /** Drop one notch. Stable identity, safe to hand to a monitor callback,
   *  idempotent at the floor. */
  stepDown: () => void;
};

/** Read what the browser will admit to. Impure by definition — this is the
 *  one place in the module that touches globals, so everything else stays a
 *  function of its arguments. */
export function readHardwareSignals(): HardwareSignals {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 ? nav.deviceMemory : undefined;
  const cores =
    typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0
      ? nav.hardwareConcurrency
      : undefined;
  const ratio =
    typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
      ? window.devicePixelRatio || undefined
      : undefined;
  return {
    deviceMemory: mem,
    hardwareConcurrency: cores,
    dpr: ratio,
    maxTextureSize: probeMaxTextureSize(),
    handheld: probeHandheld(),
  };
}

/**
 * Is the PRIMARY pointer a finger? `(pointer: coarse)` and `(hover: none)` are
 * the two halves of the same question and either one alone is enough here: a
 * phone, a tablet and a TV remote all answer yes, while a touchscreen laptop
 * answers no because its primary pointer is still the trackpad. Deliberately
 * OR rather than AND — the cost of a false "handheld" is that a desktop gets
 * mid, which is today's shipped experience, and the cost of a false "desktop"
 * is a phone rendering a multisampled HDR target.
 *
 * Not cached: a media query is a hash lookup, this runs a handful of times per
 * page, and caching it would freeze the answer across the one case where it
 * can genuinely change (an external monitor and mouse attached to a tablet).
 */
function probeHandheld(): boolean | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  try {
    return (
      window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches
    );
  } catch {
    return undefined;
  }
}

let probedTextureSize: number | undefined | null = null;

/**
 * GL_MAX_TEXTURE_SIZE from a throwaway context, cached for the page's life so
 * it costs one context creation total. The context is explicitly lost
 * afterwards: browsers cap live WebGL contexts (~16) and evict the OLDEST
 * when the cap is hit, which in this app would be the one drawing the flight.
 * Any failure at all resolves to undefined, which `detectTier` reads as "no
 * evidence" rather than as bad news.
 */
function probeMaxTextureSize(): number | undefined {
  if (probedTextureSize !== null) return probedTextureSize;
  probedTextureSize = undefined;
  if (typeof document === 'undefined') return undefined;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const size = gl.getParameter(gl.MAX_TEXTURE_SIZE) as unknown;
      if (typeof size === 'number' && size > 0) probedTextureSize = size;
      const lose = gl.getExtension('WEBGL_lose_context');
      lose?.loseContext();
    }
  } catch {
    probedTextureSize = undefined;
  }
  return probedTextureSize;
}

/**
 * Resolve the tier for this session and expose the one runtime lever:
 * STEP DOWN.
 *
 * WHY IT NEVER STEPS BACK UP. The dpr ladder above this can climb again
 * because resizing a drawing buffer is invisible — nobody sees a frame
 * rendered at 1.75x instead of 2x. A tier change is not invisible: it rebuilds
 * star buffers, re-tessellates planets and can change the post chain, which
 * means every upward step pays a hitch AND changes the picture mid-flight.
 * A device that oscillates between tiers would therefore stutter on every
 * crossing, forever, and the visitor would watch the scene visibly change its
 * mind. One conservative tier for the rest of the session is strictly better
 * than a correct tier that keeps being re-derived. So: monotone, at most two
 * steps, and the only way back up is a reload — which is also the only moment
 * the machine's real capability can be measured cleanly anyway.
 *
 * The DETECTED tier is still a pure function of (mobile, reduced, hardware),
 * so flipping the OS reduced-motion switch is honoured in both directions —
 * that is an explicit preference change, not the scene second-guessing
 * itself. Runtime step-downs survive it, because a machine that was drowning
 * is still drowning.
 *
 * AND WHAT THE STEP DOWN IS ALLOWED TO TOUCH. The paragraph above argues that
 * an upward step is unaffordable because it "rebuilds star buffers,
 * re-tessellates planets and can change the post chain". Every word of that is
 * equally true downward, and the down step additionally recompiles: `q.tier`
 * is a memo key for the injected-surface materials in SolarBodies and the
 * normal-mapped hull in Rocket3D, so crossing a tier is a fresh
 * customProgramCacheKey and a guaranteed link, not a cache hit. Firing all of
 * that INSIDE the frame that detected the decline hands a drowning device a
 * re-tessellation, a set of buffer re-uploads and a dozen shader compiles as
 * its rescue.
 *
 * So the tier is split in two, along the line of what a knob costs to change:
 *
 *   BUILD knobs answer with geometry, materials or texture uploads —
 *     starCount, sphereSegments, atmosphere, cityLights, dust, meteorScale,
 *     particleScale, nebula, anisotropy, and `tier` itself, which components
 *     branch on at build time. These are FROZEN at the detected tier. This is
 *     not a new idea in this codebase: LandingSite already does exactly this
 *     by hand (`const [buildBudget] = useState(detected)`) for the same
 *     reason, and it is right.
 *   RUNTIME knobs are free to move because nothing is rebuilt when they do:
 *     bloomLevels and extraPasses (the post chain, which is re-derived from
 *     props every frame anyway) and maxDpr (a clamp on a number). These are
 *     also, not by coincidence, the fill-rate knobs — which is what a device
 *     losing frames actually needs back. Geometry is already uploaded; giving
 *     some of it back mid-descent costs more than it saves.
 *
 * The consequence worth stating plainly: a step-down no longer changes the
 * SHAPE of the scene, only its pixels. That is a smaller lever than the one
 * this function used to advertise, and it is the whole lever that was ever
 * safe to pull mid-flight.
 */
export function useQualityTier(mobile: boolean, reduced: boolean): QualityControl {
  // Hardware is read once, at mount: none of it changes while the tab is
  // open, and re-reading it would mean another GL probe.
  const [hardware] = useState<HardwareSignals>(readHardwareSignals);
  const [steps, setSteps] = useState(0);

  const detected = useMemo(
    () => detectTier({ mobile, reduced, ...hardware }),
    [mobile, reduced, hardware],
  );
  const tier = useMemo(() => demoteTier(detected, steps), [detected, steps]);

  // THE FORM FACTOR THE BUDGET IS BUILT FOR, which is not the same question as
  // the viewport width the caller passed in. A phone in landscape is 800–950
  // CSS px, so the viewport says "desktop" and the device is emphatically not
  // one: it would collect the desktop star count, the desktop dpr ceiling and
  // every uncapped fill knob by being rotated. `handheld` is a pointer-media
  // query and answers the same in both orientations, so OR-ing it in fixes
  // that without the caller having to know. The caller's `mobile` still flows
  // into detectTier untouched — there it is a LAYOUT fact and correct as such.
  const form = mobile || hardware.handheld === true;

  // Keyed on `detected`, NOT on `tier`: a runtime step-down leaves this
  // identity untouched, so every useMemo downstream that keys off the budget
  // (SolarBodies' sphere and ring geometry, Meteors' three instance builds,
  // SpaceEnvironment's star buffers) sees no change and rebuilds nothing.
  // An explicit preference change — the OS reduced-motion switch, or a
  // viewport crossing the breakpoint — does move it, which is correct: those
  // are the visitor asking for a different picture, not the scene panicking.
  const budget = useMemo(() => budgetFor(detected, form), [detected, form]);
  const runtime = useMemo(() => budgetFor(tier, form), [tier, form]);

  const stepDown = useCallback(() => {
    // Clamped to the number of notches that exist, so the callback stays
    // idempotent once the floor is reached and a monitor that keeps firing
    // cannot drive the counter to nonsense.
    setSteps((s) => Math.min(TIERS.length - 1, s + 1));
  }, []);

  return { tier, budget, runtime, steps, atFloor: tier === 'low', stepDown };
}
