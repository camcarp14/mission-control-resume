import { stations } from '../content/stations.js';

/**
 * The persistent chrome, visible in BOTH modes at every breakpoint. The two
 * escape hatches live here and never move: the PDF for people with four
 * minutes, and the static-page toggle for people who'd rather read. Neither
 * is buried — that's the point. The instrument voice (logo dot, cyan CTA,
 * bottom hairline) is styling only: the visible strings and the download
 * link are load-bearing for the e2e suites and never change.
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
      <span className="flex items-baseline gap-2.5">
        <span className="font-display text-xl font-bold leading-none text-ink">
          cc<span className="text-cyan">.</span>
        </span>
        <span className="font-mono text-2xs uppercase tracking-widest text-faint">
          Mission Control
        </span>
      </span>
      {mode === 'flight' && station && (
        <span className="num hidden font-mono text-2xs uppercase tracking-widest text-dim sm:inline">
          {station.code}{' '}
          <span className="text-hud/70">
            · {current + 1} / {stations.length}
          </span>
        </span>
      )}
      <span className="flex-1" />
      <button
        type="button"
        className="btn rounded-full border border-rule bg-panel px-3.5 py-1.5 text-xs text-dim"
        onClick={onToggleMode}
      >
        {mode === 'flight' ? 'Skip the flight' : 'Back to the flight'}
      </button>
      <a
        className="btn primary hudcta rounded-full border px-4 py-1.5 text-xs"
        href="/resume.pdf"
        download
      >
        Résumé PDF
      </a>
    </header>
  );
}
