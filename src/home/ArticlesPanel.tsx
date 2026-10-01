import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { articles, getArticle } from '../content/articles';
import Articles from './Articles';
import { PanelSkeleton } from './Home';
import { IconArticles } from './icons';
import { ExpandButton, Theater } from './Theater';

/**
 * The Articles panel on the home page, and its big view.
 *
 * Clicking anywhere in the panel (or its expand button) opens the big view
 * on the full list; clicking an article opens the big view straight onto it.
 * Inside, an article reads at full size with a back button to the list and
 * a link out to its own page (/articles/:slug — the address to share).
 * The Markdown renderer only loads when the first article is opened.
 */
const ArticleView = lazy(() => import('./ArticleView'));

export default function ArticlesPanel() {
  // undefined = shut; null = open on the list; a slug = open on that article.
  const [open, setOpen] = useState<string | null | undefined>(undefined);

  if (articles.length === 0) return <Articles />;

  return (
    <>
      <div className="col-expandable" onClick={() => setOpen(null)}>
        <Articles limit={4} centered onOpen={setOpen} />
      </div>
      <ExpandButton label="Open articles full screen" onClick={() => setOpen(null)} />
      {open !== undefined && <ArticlesTheater initial={open} onClose={() => setOpen(undefined)} />}
    </>
  );
}

function ArticlesTheater({ initial, onClose }: { initial: string | null; onClose: () => void }) {
  const [slug, setSlug] = useState(initial);
  const panel = useRef<HTMLDivElement>(null);
  const article = slug ? getArticle(slug) : undefined;
  const first = useRef(true);

  // Each switch between list and article starts at the top, and takes focus
  // with it — the row that was clicked no longer exists.
  useEffect(() => {
    panel.current?.scrollTo(0, 0);
    if (first.current) {
      first.current = false;
      return;
    }
    panel.current?.focus({ preventScroll: true });
  }, [slug]);

  return (
    <Theater
      id="articles-theater-title"
      title="Articles"
      icon={<IconArticles />}
      onClose={onClose}
      panelRef={panel}
      headStart={
        article ? (
          <button type="button" className="btn theater-back" onClick={() => setSlug(null)}>
            <span aria-hidden="true">←</span> All
          </button>
        ) : undefined
      }
    >
      {article ? (
        <div key={article.slug} className="theater-article pagefade">
          <Suspense fallback={<PanelSkeleton />}>
            <ArticleView article={article} heading="h3" />
          </Suspense>
          <div className="theater-article-foot">
            <button type="button" className="artmore" onClick={() => setSlug(null)}>
              <span aria-hidden="true">←</span> All articles
            </button>
            <Link to={`/articles/${article.slug}`} className="artmore">
              Open as a page <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="theater-list pagefade">
          <Articles onOpen={(s) => s && setSlug(s)} />
        </div>
      )}
    </Theater>
  );
}
