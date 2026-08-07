/* ==== PATH TESTS ==== */

import { describe, it, expect } from 'vitest';
import { makePath } from './path';
import type { Vec } from './layout';

// Modest coordinate magnitudes keep the C1 check meaningful: the epsilon
// straddle below measures continuity, not second-derivative magnitude.
const KNOTS: Vec[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0.4 },
  { x: 2.2, y: -0.3 },
  { x: 3.4, y: 0.8 },
  { x: 4.8, y: 0.1 },
  { x: 6, y: -0.6 },
];

describe('makePath', () => {
  const path = makePath(KNOTS);
  const last = KNOTS.length - 1;

  it('passes through every knot exactly (1e-9)', () => {
    for (let i = 0; i < KNOTS.length; i++) {
      const k = KNOTS[i]!;
      const p = path.posAt(i);
      expect(Math.abs(p.x - k.x)).toBeLessThan(1e-9);
      expect(Math.abs(p.y - k.y)).toBeLessThan(1e-9);
    }
  });

  it('clamps t below 0 and above n-1', () => {
    expect(path.posAt(-5)).toEqual(path.posAt(0));
    expect(path.posAt(99)).toEqual(path.posAt(last));
  });

  it('is C1 continuous across every interior knot', () => {
    const eps = 1e-9;
    for (let i = 1; i < last; i++) {
      const before = path.tangentAt(i - eps);
      const after = path.tangentAt(i + eps);
      expect(Math.abs(before.x - after.x)).toBeLessThan(1e-6);
      expect(Math.abs(before.y - after.y)).toBeLessThan(1e-6);
    }
  });

  it('analytic tangent matches central-difference numeric derivative', () => {
    const h = 1e-5;
    const samples = 40;
    for (let k = 0; k < samples; k++) {
      // Stay h away from the clamp boundaries: outside them the numeric
      // difference measures the clamp, not the curve.
      const t = h + (k / (samples - 1)) * (last - 2 * h);
      const a = path.tangentAt(t);
      const p1 = path.posAt(t + h);
      const p0 = path.posAt(t - h);
      const numX = (p1.x - p0.x) / (2 * h);
      const numY = (p1.y - p0.y) / (2 * h);
      expect(Math.abs(a.x - numX)).toBeLessThan(1e-3);
      expect(Math.abs(a.y - numY)).toBeLessThan(1e-3);
    }
  });

  it('headings are finite over 500 samples, including out-of-range t', () => {
    for (let k = 0; k < 500; k++) {
      const t = -2 + (k / 499) * (last + 4);
      expect(Number.isFinite(path.headingAt(t))).toBe(true);
    }
  });

  it('handles the degenerate single-point path', () => {
    const solo = makePath([{ x: 5, y: 7 }]);
    expect(solo.n).toBe(1);
    expect(solo.posAt(0)).toEqual({ x: 5, y: 7 });
    expect(solo.posAt(-3)).toEqual({ x: 5, y: 7 });
    expect(solo.posAt(42)).toEqual({ x: 5, y: 7 });
    expect(solo.tangentAt(0)).toEqual({ x: 1, y: 0 });
    expect(Number.isFinite(solo.headingAt(0))).toBe(true);
  });
});
