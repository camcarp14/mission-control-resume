import { getSupabase, OFFLINE_DEV } from './supabase';

/**
 * Client side of the gate. The server (SECURITY DEFINER RPCs behind deny-all
 * RLS) is the only authority: sessionStorage holds a server-minted token that
 * is re-validated on every cold load, so a forged devtools entry buys a
 * re-gate, not a resume. This module also discriminates the two failure
 * worlds the UI must never conflate — "your code is wrong" (visitor's
 * problem, inline hint) vs "Supabase is unreachable" (my problem, Retry +
 * PDF escape hatch).
 */

const KEY = 'mc.visit';

export type GateFields = {
  name: string;
  company: string;
  role: string;
  email: string;
  code: string;
};

export type RedeemResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_code' | 'rate_limited' | 'unreachable' };

export type Restore =
  | { state: 'none' }
  | { state: 'invalid' }
  | { state: 'unreachable' }
  | { state: 'valid'; furthest: number };

type Stored = { visitId: string; token: string; offline?: boolean };

function stored(): Stored | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    return v && typeof v.visitId === 'string' && typeof v.token === 'string' ? v : null;
  } catch {
    return null;
  }
}

function store(v: Stored): void {
  sessionStorage.setItem(KEY, JSON.stringify(v));
}

export function clearVisit(): void {
  sessionStorage.removeItem(KEY);
}

// Redeeming in this page session IS the validation — skip the extra RPC that
// a cold reload needs.
let validatedThisSession = false;

/** Warm the lazy Supabase chunk while the visitor types. Deliberately NOT the
 *  flight/content chunk — that stays unfetched until a code is redeemed. */
export function prefetchSupabase(): void {
  if (OFFLINE_DEV) return;
  const warm = () => void getSupabase().catch(() => {});
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm);
  else setTimeout(warm, 300);
}

export async function redeem(f: GateFields): Promise<RedeemResult> {
  if (OFFLINE_DEV) {
    store({ visitId: 'offline-preview', token: 'offline', offline: true });
    validatedThisSession = true;
    return { ok: true };
  }
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.rpc('redeem_access_code', {
      p_code: f.code,
      p_name: f.name,
      p_company: f.company,
      p_role: f.role,
      p_email: f.email || null,
      p_user_agent: navigator.userAgent,
    });
    if (error) return { ok: false, reason: 'unreachable' };
    const d = data as { ok: boolean; reason?: string; visit_id?: string; token?: string };
    if (!d?.ok || !d.visit_id || !d.token) {
      return { ok: false, reason: d?.reason === 'rate_limited' ? 'rate_limited' : 'invalid_code' };
    }
    store({ visitId: d.visit_id, token: d.token });
    validatedThisSession = true;
    return { ok: true };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

/** Cold-load resume: no stored visit → gate; stored but server says no →
 *  re-gate (this is where forged state dies); server unreachable → Retry
 *  screen, never a silently open OR silently locked door. */
export async function restore(): Promise<Restore> {
  const v = stored();
  if (!v) return { state: 'none' };
  if (v.offline) {
    // An offline-preview unlock is only honoured where it was minted: dev.
    return OFFLINE_DEV ? { state: 'valid', furthest: 0 } : { state: 'invalid' };
  }
  if (validatedThisSession) return { state: 'valid', furthest: 0 };
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.rpc('validate_visit', {
      p_visit_id: v.visitId,
      p_token: v.token,
    });
    if (error) return { state: 'unreachable' };
    const d = data as { valid: boolean; furthest_station: number };
    if (!d?.valid) {
      clearVisit();
      return { state: 'invalid' };
    }
    validatedThisSession = true;
    return { state: 'valid', furthest: d.furthest_station ?? 0 };
  } catch {
    return { state: 'unreachable' };
  }
}

let logTimer: ReturnType<typeof setTimeout> | undefined;

/** Furthest-station beacon, debounced so a sprint through the rail logs once.
 *  The server's GREATEST() makes out-of-order arrivals harmless. */
export function logStation(index: number, stationCount: number): void {
  const v = stored();
  if (!v || v.offline) return;
  clearTimeout(logTimer);
  logTimer = setTimeout(async () => {
    try {
      const sb = await getSupabase();
      await sb.rpc('log_station', {
        p_visit_id: v.visitId,
        p_token: v.token,
        p_station: index,
        p_station_count: stationCount,
      });
    } catch {
      // A lost beacon is a lost data point, never a broken flight.
    }
  }, 800);
}
