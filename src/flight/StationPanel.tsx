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
  isCurrent,
  onRegister,
}: {
  station: Station;
  index: number;
  pos: Vec;
  t: MotionValue<number>;
  path: FlightPath;
  flip: number;
  reduced: boolean;
  isCurrent: boolean;
  onRegister: (index: number, el: HTMLElement | null) => void;
}) {
  const transform = useTransform(t, (v) => {
    const p = path.posAt(v);
    return `translate3d(${pos.x - p.x}px, ${(pos.y - p.y) * flip}px, 0)`;
  });
  // Distance from the camera drives presence: the current station is solid,
  // neighbours read as "in the distance". Opacity only — never blur/filter.
  const opacity = useTransform(t, (v) => 1 - Math.min(Math.abs(v - index), 1) * 0.62);
  const scale = useTransform(t, (v) => 1 - Math.min(Math.abs(v - index), 1) * 0.05);

  const body = (
    <section
      ref={(el) => onRegister(index, el)}
      tabIndex={-1}
      aria-label={`Station ${index + 1}: ${station.title}`}
      className="panel"
    >
      {/* Re-keying on arrival replays the entrance choreography exactly once
          per visit to the station — content rises as the rocket settles. */}
      <div key={isCurrent ? 'here' : 'away'} className={isCurrent && !reduced ? 'stagger' : undefined}>
        <StationContent station={station} />
      </div>
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
