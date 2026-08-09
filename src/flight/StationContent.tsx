import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode, SyntheticEvent } from 'react';
import { stations } from '../content/stations.js';

export type Station = (typeof stations)[number];

/* ==== THE TOUCH FRAME — the one number, spelled once ======================
 * Where the phone ends, for the purpose of the evidence disclosure below.
 *
 * It is 820 because that is what this component ALREADY says: the artifact
 * diagram's "Open full-screen" bar is behind max-[820px], matched in turn to
 * the "mobile ergonomics" block in polish.css. MOBILE_BREAKPOINT (768, in
 * src/engine/layout.ts) answers a genuinely different question — which axis
 * the flight travels on and whether panels are world-anchored beside their
 * planet — and is deliberately not consulted here. Mixing the two would mean
 * a panel dressed for touch (42px controls, a full-screen diagram bar) that
 * nonetheless opened with a desktop's worth of copy in it, in the 52px band
 * where the two files disagree.
 *
 * The important half of this decision is that it is made in exactly ONE
 * place. The default state is computed in JS, from this query, and the
 * stylesheet contains no breakpoint for the disclosure at all — .expand is
 * keyed on an `open` class and knows nothing about viewport width. So there
 * is no second number here that can drift away from the first.
 */
const TOUCH_FRAME = '(max-width: 820px)';

/* One MediaQueryList for every panel that asks, created on first use rather
 * than at import: three station panels are mounted at once during a leg, and
 * they are all asking the same question of the same viewport. */
let frameQuery: MediaQueryList | undefined;
const touchFrame = () => (frameQuery ??= window.matchMedia(TOUCH_FRAME));
const subscribeToFrame = (onChange: () => void) => {
  const q = touchFrame();
  q.addEventListener('change', onChange);
  return () => q.removeEventListener('change', onChange);
};
const readFrame = () => touchFrame().matches;

/* ---- what the visitor decided, per station ------------------------------
 * Keyed by station id and deliberately OUTSIDE React, because the flight deck
 * windows its panels: only current ±1 stay mounted, so component state would
 * remember a choice for as long as you stayed in the neighbourhood and forget
 * it the moment you flew three stations away. A control whose memory depends
 * on how far you wandered is worse than one with no memory at all — it is
 * indistinguishable from a bug. This map makes the answer the same either
 * way: for the life of the page, a station you opened stays open and a
 * station you closed stays closed, and one you never touched shows the
 * current frame's default.
 *
 * Per station id, so closing STN 03 cannot close STN 07 — the ids are unique
 * (the schema test owns that), so two stations cannot share an entry.
 * Session-lived only: a preference this small does not deserve storage, and
 * writing it there would mean a visitor who collapsed one station on a
 * previous visit gets a phone-shaped panel on a desktop weeks later. */
const chosen = new Map<string, boolean>();

/* What is behind the control, in the artifact's own vocabulary — "20-second
 * walkthrough" is the phrasing the video's own aria-label already uses. The
 * empty string is not a missing case: a station with no artifact has nothing
 * to promise beyond its points, and the summary reads correctly without it. */
const ARTIFACT_NOUN: Record<Station['artifact']['kind'], string> = {
  none: '',
  link: 'a link',
  image: 'a diagram',
  video: 'a 20-second walkthrough',
};

/**
 * The station anatomy. The same component renders the flight panel and the
 * "skip the flight" page, and the two show the same material in the same
 * order from the same config — the static page is never a lesser resume.
 *
 * The ONE difference is chrome, not content: in the flight panel the bullets
 * and the artifact sit behind a disclosure (`disclosure`, default on), and in
 * the document they are simply there. See the note on <Evidence> for why the
 * document does not get the control, and why the default is the way round it
 * is.
 *
 * Everything here still derives from the config entry — no station-specific
 * code, ever.
 */
export function StationContent({
  station,
  disclosure = true,
}: {
  station: Station;
  /** False renders the whole station open, with no control — the document
   *  mode. It defaults TRUE because the flight panel's call site
   *  (StationPanel.tsx) belongs to the 3D deck and is not this pass's to
   *  edit; a new caller therefore has to opt out of the disclosure rather
   *  than into it. If that file ever opens up, invert this. */
  disclosure?: boolean;
}) {
  const a = station.artifact;

  /* The bullets and the artifact — the "meat", and everything the disclosure
     hides. What stays above it is the code, the title and `proves`, which is
     already exactly one sentence: the station still states its claim in full
     when it is closed, and what is behind the control is the evidence for a
     claim you have already read. A collapsed panel is a shorter station, never
     a vaguer one. */
  const meat = (
    <>
      {/* mt-3 in flight, mt-4 in the document: the control row above supplies
          the separation from the claim in flight mode and does not exist in
          the document, which keeps the vertical rhythm it was tuned on. */}
      {/* Same measure as the summary above, and it has to be spelled the same
          way to BE the same: max-w-prose is 65ch, and ch resolves against the
          element's own font-size, so the cap only lands on 517px if text-sm
          sits on the <ul> itself rather than on each <li>. It did not, the
          <ul> had no cap at all, and in static mode the bullets ran to the
          full 632px container while the summary stopped at 517 — two
          different line lengths in one block, which reads as nobody having
          decided. Inside a flight panel the container is narrower than the
          cap either way, so this is invisible there and load-bearing here. */}
      <ul className={`${disclosure ? 'mt-3' : 'mt-4'} max-w-prose space-y-2 text-sm`}>
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

      {disclosure ? <Evidence station={station}>{meat}</Evidence> : meat}
    </>
  );
}

