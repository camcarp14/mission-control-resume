// THE POLISH PRIMITIVES — pairs with polish.css.
// Adapted from saas-polish-system/assets/primitives.jsx to TypeScript, plus the
// instrument-specific pieces this app needs (Metric, Empty, ErrorState).
//
// One deliberate change from the source: useTween returns a raw float instead of
// Math.round()-ing. Rounding is the formatter's job — see the `f` prop on <Num> —
// so fractional metrics (a 0.34 ratio, a 4.5s duration) survive the tween.
import {
  useState,
  useEffect,
  useRef,
  createContext,
  useContext,
  type ReactNode,
} from 'react';

/* ---- numbers count to their value (ease-out cubic). Use on every big metric. ---- */
export function useTween(target: number | null, dur = 700): number | null {
  const [v, setV] = useState(target ?? 0);
  const fromRef = useRef(target ?? 0);

  useEffect(() => {
    if (target == null) return;
    const from = fromRef.current ?? 0;
    if (from === target) {
      setV(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      setV(from + (target - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);

  return target == null ? null : v;
}

export function Num({
  v,
  f = (x: number) => x.toLocaleString('en-US'),
  dur,
}: {
  v: number | null | undefined;
  f?: (x: number) => string;
  dur?: number;
}) {
  const shown = useTween(typeof v === 'number' ? v : null, dur);
  return <>{shown == null ? '—' : f(shown)}</>;
}

/* ---- formatters: every numeric surface uses one of these ---- */
export const fmt = {
  int: (x: number) => Math.round(x).toLocaleString('en-US'),
  one: (x: number) => x.toFixed(1),
  two: (x: number) => x.toFixed(2),
  pct: (x: number) => `${Math.round(x * 100)}%`,
  pct1: (x: number) => `${(x * 100).toFixed(1)}%`,
  ratio: (x: number) => `${x.toFixed(2)}×`,
  hours: (x: number) => `${x.toFixed(1)}h`,
  usd: (x: number) =>
    x >= 1000 ? `$${(x / 1000).toFixed(1)}k` : `$${Math.round(x)}`,
  months: (x: number) => `${x.toFixed(1)}mo`,
  level: (x: number) => Math.round(x).toString().padStart(2, '0'),
};

/* ---- skeletons: replace EVERY page-level spinner ---- */
export const SkLine = ({ w }: { w?: 'w40' | 'w60' | 'w80' }) => (
  <div className={`sk sk-line${w ? ` ${w}` : ''}`} />
);

export const SkCard = () => (
  <div className="card border border-rule bg-panel p-4">
    <SkLine w="w40" />
    <div className="sk sk-big" />
    <SkLine w="w80" />
  </div>
);

/** Instrument-row skeleton — matches the real metric strip cell-for-cell so the
 *  page develops into its final layout instead of jumping. */
export const SkInstrumentRow = ({ cells = 7 }: { cells?: number }) => (
  <div className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4 lg:grid-cols-7">
    {Array.from({ length: cells }).map((_, i) => (
      <div key={i} className="bg-panel px-4 py-3">
        <div className="sk sk-line w60" style={{ height: 9, margin: '2px 0 10px' }} />
        <div className="sk" style={{ height: 22, width: '70%' }} />
      </div>
    ))}
  </div>
);

export function SkPage({ cards = 4, instrument = true }: { cards?: number; instrument?: boolean }) {
  return (
    <div className="pagefade space-y-8">
      {instrument && <SkInstrumentRow />}
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: cards }).map((_, i) => (
          <SkCard key={i} />
        ))}
      </div>
    </div>
  );
}

/* ---- height:auto expansion, zero measuring, zero jank ---- */
export function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`expand${open ? ' open' : ''}`} aria-hidden={!open}>
      <div>{open ? children : null}</div>
    </div>
  );
}

/* ---- error + empty states. Non-negotiable: errors get Retry, empties get a CTA. ---- */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="border border-accent/30 bg-accent-dim p-5">
      <div className="text-2xs uppercase tracking-widest text-accent">Error</div>
      <p className="mt-2 text-sm text-ink">{message}</p>
      <button
        className="btn mt-4 border border-rule-strong px-3 py-1.5 text-xs text-ink"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}

export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="border border-dashed border-rule bg-panel p-6">
      <div className="text-sm text-ink">{title}</div>
      <p className="mt-1.5 max-w-md text-xs leading-relaxed text-dim">{hint}</p>
      {action && (
        <button
          className="btn mt-4 border border-rule-strong px-3 py-1.5 text-xs text-ink"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/* ---- toasts ---- */
type ToastItem = { id: string; msg: string; err: boolean; out?: boolean };
type PushToast = (msg: string, opts?: { err?: boolean; ms?: number }) => void;

const ToastCtx = createContext<PushToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push: PushToast = (msg, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs, { id, msg, err: !!opts.err }]);
    const ms = opts.ms ?? 2600;
    setTimeout(
      () => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, out: true } : x))),
      ms,
    );
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), ms + 260);
  };

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={`toast${t.err ? ' err' : ''}${t.out ? ' out' : ''}`}
          >
            <span className="tdot" />
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = (): PushToast => useContext(ToastCtx) ?? (() => {});

