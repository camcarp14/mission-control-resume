/* ==== STATIONS SCHEMA TEST =============================================== */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { stations } from './stations.js';

/**
 * Mechanizes the one-file bar: stations.js promises that editing content
 * never breaks the site, and this suite is what makes that promise cheap to
 * keep. Every constraint here exists because its violation renders — a
 * missing artifact href becomes a dead button, a two-sentence `proves` blows
 * the station HUD layout, a typo'd screenshot path 404s only in production.
 */
const KINDS = ['link', 'image', 'video', 'none'] as const;

describe('stations content contract', () => {
  it('has exactly 11 stations', () => {
    expect(stations).toHaveLength(11);
  });

  it('has nonempty, unique ids', () => {
    const ids = stations.map((s) => s.id);
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id.trim().length, 'station id must be nonempty').toBeGreaterThan(0);
    }
    expect(new Set(ids).size, 'station ids must be unique').toBe(ids.length);
  });

  it('has codes matching STN NN, sequential from 01', () => {
    stations.forEach((s, i) => {
      expect(s.code).toMatch(/^STN \d{2}$/);
      // Sequence is asserted, not just format, so a reorder that forgets to
      // renumber fails here instead of shipping a scrambled HUD.
      expect(s.code).toBe(`STN ${String(i + 1).padStart(2, '0')}`);
    });
  });

  for (const [i, s] of stations.entries()) {
    describe(`station ${i + 1} (${s.id})`, () => {
      it('has every schema field present and typed', () => {
        expect(typeof s.id).toBe('string');
        expect(typeof s.code).toBe('string');
        expect(typeof s.title).toBe('string');
        expect(s.title.trim().length, 'title must be nonempty').toBeGreaterThan(0);
        expect(typeof s.proves).toBe('string');
        expect(Array.isArray(s.bullets)).toBe(true);
        expect(typeof s.artifact).toBe('object');
        expect(s.artifact).not.toBeNull();
      });

      it('keeps proves to one sentence', () => {
        expect(s.proves.trim().length, 'proves must be nonempty').toBeGreaterThan(0);
        // A period followed by whitespace and a capital is the fingerprint of
        // a second sentence — the takeaway must survive as a single line.
        expect(s.proves).not.toMatch(/\.\s+[A-Z]/);
      });

      it('has 2–3 nonempty bullets', () => {
        expect(s.bullets.length).toBeGreaterThanOrEqual(2);
        expect(s.bullets.length).toBeLessThanOrEqual(3);
        for (const b of s.bullets) {
          expect(typeof b).toBe('string');
          expect(b.trim().length, 'bullet must be nonempty').toBeGreaterThan(0);
        }
      });

      it('has a valid artifact carrying the fields its kind requires', () => {
        const a = s.artifact;
        expect(KINDS as readonly string[]).toContain(a.kind);
        if (a.kind === 'link') {
          expect(typeof a.href, 'link artifact needs href').toBe('string');
          expect(a.href?.trim().length ?? 0).toBeGreaterThan(0);
          expect(typeof a.label, 'link artifact needs label').toBe('string');
          expect(a.label?.trim().length ?? 0).toBeGreaterThan(0);
        }
        if (a.kind === 'image') {
          expect(typeof a.src, 'image artifact needs src').toBe('string');
          expect(a.src?.trim().length ?? 0).toBeGreaterThan(0);
          expect(typeof a.alt, 'image artifact needs alt').toBe('string');
          expect(a.alt?.trim().length ?? 0).toBeGreaterThan(0);
        }
        if (a.kind === 'video') {
          expect(typeof a.videoSrc, 'video artifact needs videoSrc').toBe('string');
          expect(a.videoSrc?.trim().length ?? 0).toBeGreaterThan(0);
        }
      });

      it('points src at a file that exists under public/', () => {
        // Vite serves public/ from the site root, so '/x.svg' must exist at
        // public/x.svg. Checking here means a broken screenshot path fails
        // CI instead of 404ing in production.
        const src = s.artifact.src;
        if (typeof src === 'string' && src.startsWith('/')) {
          const onDisk = join(process.cwd(), 'public', src.slice(1));
          expect(existsSync(onDisk), `${src} does not resolve under public/`).toBe(true);
        }
      });
    });
  }
});
