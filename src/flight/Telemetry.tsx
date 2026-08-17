import { useEffect, useMemo, useRef } from 'react';
import type { MotionValue } from 'framer-motion';
import { useReducedMotion } from 'framer-motion';
import { legInto, makePath3, voyage } from '../engine';
import { stations } from '../content/stations.js';
import { detectTier, readHardwareSignals, tierRank } from '../flight3d/quality';

/**
 * The right-edge instrument column: a vertical progress rail with one
 * diamond per station, bracketed by tick flourishes, over three live
 * readouts (ALT / VEL / SEC). Decorative twin of the real nav — the rail
 * people click lives in Rail.tsx; this one is aria-hidden and
 * pointer-events-none by construction.
 *
 * Perf contract: one `t.on('change')` subscription writes the fill's scaleY
 * on every change (it tracks state, so it stays legitimate under reduced
 * motion where `t` snaps), and the three text lines through a ~8Hz
 * performance.now() gate — textContent writes via refs, zero React state.
 * Only the `current` diamond highlight goes through React, and that changes
 * once per docking, not per frame.
 *
 * The motion added this round obeys the same contract. Every animation here
 * is either (a) a composited style write inside the existing change handler
 * — the comet head — or (b) a fire-and-forget Web Animations one-shot fired
 * on a DISCRETE event: a digit changing, or a waypoint lighting. Nothing new
 * subscribes, nothing new schedules a frame, and every one-shot is skipped
 * outright under reduced motion rather than being shortened.
 */
/** Gauge formatting: clamped, rounded, zero-padded to a constant width. */
const pad = (v: number, width: number) =>
  String(Math.min(10 ** width - 1, Math.max(0, Math.round(v)))).padStart(width, '0');

/**
 * Index of the first SIGNIFICANT digit in a zero-padded gauge figure — i.e.
 * where the quiet leading zeros stop and the number starts.
 *
 * This is the one detail that turns three lines of monospace into an
 * instrument. Every real gauge that pads to a fixed width — an odometer, an
 * altimeter drum, an aircraft fuel totaliser — prints its leading zeros
 * quieter than its significant digits, because the padding is there to hold
 * the column still, not to be read. Rendering all five digits at one weight
 * is what made ALT 07819 read as a string that happens to contain numbers.
 * Dimmed, the boundary between the two runs slides left as the ship climbs
 * and right as it descends, and the readout visibly ROLLS.
 *
 * A figure that is all zeros keeps its last digit bright: a gauge reading
 * zero still has a significant digit, and blanking the line entirely at
 * touchdown — the one frame a visitor lingers on — would read as an
 * instrument that had died rather than one that had landed.
 */
const firstSignificant = (s: string): number => {
  const i = s.search(/[^0]/);
  return i < 0 ? s.length - 1 : i;
};

/** ALT is five drums wide, VEL four. Constants because the DOM is built from
 *  them and `pad()` is called with them — the two can never disagree. */
const ALT_W = 5;
const VEL_W = 4;

/* ---- the drums ------------------------------------------------------------
 * A digit that changes should LAND, not blink. Each figure is a run of
 * one-glyph cells and only the cells whose glyph actually changed get a
 * settle, so a docked instrument is perfectly still and a climbing one has
 * exactly as much motion in it as it has changing digits.
 *
 * Three constraints shaped this into a 130ms translate-and-fade rather than a
 * true rotating drum:
 *
 * 1. WIDTH IS LOAD-BEARING. Scene3D measures this column to bound the station
 *    panels, so the readout's width must be a constant. The cells are
 *    `inline-block` with NO explicit width and NO overflow clipping, which in
 *    a monospace face makes the run measure exactly what the same characters
 *    measured as plain text — the split is invisible to layout. (Clipping the
 *    cells, which a real drum needs, is what breaks it: an inline-block with
 *    `overflow: hidden` takes its bottom margin edge as its baseline, and this
 *    grid is `align-items: baseline`, so the digits would lift off the line
 *    their own labels and units sit on.)
 * 2. IT MUST FIT UNDER THE 8Hz GATE. The text gate is 125ms and the units
 *    digit of VEL changes on nearly every tick in flight, so an animation
 *    longer than the gate would never finish — the readout would smear, which
 *    is the exact failure the gate exists to prevent. 120ms lands inside one
 *    tick with margin, so even the fastest-moving drum is momentarily still
 *    before it turns again.
 * 3. DIRECTION IS INFORMATION. The whole figure rolls the way its value
 *    moved: new digits rise into place while the ship climbs and drop into
 *    place while it descends, so the homecoming reads as a descent on the
 *    instrument as well as in the window.
 */
