import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider, SkLine } from './ui/primitives';
import { Experience } from './gate/Experience';

/**
 * Two routes, two chunks, one rule: nothing heavy rides in the entry bundle.
 * `/` is the gated experience (flight code loads only after redemption —
 * that's part of the gate, see Experience). `/dashboard` is the owner's
 * passcode-protected logbook, lazy because visitors never open it.
 */
const Dashboard = lazy(() => import('./dashboard/Dashboard'));

function DashboardSkeleton() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <SkLine w="w40" />
      <div className="sk sk-big" />
      <SkLine w="w80" />
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Experience />} />
          <Route
            path="/dashboard"
            element={
              <Suspense fallback={<DashboardSkeleton />}>
                <Dashboard />
              </Suspense>
            }
          />
          {/* No secret routes to stumble into — everything else is the gate. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
