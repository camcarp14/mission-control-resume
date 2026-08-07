import { useMemo, useState } from 'react';
import { getSupabase, OFFLINE_DEV } from '../lib/supabase';
import { Empty, ErrorState, fmt } from '../ui/primitives';
import { InstrumentRow, type MetricSpec } from '../ui/Metric';

/**
 * /dashboard — who visited, from which code, and how far they flew. Itself
 * passcode-protected through the same deny-all RLS posture: the passcode is
 * checked server-side (bcrypt via the dashboard_visits RPC), held in memory
 * only, and never written to storage — a refresh re-prompts, by design.
 */

type VisitRow = {
  id: string;
  name: string;
  company: string;
  role: string;
  email: string | null;
  code: string;
  user_agent: string | null;
  furthest_station: number;
  station_count: number | null;
  created_at: string;
  last_seen_at: string;
};

type CodeRow = {
  code: string;
  company: string;
  active: boolean;
  visit_count: number;
  last_seen_at: string | null;
  max_station: number | null;
};

type Loaded = { visits: VisitRow[]; codes: CodeRow[] };
type Status =
  | { s: 'locked'; err?: 'denied' | 'rate_limited' | 'unreachable' }
  | { s: 'checking' }
  | { s: 'loaded'; data: Loaded };

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const depthPct = (v: VisitRow) =>
  v.station_count && v.station_count > 0
    ? Math.min(1, (v.furthest_station + 1) / v.station_count)
    : 0;