const ROLL_MS = 120;
const ROLL_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

function roll(el: HTMLElement, dir: number): void {
  // Feature-detected rather than assumed: the readout must still print under
  // any runtime without WAAPI (jsdom in the unit suites is the live case).
  if (typeof el.animate !== 'function') return;
  el.animate(
    [
      { transform: `translateY(${dir >= 0 ? '0.38em' : '-0.38em'})`, opacity: 0.2 },
      { transform: 'translateY(0)', opacity: 1 },
    ],
    // fill: 'none' is deliberate — the cell's resting style is the identity
    // transform, so nothing has to be cleaned up and two overlapping rolls
    // cannot leave a digit stranded off its baseline.
    { duration: ROLL_MS, easing: ROLL_EASE, fill: 'none' },
  );
}

/**
 * Write a padded figure across its run of cells, rolling only what changed.
 * `dir` is the sign of the figure's own movement; `motion` is false under
 * reduced motion, which degrades this to exactly the textContent writes the
 * readout did before.
 */
function setFigure(
  cells: (HTMLSpanElement | null)[],
  s: string,
  dir: number,
  motion: boolean,
): void {
  const sig = firstSignificant(s);
  for (let i = 0; i < cells.length; i++) {
    const el = cells[i];
    if (!el) continue;
    // The quiet/bright boundary is an attribute, not a class: React owns
    // className on these cells and would revert an imperative write on the
    // next docking. It transitions its colour in CSS, so the boundary sliding
    // left as the ship climbs is a fade rather than a step.
    const quiet = i < sig ? '1' : '0';
    if (el.dataset.pad !== quiet) el.dataset.pad = quiet;
    const ch = s[i] ?? '';
    if (el.textContent === ch) continue;
    el.textContent = ch;
    if (motion) roll(el, dir);
  }
}

/** The waypoint flash. Fired ten times in the whole voyage — once per integer
 *  the fill head crosses — so it can afford a box-shadow keyframe. The resting
 *  transform is restated in every keyframe because the diamonds ARE their
 *  transform: a rotated 45° square that forgets its rotation is a bead. */
function pulse(el: HTMLElement): void {
  if (typeof el.animate !== 'function') return;
  const seat = 'translate(-50%, -50%) rotate(45deg)';
  el.animate(
    [
      { transform: `${seat} scale(1)`, boxShadow: '0 0 0 rgba(154, 220, 255, 0)' },
      {
        transform: `${seat} scale(2)`,
        boxShadow: '0 0 12px rgba(154, 220, 255, 0.85)',
        offset: 0.3,
      },
      { transform: `${seat} scale(1)`, boxShadow: '0 0 0 rgba(154, 220, 255, 0)' },
    ],
    { duration: 460, easing: ROLL_EASE, fill: 'none' },
  );
}

/** Speed at which the comet head reaches full extension, in index-units per
 *  second — i.e. the same units `vel` reports.
 *
 *  Calibrated against the real leg physics rather than guessed. Flight's legs
 *  run on cubic-bezier(0.42, 0.05, 0.16, 1), whose peak slope is 2.95x its
 *  average, so a one-station hop (1 unit over 2.6s) peaks at |vel| ≈ 1.14,
 *  a three-leg rail jump (3 units over 3.8s) at ≈ 2.33, and the six-second
 *  homecoming at ≈ 0.48. Putting full extension just above the ordinary hop
 *  means a normal leg reaches the top of the ramp only at its own peak — about
 *  a third of the way in — and tapers off either side, while a long rail jump
 *  saturates, which is exactly the ranking a visitor would expect. Setting it
 *  at the homecoming's peak instead would have pinned the tail at full length
 *  through the whole cruise of every leg, which is a streak, not a comet. */
const COMET_FULL = 1.2;
/** Tail length in multiples of the head element's own 18px, so full extension
 *  is ~41px on a 300px rail: long enough to read as travel, short enough that
 *  it never looks like a second fill. */
const COMET_BASE = 0.3;
const COMET_GAIN = 2;

