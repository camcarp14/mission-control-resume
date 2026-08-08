import type { CSSProperties } from 'react';
import { Num } from './primitives';

export type MetricSpec = {
  label: string;
  value: number | null | undefined;
  format: (x: number) => string;
  /** Off-target is the ONLY thing that earns the accent colour. */
  offTarget?: boolean;
  /** Sub-line: target, delta, or the model caveat. */
  sub?: string;
  title?: string;
};

/**
 * One cell of the instrument row. Same component, same size, same meaning on
 * every surface — a metric reads identically on the dashboard and in a station.
 */
export function Metric({ label, value, format, offTarget, sub, title }: MetricSpec) {
  return (
    <div className="bg-panel px-4 py-3" title={title}>
      <div className="text-2xs uppercase tracking-widest text-faint">{label}</div>
      <div
        className={`num mt-1.5 font-mono text-[22px] leading-none ${
          offTarget ? 'text-accent' : 'text-ink'
        }`}
      >
        <Num v={value} f={format} />
      </div>
      {sub && <div className="mt-1.5 text-2xs text-faint">{sub}</div>}
    </div>
  );
}

/**
 * The instrument row.
 *
 * The wide tier used to be a hard `lg:grid-cols-7` while the only caller fed
 * it four metrics, so a third of the strip was empty panel colour with the
 * hairline grid still running through it — it read as three readouts that had
 * failed to load rather than a row that had never been told how many it was
 * holding. The column count is data, so it travels with the data: --cells is
 * consumed by the .instrumentrow rule in polish.css at >=1024px. The two
 * narrow tiers stay in Tailwind because 2-then-4 is right for any count.
 */
export function InstrumentRow({ metrics }: { metrics: MetricSpec[] }) {
  return (
    <div
      className="instrumentrow grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-4"
      style={{ '--cells': Math.max(1, metrics.length) } as CSSProperties}
    >
      {metrics.map((m) => (
        <Metric key={m.label} {...m} />
      ))}
    </div>
  );
}
