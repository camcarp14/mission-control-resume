import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase is loaded LAZILY and is deliberately not in the critical path.
 *
 * Measured: @supabase/supabase-js is 57 kB gzipped — roughly half the app's
 * total JS weight. On throttled 3G (~400 kbps, 400 ms RTT) shipping it in the
 * first chunk costs well over a second before anything is interactive, which
 * alone makes the 1.5s bar unreachable. Nothing on first paint needs it: the
 * shell renders from a synchronous localStorage peek at the cached session, and
 * the SDK arrives in the background to do the actual data work.
 *
 * Consequence for callers: there is no eagerly-exported `supabase` singleton.
 * Use `await getSupabase()`.
 */

class MissingEnvError extends Error {
  override name = 'MissingEnvError';
  constructor(missing: string[]) {
    super(
      `BUILDOUT is misconfigured. Missing environment variable(s): ${missing.join(', ')}. ` +
        `This is a deployment problem, not a sign-in problem. ` +
        `Check /api/env-check for the server's view of the same config.`,
    );
  }
}

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Loud env guard. A helper that returns null here makes a *deployment* fault
 *  masquerade as "Not signed in" for every user — which sends you debugging
 *  auth for hours when the real fault is a typo in an env var. */
export function assertEnv(): { url: string; anon: string } {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push('VITE_SUPABASE_URL');
  if (!SUPABASE_ANON) missing.push('VITE_SUPABASE_ANON_KEY');
  if (missing.length) throw new MissingEnvError(missing);
  return { url: SUPABASE_URL as string, anon: SUPABASE_ANON as string };
}

let clientPromise: Promise<SupabaseClient> | null = null;

export function getSupabase(): Promise<SupabaseClient> {
  const { url, anon } = assertEnv();
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }),
  );
  return clientPromise;
}

/**
 * Synchronous, zero-dependency peek at the cached session so the shell can
 * decide signed-in vs signed-out on the very first frame, before the SDK has
 * downloaded. Returns null when there is no usable cached token.
 *
 * This is a rendering hint only — never an authorization decision. The token is
 * still verified by Supabase (and by RLS) on every actual request.
 */
export function peekCachedSession(): { token: string; expired: boolean } | null {
  try {
    const key = Object.keys(localStorage).find(
      (k) => k.startsWith('sb-') && k.includes('auth-token'),
    );
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const token: string | undefined = parsed?.access_token ?? parsed?.currentSession?.access_token;
    if (!token) return null;

    const seg = token.split('.')[1];
    if (!seg) return null;
    const payload = JSON.parse(atob(seg.replace(/-/g, '+').replace(/_/g, '/')));
    const expired = typeof payload.exp === 'number' ? payload.exp * 1000 < Date.now() : false;
    return { token, expired };
  } catch {
    return null;
  }
}

/** Attach the caller's session token to a Netlify function request. */
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const sb = await getSupabase();
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
