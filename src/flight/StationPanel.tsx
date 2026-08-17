import { useEffect, useMemo, useRef } from 'react';
import { m, useTransform } from 'framer-motion';
import type { MotionValue } from 'framer-motion';
import { detectTier, readHardwareSignals } from '../flight3d/quality';
import { StationContent, type Station } from './StationContent';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ---- when the panel starts assembling ------------------------------------
 * Distance in stations, not milliseconds, because the leg is not a fixed
 * length: a neighbouring advance takes 2.6s, a rail jump 4.8, the homecoming
 * 6.2. What IS fixed is the shape of the leg — the same ease every time — so
 * a distance threshold lands at the same PLACE in every arrival: 0.25 of a
 * leg out is about 1.4 seconds from rest on a short leg, with the panel at
 * roughly half opacity, which is where its parts can first be read. The
 * 420ms assembly therefore finishes into the deceleration rather than after
 * it, and no leg is made one millisecond longer.
 *
 * The second number is hysteresis, and it is what keeps a hesitant visitor —
 * pressing back mid-leg, or nudging the rail — from re-triggering the
 * entrance every few frames at the boundary. Enter at 0.25, leave at 0.32.
 */
const REVEAL_IN = 0.25;
const REVEAL_OUT = 0.32;

/**
 * One station's DOM panel. Three docking modes:
 *
 * ANCHORED (desktop flight, WebGL): the panel belongs to its PLANET — the
 * Rig projects a point beside the body every frame and writes translate3d
 * onto the .anchorpos wrapper (registered via onAnchor), so the panel
 * arrives WITH its planet, decelerates with the camera, and never moves
 * again after dock. Opacity/scale still derive from the same MotionValue.
 *
 * SLIDE (mobile flight): the panel docks with a short vertical slide — the
 * mobile framing composes bodies loosely, so a world anchor buys nothing at
 * 390px and risks parking panels off-frame.
 *
 * FLAT (reduced motion, or no WebGL): no motion at all — only the current
 * panel exists and it cross-fades in.
 */
