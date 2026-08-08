import { useEffect, useRef } from 'react';
import type { MotionValue } from 'framer-motion';
import { pilot } from '../content/stations.js';

/** 0→1 hermite ease — retires the hero smoothly as the flight leaves STN 01. */
const smoothstep = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

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
    <div ref={root} aria-hidden="true" className="hero">
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

        {/* the name: blurred glow copy behind the crisp gradient-glass layer */}
        <div className="relative">
          <span className="hero-name-glow absolute inset-0 block font-display font-bold uppercase leading-none">
            {pilot.name}
          </span>
          <span className="hero-name relative block font-display font-bold uppercase leading-none">
            {pilot.name}
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

      {/* advance hint — bottom: 96px clears the .hudbar control strip */}
      <div className="absolute inset-x-0 bottom-24 flex items-center justify-center gap-4">
        {!mobile && <span className="hero-rule w-32" />}
        <span className="font-mono text-2xs uppercase tracking-[0.25em] text-hud/80">
          {mobile ? 'SWIPE' : 'PRESS'}
        </span>
        <span className="relative h-11 w-7 rounded-full border border-hud/50">
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