/**
 * The evidence disclosure: the flight panel's bullets and artifact, and the
 * control that opens and closes them.
 *
 * WHY THE PANEL COLLAPSES AT ALL, in the owner's words: "on mobile the meat of
 * the artifacts should be expandable and start collapsed so the user gets the
 * experience more". The experience is the 3D — a station panel that fills a
 * short phone frame is a résumé printed over the top of the reason anyone
 * stayed. So on the touch frame this starts closed and the panel is a card
 * (measured: 178-234px at 390x660, against a capped 480px open — half the
 * frame handed back to the scene), and on a desktop, where the panel is docked
 * beside its planet with room to spare, it starts open and the control is
 * there to put it away.
 *
 * WHY THE DOCUMENT DOES NOT GET THIS. StaticMode renders with disclosure off,
 * so this component never mounts there, and that is a deliberate asymmetry
 * rather than an oversight:
 *   - Static mode is the canonical accessible version and the honest answer
 *     for someone who just wants to read. A scrolling document whose material
 *     is behind eleven toggles is a worse document, not a tidier one — it
 *     costs eleven decisions, eleven tab stops between sections, and it breaks
 *     Cmd-F and print, which are the two things a reader does to a résumé.
 *   - The control's entire justification is that there is something behind the
 *     panel worth seeing. On the static page there is nothing behind it. A
 *     control that buys the reader nothing is noise wearing a chevron.
 * The document therefore renders the same nodes with no wrapper at all, so it
 * does not even depend on a stylesheet class to be complete. (And if polish.css
 * ever failed to load, the flight panel degrades the safe way too: with no
 * .expand rule the region is simply open.)
 *
 * FINDABILITY, stated because it is a real trade. A closed region is
 * visibility:hidden (see .expand in polish.css) — it is out of the tab order,
 * out of the accessibility tree, and out of in-page find. That is the correct
 * bargain for a disclosure and it is the CONSISTENT one: the collapsed text is
 * absent for everybody rather than invisible to the eye but still announced to
 * a screen reader and still catching Tab, which is the state worth avoiding.
 * Anyone who wants the whole résumé findable in one pass has the static page
 * and the PDF, both one click away in the top bar.
 */
function Evidence({ station, children }: { station: Station; children: ReactNode }) {
  const touch = useSyncExternalStore(subscribeToFrame, readFrame);
  const [choice, setChoice] = useState<boolean | undefined>(() => chosen.get(station.id));

  /* An explicit choice outranks the frame's default, forever, for this
     station. That is what makes rotating a phone or dragging a window edge
     safe: crossing 820px re-answers the question only for stations the
     visitor never answered themselves, so a resize can never undo the tap
     they just made. Both directions land somewhere defensible — a station
     collapsed on a desktop stays collapsed on the phone (the phone's default
     anyway), and one opened on a phone stays open on the desktop (likewise).
     Stations they never touched simply take the new frame's default. */
  const open = choice ?? !touch;
  const regionId = `${station.id}-evidence`;

  /* A count and the artifact's nature, so opening it is an informed choice
     rather than a "More". This IS the accessible name — there is no aria-label
     over the top of it, which keeps the name and the visible text the same
     string (the uppercase is CSS, so a speech-input user says what they see).
     The plural is safe: the schema test pins every station at 2-3 bullets. */
  const noun = ARTIFACT_NOUN[station.artifact.kind];
  const summary = `${station.bullets.length} proof points${noun ? ` and ${noun}` : ''}`;

  return (
    <>
      {/* Two states, one control. CLOSED it is a filled bar in the exact
          vocabulary of the diagram's "Open full-screen" bar below it — a
          raised surface, a strong hairline, --r-2 because it is a control
          holding a label — because closed, it is an invitation and has to
          read as pressable. OPEN it drops the fill and becomes a rule row
          that rhymes with the STN eyebrow at the top of the panel (label,
          hairline, glyph): a section header with a handle on it, not a button
          shouting in the middle of a résumé the owner has signed off fifteen
          times. The chevron is the constant that says it is the same control,
          and it is cyan only when closed, where cyan is doing its usual job
          on this deck — chrome pointing at something. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => {
          const next = !open;
          chosen.set(station.id, next);
          setChoice(next);
        }}
        className={`btn mt-4 flex w-full items-center gap-3 font-mono text-2xs uppercase tracking-widest ${
          open ? 'text-faint' : 'rounded border border-rule-strong bg-raised px-3 py-2.5 text-ink'
        }`}
      >
        <span className="num">{summary}</span>
        {/* One element, two jobs: the spacer that pushes the chevron to the
            far edge when closed IS the eyebrow's hairline when open. */}
        <span aria-hidden="true" className={open ? 'h-px flex-1 bg-rule' : 'flex-1'} />
        {/* Drawn, not typed, for the reason spelled out under ArtifactDiagram:
            the mono stack is only proven to carry arrows and an em dash, and a
            control whose glyph renders as a tofu box is not a control. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={`evidence-chev h-3 w-3 shrink-0${open ? ' open' : ' text-hud'}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 4.75L6 8.25l3.5-3.5" />
        </svg>
      </button>

      {/* .expand is the house mechanism: a grid-template-rows 0fr -> 1fr
          animation that needs no measuring, no max-height guess and no
          ResizeObserver, and that is already gated under prefers-reduced-
          motion. The panel's own outer height changes when this runs, which
          the 3D rig's panel-height cache is being taught to expect. */}
      <div id={regionId} className={`expand${open ? ' open' : ''}`}>
        <div>{children}</div>
      </div>
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
