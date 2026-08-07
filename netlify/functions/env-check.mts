// env-check — deployment self-diagnosis endpoint. Deployed on DAY ONE, not after
// the first incident. Safe to leave live: returns booleans, hostnames, and JWT
// role claims — never key material.
//
// Encodes two paid-for lessons:
//   1. VITE/server parity — server code checking a different project than the
//      client bundles fails in ways that masquerade as app bugs.
//   2. JWT role-claim decode — an anon key sitting in the service slot passes
//      every naive test, because RLS just silently returns empty results.
import { createClient } from '@supabase/supabase-js';

const host = (u: string | undefined) => {
  try {
    return u ? new URL(u).host : null;
  } catch {
    return null;
  }
};

const jwtRole = (k: string | undefined): string | null => {
  try {
    if (!k) return null;
    const payload = k.split('.')[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role ?? null;
  } catch {
    return null;
  }
};

// VITE-first: the client talks to Supabase directly, so verify the same vars it bundles.
const SUPA_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPA_ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async (): Promise<Response> => {
  const out: Record<string, unknown> = {
    context: process.env.CONTEXT ?? null,
    commit: process.env.COMMIT_REF?.slice(0, 7) ?? null,
    effective_url_host: host(SUPA_URL),
    urls_match:
      host(process.env.SUPABASE_URL) && host(process.env.VITE_SUPABASE_URL)
        ? host(process.env.SUPABASE_URL) === host(process.env.VITE_SUPABASE_URL)
        : null,
    anon_matches_vite_anon:
      process.env.SUPABASE_ANON_KEY && process.env.VITE_SUPABASE_ANON_KEY
        ? process.env.SUPABASE_ANON_KEY.trim() === process.env.VITE_SUPABASE_ANON_KEY.trim()
        : null,
    anon_key_role: jwtRole(SUPA_ANON), // expect 'anon'
    service_key_role: jwtRole(SERVICE), // if set, MUST be 'service_role'
    service_slot_holds_anon_key: SERVICE ? jwtRole(SERVICE) === 'anon' : null, // the silent killer
    anon_rls_denied_on_visits: null as unknown,
  };

  // The one discriminating probe this app needs: the anon key must be DENIED a
  // direct read of `visits` (deny-all RLS; the only doors are the RPCs). An
  // empty-success here would mean a policy leak — which is why we check the
  // error, not the row count.
  if (SUPA_URL && SUPA_ANON) {
    try {
      const anon = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
      const { error } = await anon.from('visits').select('id', { count: 'exact', head: true });
      out.anon_rls_denied_on_visits = error
        ? /denied|permission|not allowed|42501/i.test(error.message + (error.code ?? ''))
          ? true
          : `unexpected error: ${error.message}`
        : 'DENIAL MISSING — anon can read visits; RLS is leaking';
    } catch (e) {
      out.anon_rls_denied_on_visits = `threw: ${String((e as Error).message ?? e).slice(0, 140)}`;
    }
  }

  out.conclusion = !SUPA_URL
    ? 'no Supabase URL resolved — set VITE_SUPABASE_URL'
    : out.service_slot_holds_anon_key === true
      ? 'SUPABASE_SERVICE_ROLE_KEY holds an ANON key — replace it or remove it'
      : out.anon_rls_denied_on_visits === true
        ? 'env consistent; RLS denying direct reads as designed'
        : typeof out.anon_rls_denied_on_visits === 'string'
          ? 'CHECK RLS — see anon_rls_denied_on_visits'
          : 'env looks consistent (RLS probe skipped — missing anon key)';

  return new Response(JSON.stringify(out, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
