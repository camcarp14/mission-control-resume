import { Link } from 'react-router-dom';
import { WORK_POSITIONING } from './positioning';

/**
 * The /work header — name, one-line positioning, and the two ways onward.
 *
 * Its own tiny module (in the entry chunk) because three places must paint
 * the identical block: the build's prerendered work/index.html shell (see
 * the workPage plugin in vite.config.ts), the Suspense fallback while the
 * page's chunk loads, and the page itself. Position and size classes here
 * have twins in index.html's inline <style> (.mc-work); change one, change
 * the other.
 */

export function WorkHeader() {
  return (
    <header className="work-head">
      <p className="font-mono text-2xs uppercase tracking-widest text-faint">Proof of work</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink md:text-3xl">
        Cameron Carpenter.
      </h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-dim">{WORK_POSITIONING}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <a
          className="btn border border-rule-strong bg-raised px-3.5 py-2 text-xs text-ink"
          href="/resume.pdf"
          download="Cameron-Carpenter-Resume.pdf"
        >
          Download résumé PDF
        </a>
        <Link className="btn border border-rule bg-panel px-3.5 py-2 text-xs text-ink" to="/">
          Fly the full résumé <span aria-hidden="true">→</span>
        </Link>
      </div>
    </header>
  );
}

export function WorkSkeleton() {
  return (
    <main className="workpage">
      <WorkHeader />
    </main>
  );
}
