/* ==== WARM-UP CONTRACT TEST ==============================================
 *
 * The warm list in warm.ts is a SECOND place that names media files, and the
 * first is scattered across the scene components that load them. A second
 * source of truth is exactly the kind of thing this repo refuses to keep by
 * inspection, so this suite makes the two agree mechanically:
 *
 *   · every warmed path exists in public/       — a rename cannot warm a 404
 *   · every warmed path is referenced in src/   — nothing is warmed that the
 *                                                 flight does not then load
 *   · every media path referenced in src/ is warmed — a NEW texture cannot be
 *                                                 quietly left cold
 *
 * The third assertion is the one that earns the file. The first two catch a
 * warm list that has rotted; only the third catches the far likelier failure,
 * which is a scene that grew a twelfth body and a warm-up nobody remembered
 * to tell about it.
 * ========================================================================= */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WARM_MEDIA } from './warm';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');
const PUBLIC = join(ROOT, 'public');

/** Every media URL any source file mentions. The three directories are the
 *  ones netlify.toml gives a media cache header to, which is the same list
 *  from the other end. */
const MEDIA_RE = /\/(?:textures|hdri|fonts)\/[A-Za-z0-9_.-]+/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx|css)$/.test(name) && !name.endsWith('.test.ts') ? [full] : [];
  });
}

const referenced = new Set<string>();
for (const file of sourceFiles(SRC)) {
  for (const hit of readFileSync(file, 'utf8').match(MEDIA_RE) ?? []) referenced.add(hit);
}

const warmed = WARM_MEDIA.map((a) => a.href);

describe('warm-up media contract', () => {
  it('warms a nonempty list', () => {
    expect(warmed.length).toBeGreaterThan(0);
  });

  it('lists each path exactly once', () => {
    expect(new Set(warmed).size, `duplicate href in WARM_MEDIA: ${warmed.join(', ')}`).toBe(
      warmed.length,
    );
  });

  for (const asset of WARM_MEDIA) {
    it(`${asset.href} exists in public/`, () => {
      expect(existsSync(join(PUBLIC, asset.href.replace(/^\//, '')))).toBe(true);
    });

    it(`${asset.href} is actually loaded by the app`, () => {
      expect(referenced.has(asset.href)).toBe(true);
    });

    it(`${asset.href} declares the mechanism that warms it`, () => {
      // A typeface has to reach the document's FONT SET, not merely the HTTP
      // cache, or the hero still swaps face on its first frame. Everything
      // else is bytes and goes through fetch. Mislabelling either way means a
      // second full download, not a cache hit.
      expect(asset.kind).toBe(asset.href.endsWith('.woff2') ? 'font' : 'binary');
    });
  }

  it('warms every media file the source references', () => {
    const cold = [...referenced].filter((href) => !warmed.includes(href)).sort();
    expect(
      cold,
      `these are fetched by the flight but never warmed — add them to WARM_MEDIA in src/lib/warm.ts`,
    ).toEqual([]);
  });
});
