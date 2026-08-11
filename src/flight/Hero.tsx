import { useEffect, useRef, useState } from 'react';
import type { MotionValue } from 'framer-motion';
import { pilot } from '../content/stations.js';

/** 0→1 hermite ease — retires the hero smoothly as the flight leaves STN 01. */
const smoothstep = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/* The boot overlay's root, by the selector src/ui/primitives.tsx documents as
 * a load-bearing string and Scene3D already reaches for to know whether the
 * canvas is still covered. Asking the same question the same way is the point:
 * one convention with two readers cannot drift, where a second mechanism
 * (a prop threaded through Flight, a shared context, a timer guessed against
 * the loader) would be a second thing to keep true. */
const OVERLAY = 'div.fixed.z-30';

/* The overlay's exit class, from the same component. Waiting for the element
 * to be REMOVED was the obvious cue and it left a hole: the curtain dissolves
 * over its own fade before it unmounts, so the scene stood fully revealed with
 * no identity on it for the length of that fade, and only then did the name
 * start to rise. Watching the exit BEGIN lets the hero arrive through the
 * dissolve, which is the beat this was always meant to be.
 * It is a soft dependency on purpose: whichever of the two signals lands first
 * releases the hold, so if this class is ever renamed the removal still fires
 * and the entrance degrades to the late-but-correct version rather than to a
 * hero that never appears. */
const OVERLAY_LEAVING = 'pf-leaving';

/* The safety valve, and it is the only reason this is safe to do at all.
 * Holding the entrance means the hero is INVISIBLE until something releases
 * it, so "the release never comes" is not a degraded experience, it is a
 * missing name on the front page. Nothing plausible takes the overlay this
 * long — it fades on its own clock the moment the loader is quiet, and even
 * this container's software renderer clears it in ~24s — so the ceiling is
 * far enough out never to fire on a real visit and near enough to be a
 * rescue rather than an epitaph. */
const HOLD_CEILING_MS = 30000;

/**
 * The identity moment: name, role, and status floated over the 3D scene at
 * the first station, plus the advance hint above the control bar. Pure
 * decoration by construction (aria-hidden, pointer-events-none) — the real
 * copy lives in the station panels, and the pilot data lives in
 * src/content/stations.js next to everything else the site says.
 *
 * Scroll-out is frame-driven from the same MotionValue as the flight: one
 * `t.on('change')` subscription writes opacity/transform/visibility straight
 * onto the root ref — zero React state, zero re-renders. Under reduced
 * motion `t` snaps between integers, so this degrades to "visible at
 * station 0, gone elsewhere" with no motion at all; the blink and drift
 * keyframes are disabled in polish.css's reduce block.
 */
