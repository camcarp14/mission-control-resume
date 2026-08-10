import { useEffect, useMemo, useRef } from 'react';
import type { MotionValue } from 'framer-motion';
import { legInto, makePath3, voyage } from '../engine';
import { stations } from '../content/stations.js';

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
 */
/** Gauge formatting: clamped, rounded, zero-padded to a constant width. */
const pad = (v: number, width: number) =>
  String(Math.min(10 ** width - 1, Math.max(0, Math.round(v)))).padStart(width, '0');

/**
 * Split a zero-padded gauge figure into [leading zeros, significant run].
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
const digits = (s: string): [string, string] => {
  const i = s.search(/[^0]/);
  return i < 0 ? [s.slice(0, -1), s.slice(-1)] : [s.slice(0, i), s.slice(i)];
};

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
  const fillRef = useRef<HTMLDivElement>(null);
  const altPadRef = useRef<HTMLSpanElement>(null);
  const altRef = useRef<HTMLSpanElement>(null);
  const velPadRef = useRef<HTMLSpanElement>(null);
  const velRef = useRef<HTMLSpanElement>(null);
  const secRef = useRef<HTMLSpanElement>(null);
  const nodes = useRef<(HTMLSpanElement | null)[]>([]);
  const lastText = useRef(-Infinity);
  const lastLit = useRef(-1);

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
      const [az, ad] = digits(pad(alt(v), 5));
      if (altPadRef.current) altPadRef.current.textContent = az;
      if (altRef.current) altRef.current.textContent = ad;
      const [vz, vd] = digits(pad(Math.abs(vel.get()) * 900, 4));
      if (velPadRef.current) velPadRef.current.textContent = vz;
      if (velRef.current) velRef.current.textContent = vd;
      if (secRef.current) secRef.current.textContent = stations[Math.round(v)]?.code ?? '';
    };
    const apply = (v: number) => {
      const fill = fillRef.current;
      if (fill) fill.style.transform = `scaleY(${Math.min(1, Math.max(0, v / denom))})`;
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
        lastLit.current = lit;
        nodes.current.forEach((el, i) => {
          if (el) el.dataset.lit = i <= lit ? '1' : '0';
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
  }, [t, vel, n, alt]);

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
      <div className="relative h-[min(300px,38vh)] w-px bg-white/15">
        <div ref={fillRef} className="telemetry-fill absolute inset-0" />
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
          straight edges and cost nothing. */}
      <div className="telemetry-read font-mono text-[9px] uppercase tracking-[0.25em]">
        <span className="tl">ALT</span>
        <span className="tv num">
          <span className="tz" ref={altPadRef} />
          <span ref={altRef} />
          <span className="tu">KM</span>
        </span>
        <span className="tl">VEL</span>
        <span className="tv num">
          <span className="tz" ref={velPadRef} />
          <span ref={velRef} />
          <span className="tu">M/S</span>
        </span>
        <span className="tl">SEC</span>
        <span className="tv num">
          <span className="tp">//</span>
          <span ref={secRef} />
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
