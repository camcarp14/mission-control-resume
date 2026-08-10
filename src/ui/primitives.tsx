// THE POLISH PRIMITIVES — pairs with polish.css.
// Adapted from saas-polish-system/assets/primitives.jsx to TypeScript, plus the
// instrument-specific pieces this app needs (Metric, Empty, ErrorState).
//
// One deliberate change from the source: useTween returns a raw float instead of
// Math.round()-ing. Rounding is the formatter's job — see the `f` prop on <Num> —
// so fractional metrics (a 0.34 ratio, a 4.5s duration) survive the tween.
import {
  useState,
  useEffect,
  useRef,
  createContext,
  useContext,
  type ReactNode,
} from 'react';

/* ---- numbers count to their value (ease-out cubic). Use on every big metric. ---- */
export function useTween(target: number | null, dur = 700): number | null {
  const [v, setV] = useState(target ?? 0);
  const fromRef = useRef(target ?? 0);

  useEffect(() => {
    if (target == null) return;
    const from = fromRef.current ?? 0;
    if (from === target) {
      setV(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      setV(from + (target - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);

  return target == null ? null : v;
}

export function Num({
  v,
  f = (x: number) => x.toLocaleString('en-US'),
  dur,
}: {
  v: number | null | undefined;
  f?: (x: number) => string;
  dur?: number;
}) {
  const shown = useTween(typeof v === 'number' ? v : null, dur);
  return <>{shown == null ? '—' : f(shown)}</>;
}

/* ---- formatters: every numeric surface uses one of these ---- */
export const fmt = {
  int: (x: number) => Math.round(x).toLocaleString('en-US'),
  one: (x: number) => x.toFixed(1),
  two: (x: number) => x.toFixed(2),
  pct: (x: number) => `${Math.round(x * 100)}%`,
  pct1: (x: number) => `${(x * 100).toFixed(1)}%`,
  ratio: (x: number) => `${x.toFixed(2)}×`,
  hours: (x: number) => `${x.toFixed(1)}h`,
  usd: (x: number) =>
    x >= 1000 ? `$${(x / 1000).toFixed(1)}k` : `$${Math.round(x)}`,
  months: (x: number) => `${x.toFixed(1)}mo`,
  level: (x: number) => Math.round(x).toString().padStart(2, '0'),
};

/* ---- skeletons: replace EVERY page-level spinner ---- */
export const SkLine = ({ w }: { w?: 'w40' | 'w60' | 'w80' }) => (
  <div className={`sk sk-line${w ? ` ${w}` : ''}`} />
);

export const SkCard = () => (
  <div className="card border border-rule bg-panel p-4">
    <SkLine w="w40" />
    <div className="sk sk-big" />
    <SkLine w="w80" />
  </div>
);

/** Instrument-row skeleton — matches the real metric strip cell-for-cell so the
 *  page develops into its final layout instead of jumping. */
export const SkInstrumentRow = ({ cells = 7 }: { cells?: number }) => (
  <div className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4 lg:grid-cols-7">
    {Array.from({ length: cells }).map((_, i) => (
      <div key={i} className="bg-panel px-4 py-3">
        <div className="sk sk-line w60" style={{ height: 9, margin: '2px 0 10px' }} />
        <div className="sk" style={{ height: 22, width: '70%' }} />
      </div>
    ))}
  </div>
);

export function SkPage({ cards = 4, instrument = true }: { cards?: number; instrument?: boolean }) {
  return (
    <div className="pagefade space-y-8">
      {instrument && <SkInstrumentRow />}
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: cards }).map((_, i) => (
          <SkCard key={i} />
        ))}
      </div>
    </div>
  );
}

/* ==== THE PRE-FLIGHT CONSOLE ===============================================
 * The one instrument that spans the seam between two React trees.
 *
 * Pressing "Begin the flight" used to produce two unrelated loading screens
 * back to back: the lazy chunk's skeleton (the gate's headline over three grey
 * bars — still inviting you to "enter your access code", which you just did),
 * then a hard cut to a full-screen boot overlay with a different layout, and
 * between them a ~500ms flash of the whole naked flight deck with nothing
 * drawn behind it. Three screens for one wait, and no thread through them.
 *
 * So the shell lives here, in the one module both sides can import. The
 * Suspense fallback renders it with the later rows still pending; BootSequence
 * renders the SAME markup with live values. The DOM is thrown away and rebuilt
 * at that boundary — that is what a Suspense fallback is — so the only defence
 * is that the two renders agree pixel for pixel, and the only thing that
 * changes across the seam is one row completing — which is the one thing that
 * genuinely did just happen, because the arrival of that chunk IS the flight
 * deck coming online.
 *
 * Two consequences that look like quirks and are not:
 *   · Every state change is a CSS *transition*, never a keyframe animation. An
 *     animation replays on mount, and the seam is a mount — a row that flashes
 *     as it is re-created would advertise the swap this whole file exists to
 *     hide.
 *   · The T+ clock's epoch is module scope, not component state, so it keeps
 *     counting through the rebuild instead of resetting to zero on camera.
 *
 * It lives in primitives.tsx and not next to BootSequence because the gate's
 * entry chunk imports it: anything under flight3d/ drags @react-three/drei and
 * framer-motion into the graph, and vite.config.ts documents twice what that
 * does to first paint. This file's only import is React, and it stays that way.
 * ========================================================================= */

/** One checklist row. `state` is OBSERVED, never scheduled — nothing on this
 *  screen advances on a timer pretending to be work. */
export type PreflightRow = {
  label: string;
  state: 'done' | 'active' | 'pending';
  /** Right-column readout. A row with nothing to report prints the house
   *  null glyph rather than leaving the column ragged. */
  value?: string;
};

/* Co-located rather than added to polish.css, on the same reasoning GATE_CSS
   is co-located in Gate.tsx: this is the only surface in the product that uses
   it, and it has to travel with the component both chunks import. Timings are
   the shared tokens, and the reduce block at the end is not optional.

   The prose lives out here, not inside the template literal, and that is not a
   style preference: a comment inside a string is a comment the minifier cannot
   see, so every word of it would be downloaded by every visitor on the gate's
   critical chunk. Same reason the rules below are packed one per line.

   .pf-card    the station panel's own material, mixed to the recipe in
               polish.css's `.panelwrap :has(> .panel)` — cold cyan hairline
               catching light along the top edge, faint glow lifting it off the
               ground. That is the whole idea: the first thing a visitor sees
               after pressing the button is made of the same stuff as the
               eleven panels that follow it, so the flight deck reads as a
               continuation rather than as another screen.
   .go         T-0. The edge takes the light. One property change, on the
               tokens, landing inside a hold that already existed — the only
               theatre on this screen, and it costs a border colour. --dur-2
               and not --dur-3 because it has to ARRIVE inside the ignition
               beat, not still be arriving when the fade starts.
   .pf-leaving the instrument clears before the curtain does. Fading both
               together left the checklist ghosted over Earth for the whole
               420ms, which reads as a screen dissolving; leaving first reads
               as a handoff.
   .pf-veil /
   .pf-iris    the curtain, in two layers, and the reason the exit is worth
               two divs. The overlay used to be one opaque plane that faded
               out uniformly, which means the whole flight deck — Earth, the
               ship, the hero, the panel, the rail, the telemetry — arrived at
               once, already fully composed, with nothing to look at first.
               Splitting the ground into a flat veil and a vignette that
               outlives it opens the frame from the middle outward: the world
               clears first, the chrome at the edges a beat later. Nothing
               moves and nothing is faked — it is two opacity fades on
               different tokens — but it manufactures an order of arrival out
               of a screen that had none. Under reduced motion the two are
               pinned to the same duration, which collapses it back to the
               plain cut-fade that mode is owed.
   .pf-tick    viewfinder corners, floated just outside the card, so it reads
               as sighted rather than as a dialog.
   .pf-lead    the leader that turns four readouts at four different distances
               from their labels into a column.
   .pf-row     colour is the only thing a row changes, and it eases.
   .pf-fill    width travel is the one thing gated by reduced motion; the
               fill's colour change at T-0 is a state change and stays on in
               both modes, exactly as a cut-fade does. */
const PREFLIGHT_CSS = `
.pf-card { position: relative; background: var(--panel); border: 1px solid var(--rule);
  border-top-color: rgba(76,201,240,0.32); border-radius: var(--r-3);
  box-shadow: 0 -1px 18px rgba(76,201,240,0.05), 0 14px 44px rgba(0,0,0,0.5);
  padding: 1.125rem 1.25rem 1.25rem;
  transition: opacity var(--dur-2) var(--ease-out), border-top-color var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out); }
.pf-card.go { border-top-color: rgba(124,249,255,0.85);
  box-shadow: 0 -1px 30px rgba(76,201,240,0.19), 0 14px 44px rgba(0,0,0,0.5); }
.pf-veil, .pf-iris { position: absolute; inset: 0; }
.pf-veil { background: var(--ground); transition: opacity var(--dur-2) var(--ease-out); }
.pf-iris { transition: opacity var(--dur-3) var(--ease-out);
  background: radial-gradient(118% 96% at 50% 48%, rgba(8,9,11,0) 14%, rgba(8,9,11,0.5) 44%, var(--ground) 80%); }
.pf-leaving .pf-card { opacity: 0; transition-duration: var(--dur-1); }
.pf-leaving .pf-veil, .pf-leaving .pf-iris { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .pf-veil { transition-duration: var(--dur-3); } }
.pf-tick { position: absolute; width: 10px; height: 10px; border: 0 solid rgba(154,220,255,0.5); }
.pf-tick.tl { top: -5px; left: -5px; border-top-width: 1px; border-left-width: 1px; }
.pf-tick.tr { top: -5px; right: -5px; border-top-width: 1px; border-right-width: 1px; }
.pf-tick.bl { bottom: -5px; left: -5px; border-bottom-width: 1px; border-left-width: 1px; }
.pf-tick.br { bottom: -5px; right: -5px; border-bottom-width: 1px; border-right-width: 1px; }
.pf-rule { height: 1px; background: linear-gradient(90deg, var(--rule-strong), rgba(255,255,255,0)); }
.pf-row > span { transition: color var(--dur-2) var(--ease-out); }
.pf-lead { align-self: center; height: 1px; opacity: 0.5;
  background: repeating-linear-gradient(90deg, var(--rule-strong) 0 1px, transparent 1px 6px); }
.pf-fill { transition: width var(--dur-2) var(--ease-out), background-color var(--dur-2) var(--ease-out); }
@media (prefers-reduced-motion: reduce) { .pf-fill { transition: background-color var(--dur-2) var(--ease-out); } }
`;

/* The clock's zero. Module scope on purpose — see the header note: the
   component is destroyed and rebuilt when the flight chunk resolves, and a
   launch clock that restarts from zero halfway through the launch is worse
   than no clock. `performance.now()`, not Date.now(), because this is a
   duration and the wall clock can move underneath one. */
let preflightEpoch: number | null = null;

/** T+MM:SS.d, tabular, fixed width. Honest by construction: it counts UP from
 *  the moment the console appeared. A countdown would have to guess when the
 *  network finishes, and this screen does not guess. */
function formatT(ms: number, coarse: boolean): string {
  const s = Math.max(0, ms) / 1000;
  const mm = String(Math.min(99, Math.floor(s / 60))).padStart(2, '0');
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  return coarse ? `T+${mm}:${ss}` : `T+${mm}:${ss}.${Math.floor((s % 1) * 10)}`;
}

export function PreflightConsole({
  headline,
  rows,
  pct,
  cleared = false,
  leaving = false,
}: {
  /** The one line that pays off the button. The only copy here that changes. */
  headline: string;
  rows: PreflightRow[];
  /** 0–100. Drives the fill AND is the same quantity the rows print. */
  pct: number;
  /** Everything is in and the only thing left is to get out of the way. */
  cleared?: boolean;
  /** Exit has started: the card goes first, the ground follows. */
  leaving?: boolean;
}) {
  const clock = useRef<HTMLSpanElement>(null);

  // textContent through a ref, never React state — the same discipline
  // Telemetry's readouts use, and it matters far more here: this tree is alive
  // exactly while the main thread is parsing the WebGL chunk and compiling a
  // hundred-odd shader programs, so a re-render of the whole console ten times
  // a second would be spent out of precisely the budget the visitor is waiting
  // on.
  //
  // requestAnimationFrame and NOT setInterval, and that is the whole point of
  // this block. A 10Hz interval keeps firing while the compositor is blocked,
  // so every tick lands as queued work and a repaint the browser owes you the
  // moment it comes up for air. Measured against this container's software
  // renderer, an interval-driven clock pushed the overlay's exit out by
  // seconds. rAF is its own backpressure: while the thread is busy compiling
  // there are no frames, so the clock costs nothing and simply resumes with
  // the correct time — which it can, because it reads the epoch rather than
  // counting ticks. Cheap when there is room, free when there is not.
  useEffect(() => {
    preflightEpoch ??= performance.now();
    const coarse =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // A tenths readout wants ~10Hz; asked for less motion, it keeps the
    // information and drops the flicker to once a second.
    const step = coarse ? 1000 : 100;
    let raf = 0;
    let last = -Infinity;
    const tick = () => {
      const now = performance.now();
      if (now - last >= step && clock.current && preflightEpoch !== null) {
        last = now;
        clock.current.textContent = formatT(now - preflightEpoch, coarse);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    // `fixed` and `z-30` are load-bearing STRINGS, not just styling: Scene3D's
    // shader dress rehearsal finds this element with `div.fixed.z-30` to know
    // the canvas is still covered, and silently skips itself — restoring a real
    // first-visit compile stall — if the selector stops matching.
    // The ground colour deliberately does NOT live on this element any more; it
    // lives on .pf-veil, so the two curtain layers can leave on different
    // clocks. This element is still opaque at rest because the veil covers it.
    <div
      className={`fixed inset-0 z-30 flex items-center justify-center px-4 sm:px-5${
        leaving ? ' pf-leaving' : ''
      }`}
      style={{ pointerEvents: leaving ? 'none' : 'auto' }}
    >
      <style>{PREFLIGHT_CSS}</style>
      <div aria-hidden="true" className="pf-veil" />
      <div aria-hidden="true" className="pf-iris" />
      {/* max-w-lg, not max-w-md: at 28rem the escape line wrapped its last two
          characters onto a line of their own, and an orphaned "it" under a
          mission checklist is the kind of detail that reads as unfinished.
          32rem also sits closer to the 35rem station panel it hands off to. */}
      <div className={`pf-card w-full max-w-lg${cleared ? ' go' : ''}`}>
        <span aria-hidden="true" className="pf-tick tl" />
        <span aria-hidden="true" className="pf-tick tr" />
        <span aria-hidden="true" className="pf-tick bl" />
        <span aria-hidden="true" className="pf-tick br" />

        <div className="flex items-baseline justify-between gap-3">
          {/* Letter-spacing is the thing that gives, not the wrapping — the
              same call Hero.tsx's role line makes, for the same reason. At
              320px the eyebrow and the clock want 248px of a 240px card and
              "PRE-FLIGHT" broke across two lines; a notch less tracking on
              the narrowest phones buys the 13px and keeps the header one
              line, which is what a header on an instrument has to be. */}
          <p className="whitespace-nowrap font-mono text-2xs uppercase tracking-wider text-faint sm:tracking-widest">
            Mission Control · Pre-flight
          </p>
          {/* Decorative: the clock says nothing the checklist does not, and a
              screen reader being told the tenths ten times a second is a
              denial of service, not an affordance. */}
          <span
            ref={clock}
            aria-hidden="true"
            className="num whitespace-nowrap font-mono text-2xs tracking-widest text-hud/70"
          />
        </div>

        <div className="pf-rule mt-3" />

        <p className="mt-3 text-sm text-ink" aria-live="polite">
          {headline}
        </p>

        <ul className="mt-4 flex flex-col gap-2 font-mono text-2xs">
          {rows.map((r) => (
            <li key={r.label} className="pf-row flex items-baseline gap-2">
              {/* The rail's diamond vocabulary: filled once a step is behind
                  us. The glyph is the only thing carrying the state visually,
                  so the same fact is spelled out for a screen reader rather
                  than left to a lozenge. */}
              <span aria-hidden="true" className={r.state === 'pending' ? 'text-faint' : 'text-cyan'}>
                {r.state === 'done' ? '◆' : '◇'}
              </span>
              <span className="sr-only">
                {r.state === 'done'
                  ? 'complete: '
                  : r.state === 'active'
                    ? 'in progress: '
                    : 'pending: '}
              </span>
              {/* One class string plus the colour, not three whole strings:
                  the entry chunk is on the gate's LCP path and every literal
                  in here is bytes a recruiter downloads before the headline
                  repaints. */}
              <span
                className={`uppercase tracking-widest ${
                  r.state === 'pending' ? 'text-faint' : r.state === 'active' ? 'text-ink' : 'text-dim'
                }`}
              >
                {r.label}
              </span>
              <span aria-hidden="true" className="pf-lead flex-1" />
              <span className={`num ${r.state === 'pending' ? 'text-faint' : 'text-dim'}`}>
                {r.value ?? '—'}
              </span>
            </li>
          ))}
        </ul>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Streaming planet textures"
          // The extra top margin keeps a 2px determinate bar from reading as
          // an underline rule beneath the checklist's last row. The track is
          // --rule and not --raised: at 0% — which is the entire first half of
          // this sequence — a raised track on a panel is invisible, so the
          // gauge simply wasn't there until it started filling. An empty gauge
          // that you can see is the honest picture of nothing loaded yet.
          className="mt-3.5 h-0.5 w-full overflow-hidden rounded-sm bg-rule"
        >
          {/* Determinate ink fill — width is the one property that moves, and
              it moves on the same pair of numbers the rows print. It goes cyan
              at ignition: the instrument palette's way of saying the
              measurement is finished and the thing it measured is ready. */}
          <div
            className={`pf-fill h-full ${cleared ? 'bg-cyan' : 'bg-ink'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="pf-rule mt-4" />

        {/* The escape hatch stays honest even while the heavy path streams. */}
        <p className="mt-3 font-mono text-2xs leading-relaxed text-faint">
          first flight streams ~2 MB of planets — the{' '}
          <a
            className="text-dim underline decoration-rule-strong underline-offset-2"
            href="/resume.pdf"
            download
          >
            PDF
          </a>{' '}
          needs none of it
        </p>
      </div>
    </div>
  );
}

/* ---- height:auto expansion, zero measuring, zero jank ---- */
export function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`expand${open ? ' open' : ''}`} aria-hidden={!open}>
      <div>{open ? children : null}</div>
    </div>
  );
}

/* ---- error + empty states. Non-negotiable: errors get Retry, empties get a CTA. ---- */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="border border-accent/30 bg-accent-dim p-5">
      <div className="text-2xs uppercase tracking-widest text-accent">Error</div>
      <p className="mt-2 text-sm text-ink">{message}</p>
      <button
        className="btn mt-4 border border-rule-strong px-3 py-1.5 text-xs text-ink"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}

export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="border border-dashed border-rule bg-panel p-6">
      <div className="text-sm text-ink">{title}</div>
      <p className="mt-1.5 max-w-md text-xs leading-relaxed text-dim">{hint}</p>
      {action && (
        <button
          className="btn mt-4 border border-rule-strong px-3 py-1.5 text-xs text-ink"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/* ---- toasts ---- */
type ToastItem = { id: string; msg: string; err: boolean; out?: boolean };
type PushToast = (msg: string, opts?: { err?: boolean; ms?: number }) => void;

const ToastCtx = createContext<PushToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push: PushToast = (msg, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs, { id, msg, err: !!opts.err }]);
    const ms = opts.ms ?? 2600;
    setTimeout(
      () => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, out: true } : x))),
      ms,
    );
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), ms + 260);
  };

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={`toast${t.err ? ' err' : ''}${t.out ? ' out' : ''}`}
          >
            <span className="tdot" />
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = (): PushToast => useContext(ToastCtx) ?? (() => {});

