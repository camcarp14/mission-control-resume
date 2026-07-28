import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Mechanical checks against section 2 of the build bar. These catch the polish
 * regressions that a build is perfectly happy with — the surface audit has
 * caught every one of these in real projects.
 */
const CSS = readFileSync(join(process.cwd(), 'src/ui/polish.css'), 'utf8');

function tsxFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const SRC = tsxFiles(join(process.cwd(), 'src'));

describe('motion system', () => {
  it('defines the shared duration + easing tokens', () => {
    for (const token of ['--dur-1', '--dur-2', '--dur-3', '--ease-out', '--ease-spring']) {
      expect(CSS, `missing motion token ${token}`).toContain(token);
    }
  });

  it('gates every animation behind prefers-reduced-motion', () => {
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)');

    // Every @keyframes-driven class must be named in the reduce block, or a
    // user who asked the OS for less motion still gets it.
    const reduceBlock = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const cls of ['pagefade', 'stagger', 'toast', 'cmdk', 'sk']) {
      expect(reduceBlock, `${cls} not disabled under reduced motion`).toContain(cls);
    }
  });

  it('uses no ad-hoc durations outside the tokens', () => {
    // Strip the token definitions, the shimmer/keyframe timings, then look for
    // any remaining hard-coded seconds value — that's an animation someone
    // sprinkled on rather than taking from the system.
    const withoutTokens = CSS.replace(/--dur-\d:[^;]+;/g, '').replace(/shimmer [\d.]+s/g, '');
    const adHoc = withoutTokens.match(/(?:transition|animation)[^;{]*?\b\d*\.?\d+s\b/g) ?? [];
    expect(adHoc, `ad-hoc timing found: ${adHoc.join(', ')}`).toHaveLength(0);
  });
});

describe('numbers behave like instruments', () => {
  it('applies tabular-nums to numeric surfaces', () => {
    expect(CSS).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('has no page-level spinner anywhere in the app', () => {
    // A centered spinner on page load is the single loudest "tool" tell.
    for (const f of SRC) {
      const src = readFileSync(f, 'utf8');
      expect(/\bSpinner\b|animate-spin/.test(src), `${f} uses a spinner — use a layout-matched skeleton`).toBe(false);
    }
  });
});

describe('every async surface draws its states', () => {
  it('error states ship a Retry', () => {
    const prims = readFileSync(join(process.cwd(), 'src/ui/primitives.tsx'), 'utf8');
    const errorState = prims.slice(prims.indexOf('export function ErrorState'));
    expect(errorState.slice(0, 900)).toContain('Retry');
  });

  it('empty states ship guidance and an action, never bare "No data"', () => {
    for (const f of SRC) {
      const src = readFileSync(f, 'utf8');
      expect(/["'>]\s*No data\s*[.<"']/.test(src), `${f} has a dead-end "No data" empty state`).toBe(false);
    }
  });

  it('every <Empty> in the app supplies a hint', () => {
    for (const f of SRC) {
      const src = readFileSync(f, 'utf8');
      const opens = (src.match(/<Empty\b/g) ?? []).length;
      const hints = (src.match(/\bhint=/g) ?? []).length;
      expect(hints, `${f}: ${opens} <Empty> but only ${hints} hint props`).toBeGreaterThanOrEqual(opens);
    }
  });
});

describe('mobile ergonomics', () => {
  it('keeps inputs at 16px so iOS does not zoom on focus', () => {
    expect(CSS).toMatch(/input, select, textarea\s*\{\s*font-size:\s*16px/);
  });

  it('pads for the home indicator', () => {
    expect(CSS).toContain('env(safe-area-inset-bottom)');
  });
});

describe('keyboard-first', () => {
  it('draws a visible focus ring', () => {
    expect(CSS).toContain(':focus-visible');
  });

  it('⌘K reaches every surface', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    const shell = readFileSync(join(process.cwd(), 'src/ui/shell/Shell.tsx'), 'utf8');
    // Commands are generated from the same SURFACES list the nav renders, so a
    // new route cannot be added to the nav without also reaching the palette.
    expect(app).toContain('SURFACES.map');
    const routeCount = (shell.match(/path: '/g) ?? []).length;
    expect(routeCount, 'expected all 8 surfaces registered').toBe(8);
  });

  it('locks background scroll while the palette is open', () => {
    const prims = readFileSync(join(process.cwd(), 'src/ui/primitives.tsx'), 'utf8');
    expect(prims).toContain("document.body.style.overflow");
  });
});
