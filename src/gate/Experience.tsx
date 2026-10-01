import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { logStation, restore } from '../lib/gate';
import { ErrorState, PreflightConsole, SkLine, type PreflightRow } from '../ui/primitives';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Home } from '../home/Home';
import { Gate, JourneyIntro, PaperRow, ResumeFlight } from './Gate';

/**
 * The Space Journey tab, and the unlock state machine behind it. The flight
 * module is lazy AND only ever rendered after the server has logged this
 * visit — so the content chunk is not even fetched before the button. Forged
 * sessionStorage lands back at the form; a dead Supabase lands at a Retry
 * with the PDF in reach.
 *
 * This state machine renders the Space Journey column of the three-column
 * home page. A session that has already launched comes back to the home
 * page with a "Resume the flight" button rather than being dropped straight
 * into WebGL — the flight is one of three things on the page now. The HUD's
 * mark leads back here.
 */
const Flight = lazy(() => import('../flight/Flight'));

type Phase =
  | { s: 'checking' }
  | { s: 'gate' }
  | { s: 'unreachable' }
  | { s: 'resumable'; furthest: number }
  | { s: 'unlocked'; furthest: number };

export function Experience() {
  const [phase, setPhase] = useState<Phase>({ s: 'checking' });
  // Where the visitor actually is, so leaving and resuming lands on the
  // same station rather than the start.
  const lastStation = useRef(0);

  const attemptRestore = useCallback(() => {
    setPhase({ s: 'checking' });
    void restore().then((r) => {
      if (r.state === 'valid') {
        lastStation.current = Math.max(lastStation.current, r.furthest);
        setPhase({ s: 'resumable', furthest: lastStation.current });
      } else if (r.state === 'unreachable') setPhase({ s: 'unreachable' });
      else setPhase({ s: 'gate' });
    });
  }, []);

  useEffect(attemptRestore, [attemptRestore]);

  const onStationReached = useCallback((index: number, count: number) => {
    lastStation.current = index;
    logStation(index, count);
  }, []);

  if (phase.s === 'unlocked') {
    // The boundary sits OUTSIDE the Suspense on purpose: a lazy chunk that
    // never arrives rejects the import, and React re-throws that rejection
    // past the fallback — Suspense can only wait, it cannot recover. Without
    // this, a dropped download on hotel wifi (or a chunk hash that Netlify
    // redeployed over while the tab sat open) blanked the page to white.
    return (
      <ErrorBoundary what="The flight">
        <Suspense fallback={<PreflightStart />}>
          <Flight
            initialStation={phase.furthest}
            onStationReached={onStationReached}
            onExit={() => {
              window.scrollTo(0, 0);
              setPhase({ s: 'resumable', furthest: lastStation.current });
            }}
          />
        </Suspense>
      </ErrorBoundary>
    );
  }

  const journey =
    phase.s === 'checking' ? (
      <JourneySkeleton />
    ) : phase.s === 'unreachable' ? (
      <>
        <JourneyIntro />
        <div className="mt-6">
          <ErrorState
            message="Your flight is on file, but the service that resumes it is temporarily unreachable. Please retry in a moment, or view the résumé PDF below."
            onRetry={attemptRestore}
          />
        </div>
        <PaperRow />
      </>
    ) : phase.s === 'gate' ? (
      <Gate onUnlocked={() => setPhase({ s: 'unlocked', furthest: 0 })} />
    ) : (
      <ResumeFlight
        station={phase.furthest}
        onResume={() => setPhase({ s: 'unlocked', furthest: phase.furthest })}
        onRestart={() => {
          lastStation.current = 0;
          setPhase({ s: 'unlocked', furthest: 0 });
        }}
      />
    );

  return <Home journey={journey} />;
}

/**
 * The first half of the launch, and the reason it is not a skeleton.
 *
 * This is what a visitor sees between pressing "Begin the flight" and the
 * WebGL chunk arriving. It used to be <SplashSkeleton /> — the gate's own
 * headline, still reading "Enter your access code to lift off", over three
 * grey bars — followed by a hard cut to a boot overlay of a completely
 * different shape. Two loading screens for one wait, and the first of them
 * described a screen the visitor had already left.
 *
 * So it renders the console BootSequence renders, from the same component,
 * with the two rows it cannot yet know about still pending. Every row here is
 * an observed fact and not a schedule: the code really has been redeemed (the
 * server said so, which is why this branch is rendering at all) and the flight
 * module really is in flight. When the chunk lands, React throws this tree
 * away and BootSequence builds the identical one with row two complete — so
 * the swap looks like a checklist advancing rather than like a page changing.
 *
 * The bar sits at 0 on purpose. Nothing is streaming yet: the module that
 * knows how many planets there are has not arrived. A bar that moved here
 * would be the only dishonest pixel in the sequence.
 *
 * The labels are duplicated from BootSequence rather than shared, and that is
 * the one duplication worth keeping: pulling them out would put a second
 * import between the gate's entry chunk and the flight's, and the list is four
 * strings that must change together anyway — the comment at the top of
 * BootSequence says so in the other direction too.
 */
// Module scope so the array identity is stable across renders; the console
// keys its rows by label and there is nothing here that varies per render.
const PREFLIGHT_START_ROWS: PreflightRow[] = [
  { label: 'Cleared for launch', state: 'done', value: 'OK' },
  { label: 'Flight deck online', state: 'active' },
  { label: 'Celestial bodies', state: 'pending' },
  { label: 'Ignition', state: 'pending' },
];

function PreflightStart() {
  return (
    <PreflightConsole
      headline="Bringing the flight deck online."
      rows={PREFLIGHT_START_ROWS}
      pct={0}
    />
  );
}

/** Layout-matched skeleton of the journey tab while a returning session is
 *  re-validated — never a spinner, and deliberately NOT the pre-flight
 *  console: this state resolves to the form as often as it resolves to a
 *  flight, and dressing a session check as a launch would promise a takeoff
 *  to someone about to be shown a form. */
function JourneySkeleton() {
  return (
    <>
      <JourneyIntro />
      <div className="mt-6" aria-hidden="true">
        <SkLine w="w80" />
        <SkLine w="w60" />
        <SkLine w="w40" />
      </div>
    </>
  );
}
