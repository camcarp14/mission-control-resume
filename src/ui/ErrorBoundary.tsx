import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * The only component in this app that is allowed to know the flight can break.
 *
 * Everything downstream of the gate is lazy: the flight chunk (with three.js
 * and Framer inside it) and the dashboard chunk are both fetched on demand,
 * from a CDN, over whatever wifi the visitor happens to be on. Two failure
 * modes follow from that, and React only tells you about one of them:
 *
 *   1. a render throw anywhere in the tree — caught here, because hooks
 *      cannot catch and a class component is still the only mechanism React
 *      offers;
 *   2. a dynamic import that never arrives (dropped connection, or a chunk
 *      hash that no longer exists because Netlify deployed over it while the
 *      tab sat open) — this one surfaces first as Vite's `vite:preloadError`
 *      window event, NOT as a render error, and is handled below.
 *
 * Without both, either failure blanks the document to white. On a portfolio
 * that is the worst outcome available: the visitor cannot tell a broken site
 * from a broken developer, and there is nothing on screen to click.
 */

/** Marks the last self-heal attempt so a permanently-missing chunk can't loop. */
const RELOAD_KEY = 'mc.chunkReload';

/** A stale-deploy miss is fixed by one reload; anything still failing inside
 *  this window is a real outage, and the fallback must be allowed to speak
 *  instead of the tab reloading itself forever. */
const RELOAD_WINDOW_MS = 30_000;

/**
 * Installed at module load rather than in an effect: the listener has to be
 * live BEFORE the first dynamic import can fail, and App imports this module
 * synchronously in the entry chunk, so module scope is the earliest honest
 * place. Idempotent by construction — ES modules evaluate once.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (e) => {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    } catch {
      // Safari private mode throws on storage; treat it as "never tried".
    }
    // Second failure in a row: do NOT preventDefault. Letting Vite throw is
    // what routes the failure into the boundary below, which is the only
    // screen that can offer the PDF.
    if (Date.now() - last < RELOAD_WINDOW_MS) return;
    try {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      // Storage-less browsers get exactly one reload per page load, which is
      // still strictly better than a white screen.
    }
    e.preventDefault();
    window.location.reload();
  });
}

type Props = {
  children: ReactNode;
  /** The thing that failed, in the fallback's own sentence: "The flight
   *  didn't load." Kept as prose rather than an id because it is copy. */
  what?: string;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // No telemetry service here on purpose — the gate's whole promise is that
    // nothing about a visitor leaves the page uninvited. The console is for
    // the owner, who is the only person who will ever open devtools here.
    console.error(`[mission-control] ${this.props.what ?? 'This page'} failed:`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return <Failed what={this.props.what ?? 'This page'} />;
  }
}

/**
 * The fallback. Same voice and same shape as ErrorState in ui/primitives —
 * an accent-bordered box, a plain sentence that takes the blame, and an exit
 * — but deliberately written out here instead of importing that component:
 * the fallback renders in the wreckage of a render that just threw, so it
 * imports nothing that could throw with it, and it needs TWO exits (a reload
 * and the paper) where ErrorState offers one Retry.
 *
 * The rule this screen obeys: never trap. Whatever broke, the visitor leaves
 * with the résumé.
 */
function Failed({ what }: { what: string }) {
  return (
    <main className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="w-full max-w-lg">
        <p className="font-mono text-2xs uppercase tracking-widest text-faint">Mission Control</p>
        <div className="mt-6 border border-accent/30 bg-accent-dim p-5">
          <div className="text-2xs uppercase tracking-widest text-accent">Error</div>
          <p className="mt-2 text-sm leading-relaxed text-ink">
            {what} didn&rsquo;t load — that&rsquo;s this site&rsquo;s problem, not yours. Usually
            it&rsquo;s a half-downloaded file or a deploy that landed while this tab was open, and
            one reload clears it.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="btn border border-rule-strong bg-raised px-3 py-1.5 text-xs text-ink"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <a
              className="btn border border-rule bg-panel px-3 py-1.5 text-xs text-ink"
              href="/resume.pdf"
              download
            >
              Download résumé PDF
            </a>
          </div>
        </div>
        <p className="mt-4 text-2xs text-faint">
          The PDF carries the same career and needs none of this to work.
        </p>
      </div>
    </main>
  );
}
