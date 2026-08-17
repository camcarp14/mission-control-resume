import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUDGET,
  TIERS,
  budgetFor,
  demoteTier,
  detectTier,
  scaleSegments,
  tierRank,
  type QualityBudget,
  type QualityTier,
} from './quality';

/**
 * The quality module is the foundation six other components branch on, so its
 * guarantees are asserted here rather than assumed:
 *
 *   1. the tiers are ORDERED — no knob is more expensive at low than at high;
 *   2. reduced motion never buys an expensive budget;
 *   3. a device that reports nothing lands on mid, never high;
 *   4. budgetFor is pure — same input, same output, no shared mutation;
 *   5. and the calibration is LOCKED to the constants the scene ships today,
 *      so "mid is roughly today" stays true instead of drifting into folklore.
 *
 * Rule 5 is the one that matters most in six months: the numbers in the table
 * are only meaningful relative to what the scene actually renders, and nothing
 * else in the repo would notice if they quietly stopped matching.
 */

/* What the scene renders TODAY, transcribed from the source. If one of these
 * changes, the matching test SHOULD fail — that is the point. */
const TODAY = {
  starCountDesktop: 6400, //  Scene3D: starCount={mobile ? 3200 : 6400}
  starCountMobile: 3200,
  sphereSegments: 48, //      SolarBodies: <sphereGeometry args={[r, 48, 36]} />
  anisotropy: 8, //           SolarBodies / SpaceEnvironment: tex.anisotropy = 8
  bloomLevels: 8, //          postprocessing BloomEffect default; Effects.tsx does not override
  maxDprDesktop: 2, //        Scene3D: const cap = mobile ? 1.5 : 2
  maxDprMobile: 1.5,
  extraPasses: false, //      Effects.tsx: bloom + vignette + tone mapping, nothing else
  shadows: false, //          no light in the scene casts a shadow map
} as const;

/* `tier` and `mobile` are not knobs — they say which ROW and which COLUMN the
 * knobs were read from. Neither gets cheaper or dearer between tiers, so both
 * are excluded from the ordering invariants below (a boolean `mobile` would
 * fail "mobile is never more expensive than desktop" for the silly reason that
 * true ranks above false). Everything else on QualityBudget is a knob and is
 * covered, which is the property that matters: a new field is in these tests
 * by default and has to be deliberately excluded here to escape them. */
const NOT_KNOBS = ['tier', 'mobile'] as const;
type KnobKey = Exclude<keyof QualityBudget, (typeof NOT_KNOBS)[number]>;

const knobKeys = (b: QualityBudget): KnobKey[] =>
  (Object.keys(b) as (keyof QualityBudget)[]).filter(
    (k): k is KnobKey => !(NOT_KNOBS as readonly string[]).includes(k),
  );

/** false < true, so a boolean column is monotone iff it never goes true→false. */
const rank = (v: number | boolean): number => (typeof v === 'boolean' ? (v ? 1 : 0) : v);

const FORMS: { name: string; mobile: boolean }[] = [
  { name: 'desktop', mobile: false },
  { name: 'mobile', mobile: true },
];

describe('quality tiers are ordered', () => {
  for (const { name, mobile } of FORMS) {
    const low = budgetFor('low', mobile);
    const mid = budgetFor('mid', mobile);
    const high = budgetFor('high', mobile);

    it(`${name}: every knob is non-decreasing low -> mid -> high`, () => {
      for (const key of knobKeys(low)) {
        const l = rank(low[key]);
        const m = rank(mid[key]);
        const h = rank(high[key]);
        expect(l, `${name} ${key}: low (${low[key]}) must not exceed mid (${mid[key]})`).toBeLessThanOrEqual(m);
        expect(m, `${name} ${key}: mid (${mid[key]}) must not exceed high (${high[key]})`).toBeLessThanOrEqual(h);
      }
    });

    it(`${name}: the budgets carry their own tier and form factor`, () => {
      expect(low.tier).toBe('low');
      expect(mid.tier).toBe('mid');
      expect(high.tier).toBe('high');
      for (const b of [low, mid, high]) expect(b.mobile).toBe(mobile);
    });

    it(`${name}: every knob has the type the API promises`, () => {
      for (const key of knobKeys(low)) {
        const t = typeof low[key];
        expect(['number', 'boolean'], `${name} ${key} is ${t}`).toContain(t);
        expect(typeof mid[key], `${name} ${key} changes type between tiers`).toBe(t);
        expect(typeof high[key], `${name} ${key} changes type between tiers`).toBe(t);
      }
    });
  }

  it('guards against a vacuous pass: the ordering is actually exercised', () => {
    // A table where every tier is identical would sail through the monotone
    // check above and mean nothing, so prove both kinds of knob really move.
    const low = budgetFor('low', false);
    const high = budgetFor('high', false);
    const numeric = knobKeys(low).filter((k) => typeof low[k] === 'number' && low[k] !== high[k]);
    const boolish = knobKeys(low).filter((k) => typeof low[k] === 'boolean' && low[k] !== high[k]);
    expect(numeric.length, 'no numeric knob differs between low and high').toBeGreaterThan(5);
    expect(boolish.length, 'no boolean knob goes false -> true').toBeGreaterThan(0);
    // ...and that the booleans that move do so in the right direction.
    for (const k of boolish) {
      expect(low[k], `${k} should be false at low`).toBe(false);
      expect(high[k], `${k} should be true at high`).toBe(true);
    }
  });
});

