import { useCallback, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, SyntheticEvent } from 'react';
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

      {a.kind === 'image' && a.src && (
        <ArtifactDiagram src={a.src} alt={a.alt ?? station.title} title={station.title} />
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

/**
 * The diagram artifact, and the phone's way INTO it.
 *
 * The three image artifacts are 1200x750 schematics whose labels are set at
 * 10-12px. In the 560px desktop panel the figure renders at 505px — 0.42
 * scale, so a 10px label lands at ~4.2px, which is the version the owner
 * signed off after fourteen rounds of live feedback and which nothing below
 * touches. On a 390px phone the SAME figure renders at 322px: 0.27 scale,
 * ~2.7px type, a grey smudge at the foot of the panel (measured, and the
 * owner's screenshot is what raised it). That is worse than omitting it,
 * because the diagram is the proof the copy above it is claiming and a smudge
 * reads as a broken image — it makes the claim look unbacked.
 *
 * The fix is not to shrink or crop the figure, which cannot help at 322px. It
 * is to give the phone a way to see the thing at a size where it can be read,
 * with an affordance that SAYS so: a bare <img> that happens to respond to a
 * tap communicates nothing, so the frame gains a full-width labelled bar, the
 * measure and voice of the video figcaption above, that says "Open
 * full-screen" in as many words. Everything here is behind max-[820px], which
 * is the breakpoint polish.css already spells for its "mobile ergonomics"
 * block — two files disagreeing by 52px about where the phone ends is how a
 * control ends up sized for touch on a viewport that no longer shows it. Above
 * 820px the bar is display:none, so it is absent from the layout, from the
 * a11y tree and from the tab order, and the desktop deck is byte-identical.
 */
function ArtifactDiagram({ src, alt, title }: { src: string; alt: string; title: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLAnchorElement>(null);
  // The viewer's copy of the asset is not mounted until it is first asked for.
  // On desktop the bar can never be tapped, so this is the guarantee that the
  // feature costs the signed-off experience not one byte and not one decode.
  const [armed, setArmed] = useState(false);

  const open = useCallback((e: ReactMouseEvent<HTMLAnchorElement>) => {
    const d = dialogRef.current;
    // No <dialog> here means the href is the better answer — let it navigate.
    if (!d || typeof d.showModal !== 'function') return;
    e.preventDefault();
    setArmed(true);
    if (!d.open) d.showModal(); // showModal() on an open dialog throws
  }, []);

  const close = useCallback(() => dialogRef.current?.close(), []);

  // Native dialogs already return focus to whatever opened them, but the bar
  // is the element the visitor was working from and landing back on it is a
  // promise this component should keep on its own rather than inherit — so it
  // is stated, and re-focusing an already-focused element costs nothing.
  const restoreFocus = useCallback(() => openerRef.current?.focus(), []);

  // Flight listens for arrow keys on `window` and for swipes on `.stage`, and
  // the viewer — top layer or not — is still a DOM descendant of both. Without
  // this, a drag to pan the diagram flies the visitor to the next station and
  // an arrow key does the same underneath the open viewer. Propagation is
  // stopped and the default is deliberately NOT prevented: Escape closing the
  // dialog, Tab cycling inside it and the arrows scrolling the picture are all
  // UA behaviour that this viewer wants to keep exactly as the platform ships
  // it.
  const swallow = useCallback((e: SyntheticEvent) => e.stopPropagation(), []);

  return (
    <>
      {/* rounded-md, not rounded: an artifact frame is a container, and the
          ramp gives containers --r-3. Same measure as the copy above it, so
          the block has one left AND one right edge in static mode. */}
      <figure className="mt-5 max-w-prose overflow-hidden rounded-md border border-rule text-sm">
        {/* lazy: neighbouring panels mount before they're visible */}
        <img src={src} alt={alt} loading="lazy" className="block w-full" />
        {/* An <a> with a real href rather than a <button>, and the handler only
            preventDefaults once it has confirmed showModal exists: the viewer
            is the enhancement and the link is the floor. A browser without
            <dialog> opens the asset in its own tab, where an SVG is still
            lossless and still pinch-zoomable, and iOS keeps its long-press
            "Open in New Tab" / "Download Linked File" menu off the same href —
            all of which a <button> would have thrown away. */}
        <a
          ref={openerRef}
          href={src}
          target="_blank"
          rel="noreferrer"
          onClick={open}
          className="btn hidden w-full items-center justify-between gap-3 border-t border-rule bg-raised px-3 py-2.5 font-mono text-2xs uppercase tracking-widest text-ink max-[820px]:flex"
        >
          Open full-screen
          {/* Drawn, not typed. The house glyph vocabulary is arrows and an em
              dash because those are the ones proven to exist in the mono
              stack; the expand mark (U+2922) is not, and a control whose icon
              renders as a tofu box on the one device this change exists for is
              not a control. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="h-3 w-3 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          >
            <path d="M1 4.6V1h3.6M11 7.4V11H7.4M1.2 1.2l3.4 3.4M10.8 10.8L7.4 7.4" />
          </svg>
        </a>
      </figure>

      {/* Native <dialog> + showModal(), and both halves of that are
          load-bearing.
          GEOMETRY: StationPanel docks the mobile panel inside a framer-motion
          transform, and a transformed ancestor becomes the containing block
          for position:fixed — a hand-rolled overlay would be positioned
          against the sliding panel instead of the viewport, then clipped by
          the panel's own overflow and dissolved by its mask. showModal() puts
          the element in the TOP LAYER, which no ancestor transform, overflow,
          mask or z-index can reach.
          ACCESSIBILITY: the same call makes the rest of the document inert, so
          focus cannot wander out into the flight deck behind the viewer and
          Tab cannot walk the rail; Escape is handled as a native close
          request; and the trigger gets focus back on close. That is the whole
          a11y bar met by the platform rather than by a focus-trap of mine,
          which is the only version of it I would trust in a keyboard
          walkthrough that asserts document.activeElement after every move.
          A closed dialog is display:none per the UA stylesheet, so on desktop
          this element occupies no space and paints no pixel. */}
      <dialog
        ref={dialogRef}
        aria-label={`${title} — full-screen diagram`}
        onClose={restoreFocus}
        onKeyDown={swallow}
        onTouchStart={swallow}
        onTouchEnd={swallow}
        className="m-0 h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-[100dvw] border-0 bg-ground p-0 text-ink"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-3 border-b border-rule px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-2xs uppercase tracking-widest text-dim">
                {title}
              </p>
              <p className="truncate font-mono text-2xs uppercase tracking-widest text-faint">
                Drag to pan — pinch to zoom
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="btn shrink-0 rounded border border-rule-strong bg-raised px-3.5 py-2 text-xs text-ink"
            >
              Close
            </button>
          </div>
          {/* The picture is sized to the viewer's HEIGHT and left free to
              overflow horizontally. At 390x660 that is ~600px of diagram —
              0.80 scale, so the 10px labels land near 8px, roughly twice the
              effective size of the desktop figure that was signed off — and,
              more importantly, it is panned on ONE axis. Two-axis panning at
              1:1 would be sharper still and is the difference between reading
              a map and losing it. Pinch-zoom is there on top for anyone who
              wants 1:1, because index.html sets no maximum-scale.
              dvh, not vh: iOS Safari's 100vh is the toolbars-RETRACTED large
              viewport, so a vh-sized viewer would push its own header and the
              foot of the diagram behind Safari's chrome on exactly the frame
              the visitor is looking at.
              overscroll-contain so panning to the end of the diagram does not
              start scrolling the static page behind the viewer. */}
          <div className="flex-1 overflow-auto overscroll-contain">
            {armed && <img src={src} alt={alt} className="block h-full w-auto max-w-none" />}
          </div>
        </div>
      </dialog>
    </>
  );
}
