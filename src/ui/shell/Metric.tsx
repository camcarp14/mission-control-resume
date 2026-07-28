import { Num } from '../primitives';

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
 * every surface — Artifact Velocity looks identical on CONTROL and on FLEET.
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
 * The instrument row. Fixed cell count so the skeleton (SkInstrumentRow) resolves
 * into exactly this layout with zero shift.
 */
export function InstrumentRow({ metrics }: { metrics: MetricSpec[] }) {
  return (
    <div className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4 lg:grid-cols-7">
      {metrics.map((m) => (
        <Metric key={m.label} {...m} />
      ))}
    </div>
  );
}
