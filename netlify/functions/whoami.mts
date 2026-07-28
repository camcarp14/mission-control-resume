// whoami — walks the server auth chain with the caller's REAL token and names the
// broken step. Deployed alongside env-check on day one. Returns metadata only.
//
// Run from the signed-in app (F12 console); the no-token response includes the
// one-liner that fetches it with your session token attached.
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPA_ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const json = (body: unknown) =>
  new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

export default async (req: Request): Promise<Response> => {
  const out: Record<string, unknown> = { effective_url: SUPA_URL };

  const auth = req.headers.get('authorization') ?? '';
  out.step1_auth_header_present = auth.startsWith('Bearer ');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    return json({
      ...out,
      how_to_run:
        "F12 console on the signed-in app: fetch('/api/whoami',{headers:{Authorization:'Bearer '+JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.includes('auth-token')))).access_token}}).then(r=>r.json()).then(console.log)",
    });
  }

  try {
    const seg = token.split('.')[1];
    const p = JSON.parse(Buffer.from(seg ?? '', 'base64url').toString('utf8'));
    out.token_issuer = p.iss ?? null;
    out.token_subject = p.sub ?? null;
    out.token_role = p.role ?? null;
    out.token_expired = p.exp ? p.exp * 1000 < Date.now() : null;
    // The Contradiction Rule in miniature: verify context by identifier, not by name.
    out.issuer_matches_effective_url = p.iss
      ? String(p.iss).startsWith(String(SUPA_URL))
      : null;
  } catch {
    out.token_decode = 'failed — not a JWT?';
  }

  if (!SUPA_URL || !SUPA_ANON) {
    return json({ ...out, conclusion: 'server is missing Supabase env vars — see /api/env-check' });
  }

  const anon = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.getUser(token);
  out.step2_getUser_ok = !error && !!data?.user;
  if (error) out.step2_getUser_error = error.message;

  if (data?.user) {
    out.user_id = data.user.id;
    out.user_email = data.user.email;

    // Read as the USER (RLS active), not as service_role — this is the step that
    // proves the policies actually let the owner see their own rows.
    const asUser = createClient(SUPA_URL, SUPA_ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { count, error: cErr } = await asUser
      .from('capabilities')
      .select('id', { count: 'exact', head: true });
    out.step3_own_rows_visible = cErr ? false : (count ?? 0) >= 0;
    out.step3_capability_count = count ?? null;
    if (cErr) out.step3_error = cErr.message;
  }

  out.conclusion = !out.step1_auth_header_present
    ? 'no Authorization header reached the function'
    : !out.step2_getUser_ok
      ? 'token rejected — check step2 error + issuer vs effective_url (wrong project or stale anon key)'
      : out.step3_own_rows_visible === false
        ? 'authenticated but RLS denies own rows — check owner_id backfill and policy'
        : 'everything passes';

  return json(out);
};
