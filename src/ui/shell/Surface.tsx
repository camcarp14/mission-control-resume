import type { ReactNode } from 'react';
import { InstrumentRow, type MetricSpec } from './Metric';

/**
 * Identical page anatomy on every surface: header block, instrument row, content
 * grid. Salesforce-feel is scaffolding discipline — the same skeleton everywhere
 * is what makes an app read as software rather than a set of pages.
 *
 * Generous negative space BETWEEN blocks (space-y-8), tight inside them.
 */
export function Surface({
  code,
  title,
  subtitle,
  metrics,
  actions,
  children,
}: {
  code: string;
  title: string;
  subtitle: string;
  metrics?: MetricSpec[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-8">
      {/* header block */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-5">
        <div>
          <div className="font-mono text-2xs uppercase tracking-[0.2em] text-faint">
            {code}
          </div>
          <h1 className="mt-1.5 text-xl font-medium tracking-tight text-ink">{title}</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-dim">{subtitle}</p>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>

      {/* instrument row */}
      {metrics && <InstrumentRow metrics={metrics} />}

      {/* content grid */}
      <div className="space-y-8">{children}</div>
    </div>
  );
}

/** A content block. Hairline rule, no gradient, no rounded-pastel card. */
export function Block({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section border border-rule bg-panel">
      <div className="flex items-center justify-between gap-4 border-b border-rule px-4 py-2.5">
        <div>
          <h2 className="text-2xs uppercase tracking-widest text-dim">{title}</h2>
          {hint && <p className="mt-0.5 text-2xs text-faint">{hint}</p>}
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * Marks a number as model output rather than measurement. Used on MOAT,
 * SCALING and DIVERGENCE — on screen, not in a footnote.
 */
export function ModelBadge({ children }: { children: ReactNode }) {
  return (
    <span className="border border-rule px-1.5 py-0.5 font-mono text-2xs uppercase tracking-widest text-faint">
      {children}
    </span>
  );
}
