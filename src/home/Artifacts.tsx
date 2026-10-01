import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WorkItem } from '../content/work.js';
import { primaryLink, ringItems } from '../content/workView';
import { Empty } from '../ui/primitives';
import { IconArtifacts } from './icons';
import { ExpandButton, Theater } from './Theater';

/**
 * The artifacts ring: one browser window per artifact, stood around a
 * cylinder. The window at the front is the one the caption describes. It
 * comes in two sizes, and they are the same component:
 *
 *  - COMPACT, in the home page's middle panel. It drifts slowly while nobody
 *    is touching it, and stops — easing square onto the nearest window — the
 *    moment a pointer hovers it, anything inside it takes focus, or the pause
 *    button is pressed (WCAG 2.2.2: moving content gets a way to stop it).
 *    Drag or swipe turns it; a flick carries on with the finger's speed.
 *    A click (or the expand button) opens the big view on that window.
 *  - BIG, in a full-screen dialog. Larger windows, a full caption with a
 *    visit button, ←/→ on the keyboard, and no drift: you opened it to look.
 *    Tapping a side window turns it to the front; tapping the front window
 *    opens the artifact. Esc, the close button, or the backdrop closes it,
 *    and the compact ring picks up on whichever window you left in front.
 *
 * Neither ever moves under reduced motion, and the compact one only runs
 * while it is on screen and the dialog is shut. With fewer than five
 * artifacts the ring repeats them so it still reads as a ring.
 *
 * The ring itself is pointer-only scenery (aria-hidden). Everything a
 * keyboard or screen reader needs — which artifact, what it is, how to open
 * it, previous / next / pause / expand — is in the caption and the buttons.
 *
 * Motion state lives in refs and is written straight to the DOM from one
 * rAF loop, which stops itself whenever nothing is moving: React re-renders
 * only when the front window changes.
 */
const SPIN_DEG_PER_S = 14;
const TILT_DEG = -7;
const TILT_SIN = Math.sin((-TILT_DEG * Math.PI) / 180);
const HOLD_AFTER_INPUT_MS = 4000;

/** The ring is work.js's live items that have a screenshot (workView.ts). */
const artifacts = ringItems();
/** Where an item's title and window link to — nowhere, for a private build. */
const hrefOf = (a: WorkItem): string | undefined => (a.private ? undefined : primaryLink(a)?.href);

function slotCount(n: number): number {
  if (n <= 1) return n;
  return n >= 5 ? n : n * Math.ceil(6 / n);
}
const mod = (a: number, m: number) => ((a % m) + m) % m;
/** Signed shortest angle, (-180, 180]. */
const wrap = (d: number) => mod(d + 180, 360) - 180;

export default function Artifacts() {
  // The slot the big view opened on (null = shut), and the slot it closed on,
  // which the compact ring jumps to so the two never disagree.
  const [open, setOpen] = useState<number | null>(null);
  const [sync, setSync] = useState<{ slot: number; nonce: number } | null>(null);

  if (artifacts.length === 0) {
    return (
      <Empty
        title="Artifacts are being framed."
        hint="Tools, dashboards, and experiments I’ve built will turn on a ring here. The Space Journey is the full résumé in the meantime."
      />
    );
  }

  return (
    <>
      <Ring frozen={open !== null} syncTo={sync} onExpand={setOpen} />
      {open !== null && (
        <ArtifactsTheater
          start={open}
          onClose={(slot) => {
            setOpen(null);
            setSync((prev) => ({ slot, nonce: (prev?.nonce ?? 0) + 1 }));
          }}
        />
      )}
    </>
  );
}

/* ==== the big view ======================================================== */

function ArtifactsTheater({ start, onClose }: { start: number; onClose: (slot: number) => void }) {
  const frontRef = useRef(start);
  return (
    <Theater id="artifacts-theater-title" title="Artifacts" icon={<IconArtifacts />} onClose={() => onClose(frontRef.current)}>
      <Ring
        big
        initialFront={start}
        onFront={(f) => {
          frontRef.current = f;
        }}
      />
    </Theater>
  );
}

/* ==== the ring ============================================================ */

type Ctl = {
  prev: () => void;
  next: () => void;
  setPaused: (p: boolean) => void;
  setFrozen: (f: boolean) => void;
  jump: (slot: number) => void;
};