/* ---- the scanline that isn't here ----------------------------------------
 * A CRT scanline over the readouts was built, photographed and cut, and the
 * measurement is worth keeping so nobody rebuilds it. It was a 3px-period
 * cyan grating on an out-of-flow ::after, radially masked, breathing between
 * 0.34 and 0.6 opacity over five seconds — i.e. the restrained version.
 *
 * Shot at 3x against the black ground at four alphas, it has no useful band:
 * at 4% (the level that could plausibly read as glass) it is invisible in a
 * 3x capture, which is an animation running forever for nothing; at 10% it is
 * unmistakably horizontal stripes lying ON TOP of 9px type, and the readout
 * stops looking like an instrument and starts looking like an instrument with
 * a filter over it. There is no alpha in between where it reads as surface
 * rather than as effect, because the type is too small: the grating's period
 * and the glyph's stroke are the same order, so the moment the stripes are
 * visible at all they are visible AS stripes crossing the digits.
 *
 * The console's own materials already do this job honestly — the radial
 * darkening plate below the type, the drop shadow on the column, the hairline
 * brackets. Cut. */
/* The rules for the drum cells and the comet head live in
   src/ui/polish.css under INSTRUMENT MOTION, at the end of the file.
   They were authored in a scoped <style> element here because the round
   that wrote them did not own that stylesheet; the integration pass
   lifted them. */

