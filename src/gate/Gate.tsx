import { useState } from 'react';
import { ENV_PRESENT, OFFLINE_DEV } from '../lib/supabase';
import { prefetchSupabase, beginVisit, type GateFields } from '../lib/gate';
import { ErrorState } from '../ui/primitives';

/**
 * The splash — and as of round 23 it is a sign-in, not a gate. Two optional
 * fields (name, company) and one button that always opens: there is no access
 * code, nothing is required, and "Begin the flight" works with the form left
 * blank. The name/company still ride to the logbook so the owner can see who
 * came, but they are a courtesy the visitor may decline, not a toll. The PDF
 * remains a first-class second exit. The Supabase chunk warms while the
 * visitor reads; the flight chunk stays unfetched until they press the
 * button — the same lazy-load ordering, now an optimization rather than a
 * lock.
 */

type Status = 'idle' | 'checking' | 'rate_limited' | 'unreachable';

// `focus:outline-none` used to live at the end of this string, leaving keyboard
// users with a 1px border shift as their only focus feedback on the one form
// every visitor has to fill in. axe never flagged it (the contrast change
// technically exists), which is exactly why it survived. The real indicator is
// in GATE_CSS below, shaped like the systemized :focus-visible rule in
// polish.css — same 2px, same 2px offset — only brighter, because this form is
// the site's front door.
const field =
  'gate-field w-full rounded border border-rule bg-panel px-3 py-2.5 text-base text-ink ' +
  'placeholder:text-faint transition-colors focus:border-rule-strong';

/**
 * The gate's backdrop, and the reason it is CSS instead of anything else.
 *
 * The entry chunk is deliberately Framer-free, Supabase-free and three.js-free,
 * and the headline is pre-rendered in index.html so first paint never waits for
 * JS (FCP 1222ms, Lighthouse 100). Any hint of what's behind the door therefore
 * has to cost approximately nothing: no image, no font, no dependency, no
 * request, and nothing layered over the headline that could delay or fade it.
 * Four painted layers on one fixed, pointer-events-none element is what's left
 * — a masked hairline grid, a few stars, two horizon arcs and a slow glow off
 * the pad. It should read as an instrument at rest, not as a landing page.
 *
 * Co-located here rather than in ui/polish.css because it is the only surface
 * in the product that uses it, and the gate is the one screen whose bytes are
 * counted.
 */