export default function Dashboard() {
  const [passcode, setPasscode] = useState('');
  const [status, setStatus] = useState<Status>({ s: 'locked' });

  const load = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setStatus({ s: 'checking' });
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.rpc('dashboard_visits', { p_passcode: passcode });
      if (error) return setStatus({ s: 'locked', err: 'unreachable' });
      const d = data as { ok: boolean; reason?: string; visits?: VisitRow[]; codes?: CodeRow[] };
      if (!d?.ok) {
        return setStatus({
          s: 'locked',
          err: d?.reason === 'rate_limited' ? 'rate_limited' : 'denied',
        });
      }
      setStatus({ s: 'loaded', data: { visits: d.visits ?? [], codes: d.codes ?? [] } });
    } catch {
      setStatus({ s: 'locked', err: 'unreachable' });
    }
  };

  const metrics = useMemo<MetricSpec[]>(() => {
    if (status.s !== 'loaded') return [];
    const v = status.data.visits;
    const companies = new Set(v.map((x) => x.company.trim().toLowerCase())).size;
    const avgDepth = v.length
      ? v.reduce((a, x) => a + depthPct(x), 0) / v.length
      : null;
    const completions = v.filter(
      (x) => x.station_count != null && x.furthest_station >= x.station_count - 1,
    ).length;
    return [
      { label: 'Visits', value: v.length, format: fmt.int },
      { label: 'Companies', value: companies, format: fmt.int },
      { label: 'Avg depth', value: avgDepth, format: fmt.pct, sub: 'of stations reached' },
      { label: 'Completions', value: v.length ? completions : null, format: fmt.int, sub: 'reached docking' },
    ];
  }, [status]);

  if (OFFLINE_DEV) {
    return (
      <Frame>
        <Empty
          title="Offline preview — the dashboard needs Supabase."
          hint="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env, apply supabase/migrations/0001_resume_gate.sql, and this page shows every visit, its access code, and the furthest station reached."
          action={{ label: 'Back to the mission', onClick: () => (window.location.href = '/') }}
        />
      </Frame>
    );
  }

  if (status.s !== 'loaded') {
    return (
      <Frame>
        <form className="mt-2 max-w-sm" onSubmit={load}>
          <label
            htmlFor="d-pass"
            className="mb-1.5 block text-2xs uppercase tracking-widest text-faint"
          >
            Dashboard passcode
          </label>
          <input
            id="d-pass"
            type="password"
            autoComplete="current-password"
            className="w-full rounded border border-rule bg-panel px-3 py-2.5 text-base text-ink focus:border-rule-strong focus:outline-none"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
          />
          {status.s === 'locked' && status.err === 'denied' && (
            <p className="mt-2 text-xs text-accent">Passcode not recognized.</p>
          )}
          {status.s === 'locked' && status.err === 'rate_limited' && (
            <p className="mt-2 text-xs text-accent">
              Too many attempts — wait a minute and try again.
            </p>
          )}
          {status.s === 'locked' && status.err === 'unreachable' ? (
            <div className="mt-4">
              <ErrorState message="Supabase is unreachable from here." onRetry={() => void load()} />
            </div>
          ) : (
            <button
              type="submit"
              className="btn primary mt-4 border border-rule-strong bg-raised px-4 py-2.5 text-sm text-ink disabled:opacity-60"
              disabled={status.s === 'checking' || !passcode}
            >
              {status.s === 'checking' ? 'Checking…' : 'Open the logbook'}
            </button>
          )}
        </form>
      </Frame>
    );
  }

  const { visits, codes } = status.data;

  return (
    <Frame>
      <div className="stagger space-y-8">
        <InstrumentRow metrics={metrics} />

        <section className="section border border-rule bg-panel">
          <header className="flex items-center justify-between border-b border-rule px-4 py-2.5">
            <h2 className="text-xs font-medium uppercase tracking-widest text-dim">Visits</h2>
            <button type="button" className="btn border border-rule px-2.5 py-1 text-2xs text-dim" onClick={() => void load()}>
              Refresh
            </button>
          </header>
          {visits.length === 0 ? (
            <div className="p-4">
              <Empty
                title="No one has flown yet."
                hint="Mint a per-company access code (one INSERT — the README's 'minting codes' section has it ready to paste), share it, and every redemption lands here with name, company, code, and how far they got."
                action={{ label: 'Refresh the logbook', onClick: () => void load() }}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="text-2xs uppercase tracking-widest text-faint">
                    {['Name', 'Company', 'Role', 'Code', 'Depth', 'First seen', 'Last seen'].map((h) => (
                      <th key={h} className="border-b border-rule px-4 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visits.map((v) => (
                    <tr key={v.id} className="border-b border-rule last:border-0" title={v.user_agent ?? undefined}>
                      <td className="px-4 py-2.5 text-ink">
                        {v.name}
                        {v.email && <span className="block text-2xs text-faint">{v.email}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-dim">{v.company}</td>
                      <td className="px-4 py-2.5 text-dim">{v.role || '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-dim">{v.code}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="num font-mono text-xs text-ink">
                            {v.furthest_station + 1}/{v.station_count ?? '—'}
                          </span>
                          <span className="h-1 w-16 overflow-hidden rounded-full bg-raised">
                            <span
                              className="block h-full bg-dim"
                              style={{ width: `${Math.round(depthPct(v) * 100)}%` }}
                            />
                          </span>
                        </div>
                      </td>
                      <td className="num px-4 py-2.5 font-mono text-xs text-faint">{when(v.created_at)}</td>
                      <td className="num px-4 py-2.5 font-mono text-xs text-faint">{when(v.last_seen_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="section border border-rule bg-panel">
          <header className="border-b border-rule px-4 py-2.5">
            <h2 className="text-xs font-medium uppercase tracking-widest text-dim">By access code</h2>
          </header>
          {codes.length === 0 ? (
            <div className="p-4">
              <Empty
                title="No codes minted yet."
                hint="Each company gets its own code so the logbook attributes every view. The README has the one-line INSERT."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="text-2xs uppercase tracking-widest text-faint">
                    {['Code', 'Company', 'Active', 'Visits', 'Deepest', 'Last activity'].map((h) => (
                      <th key={h} className="border-b border-rule px-4 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {codes.map((c) => (
                    <tr key={c.code} className="border-b border-rule last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs text-ink">{c.code}</td>
                      <td className="px-4 py-2.5 text-dim">{c.company}</td>
                      <td className="px-4 py-2.5 font-mono text-2xs uppercase text-faint">
                        {c.active ? 'live' : 'off'}
                      </td>
                      <td className="num px-4 py-2.5 font-mono text-xs text-ink">{c.visit_count}</td>
                      <td className="num px-4 py-2.5 font-mono text-xs text-dim">
                        {c.max_station != null ? `STN ${String(c.max_station + 1).padStart(2, '0')}` : '—'}
                      </td>
                      <td className="num px-4 py-2.5 font-mono text-xs text-faint">
                        {c.last_seen_at ? when(c.last_seen_at) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="pagefade mx-auto max-w-5xl px-5 py-10">
      <p className="font-mono text-2xs uppercase tracking-widest text-faint">Mission Control</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">Flight logbook</h1>
      <p className="mt-1 max-w-prose text-xs leading-relaxed text-dim">
        Every gate redemption, attributed to its access code, with the furthest station reached.
      </p>
      <div className="mt-8">{children}</div>
    </main>
  );
}
