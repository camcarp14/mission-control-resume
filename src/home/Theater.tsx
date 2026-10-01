import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * The big view both home panels open into: a modal panel over a dimmed,
 * blurred page, in the same material as the panels themselves. It owns the
 * modal contract so each section only supplies what goes inside:
 *
 *  - Esc, the close button, or a click on the backdrop closes it;
 *  - focus moves to the close button on open, is held inside while it is
 *    open (Tab wraps), and goes back to whatever opened it on close;
 *  - the page behind stops scrolling until it closes.
 *
 * Portalled to <body> so no panel's overflow or stacking context can clip
 * it; still inside the React tree, so router links work from in here.
 */
export function Theater({
  id,
  title,
  icon,
  onClose,
  headStart,
  panelRef,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  onClose: () => void;
  /** Optional control pinned to the head's left edge (e.g. a back button). */
  headStart?: ReactNode | undefined;
  /** The scrolling panel, for callers that need to reset its scroll. */
  panelRef?: RefObject<HTMLDivElement | null> | undefined;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useCallback(() => onCloseRef.current(), []);

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = 'hidden';
    closeBtn.current?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'Tab' && dialog.current) {
        const f = Array.from(
          dialog.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
        ).filter((el) => el.tabIndex >= 0);
        const first = f[0];
        const last = f[f.length - 1];
        if (!first || !last) return;
        const inside = dialog.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      html.style.overflow = prevOverflow;
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, [close]);

  return createPortal(
    <div ref={dialog} className="theater" role="dialog" aria-modal="true" aria-labelledby={id}>
      <div className="theater-backdrop" onClick={close} />
      <div ref={panelRef} className="theater-panel" tabIndex={-1}>
        <div className="theater-head">
          {headStart && <div className="theater-start">{headStart}</div>}
          <span className="col-icon" aria-hidden="true">
            {icon}
          </span>
          <h2 id={id} className="col-title">
            {title}
          </h2>
          <button
            ref={closeBtn}
            type="button"
            className="btn theater-close"
            onClick={close}
            aria-label={`Close ${title.toLowerCase()}`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** The panel-corner button that opens a section's big view. */
export function ExpandButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn card-expand" onClick={onClick} aria-label={label} title="Expand">
      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
        <path
          d="M7.5 1.5h3v3M10.5 1.5 7 5M4.5 10.5h-3v-3M1.5 10.5 5 7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
