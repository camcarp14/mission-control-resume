import type { Vec3 } from './space';

/* ==== PATH3 — Catmull-Rom in three dimensions ==============================
 *
 * Same uniform Catmull-Rom basis as path.ts, applied componentwise. The 2D
 * module stays untouched because the crossfade fallback and its tests still
 * depend on it; the WebGL flight rides this one. Guarantees mirror path.ts:
 * P(i) === points[i] exactly at integer knots, t clamped to [0, n-1], and an
 * analytic derivative (numeric differencing jitters the camera at low speed).
 * ========================================================================= */

export type FlightPath3 = {
  n: number;
  posAt(t: number): Vec3;
  tangentAt(t: number): Vec3;
};

const basis = (p0: number, p1: number, p2: number, p3: number, s: number): number =>
  0.5 *
  (2 * p1 +
    (-p0 + p2) * s +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s +
    (-p0 + 3 * p1 - 3 * p2 + p3) * s * s * s);

const dBasis = (p0: number, p1: number, p2: number, p3: number, s: number): number =>
  0.5 *
  (-p0 +
    p2 +
    2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * s +
    3 * (-p0 + 3 * p1 - 3 * p2 + p3) * s * s);

export function makePath3(points: Vec3[]): FlightPath3 {
  const n = points.length;
  if (n === 0) throw new Error('makePath3 needs at least one point');
  if (n === 1) {
    const only = points[0] as Vec3;
    return {
      n,
      posAt: () => [...only] as Vec3,
      tangentAt: () => [0, 0, -1],
    };
  }

  // Clamped endpoints via index clamping — duplicating the phantom controls.
  const P = (i: number): Vec3 => points[Math.min(n - 1, Math.max(0, i))] as Vec3;

  const clampT = (t: number) => Math.min(n - 1, Math.max(0, t));

  return {
    n,
    posAt(raw: number): Vec3 {
      const t = clampT(raw);
      const i = Math.min(n - 2, Math.floor(t));
      // Integer knots return the stored point verbatim so float summation at
      // s=1 can never drift a dock position.
      if (t === i) return [...P(i)] as Vec3;
      const s = t - i;
      const [a, b, c, d] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
      return [
        basis(a[0], b[0], c[0], d[0], s),
        basis(a[1], b[1], c[1], d[1], s),
        basis(a[2], b[2], c[2], d[2], s),
      ];
    },
    tangentAt(raw: number): Vec3 {
      const t = clampT(raw);
      const i = Math.min(n - 2, Math.floor(t));
      const s = t - i;
      const [a, b, c, d] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
      const v: Vec3 = [
        dBasis(a[0], b[0], c[0], d[0], s),
        dBasis(a[1], b[1], c[1], d[1], s),
        dBasis(a[2], b[2], c[2], d[2], s),
      ];
      const len = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / len, v[1] / len, v[2] / len];
    },
  };
}
