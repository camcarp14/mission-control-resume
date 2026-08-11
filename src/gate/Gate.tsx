import { useState } from 'react';
import { ENV_PRESENT, OFFLINE_DEV } from '../lib/supabase';
import { prefetchSupabase, redeem, type GateFields } from '../lib/gate';
import { ErrorState, Expand } from '../ui/primitives';

/**
 * The splash. An invitation, not a wall: three short fields, a code, and three
 * permanent exits (the PDF, the promise of a no-email policy, and — for the
 * person who was forwarded this link with no code attached — an honest "no
 * code?" answer that is never a dead end). The Supabase chunk warms in the
 * background while the visitor types; the flight chunk stays untouched until
 * the code clears — that ordering is part of the gate's security story, not an
 * optimization.
 */

type Status = 'idle' | 'checking' | 'invalid_code' | 'rate_limited' | 'unreachable';

// ============================================================================
// TEMPORARY DEV BYPASS — kept on purpose, but no longer shown to strangers.
//
// It renders in `npm run dev`, and on the deployed site ONLY when the URL
// carries ?dev (…netlify.app/?dev, camcarp.com/?dev). That second trigger is
// the whole point: iteration happens on the real deploy, not on localhost, so
// gating this on import.meta.env.DEV alone would have deleted the affordance
// from the only place it was actually used. A recruiter arriving at the bare
// URL never sees it — which matters, because what they were seeing was the
// author's own un-actioned TODO in a dashed red box on the first screen.
//
// Still NOT a security bypass: it calls the real redeem_access_code RPC with
// the seeded demo code, so RLS, rate-limiting and logging all still apply. The
// code string is compiled into the JS either way; hiding the button is about
// what the first screen SAYS, and the server is what keeps the door shut.
// Delete the flag, the handler and the <button> together when you're done.
// Search "TEMPORARY DEV BYPASS" to find every piece.
const DEV_BYPASS_CODE = 'DEMO-K7M3';
// Read once at module scope, not per render: the query string cannot change
// without a navigation, and the window guard keeps this import-safe for any
// non-browser evaluation (tests, a future prerender pass).
const DEV_QUICK_START =
  import.meta.env.DEV ||
  (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev'));
// ============================================================================

/**
 * The one thing this file still needs from a human: a real address to send
 * someone who wants their own code. stations.js is still carrying a
 * `mailto:you@example.com` placeholder, and a fake contact link on the first
 * screen is worse than none — it turns "ask me" into a bounced email. So the
 * affordance is built and wired below, and stays hidden until this constant
 * is a real mailto:/LinkedIn URL. One line to go live.
 */
const CONTACT_HREF: string | null = null;

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

  // TEMPORARY DEV BYPASS — see the block near Status above. Builds the fields
  // inline (not via setF + submit) so it doesn't race React's async state
  // batching; still goes through the exact same redeem() call as the form.
  const devQuickStart = async () => {
    if (status === 'checking') return;
    const devFields: GateFields = {
      name: 'Dev Preview',
      company: 'Internal',
      role: 'Builder',
      email: '',
      code: DEV_BYPASS_CODE,
    };
    setF(devFields);
    setStatus('checking');
    const res = await redeem(devFields);
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
              // Two examples, not three: "Recruiter · Hiring manager · Panelist"
              // measured ~234px against ~224px of usable field on the desktop
              // two-column layout and clipped mid-word on "Panelist". Two
              // examples set the pattern and clear every width tested (390,
              // 1440, 2560) with room to spare.
              placeholder="Recruiter · Hiring manager"
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

        {/* TEMPORARY DEV BYPASS — dev server, or ?dev on the deploy. Dashed
            border + accent colour on purpose: it should look unmistakably
            temporary to the only person who can now see it. */}
        {DEV_QUICK_START && (
          <button
            type="button"
            onClick={devQuickStart}
            disabled={status === 'checking'}
            className="btn mt-3 w-full border border-dashed border-accent/50 bg-accent-dim px-4 py-2.5 text-xs text-accent disabled:opacity-60"
          >
            ⚡ Dev quick start — skip typing (?dev only)
          </button>
        )}
      </form>

      <NoCode />
      <PaperRow />
    </Splash>
  );
}

/**
 * The third exit, and the finding it answers: someone forwarded this link, or
 * found it on LinkedIn, and has no code. Until now the gate's only replies
 * were "ask your contact" (buried inside an error that only appears after a
 * wrong code) and the PDF — so the most valuable visitor in the funnel hit a
 * door with no handle.
 *
 * Collapsed by default because it must not compete with the form for the
 * people who DO have a code; a real disclosure (aria-expanded/aria-controls,
 * children unmounted while closed so nothing focusable hides inside) rather
 * than a hover-reveal, because this is the one control on the screen a
 * confused visitor is most likely to reach for with a keyboard.
 */
function NoCode() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-5">
      <button
        type="button"
        className="btn rounded border border-rule bg-panel px-3 py-2 text-xs text-dim"
        aria-expanded={open}
        aria-controls="g-nocode"
        onClick={() => setOpen((v) => !v)}
      >
        Don&rsquo;t have a code? {open ? '↑' : '↓'}
      </button>
      <div id="g-nocode">
        <Expand open={open}>
          <div className="mt-3 border-l border-rule pl-4">
            <p className="max-w-prose text-xs leading-relaxed text-dim">
              Codes are issued per company, not per person — if a colleague forwarded you this
              link, the code they were sent opens it for you too. Ask them for it.
            </p>
            <p className="mt-2 max-w-prose text-xs leading-relaxed text-dim">
              Or skip the door entirely: the{' '}
              <a
                className="text-ink underline decoration-rule-strong underline-offset-4"
                href="/resume.pdf"
                download="Cameron-Carpenter-Resume.pdf"
              >
                résumé PDF
              </a>{' '}
              is the same career on paper, it has never needed a code, and it is the whole thing —
              not a teaser for the flight.
            </p>
            {CONTACT_HREF && (
              <p className="mt-2 max-w-prose text-xs leading-relaxed text-dim">
                Found this on your own?{' '}
                <a
                  className="text-ink underline decoration-rule-strong underline-offset-4"
                  href={CONTACT_HREF}
                >
                  Ask me for a code
                </a>{' '}
                — one line is plenty, and you&rsquo;ll have it the same day.
              </p>
            )}
          </div>
        </Expand>
      </div>
    </div>
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
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink md:text-3xl">
          A résumé you pilot.
        </h1>
        {/* Count-free on purpose: stations.js owns how many stations exist,
            and this copy must match index.html's pre-render byte for byte. */}
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-dim">
          One rocket, a flight path of real career artifacts: three years of search,
          measurement, and the systems behind them — flown deliberately, never scrolled. Enter your access
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
        download="Cameron-Carpenter-Resume.pdf"
      >
        Download résumé PDF
      </a>
      <span className="text-2xs text-faint">No email required. Ever.</span>
    </div>
  );
}
