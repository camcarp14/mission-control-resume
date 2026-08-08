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
      <span className="flex shrink-0 items-baseline gap-2.5 whitespace-nowrap">
        <span className="font-display text-xl font-bold leading-none text-ink">
          cc<span className="text-cyan">.</span>
        </span>
        {/* The descriptor is desktop chrome. A phone has 292px of bar to
            spend and this eyebrow alone wanted 105px of it, which is how all
            three labels ended up on two lines each at 390px — the first
            thing a phone visitor saw after unlock, and it looked broken. The
            mark carries the identity on its own; the two escape hatches are
            what the bar is actually FOR, so they get the width. */}
        <span className="hidden font-mono text-2xs uppercase tracking-widest text-faint sm:inline">
          Mission Control
        </span>
      </span>
      {mode === 'flight' && station && (
        <span className="num hidden whitespace-nowrap font-mono text-2xs uppercase tracking-widest text-dim sm:inline">
          {station.code}{' '}
          <span className="text-hud/70">
            · {current + 1} / {stations.length}
          </span>
        </span>
      )}
      <span className="flex-1" />
      {/* shrink-0 + nowrap on both actions: without them flex-shrink hands
          the overflow back to the type and the labels wrap again the moment
          a string gets longer ("Back to the flight" is four characters
          longer than "Skip the flight"). The tighter phone padding buys the
          margin that keeps this true down to 320px. */}
      <button
        type="button"
        className="btn shrink-0 whitespace-nowrap rounded border border-rule bg-panel px-3 py-1.5 text-xs text-dim sm:px-3.5"
        onClick={onToggleMode}
      >
        {mode === 'flight' ? 'Skip the flight' : 'Back to the flight'}
      </button>
      <a
        className="btn primary hudcta shrink-0 whitespace-nowrap rounded border px-3 py-1.5 text-xs sm:px-4"
        href="/resume.pdf"
        download
      >
        Résumé PDF
      </a>
    </header>
  );
}
