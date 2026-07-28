// env-check — deployment self-diagnosis endpoint. Deployed on DAY ONE, not after
// the first incident. Safe to leave live: returns booleans, hostnames, and JWT
// role claims — never key material.
//
// Encodes two paid-for lessons:
//   1. VITE/server parity — a function verifying tokens against a different
//      project than the client minted them on fails as "Not signed in".
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

// VITE-first: the client mints the tokens, so verify against the same vars it bundles.
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
    service_key_role: jwtRole(SERVICE), // MUST be 'service_role'
    service_slot_holds_anon_key: jwtRole(SERVICE) === 'anon', // the silent killer
    anthropic_key_present: !!process.env.ANTHROPIC_API_KEY,
    anthropic_key_shape_ok: (process.env.ANTHROPIC_API_KEY ?? '').startsWith('sk-ant-'),
    anon_key_works: null as unknown,
    service_key_works: null as unknown,
  };

  if (SUPA_URL && SUPA_ANON) {
    try {
      const anon = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
      const { error } = await anon.auth.getUser('not-a-real-token');
      out.anon_key_works = error
        ? /jwt|token|invalid|malformed/i.test(error.message)
          ? true
          : `error: ${error.message}`
        : true;
    } catch (e) {
      out.anon_key_works = `threw: ${String((e as Error).message ?? e).slice(0, 140)}`;
    }
  }

  if (SUPA_URL && SERVICE) {
    try {
      const admin = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });
      const { error } = await admin.from('capabilities').select('id', { count: 'exact', head: true });
      out.service_key_works = error
        ? `error: ${error.message}`
        : out.service_slot_holds_anon_key
          ? 'reachable BUT role=anon — replace with the service_role key'
          : true;
    } catch (e) {
      out.service_key_works = `threw: ${String((e as Error).message ?? e).slice(0, 140)}`;
    }
  }

  out.conclusion = !SUPA_URL
    ? 'no Supabase URL resolved — set VITE_SUPABASE_URL'
    : out.service_slot_holds_anon_key
      ? 'SUPABASE_SERVICE_ROLE_KEY holds an ANON key — RLS will silently return empty'
      : out.urls_match === false
        ? 'VITE_SUPABASE_URL and SUPABASE_URL point at DIFFERENT projects'
        : 'env looks consistent';

  return new Response(JSON.stringify(out, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
