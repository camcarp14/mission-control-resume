/* ==== STARFIELD TESTS ==== */

import { describe, it, expect } from 'vitest';
import { mulberry32, starLayerDataUri } from './starfield';
import type { StarLayerSpec } from './starfield';

const SPEC: StarLayerSpec = {
  seed: 42,
  count: 120,
  size: 512,
  minR: 0.4,
  maxR: 1.6,
  opacity: [0.3, 0.9],
};

const PREFIX = 'data:image/svg+xml,';

function decode(uri: string): string {
  return decodeURIComponent(uri.slice(PREFIX.length));
}

describe('mulberry32', () => {
  it('is deterministic for a given seed and stays in [0, 1)', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('starLayerDataUri', () => {
  const uri = starLayerDataUri(SPEC);
  const svg = decode(uri);

  it('same seed produces an identical string', () => {
    expect(starLayerDataUri({ ...SPEC })).toBe(uri);
  });

  it('different seeds produce different output', () => {
    expect(starLayerDataUri({ ...SPEC, seed: 7 })).not.toBe(uri);
  });

  it('renders exactly `count` circles', () => {
    expect(svg.split('<circle').length - 1).toBe(SPEC.count);
  });

  it('is a data:image/svg+xml URI', () => {
    expect(uri.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('decoded SVG dimensions equal size', () => {
    expect(svg).toContain(`width="${SPEC.size}"`);
    expect(svg).toContain(`height="${SPEC.size}"`);
  });

  it('all radii lie within [minR, maxR]', () => {
    const radii = [...svg.matchAll(/ r="([0-9.]+)"/g)].map((m) => Number(m[1] ?? 'NaN'));
    expect(radii.length).toBe(SPEC.count);
    for (const r of radii) {
      expect(r).toBeGreaterThanOrEqual(SPEC.minR);
      expect(r).toBeLessThanOrEqual(SPEC.maxR);
    }
  });

  it('keeps star centres inside the wrap-safe band [maxR, size - maxR]', () => {
    // This is the invariant the seamless tiling relies on — a centre outside
    // it means a star clipped at the seam.
    const centres = [...svg.matchAll(/c[xy]="([0-9.]+)"/g)].map((m) => Number(m[1] ?? 'NaN'));
    expect(centres.length).toBe(SPEC.count * 2);
    for (const c of centres) {
      expect(c).toBeGreaterThanOrEqual(SPEC.maxR);
      expect(c).toBeLessThanOrEqual(SPEC.size - SPEC.maxR);
    }
  });
});
