import { lazy, Suspense, type ReactNode } from 'react';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { SkLine } from '../ui/primitives';
import { GateSky } from '../gate/Gate';
import { IconArticles, IconArtifacts, IconRocket } from './icons';

/**
 * The front door, split three ways and side by side: Articles, Artifacts,
 * Space Journey. Three matching panels from 768px up (tablets and laptops);
 * below it they stack, centred, in the same order.
 *
 * The Space Journey column is passed in rather than rendered here because
 * its state (sign-in, resume, unreachable) belongs to Experience, which also
 * owns the flight it launches. The other two columns are lazy chunks, so
 * the entry bundle still carries only this shell and the sign-in form.
 *
 * The header is pre-rendered in index.html (the app's first contentful
 * paint), so every class that sets its position or size here has a twin in
 * that file's inline <style>. Change one, change the other.
 */
const ArticlesPanel = lazy(() => import('./ArticlesPanel'));
const Artifacts = lazy(() => import('./Artifacts'));

export function Home({ journey }: { journey: ReactNode }) {
  return (
    <main className="home">
      <GateSky />
      <div className="home-wrap relative z-10">
        {/* Every element here has a twin in index.html's pre-rendered shell
            (.mc-status/.mc-name/.mc-role/.mc-intro) so first paint is stable. */}
        <header className="home-head">
          <p className="home-status">
            <span className="home-status-dot" aria-hidden="true" />
            Mission Control · All systems go
          </p>
          <h1 className="home-name">Cameron Carpenter</h1>
          <p className="home-role">
            <span aria-hidden="true">◇</span> Applied AI · Performance Marketing{' '}
            <span aria-hidden="true">◇</span>
          </p>
          <p className="home-intro">
            Based in Chicago. Writing, the things I’ve built, and a résumé you can pilot.
          </p>
          {/* Phones only: the stacked panels put the Space Journey's PDF link
              below the fold, and the PDF must be reachable at the front door
              without scrolling. Mirrored as .mc-pdf in index.html's shell. */}
          <a className="home-pdf" href="/resume.pdf" download="Cameron-Carpenter-Resume.pdf">
            Download résumé PDF
          </a>
        </header>

        <div className="home-cols stagger">
          <Column id="col-articles" title="Articles" icon={<IconArticles />} hue="amber">
            <Lazy what="Articles">
              <ArticlesPanel />
            </Lazy>
          </Column>
          <Column id="col-artifacts" title="Artifacts" icon={<IconArtifacts />} hue="cyan">
            <Lazy what="Artifacts">
              <Artifacts />
            </Lazy>
          </Column>
          <Column id="col-journey" title="Space Journey" icon={<IconRocket />} hue="ember" middle>
            {journey}
          </Column>
        </div>
      </div>
    </main>
  );
}

/** One section: a panel with its icon and name on one centred row on top. `middle` centres a short body in the panel's height, so a column
 *  with little in it (the journey's one button) sits level with its taller
 *  neighbours instead of hanging off the top. */
function Column({
  id,
  title,
  icon,
  hue,
  middle = false,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  /** The panel's accent — its glow, icon and hover colour. */
  hue: 'amber' | 'cyan' | 'ember';
  middle?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`home-card hue-${hue}`} aria-labelledby={id}>
      <div className="col-head">
        <span className="col-icon" aria-hidden="true">
          {icon}
        </span>
        <h2 id={id} className="col-title">
          {title}
        </h2>
      </div>
      <div className={middle ? 'col-body col-body-middle' : 'col-body'}>{children}</div>
    </section>
  );
}

function Lazy({ what, children }: { what: string; children: ReactNode }) {
  return (
    <ErrorBoundary what={what}>
      <Suspense fallback={<PanelSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export function PanelSkeleton() {
  return (
    <div aria-hidden="true">
      <SkLine w="w80" />
      <SkLine w="w60" />
      <SkLine w="w40" />
    </div>
  );
}