export function StationPanel({
  station,
  index,
  t,
  axis,
  flat,
  active,
  onRegister,
  onAnchor,
}: {
  station: Station;
  index: number;
  t: MotionValue<number>;
  /** 'x' — desktop, panels slide in from the right; 'y' — mobile, from below. */
  axis: 'x' | 'y';
  flat: boolean;
  /** True when this is the docked station. Non-active panels are scenery. */
  active: boolean;
  onRegister: (index: number, el: HTMLElement | null) => void;
  /** Registers the world-anchored positioning wrapper (desktop flight only);
   *  the 3D rig writes its transform directly. */
  onAnchor?: (index: number, el: HTMLDivElement | null) => void;
}) {
  const secRef = useRef<HTMLElement | null>(null);

  // Neighbour panels are a visual preview — to a screen reader or the Tab
  // key they must not exist at all. `inert` removes them from both the a11y
  // tree and focus order in one attribute (aria-hidden alone would leave
  // focusable links inside — an axe critical).
  useEffect(() => {
    if (secRef.current) secRef.current.inert = !active;
  }, [active]);

  /* ---- how much SURFACE this machine can afford --------------------------
   * The panel's glass — three gradients and four shadow layers — is real
   * per-pixel paint, re-rasterised every time the box changes size, which the
   * disclosure does on purpose. It is the exact kind of thing the quality
   * module exists to stop building on a device that is already struggling, so
   * the class that carries it is asked for once per panel and never again.
   *
   * detectTier() rather than useQuality(): the QualityContext provider is
   * mounted INSIDE the r3f Canvas, around the scene tree, and these panels are
   * DOM siblings of the canvas — reading the context from here would return
   * the module's safe default on every machine and quietly claim to be
   * adaptive while being constant. The pure detector, given the same signals,
   * is the honest version of the same answer. (The GL probe behind
   * readHardwareSignals caches one throwaway context for the page's life, so
   * three mounted panels cost one probe between them, and Scene3D's own call
   * shares it.)
   *
   * `reduced: false`, deliberately, and it is the one signal not passed
   * through: a static shadow costs a reduced-motion visitor nothing per frame,
   * and that visitor sees exactly one frame — stripping the depth out of it
   * would make the only picture they get the flattest one. Motion preference
   * is answered by the reduce block in polish.css, which is where it belongs;
   * this decision is about fill rate.
   */
  const tier = useMemo(
    () => detectTier({ mobile: axis === 'y', reduced: false, ...readHardwareSignals() }),
    [axis],
  );

  /* ---- the arrival, sequenced -------------------------------------------
   * A classList write on a threshold crossing, driven by the same MotionValue
   * that flies the camera — which is to say: no React state, no re-render, and
   * no per-frame work beyond one subtraction and one comparison inside a
   * subscription the deck is already paying for. The class is added at most
   * once per approach and removed at most once per departure.
   *
   * It has to be the flight's own clock rather than mount or the `active`
   * prop, because both of those fire at the WRONG MOMENT. Panels mount as
   * neighbours — off to the side, at zero opacity, one to three stations
   * early — so a mount-time entrance plays for nobody. `active` flips the
   * instant a leg BEGINS (Flight sets it in a transition on the first frame),
   * i.e. up to six seconds before the panel is anywhere near the frame. Only
   * `t` knows where the ship actually is.
   *
   * Removing the class on departure is what re-arms the animation: CSS
   * restarts an animation when its name goes none → named, so flying back to a
   * station replays the assembly instead of showing a card that has already
   * happened.
   */
  useEffect(() => {
    const el = secRef.current;
    if (!el) return;
    let on = false;
    const apply = (v: number) => {
      const d = Math.abs(v - index);
      const next = on ? d < REVEAL_OUT : d < REVEAL_IN;
      if (next === on) return;
      on = next;
      el.classList.toggle('arrive', next);
    };
    apply(t.get());
    return t.on('change', apply);
  }, [t, index]);

  // A generous slide — the outgoing panel must clear its own 560px width, or
  // the incoming one reads as double-exposed text (a real screenshot finding,
  // not a guess). Fully faded by three-quarters of a leg: mid-travel the
  // frame belongs to the voyage, not to two ghost panels.
  const transform = useTransform(t, (v) => {
    const d = clamp(index - v, -1.2, 1.2);
    return axis === 'x'
      ? `translate3d(${d * 560}px, 0, 0)`
      : `translate3d(0, ${d * 340}px, 0)`;
  });
  // Gone by half a leg: at the old 0.75 falloff, two ghost panels
  // double-exposed over each other through the long return flight.
  const opacity = useTransform(t, (v) => 1 - Math.min(Math.abs(v - index) / 0.45, 1));
  const scale = useTransform(t, (v) => 1 - Math.min(Math.abs(v - index), 1) * 0.045);

  const body = (
    <section
      ref={(el) => {
        secRef.current = el;
        onRegister(index, el);
      }}
      tabIndex={-1}
      aria-label={`Station ${index + 1}: ${station.title}`}
      // `lit` is the tier-gated surface (see above) and it is the only class
      // here React owns that can change; `arrive` is written imperatively on
      // the same element, and React leaves it alone precisely because this
      // string does not change between renders.
      className={`${flat ? 'panel' : 'panel pagefade'}${tier === 'low' ? '' : ' lit'}`}
      // The panel is a child of `.stage`, which reads touchstart/touchend as
      // the flight's swipe gesture — and a scroll-up-to-read-more inside the
      // panel is a finger travelling UP, i.e. exactly the "advance" swipe. So
      // reading the overview flipped you to the next station mid-sentence.
      // Stopping the touch here (bubble phase) keeps it off `.stage`: the
      // panel scrolls natively, and swipe-to-advance still lives on all the
      // open sky around it. stopPropagation only — never preventDefault, or
      // the native scroll it exists to protect would die with it.
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <StationContent station={station} />
    </section>
  );

  // `hero` marks the one station that has an identity column floated above
  // it. Only the mobile block in polish.css reads it — on desktop the class
  // matches no rule, so the anchored layout is untouched by construction.
  const wrap = index === 0 ? 'panelwrap hero' : 'panelwrap';

  if (flat) {
    return (
      <div className={wrap}>
        <div className="xfade w-full max-w-[560px]">{body}</div>
      </div>
    );
  }

  if (axis === 'x' && onAnchor) {
    return (
      <div className="panelwrap anchored">
        <div ref={(el) => onAnchor(index, el)} className="anchorpos">
          <m.div style={{ opacity, scale }} className="w-full max-w-[560px]">
            {body}
          </m.div>
        </div>
      </div>
    );
  }

  return (
    <div className={wrap}>
      <m.div style={{ transform, opacity, scale }} className="w-full max-w-[560px]">
        {body}
      </m.div>
    </div>
  );
}
