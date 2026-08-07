-- ============================================================================
-- RESUME GATE — 0001 resume_gate
--
-- Gated interactive resume. NO Supabase Auth anywhere in this schema:
-- anonymous visitors redeem an access code, the server mints a bearer token,
-- and every subsequent read/write re-checks that token inside a SECURITY
-- DEFINER RPC. Tables are sealed shut (RLS enabled + FORCED, zero policies,
-- zero grants) so the ONLY doors into this data are the four functions
-- granted to anon at the bottom of this file.
--
-- Migration atomicity note: Postgres aborts EVERYTHING after a failed
-- statement in the same transaction (a 42P07 "already exists" halfway down
-- silently skips the rest). Every CREATE here is IF NOT EXISTS / OR REPLACE /
-- ON CONFLICT-guarded so the file is re-runnable in whole.
--
-- Supabase-specific load-bearing facts:
--   * pgcrypto lives in the `extensions` schema on hosted Supabase, so
--     gen_random_bytes / digest / crypt / gen_salt are schema-qualified
--     everywhere below (the functions' search_path would resolve them
--     unqualified, but qualification also covers the SEED inserts, which run
--     with the migration session's search_path, not the functions').
--   * SECURITY DEFINER functions here end up owned by `postgres`, which on
--     Supabase carries BYPASSRLS — that is why "RLS FORCED + zero policies"
--     does not lock the functions out of their own tables. On a vanilla
--     Postgres where the owner lacks BYPASSRLS, FORCE + no policies would
--     deny even these functions; drop the FORCE lines there.
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

-- Hosted Supabase pre-creates the `extensions` schema and ships pgcrypto in
-- it; both statements are no-ops there. `if not exists` also guards the edge
-- where pgcrypto is already installed (Postgres then skips the statement
-- entirely, `with schema` and all, instead of erroring).
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ============================================================================
-- TABLES
-- ============================================================================

-- ---------------------------------------------------------------------------
-- access_codes — one row per code you hand out (typically one per company).
--
-- The code IS the primary key and is stored UPPERCASE-canonical (enforced by
-- the check, normalized on redemption) so redemption is case-insensitive
-- without a functional index. Never DELETE a code that has visits — the FK
-- from visits will refuse; set active = false to retire it instead.
-- ---------------------------------------------------------------------------
create table if not exists public.access_codes (
  code       text primary key
               check (char_length(code) <= 40)
               check (code = upper(code)),
  company    text not null check (char_length(company) <= 120),
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- visits — one row per successful redemption (a "session", loosely).
--
-- token_hash holds the sha256 hex of the server-minted bearer token; the
-- plaintext token exists only in the redeem response and the visitor's
-- browser. A database leak therefore leaks nothing replayable.
--
-- email is nullable BY DESIGN — asking is fine, requiring it kills the
-- conversion rate of your own resume.
--
-- char_length checks are a backstop only; the redeem RPC trims/left()s every
-- input to these limits instead of erroring, so the checks should never fire.
-- ---------------------------------------------------------------------------
create table if not exists public.visits (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) <= 120),
  company          text not null check (char_length(company) <= 120),
  role             text not null check (char_length(role) <= 120),
  email            text check (char_length(email) <= 120),
  code             text not null references public.access_codes(code),
  user_agent       text check (char_length(user_agent) <= 400),
  token_hash       text not null,
  furthest_station int not null default 0,
  station_count    int,
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);

-- FKs do not auto-index in Postgres; the dashboard aggregates group by code.
create index if not exists visits_code_idx on public.visits (code);
-- Dashboard lists newest-first.
create index if not exists visits_created_at_idx on public.visits (created_at desc);

-- ---------------------------------------------------------------------------
-- gate_config — single-row config table.
--
-- `id boolean primary key default true check (id)` is the classic one-row
-- trick: the only representable key value is TRUE, so a second row is
-- unrepresentable rather than merely discouraged.
-- ---------------------------------------------------------------------------
create table if not exists public.gate_config (
  id                      boolean primary key default true check (id),
  dashboard_passcode_hash text not null
);

