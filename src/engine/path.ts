/* ==== PATH ==== */

import type { Vec } from './layout';

export type FlightPath = {
  n: number;
  posAt(t: number): Vec;
  tangentAt(t: number): Vec;
  headingAt(t: number): number;
};

/*
 * Uniform Catmull-Rom through the station points. Chosen over Bezier because
 * Catmull-Rom interpolates its controls — the ship visibly docks AT each
 * station — and over linear segments because the camera follows headingAt,
 * and a C1 curve keeps that rotation from snapping at knots.
 */
export function makePath(points: Vec[]): FlightPath {
  const n = points.length;

  if (n <= 1) {
    // A single station (or none) has no curve to fly. Pin position to the
    // lone point and give the tangent a fixed unit-x direction so headingAt
    // stays finite — atan2(0, 0) would technically return 0 too, but callers
    // normalising the tangent would divide by zero.
    const only = points[0] ?? { x: 0, y: 0 };
    return {
      n,
      posAt: () => ({ x: only.x, y: only.y }),
      tangentAt: () => ({ x: 1, y: 0 }),
      headingAt: () => 0,
    };
  }

  const last = n - 1;

  // Clamped-endpoint trick: indices -1 and n resolve to the first/last real
  // point, i.e. the endpoints are their own phantom neighbours. This makes
  // the spline start and end exactly on the terminal stations with a gentle
  // (zero-curvature-ish) approach, without inventing extrapolated controls.
  const pt = (i: number): Vec => {
    const j = i < 0 ? 0 : i > last ? last : i;
    // The index is already clamped into range; the fallback exists only to
    // satisfy noUncheckedIndexedAccess and is unreachable.
    return points[j] ?? { x: 0, y: 0 };
  };

  // All samplers clamp t so callers can overshoot freely (scroll rubber-band,
  // eased overscroll) and still get the terminal station back.
  const clampT = (t: number): number => (t < 0 ? 0 : t > last ? last : t);

  type Segment = { p0: Vec; p1: Vec; p2: Vec; p3: Vec; s: number };

  const locate = (t: number): Segment => {
    const tc = clampT(t);
    // t === last must land on the final segment with s = 1, not on a
    // nonexistent segment `last` with s = 0.
    let i = Math.floor(tc);
    if (i > last - 1) i = last - 1;
    return { p0: pt(i - 1), p1: pt(i), p2: pt(i + 1), p3: pt(i + 2), s: tc - i };
  };

  const posAt = (t: number): Vec => {
    const tc = clampT(t);
    if (Number.isInteger(tc)) {
      // Return the knot verbatim at integer parameters. On paper the basis
      // evaluates to the knot anyway, but at s = 1 (the far end of the final
      // segment) floating-point summation can miss by an ulp — and stations
      // must sit EXACTLY where layout.ts put them or panels drift.
      const k = pt(tc);
      return { x: k.x, y: k.y };
    }
    const { p0, p1, p2, p3, s } = locate(tc);
    const s2 = s * s;
    const s3 = s2 * s;
    return {
      x:
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * s +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3),
      y:
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * s +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3),
    };
  };

  // Analytic derivative of the basis above. Numeric differencing would decay
  // to garbage near the clamped ends (the forward/backward samples collapse
  // onto the same point) and would jitter the camera heading every frame.
  const tangentAt = (t: number): Vec => {
    const { p0, p1, p2, p3, s } = locate(t);
    const s2 = s * s;
    return {
      x:
        0.5 *
        ((-p0.x + p2.x) +
          2 * (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s +
          3 * (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s2),
      y:
        0.5 *
        ((-p0.y + p2.y) +
          2 * (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s +
          3 * (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s2),
    };
  };

  const headingAt = (t: number): number => {
    const d = tangentAt(t);
    return Math.atan2(d.y, d.x);
  };

  return { n, posAt, tangentAt, headingAt };
}
