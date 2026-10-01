import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider, SkLine } from './ui/primitives';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Experience } from './gate/Experience';
import { PanelSkeleton } from './home/Home';
import { WorkSkeleton } from './work/WorkHeader';

/**
 * One rule for every route: nothing heavy rides in the entry bundle. `/` is
 * the three-column home page — Articles, Artifacts, Space Journey — whose
 * first two columns are lazy chunks and whose third launches the flight
 * (code loaded only after sign-in, see Experience). `/articles` is the full
 * article list and `/articles/:slug` the reader. `/work` is the gate-free
 * proof-of-work page (no WebGL, no flight chunk). `/dashboard` is the owner's
 * passcode-protected logbook, lazy because visitors never open it.
 */
const Dashboard = lazy(() => import('./dashboard/Dashboard'));
const ArticlesPage = lazy(() => import('./home/ArticlesPage'));
const ArticleReader = lazy(() => import('./home/ArticleReader'));
const WorkPage = lazy(() => import('./work/WorkPage'));

function DashboardSkeleton() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <SkLine w="w40" />
      <div className="sk sk-big" />
      <SkLine w="w80" />
    </main>
  );
}

function ReaderSkeleton() {
  return (
    <main className="reader-col">
      <PanelSkeleton />
    </main>
  );
}

export default function App() {
  // Outermost, above the router and the toast provider, because a throw in
  // EITHER of those is still a white screen — and importing the boundary here
  // in the entry chunk is also what installs its vite:preloadError listener
  // before any lazy import can fail. Inner boundaries (the flight in
  // Experience, the dashboard below) exist so a broken chunk takes down one
  // surface instead of the whole app; this one is the floor under all of them.
  return (
    <ErrorBoundary what="Mission Control">
      <BrowserRouter>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<Experience />} />
            <Route
              path="/articles"
              element={
                <ErrorBoundary what="Articles">
                  <Suspense fallback={<ReaderSkeleton />}>
                    <ArticlesPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="/work"
              element={
                <ErrorBoundary what="Proof of work">
                  <Suspense fallback={<WorkSkeleton />}>
                    <WorkPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="/articles/:slug"
              element={
                <ErrorBoundary what="This article">
                  <Suspense fallback={<ReaderSkeleton />}>
                    <ArticleReader />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ErrorBoundary what="The logbook">
                  <Suspense fallback={<DashboardSkeleton />}>
                    <Dashboard />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            {/* No secret routes to stumble into — everything else is the gate. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
