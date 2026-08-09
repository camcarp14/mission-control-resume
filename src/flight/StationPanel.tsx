import { useEffect, useRef } from 'react';
import { m, useTransform } from 'framer-motion';
import type { MotionValue } from 'framer-motion';
import { StationContent, type Station } from './StationContent';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * One station's DOM panel. Three docking modes:
 *
 * ANCHORED (desktop flight, WebGL): the panel belongs to its PLANET — the
 * Rig projects a point beside the body every frame and writes translate3d
 * onto the .anchorpos wrapper (registered via onAnchor), so the panel
 * arrives WITH its planet, decelerates with the camera, and never moves
 * again after dock. Opacity/scale still derive from the same MotionValue.
 *
 * SLIDE (mobile flight): the panel docks with a short vertical slide — the
 * mobile framing composes bodies loosely, so a world anchor buys nothing at
 * 390px and risks parking panels off-frame.
 *
 * FLAT (reduced motion, or no WebGL): no motion at all — only the current
 * panel exists and it cross-fades in.
 */
export function StationPanel({
  station,
  index,
  t,
  axis,
  flat,
  active,
  onRegister,
  onAnchor,
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
  /** Registers the world-anchored positioning wrapper (desktop flight only);
   *  the 3D rig writes its transform directly. */
  onAnchor?: (index: number, el: HTMLDivElement | null) => void;
}) {
  const secRef = useRef<HTMLElement | null>(null);

  // Neighbour panels are a visual preview — to a screen reader or the Tab
  // key they must not exist at all. `inert` removes them from both the a11y
  // tree and focus order in one attribute (aria-hidden alone would leave
  // focusable links inside — an axe critical).
  useEffect(() => {
    if (secRef.current) secRef.current.inert = !active;
  }, [active]);

  // A generous slide — the outgoing panel must clear its own 560px width, or
  // the incoming one reads as double-exposed text (a real screenshot finding,
  // not a guess). Fully faded by three-quarters of a leg: mid-travel the
  // frame belongs to the voyage, not to two ghost panels.
  const transform = useTransform(t, (v) => {
    const d = clamp(index - v, -1.2, 1.2);
    return axis === 'x'
      ? `translate3d(${d * 560}px, 0, 0)`
      : `translate3d(0, ${d * 340}px, 0)`;
  });
  // Gone by half a leg: at the old 0.75 falloff, two ghost panels
  // double-exposed over each other through the long return flight.
  const opacity = useTransform(t, (v) => 1 - Math.min(Math.abs(v - index) / 0.45, 1));
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

  // `hero` marks the one station that has an identity column floated above
  // it. Only the mobile block in polish.css reads it — on desktop the class
  // matches no rule, so the anchored layout is untouched by construction.
  const wrap = index === 0 ? 'panelwrap hero' : 'panelwrap';

  if (flat) {
    return (
      <div className={wrap}>
        <div className="xfade w-full max-w-[560px]">{body}</div>
      </div>
    );
  }

  if (axis === 'x' && onAnchor) {
    return (
      <div className="panelwrap anchored">
        <div ref={(el) => onAnchor(index, el)} className="anchorpos">
          <m.div style={{ opacity, scale }} className="w-full max-w-[560px]">
            {body}
          </m.div>
        </div>
      </div>
    );
  }

  return (
    <div className={wrap}>
      <m.div style={{ transform, opacity, scale }} className="w-full max-w-[560px]">
        {body}
      </m.div>
    </div>
  );
}
