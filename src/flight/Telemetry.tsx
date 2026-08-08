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
  const altRef = useRef<HTMLSpanElement>(null);
  const velRef = useRef<HTMLSpanElement>(null);
  const secRef = useRef<HTMLSpanElement>(null);
  const lastText = useRef(-Infinity);

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
      if (altRef.current) altRef.current.textContent = `${pad(alt(v), 5)} KM`;
      if (velRef.current) {
        velRef.current.textContent = `${pad(Math.abs(vel.get()) * 900, 4)} M/S`;
      }
      if (secRef.current) secRef.current.textContent = `// ${stations[Math.round(v)]?.code ?? ''}`;
    };
    const apply = (v: number) => {
      const fill = fillRef.current;
      if (fill) fill.style.transform = `scaleY(${Math.min(1, Math.max(0, v / denom))})`;
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
            className={`absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border ${
              i === current
                ? 'border-cyan bg-cyan shadow-[0_0_10px_rgba(76,201,240,0.8)]'
                : 'border-white/40 bg-panel'
            }`}
            style={{ top: `${(i / Math.max(1, n - 1)) * 100}%` }}
          />
        ))}
      </div>

      {/* readouts — written via refs, never state */}
      <div className="flex flex-col items-end gap-1 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.25em] text-hud/70">
        <span className="num">
          ALT <span ref={altRef} />
        </span>
        <span className="num">
          VEL <span ref={velRef} />
        </span>
        <span className="num">
          SEC <span ref={secRef} />
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
