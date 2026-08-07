import { useEffect, useState } from 'react';
import { useProgress } from '@react-three/drei';

/* ==== BOOT SEQUENCE — the pre-flight loading overlay =======================
 * Plain DOM rendered as a sibling above the canvas: drei's useProgress reads
 * the shared loading store, so it works outside the Canvas tree. The house
 * pattern is a determinate bar plus counters — an indeterminate loop would
 * hide how much of the ~2 MB of planets remains, and the repo bans it anyway.
 * ========================================================================= */

// Hold after the last asset resolves so the first rendered frame lands behind
// the overlay — unmounting on the same tick flashes an empty canvas.
const HOLD_MS = 300;

// Matches var(--dur-3): the JS unmount must not outrun the CSS opacity fade,
// and the raw number lives here (not in a style) so timings stay tokenised.
const FADE_MS = 420;

type Phase = 'idle' | 'visible' | 'fading' | 'done';

export function BootSequence() {
  const { active, progress, loaded, total } = useProgress();
  const [phase, setPhase] = useState<Phase>('idle');

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

  const pct = Math.round(progress);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-ground"
      style={{
        opacity: phase === 'fading' ? 0 : 1,
        // Opacity-only exit on the shared tokens — .xfade is reserved for the
        // reduced-motion panels, so this fade carries its own transition.
        transition: 'opacity var(--dur-3) var(--ease-out)',
        pointerEvents: phase === 'fading' ? 'none' : 'auto',
      }}
    >
      <div className="flex w-full max-w-sm flex-col gap-3 px-6">
        <p className="font-mono text-2xs uppercase tracking-widest text-faint">Pre-flight</p>

        <p className="font-mono text-xs text-dim">
          loading celestial bodies ·{' '}
          <span className="num">
            {loaded}/{total}
          </span>
        </p>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Streaming planet textures"
          className="h-0.5 w-full overflow-hidden bg-raised"
        >
          {/* Determinate ink fill — width is the one property that moves. */}
          <div
            className="h-full bg-ink"
            style={{ width: `${pct}%`, transition: 'width var(--dur-2) var(--ease-out)' }}
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
