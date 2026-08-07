import { stations } from '../content/stations.js';

/**
 * The persistent chrome, visible in BOTH modes at every breakpoint. The two
 * escape hatches live here and never move: the PDF for people with four
 * minutes, and the static-page toggle for people who'd rather read. Neither
 * is buried — that's the point.
 */
export function HUD({
  mode,
  current,
  onToggleMode,
}: {
  mode: 'flight' | 'static';
  current: number;
  onToggleMode: () => void;
}) {
  const station = stations[current];
  return (
    <header className="hud">
      <span className="font-mono text-2xs uppercase tracking-widest text-faint">
        Mission Control
      </span>
      {mode === 'flight' && station && (
        <span className="num hidden font-mono text-2xs uppercase tracking-widest text-dim sm:inline">
          {station.code} · {current + 1} / {stations.length}
        </span>
      )}
      <span className="flex-1" />
      <button
        type="button"
        className="btn border border-rule bg-panel px-3 py-1.5 text-xs text-dim"
        onClick={onToggleMode}
      >
        {mode === 'flight' ? 'Skip the flight' : 'Back to the flight'}
      </button>
      <a
        className="btn primary border border-rule-strong bg-raised px-3 py-1.5 text-xs text-ink"
        href="/resume.pdf"
        download
      >
        Résumé PDF
      </a>
    </header>
  );
}
