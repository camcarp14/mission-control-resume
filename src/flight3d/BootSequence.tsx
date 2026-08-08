import { useEffect, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { useReducedMotion } from 'framer-motion';

/* ==== BOOT SEQUENCE — the pre-flight loading overlay =======================
 * Plain DOM rendered as a sibling above the canvas: drei's useProgress reads
 * the shared loading store, so it works outside the Canvas tree. The house
 * pattern is a determinate bar plus counters — an indeterminate loop would
 * hide how much of the ~2 MB of planets remains, and the repo bans it anyway.
 *
 * This overlay is also the ONLY thing standing between "Begin the flight" and
 * a starfield, so it does a second job: it has to read as a launch sequence
 * rather than as a second loading screen. The visitor has just pressed a
 * button that promised a flight; a bar on its own answers "wait", not "here
 * we go". The checklist below is the answer, and every line of it is a real
 * state — nothing on this screen advances on a timer pretending to be work.
 *
 * The root element must stay `div.fixed.z-30`: Scene3D's shader dress
 * rehearsal uses that selector to know the canvas is still covered, and skips
 * itself if the overlay has gone. Renaming it would flash the finale.
 * ========================================================================= */

// Hold after the last asset resolves so the first rendered frame lands behind
// the overlay — unmounting on the same tick flashes an empty canvas. That hold
// now also carries the ignition beat: at the old 300ms the final state change
// registered as a flicker rather than as a moment, and the handoff had no
// payoff at all. Long enough to read "ignition", short enough that nobody
// waits for it.
const HOLD_MS = 620;

// Matches var(--dur-3): the JS unmount must not outrun the CSS opacity fade,
// and the raw number lives here (not in a style) so timings stay tokenised.
const FADE_MS = 420;

type Phase = 'idle' | 'visible' | 'fading' | 'done';

/** One checklist row. `state` is observed, never scheduled. */
function Step({
  label,
  state,
  value,
}: {
  label: string;
  state: 'done' | 'active' | 'pending';
  value?: string;
}) {
  return (
    <li className="flex items-baseline gap-2">
      {/* The rail's diamond vocabulary: filled once a step is behind us. The
          glyph is the only thing carrying the state visually, so the same fact
          is spelled out for a screen reader rather than left to a lozenge. */}
      <span aria-hidden="true" className={state === 'pending' ? 'text-faint' : 'text-cyan'}>
        {state === 'done' ? '◆' : '◇'}
      </span>
      <span className="sr-only">
        {state === 'done' ? 'complete: ' : state === 'active' ? 'in progress: ' : 'pending: '}
      </span>
      <span
        className={`flex-1 uppercase tracking-widest ${
          state === 'pending' ? 'text-faint' : state === 'active' ? 'text-ink' : 'text-dim'
        }`}
      >
        {label}
      </span>
      {value ? <span className="num text-dim">{value}</span> : null}
    </li>
  );
}

export function BootSequence() {
  // `progress` is deliberately NOT destructured — see the note below the
  // early return for why that number cannot drive the bar.
  const { active, loaded, total } = useProgress();
  const [phase, setPhase] = useState<Phase>('idle');
  const reduced = useReducedMotion() ?? false;

  // Only appear once the loader reports real work — if the chunk arrives with
  // everything cached (active never flips true), the overlay never mounts.
  useEffect(() => {
    if (active) setPhase((p) => (p === 'idle' ? 'visible' : p));
  }, [active]);

  // Loading finished: hold briefly, then start the fade. Cleared if a late
  // asset re-activates the loader before the hold elapses.
  useEffect(() => {
    if (phase !== 'visible' || active) return;
    const hold = window.setTimeout(() => setPhase('fading'), HOLD_MS);
    return () => window.clearTimeout(hold);
  }, [active, phase]);

  // Unmount after the fade completes; 'done' latches so a mid-voyage texture
  // fetch can never flash the boot screen over a live scene.
  useEffect(() => {
    if (phase !== 'fading') return;
    const gone = window.setTimeout(() => setPhase('done'), FADE_MS);
    return () => window.clearTimeout(gone);
  }, [phase]);

  if (phase === 'idle' || phase === 'done') return null;

  /* THE BAR AND THE COUNTER ARE ONE QUANTITY.
   *
   * They were two, and they disagreed on screen: "12/13" beside a bar at 8%,
   * "15/15" beside a bar at 22%. drei's `progress` is not loaded/total — it is
   * measured against a module-level baseline of the last completed batch
   * ((loaded - lastTotal) / (total - lastTotal)), which is a perfectly
   * reasonable number and NOT the one printed next to it. An instrument whose
   * two readouts contradict each other is worse than no instrument, and this
   * is the first thing a visitor sees after unlocking. So the counter's own
   * two numbers drive the fill, and drei's figure is dropped entirely.
   */
  const frac = total > 0 ? loaded / total : 0;
  const pct = Math.round(frac * 100);

  // The last beat: assets are in, the scene has its first frame, and the only
  // thing left is to get out of the way.
  const igniting = !active;
  const ease = reduced ? 'none' : 'width var(--dur-2) var(--ease-out)';

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-ground"
      style={{
        opacity: phase === 'fading' ? 0 : 1,
        // Opacity-only exit on the shared tokens — .xfade is reserved for the
        // reduced-motion panels, so this fade carries its own transition. A
        // cut-fade is the canonical reduced-motion transition, so it stays on
        // in both modes; only the bar's travel is gated.
        transition: 'opacity var(--dur-3) var(--ease-out)',
        pointerEvents: phase === 'fading' ? 'none' : 'auto',
      }}
    >
      <div className="flex w-full max-w-sm flex-col gap-3 px-6">
        <p className="font-mono text-2xs uppercase tracking-widest text-faint">
          Mission Control · Pre-flight
        </p>

        {/* The one line that pays off the button. It states where the sequence
            is, and it is the only copy on the overlay that changes. */}
        <p className="text-sm text-ink" aria-live="polite">
          {igniting ? 'Cleared for launch.' : 'Bringing the flight deck online.'}
        </p>

        {/* Four real states, in the order they actually resolve. The first two
            are already true by the time this component can exist at all: the
            gate has blessed the session and the WebGL flight module is running
            — which is exactly why they are worth showing, because the visitor
            has no other evidence that the button did anything. */}
        <ul className="flex flex-col gap-1.5 font-mono text-2xs">
          <Step label="Access verified" state="done" />
          <Step label="Flight deck online" state="done" />
          <Step
            label="Celestial bodies"
            state={active ? 'active' : 'done'}
            value={`${loaded}/${total}`}
          />
          <Step
            label="Ignition"
            state={igniting ? 'active' : 'pending'}
            {...(igniting ? { value: 'T-0' } : {})}
          />
        </ul>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Streaming planet textures"
          // The extra top margin keeps a 2px determinate bar from reading as
          // an underline rule beneath the checklist's last row.
          className="mt-1 h-0.5 w-full overflow-hidden bg-raised"
        >
          {/* Determinate ink fill — width is the one property that moves, and
              it moves on loaded/total, the same pair printed above. It goes
              cyan at ignition: the instrument palette's way of saying the
              measurement is finished and the thing it measured is ready. */}
          <div
            className={`h-full ${igniting ? 'bg-cyan' : 'bg-ink'}`}
            style={{ width: `${pct}%`, transition: ease }}
          />
        </div>

        {/* The escape hatch stays honest even while the heavy path streams. */}
        <p className="font-mono text-2xs text-faint">
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
