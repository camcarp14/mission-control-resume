-- ============================================================================
-- BUILDOUT — 0001 foundation
--
-- Single-user app. Every table carries owner_id and is protected by RLS with
-- auth.uid() = owner_id. There is no "trust the client" path anywhere.
--
-- Migration atomicity note: Postgres aborts EVERYTHING after a failed statement
-- in the same transaction (a 42P07 "already exists" halfway down silently skips
-- the rest). Every CREATE here is IF NOT EXISTS / guarded so the file is
-- re-runnable in whole.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type fleet as enum ('RENTED', 'OWNED', 'TRAINING');
exception when duplicate_object then null; end $$;

do $$ begin
  create type workload_class as enum ('TRAIN', 'INFER', 'MAINTAIN');
exception when duplicate_object then null; end $$;

do $$ begin
  create type workload_status as enum ('QUEUED', 'ACTIVE', 'DONE', 'DROPPED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type incident_type as enum ('brownout', 'missed_week', 'prod_fail');
exception when duplicate_object then null; end $$;

do $$ begin
  create type allocation_source as enum ('ai', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type artifact_type as enum (
    'app', 'post', 'system', 'case_study', 'library', 'audience', 'other'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- capabilities — the racks
--
-- level is DERIVED, never stored as authoritative. peak_level is the source of
-- truth; the engine recomputes current level from peak + the utilization event
-- log. derived_level is a nightly-written cache for fast reads ONLY.
--
-- Two decay clocks, deliberately separate:
--   half_life_days             — how fast YOUR RECALL fades with disuse
--   obsolescence_half_life_days — how fast the DOMAIN changes under you
-- Paid search fundamentals: slow recall decay, fast obsolescence. A specific
-- framework: fast on both. One half-life cannot express that distinction, and
-- the distinction is what makes this screen actionable rather than merely
-- uncomfortable.
-- ---------------------------------------------------------------------------
create table if not exists public.capabilities (
  id                          uuid primary key default gen_random_uuid(),
  owner_id                    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name                        text not null,
  domain                      text not null,

  peak_level                  numeric(5,2) not null default 0
                                check (peak_level >= 0 and peak_level <= 100),
  derived_level               numeric(5,2)
                                check (derived_level is null or (derived_level >= 0 and derived_level <= 100)),

  -- Decay toward a floor, not toward zero. You do not forget paid search; you
  -- forget this quarter's paid search. retention_floor is the durable
  -- conceptual core as a fraction of peak.
  retention_floor             numeric(4,3) not null default 0.400
                                check (retention_floor >= 0 and retention_floor <= 1),
  half_life_days              integer not null default 180 check (half_life_days > 0),
  obsolescence_half_life_days integer not null default 365 check (obsolescence_half_life_days > 0),

  -- How much of market-relevant level survives total obsolescence (gamma).
  -- 1.0 => currency is irrelevant; 0.0 => stale knowledge is worthless.
  currency_weight             numeric(4,3) not null default 0.500
                                check (currency_weight >= 0 and currency_weight <= 1),

  market_multiplier           numeric(5,2) not null default 1.00 check (market_multiplier >= 0),
  cohort_median               numeric(5,2) check (cohort_median is null or (cohort_median >= 0 and cohort_median <= 100)),
  cohort_p75                  numeric(5,2) check (cohort_p75 is null or (cohort_p75 >= 0 and cohort_p75 <= 100)),
  cohort_p90                  numeric(5,2) check (cohort_p90 is null or (cohort_p90 >= 0 and cohort_p90 <= 100)),
  -- Beating a median is not a moat. p90 is where independence lives.
  cohort_source               text,   -- where the number came from. NULL = you made it up.
  cohort_adjusted_at          timestamptz,
  cohort_adjusted_reason      text,   -- self-serving edits leave fingerprints

  last_utilized_at            timestamptz,
  last_refreshed_at           timestamptz,  -- drives the obsolescence clock

  -- What does 80 mean for THIS capability? Without an anchor the 0-100 scale is
  -- vibes with decimal places, and every downstream number inherits the vagueness.
  level_anchor_notes          text,
  notes                       text,
  archived                    boolean not null default false,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (owner_id, name)
);

-- ---------------------------------------------------------------------------
-- utilization_events — intensity-weighted decay input
--
-- Without this, last_utilized_at is binary: 10 minutes on a rack resets the
-- clock identically to 30 hours, and the whole decay model launders casual
-- contact as maintenance.
-- ---------------------------------------------------------------------------
create table if not exists public.utilization_events (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  capability_id uuid not null references public.capabilities(id) on delete cascade,
  occurred_at   timestamptz not null default now(),
  hours         numeric(6,2) not null check (hours >= 0),
  is_refresh    boolean not null default false,  -- true = learned something NEW (resets currency clock)
  workload_id   uuid,
  source        text not null default 'manual',
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- capability_affinity — the correlation matrix the moat calc requires
--
-- Multiplying independent marginals is the failure mode this table exists to
-- prevent: P(A)*P(B)*P(C) yields "1 in 40 million" because it assumes skills
-- are uncorrelated, when they are strongly positively correlated in reality.
-- affinity = P(holds B | holds A), hand-set and visible on screen so the
-- assumption is auditable rather than buried in a formula.
-- ---------------------------------------------------------------------------
create table if not exists public.capability_affinity (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cap_a      uuid not null references public.capabilities(id) on delete cascade,
  cap_b      uuid not null references public.capabilities(id) on delete cascade,
  affinity   numeric(5,4) not null check (affinity > 0 and affinity <= 1),
  demand     numeric(4,2) not null default 1.00 check (demand >= 0),
  rationale  text,
  created_at timestamptz not null default now(),
  check (cap_a < cap_b),          -- store each unordered pair exactly once
  unique (owner_id, cap_a, cap_b)
);

-- ---------------------------------------------------------------------------
-- capacity_ledger — the fleet view. Power is the real constraint, not hours.
-- ---------------------------------------------------------------------------
create table if not exists public.capacity_ledger (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start            date not null,
  fleet                 fleet not null,
  hours_planned         numeric(6,2) not null default 0 check (hours_planned >= 0),
  hours_actual          numeric(6,2) not null default 0 check (hours_actual >= 0),
  power_blocks_planned  numeric(5,2) not null default 0 check (power_blocks_planned >= 0),
  power_blocks_actual   numeric(5,2) not null default 0 check (power_blocks_actual >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (owner_id, week_start, fleet)
);

-- ---------------------------------------------------------------------------
-- workloads — scheduled work. emits_artifact is the load-bearing column:
-- hours that emit no artifact are pure opex.
-- ---------------------------------------------------------------------------
create table if not exists public.workloads (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title              text not null,
  fleet              fleet not null,
  class              workload_class not null,
  capability_tags    uuid[] not null default '{}',
  power_cost         numeric(5,2) not null default 1 check (power_cost >= 0),
  est_hours          numeric(6,2) not null default 0 check (est_hours >= 0),
  actual_hours       numeric(6,2) check (actual_hours is null or actual_hours >= 0),
  human_hours        numeric(6,2) not null default 0 check (human_hours >= 0),
  agent_hours        numeric(6,2) not null default 0 check (agent_hours >= 0),
  emits_artifact     boolean not null default false,
  yield_skill        numeric(5,2) not null default 0,
  yield_cash         numeric(12,2) not null default 0,
  yield_optionality  numeric(5,2) not null default 0,
  status             workload_status not null default 'QUEUED',
  scheduled_week     date,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- artifacts — the only real output.
--
-- recurring_value is split deliberately. Runway computes from BOOKED only.
-- The moment an estimate feeds runway, the number becomes fiction — and runway
-- is the one number on the wall you might actually make a life decision on.
-- ---------------------------------------------------------------------------
create table if not exists public.artifacts (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workload_id             uuid references public.workloads(id) on delete set null,
  type                    artifact_type not null default 'other',
  title                   text not null,
  url                     text,
  shipped_at              timestamptz not null default now(),
  recurring_value_booked  numeric(12,2) not null default 0 check (recurring_value_booked >= 0),
  recurring_value_est     numeric(12,2) not null default 0 check (recurring_value_est >= 0),
  still_producing         boolean not null default true,
  created_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- allocations — AI proposals land here in a review state. Nothing writes to the
-- ledger without an explicit accept: accepted_at IS NULL means "proposed only".
-- ---------------------------------------------------------------------------
create table if not exists public.allocations (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start  date not null,
  plan_json   jsonb not null,
  reasoning   text,
  risks       jsonb not null default '[]'::jsonb,
  source      allocation_source not null default 'manual',
  accepted_at timestamptz,
  rejected_at timestamptz,
  created_at  timestamptz not null default now(),
  check (accepted_at is null or rejected_at is null)
);

-- ---------------------------------------------------------------------------
-- benchmarks — nightly snapshots for trajectory charts
-- ---------------------------------------------------------------------------
create table if not exists public.benchmarks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dimension   text not null,
  my_value    numeric(12,4) not null,
  cohort_value numeric(12,4),
  as_of       date not null default current_date,
  created_at  timestamptz not null default now(),
  unique (owner_id, dimension, as_of)
);

-- ---------------------------------------------------------------------------
-- incidents — brownouts, missed compounding weeks, prod failures
-- ---------------------------------------------------------------------------
create table if not exists public.incidents (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  type        incident_type not null,
  severity    smallint not null default 2 check (severity between 1 and 5),
  summary     text not null,
  postmortem  text,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- thesis_log — the single best anti-flattery device in the app.
--
-- predicted_value/actual_value turn this from a diary into a calibration
-- instrument. A Brier-style score over resolved theses measures your optimism
-- bias, and the projection engine then discounts every forward number by
-- exactly that much. The app grades your forecasting and stops trusting you in
-- proportion to the evidence.
-- ---------------------------------------------------------------------------
create table if not exists public.thesis_log (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  claim           text not null,
  confidence      numeric(4,3) not null check (confidence > 0 and confidence < 1),
  horizon         date not null,
  predicted_value numeric(12,4),
  actual_value    numeric(12,4),
  resolved        boolean not null default false,
  resolved_at     timestamptz,
  outcome         boolean,   -- did the claim come true
  notes           text,
  check (not resolved or outcome is not null)
);

-- ---------------------------------------------------------------------------
-- settings — burn, power budget, cohort definition. One row.
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  owner_id                uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  monthly_burn            numeric(12,2) not null default 0 check (monthly_burn >= 0),
  daily_power_blocks      numeric(4,2) not null default 4 check (daily_power_blocks > 0),
  cohort_label            text not null default 'Senior paid search analyst, 3-5 yrs, major metro',
  cohort_source_notes     text,
  train_infer_horizon_wks integer not null default 52 check (train_infer_horizon_wks > 0),
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_util_cap_time  on public.utilization_events (owner_id, capability_id, occurred_at desc);
create index if not exists idx_ledger_week    on public.capacity_ledger (owner_id, week_start desc);
create index if not exists idx_workloads_week on public.workloads (owner_id, scheduled_week desc, status);
create index if not exists idx_artifacts_ship on public.artifacts (owner_id, shipped_at desc);
create index if not exists idx_bench_dim      on public.benchmarks (owner_id, dimension, as_of desc);
create index if not exists idx_incidents_time on public.incidents (owner_id, occurred_at desc);
create index if not exists idx_alloc_week     on public.allocations (owner_id, week_start desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['capabilities','capacity_ledger','workloads','settings'] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$I
       for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS — on EVERY table, no exceptions.
--
-- Verified by attempted breach, not by reading this file. See
-- scripts/rls-breach-test.mjs: it authenticates as a non-owner and asserts the
-- read is denied, after decoding the JWT role claim to prove which key it holds.
-- (A `select ... limit 1` under RLS with the WRONG key returns an empty SUCCESS —
-- a test that passes for that reason is worse than no test at all.)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'capabilities','utilization_events','capability_affinity','capacity_ledger',
    'workloads','artifacts','allocations','benchmarks','incidents','thesis_log','settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format(
      'create policy owner_all on public.%I
         for all
         to authenticated
         using (auth.uid() = owner_id)
         with check (auth.uid() = owner_id)', t);
  end loop;
end $$;

-- Belt and braces: revoke the blanket grants Supabase hands to anon/authenticated
-- so a missing policy fails closed rather than open.
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
