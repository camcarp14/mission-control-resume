/* ==== LAYOUT TESTS ==== */

import { describe, it, expect } from 'vitest';
import { MOBILE_BREAKPOINT, gap, stationPositions } from './layout';

const N = 8;

describe('stationPositions — desktop', () => {
  const vw = 1280;
  const vh = 800;
  const pos = stationPositions(N, vw, vh);
  const g = gap(vw, vh);

  it('x increases monotonically with equal gaps', () => {
    for (let i = 1; i < N; i++) {
      const dx = pos[i]!.x - pos[i - 1]!.x;
      expect(dx).toBeGreaterThan(0);
      expect(Math.abs(dx - g)).toBeLessThan(1e-9);
    }
  });

  it('vertical drift stays within the 0.18*vh amplitude', () => {
    for (const p of pos) {
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.18 * vh + 1e-9);
    }
  });
});

describe('stationPositions — mobile', () => {
  const vw = 390;
  const vh = 844;
  const pos = stationPositions(N, vw, vh);
  const g = gap(vw, vh);

  it('y increases monotonically with equal gaps', () => {
    for (let i = 1; i < N; i++) {
      const dy = pos[i]!.y - pos[i - 1]!.y;
      expect(dy).toBeGreaterThan(0);
      expect(Math.abs(dy - g)).toBeLessThan(1e-9);
    }
  });

  it('lateral drift stays within the 0.06*vw amplitude', () => {
    for (const p of pos) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(0.06 * vw + 1e-9);
    }
  });
});

describe('breakpoint boundary', () => {
  const vh = 900;

  it('flips orientation exactly at 768', () => {
    const atBreak = stationPositions(3, MOBILE_BREAKPOINT, vh);
    const below = stationPositions(3, MOBILE_BREAKPOINT - 1, vh);

    // 768 is desktop: travel along x, y bounded by the drift amplitude.
    expect(atBreak[1]!.x - atBreak[0]!.x).toBeCloseTo(gap(768, vh), 9);
    expect(Math.abs(atBreak[2]!.y)).toBeLessThanOrEqual(0.18 * vh + 1e-9);

    // 767 is mobile: travel along y, x bounded by the drift amplitude.
    expect(below[1]!.y - below[0]!.y).toBeCloseTo(gap(767, vh), 9);
    expect(Math.abs(below[2]!.x)).toBeLessThanOrEqual(0.06 * 767 + 1e-9);
  });
});

describe('gap', () => {
  it('clamps the desktop gap to [640, 1040]', () => {
    expect(gap(768, 500)).toBe(640); // 0.8*768 = 614.4, clamped up
    expect(gap(1000, 500)).toBe(800); // in-band, passes through
    expect(gap(5000, 500)).toBe(1040); // ultrawide, clamped down
  });

  it('uses 0.85*vh on mobile', () => {
    expect(gap(400, 800)).toBeCloseTo(680, 9);
  });

  it('matches the spacing actually used by stationPositions', () => {
    const desktop = stationPositions(4, 1440, 900);
    expect(desktop[1]!.x - desktop[0]!.x).toBeCloseTo(gap(1440, 900), 9);

    const mobile = stationPositions(4, 375, 812);
    expect(mobile[1]!.y - mobile[0]!.y).toBeCloseTo(gap(375, 812), 9);
  });
});