-- ---------------------------------------------------------------------------
-- gate_attempts — fixed-window rate-limit counters, one row per (key, minute).
--
-- `ip` is really "key": the rate-limit helper prefixes the caller-supplied
-- scope (e.g. 'redeem:1.2.3.4') so each endpoint gets its own per-IP budget
-- while the global per-minute cap sums across everything. Rows are pruned
-- opportunistically by the helper itself; no cron needed.
-- ---------------------------------------------------------------------------
create table if not exists public.gate_attempts (
  ip            text not null,
  minute_bucket timestamptz not null,
  n             int not null default 1,
  primary key (ip, minute_bucket)
);

-- The helper's global-cap query and prune both filter on minute_bucket alone,
-- which the (ip, minute_bucket) PK cannot serve.
create index if not exists gate_attempts_bucket_idx
  on public.gate_attempts (minute_bucket);

-- ============================================================================
-- LOCKDOWN — RLS
-- ============================================================================

-- Deny-all: RLS enabled AND forced on every table, with deliberately ZERO
-- policies. Anonymous PostgREST access to /rest/v1/<table> dies here even if
-- a future migration accidentally re-grants table privileges — no policy, no
-- rows. FORCE extends that to the table owner; our SECURITY DEFINER RPCs
-- still work because Supabase's `postgres` role carries BYPASSRLS (see the
-- header note). Both ALTERs are naturally idempotent.
alter table public.access_codes  enable row level security;
alter table public.access_codes  force row level security;
alter table public.visits        enable row level security;
alter table public.visits        force row level security;
alter table public.gate_config   enable row level security;
alter table public.gate_config   force row level security;
alter table public.gate_attempts enable row level security;
alter table public.gate_attempts force row level security;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- All functions: SECURITY DEFINER (they are the only path past the deny-all
-- tables), search_path pinned to (public, extensions) so nothing resolves
-- through a caller-controlled path, and json returns for EXPECTED failures —
-- the client discriminates on the payload; exceptions are reserved for bugs.

