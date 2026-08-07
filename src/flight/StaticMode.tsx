import { useEffect, useRef } from 'react';
import { stations } from '../content/stations.js';
import { StationContent } from './StationContent';

/**
 * "Skip the flight — see everything." The same eleven stations from the same
 * config, laid out as an ordinary document: real headings, document order,
 * native scroll. This is the canonical accessible version and the honest
 * answer for anyone who just wants to read — it is never a lesser page.
 */
export function StaticMode() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Entering static mode moves focus to the top of the document so keyboard
  // and screen-reader users land somewhere sensible, not wherever the flight
  // deck left them.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main className="pagefade mx-auto max-w-2xl px-5 pb-24 pt-24">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold tracking-tight text-ink"
      >
        The whole mission, on one page
      </h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-dim">
        Every station from the flight, in order. The{' '}
        <a className="text-ink underline decoration-rule-strong underline-offset-4" href="/resume.pdf" download>
          PDF résumé
        </a>{' '}
        carries the same material for your files.
      </p>

      {stations.map((s, i) => (
        <section
          key={s.id}
          aria-label={`Station ${i + 1}: ${s.title}`}
          className="mt-10 border-t border-rule pt-8"
        >
          <StationContent station={s} />
        </section>
      ))}
    </main>
  );
}
