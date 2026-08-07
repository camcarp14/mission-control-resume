import { useMemo } from 'react';
import { m, useTransform } from 'framer-motion';
import type { MotionValue } from 'framer-motion';
import type { FlightPath } from '../engine';
import { starLayerDataUri } from '../engine';

/** Star tiles are 512px SVGs that background-repeat; the wrap happens by
 *  translating within [0, 512) — the layer never grows to world size, which
 *  is the difference between 60fps and a GPU tile-budget blowout on phones. */
const TILE = 512;

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Depth-differentiated layers: far = dense/dim/small, near = sparse/bright.
 *  Seeds are arbitrary but fixed — the sky is the same on every visit. */
const LAYERS = [
  { depth: 0.15, seed: 11, count: 90, minR: 0.4, maxR: 0.9, opacity: [0.25, 0.5] as [number, number] },
  { depth: 0.35, seed: 23, count: 46, minR: 0.6, maxR: 1.3, opacity: [0.35, 0.7] as [number, number] },
  { depth: 0.6, seed: 47, count: 18, minR: 0.9, maxR: 1.8, opacity: [0.5, 0.95] as [number, number] },
];

function StarLayer({
  t,
  path,
  flip,
  depth,
  uri,
  reduced,
}: {
  t: MotionValue<number>;
  path: FlightPath;
  flip: number;
  depth: number;
  uri: string;
  reduced: boolean;
}) {
  const transform = useTransform(t, (v) => {
    const p = path.posAt(v);
    return `translate3d(${-mod(p.x * depth, TILE)}px, ${-mod(p.y * depth * flip, TILE)}px, 0)`;
  });
  if (reduced) {
    // Parallax off under reduced motion: a still sky, not a degraded one.
    return <div className="stars" style={{ backgroundImage: `url("${uri}")` }} />;
  }
  return <m.div className="stars" style={{ transform, backgroundImage: `url("${uri}")` }} />;
}

export function Stars({
  t,
  path,
  flip,
  mobile,
  reduced,
  onAdvance,
}: {
  t: MotionValue<number>;
  path: FlightPath;
  flip: number;
  mobile: boolean;
  reduced: boolean;
  onAdvance: () => void;
}) {
  const layers = useMemo(() => {
    // Two layers on mobile — the near layer is the costliest and the small
    // screen sells depth with less.
    const set = mobile ? LAYERS.slice(0, 2) : LAYERS;
    return set.map((l) => ({
      ...l,
      uri: starLayerDataUri({
        seed: l.seed,
        count: l.count,
        size: TILE,
        minR: l.minR,
        maxR: l.maxR,
        opacity: l.opacity,
      }),
    }));
  }, [mobile]);

  return (
    // Decorative sky doubling as the click-anywhere-to-advance surface. It is
    // aria-hidden with no role on purpose: clicking is a redundant affordance
    // over the visible Advance button and the documented keys, so assistive
    // tech never needs to know this div is interactive.
    <div className="absolute inset-0" aria-hidden="true" onClick={onAdvance}>
      {layers.map((l) => (
        <StarLayer
          key={l.seed}
          t={t}
          path={path}
          flip={flip}
          depth={l.depth}
          uri={l.uri}
          reduced={reduced}
        />
      ))}
    </div>
  );
}
