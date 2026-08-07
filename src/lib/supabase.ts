import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase is loaded LAZILY and is deliberately not in the critical path.
 *
 * Measured: @supabase/supabase-js is ~57 kB gzipped — more than the entire
 * gate screen. On throttled 4G, shipping it in the first chunk costs the
 * better part of a second before anything is interactive, which alone
 * threatens the 1.5s first-paint bar. Nothing on first paint needs it: the
 * gate renders instantly, and the SDK arrives in the background while the
 * visitor is typing their name (see the idle prefetch in the gate).
 *
 * Consequence for callers: there is no eagerly-exported `supabase` singleton.
 * Use `await getSupabase()`.
 */

class MissingEnvError extends Error {
  override name = 'MissingEnvError';
  constructor(missing: string[]) {
    super(
      `Mission Control is misconfigured. Missing environment variable(s): ${missing.join(', ')}. ` +
        `This is a deployment problem, not an access-code problem. ` +
        `Check /api/env-check for the server's view of the same config.`,
    );
  }
}

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when no Supabase env is configured AND this is a dev build. The gate
 *  uses this for "offline preview" mode. Production with missing env is NOT
 *  offline mode — assertEnv() throws loudly and the gate fails closed. */
export const OFFLINE_DEV = import.meta.env.DEV && (!SUPABASE_URL || !SUPABASE_ANON);

/** Both client-side vars present. When false outside dev, the gate renders a
 *  configuration error and stays shut — never an open door. */
export const ENV_PRESENT = !!(SUPABASE_URL && SUPABASE_ANON);

/** Loud env guard. A helper that returns null here makes a *deployment* fault
 *  masquerade as "bad access code" for every visitor — which sends you
 *  debugging the gate for hours when the real fault is a typo in an env var. */
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
    // No Supabase Auth in this app — visitors are anonymous rows in `visits`,
    // authenticated by a server-minted token, so session persistence is off.
    createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  );
  return clientPromise;
}
