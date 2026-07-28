import { useState } from 'react';
import { getSupabase } from '../lib/supabase';

/** Single-user app: magic-link only. No password to leak, no reset flow to build. */
export function SignIn() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    try {
      const sb = await getSupabase();
      const { error: err } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (err) throw err;
      setState('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-ground px-5">
      <div className="w-full max-w-[340px]">
        <div className="font-mono text-xs tracking-[0.24em] text-ink">BUILDOUT</div>
        <p className="mt-1.5 text-xs text-dim">Personal capacity planning.</p>

        {state === 'sent' ? (
          <div className="mt-6 border border-rule bg-panel p-4">
            <p className="text-sm text-ink">Link sent.</p>
            <p className="mt-1.5 text-xs text-dim">
              Check {email}. The link signs you in and returns you here.
            </p>
            <button
              className="btn mt-4 border border-rule-strong px-3 py-1.5 text-xs"
              onClick={() => setState('idle')}
            >
              Use a different address
            </button>
          </div>
        ) : (
          <form onSubmit={send} className="mt-6 space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-rule bg-panel px-3 py-2.5 text-sm text-ink placeholder:text-faint focus:border-rule-strong focus:outline-none"
            />
            <button
              type="submit"
              disabled={state === 'sending'}
              className="btn primary w-full border border-rule-strong bg-raised py-2.5 text-xs uppercase tracking-widest text-ink disabled:opacity-50"
            >
              {state === 'sending' ? 'Sending…' : 'Send sign-in link'}
            </button>
            {state === 'error' && (
              <div className="border border-accent/30 bg-accent-dim p-3">
                <p className="text-xs text-ink">{error}</p>
                <button
                  type="button"
                  className="btn mt-2 border border-rule-strong px-2.5 py-1 text-2xs"
                  onClick={() => setState('idle')}
                >
                  Retry
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
