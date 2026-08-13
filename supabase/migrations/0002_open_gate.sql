-- ============================================================================
-- RESUME GATE — 0002 open_gate
--
-- The gate's meaning changed by owner decision: it is no longer access
-- control, it is a friendly sign-in. Visitors enter with a name and company
-- (both optional — even empty), and access codes are retired from the UI.
--
-- What stays exactly as 0001 built it: deny-all RLS on every table, bearer
-- tokens minted server-side and stored only as sha256, validate_visit /
-- log_station / dashboard_visits, and the in-DB rate limiting. The logbook
-- still records who came and how far they flew; it just no longer asks for
-- a ticket at the door.
--
-- Re-runnable in whole, same as 0001: every statement is idempotent.
-- ============================================================================

-- Visits no longer require a code. Legacy rows keep theirs; the FK still
-- validates any non-null value. (DROP NOT NULL is a no-op when already
-- nullable, so this file stays re-runnable.)
alter table public.visits alter column code drop not null;

-- ---------------------------------------------------------------------------
-- begin_visit — the open front door.
--
-- The shape of redeem_access_code minus the code check: rate-limit first,
-- mint a 24-byte bearer token, insert the visit, hand the token back once.
-- Name and company may be empty — an anonymous visit is still a visit, and
-- the dashboard's furthest-station funnel works the same either way.
-- ---------------------------------------------------------------------------
create or replace function public.begin_visit(
  p_name       text,
  p_company    text,
  p_user_agent text
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token    text;
  v_visit_id uuid;
begin
  -- Same budget pool as the rest of the gate; its own per-IP scope. This is
  -- the only thing between an open door and a bot filling the logbook.
  if not public.gate_rate_limit('begin') then
    return json_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.visits (name, company, role, email, code, user_agent, token_hash)
  values (
    left(trim(coalesce(p_name,    '')), 120),
    left(trim(coalesce(p_company, '')), 120),
    '',        -- role: retired from the form; column stays for legacy rows
    null,      -- email: retired from the form
    null,      -- code: the whole point of this migration
    nullif(left(coalesce(p_user_agent, ''), 400), ''),
    encode(extensions.digest(v_token, 'sha256'), 'hex')
  )
  returning id into v_visit_id;

  return json_build_object('ok', true, 'visit_id', v_visit_id, 'token', v_token);
end;
$$;

-- Grant hygiene, same discipline as 0001: strip the default PUBLIC grant,
-- then grant exactly one role.
revoke execute on function public.begin_visit(text, text, text)
  from public, anon, authenticated;
grant execute on function public.begin_visit(text, text, text) to anon;

-- redeem_access_code is no longer reachable from the UI; shrink the exposed
-- surface to match. The function and the access_codes table stay — history,
-- and a one-line re-grant away if codes ever come back.
revoke execute on function public.redeem_access_code(text, text, text, text, text, text)
  from anon;
