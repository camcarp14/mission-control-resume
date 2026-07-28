import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { getSupabase, peekCachedSession } from './supabase';

/**
 * Auth resolves in two stages so the first frame never blocks on the 57 kB SDK:
 *
 *   1. Synchronously peek at the cached token in localStorage. That decides
 *      shell-vs-signin immediately — a signed-out visitor sees the sign-in form
 *      with zero SDK bytes downloaded, and a signed-in one sees the real shell
 *      with skeletons where data will land.
 *   2. Load the SDK in the background, verify for real, and correct if the
 *      cached hint was wrong (expired, revoked, signed out elsewhere).
 *
 * The stage-1 peek is a RENDERING hint, never an authorization decision. Every
 * actual read is still gated by the token and by RLS server-side, so a forged
 * localStorage entry buys nothing but an empty shell.
 */

type AuthStatus = 'authed' | 'anon';

type AuthState = {
  status: AuthStatus;
  /** True until the SDK has confirmed stage 1. Data fetches should wait. */
  verifying: boolean;
  session: Session | null;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<AuthState>({
  status: 'anon',
  verifying: true,
  session: null,
  signOut: async () => {},
});

function initialStatus(): AuthStatus {
  const cached = peekCachedSession();
  return cached && !cached.expired ? 'authed' : 'anon';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(initialStatus);
  const [verifying, setVerifying] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [client, setClient] = useState<SupabaseClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;

    getSupabase()
      .then(async (sb) => {
        if (cancelled) return;
        setClient(sb);

        const { data } = await sb.auth.getSession();
        if (cancelled) return;
        setSession(data.session);
        setStatus(data.session ? 'authed' : 'anon');
        setVerifying(false);

        const { data: sub } = sb.auth.onAuthStateChange((_evt, s) => {
          setSession(s);
          setStatus(s ? 'authed' : 'anon');
        });
        unsub = () => sub.subscription.unsubscribe();
      })
      .catch(() => {
        if (cancelled) return;
        // Env guard threw, or the chunk failed to load. Fail closed.
        setStatus('anon');
        setVerifying(false);
      });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  const signOut = async () => {
    const sb = client ?? (await getSupabase());
    await sb.auth.signOut();
    setStatus('anon');
    setSession(null);
  };

  return (
    <AuthCtx.Provider value={{ status, verifying, session, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
