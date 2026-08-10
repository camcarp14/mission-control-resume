import type { CSSProperties } from 'react';
import { stations } from '../content/stations.js';

/**
 * The head of a station title — "Pipeline" out of "Pipeline — Events to
 * Answers". Deliberately the SAME grammar src/flight3d/StationLabels.tsx uses
 * to paint the signage floating beside each planet, em dash and en dash and
 * run-collapse included, so the tag that rises off a rail diamond and the
 * hundred-pixel plate in the sky name the station with the same word. Two
 * different shortenings of the same title is the kind of seam a visitor
 * cannot name and reads as sloppiness anyway.
 */
const signage = (title: string) =>
  (title.split(/\s*[—–]\s*/)[0] ?? title).replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * The progress rail: real buttons, real focus order, ≥42px hit areas around
 * 7px diamonds (the padding is the tap target — the .dot span is a rotated-45°
 * instrument diamond, styled entirely in polish.css). Clickable jumps mean
 * nobody is ever trapped in the linear sequence — the rail is the map, not
 * decoration.
 *
 * A map owes three answers, and until this round it gave one. "You are here"
 * was never in doubt; "how far have I come" and "what is that one" were not
 * answered at all. The .railtrack wrapper supplies the first — it is the
 * element the hairline route and its lit travelled segment are drawn on, and
 * `--reach` is the only number that segment needs. The `data-tag` supplies the
 * second: a station name that surfaces on hover and on keyboard focus.
 *
 * Both are decoration on top of an unchanged control. The buttons, their
 * order, their aria-labels and the `.rail button` selector every script and
 * check in the repo reaches for are exactly what they were; the wrapper is a
 * plain div in between, which descendant selectors do not notice.
 */
export function Rail({
  current,
  visited,
  onJump,
}: {
  current: number;
  visited: number;
  onJump: (i: number) => void;
}) {
  // Fraction of the route behind the visitor. The denominator is legs, not
  // stations — arriving at the last of eleven has covered ten of them, and a
  // route that stopped at 10/11 with the ship parked on its final diamond
  // would be an instrument visibly short of the truth.
  const reach = Math.min(1, Math.max(0, visited / Math.max(1, stations.length - 1)));
  return (
    <nav aria-label="Stations" className="rail min-w-0 flex-1">
      <div className="railtrack" style={{ '--reach': String(reach) } as CSSProperties}>
        {stations.map((s, i) => (
          <button
            key={s.id}
            type="button"
            aria-current={i === current ? 'step' : undefined}
            aria-label={`Station ${i + 1} of ${stations.length}: ${s.title}`}
            className={i <= visited ? 'visited' : undefined}
            /* Generated content, so it never reaches the accessibility tree
               through a route the aria-label above does not already own. */
            data-tag={`${s.code} · ${signage(s.title)}`}
            onClick={() => onJump(i)}
          >
            <span className="dot" />
          </button>
        ))}
      </div>
    </nav>
  );
}
