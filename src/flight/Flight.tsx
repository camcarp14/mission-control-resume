import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LazyMotion,
  domAnimation,
  animate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  useVelocity,
} from 'framer-motion';
import { MOBILE_BREAKPOINT, makePath, stationPositions } from '../engine';
import { stations } from '../content/stations.js';
import { HUD } from './HUD';
import { Rail } from './Rail';
import { Rocket } from './Rocket';
import { Stars } from './Stars';
import { StationPanel } from './StationPanel';
import { StaticMode } from './StaticMode';

/**
 * The flight deck. One MotionValue `t` (continuous station index) is the
 * single source of truth: the camera, every panel, the parallax sky, the
 * rocket's heading and the flame all derive from it — Framer writes the
 * transforms straight to style, so nothing re-renders per frame.
 *
 * Motion physics, per the adversarial design review:
 *   - `t` moves MONOTONICALLY to its target (house ease-out, 250–400ms).
 *     Overshoot in `t` would sample the next spline segment and visibly hook
 *     the rocket at bends, so it is banned by construction.
 *   - The "mass" lives in rocket-local space: a small kick spring lunges the
 *     sprite forward on departure and overshoots-and-settles on arrival,
 *     while the heading lags the tangent through a spring.
 */

const N = stations.length;
const MAX_TILT = 18; // degrees off-axis — past this the ship reads frantic
const KICK = 11; // px of rocket-local lunge

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function useViewport() {
  const [v, setV] = useState({ vw: window.innerWidth, vh: window.innerHeight });
  useEffect(() => {
    const on = () => setV({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}

export default function Flight({
  initialStation = 0,
  onStationReached,
}: {
  initialStation?: number;
  onStationReached?: (index: number, stationCount: number) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const { vw, vh } = useViewport();
  const mobile = vw < MOBILE_BREAKPOINT;
  // Mobile flies BOTTOM-UP (the rocket climbs), so world-y is flipped on the
  // way to the screen. Desktop reads left-to-right, unflipped.
  const flip = mobile ? -1 : 1;

  const positions = useMemo(() => stationPositions(N, vw, vh), [vw, vh]);
  const path = useMemo(() => makePath(positions), [positions]);

  const [mode, setMode] = useState<'flight' | 'static'>(() =>
    sessionStorage.getItem('mc.mode') === 'static' ? 'static' : 'flight',
  );
  const start = clampN(initialStation, 0, N - 1);
  const [current, setCurrent] = useState(start);
  const [visited, setVisited] = useState(start);
  const [fromIdx, setFromIdx] = useState(start);
  const [flareKey, setFlareKey] = useState(0);
  const [announce, setAnnounce] = useState('');
  const currentRef = useRef(start);

  const t = useMotionValue(start);
  const kick = useMotionValue(0);
  const kickX = useTransform(kick, (k) => (mobile ? 0 : k));
  const kickY = useTransform(kick, (k) => (mobile ? -k : 0));

  const rotateRaw = useTransform(t, (v) => {
    const deg = (path.headingAt(v) * 180) / Math.PI;
    // Desktop: tilt around "pointing right". Mobile (world flipped, climbing):
    // tilt around "pointing up"; drift right in world tilts the nose right.
    return mobile ? -90 + clampN(90 - deg, -MAX_TILT, MAX_TILT) : clampN(deg, -MAX_TILT, MAX_TILT);
  });
  const rotateSpring = useSpring(rotateRaw, { stiffness: 140, damping: 18 });

  const vel = useVelocity(t);
  const flameScaleX = useTransform(vel, (v) => 0.55 + Math.min(Math.abs(v) / 3.5, 1) * 0.95);
  const flameOpacity = useTransform(vel, (v) => 0.55 + Math.min(Math.abs(v) / 3.5, 1) * 0.45);

  const panelRefs = useRef(new Map<number, HTMLElement>());
  const registerPanel = useCallback((i: number, el: HTMLElement | null) => {
    if (el) panelRefs.current.set(i, el);
    else panelRefs.current.delete(i);
  }, []);

  const focusPanel = useCallback((i: number) => {
    panelRefs.current.get(i)?.focus({ preventScroll: true });
    const s = stations[i];
    if (s) setAnnounce(`Station ${i + 1} of ${N} — ${s.title}`);
  }, []);

  const goTo = useCallback(
    (target: number) => {
      const c = clampN(Math.round(target), 0, N - 1);
      const from = currentRef.current;
      if (c === from) return;
      currentRef.current = c;
      setFromIdx(from);
      setCurrent(c);
      setVisited((v) => Math.max(v, c));

      if (reduced) {
        // Reduced motion: an instant reposition and a cross-fade — the flight
        // becomes a slideshow, every control identical.
        t.set(c);
        setFromIdx(c);
        return;
      }

      const dur = clampN(0.25 + 0.05 * Math.abs(c - from), 0.25, 0.4);
      const dir = c > from ? 1 : -1;
      setFlareKey((k) => k + 1); // thrust burst on departure
      animate(kick, KICK * dir, { duration: dur * 0.5, ease: 'easeOut' });
      animate(t, c, {
        duration: dur,
        ease: [0.22, 1, 0.36, 1], // the house --ease-out; monotone, no overshoot
        onComplete: () => {
          setFromIdx(c);
          // The settle: an underdamped spring back to rest overshoots a few
          // px past the dock — the mass the eye expects.
          animate(kick, 0, { type: 'spring', stiffness: 380, damping: 13 });
          focusPanel(c);
        },
      });
    },
    [reduced, t, kick, focusPanel],
  );

  // Reduced-motion arrivals focus after the re-render that mounts the panel.
  useEffect(() => {
    if (reduced) focusPanel(current);
  }, [reduced, current, focusPanel]);

  const advance = useCallback(() => goTo(currentRef.current + 1), [goTo]);
  const back = useCallback(() => goTo(currentRef.current - 1), [goTo]);

  // Liftoff: land focus on the opening station so keyboard users can fly
  // immediately without a tab-hunt.
  useEffect(() => {
    focusPanel(currentRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The visit log hears about every arrival; the gate layer debounces.
  useEffect(() => {
    onStationReached?.(current, N);
  }, [current, onStationReached]);

  useEffect(() => {
    if (mode !== 'flight') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select')) return;
      // Space activates buttons/links natively — never hijack it there.
      if (e.key === ' ' && el?.closest('button, a, [role="button"], video')) return;
      switch (e.key) {
        case ' ':
        case 'ArrowRight':
        case 'PageDown':
          e.preventDefault();
          goTo(currentRef.current + 1);
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          goTo(currentRef.current - 1);
          break;
        case 'Home':
          e.preventDefault();
          goTo(0);
          break;
        case 'End':
          e.preventDefault();
          goTo(N - 1);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, goTo]);

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const p = e.touches[0];
    touchStart.current = p ? { x: p.clientX, y: p.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchStart.current;
    const p = e.changedTouches[0];
    touchStart.current = null;
    if (!s || !p) return;
    const dx = p.clientX - s.x;
    const dy = p.clientY - s.y;
    // Right or up advances; left or down reverses. Both axes work at every
    // breakpoint so nobody has to guess which way this flight runs.
    if ((dx > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) || (dy < -50 && Math.abs(dy) > 1.5 * Math.abs(dx))) advance();
    else if ((dx < -50 && Math.abs(dx) > 1.5 * Math.abs(dy)) || (dy > 50 && Math.abs(dy) > 1.5 * Math.abs(dx))) back();
  };

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next = prev === 'flight' ? 'static' : 'flight';
      sessionStorage.setItem('mc.mode', next);
      return next;
    });
  }, []);

  // Windowing: current ±1, plus the departure neighbourhood while a jump is
  // in flight — never the whole route, never a world-sized layer. Under
  // reduced motion only the current panel exists (true cross-fade).
  const mounted = useMemo(() => {
    const set = new Set<number>();
    if (reduced) {
      set.add(current);
    } else {
      for (const c of [fromIdx, current]) {
        for (const d of [-1, 0, 1]) {
          const i = c + d;
          if (i >= 0 && i < N) set.add(i);
        }
      }
    }
    return set;
  }, [reduced, fromIdx, current]);

  return (
    <LazyMotion features={domAnimation} strict>
      <HUD mode={mode} current={current} onToggleMode={toggleMode} />
      {/* Screen readers hear each docking; sighted users see the panel. */}
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>

      {mode === 'static' ? (
        <StaticMode />
      ) : (
        <>
          <div className="stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <Stars t={t} path={path} flip={flip} mobile={mobile} reduced={reduced} onAdvance={advance} />
            {stations.map((s, i) => {
              const pos = positions[i];
              if (!mounted.has(i) || !pos) return null;
              return (
                <StationPanel
                  key={s.id}
                  station={s}
                  index={i}
                  pos={pos}
                  t={t}
                  path={path}
                  flip={flip}
                  reduced={reduced}
                  isCurrent={i === current}
                  onRegister={registerPanel}
                />
              );
            })}
            <Rocket
              anchor={mobile ? { left: '50%', top: '12%' } : { left: '27%', top: '46%' }}
              size={mobile ? 76 : 116}
              rotate={reduced ? rotateRaw : rotateSpring}
              kickX={kickX}
              kickY={kickY}
              flameScaleX={flameScaleX}
              flameOpacity={flameOpacity}
              flareKey={flareKey}
              reduced={reduced}
            />
          </div>

          <div className="hudbar">
            <div className="mr-2 hidden items-center gap-1.5 lg:flex" aria-hidden="true">
              <kbd>space</kbd>
              <span className="text-2xs text-faint">advance</span>
              <kbd>←</kbd>
              <span className="text-2xs text-faint">back</span>
            </div>
            <button
              type="button"
              className="btn border border-rule bg-panel px-3.5 py-2 text-xs text-dim disabled:cursor-default disabled:opacity-40"
              onClick={back}
              disabled={current === 0}
            >
              ← <span className="hidden sm:inline">Back</span>
            </button>
            <Rail current={current} visited={visited} onJump={goTo} />
            <button
              type="button"
              className="btn primary border border-rule-strong bg-raised px-3.5 py-2 text-xs text-ink disabled:cursor-default disabled:opacity-40"
              onClick={advance}
              disabled={current === N - 1}
            >
              <span className="hidden sm:inline">Advance</span> →
            </button>
          </div>
        </>
      )}
    </LazyMotion>
  );
}
