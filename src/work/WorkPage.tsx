import { useEffect } from 'react';
import { stations } from '../content/stations.js';
import type { WorkItem } from '../content/work.js';
import { workPageGroups } from '../content/workView';
import { WorkHeader } from './WorkHeader';

/**
 * /work — the proof-of-work page: the link on the résumé and LinkedIn for
 * anyone who wants to check the claims in five minutes.
 *
 * Plain on purpose: no gate, no WebGL, no flight chunk, no images — just
 * what was built, what it does, and where to see it, read from work.js like
 * every other surface. Live items first with their links; in-progress items
 * after, chipped and unlinked; planned items never appear (workView.ts).
 */
const stationName = new Map(stations.map((s) => [s.id, `${s.code} · ${s.title}`]));

export default function WorkPage() {
  const { live, inProgress } = workPageGroups();

  useEffect(() => {
    window.scrollTo(0, 0);
    const prev = document.title;
    document.title = 'Proof of work — Cameron Carpenter';
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <main className="workpage">
      <WorkHeader />

      <section aria-labelledby="work-live" className="work-group">
        <h2 id="work-live" className="work-group-title">
          Live <span className="num text-faint">{live.length}</span>
        </h2>
        <ul className="work-list">
          {live.map((w) => (
            <Item key={w.id} w={w} />
          ))}
        </ul>
      </section>

      {inProgress.length > 0 && (
        <section aria-labelledby="work-wip" className="work-group">
          <h2 id="work-wip" className="work-group-title">
            In progress <span className="num text-faint">{inProgress.length}</span>
          </h2>
          <ul className="work-list">
            {inProgress.map((w) => (
              <Item key={w.id} w={w} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Item({ w }: { w: WorkItem }) {
  const station = w.stationId ? stationName.get(w.stationId) : undefined;
  const linked = w.status === 'live' && !w.private && w.links.length > 0;
  return (
    <li className="work-item">
      <div className="work-item-head">
        <h3 className="work-title">{w.title}</h3>
        {w.status === 'in-progress' && <span className="work-chip is-wip">In progress</span>}
        {w.private && <span className="work-chip">Private build</span>}
        {w.demo && <span className="work-chip is-demo">Demo data</span>}
      </div>
      <p className="work-pillars">{w.pillars.join(' · ')}</p>
      <p className="work-summary">{w.summary}</p>
      {w.keyNumber && <p className="work-key num">{w.keyNumber}</p>}
      {linked && (
        <p className="work-links">
          {w.links.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">
              {l.label} <span aria-hidden="true">↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ))}
        </p>
      )}
      {w.private && w.status === 'live' && (
        <p className="work-note">Shown, not linked — its screenshot is in Artifacts on the home page.</p>
      )}
      {station && w.status === 'live' && <p className="work-note">In the flight at {station}</p>}
    </li>
  );
}
