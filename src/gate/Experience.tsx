import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { logStation, restore } from '../lib/gate';
import { ErrorState, SkLine } from '../ui/primitives';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Gate, GateSky } from './Gate';

/**
 * The unlock state machine. The flight module is lazy AND only ever rendered
 * after the server has blessed this session — so the content chunk is not
 * even fetched pre-redemption. URL games and forged sessionStorage both land
 * back at the gate; a dead Supabase lands at a Retry with the PDF in reach.
 */
const Flight = lazy(() => import('../flight/Flight'));

type Phase =
  | { s: 'checking' }
  | { s: 'gate' }
  | { s: 'unreachable' }
  | { s: 'unlocked'; furthest: number };

export function Experience() {
  const [phase, setPhase] = useState<Phase>({ s: 'checking' });

  const attemptRestore = useCallback(() => {
    setPhase({ s: 'checking' });
    void restore().then((r) => {
      if (r.state === 'valid') setPhase({ s: 'unlocked', furthest: r.furthest });
      else if (r.state === 'unreachable') setPhase({ s: 'unreachable' });
      else setPhase({ s: 'gate' });
    });
  }, []);

  useEffect(attemptRestore, [attemptRestore]);

  if (phase.s === 'checking') return <SplashSkeleton />;

  if (phase.s === 'unreachable') {
    return (
      <main className="grid min-h-dvh place-items-center px-5 py-12">
        <GateSky />
        <div className="pagefade relative z-10 w-full max-w-lg">
          <p className="font-mono text-2xs uppercase tracking-widest text-faint">Mission Control</p>
          <div className="mt-6">
            <ErrorState
              message="Your pass is on file, but the logbook is unreachable right now. Retry in a moment — or take the PDF and keep moving."
              onRetry={attemptRestore}
            />
          </div>
          <a
            className="btn mt-4 inline-block border border-rule bg-panel px-3.5 py-2 text-xs text-ink"
            href="/resume.pdf"
            download
          >
            Download résumé PDF
          </a>
        </div>
      </main>
    );
  }

  if (phase.s === 'gate') {
    return <Gate onUnlocked={() => setPhase({ s: 'unlocked', furthest: 0 })} />;
  }

  // The boundary sits OUTSIDE the Suspense on purpose: a lazy chunk that never
  // arrives rejects the import, and React re-throws that rejection past the
  // fallback — Suspense can only wait, it cannot recover. Without this, a
  // dropped download on hotel wifi (or a chunk hash that Netlify redeployed
  // over while the tab sat open) blanked the page to white with the visitor's
  // code already spent.
  return (
    <ErrorBoundary what="The flight">
      <Suspense fallback={<SplashSkeleton />}>
        <Flight initialStation={phase.furthest} onStationReached={logStation} />
      </Suspense>
    </ErrorBoundary>
  );
}

/** Layout-matched skeleton of the splash — never a spinner, gone in well
 *  under the 800ms budget on any sane connection. Keeps the SAME header the
 *  pre-rendered index.html shell painted, so a returning visitor's headline
 *  never blinks out while their pass is re-validated. */
function SplashSkeleton() {
  return (
    <main className="grid min-h-dvh place-items-center px-5 py-12">
      <GateSky />
      <div className="relative z-10 w-full max-w-lg">
        <p className="font-mono text-2xs uppercase tracking-widest text-faint">Mission Control</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink md:text-3xl">
          A résumé you pilot.
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-dim">
          One rocket, a flight path of real career artifacts: the work behind an adtech
          Solutions Consultant, flown deliberately rather than scrolled. Enter your access
          code to lift off — about four minutes end to end. In a hurry? The PDF is right
          below, no code needed.
        </p>
        <div className="mt-6">
          <SkLine w="w80" />
          <SkLine w="w60" />
          <SkLine w="w40" />
        </div>
      </div>
    </main>
  );
}
