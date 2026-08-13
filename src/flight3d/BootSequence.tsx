import { useEffect, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { PreflightConsole, type PreflightRow } from '../ui/primitives';

/* ==== BOOT SEQUENCE — the pre-flight loading overlay =======================
 * Plain DOM rendered as a sibling above the canvas: drei's useProgress reads
 * the shared loading store, so it works outside the Canvas tree. The house
 * pattern is a determinate bar plus counters — an indeterminate loop would
 * hide how much of the ~2 MB of planets remains, and the repo bans it anyway.
 *
 * This overlay is the SECOND half of one sequence, not a screen of its own.
 * The first half is the Suspense fallback in gate/Experience.tsx, which
 * renders the same <PreflightConsole> with the later rows still pending while
 * the flight chunk downloads. Everything about the layout therefore lives in
 * ui/primitives.tsx, where both chunks can import it without dragging the
 * WebGL stack into the gate's entry graph; this file owns only the states.
 * If you change what a row says, change it there or the seam will show.
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

// ---- HOW LONG "QUIET" HAS TO LAST BEFORE IT COUNTS AS IGNITION -------------
// The overlay used to call T-0 the instant drei reported no active downloads,
// and drei goes quiet BETWEEN batches: the planets, the sky and the landing
// site register with the loading manager as their modules evaluate, not all at
// once. Measured on a production build at 1440x900, the loader sat idle for
// 176ms after the very first texture — long enough that the screen said
// "Cleared for launch · CELESTIAL BODIES 1/1", lit the card's edge, filled the
// bar cyan, and then quietly went back to loading. An instrument that
// announces a launch and takes it back is exactly the class of dishonesty the
// bar-vs-counter note below exists to stamp out.
//
// This window sits INSIDE the existing hold rather than in front of it, which
// is the whole trick: quiet for 300ms declares ignition, quiet for the full
// 620ms starts the fade, and the moment the loader wakes up both are
// cancelled. Time-to-first-station is unchanged to the millisecond — the beat
// is bought out of the hold that was already being spent, not added to it.
const CONFIRM_MS = 300;

// The safety valve for the case that cannot happen. `total` is cumulative, so
// it latches above zero the moment the loading manager is told about anything
// at all, and every visit has planets to fetch — but "the overlay waits for a
// signal that never comes" fails to a black screen forever, which is too
// expensive a bet to leave open. If nothing has registered this long after the
// overlay appears, treat the scene as having nothing to stream. Firing early
// is harmless and self-correcting: the moment a texture does register, `active`
// flips and the effect below cancels everything in flight.
const NO_WORK_MS = 1200;

type Phase = 'visible' | 'fading' | 'done';

export function BootSequence() {
  // `progress` is deliberately NOT destructured — see the note below the
  // early return for why that number cannot drive the bar.
  const { active, loaded, total } = useProgress();
  // ---- WHY THIS STARTS 'visible' AND NOT 'idle' ---------------------------
  // It used to wait for drei to report real work before mounting, on the
  // theory that a fully cached visit deserved no overlay at all. What that
  // actually bought was a ~500ms window — measured, at 1440x900 — between the
  // Suspense fallback going away and the first texture registering, in which
  // the ENTIRE flight deck was on screen with nothing drawn behind it: hero,
  // station panel, rail, telemetry, all of it, over a blank canvas, before a
  // black overlay dropped on top of it. The worst frame on the site, on the
  // one visit that decides everything, and the fix is that this component is
  // simply up from the moment it exists.
  //
  // The theory was wrong anyway: every texture goes through the loading
  // manager whether or not the browser serves it from cache, so `active`
  // flips true on any visit that has a scene to build. The cached case the
  // old guard was protecting is the case where Scene3D's dress rehearsal
  // ALSO silently skipped itself — this overlay is its only cue — so that
  // branch was not a fast path, it was the first-visit compile stall coming
  // back on a reload.
  const [phase, setPhase] = useState<Phase>('visible');
  // Ignition is a CONFIRMED state, not a sampled one — see CONFIRM_MS.
  const [cleared, setCleared] = useState(false);
  const [noWork, setNoWork] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setNoWork(true), NO_WORK_MS);
    return () => window.clearTimeout(id);
  }, []);

  // Loading finished: declare ignition once the quiet holds, then start the
  // fade. Both are cancelled if a late asset re-activates the loader, which is
  // what makes the announcement honest rather than merely early.
  useEffect(() => {
    if (active) {
      setCleared(false);
      return;
    }
    // Not `phase !== 'visible'` with the reset above it: once the fade has
    // begun the card must STAY lit through it, and an early return that also
    // un-lit it turned the exit into a blink.
    if (phase !== 'visible') return;
    if (total === 0 && !noWork) return;
    const go = window.setTimeout(() => setCleared(true), CONFIRM_MS);
    const hold = window.setTimeout(() => setPhase('fading'), HOLD_MS);
    return () => {
      window.clearTimeout(go);
      window.clearTimeout(hold);
    };
  }, [active, phase, total, noWork]);

  // Unmount after the fade completes; 'done' latches so a mid-voyage texture
  // fetch can never flash the boot screen over a live scene.
  useEffect(() => {
    if (phase !== 'fading') return;
    const gone = window.setTimeout(() => setPhase('done'), FADE_MS);
    return () => window.clearTimeout(gone);
  }, [phase]);

  if (phase === 'done') return null;

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

  /* Four real states, in the order they actually resolve. The first two are
     already true by the time this component can exist at all: the gate has
     blessed the session and the WebGL flight module is running — which is
     exactly why they are worth showing, because the visitor has no other
     evidence that the button did anything. The fallback in Experience.tsx
     shows this same list with row two still in flight, so the only thing that
     changes across the chunk boundary is that row completing. */
  const rows: PreflightRow[] = [
    { label: 'Cleared for launch', state: 'done', value: 'OK' },
    { label: 'Flight deck online', state: 'done', value: 'OK' },
    {
      // Keyed on the CONFIRMED state, not on `active`: the loader's mid-flight
      // lulls used to tick this row complete and then un-tick it, and a
      // checklist diamond that fills and empties is a checklist nobody trusts.
      label: 'Celestial bodies',
      state: cleared ? 'done' : 'active',
      // total is 0 for the handful of frames before the loader has been told
      // what it is fetching; printing "0/0" beside a full bar is the exact
      // class of contradiction the note above exists to prevent.
      ...(total > 0 ? { value: `${loaded}/${total}` } : {}),
    },
    { label: 'Ignition', state: cleared ? 'active' : 'pending', ...(cleared ? { value: 'T-0' } : {}) },
  ];

  return (
    <PreflightConsole
      headline={cleared ? 'Cleared for launch.' : 'Bringing the flight deck online.'}
      rows={rows}
      pct={pct}
      cleared={cleared}
      leaving={phase === 'fading'}
    />
  );
}
