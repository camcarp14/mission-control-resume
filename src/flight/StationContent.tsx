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

      {/* Same measure as the summary above, and it has to be spelled the same
          way to BE the same: max-w-prose is 65ch, and ch resolves against the
          element's own font-size, so the cap only lands on 517px if text-sm
          sits on the <ul> itself rather than on each <li>. It did not, the
          <ul> had no cap at all, and in static mode the bullets ran to the
          full 632px container while the summary stopped at 517 — two
          different line lengths in one block, which reads as nobody having
          decided. Inside a flight panel the container is narrower than the
          cap either way, so this is invisible there and load-bearing here. */}
      <ul className="mt-4 max-w-prose space-y-2 text-sm">
        {station.bullets.map((b) => (
          <li key={b} className="flex gap-2.5 leading-relaxed text-ink">
            <span aria-hidden="true" className="select-none text-faint">
              —
            </span>
            <span className="num">{b}</span>
          </li>
        ))}
      </ul>

      {a.kind === 'link' && a.href && (
        <a
          className="btn primary mt-5 inline-flex items-center gap-2 rounded border border-rule-strong bg-raised px-3.5 py-2 text-xs text-ink"
          href={a.href}
          target={a.href.startsWith('mailto:') ? undefined : '_blank'}
          rel="noreferrer"
        >
          {a.label ?? 'View the artifact'}
          <span aria-hidden="true">↗</span>
        </a>
      )}

      {/* rounded-md, not rounded: an artifact frame is a container, and the
          ramp gives containers --r-3. Same measure as the copy above it, so
          the block has one left AND one right edge in static mode. */}
      {a.kind === 'image' && a.src && (
        <figure className="mt-5 max-w-prose overflow-hidden rounded-md border border-rule text-sm">
          {/* lazy: neighbouring panels mount before they're visible */}
          <img src={a.src} alt={a.alt ?? station.title} loading="lazy" className="block w-full" />
        </figure>
      )}

      {a.kind === 'video' && a.videoSrc && (
        <figure className="mt-5 max-w-prose overflow-hidden rounded-md border border-rule text-sm">
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
