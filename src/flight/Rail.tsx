import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
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

/* ---- the socket, and why the "here" state needed one ----------------------
 * The current diamond was announced entirely by colour and a 1.35 scale: a
 * saturated cyan bead among ten hairline outlines. That says "this one" and
 * nothing else, so on a rail of eleven identical cells the docked station
 * read as a highlighted item in a list rather than as a control sitting in a
 * detent. Every physical console the visual language borrows from seats its
 * live key — a bezel, a recess, a printed bracket — and the seat is what makes
 * the difference between "coloured" and "here".
 *
 * So the "here" state gains a travelling element rather than another rule on
 * the button: one absolutely-positioned mark inside the track, carrying a soft
 * backlight pool and a pair of index ticks, moved with translateX. Two things
 * follow from making it an element instead of per-button styling, and both are
 * the point:
 *
 *   - it TRAVELS. A rail jump from station 2 to 9 slides the seat along the
 *     route on the same --dur-3 the travelled track segment uses, so the two
 *     halves of the map redraw together instead of one sliding while the other
 *     teleports.
 *   - it costs one transform. The alternative (a bezel drawn per button and
 *     toggled) is eleven elements and a paint on every docking.
 *
 * Its position is MEASURED off the live button rather than computed from the
 * 20px cell constant. The constant is true today and stated in polish.css
 * twice, which is exactly the kind of thing that drifts at a breakpoint; a
 * measurement cannot drift. It is one forced layout per docking and per
 * resize, never per frame.
 */
/* The rules for the travelling index mark and the tag stem live in
   src/ui/polish.css under INSTRUMENT MOTION, at the end of the file.
   They were authored in a scoped <style> element here because the round
   that wrote them did not own that stylesheet; the integration pass
   lifted them. */

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
 * plain div in between, which descendant selectors do not notice. The mark
 * added this round is likewise a bare div, aria-hidden by having no content
 * and no role, positioned from a measurement of the buttons it sits on.
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

  const markRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  const currentRef = useRef(current);
  currentRef.current = current;

  const place = useCallback(() => {
    const mark = markRef.current;
    const btn = btns.current[currentRef.current];
    if (!mark || !btn) return;
    // offsetLeft resolves against .railtrack, which is the mark's own
    // positioned ancestor — so this is the same coordinate space with no
    // arithmetic in between, and it stays correct if the row is ever pushed
    // off-centre at a narrow width.
    mark.style.transform = `translateX(${btn.offsetLeft + btn.offsetWidth / 2}px)`;
    if (mark.dataset.seated !== '1') {
      // One frame later, so the browser has a resting position to transition
      // FROM. Seating in the same commit would animate the very first mark
      // across the whole rail from x=0.
      requestAnimationFrame(() => {
        if (markRef.current) markRef.current.dataset.seated = '1';
      });
    }
  }, []);

  useLayoutEffect(place, [current, place]);

  // Breakpoints change the cell padding (12px → 10px on the phone step) and
  // the large-display step moves the whole ramp, so the mark re-measures when
  // the track's box changes. Fires once on observe and then only on real
  // changes — no polling, no resize listener racing the layout.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [place]);

  return (
    <nav aria-label="Stations" className="rail min-w-0 flex-1">
      <div
        ref={trackRef}
        className="railtrack"
        style={{ '--reach': String(reach) } as CSSProperties}
      >
        <div ref={markRef} className="railmark" aria-hidden="true" />
        {stations.map((s, i) => (
          <button
            key={s.id}
            type="button"
            ref={(el) => {
              btns.current[i] = el;
            }}
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
