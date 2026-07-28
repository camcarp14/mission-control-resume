import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

export const SURFACES = [
  { code: 'CONTROL',    path: '/',           hint: 'home' },
  { code: 'CAPACITY',   path: '/capacity',   hint: 'fleet allocation' },
  { code: 'RACKS',      path: '/racks',      hint: 'capabilities' },
  { code: 'MOAT',       path: '/moat',       hint: 'combinatorial rarity' },
  { code: 'SCALING',    path: '/scaling',    hint: 'train/infer split' },
  { code: 'FLEET',      path: '/fleet',      hint: 'workloads + delegation' },
  { code: 'DIVERGENCE', path: '/divergence', hint: 'peer trajectory' },
  { code: 'OPS',        path: '/ops',        hint: 'incidents' },
] as const;

export function Shell() {
  const location = useLocation();
  const { signOut } = useAuth();

  return (
    <div className="flex min-h-dvh bg-ground text-ink">
      {/* nav rail */}
      <nav className="sticky top-0 hidden h-dvh w-[168px] shrink-0 flex-col border-r border-rule bg-panel md:flex">
        <div className="border-b border-rule px-4 py-4">
          <div className="font-mono text-xs tracking-[0.24em] text-ink">BUILDOUT</div>
          <div className="mt-1 text-2xs text-faint">capacity planning</div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {SURFACES.map((s) => (
            <NavLink
              key={s.path}
              to={s.path}
              end={s.path === '/'}
              className={({ isActive }) =>
                `block border-l-2 px-4 py-2 font-mono text-2xs uppercase tracking-widest transition-colors ${
                  isActive
                    ? 'border-l-ink bg-raised text-ink'
                    : 'border-l-transparent text-faint hover:text-dim'
                }`
              }
            >
              {s.code}
            </NavLink>
          ))}
        </div>

        <div className="space-y-2 border-t border-rule px-4 py-3">
          <div className="flex items-center gap-1.5 text-2xs text-faint">
            <kbd>⌘</kbd>
            <kbd>K</kbd>
            <span>palette</span>
          </div>
          <button
            onClick={signOut}
            className="btn text-2xs uppercase tracking-widest text-faint hover:text-dim"
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* mobile nav — horizontal scroller, ≥42px targets */}
      <nav className="fixed inset-x-0 top-0 z-40 flex gap-px overflow-x-auto border-b border-rule bg-panel md:hidden">
        {SURFACES.map((s) => (
          <NavLink
            key={s.path}
            to={s.path}
            end={s.path === '/'}
            className={({ isActive }) =>
              `shrink-0 px-3.5 py-3 font-mono text-2xs uppercase tracking-widest ${
                isActive ? 'bg-raised text-ink' : 'text-faint'
              }`
            }
          >
            {s.code}
          </NavLink>
        ))}
      </nav>

      {/* content — keyed .pagefade so route changes never hard-cut */}
      <main className="min-w-0 flex-1 px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-16 md:px-8 md:pt-8">
        <div key={location.pathname} className="pagefade mx-auto max-w-[1180px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