describe('calibration is locked to what the scene renders today', () => {
  it('mid IS today', () => {
    const mid = budgetFor('mid', false);
    const midMobile = budgetFor('mid', true);
    expect(mid.starCount).toBe(TODAY.starCountDesktop);
    expect(midMobile.starCount).toBe(TODAY.starCountMobile);
    expect(mid.sphereSegments).toBe(TODAY.sphereSegments);
    expect(mid.anisotropy).toBe(TODAY.anisotropy);
    expect(midMobile.anisotropy).toBe(TODAY.anisotropy);
    expect(mid.bloomLevels).toBe(TODAY.bloomLevels);
    expect(mid.maxDpr).toBe(TODAY.maxDprDesktop);
    expect(midMobile.maxDpr).toBe(TODAY.maxDprMobile);
    expect(mid.extraPasses).toBe(TODAY.extraPasses);
    expect(mid.shadows).toBe(TODAY.shadows);
    // The three feature multipliers are unity at mid by definition — that is
    // what makes `COUNT * budget.dust` a no-op on today's device.
    expect(mid.cityLights).toBe(1);
    expect(mid.dust).toBe(1);
    expect(mid.meteorScale).toBe(1);
    expect(mid.particleScale).toBe(1);
  });

  it('low is AT OR BELOW today on every axis — the weakest device never regresses', () => {
    for (const { name, mobile } of FORMS) {
      const low = budgetFor('low', mobile);
      const today = budgetFor('mid', mobile);
      for (const key of knobKeys(low)) {
        expect(
          rank(low[key]),
          `${name} ${key}: low (${low[key]}) renders MORE than today (${today[key]})`,
        ).toBeLessThanOrEqual(rank(today[key]));
      }
    }
  });

  it('low still renders the things that define the still image', () => {
    // The low budget is also the reduced-motion budget, and a reduced-motion
    // visitor sees exactly one frame — so low may scale motion down but must
    // never zero out what is IN that frame.
    for (const { name, mobile } of FORMS) {
      const low = budgetFor('low', mobile);
      expect(low.starCount, `${name}: a starless sky is not a cheaper sky`).toBeGreaterThan(1000);
      expect(low.atmosphere, `${name}: airless planets`).toBeGreaterThan(0);
      expect(low.cityLights, `${name}: a dark Chicago`).toBeGreaterThan(0);
      expect(low.dust, `${name}: an empty corridor`).toBeGreaterThan(0);
      expect(low.sphereSegments, `${name}: faceted planets`).toBeGreaterThanOrEqual(24);
      expect(low.bloomLevels, `${name}: bloom is the scene's only glow`).toBeGreaterThan(0);
      expect(low.maxDpr, `${name}: sub-1x is the dpr ladder's job, not the tier's`).toBeGreaterThanOrEqual(1);
    }
  });

  it('mobile never pays for fullscreen passes or shadow maps, even at high', () => {
    const high = budgetFor('high', true);
    expect(high.extraPasses).toBe(false);
    expect(high.shadows).toBe(false);
    expect(high.anisotropy).toBeLessThanOrEqual(8);
    expect(high.maxDpr).toBeLessThanOrEqual(2);
  });

  it('MOBILE HIGH IS AT WORST TODAY on every fill-bound knob', () => {
    /* The tightest statement of the mobile ceiling, and the invariant the
     * three-knob version of this table failed: a handheld that earns `high`
     * may spend it on buffer bytes and texture filtering, and on NOTHING that
     * costs pixels per frame. Anything a phone draws more of than today's
     * phone draws is a regression on the device least able to absorb it. */
    const high = budgetFor('high', true);
    const today = budgetFor('mid', true);
    for (const key of ['sphereSegments', 'atmosphere', 'cityLights', 'dust', 'meteorScale', 'particleScale', 'nebula', 'bloomLevels'] as const) {
      expect(
        high[key],
        `mobile high ${key}: ${high[key]} exceeds today's ${today[key]}`,
      ).toBeLessThanOrEqual(today[key]);
    }
    // The two axes it IS allowed to spend on, so this test cannot pass by the
    // mobile column having quietly collapsed onto mid entirely.
    expect(high.starCount).toBeGreaterThan(today.starCount);
    expect(high.maxDpr).toBeGreaterThan(today.maxDpr);
  });

  it('the nebula band is a knob, and low renders none of it', () => {
    /* This population used to be a private table inside SpaceEnvironment,
     * which put it outside every invariant in this file — including the "low
     * is at or below today" test twenty lines up, which iterates the fields of
     * QualityBudget and so could not see it. It is four large additive
     * double-sided quads that did not exist before, so low reading zero is the
     * difference between "low is at or below today" being true and being a
     * claim nobody checked. */
    for (const { name, mobile } of FORMS) {
      expect(budgetFor('low', mobile).nebula, `${name}: low draws new fill`).toBe(0);
      expect(budgetFor('mid', mobile).nebula).toBeGreaterThan(0);
    }
  });

  it('mobile is never more expensive than desktop at the same tier', () => {
    for (const tier of TIERS) {
      const m = budgetFor(tier, true);
      const d = budgetFor(tier, false);
      for (const key of knobKeys(m)) {
        expect(
          rank(m[key]),
          `${tier} ${key}: mobile (${m[key]}) exceeds desktop (${d[key]})`,
        ).toBeLessThanOrEqual(rank(d[key]));
      }
    }
  });
});