export function Telemetry({
  t,
  vel,
  n,
  current,
}: {
  t: MotionValue<number>;
  vel: MotionValue<number>;
  n: number;
  current: number;
}) {
  const reduced = useReducedMotion() ?? false;
  const motion = !reduced;
  // Read once, branch once — and via the PURE DETECTOR, not useQuality().
  // Scene3D mounts QualityContext.Provider inside the r3f Canvas, around the
  // scene tree; this column is a DOM sibling of that canvas, so a useContext
  // from here finds no provider and returns DEFAULT_BUDGET — which is
  // budgetFor('mid', true), i.e. rank 1, i.e. `tierRank(q.tier) > 0` was TRUE
  // on every machine including the floor tier. The gate read as adaptive and
  // was a constant. StationPanel hit the same wall and solved it the same way
  // (see the long note there); doing it identically here is the point, because
  // two DOM-side consumers disagreeing about how to ask is how the next one
  // gets it wrong. readHardwareSignals caches its throwaway GL context for the
  // page's life, so this shares Scene3D's probe and costs nothing.
  //
  // `reduced` IS passed through here, unlike in StationPanel: what this gates
  // is a moving comet head, so a reduced-motion visitor has no use for it at
  // all — and `motion` below already says so. Passing it keeps the tier and
  // the gate telling the same story.
  const tier = useMemo(
    () => detectTier({ mobile: false, reduced, ...readHardwareSignals() }),
    [reduced],
  );
  const comet = motion && tierRank(tier) > 0;

  const fillRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const altCells = useRef<(HTMLSpanElement | null)[]>([]);
  const velCells = useRef<(HTMLSpanElement | null)[]>([]);
  const secRef = useRef<HTMLSpanElement>(null);
  const nodes = useRef<(HTMLSpanElement | null)[]>([]);
  const lastText = useRef(-Infinity);
  const lastLit = useRef(-1);
  // Previous figures, so a drum knows which way it turned. Strings rather than
  // numbers: they are what was actually printed, so a value that rounds to the
  // same digits does not fake a direction.
  const lastAlt = useRef('');
  const lastVel = useRef('');
  const lastSec = useRef('');
  // Rail height in px, measured by a ResizeObserver — the comet head is
  // positioned with translateY and there is no way to express "N% of my
  // PARENT's height" in a transform. Measuring beats writing `top`, which
  // would put a layout in the change handler.
  const railH = useRef(0);

  // ALT used to be `(t / (n-1)) * 420`, which is not an altitude at all — it
  // is the progress bar wearing a unit. Its worst symptom was the finale:
  // the ship sits parked on Navy Pier with the instruments proudly reading
  // ALT +420.0 KM, an instrument visibly lying on the one frame a visitor
  // lingers on. This derives it from the same voyage geometry the camera
  // flies, so the number means something: height above Earth's surface.
  const alt = useMemo(() => {
    const pts = voyage(n);
    const path = makePath3(pts.map((p) => p.camPos));
    const home = pts[0];
    if (!home) return () => 0;
    const [ex, ey, ez] = home.bodyPos;
    const r = home.bodyRadius;
    return (v: number) => {
      const [x, y, z] = path.posAt(v);
      // World units are a composition choice, not a scale — 24 km per unit
      // simply puts the outbound voyage in a range that reads as space
      // travel rather than as a plausible orbit.
      const above = Math.max(0, Math.hypot(x - ex, y - ey, z - ez) - r) * 24;
      // The homecoming leg IS a descent, so altitude bleeds to exactly zero
      // at touchdown. The camera stops a few units above the pad (it is
      // filming the landing, not performing it); the ship does not.
      return above * (1 - legInto(n, n - 1, v));
    };
  }, [n]);

  // One measurement per size change, never per frame.
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    railH.current = el.getBoundingClientRect().height;
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) railH.current = box.height;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const denom = Math.max(1, n - 1);
    let trailing: number | null = null;
    const writeText = () => {
      const v = t.get();
      // Zero-padded to a FIXED width, gauge-style. This is not decoration:
      // Scene3D measures this column once per viewport size to bound the
      // station panels, so a readout that grows a digit mid-flight would
      // silently invalidate that measurement and let the panels drift back
      // into the instruments. Constant width makes the two agree forever.
      const a = pad(alt(v), ALT_W);
      // The very first write seats the drums from an empty DOM — every cell
      // has "changed", so animating it would roll all nine digits at once
      // during the boot stall. An instrument powers on showing its value.
      const seated = lastAlt.current !== '';
      setFigure(altCells.current, a, a >= lastAlt.current ? 1 : -1, motion && seated);
      lastAlt.current = a;
      const s = pad(Math.abs(vel.get()) * 900, VEL_W);
      setFigure(velCells.current, s, s >= lastVel.current ? 1 : -1, motion && seated);
      lastVel.current = s;
      const code = stations[Math.round(v)]?.code ?? '';
      if (secRef.current && code !== lastSec.current) {
        secRef.current.textContent = code;
        if (motion && seated) roll(secRef.current, t.getVelocity() >= 0 ? 1 : -1);
        lastSec.current = code;
      }
    };
    const apply = (v: number) => {
      const p = Math.min(1, Math.max(0, v / denom));
      const fill = fillRef.current;
      if (fill) fill.style.transform = `scaleY(${p})`;
      // ---- the comet head -------------------------------------------------
      // The fill's own gradient already puts its brightest point at the head;
      // this is the streak that trails BEHIND that point while it is moving,
      // and it is driven by the real velocity rather than by a canned
      // animation, so its length is the ship's speed and it is genuinely
      // absent when the ship is docked. Squaring the normalised speed is what
      // makes "absent" mean absent: the tail is gone long before `vel` has
      // finished decaying, so a parked instrument never carries a smear.
      // The scale is SIGNED — the element hangs above its own bottom edge, so
      // a negative scaleY mirrors it below and the tail correctly falls behind
      // the head on the way home.
      const head = headRef.current;
      if (head) {
        const raw = vel.get();
        const sp = Math.min(1, Math.abs(raw) / COMET_FULL);
        const len = (COMET_BASE + COMET_GAIN * sp) * (raw >= 0 ? 1 : -1);
        head.style.transform = `translateY(${p * railH.current}px) scaleY(${len})`;
        head.style.opacity = String(0.95 * sp * sp);
      }
      // ---- the waypoints light as the fill head passes them ---------------
      // Driving this off React's `current` was the obvious wiring and the
      // wrong one: `current` becomes the TARGET the moment a leg starts, so a
      // rail jump from 5 to 8 lit three waypoints instantly while the fill
      // was still leaving 5 — lit diamonds floating a hundred pixels ahead of
      // the lit line for the whole two seconds. Reading `t` puts the two on
      // the same clock, and it costs nothing: `lit` only crosses an integer
      // ten times in the entire voyage, so the classList writes below are ten
      // events, not a per-frame loop.
      //
      // It rides `data-lit` rather than className deliberately. React owns
      // className on these spans and rewrites it on every docking; it has
      // never heard of data-lit, so an imperative write here survives the
      // next render instead of being quietly reverted.
      const lit = Math.floor(v + 1e-6);
      if (lit !== lastLit.current) {
        const prev = lastLit.current;
        lastLit.current = lit;
        nodes.current.forEach((el, i) => {
          if (!el) return;
          const on = i <= lit;
          el.dataset.lit = on ? '1' : '0';
          // Only waypoints the head has just crossed flash, and only after
          // the mount pass has seated them (prev === -1) — arriving at the
          // deck should not set off ten diamonds at once. Flying backwards
          // lights nothing, which is right: the flash is an arrival, and you
          // do not arrive at somewhere you already were.
          if (motion && prev >= 0 && on && i > prev) pulse(el);
        });
      }
      const now = performance.now();
      if (now - lastText.current < 125) {
        // ~8Hz — instruments tick, they don't blur. The gate can swallow the
        // FINAL event of a leg, which froze the readout at whatever the last
        // sampled velocity was (a docked ship reading VEL 9999 — screenshot
        // finding), so a gated write always leaves a trailing one behind.
        if (trailing === null) {
          trailing = window.setTimeout(() => {
            trailing = null;
            writeText();
          }, 140);
        }
        return;
      }
      lastText.current = now;
      writeText();
    };
    lastText.current = -Infinity; // the mount apply must always write text
    lastLit.current = -1; // ...and the mount apply must always seat the nodes
    lastAlt.current = ''; // ...and seat the drums without rolling them
    lastVel.current = '';
    lastSec.current = '';
    const offT = t.on('change', apply);
    // Velocity decays to 0 AFTER t stops changing — without this subscription
    // the settle never reaches the readout.
    const offV = vel.on('change', () => apply(t.get()));
    apply(t.get());
    return () => {
      offT();
      offV();
      if (trailing !== null) window.clearTimeout(trailing);
    };
  }, [t, vel, n, alt, motion]);

  return (
    <div
      aria-hidden="true"
      /* xl, not lg: at 1024 a 560px panel and this column cannot both be seated
         without the body copy running through the readouts — the collision the
         audit caught at 1280/1440 came from assuming they always fit. Scene3D
         measures this element to bound the panels, so the two agree by
         construction rather than by matching constants. */
      className="telemetry pointer-events-none fixed right-8 top-1/2 hidden -translate-y-1/2 flex-col items-center gap-5 xl:flex"
    >
      {/* top bracket: square + hairline tick */}
      <div className="flex flex-col items-center gap-1.5">
        <span className="h-1 w-1 border border-hud/60" />
        <span className="h-5 w-px bg-gradient-to-b from-transparent to-hud/40" />
      </div>

      {/* progress rail: gradient fill tracks t; one diamond per station */}
      <div ref={railRef} className="relative h-[min(300px,38vh)] w-px bg-white/15">
        <div ref={fillRef} className="telemetry-fill absolute inset-0" />
        {comet && <div ref={headRef} className="telemetry-head" />}
        {Array.from({ length: n }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              nodes.current[i] = el;
            }}
            className={`telemetry-node${i === current ? ' here' : ''}`}
            style={{ top: `${(i / Math.max(1, n - 1)) * 100}%` }}
          />
        ))}
      </div>

      {/* Readouts — written via refs, never state. Two columns, because three
          right-aligned strings of unequal length is not a gauge: SEC's line
          is one character longer than ALT's and VEL's, so the three labels
          used to sit on a ragged left edge with SEC hanging a character out
          into space. A label column and a figure column give the block two
          straight edges and cost nothing.

          Each figure is a run of one-glyph drums (see setFigure). The run is
          emitted with no whitespace between cells — a text node between two
          inline-blocks would be a real space and would widen the column that
          Scene3D measures. */}
      <div className="telemetry-read font-mono text-[9px] uppercase tracking-[0.25em]">
        <span className="tl">ALT</span>
        <span className="tv num">
          {Array.from({ length: ALT_W }, (_, i) => (
            <span
              key={i}
              className="tdig"
              ref={(el) => {
                altCells.current[i] = el;
              }}
            />
          ))}
          <span className="tu">KM</span>
        </span>
        <span className="tl">VEL</span>
        <span className="tv num">
          {Array.from({ length: VEL_W }, (_, i) => (
            <span
              key={i}
              className="tdig"
              ref={(el) => {
                velCells.current[i] = el;
              }}
            />
          ))}
          <span className="tu">M/S</span>
        </span>
        <span className="tl">SEC</span>
        <span className="tv num">
          <span className="tp">//</span>
          <span className="tsec" ref={secRef} />
        </span>
      </div>

      {/* bottom bracket, mirrored */}
      <div className="flex flex-col items-center gap-1.5">
        <span className="h-5 w-px bg-gradient-to-b from-hud/40 to-transparent" />
        <span className="h-1 w-1 border border-hud/60" />
      </div>
    </div>
  );
}