export function Hero({ t, mobile }: { t: MotionValue<number>; mobile: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  // Held from the first painted frame, so the entrance starts paused on its
  // opening keyframe rather than playing to an empty room. See the long note
  // on .hero-hold in polish.css for what this is worth and why it is a pause.
  const [held, setHeld] = useState(true);

  useEffect(() => {
    // The overlay is committed in the same React pass as this component, so by
    // the time a passive effect runs it is either in the DOM or was never
    // going to be — a machine with no WebGL renders no BootSequence at all,
    // and on that rung the deck is on screen the instant it mounts.
    const overlay = document.querySelector(OVERLAY);
    if (!overlay?.parentNode) {
      setHeld(false);
      return;
    }
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      obs.disconnect();
      window.clearTimeout(ceiling);
      setHeld(false);
    };
    // Observers, not polling: the window this waits through is precisely the
    // one the main thread spends parsing the WebGL chunk and compiling a
    // hundred-odd shader programs, and that budget has been fought for twice.
    // An observer costs nothing until the mutations that matter; a
    // requestAnimationFrame poll would bill a querySelector to every frame of
    // a stall this repo exists to avoid.
    const obs = new MutationObserver(() => {
      const el = document.querySelector(OVERLAY);
      if (!el || el.classList.contains(OVERLAY_LEAVING)) release();
    });
    obs.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    obs.observe(overlay.parentNode, { childList: true });
    const ceiling = window.setTimeout(release, HOLD_CEILING_MS);
    return () => {
      done = true;
      obs.disconnect();
      window.clearTimeout(ceiling);
    };
  }, []);

  useEffect(() => {
    const apply = (v: number) => {
      const el = root.current;
      if (!el) return;
      const k = smoothstep((v - 0.04) / 0.55);
      el.style.opacity = String(1 - k);
      el.style.transform = `translateY(${-36 * k}px)`;
      el.style.visibility = k >= 0.999 ? 'hidden' : 'visible';
    };
    const off = t.on('change', apply);
    apply(t.get());
    return off;
  }, [t]);

  return (
    <div ref={root} aria-hidden="true" className={held ? 'hero hero-hold' : 'hero'}>
      {/* identity column — three children, staggered in by .hero-in. Mobile
          centers it under the top bar; desktop anchors it LEFT, floated over
          Earth's face, clear of the station panel docked centre-right (the
          centered version put the name straight through the panel —
          screenshot finding). */}
      {/* The mobile column is deliberately 100px tall from a 62px top: that is
          the band between the top bar and the station panel, and the hero has
          to live inside it. The old 86px/gap-6/40px-name composition measured
          ~140px and ran straight over the panel's headline at 320px, which is
          what the audit caught. Every number below was picked against that
          budget — the gap, the chip's padding, and the 34px clamp floor now
          living in polish.css — and .panelwrap's mobile top padding is set to
          match. Desktop is unchanged; it has 15vh and a whole left margin. */}
      <div
        className={
          mobile
            ? 'hero-in absolute inset-x-0 flex flex-col items-center gap-3 px-4'
            : 'hero-in absolute flex flex-col items-start gap-6'
        }
        style={mobile ? { top: '62px' } : { top: '15vh', left: '6vw' }}
      >
        {/* status chip flanked by hairline rules */}
        <div className="flex max-w-full items-center gap-3 sm:gap-4">
          <span className="hero-rule w-10 sm:w-24" />
          <span className="flex items-center gap-2.5 rounded border border-rule-strong bg-panel/70 px-4 py-1.5 sm:px-5 sm:py-2">
            <span className="hero-dot" />
            <span className="whitespace-nowrap font-mono text-2xs uppercase tracking-[0.28em] text-hud">
              {pilot.status}
            </span>
          </span>
          <span className="hero-rule w-10 sm:w-24" />
        </div>

        {/* The name: blurred glow copy behind the crisp gradient-glass layer.
            Each WORD gets its own line, deliberately: the identity moved from
            an 8-character handle to an 18-character full name, and at the
            hero's 92px cap a single nowrap line would want ~1,090px — wider
            than the whole left column, and wider than a phone. Stacked,
            "CARPENTER" at full size holds almost exactly the width the old
            handle held, so the composition the owner signed off survives the
            real name. Splitting on spaces (not a <br> in the data) keeps
            stations.js pure content and degrades to one line for any
            single-word name. */}
        <div className="relative">
          <span aria-hidden="true" className="hero-name-glow absolute inset-0 block font-display font-bold uppercase leading-[0.95]">
            {pilot.name.split(' ').map((w) => (
              <span key={w} className="block">{w}</span>
            ))}
          </span>
          <span className="hero-name relative block font-display font-bold uppercase leading-[0.95]">
            {pilot.name.split(' ').map((w) => (
              <span key={w} className="block">{w}</span>
            ))}
          </span>
        </div>

        {/* The role, bracketed by instrument diamonds.
            `whitespace-nowrap` plus `tracking-[0.3em]` was the audit's
            clearest defect: 0.3em of tracking on a 29-character line needs
            288px before the two diamonds and their gaps, which is more than a
            320px phone has to give. The line ran the full width of the
            viewport, pushed its diamonds off both edges, and printed across
            the station panel underneath it. Letter-spacing is the thing that
            gives, not the wrapping: it drops to 0.16em below sm (still
            unmistakably an instrument eyebrow) and the nowrap comes off
            entirely, so on any width narrow enough to still not fit, the line
            simply takes two. min-w-0 is what lets it: without it the flex
            item refuses to shrink below its content and overflows anyway. */}
        <div className="flex max-w-full items-center gap-2 sm:gap-3">
          <span className="h-1.5 w-1.5 shrink-0 rotate-45 border border-cyan/80 bg-cyan/20" />
          {/* hud-cyan, not --dim: the left-anchored line crosses Earth's lit
              limb, where grey-on-bright disappeared (screenshot finding) */}
          <span className="min-w-0 text-center font-mono text-xs uppercase tracking-[0.16em] text-hud/90 sm:whitespace-nowrap sm:tracking-[0.3em]">
            {pilot.role}
          </span>
          <span className="h-1.5 w-1.5 shrink-0 rotate-45 border border-cyan/80 bg-cyan/20" />
        </div>
      </div>

      {/* Advance hint. Desktop sits 96px up, which clears the .hudbar control
          strip. Phones tuck it lower and smaller: the desktop position put a
          44px pill straight through the station panel's last bullet on the
          short frame Safari actually gives you, and the panel now reserves
          exactly the band this occupies (see the mobile block in polish.css),
          so the two are separated by construction rather than by luck. */}
      <div
        className={`hero-cue absolute inset-x-0 flex items-center justify-center ${
          mobile ? 'bottom-[4.5rem] gap-3' : 'bottom-24 gap-4'
        }`}
      >
        {!mobile && <span className="hero-rule w-32" />}
        <span className="font-mono text-2xs uppercase tracking-[0.25em] text-hud/80">
          {mobile ? 'SWIPE' : 'PRESS'}
        </span>
        <span
          className={`relative rounded-full border border-hud/50 ${
            mobile ? 'advance-pill-sm h-7 w-[1.125rem]' : 'h-11 w-7'
          }`}
        >
          <span className="advance-dot" />
        </span>
        <span className="font-mono text-2xs uppercase tracking-[0.25em] text-hud/80">
          {mobile ? 'TO ADVANCE' : 'SPACE TO ADVANCE'}
        </span>
        {!mobile && <span className="hero-rule w-32" />}
      </div>
    </div>
  );
}
