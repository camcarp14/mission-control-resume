import { stations } from '../content/stations.js';

export type Station = (typeof stations)[number];

/**
 * The station anatomy, rendered identically in flight mode and static mode so
 * the "skip the flight" page is the same resume, not a lesser one. Everything
 * here derives from the config entry — no station-specific code, ever.
 */
export function StationContent({ station }: { station: Station }) {
  const a = station.artifact;
  return (
    <>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="h-2 w-2 rounded-full border border-rule-strong" />
        <span className="font-mono text-2xs uppercase tracking-widest text-faint">
          {station.code}
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-rule" />
      </div>

      <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink md:text-2xl">
        {station.title}
      </h2>

      {/* The takeaway, not the description — the one line a panelist remembers. */}
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-dim">{station.proves}</p>

      <ul className="mt-4 space-y-2">
        {station.bullets.map((b) => (
          <li key={b} className="flex gap-2.5 text-sm leading-relaxed text-ink">
            <span aria-hidden="true" className="select-none text-faint">
              —
            </span>
            <span className="num">{b}</span>
          </li>
        ))}
      </ul>

      {a.kind === 'link' && a.href && (
        <a
          className="btn primary mt-5 inline-flex items-center gap-2 border border-rule-strong bg-raised px-3.5 py-2 text-xs text-ink"
          href={a.href}
          target={a.href.startsWith('mailto:') ? undefined : '_blank'}
          rel="noreferrer"
        >
          {a.label ?? 'View the artifact'}
          <span aria-hidden="true">↗</span>
        </a>
      )}

      {a.kind === 'image' && a.src && (
        <figure className="mt-5 overflow-hidden rounded border border-rule">
          {/* lazy: neighbouring panels mount before they're visible */}
          <img src={a.src} alt={a.alt ?? station.title} loading="lazy" className="block w-full" />
        </figure>
      )}

      {a.kind === 'video' && a.videoSrc && (
        <figure className="mt-5 overflow-hidden rounded border border-rule">
          <video
            className="block w-full"
            src={a.videoSrc}
            poster={a.poster}
            controls
            preload="none"
            aria-label={`20-second walkthrough — ${station.title}`}
          />
          <figcaption className="border-t border-rule px-3 py-1.5 font-mono text-2xs uppercase tracking-widest text-faint">
            20s walkthrough
          </figcaption>
        </figure>
      )}
    </>
  );
}
