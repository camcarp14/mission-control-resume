import { useState } from 'react';
import { ENV_PRESENT, OFFLINE_DEV } from '../lib/supabase';
import { prefetchSupabase, beginVisit } from '../lib/gate';
import { ErrorState } from '../ui/primitives';

/**
 * The Space Journey column of the home page (see home/Home.tsx). As of the
 * three-column home it asks for nothing: one button that always opens. The
 * visit is still logged (begin_visit with a blank name and company, which
 * the RPC has accepted since round 23), so the dashboard's funnel keeps
 * counting how far people fly — it just no longer knows who they are. The
 * PDF remains a first-class second exit. The Supabase chunk warms when the
 * pointer or focus reaches the button; the flight chunk stays unfetched
 * until it is pressed.
 */

type Status = 'idle' | 'checking' | 'rate_limited' | 'unreachable';

/**
 * The home page's sky — deep space, drawn entirely in CSS.
 *
 * It replaced a hairline grid and two horizon arcs that, behind three dark
 * boxes, read as bars on a window (owner: "it looks like a prison cell").
 * Now: two nebula glows, three star layers (small, medium, bright) placed by
 * a seeded generator so the field is identical on every visit, a slow
 * twinkle on the bright layer, a shooting star every few seconds, and a
 * planet's lit limb under the panels with its atmosphere glowing up into
 * the page.
 *
 * Cost discipline is unchanged from the gate it replaced: no image, no font,
 * no request, nothing over the pre-rendered headline. Stars are box-shadows
 * on three 1px nodes; everything that moves animates opacity or transform on
 * its own layer. Reduced motion stops all of it and leaves the composition.
 */
function starLayer(count: number, seed: number, alpha: [number, number], size = 0): string {
  // mulberry32 — tiny, seeded, good enough to scatter stars.
  let t = seed >>> 0;
  const rnd = () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = (rnd() * 100).toFixed(2);
    const y = (rnd() * 100).toFixed(2);
    const a = (alpha[0] + rnd() * (alpha[1] - alpha[0])).toFixed(2);
    const tint = rnd() < 0.18 ? '255,214,170' : rnd() < 0.3 ? '170,205,255' : '232,246,255';
    out.push(`${x}vw ${y}vh 0 ${size}px rgba(${tint},${a})`);
  }
  return out.join(',');
}

const GATE_CSS = `
.gate-sky {
  position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none;
  background:
    radial-gradient(55% 45% at 12% 8%, rgba(76,201,240,0.10), transparent 70%),
    radial-gradient(45% 40% at 88% 14%, rgba(150,120,255,0.10), transparent 72%),
    radial-gradient(60% 40% at 70% 60%, rgba(255,92,55,0.045), transparent 70%),
    #06070a;
}
.gate-sky > div { position: absolute; }

/* Three star layers on 1px nodes. Sizes come from the shadow spread. */
.gate-stars { left: 0; top: 0; width: 1px; height: 1px; border-radius: 50%; }
.gate-stars.s1 { box-shadow: ${starLayer(150, 7, [0.18, 0.5])}; }
.gate-stars.s2 { box-shadow: ${starLayer(55, 31, [0.35, 0.7], 0.6)}; }
.gate-stars.s3 { box-shadow: ${starLayer(16, 97, [0.6, 0.95], 1.2)}; animation: gate-twinkle 5.5s ease-in-out infinite; }
@keyframes gate-twinkle { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* Shooting stars: a thin bright streak that crosses and fades. Two, offset,
   on long cycles so the sky is mostly still and occasionally alive. */
.gate-meteor {
  width: 140px; height: 1px; opacity: 0;
  background: linear-gradient(90deg, rgba(255,255,255,0), rgba(220,240,255,0.9));
  transform: rotate(-18deg);
  animation: gate-meteor 9s ease-in infinite;
}
.gate-meteor.m1 { left: 62%; top: 12%; animation-delay: 2.5s; }
.gate-meteor.m2 { left: 18%; top: 26%; animation-delay: 7.2s; animation-duration: 13s; }
@keyframes gate-meteor {
  0% { opacity: 0; transform: rotate(-18deg) translateX(0); }
  2% { opacity: 1; }
  7% { opacity: 0; transform: rotate(-18deg) translateX(-320px); }
  100% { opacity: 0; transform: rotate(-18deg) translateX(-320px); }
}

/* The planet under the panels: a huge disc whose top edge is the lit limb,
   an atmosphere bloom above it, and the night side below. */
.gate-planet {
  left: 50%; bottom: -118vh; width: 240vw; height: 140vh; margin-left: -120vw;
  border-radius: 50%;
  background: radial-gradient(50% 50% at 50% 50%, #04060a 96%, rgba(4,6,10,0) 100%);
  box-shadow:
    0 -1px 0 0 rgba(154,220,255,0.55),
    0 -10px 40px -6px rgba(76,201,240,0.45),
    0 -40px 120px -20px rgba(76,201,240,0.25),
    inset 0 18px 60px -30px rgba(120,210,255,0.35);
}
.gate-glow {
  left: 0; right: 0; bottom: 0; height: 45vh;
  background: radial-gradient(60% 70% at 50% 100%, rgba(76,201,240,0.16), rgba(76,201,240,0.04) 50%, transparent 75%);
  animation: gate-breathe 18s ease-in-out infinite;
}
@keyframes gate-breathe { 0%, 100% { opacity: 0.65; } 50% { opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .gate-stars.s3, .gate-glow { animation: none !important; }
  .gate-meteor { display: none; }
}
`;

