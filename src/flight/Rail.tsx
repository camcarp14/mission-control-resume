import { stations } from '../content/stations.js';

/**
 * The progress rail: real buttons, real focus order, ≥42px hit areas around
 * 7px dots (the padding is the tap target). Clickable jumps mean nobody is
 * ever trapped in the linear sequence — the rail is the map, not decoration.
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
  return (
    <nav aria-label="Stations" className="rail min-w-0 flex-1">
      {stations.map((s, i) => (
        <button
          key={s.id}
          type="button"
          aria-current={i === current ? 'step' : undefined}
          aria-label={`Station ${i + 1} of ${stations.length}: ${s.title}`}
          className={i <= visited ? 'visited' : undefined}
          onClick={() => onJump(i)}
        >
          <span className="dot" />
        </button>
      ))}
    </nav>
  );
}