describe('detectTier', () => {
  const base = { mobile: false, reduced: false };

  it('missing device signals fall back to mid, never high', () => {
    expect(detectTier({ ...base })).toBe('mid');
    expect(detectTier({ mobile: true, reduced: false })).toBe('mid');
    // Safari: hardwareConcurrency is reported, deviceMemory never is. A fast
    // machine that refuses to say so must not be assumed fast.
    expect(detectTier({ ...base, hardwareConcurrency: 16 })).toBe('mid');
    expect(detectTier({ ...base, hardwareConcurrency: 32, maxTextureSize: 16384 })).toBe('mid');
    // ...and the mirror case: memory without cores is equally not evidence.
    expect(detectTier({ ...base, deviceMemory: 8 })).toBe('mid');
    // Explicitly-undefined fields are the same as absent ones.
    expect(
      detectTier({
        ...base,
        deviceMemory: undefined,
        hardwareConcurrency: undefined,
        dpr: undefined,
        maxTextureSize: undefined,
      }),
    ).toBe('mid');
  });

  it('promotes only on complete, positive evidence', () => {
    const capable = { ...base, deviceMemory: 8, hardwareConcurrency: 8, maxTextureSize: 16384 };
    expect(detectTier(capable)).toBe('high');
    expect(detectTier({ ...capable, hardwareConcurrency: 12, dpr: 2 })).toBe('high');
    // A renderer that admits to a small texture limit vetoes the promotion.
    expect(detectTier({ ...capable, maxTextureSize: 4096 })).toBe('mid');
    // Strong on one axis is not strong.
    expect(detectTier({ ...capable, hardwareConcurrency: 4 })).toBe('mid');
    expect(detectTier({ ...capable, deviceMemory: 4 })).toBe('mid');
  });

  it('the renderer has to VOUCH, not merely decline to veto', () => {
    // deviceMemory is capped at 8 by spec and hardwareConcurrency is 8 on an
    // ordinary octa-core phone, so those two together describe most of the
    // shipping device population rather than the top of it. The only signal
    // that separates the ends is the one the renderer reports, and an absent
    // GL probe is therefore NOT evidence of strength.
    expect(detectTier({ ...base, deviceMemory: 8, hardwareConcurrency: 16 })).toBe('mid');
    // 8192 is a tiler's ceiling and a software rasteriser's; it is not a veto
    // (that is MIN_TEXTURE_SIZE's job at 4096) but it is not a vouch either.
    expect(
      detectTier({ ...base, deviceMemory: 8, hardwareConcurrency: 16, maxTextureSize: 8192 }),
    ).toBe('mid');
    expect(
      detectTier({ ...base, deviceMemory: 8, hardwareConcurrency: 16, maxTextureSize: 16384 }),
    ).toBe('high');
  });

  it('demotes on positive evidence of weakness', () => {
    expect(detectTier({ ...base, deviceMemory: 2, hardwareConcurrency: 16 })).toBe('low');
    expect(detectTier({ ...base, deviceMemory: 8, hardwareConcurrency: 2 })).toBe('low');
    expect(detectTier({ ...base, maxTextureSize: 2048 })).toBe('low');
    // The classic drowning mid-range Android: a dense panel on modest memory.
    expect(detectTier({ mobile: true, reduced: false, dpr: 3, deviceMemory: 4 })).toBe('low');
  });

  it('no handheld gets the high budget, however good its numbers look', () => {
    // An ordinary 8GB octa-core Android with a 16k texture limit satisfies
    // every hardware threshold in the module. It is still a phone, and the
    // high budget's headline spend is fill rate.
    const flagship = {
      reduced: false,
      deviceMemory: 8,
      hardwareConcurrency: 8,
      maxTextureSize: 16384,
    };
    for (const dpr of [2, 2.625, 3]) {
      // Portrait: narrow viewport AND coarse pointer.
      expect(detectTier({ ...flagship, dpr, mobile: true, handheld: true })).toBe('mid');
      // LANDSCAPE — the case a viewport test gets wrong. A phone turned
      // sideways is 800-950 CSS px, i.e. `mobile` is FALSE, and the old
      // promotion had nothing else to stop it: it collected MSAA, chromatic
      // aberration, film grain and 16x anisotropy by being rotated.
      expect(detectTier({ ...flagship, dpr, mobile: false, handheld: true })).toBe('mid');
    }
    // The same numbers on a real desktop are exactly what the high tier is
    // for, including behind a dense external panel.
    expect(detectTier({ ...flagship, dpr: 3, mobile: false, handheld: false })).toBe('high');
  });

  it('falls back to the viewport only where matchMedia cannot answer', () => {
    const capable = { reduced: false, deviceMemory: 8, hardwareConcurrency: 8, maxTextureSize: 16384 };
    // handheld undefined (no matchMedia at all): the narrow viewport is the
    // backstop, which is strictly the old, weaker test rather than a new hole.
    expect(detectTier({ ...capable, mobile: true })).toBe('mid');
    expect(detectTier({ ...capable, mobile: false })).toBe('high');
    // ...and an explicit `false` is trusted over the viewport, so a desktop
    // browser in a narrow window is still a desktop.
    expect(detectTier({ ...capable, mobile: true, handheld: false })).toBe('high');
  });

  it('reduced motion always resolves to low, whatever the hardware says', () => {
    const monster = {
      deviceMemory: 64,
      hardwareConcurrency: 128,
      dpr: 1,
      maxTextureSize: 32768,
    };
    expect(detectTier({ ...monster, mobile: false, reduced: true })).toBe('low');
    expect(detectTier({ ...monster, mobile: true, reduced: true })).toBe('low');
    // Same machine, motion allowed: it is a high-tier device. So the low
    // result above is the preference talking, not the hardware.
    expect(detectTier({ ...monster, mobile: false, handheld: false, reduced: false })).toBe('high');
  });

  it('reduced motion never yields an expensive budget', () => {
    for (const { name, mobile } of FORMS) {
      const reducedBudget = budgetFor(
        detectTier({
          mobile,
          reduced: true,
          deviceMemory: 64,
          hardwareConcurrency: 128,
          maxTextureSize: 32768,
        }),
        mobile,
      );
      const today = budgetFor('mid', mobile);
      expect(reducedBudget.tier).toBe('low');
      for (const key of knobKeys(reducedBudget)) {
        expect(
          rank(reducedBudget[key]),
          `${name} ${key}: reduced motion is paying ${reducedBudget[key]} vs today's ${today[key]}`,
        ).toBeLessThanOrEqual(rank(today[key]));
      }
    }
  });

  it('is pure — the same signals always give the same tier', () => {
    const signals = { mobile: false, reduced: false, deviceMemory: 8, hardwareConcurrency: 8 };
    const first = detectTier(signals);
    for (let i = 0; i < 50; i++) expect(detectTier({ ...signals })).toBe(first);
    // ...and it does not reach into its argument and rewrite it.
    const before = JSON.stringify(signals);
    detectTier(signals);
    expect(JSON.stringify(signals)).toBe(before);
  });
});

