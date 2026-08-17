import { stations } from '../content/stations.js';

/* ---- the two things the masthead was missing ------------------------------
 *
 * 1. THE COUNTER NEVER MOVED. "STN 06 · 6 / 11" is the only element in the top
 *    bar that is live, and it changed by being replaced between two frames —
 *    the same way a typo gets corrected. On a console whose entire conceit is
 *    that the chrome is instrumentation, the one live readout up there should
 *    settle when it takes a new value. It is keyed on `current`, so React
 *    remounts the run on each docking and the animation restarts by
 *    construction rather than by a class being toggled off and on.
 *    The two halves land in sequence — the section code, then the tally 80ms
 *    behind it — because a single block fading in reads as a page transition
 *    while two runs landing in order reads as a mechanism. The tally is an
 *    inline span inside a block, so it gets opacity only: transforms do not
 *    apply to non-replaced inline boxes, and asking for one would have been a
 *    rule that silently did nothing.
 *
 * 2. THE PRESS WAS BORROWED. Both actions inherit .btn's scale(0.97), which is
 *    the system's press and is correct everywhere else on the site. In the top
 *    bar it fought the hover: .btn.primary and .btn.hudcta both lift by 1px on
 *    hover, so pressing them ran the scale and the un-lift on the SAME 140ms
 *    curve and the button drifted down rather than being pushed. Real press
 *    physics are asymmetric — a control goes down faster than it comes back —
 *    so the active state states its own transform (the lift explicitly zeroed
 *    rather than left to cancel) and shortens the duration to 70ms on the way
 *    in only. Release inherits the 140ms house curve again. The inset shadow
 *    is what makes the two buttons read as pressed INTO the bar rather than
 *    scaled: without it a shrinking button just gets smaller.
 */
/* The rules for all of the above live in src/ui/polish.css under INSTRUMENT
   MOTION, at the end of the file. They were authored in a scoped <style>
   element here because the round that wrote them did not own that stylesheet;
   the integration pass lifted them. Their position at the bottom of
   polish.css is load-bearing — `.hud .btn:active` ties with `.btn:active` and
   `.btn.hudcta:hover` on specificity and resolves by source order — so do not
   move them earlier without re-checking the press. */

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
      {/* ---- ONE baseline for the whole masthead ---------------------------
          The station readout used to be a sibling of this group rather than a
          member of it, and that one level of nesting was worth 3.5 measured
          pixels: .hud centres its children, so the tall identity group (a
          20px display mark) and the short readout (a 14px mono line) were
          each centred independently and their baselines landed 3.5px apart —
          two mono eyebrows of the SAME size, in the same bar, sitting on two
          different lines. Nobody can name that and everybody sees it.
          Inside one items-baseline group the three runs sit on one line, and
          the group then centres as a single object. */}
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
        {mode === 'flight' && station && (
          <>
            {/* The hairline is the grammar the two runs were missing: one
                says what this console IS, the other says where in it you
                are, and a bare 10px gap made them read as one ragged
                sentence.
                self-baseline, so the tick's foot sits ON the shared baseline
                and its head lands within a pixel of the eyebrows' cap
                height — a rule that floats off the type it separates is the
                thing that makes a separator look bolted on. 0.5rem rather
                than 8px so it steps with the type on a large display. */}
            <span
              aria-hidden="true"
              className="hidden h-2 w-px shrink-0 self-baseline bg-rule-strong sm:inline-block"
            />
            <span
              key={current}
              className="hudtick num hidden whitespace-nowrap font-mono text-2xs uppercase tracking-widest text-dim sm:inline"
            >
              {station.code}{' '}
              <span className="hudtick-b text-hud/70">
                · {current + 1} / {stations.length}
              </span>
            </span>
          </>
        )}
      </span>
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
        download="Cameron-Carpenter-Resume.pdf"
      >
        Résumé PDF
      </a>
    </header>
  );
}
