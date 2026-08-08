import { describe, it, expect } from 'vitest';
import { voyage, fovAt, sunApproach } from './space';
import { makePath3 } from './path3';
import type { Vec3 } from './space';

describe('voyage layout', () => {
  it('pins the arc: earth first, sun second-to-last, the landing home last', () => {
    for (const n of [3, 11, 12, 15, 25]) {
      const w = voyage(n);
      expect(w).toHaveLength(n);
      expect(w[0]?.kind).toBe('earth');
      expect(w[n - 2]?.kind).toBe('sun');
      expect(w[n - 1]?.kind).toBe('earthReturn');
    }
  });

  it('lands the return on the SAME earth the mission departed from', () => {
    const w = voyage(11);
    const home = w[0]!;
    const landing = w[10]!;
    expect(landing.bodyPos).toEqual(home.bodyPos);
    expect(landing.bodyRadius).toBe(home.bodyRadius);

    // The landing camera is at GROUND LEVEL. Distance from the planet's
    // centre is the wrong metric for that — widening the shot along the
    // surface inflates it exactly like climbing does, which is how this
    // assertion came to fail on a change that moved the camera sideways,
    // not up. What "landed" actually means is ALTITUDE: the component of
    // (camera - pad) along the pad's surface normal must stay small
    // against the planet, while the lateral component is free to grow as
    // the finale framing widens.
    const site = landing.site!;
    const nHat = (() => {
      const v: [number, number, number] = [
        site[0] - landing.bodyPos[0],
        site[1] - landing.bodyPos[1],
        site[2] - landing.bodyPos[2],
      ];
      const m = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / m, v[1] / m, v[2] / m] as const;
    })();
    const rel: [number, number, number] = [
      landing.camPos[0] - site[0],
      landing.camPos[1] - site[1],
      landing.camPos[2] - site[2],
    ];
    const altitude = rel[0] * nHat[0] + rel[1] * nHat[1] + rel[2] * nHat[2];
    expect(altitude).toBeGreaterThan(0); // above the pad, never inside the planet
    expect(altitude).toBeLessThan(landing.bodyRadius * 0.5); // hugging the ground
    // And the pad itself is on this planet's surface, not floating.
    const padR = Math.hypot(
      site[0] - landing.bodyPos[0],
      site[1] - landing.bodyPos[1],
      site[2] - landing.bodyPos[2],
    );
    expect(padR).toBeGreaterThan(landing.bodyRadius);
    expect(padR).toBeLessThan(landing.bodyRadius * 1.15);
  });

  it('advances the OUTBOUND legs monotonically along -Z with a constant step', () => {
    const w = voyage(11);
    for (let i = 1; i < w.length - 1; i++) {
      const prev = w[i - 1]!.camPos[2];
      const cur = w[i]!.camPos[2];
      expect(cur).toBeLessThan(prev);
      expect(prev - cur).toBeCloseTo(95, 6);
    }
    // ...and the final leg turns FOR HOME: back toward the start of the line.
    expect(w[10]!.camPos[2]).toBeGreaterThan(w[9]!.camPos[2]);
  });

  it('cycles the middle roster instead of running out on long missions', () => {
    const w = voyage(25);
    for (let i = 1; i < 23; i++) {
      expect(w[i]?.kind).not.toBe('earth');
      expect(w[i]?.kind).not.toBe('earthReturn');
      if (i !== 23) expect(w[i]?.kind).not.toBe('sun');
    }
    // Slot 1 and slot 10 both draw the first roster entry (9-long cycle).
    expect(w[1]?.kind).toBe(w[10]?.kind);
  });

  it('keeps every outbound body off the flight line, never centred on the camera', () => {
    const w = voyage(11);
    for (const p of w.slice(0, -1)) {
      const dx = p.bodyPos[0] - p.camPos[0];
      expect(Math.abs(dx), `station ${p.index} body sits on the flight line`).toBeGreaterThan(10);
    }
  });

  it('interpolates fov within sane display bounds', () => {
    const w = voyage(11);
    for (let t = 0; t <= 10; t += 0.05) {
      const f = fovAt(w, t);
      expect(f).toBeGreaterThan(35);
      expect(f).toBeLessThan(70);
    }
  });

  it('peaks the sun ramp at the sun dock and eases off on the flight home', () => {
    expect(sunApproach(11, 0)).toBe(0);
    expect(sunApproach(11, 7.9)).toBe(0);
    expect(sunApproach(11, 8.5)).toBeGreaterThan(0);
    expect(sunApproach(11, 9)).toBe(1); // docked at the sun (station 10, index 9)
    expect(sunApproach(11, 9.5)).toBeLessThan(1); // turning for home
    expect(sunApproach(11, 10)).toBe(0);
  });
});

describe('path3', () => {
  const pts: Vec3[] = [
    [0, 0, 0],
    [10, 4, -95],
    [-8, -3, -190],
    [15, 6, -285],
    [0, 0, -380],
  ];

  it('passes through every knot exactly', () => {
    const p = makePath3(pts);
    pts.forEach((pt, i) => {
      const got = p.posAt(i);
      expect(got[0]).toBeCloseTo(pt[0], 9);
      expect(got[1]).toBeCloseTo(pt[1], 9);
      expect(got[2]).toBeCloseTo(pt[2], 9);
    });
  });

  it('clamps t on both ends', () => {
    const p = makePath3(pts);
    expect(p.posAt(-5)).toEqual(p.posAt(0));
    expect(p.posAt(99)).toEqual(p.posAt(4));
  });

  it('returns unit tangents that agree with a numeric derivative', () => {
    const p = makePath3(pts);
    for (let t = 0.1; t < 3.9; t += 0.2) {
      const tan = p.tangentAt(t);
      const len = Math.hypot(tan[0], tan[1], tan[2]);
      expect(len).toBeCloseTo(1, 6);
      const h = 1e-5;
      const a = p.posAt(t - h);
      const b = p.posAt(t + h);
      const num: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const nl = Math.hypot(num[0], num[1], num[2]) || 1;
      for (let k = 0; k < 3; k++) {
        expect(tan[k]).toBeCloseTo((num[k] as number) / nl, 3);
      }
    }
  });

  it('handles the degenerate single-point mission', () => {
    const p = makePath3([[1, 2, 3]]);
    expect(p.posAt(0)).toEqual([1, 2, 3]);
    expect(p.posAt(7)).toEqual([1, 2, 3]);
    expect(p.tangentAt(0)).toEqual([0, 0, -1]);
  });
});
