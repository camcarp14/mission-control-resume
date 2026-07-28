import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider, CommandK, type CommandItem } from './ui/primitives';
import { Shell, SURFACES } from './ui/shell/Shell';
import { SignIn } from './ui/SignIn';
import {
  Control, Capacity, Racks, Moat, Scaling, Fleet, Divergence, Ops,
} from './routes/surfaces';

/** ⌘K reaches every route and every primary action. */
const COMMANDS: CommandItem[] = [
  ...SURFACES.map((s) => ({
    label: s.code,
    group: 'Go to',
    path: s.path,
    k: [s.code.toLowerCase(), s.hint],
  })),
  {
    label: 'Diagnose deployment (env-check)',
    group: 'Diagnostics',
    run: () => window.open('/api/env-check', '_blank'),
    k: ['env', 'debug', 'config'],
  },
  {
    label: 'Diagnose my session (whoami)',
    group: 'Diagnostics',
    run: () => window.open('/api/whoami', '_blank'),
    k: ['auth', 'token', 'session', 'rls'],
  },
];

function Gate() {
  const { status } = useAuth();

  // No loading branch: the synchronous session peek in AuthProvider decides
  // shell-vs-signin on the first frame, so there is never a spinner (the single
  // loudest "tool" tell) and never a blank frame. Data-level loading is drawn
  // per-surface with layout-matched skeletons instead.
  if (status === 'anon') return <SignIn />;

  return (
    <>
      <CommandK items={COMMANDS} />
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Control />} />
          <Route path="capacity" element={<Capacity />} />
          <Route path="racks" element={<Racks />} />
          <Route path="moat" element={<Moat />} />
          <Route path="scaling" element={<Scaling />} />
          <Route path="fleet" element={<Fleet />} />
          <Route path="divergence" element={<Divergence />} />
          <Route path="ops" element={<Ops />} />
        </Route>
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Gate />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