/** Rendered behind the home page (every state of it). aria-hidden: it is
 *  scenery, and scenery that announces itself is a bug. */
export function GateSky() {
  return (
    <>
      <style>{GATE_CSS}</style>
      <div className="gate-sky" aria-hidden="true">
        <div className="gate-stars s1" />
        <div className="gate-stars s2" />
        <div className="gate-stars s3" />
        <div className="gate-meteor m1" />
        <div className="gate-meteor m2" />
        <div className="gate-glow" />
        <div className="gate-planet" />
      </div>
    </>
  );
}

/** The Space Journey column's thumbnail and one line of pitch, shared by
 *  every state of it (button, restore skeleton, resume, unreachable) so the
 *  column never reflows while the session check resolves.
 *
 *  The thumbnail is a real frame of the flight — station 01, Earth with the
 *  route's planets lined up ahead — captured from the running app with the
 *  DOM chrome hidden. With `onLaunch` it is a pointer shortcut for the button
 *  below it (aria-hidden and out of the tab order: the button is the real
 *  control); without, it is just the picture. */
export function JourneyIntro({ onLaunch }: { onLaunch?: (() => void) | undefined }) {
  const img = (
    <img src="/journey-thumb.jpg" alt="" width={800} height={400} decoding="async" draggable={false} />
  );
  // The pitch rides on the picture's lower edge rather than under it: the
  // home page has to fit a laptop screen, and a separate paragraph cost the
  // panel ~70px. It stays a real <p>, so screen readers still get it.
  return (
    <div className="journey-hero">
      {onLaunch ? (
        <button type="button" className="journey-thumb" onClick={onLaunch} tabIndex={-1} aria-hidden="true">
          {img}
          <span className="journey-play">
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
            </svg>
          </span>
        </button>
      ) : (
        <div className="journey-thumb" aria-hidden="true">
          {img}
        </div>
      )}
      <p className="journey-intro">A flight through my career · about four minutes</p>
    </div>
  );
}

export function Gate({ onUnlocked }: { onUnlocked: () => void }) {
  const [status, setStatus] = useState<Status>('idle');

  const begin = async () => {
    if (status === 'checking') return;
    setStatus('checking');
    const res = await beginVisit({ name: '', company: '' });
    if (res.ok) onUnlocked();
    else setStatus(res.reason);
  };

  // A production build with no Supabase env fails CLOSED: a configuration
  // error for the owner, never an open gate for the visitor.
  if (!ENV_PRESENT && !OFFLINE_DEV) {
    return (
      <>
        <JourneyIntro />
        <div className="mt-6">
          <ErrorState
            message="Mission Control is not configured — VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing from this deploy. The gate stays shut until they exist. See /api/env-check for the server's view."
            onRetry={() => window.location.reload()}
          />
        </div>
        <PaperRow />
      </>
    );
  }

  return (
    <>
      <JourneyIntro onLaunch={status === 'checking' ? undefined : () => void begin()} />

      <div className="stagger">
        {status === 'rate_limited' && (
          <p className="mb-4 text-xs leading-relaxed text-accent">
            Too many launches from this network in the last minute. Please wait about a minute and
            try again, or view the résumé PDF below.
          </p>
        )}

        {status === 'unreachable' ? (
          <ErrorState
            message="The flight's sign-in service is temporarily unreachable — an issue on this site, not on your end. Please retry in a moment, or view the résumé PDF below."
            onRetry={() => void begin()}
          />
        ) : (
          <button
            id="begin-flight"
            type="button"
            className="btn launch-btn"
            disabled={status === 'checking'}
            onClick={() => void begin()}
            onPointerEnter={prefetchSupabase}
            onFocus={prefetchSupabase}
          >
            {status === 'checking' ? 'Preparing the flight…' : 'Begin the flight →'}
          </button>
        )}
      </div>

      <PaperRow />
      {OFFLINE_DEV && (
        <p className="mt-5 font-mono text-2xs uppercase tracking-widest text-faint">
          Offline preview · nothing is logged
        </p>
      )}
    </>
  );
}

/** A visitor who already launched in this browser session: no second
 *  logbook row — straight back to the station they left, or from the top. */
export function ResumeFlight({
  station,
  onResume,
  onRestart,
}: {
  station: number;
  onResume: () => void;
  onRestart: () => void;
}) {
  return (
    <>
      <JourneyIntro onLaunch={onResume} />
      <div className="stagger">
        <button
          type="button"
          className="btn launch-btn"
          onClick={onResume}
        >
          {station > 0 ? 'Resume the flight →' : 'Begin the flight →'}
        </button>
        {station > 0 && (
          <p className="mt-3 text-xs text-faint">
            <button
              type="button"
              className="underline decoration-rule-strong underline-offset-2 hover:text-dim"
              onClick={onRestart}
            >
              Start again from liftoff
            </button>
          </p>
        )}
      </div>
      <PaperRow />
    </>
  );
}

/** The quicker read, offered under every state of the journey column. A
 *  quiet text link rather than a second boxed button: the flight is the
 *  call to action here, the PDF is the alternative. */
export function PaperRow() {
  return (
    <p className="journey-paper">
      or{' '}
      <a href="/resume.pdf" download="Cameron-Carpenter-Resume.pdf">
        download the résumé PDF
      </a>
    </p>
  );
}
