import { useState } from 'react';
import { ENV_PRESENT, OFFLINE_DEV } from '../lib/supabase';
import { prefetchSupabase, redeem, type GateFields } from '../lib/gate';
import { ErrorState } from '../ui/primitives';

/**
 * The splash. An invitation, not a wall: three short fields, a code, and two
 * permanent exits (the PDF, and the promise of a no-email policy). The
 * Supabase chunk warms in the background while the visitor types; the flight
 * chunk stays untouched until the code clears — that ordering is part of the
 * gate's security story, not an optimization.
 */

type Status = 'idle' | 'checking' | 'invalid_code' | 'rate_limited' | 'unreachable';

const field =
  'w-full rounded border border-rule bg-panel px-3 py-2.5 text-base text-ink ' +
  'placeholder:text-faint transition-colors focus:border-rule-strong focus:outline-none';

function Label({ children, htmlFor }: { children: string; htmlFor: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-2xs uppercase tracking-widest text-faint"
    >
      {children}
    </label>
  );
}

export function Gate({ onUnlocked }: { onUnlocked: () => void }) {
  const [f, setF] = useState<GateFields>({ name: '', company: '', role: '', email: '', code: '' });
  const [status, setStatus] = useState<Status>('idle');

  const set = (k: keyof GateFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (status === 'checking') return;
    setStatus('checking');
    const res = await redeem({ ...f, code: f.code.trim() });
    if (res.ok) onUnlocked();
    else setStatus(res.reason);
  };

  // A production build with no Supabase env fails CLOSED: a configuration
  // error for the owner, never an open gate for the visitor.
  if (!ENV_PRESENT && !OFFLINE_DEV) {
    return (
      <Splash>
        <div className="mt-8">
          <ErrorState
            message="Mission Control is not configured — VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing from this deploy. The gate stays shut until they exist. See /api/env-check for the server's view."
            onRetry={() => window.location.reload()}
          />
        </div>
        <PaperRow />
      </Splash>
    );
  }

  return (
    <Splash>
      {OFFLINE_DEV && (
        <p className="mt-4 inline-block border border-rule-strong px-2.5 py-1 font-mono text-2xs uppercase tracking-widest text-dim">
          Offline preview — no Supabase configured; any code opens, nothing is logged
        </p>
      )}

      <form className="stagger mt-8" onSubmit={submit} noValidate={OFFLINE_DEV}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="g-name">Name</Label>
            <input
              id="g-name"
              className={field}
              autoComplete="name"
              required
              value={f.name}
              onChange={set('name')}
              onFocus={prefetchSupabase}
            />
          </div>
          <div>
            <Label htmlFor="g-company">Company</Label>
            <input
              id="g-company"
              className={field}
              autoComplete="organization"
              required
              value={f.company}
              onChange={set('company')}
            />
          </div>
          <div>
            <Label htmlFor="g-role">Role</Label>
            <input
              id="g-role"
              className={field}
              placeholder="Recruiter · Hiring manager · Panelist"
              value={f.role}
              onChange={set('role')}
            />
          </div>
          <div>
            <Label htmlFor="g-email">Email — optional</Label>
            <input
              id="g-email"
              className={field}
              type="email"
              autoComplete="email"
              placeholder="Only if you'd like a reply"
              value={f.email}
              onChange={set('email')}
            />
          </div>
        </div>

        <div className="mt-4">
          <Label htmlFor="g-code">Access code</Label>
          <input
            id="g-code"
            className={`${field} font-mono uppercase tracking-widest`}
            required
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="COMPANY-XXXX"
            value={f.code}
            onChange={set('code')}
            aria-describedby={status === 'invalid_code' || status === 'rate_limited' ? 'g-code-err' : undefined}
          />
          {status === 'invalid_code' && (
            <p id="g-code-err" className="mt-2 text-xs leading-relaxed text-accent">
              That code isn't recognized. Codes are case-insensitive — check for a typo, or ask
              your contact for a fresh one. The PDF below needs no code at all.
            </p>
          )}
          {status === 'rate_limited' && (
            <p id="g-code-err" className="mt-2 text-xs leading-relaxed text-accent">
              Too many attempts from this network in the last minute. Give it sixty seconds and
              try again — or take the PDF below.
            </p>
          )}
        </div>

        {status === 'unreachable' ? (
          <div className="mt-5">
            <ErrorState
              message="The gate can't reach its logbook right now — that's this site's problem, not your code. Retry in a moment, or grab the PDF below and carry on."
              onRetry={() => void submit()}
            />
          </div>
        ) : (
          <button
            type="submit"
            className="btn primary mt-5 w-full border border-rule-strong bg-raised px-4 py-3 text-sm font-medium text-ink disabled:opacity-60"
            disabled={status === 'checking'}
          >
            {status === 'checking' ? 'Verifying code…' : 'Begin the flight →'}
          </button>
        )}
      </form>

      <PaperRow />
    </Splash>
  );
}

function Splash({ children }: { children: React.ReactNode }) {
  // No pagefade on the wrapper: this header is ALREADY on screen — index.html
  // pre-renders the identical markup so first paint never waits for JS (and
  // never fades from opacity 0, which suppresses FCP entirely). Only the form
  // below staggers in.
  return (
    <main className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="w-full max-w-lg">
        <p className="font-mono text-2xs uppercase tracking-widest text-faint">Mission Control</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink md:text-3xl">
          A résumé you pilot.
        </h1>
        {/* Count-free on purpose: stations.js owns how many stations exist,
            and this copy must match index.html's pre-render byte for byte. */}
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-dim">
          One rocket, a flight path of real career artifacts: the work behind an adtech
          Solutions Consultant, flown deliberately rather than scrolled. Enter your access
          code to lift off — about four minutes end to end. In a hurry? The PDF is right
          below, no code needed.
        </p>
        {children}
      </div>
    </main>
  );
}

function PaperRow() {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
      <a
        className="btn border border-rule bg-panel px-3.5 py-2 text-xs text-ink"
        href="/resume.pdf"
        download
      >
        Download résumé PDF
      </a>
      <span className="text-2xs text-faint">No email required. Ever.</span>
    </div>
  );
}
