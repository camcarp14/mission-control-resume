import { useEffect, useRef } from 'react';
import { m, useTransform } from 'framer-motion';
import type { MotionValue } from 'framer-motion';
import type { FlightPath, Vec } from '../engine';
import { StationContent, type Station } from './StationContent';

/**
 * One station, mounted only while the camera is near it (current ±1, plus the
 * departure neighbourhood mid-jump). Each panel carries its OWN world
 * transform — there is deliberately no world-sized container to composite.
 * The wrapper is a full-viewport grid cell translated by (station − camera),
 * so at arrival the panel sits exactly in the resting slot.
 */
export function StationPanel({
  station,
  index,
  pos,
  t,
  path,
  flip,
  reduced,
  active,
  onRegister,
}: {
  station: Station;
  index: number;
  pos: Vec;
  t: MotionValue<number>;
  path: FlightPath;
  flip: number;
  reduced: boolean;
  /** True when this is the docked station. Non-active panels are scenery. */
  active: boolean;
  onRegister: (index: number, el: HTMLElement | null) => void;
}) {
  const secRef = useRef<HTMLElement | null>(null);

  // Neighbour panels are a visual preview at 40% opacity — to a screen reader
  // or the Tab key they must not exist at all. `inert` removes them from both
  // the a11y tree and focus order in one attribute (aria-hidden alone would
  // leave focusable links inside — an axe critical).
  useEffect(() => {
    if (secRef.current) secRef.current.inert = !active;
  }, [active]);
  const transform = useTransform(t, (v) => {
    const p = path.posAt(v);
    return `translate3d(${pos.x - p.x}px, ${(pos.y - p.y) * flip}px, 0)`;
  });
  // Distance from the camera drives presence: the current station is solid,
  // neighbours read as "in the distance". Opacity only — never blur/filter.
  const opacity = useTransform(t, (v) => 1 - Math.min(Math.abs(v - index), 1) * 0.62);
  const scale = useTransform(t, (v) => 1 - Math.min(Math.abs(v - index), 1) * 0.05);

  // No re-keying, no remount on arrival: rebuilding the content DOM mid-
  // transition cost 50ms+ under 4× CPU throttle (a measured long task inside
  // the interaction window). The arrival choreography is carried entirely by
  // the distance-driven opacity/scale above plus a one-time compositor-only
  // pagefade when the panel first mounts (off-screen for neighbours, the
  // liftoff moment for station 1).
  const body = (
    <section
      ref={(el) => {
        secRef.current = el;
        onRegister(index, el);
      }}
      tabIndex={-1}
      aria-label={`Station ${index + 1}: ${station.title}`}
      className={reduced ? 'panel' : 'panel pagefade'}
    >
      <StationContent station={station} />
    </section>
  );

  if (reduced) {
    // Reduced motion: no world transform, no distance fade — the current
    // panel cross-fades in place (only the current one is mounted).
    return (
      <div className="panelwrap">
        <div className="xfade w-full max-w-[560px]">{body}</div>
      </div>
    );
  }

  return (
    <m.div className="panelwrap" style={{ transform }}>
      <m.div style={{ opacity, scale }} className="w-full max-w-[560px]">
        {body}
      </m.div>
    </m.div>
  );
}
