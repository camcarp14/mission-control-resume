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
};

export type RedeemResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited' | 'unreachable' };

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

/** Warm the lazy Supabase chunk. Called by lib/warm.ts as the first of its
 *  three waves — it is what `begin_visit` blocks on, so it goes first.
 *
 *  getSupabase() asserts its env SYNCHRONOUSLY and throws MissingEnvError on a
 *  misconfigured deploy, which is deliberate everywhere else (a deployment
 *  fault must not masquerade as a visitor's problem) and wrong here: the throw
 *  would land in the caller's idle callback, where nobody is listening and no
 *  visitor is helped. A warm-up that fails is a warm-up that did not happen. */
export function prefetchSupabase(): void {
  if (OFFLINE_DEV) return;
  try {
    void getSupabase().catch(() => {});
  } catch {
    /* misconfigured deploy — the gate's own config-error screen says so */
  }
}

// beginVisit replaces redeem_access_code: no code, no gate — just a name and
// company (both may be blank) logged the same way, minting the same bearer
// token. The only failure the visitor can hit now is rate_limited (bot flood)
// or unreachable (my Supabase is down); "wrong code" no longer exists.
export async function beginVisit(f: GateFields): Promise<RedeemResult> {
  if (OFFLINE_DEV) {
    store({ visitId: 'offline-preview', token: 'offline', offline: true });
    validatedThisSession = true;
    return { ok: true };
  }
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.rpc('begin_visit', {
      p_name: f.name,
      p_company: f.company,
      p_user_agent: navigator.userAgent,
    });
    if (error) return { ok: false, reason: 'unreachable' };
    const d = data as { ok: boolean; reason?: string; visit_id?: string; token?: string };
    if (!d?.ok || !d.visit_id || !d.token) {
      return { ok: false, reason: d?.reason === 'rate_limited' ? 'rate_limited' : 'unreachable' };
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
/** The arrival the debounce is currently sitting on, so a page that is about
 *  to disappear can send it instead of dropping it. */
let pending: { index: number; count: number } | null = null;
let flushBound = false;

function send(index: number, stationCount: number): void {
  const v = stored();
  if (!v || v.offline) return;
  pending = null;
  void (async () => {
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
  })();
}

/* ---- the last station is the one that matters ----------------------------
 * The 800ms debounce is right — a sprint down the rail should log once, not
 * eleven times — but a debounce that only ever fires on a timer loses
 * whichever arrival the visitor was on when they left, and the arrival they
 * were on when they left is precisely the number the logbook exists to
 * report. Someone who watches the six-second homecoming and then closes the
 * tab was recorded as never having reached it.
 *
 * So the pending arrival is flushed when the page goes away. `visibilitychange
 * → hidden` is the one that actually fires on the paths that matter (a mobile
 * app-switch, a tab close, a navigation) and is the only lifecycle event iOS
 * Safari reliably delivers at all; `pagehide` covers the desktop bfcache
 * route. Both are additive to the timer, not a replacement for it, and the
 * server's GREATEST() makes a duplicate arriving either side of the flush
 * harmless — which is what makes belt-and-braces the cheap option here.
 *
 * Registered once, lazily, from the first arrival: the gate screen has no
 * stations to log and should not carry two document listeners for the
 * possibility. */
function bindFlush(): void {
  if (flushBound || typeof document === 'undefined') return;
  flushBound = true;
  const flush = () => {
    if (!pending) return;
    clearTimeout(logTimer);
    send(pending.index, pending.count);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}

/** Furthest-station beacon, debounced so a sprint through the rail logs once.
 *  The server's GREATEST() makes out-of-order arrivals harmless. */
export function logStation(index: number, stationCount: number): void {
  const v = stored();
  if (!v || v.offline) return;
  bindFlush();
  pending = { index, count: stationCount };
  clearTimeout(logTimer);
  logTimer = setTimeout(() => send(index, stationCount), 800);
}