describe('budgetFor is pure', () => {
  it('same input, same output', () => {
    for (const tier of TIERS) {
      for (const { mobile } of FORMS) {
        expect(budgetFor(tier, mobile)).toEqual(budgetFor(tier, mobile));
      }
    }
  });

  it('hands out a fresh object every call — no shared mutation', () => {
    const a = budgetFor('high', false);
    const b = budgetFor('high', false);
    expect(a).not.toBe(b); // distinct identities...
    expect(a).toEqual(b); // ...with equal contents

    // A caller that scribbles on its budget must not be able to poison the
    // next caller's. This is the failure mode a shared frozen singleton or a
    // memo cache would have, and it would be invisible until two components
    // disagreed about how many stars there are.
    a.starCount = 1;
    a.extraPasses = false;
    a.tier = 'low';
    const c = budgetFor('high', false);
    expect(c.starCount).toBe(b.starCount);
    expect(c.extraPasses).toBe(b.extraPasses);
    expect(c.tier).toBe('high');
  });

  it('defaults to the desktop form when asked for a tier alone', () => {
    expect(budgetFor('low')).toEqual(budgetFor('low', false));
  });

  it('reads no globals — it is a function of its two arguments only', () => {
    // Nothing to stub: if budgetFor consulted navigator or window this test
    // file (vitest environment: 'node') would already be throwing on import.
    expect(typeof globalThis.window).toBe('undefined');
    expect(budgetFor('mid', false).starCount).toBe(TODAY.starCountDesktop);
  });
});