-- ---------------------------------------------------------------------------
-- gate_rate_limit — internal helper. Returns true when the call may proceed,
-- false when the caller should get {ok:false, reason:'rate_limited'}.
--
-- Runs BEFORE any crypt() call in every function that fronts bcrypt —
-- bcrypt is deliberately expensive, so hashing on every spray attempt would
-- hand an attacker a CPU-DoS for free. Cheap counter first, hash second.
--
-- Two limits:
--   per-key  (scope + IP)      > 10/minute  -> deny
--   global   (all keys summed) > 60/minute  -> deny
-- The global cap is the backstop for X-Real-IP spoofing: an attacker who
-- forges a fresh IP per request defeats the per-key limit but not the sum.
--
-- NOT granted to anon — internal only (see GRANT HYGIENE below).
-- ---------------------------------------------------------------------------
create or replace function public.gate_rate_limit(p_scope text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ip     text;
  v_key    text;
  v_bucket timestamptz := date_trunc('minute', now());
  v_n      int;
  v_total  bigint;
begin
  -- x-real-ip is stamped by Supabase's edge on every PostgREST request.
  -- current_setting(..., true) yields NULL instead of raising when the GUC
  -- is absent (SQL editor, psql), hence the double coalesce; left() bounds
  -- the key against a garbage spoofed header.
  v_ip := left(coalesce(
    coalesce(current_setting('request.headers', true), '{}')::json ->> 'x-real-ip',
    'unknown'), 120);
  v_key := p_scope || ':' || v_ip;

  insert into public.gate_attempts as ga (ip, minute_bucket, n)
  values (v_key, v_bucket, 1)
  on conflict (ip, minute_bucket)
  do update set n = ga.n + 1
  returning ga.n into v_n;

  select coalesce(sum(n), 0) into v_total
  from public.gate_attempts
  where minute_bucket = v_bucket;

  -- Opportunistic prune: the table only ever grows through this function, so
  -- letting each call sweep stale buckets keeps it a few rows forever.
  delete from public.gate_attempts
  where minute_bucket < now() - interval '1 hour';

  return v_n <= 10 and v_total <= 60;
end;
$$;

-- ---------------------------------------------------------------------------
-- redeem_access_code — the front gate.
--
-- Success mints a 24-byte (192-bit) random bearer token, returned ONCE in
-- plaintext; only its sha256 hex is stored. Inactive and nonexistent codes
-- take the identical single-index-probe path and return the identical
-- payload — no enumeration signal in shape or timing.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_access_code(
  p_code       text,
  p_name       text,
  p_company    text,
  p_role       text,
  p_email      text,
  p_user_agent text
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code     text;
  v_token    text;
  v_visit_id uuid;
begin
  if not public.gate_rate_limit('redeem') then
    return json_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- Case-insensitive redemption: storage is uppercase-canonical, so
  -- normalizing the input here is the entire comparison strategy.
  v_code := upper(trim(coalesce(p_code, '')));

  perform 1 from public.access_codes where code = v_code and active;
  if not found then
    return json_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  -- trim/left() every input to its check limit instead of erroring: a
  -- visitor with a 130-char employer name should not see a 500.
  -- coalesce('') on the not-null columns keeps a null from a buggy client
  -- from raising; empty string is an acceptable degenerate value here.
  insert into public.visits (name, company, role, email, code, user_agent, token_hash)
  values (
    left(trim(coalesce(p_name,    '')), 120),
    left(trim(coalesce(p_company, '')), 120),
    left(trim(coalesce(p_role,    '')), 120),
    nullif(left(trim(coalesce(p_email, '')), 120), ''),
    v_code,
    nullif(left(coalesce(p_user_agent, ''), 400), ''),
    encode(extensions.digest(v_token, 'sha256'), 'hex')
  )
  returning id into v_visit_id;

  return json_build_object('ok', true, 'visit_id', v_visit_id, 'token', v_token);
end;
$$;

-- ---------------------------------------------------------------------------
-- validate_visit — resume-a-session check on page load.
--
-- Valid token: touch last_seen_at, hand back progress. Anything else —
-- unknown visit id, wrong token, nulls — collapses to the same
-- {valid:false} (a null p_token null-propagates through digest/encode and
-- simply matches no row; no explicit null-handling needed).
-- ---------------------------------------------------------------------------
create or replace function public.validate_visit(
  p_visit_id uuid,
  p_token    text
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_station int;
begin
  update public.visits v
     set last_seen_at = now()
   where v.id = p_visit_id
     and v.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  returning v.furthest_station into v_station;

  if found then
    return json_build_object('valid', true, 'furthest_station', v_station);
  end if;
  return json_build_object('valid', false, 'furthest_station', 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- log_station — progress beacon as the visitor moves through the resume.
--
-- furthest_station is monotone (greatest()) so out-of-order beacons can never
-- roll progress back; the station index is clamped to [0,99] because this is
-- a progress marker, not client-supplied truth. station_count lets the client
-- report how many stations its build has, so old rows stay interpretable
-- after the resume grows.
-- ---------------------------------------------------------------------------
create or replace function public.log_station(
  p_visit_id      uuid,
  p_token         text,
  p_station       int,
  p_station_count int
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_station int := least(greatest(coalesce(p_station, 0), 0), 99);
begin
  update public.visits v
     set furthest_station = greatest(v.furthest_station, v_station),
         station_count    = coalesce(p_station_count, v.station_count),
         last_seen_at     = now()
   where v.id = p_visit_id
     and v.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  return json_build_object('ok', found);
end;
$$;

-- ---------------------------------------------------------------------------
-- dashboard_visits — the owner's view, gated by a bcrypt passcode.
--
-- Rate limit FIRST: this endpoint fronts a crypt() compare, exactly the
-- CPU-DoS shape gate_rate_limit exists for. A wrong passcode is a bare
-- {ok:false} — no reason field, nothing to enumerate.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_visits(p_passcode text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash   text;
  v_visits json;
  v_codes  json;
begin
  if not public.gate_rate_limit('dashboard') then
    return json_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select dashboard_passcode_hash into v_hash from public.gate_config where id;

  if v_hash is null
     or p_passcode is null
     or extensions.crypt(p_passcode, v_hash) <> v_hash then
    return json_build_object('ok', false);
  end if;

  select coalesce(json_agg(row_to_json(t)), '[]'::json) into v_visits
  from (
    select id, name, company, role, email, code, user_agent,
           furthest_station, station_count, created_at, last_seen_at
    from public.visits
    order by created_at desc
  ) t;

  -- Per-code rollup the client could also derive from `visits`; shipping it
  -- server-side keeps the dashboard render O(1) and, via the left join,
  -- surfaces codes that were minted but never redeemed.
  select coalesce(json_agg(row_to_json(c)), '[]'::json) into v_codes
  from (
    select ac.code, ac.company, ac.active,
           count(v.id)           as visit_count,
           max(v.last_seen_at)   as last_seen_at,
           max(v.furthest_station) as max_station
    from public.access_codes ac
    left join public.visits v on v.code = ac.code
    group by ac.code, ac.company, ac.active
    order by count(v.id) desc, ac.code
  ) c;

  return json_build_object('ok', true, 'visits', v_visits, 'codes', v_codes);
end;
$$;

-- ============================================================================
-- GRANT HYGIENE
-- ============================================================================

-- Postgres grants EXECUTE on every new function to PUBLIC by default, and
-- PostgREST exposes every executable function in an exposed schema at
-- /rest/v1/rpc/* — so "I never granted anything" is NOT the default state.
-- Revoke everything from everyone, then grant back exactly the four entry
-- points, to exactly the role that needs them.

-- gate_rate_limit is internal: callable only from inside the other definers.
-- Exposed directly, it would let an attacker burn the shared global budget
-- (deliberate self-DoS of the gate) at zero cost — so: no anon grant, ever.
revoke execute on function public.gate_rate_limit(text)
  from public, anon, authenticated;
revoke execute on function public.redeem_access_code(text, text, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.validate_visit(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.log_station(uuid, text, int, int)
  from public, anon, authenticated;
revoke execute on function public.dashboard_visits(text)
  from public, anon, authenticated;

-- The four public entry points, anon only: this app has no authenticated
-- users by design, so the authenticated role gets nothing to inherit.
grant execute on function public.redeem_access_code(text, text, text, text, text, text) to anon;
grant execute on function public.validate_visit(uuid, text) to anon;
grant execute on function public.log_station(uuid, text, int, int) to anon;
grant execute on function public.dashboard_visits(text) to anon;

-- Future functions fail CLOSED: without this, the next migration's helper
-- function is born PUBLIC-executable and PostgREST-reachable before anyone
-- remembers to revoke it. (Default privileges apply to objects later created
-- by the role running this migration — on Supabase that is `postgres`, the
-- same role that runs every future migration, which is what makes this line
-- effective rather than decorative.)
alter default privileges in schema public revoke execute on functions from public;

-- Belt to RLS's suspenders: even with zero policies, table privileges should
-- ALSO be zero, so a future accidental `create policy` on one of these tables
-- still exposes nothing to the API roles.
revoke all on all tables in schema public from anon, authenticated;

-- ============================================================================
-- SEED
-- ============================================================================

-- ############################################################################
-- ##  CHANGE THIS PASSCODE BEFORE SHARING THE RESUME WITH ANYONE.           ##
-- ##  The seed below sets the dashboard passcode to 'liftoff' — anyone who  ##
-- ##  reads this file in your repo can open your visitor dashboard until    ##
-- ##  you rotate it. One line, run it in the SQL editor:                    ##
-- ##                                                                        ##
-- ##  update public.gate_config set dashboard_passcode_hash = extensions.crypt('YOUR-NEW-PASSCODE', extensions.gen_salt('bf')) where id;
-- ##                                                                        ##
-- ############################################################################
-- on conflict do nothing => re-running this migration never resets a rotated
-- passcode back to the default.
insert into public.gate_config (id, dashboard_passcode_hash)
values (true, extensions.crypt('liftoff', extensions.gen_salt('bf')))
on conflict (id) do nothing;

-- Demo access code so the gate works out of the box. Delete or deactivate
-- once real codes exist: update public.access_codes set active = false where code = 'DEMO-K7M3';
insert into public.access_codes (code, company, note)
values ('DEMO-K7M3', 'Demo — replace me', 'Seeded demo code — safe to retire')
on conflict (code) do nothing;

-- Minting a real per-company code — run in the SQL editor:
--
--   insert into public.access_codes (code, company, note)
--   values ('ACME-Q7X2', 'Acme Corp', 'sent to Jane Recruiter, 2026-08-07');
--
-- Format advice (convention, not enforced beyond uppercase + length):
-- COMPANY-XXXX, where XXXX is 4 random chars of entropy. Store UPPERCASE —
-- redemption uppercases input, so recipients can type it any way they like.
-- Guessing is not the threat model (codes gate a resume, not money) but the
-- 4 chars keep drive-by URL sharing from being trivially forgeable.
