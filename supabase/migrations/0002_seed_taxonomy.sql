-- ============================================================================
-- BUILDOUT — 0002 seed taxonomy
--
-- ⚠️  STRAWMAN. Every number below is a guess inferred from the build brief,
-- not a measurement. It exists so the app has something to render and so you
-- have something concrete to argue with — editing a wrong number is far faster
-- than inventing a right one from a blank screen.
--
-- Before this app's output means anything, three things need YOUR input:
--   1. level_anchor_notes — what 80 actually means for each rack. Without an
--      anchor the 0-100 scale is vibes with decimal places.
--   2. cohort_* + cohort_source — one external number (Levels.fyi, a real
--      offer) beats ten calibrated guesses, and NULL source is the app's way of
--      recording "he made this up".
--   3. affinity — how surprising each pair genuinely is in your market.
--
-- Idempotent: re-running updates nothing that you have since edited by hand.
-- ============================================================================

do $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise notice 'No auth.uid() in this session — run this while signed in, or set the owner explicitly.';
    return;
  end if;

  -- ---- capabilities -------------------------------------------------------
  -- half_life_days            : how fast YOUR RECALL fades with disuse
  -- obsolescence_half_life_days: how fast the DOMAIN changes under you
  -- retention_floor           : durable conceptual core, as a fraction of peak
  --
  -- Note paid search: SLOW recall decay (720d) but FAST obsolescence (240d).
  -- The fundamentals stay; the edge does not. That split is the whole reason
  -- there are two clocks, and it contradicts a single "decays slowly" rate.
  insert into public.capabilities
    (owner_id, name, domain, peak_level, retention_floor, half_life_days,
     obsolescence_half_life_days, currency_weight, market_multiplier, notes)
  values
    (uid, 'Paid search',        'marketing',   78, 0.65, 720, 240, 0.60, 1.00,
      'STRAWMAN. Fundamentals durable; tactics obsolescing fast under PMax/AI-driven buying.'),
    (uid, 'Paid social',        'marketing',   62, 0.55, 540, 300, 0.55, 0.90, 'STRAWMAN'),
    (uid, 'Analytics / GA4',    'marketing',   68, 0.60, 540, 420, 0.50, 0.85, 'STRAWMAN'),
    (uid, 'Full-stack web',     'engineering', 58, 0.50, 300, 480, 0.45, 1.30, 'STRAWMAN'),
    (uid, 'TypeScript / React', 'engineering', 60, 0.45, 240, 420, 0.45, 1.20, 'STRAWMAN'),
    (uid, 'Crypto / DeFi',      'engineering', 45, 0.40, 240, 210, 0.35, 1.45,
      'STRAWMAN. Fast on both clocks — the domain rewrites itself.'),
    (uid, 'Agent orchestration','engineering', 55, 0.35, 180, 150, 0.30, 1.60,
      'STRAWMAN. Shortest obsolescence half-life in the taxonomy by design.'),
    (uid, 'Writing',            'distribution',64, 0.85, 900, 900, 0.85, 1.10,
      'STRAWMAN. Slow on both clocks — the most durable rack here.'),
    (uid, 'Distribution / audience','distribution', 40, 0.70, 600, 360, 0.60, 1.50, 'STRAWMAN'),
    (uid, 'Client / account management','business', 66, 0.75, 720, 720, 0.75, 0.80, 'STRAWMAN')
  on conflict (owner_id, name) do nothing;

  -- ---- affinity matrix ----------------------------------------------------
  -- affinity = P(holds B | holds A). LOW affinity = surprising combination =
  -- high moat contribution. These are the numbers that stop the moat score
  -- from being "multiply independent probabilities and claim 1-in-40-million".
  --
  -- demand = does the COMBINATION compose into something someone pays for.
  -- Rarity without demand ranks the weirdest next capability, not the best one.
  insert into public.capability_affinity (owner_id, cap_a, cap_b, affinity, demand, rationale)
  select uid, least(a.id, b.id), greatest(a.id, b.id), v.affinity, v.demand, v.rationale
  from (values
    -- unsurprising: these travel together, so they earn almost no moat
    ('Paid search',        'Analytics / GA4',           0.8500, 0.60, 'STRAWMAN. Nearly every paid search analyst has analytics. Almost zero surprise.'),
    ('Paid search',        'Paid social',               0.7000, 0.65, 'STRAWMAN. Same job family.'),
    ('Full-stack web',     'TypeScript / React',        0.8000, 0.70, 'STRAWMAN. Same skill cluster.'),
    -- surprising AND commercially composable: this is where a moat actually lives
    ('Paid search',        'Full-stack web',            0.0400, 1.60, 'STRAWMAN. Marketers who genuinely ship software are rare AND the pair composes.'),
    ('Paid search',        'Agent orchestration',       0.0300, 1.80, 'STRAWMAN. The bet: performance marketing that automates itself.'),
    ('Paid search',        'Crypto / DeFi',             0.0150, 0.70, 'STRAWMAN. Very rare, but weak demand for the COMBINATION — rarity is not value.'),
    ('Full-stack web',     'Distribution / audience',   0.1000, 1.70, 'STRAWMAN. Engineers who can also distribute are the scarce half of every indie product.'),
    ('Writing',            'Agent orchestration',       0.0600, 1.40, 'STRAWMAN'),
    ('Writing',            'Distribution / audience',   0.4500, 1.30, 'STRAWMAN. Correlated, but the pair still compounds.'),
    ('Crypto / DeFi',      'Distribution / audience',   0.0800, 1.10, 'STRAWMAN'),
    ('Client / account management', 'Full-stack web',   0.0700, 1.35, 'STRAWMAN. Can scope it AND build it — rare in agencies.')
  ) as v(name_a, name_b, affinity, demand, rationale)
  join public.capabilities a on a.owner_id = uid and a.name = v.name_a
  join public.capabilities b on b.owner_id = uid and b.name = v.name_b
  on conflict (owner_id, cap_a, cap_b) do nothing;

  -- ---- settings -----------------------------------------------------------
  -- monthly_burn stays 0 deliberately. Runway is undefined until you put a real
  -- number here, and "undefined" is the honest state — not a placeholder that
  -- quietly produces a comforting projection.
  insert into public.settings (owner_id, monthly_burn, daily_power_blocks, cohort_source_notes)
  values (uid, 0, 4,
    'UNSET. Cohort values on capabilities have no source yet — every one is a guess. '
    'Replace with Levels.fyi / Glassdoor / real offers before trusting DIVERGENCE.')
  on conflict (owner_id) do nothing;
end $$;