const GATE_CSS = `
.gate-sky { position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.gate-sky > div { position: absolute; inset: 0; }

/* Telemetry grid, masked to a pool around the bottom centre so it reads as a
   ground plane under the form rather than graph paper behind it. */
.gate-grid {
  background-image:
    linear-gradient(to right, rgba(255,255,255,0.032) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,0.032) 1px, transparent 1px);
  background-size: 76px 76px;
  -webkit-mask-image: radial-gradient(112% 80% at 50% 106%, #000 6%, rgba(0,0,0,0.4) 44%, transparent 76%);
  mask-image: radial-gradient(112% 80% at 50% 106%, #000 6%, rgba(0,0,0,0.4) 44%, transparent 76%);
}

/* Stars: 24 box-shadows on a single 1px node, offset in vw/vh so the field
   re-lays itself at every viewport instead of clumping in one corner. Placed
   from a jittered grid, not random — random reads as noise, jittered reads as
   sky. No twinkle: a blinking field on the first screen is decoration. */
.gate-stars {
  inset: auto auto auto 0; top: 0; width: 1px; height: 1px; border-radius: 50%;
  box-shadow:
    30.2vw 12.2vh 0 0 rgba(232,246,255,0.28),
    45.5vw 10.3vh 0 0 rgba(232,246,255,0.18),
    55.3vw 3.0vh 0 0 rgba(232,246,255,0.31),
    92.0vw 4.6vh 0 0 rgba(232,246,255,0.24),
    4.9vw 22.0vh 0 0 rgba(232,246,255,0.28),
    20.7vw 28.2vh 0 0 rgba(232,246,255,0.42),
    41.1vw 24.0vh 0 0 rgba(232,246,255,0.49),
    77.5vw 30.6vh 0 0 rgba(232,246,255,0.38),
    90.1vw 20.5vh 0 0 rgba(232,246,255,0.29),
    6.6vw 38.7vh 0 0 rgba(232,246,255,0.29),
    26.4vw 40.7vh 0 0 rgba(232,246,255,0.22),
    44.2vw 40.3vh 0 0 rgba(232,246,255,0.28),
    53.9vw 44.6vh 0 0 rgba(232,246,255,0.42),
    96.7vw 40.6vh 0 0 rgba(232,246,255,0.27),
    21.2vw 58.2vh 0 0 rgba(232,246,255,0.49),
    44.7vw 53.6vh 0 0 rgba(232,246,255,0.20),
    53.6vw 63.6vh 0 0 rgba(232,246,255,0.42),
    80.6vw 64.1vh 0 0 rgba(232,246,255,0.34),
    85.9vw 64.6vh 0 0 rgba(232,246,255,0.24),
    4.4vw 73.6vh 0 0 rgba(232,246,255,0.20),
    22.3vw 72.0vh 0 0 rgba(232,246,255,0.34),
    46.6vw 74.5vh 0 0 rgba(232,246,255,0.34),
    60.5vw 78.0vh 0 0 rgba(232,246,255,0.50),
    72.4vw 77.2vh 0 0 rgba(232,246,255,0.43);
}

/* Two elliptical hairlines, centred well below the viewport: the near one
   grazes the bottom at ~91% height (a planet limb you're standing on), the far
   one crosses at ~66% (an orbit you haven't flown yet). Drawn as gradient
   stops rather than a giant bordered circle so the geometry stays
   viewport-relative and can never introduce a scrollbar.
   The stop pairs are deliberately ~0.4% and ~0.27% of each ellipse's vertical
   radius — about 2px of line. The first pass used 2.6% and 1.4%, which
   rendered as 15px of soft haze: it read as weather, not as an instrument, and
   the whole point of this backdrop is that it looks drawn rather than smeared.
   The form's inputs and buttons are opaque, so the arcs pass BEHIND them and
   only show in the gaps — which is why crossing the CTA is fine. */
.gate-limb {
  background:
    radial-gradient(140% 62% at 50% 133%, transparent 67.75%, rgba(154,220,255,0.34) 67.88%, rgba(154,220,255,0.34) 68.02%, transparent 68.15%),
    radial-gradient(155% 150% at 50% 190%, transparent 82.57%, rgba(154,220,255,0.13) 82.66%, rgba(154,220,255,0.13) 82.75%, transparent 82.84%);
}

/* Below Tailwind's sm hinge the field grid collapses to one column and the
   form fills the viewport top to bottom, so there is no clear band left for
   the far orbit — at 390x844 it cut straight through the ACCESS CODE label and
   read as clutter rather than depth. Narrow viewports keep one arc, pushed
   down to graze the bottom edge behind the paper row. */
@media (max-width: 640px) {
  .gate-limb {
    background:
      radial-gradient(150% 60% at 50% 140%, transparent 70.66%, rgba(154,220,255,0.30) 70.75%, rgba(154,220,255,0.30) 70.91%, transparent 71%);
  }
}

/* The pad: cold instrument light off the limb with one ember of the rocket
   accent inside it. The only moving thing on the screen, and it moves on a
   24s cycle — slow enough that you notice it the second time you look, which
   is the entire brief. Opacity only, one composited layer, no reflow. */
.gate-glow {
  background:
    radial-gradient(52% 34% at 50% 100%, rgba(76,201,240,0.13), rgba(76,201,240,0.035) 46%, transparent 72%),
    radial-gradient(26% 17% at 50% 103%, rgba(255,92,55,0.10), transparent 70%);
  animation: gate-breathe 24s ease-in-out infinite;
}
@keyframes gate-breathe { 0%, 100% { opacity: 0.58; } 50% { opacity: 1; } }

/* The focus indicator the entry form was missing. Same geometry as the
   systemized :focus-visible in polish.css (2px, 2px offset) so nothing about
   focus looks bespoke here — ink instead of dim only because this is the front
   door. :focus-visible rather than :focus is deliberate even though it changes
   nothing for these five elements — per spec a text input matches
   :focus-visible however it was focused, mouse included, and a caret already
   tells that user where they are. The selector is chosen so the rule reads the
   same as every other focus rule in the product, and so it stays correct if a
   non-text control ever wears this class. */
.gate-field:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
  border-color: var(--rule-strong);
}

/* The mandate, same as polish.css's block: everything above is optional to the
   user's nervous system. The glow's resting opacity is 1 with the animation
   off, so killing it leaves the composition intact rather than blank. */
@media (prefers-reduced-motion: reduce) {
  .gate-glow { animation: none !important; }
}
`;

