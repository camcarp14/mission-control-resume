import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LazyMotion,
  domAnimation,
  animate,
  useMotionValue,
  useReducedMotion,
  useVelocity,
} from 'framer-motion';
import { MOBILE_BREAKPOINT } from '../engine';
import { stations } from '../content/stations.js';
import { Scene3D, webglAvailable } from '../flight3d/Scene3D';
import { BootSequence } from '../flight3d/BootSequence';
import { HUD } from './HUD';
import { Rail } from './Rail';
import { StationPanel } from './StationPanel';
import { StaticMode } from './StaticMode';

/**
 * The flight deck, WebGL era. One MotionValue `t` (continuous station index)
 * is still the single source of truth — it now drives a react-three-fiber
 * solar-system voyage (camera, rocket, bloom) instead of 2D parallax, while
 * the DOM keeps everything that matters: panels, rail, HUD, focus order,
 * announcements. The canvas is aria-hidden decoration by construction.
 *
 * Motion physics carry over verbatim from the 2D deck: `t` moves
 * MONOTONICALLY to its target (house ease-out, 250–400ms); the mass lives in
 * the kick spring, which now displaces the camera and ship along the flight
 * tangent for the departure lunge and arrival settle.
 *
 * Fallback ladder: WebGL + motion → full voyage · WebGL + reduced-motion →
 * still solar backdrop, cross-fading panels · no WebGL → cross-fading panels
 * on the ground colour. Every rung keeps identical controls.
 */

const N = stations.length;
const KICK = 11;

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
  const webgl = useMemo(webglAvailable, []);
  // Flat mode: no travel animation at all — the crossfade deck. Reduced
  // motion chooses it; a machine with no WebGL falls back to it.
  const flat = reduced || !webgl;
  const { vw } = useViewport();
  const mobile = vw < MOBILE_BREAKPOINT;

  const [mode, setMode] = useState<'flight' | 'static'>(() =>
    sessionStorage.getItem('mc.mode') === 'static' ? 'static' : 'flight',
  );
  const start = clampN(initialStation, 0, N - 1);
  const [current, setCurrent] = useState(start);
  const [visited, setVisited] = useState(start);
  const [fromIdx, setFromIdx] = useState(start);
  const currentRef = useRef(start);
  // The live region is written DIRECTLY (textContent), never via state: a
  // setState here re-renders the whole flight tree inside the arrival window
  // — measured at ~55ms under 4× CPU throttle, for one string.
  const announceRef = useRef<HTMLDivElement>(null);

  const t = useMotionValue(start);
  const kick = useMotionValue(0);
  const vel = useVelocity(t);

  const panelRefs = useRef(new Map<number, HTMLElement>());
  // Focus can outrun the panel: the windowing commit is a low-priority
  // transition, and on a saturated main thread (software-rendered WebGL is
  // the measured case) it can still be pending when the travel animation
  // completes. The announcement never waits, and the focus lands the moment
  // the awaited panel registers — latest request wins.
  const pendingFocus = useRef<number | null>(null);

  const registerPanel = useCallback((i: number, el: HTMLElement | null) => {
    if (el) {
      panelRefs.current.set(i, el);
      if (pendingFocus.current === i) {
        pendingFocus.current = null;
        el.focus({ preventScroll: true });
      }
    } else {
      panelRefs.current.delete(i);
    }
  }, []);

  const focusPanel = useCallback((i: number) => {
    const s = stations[i];
    if (s && announceRef.current) {
      announceRef.current.textContent = `Station ${i + 1} of ${N} — ${s.title}`;
    }
    const el = panelRefs.current.get(i);
    if (el) {
      pendingFocus.current = null;
      el.focus({ preventScroll: true });
    } else {
      pendingFocus.current = i;
    }
  }, []);

  const goTo = useCallback(
    (target: number) => {
      const c = clampN(Math.round(target), 0, N - 1);
      const from = currentRef.current;
      if (c === from) return;
      currentRef.current = c;

      if (flat) {
        // Flat mode: an instant reposition and a cross-fade — the flight
        // becomes a slideshow, every control identical.
        setFromIdx(c);
        setCurrent(c);
        setVisited((v) => Math.max(v, c));
        t.set(c);
        return;
      }

      const dur = clampN(0.25 + 0.05 * Math.abs(c - from), 0.25, 0.4);
      const dir = c > from ? 1 : -1;
      animate(kick, KICK * dir, { duration: dur * 0.5, ease: 'easeOut' });
      animate(t, c, {
        duration: dur,
        ease: [0.22, 1, 0.36, 1], // the house --ease-out; monotone, no overshoot
        onComplete: () => {
          // The settle: an underdamped spring back to rest overshoots a few
          // units past the dock — the mass the eye expects, now in 3D.
          animate(kick, 0, { type: 'spring', stiffness: 380, damping: 13 });
          focusPanel(c);
          // Shrinking the panel window unmounts DOM — time-sliced, off the
          // arrival frame.
          startTransition(() => setFromIdx(c));
        },
      });
      // The React commit (windowing mounts, rail state) is real work — it
      // does NOT belong in the keydown task: let the first animation frame
      // paint, then commit as a transition.
      requestAnimationFrame(() => {
        startTransition(() => {
          setFromIdx(from);
          setCurrent(c);
          setVisited((v) => Math.max(v, c));
        });
      });
    },
    [flat, t, kick, focusPanel],
  );

  // Flat-mode arrivals focus after the re-render that mounts the panel.
  useEffect(() => {
    if (flat) focusPanel(current);
  }, [flat, current, focusPanel]);

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
  // in flight. Under flat mode only the current panel exists (true
  // cross-fade).
  const mounted = useMemo(() => {
    const set = new Set<number>();
    if (flat) {
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
  }, [flat, fromIdx, current]);

  return (
    <LazyMotion features={domAnimation} strict>
      <HUD mode={mode} current={current} onToggleMode={toggleMode} />
      {/* Screen readers hear each docking; sighted users see the panel. */}
      <div ref={announceRef} aria-live="polite" className="sr-only" />

      {mode === 'static' ? (
        <StaticMode />
      ) : (
        <>
          <div className="stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {/* The voyage. Decorative sky doubling as the click-anywhere-to-
                advance surface: aria-hidden, no role — a redundant affordance
                over the visible buttons and documented keys. */}
            <div className="absolute inset-0" aria-hidden="true" onClick={advance}>
              {webgl && (
                <Scene3D t={t} kick={kick} vel={vel} n={N} reduced={reduced} vw={vw} />
              )}
            </div>
            {stations.map((s, i) => {
              if (!mounted.has(i)) return null;
              return (
                <StationPanel
                  key={s.id}
                  station={s}
                  index={i}
                  t={t}
                  axis={mobile ? 'y' : 'x'}
                  flat={flat}
                  active={i === current}
                  onRegister={registerPanel}
                />
              );
            })}
          </div>

          {webgl && <BootSequence />}

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