describe('the runtime lever only ever moves down', () => {
  it('demoteTier walks the order and clamps at low', () => {
    expect(demoteTier('high', 0)).toBe('high');
    expect(demoteTier('high', 1)).toBe('mid');
    expect(demoteTier('high', 2)).toBe('low');
    expect(demoteTier('high', 3)).toBe('low');
    expect(demoteTier('high', 99)).toBe('low');
    expect(demoteTier('mid', 1)).toBe('low');
    expect(demoteTier('low', 1)).toBe('low');
  });

  it('cannot be used to climb', () => {
    // A negative step is the obvious way a caller would try to undo a
    // demotion; it must be inert, because an oscillating tier is worse than a
    // conservative one.
    for (const tier of TIERS) {
      expect(demoteTier(tier, -1)).toBe(tier);
      expect(demoteTier(tier, -99)).toBe(tier);
      expect(demoteTier(tier, 0.5)).toBe(tier);
    }
  });

  it('every step is a real reduction in cost', () => {
    for (const { mobile } of FORMS) {
      for (const tier of TIERS) {
        const before = budgetFor(tier, mobile);
        const after = budgetFor(demoteTier(tier, 1), mobile);
        for (const key of knobKeys(before)) {
          expect(rank(after[key])).toBeLessThanOrEqual(rank(before[key]));
        }
      }
    }
  });

  it('tierRank orders the tiers and survives a bad tier', () => {
    expect(tierRank('low')).toBe(0);
    expect(tierRank('mid')).toBe(1);
    expect(tierRank('high')).toBe(2);
    // Defensive: a value from outside the union (stale storage, a hand-edited
    // query param) resolves to mid rather than crashing the flight.
    expect(tierRank('nonsense' as QualityTier)).toBe(1);
  });
});

describe('the outside-the-provider default', () => {
  it('is the mobile mid budget — safe, not expensive, never a throw', () => {
    expect(DEFAULT_BUDGET).toEqual(budgetFor('mid', true));
    expect(DEFAULT_BUDGET.tier).toBe('mid');
  });

  it('is never more expensive than any real budget at its own tier', () => {
    const desktopMid = budgetFor('mid', false);
    for (const key of knobKeys(DEFAULT_BUDGET)) {
      expect(rank(DEFAULT_BUDGET[key])).toBeLessThanOrEqual(rank(desktopMid[key]));
    }
  });
});

describe('scaleSegments', () => {
  it('leaves an art-directed base untouched at mid', () => {
    const mid = budgetFor('mid', false);
    expect(scaleSegments(mid, 64)).toBe(64); // Earth today
    expect(scaleSegments(mid, 48)).toBe(48); // every other body today
    expect(scaleSegments(mid, 36)).toBe(36);
  });

  it('scales monotonically with the tier and always returns an even count', () => {
    for (const base of [16, 36, 48, 64, 96]) {
      const l = scaleSegments(budgetFor('low', false), base);
      const m = scaleSegments(budgetFor('mid', false), base);
      const h = scaleSegments(budgetFor('high', false), base);
      expect(l).toBeLessThanOrEqual(m);
      expect(m).toBeLessThanOrEqual(h);
      for (const v of [l, m, h]) {
        expect(v % 2, `${v} is odd`).toBe(0);
        expect(v).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('floors low enough to stay a sphere', () => {
    expect(scaleSegments(budgetFor('low', false), 4)).toBeGreaterThanOrEqual(8);
  });
});
