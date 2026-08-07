import { useEffect, useRef } from 'react';
import { m, useTransform } from 'framer-motion';
import type { MotionValue } from 'framer-motion';
import { StationContent, type Station } from './StationContent';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * One station's DOM panel. Since the WebGL voyage took over the sense of
 * travel, panels no longer carry world transforms — they dock in screen
 * space with a short slide (horizontal on desktop, vertical on mobile) and a
 * distance fade, all still derived from the same MotionValue `t`. Windowed
 * as before: current ±1 mounted, everything else gone.
 *
 * In `flat` mode (reduced motion, or no WebGL) there is no slide at all —
 * only the current panel exists and it cross-fades in.
 */
export function StationPanel({
  station,
  index,
  t,
  axis,
  flat,
  active,
  onRegister,
}: {
  station: Station;
  index: number;
  t: MotionValue<number>;
  /** 'x' — desktop, panels slide in from the right; 'y' — mobile, from below. */
  axis: 'x' | 'y';
  flat: boolean;
  /** True when this is the docked station. Non-active panels are scenery. */
  active: boolean;
  onRegister: (index: number, el: HTMLElement | null) => void;
}) {
  const secRef = useRef<HTMLElement | null>(null);

  // Neighbour panels are a visual preview — to a screen reader or the Tab
  // key they must not exist at all. `inert` removes them from both the a11y
  // tree and focus order in one attribute (aria-hidden alone would leave
  // focusable links inside — an axe critical).
  useEffect(() => {
    if (secRef.current) secRef.current.inert = !active;
  }, [active]);

  const transform = useTransform(t, (v) => {
    const d = clamp(index - v, -1.2, 1.2);
    return axis === 'x'
      ? `translate3d(${d * 150}px, 0, 0)`
      : `translate3d(0, ${d * 110}px, 0)`;
  });
  // Neighbours fade almost out — the voyage behind them is the context now.
  const opacity = useTransform(t, (v) => 1 - Math.min(Math.abs(v - index), 1) * 0.88);
  const scale = useTransform(t, (v) => 1 - Math.min(Math.abs(v - index), 1) * 0.045);

  const body = (
    <section
      ref={(el) => {
        secRef.current = el;
        onRegister(index, el);
      }}
      tabIndex={-1}
      aria-label={`Station ${index + 1}: ${station.title}`}
      className={flat ? 'panel' : 'panel pagefade'}
    >
      <StationContent station={station} />
    </section>
  );

  if (flat) {
    return (
      <div className="panelwrap">
        <div className="xfade w-full max-w-[560px]">{body}</div>
      </div>
    );
  }

  return (
    <div className="panelwrap">
      <m.div style={{ transform, opacity, scale }} className="w-full max-w-[560px]">
        {body}
      </m.div>
    </div>
  );
}