type RingProps = {
  big?: boolean | undefined;
  initialFront?: number | undefined;
  /** Compact only: stop drifting (the big view is open over it). */
  frozen?: boolean | undefined;
  /** Compact only: snap to this slot (the big view just closed on it). */
  syncTo?: { slot: number; nonce: number } | null | undefined;
  onExpand?: ((slot: number) => void) | undefined;
  onFront?: ((slot: number) => void) | undefined;
};

function Ring({ big = false, initialFront = 0, frozen = false, syncTo, onExpand, onFront }: RingProps) {
  const n = artifacts.length;
  const slots = slotCount(n);
  const step = slots > 0 ? 360 / slots : 0;
  const single = n === 1;
  const barPx = big ? 30 : 22; // .win-bar height at each size (--bar)

  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const ctl = useRef<Ctl | null>(null);
  const onExpandRef = useRef(onExpand);
  onExpandRef.current = onExpand;
  const onFrontRef = useRef(onFront);
  onFrontRef.current = onFront;
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

  const [geo, setGeo] = useState({ w: 220, r: 240 });
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const [front, setFront] = useState(initialFront);
  const [paused, setPausedState] = useState(false);
  const [reduced, setReduced] = useState(false);

  // Card width and ring radius from the stage's width: the widest window
  // that still lets the neighbours sit beside it without intersecting.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      const cw = el.clientWidth;
      const vh = window.innerHeight;
      if (single) {
        const w = big ? Math.min(720, cw * 0.8, (vh - 300) * 1.6) : Math.min(340, cw * 0.86);
        setGeo({ w: Math.round(Math.max(160, w)), r: 0 });
        return;
      }
      const t = Math.tan(Math.PI / slots);
      const gap = 10;
      // Compact: radius aimed at half the column so the edge-on windows sit
      // at its edges, and windows capped at 200px (shorter on a short
      // laptop screen) so the home page stays one screen tall. Big: the
      // radius takes less of a wide stage (the neighbours still peek in) and
      // most of a phone's, where the front window matters more than seeing
      // the whole ring.
      // The big height cap is the stage's own arithmetic run backwards: the
      // stage is ~0.92w + 46px tall (window, bar, tilt) and the dialog's
      // chrome plus the spec-sheet caption take ~500px, so
      // the whole write-up stays on screen from a 720px-tall window up; below
      // that the dialog scrolls rather than shrinking the windows to nothing.
      const share = big ? (cw < 640 ? 0.85 : 0.42) : 0.5;
      const maxW = big ? 560 : 200;
      const hCap = big ? (vh - 500) * 1.05 : vh - 400;
      const widthCap = 2 * t * (cw * share - gap);
      // The big view must never show SMALLER windows than the panel it came
      // from, so on a short screen it keeps ~220px windows and lets the
      // write-up scroll, instead of shrinking the ring to fit.
      const minW = big ? Math.min(220, widthCap) : 110;
      const w = Math.round(Math.max(minW, Math.min(maxW, hCap, widthCap)));
      setGeo({ w, r: Math.round(w / 2 / t + gap) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [slots, single, big]);

  useEffect(() => {
    const st = stage.current;
    const sec = section.current;
    if (!st || !sec || single) return;

    const s = {
      angle: -initialFront * step,
      target: null as number | null,
      raf: 0,
      last: 0,
      dragging: false,
      hover: false,
      focus: false,
      paused: false,
      visible: true,
      holdUntil: 0,
      front: initialFront,
    };
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedNow = mq.matches;
    setReduced(reducedNow);
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;

    const snap = (a: number) => Math.round(a / step) * step;

    const apply = () => {
      if (ring.current) {
        ring.current.style.transform =
          `translateZ(${-geoRef.current.r}px) rotateX(${TILT_DEG}deg) rotateY(${s.angle}deg)`;
      }
      cards.current.forEach((el, i) => {
        if (!el) return;
        const rel = Math.abs(wrap(i * step + s.angle));
        el.style.setProperty('--veil', (Math.min(1, rel / 90) * 0.72).toFixed(3));
        el.style.pointerEvents = rel > 80 ? 'none' : '';
      });
      const f = mod(Math.round(-s.angle / step), slots);
      if (f !== s.front) {
        s.front = f;
        setFront(f);
        onFrontRef.current?.(f);
      }
    };

    const canAuto = () =>
      !big &&
      !reducedNow &&
      !frozenRef.current &&
      !s.paused &&
      !s.hover &&
      !s.focus &&
      !s.dragging &&
      s.visible &&
      !document.hidden &&
      performance.now() >= s.holdUntil;

    const tick = (now: number) => {
      const dt = s.last ? Math.min(0.05, (now - s.last) / 1000) : 0;
      s.last = now;
      const auto = canAuto();
      if (!s.dragging) {
        if (s.target !== null) {
          if (reducedNow) s.angle = s.target;
          else s.angle += (s.target - s.angle) * (1 - Math.exp(-dt * 8));
          if (Math.abs(s.target - s.angle) < 0.02) {
            s.angle = s.target;
            s.target = null;
          }
        } else if (auto) {
          s.angle -= SPIN_DEG_PER_S * dt;
        }
      }
      apply();
      if (s.dragging || s.target !== null || canAuto()) {
        s.raf = requestAnimationFrame(tick);
      } else {
        s.raf = 0;
        s.last = 0;
      }
    };

    const kick = () => {
      if (!s.raf) s.raf = requestAnimationFrame(tick);
    };
    /** Stop drifting and settle square onto the nearest window. */
    const settle = () => {
      if (s.target === null) s.target = snap(s.angle);
      kick();
    };
    /** After a deliberate input, hold still for a beat before drifting on. */
    const hold = (ms = HOLD_AFTER_INPUT_MS) => {
      s.holdUntil = performance.now() + ms;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(kick, ms + 20);
    };
    const turnBy = (slotsDelta: number) => {
      s.target = snap(s.target ?? s.angle) - slotsDelta * step;
      hold();
      kick();
    };
    const turnTo = (i: number) => {
      const base = s.target ?? s.angle;
      s.target = base + wrap(-i * step - base);
      hold();
      kick();
    };

    ctl.current = {
      prev: () => turnBy(-1),
      next: () => turnBy(1),
      setPaused: (p) => {
        s.paused = p;
        if (p) settle();
        else kick();
      },
      setFrozen: (f) => {
        if (f) settle();
        else hold(1200);
      },
      jump: (i) => {
        // Instant: the ring is behind the closing dialog, nobody sees it turn.
        s.target = null;
        s.angle = s.angle + wrap(-i * step - s.angle);
        apply();
        hold(1500);
      },
    };

    /* ---- drag / swipe / flick ---------------------------------------- */
    let drag: {
      id: number;
      x: number;
      y: number;
      angle: number;
      moved: boolean;
      hist: { t: number; x: number }[];
    } | null = null;
    let suppressClick = false;
    const degPerPx = () => step / (geoRef.current.w * 0.9);

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, angle: s.angle, moved: false, hist: [] };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
          drag.moved = true;
          drag.angle = s.angle;
          drag.x = e.clientX;
          s.dragging = true;
          s.target = null;
          st.setPointerCapture(drag.id);
          st.classList.add('dragging');
          kick();
        } else if (Math.abs(dy) > 10) {
          drag = null; // a vertical scroll, not ours
        }
        return;
      }
      s.angle = drag.angle + (e.clientX - drag.x) * degPerPx();
      const now = performance.now();
      drag.hist.push({ t: now, x: e.clientX });
      while (drag.hist.length > 2 && now - drag.hist[0]!.t > 100) drag.hist.shift();
    };
    const onUp = () => {
      const d = drag;
      drag = null;
      if (!d || !d.moved) return;
      const h = d.hist;
      const first = h[0];
      const last = h[h.length - 1];
      const v = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
      s.dragging = false;
      s.target = snap(s.angle + v * 220 * degPerPx());
      suppressClick = true;
      st.classList.remove('dragging');
      hold();
      kick();
    };
    const onClickCapture = (e: MouseEvent) => {
      if (suppressClick) {
        suppressClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const card = (e.target as Element).closest<HTMLElement>('[data-slot]');
      const i = card ? Number(card.dataset.slot) : s.front;
      // Compact: any click opens the big view, on the window clicked.
      if (!big) {
        e.preventDefault();
        e.stopPropagation();
        onExpandRef.current?.(i);
        return;
      }
      // Big: a side window turns to the front instead of opening.
      if (!card || i === s.front) return;
      e.preventDefault();
      e.stopPropagation();
      turnTo(i);
    };

    /* ---- what pauses the drift --------------------------------------- */
    const onEnter = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      s.hover = true;
      settle();
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      s.hover = false;
      hold(1200);
    };
    const onFocusIn = () => {
      s.focus = true;
      settle();
    };
    const onFocusOut = (e: FocusEvent) => {
      if (sec.contains(e.relatedTarget as Node | null)) return;
      s.focus = false;
      hold(1200);
    };
    const onVis = () => kick();
    const io = new IntersectionObserver(([entry]) => {
      s.visible = entry?.isIntersecting ?? true;
      kick();
    });
    const onMq = () => {
      reducedNow = mq.matches;
      setReduced(reducedNow);
      settle();
    };
    // The big view owns the keyboard while it is open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') turnBy(1);
      else if (e.key === 'ArrowLeft') turnBy(-1);
      else return;
      e.preventDefault();
    };

    st.addEventListener('pointerdown', onDown);
    st.addEventListener('pointermove', onMove);
    st.addEventListener('pointerup', onUp);
    st.addEventListener('pointercancel', onUp);
    st.addEventListener('click', onClickCapture, true);
    st.addEventListener('pointerenter', onEnter);
    st.addEventListener('pointerleave', onLeave);
    sec.addEventListener('focusin', onFocusIn);
    sec.addEventListener('focusout', onFocusOut);
    document.addEventListener('visibilitychange', onVis);
    mq.addEventListener('change', onMq);
    if (big) document.addEventListener('keydown', onKey);
    io.observe(st);

    apply();
    kick();

    return () => {
      cancelAnimationFrame(s.raf);
      clearTimeout(resumeTimer);
      st.removeEventListener('pointerdown', onDown);
      st.removeEventListener('pointermove', onMove);
      st.removeEventListener('pointerup', onUp);
      st.removeEventListener('pointercancel', onUp);
      st.removeEventListener('click', onClickCapture, true);
      st.removeEventListener('pointerenter', onEnter);
      st.removeEventListener('pointerleave', onLeave);
      sec.removeEventListener('focusin', onFocusIn);
      sec.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('visibilitychange', onVis);
      mq.removeEventListener('change', onMq);
      document.removeEventListener('keydown', onKey);
      io.disconnect();
      ctl.current = null;
    };
    // initialFront seeds the angle once; it is deliberately not a dependency.
  }, [slots, step, single, big]);

  // Skip the mount: frozen=false on first render is the resting state, not a
  // dialog closing, and must not hold the first drift back.
  const frozenMounted = useRef(false);
  useEffect(() => {
    if (!frozenMounted.current) {
      frozenMounted.current = true;
      return;
    }
    ctl.current?.setFrozen(frozen);
  }, [frozen]);

  useEffect(() => {
    if (syncTo) ctl.current?.jump(syncTo.slot);
  }, [syncTo]);

  // A resize changes the radius; re-seat the ring at its current angle.
  useLayoutEffect(() => {
    if (!ring.current || single) return;
    ring.current.style.transform = ring.current.style.transform.replace(
      /translateZ\([^)]*\)/,
      `translateZ(${-geo.r}px)`,
    );
  }, [geo.r, single]);

  const a = artifacts[front % n]!;
  const cardH = Math.round((geo.w * 10) / 16) + barPx;
  // The tilt lifts the back of the ring and drops the front by r·sin(tilt);
  // the stage is sized to hold both, because its edge mask clips anything
  // that spills outside it.
  const lift = single ? 0 : Math.round(geo.r * TILT_SIN);
  const ringTop = single ? 4 : lift + 6;
  const stageH = single ? cardH + 8 : ringTop + lift + cardH + 8;

  return (
    <section
      ref={section}
      aria-label="Artifacts"
      aria-roledescription="carousel"
      className={big ? 'ringwrap big' : 'ringwrap'}
    >
      {/* The controls sit ON the stage — arrows over its faded edges, pause
          in the corner — rather than in a row of their own. Expand lives in
          the panel's corner, the same place as the Articles panel's. */}
      {!big && <ExpandButton label="Open artifacts full screen" onClick={() => onExpand?.(front)} />}
      <div className="ring-shell">
        <div
          ref={stage}
          className={`ring-stage${single ? ' single' : ''}${big ? ' big' : ''}`}
          style={{ height: stageH }}
          aria-hidden="true"
          onClick={
            // The ring's own click handling is skipped for a lone window, so
            // the compact single window opens the big view from here.
            single && !big
              ? (e) => {
                  e.preventDefault();
                  onExpand?.(0);
                }
              : undefined
          }
        >
          <div ref={ring} className="ring-pivot" style={{ top: ringTop }}>
            {Array.from({ length: single ? 1 : slots }, (_, i) => {
              const art = artifacts[i % n]!;
              return (
                <div
                  key={i}
                  ref={(el) => {
                    cards.current[i] = el;
                  }}
                  data-slot={i}
                  className="ring-card"
                  style={{
                    width: geo.w,
                    marginLeft: -geo.w / 2,
                    transform: single ? undefined : `rotateY(${i * step}deg) translateZ(${geo.r}px)`,
                  }}
                >
                  <div className="ring-face">
                    <Window a={art} />
                  </div>
                  {/* The back of the window, so the far side of the ring reads
                      as a ring rather than as empty space. */}
                  {!single && <div className="ring-back" />}
                </div>
              );
            })}
          </div>
        </div>
        {!single && (
          <>
            <button type="button" className="btn ring-btn ring-prev" onClick={() => ctl.current?.prev()} aria-label="Previous artifact">
              ←
            </button>
            <button type="button" className="btn ring-btn ring-next" onClick={() => ctl.current?.next()} aria-label="Next artifact">
              →
            </button>
            {!big && !reduced && (
              <button
                type="button"
                className="btn ring-btn ring-pause"
                onClick={() => {
                  const p = !paused;
                  setPausedState(p);
                  ctl.current?.setPaused(p);
                }}
                aria-label={paused ? 'Start the ring turning' : 'Stop the ring turning'}
                aria-pressed={paused}
              >
                {paused ? (
                  <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M2 1l7 4-7 4z" fill="currentColor" />
                  </svg>
                ) : (
                  <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M2 1h2v8H2zM6 1h2v8H6z" fill="currentColor" />
                  </svg>
                )}
              </button>
            )}
          </>
        )}
      </div>

      {big ? (
        // The expanded view's caption is a spec sheet: who/what on the left
        // (count, title, blurb, stack, where to see it), the substance on the
        // right as labelled rows. Keyed so each new front window develops in.
        <div key={a.id} className="sheet pagefade">
          <div className="sheet-lead">
            <p className="sheet-count num">
              {String((front % n) + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
            </p>
            <h3 className="sheet-title">{a.title}</h3>
            <p className="sheet-blurb">{a.summary}</p>
            <ul className="sheet-tags" aria-label="Built with">
              {(a.tags ?? []).map((t) => (
                <li key={t}>{t}</li>
              ))}
              {a.demo && <li className="is-demo">Demo data</li>}
            </ul>
            {hrefOf(a) ? (
              <a className="sheet-visit" href={hrefOf(a)} target="_blank" rel="noopener noreferrer">
                Visit {host(hrefOf(a)!)} <span aria-hidden="true">↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <p className="sheet-private">Private build · shown, not linked</p>
            )}
          </div>
          {a.details && (
            <dl className="sheet-rows">
              {a.details.map((d) => (
                <div key={d.label}>
                  <dt>{d.label}</dt>
                  <dd>{d.text}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ) : (
        // Compact: one quiet meta line, then the title — itself the link out.
        <div key={a.id} className="ring-caption pagefade">
          <p className="ring-meta num">
            {String((front % n) + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
            {(a.tags ?? []).map((t) => (
              <span key={t}>
                <span aria-hidden="true"> · </span>
                {t}
              </span>
            ))}
            {a.demo && <span> · Demo data</span>}
          </p>
          <h3 className="ring-title">
            {hrefOf(a) ? (
              <a href={hrefOf(a)} target="_blank" rel="noopener noreferrer">
                {a.title}
                <span className="ring-title-arrow" aria-hidden="true">
                  ↗
                </span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              a.title
            )}
          </h3>
          <p className="ring-blurb">{a.summary}</p>
        </div>
      )}
    </section>
  );
}

function host(href: string): string {
  try {
    const u = new URL(href);
    return (u.host + (u.pathname === '/' ? '' : u.pathname)).replace(/^www\./, '');
  } catch {
    return href;
  }
}

/** A private build (no `href`) still gets an address bar — it just says so,
 *  and its window is a picture rather than a way in. */
function Window({ a }: { a: WorkItem }) {
  const href = hrefOf(a);
  const view = a.image ? (
    <img src={a.image} alt="" loading="lazy" decoding="async" draggable={false} />
  ) : (
    <span className="win-ph">
      <span className="win-ph-title font-display">{a.title}</span>
    </span>
  );
  return (
    <div className="win">
      <div className="win-bar">
        <span className="win-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="win-url">{href ? host(href) : 'private'}</span>
        <span className="win-dots-spacer" />
      </div>
      {href ? (
        <a
          className="win-view"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={-1}
          draggable={false}
        >
          {view}
        </a>
      ) : (
        <div className="win-view">{view}</div>
      )}
    </div>
  );
}