/** Rendered by every pre-flight screen (gate, restore skeleton, unreachable)
 *  so the backdrop is continuous across them and nothing pops in when the
 *  session check resolves. aria-hidden: it is scenery, and scenery that
 *  announces itself is a bug. */
export function GateSky() {
  return (
    <>
      <style>{GATE_CSS}</style>
      <div className="gate-sky" aria-hidden="true">
        <div className="gate-grid" />
        <div className="gate-stars" />
        <div className="gate-limb" />
        <div className="gate-glow" />
      </div>
    </>
  );
}

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
  const [f, setF] = useState<GateFields>({ name: '', company: '' });
  const [status, setStatus] = useState<Status>('idle');

  const set = (k: keyof GateFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (status === 'checking') return;
    setStatus('checking');
    const res = await beginVisit(f);
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

      <form className="stagger mt-8" onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="g-name">Name — optional</Label>
            <input
              id="g-name"
              className={field}
              autoComplete="name"
              placeholder="Your name"
              value={f.name}
              onChange={set('name')}
              onFocus={prefetchSupabase}
            />
          </div>
          <div>
            <Label htmlFor="g-company">Company — optional</Label>
            <input
              id="g-company"
              className={field}
              autoComplete="organization"
              placeholder="Your organization"
              value={f.company}
              onChange={set('company')}
              onFocus={prefetchSupabase}
            />
          </div>
        </div>

        {status === 'rate_limited' && (
          <p className="mt-4 text-xs leading-relaxed text-accent">
            Too many launches from this network in the last minute. Please wait about a minute and
            try again, or view the résumé PDF below.
          </p>
        )}

        {status === 'unreachable' ? (
          <div className="mt-5">
            <ErrorState
              message="The sign-in service is temporarily unreachable — an issue on this site, not on your end. Please retry in a moment, or view the résumé PDF below."
              onRetry={() => void submit()}
            />
          </div>
        ) : (
          <button
            type="submit"
            className="btn primary mt-5 w-full border border-rule-strong bg-raised px-4 py-3 text-sm font-medium text-ink disabled:opacity-60"
            disabled={status === 'checking'}
          >
            {status === 'checking' ? 'Preparing the flight…' : 'Begin the flight →'}
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
  // below staggers in. GateSky paints behind all of it and is deliberately
  // NOT part of that choreography — a backdrop that fades in is a backdrop the
  // pre-rendered headline had to wait for.
  return (
    <main className="grid min-h-dvh place-items-center px-5 py-12">
      <GateSky />
      <div className="relative z-10 w-full max-w-lg">
        <p className="font-mono text-2xs uppercase tracking-widest text-faint">Mission Control</p>
        {/* Name-led on purpose: this screen is Cameron Carpenter's, and the
            headline says so before it says what the thing is. Must match
            index.html's pre-render byte for byte so first paint is stable. */}
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink md:text-3xl">
          Cameron Carpenter.
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-dim">
          Revenue operations and performance marketing, presented as a résumé you pilot rather than
          scroll — one rocket and a flight path of real career artifacts, covered deliberately in
          about four minutes. The fields below are optional, and the résumé PDF is available if you
          are short on time.
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
        download="Cameron-Carpenter-Resume.pdf"
      >
        Download résumé PDF
      </a>
    </div>
  );
}
