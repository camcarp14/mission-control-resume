import { Link } from 'react-router-dom';
import { articles, formatDate } from '../content/articles';

/**
 * The article index: date, title, one-line summary, reading time. Nothing
 * else — the words are the design. Every row is a single link so the whole
 * row is the hit target, newest first. The home panel passes `limit` (and
 * centres the rows to match the panel) and links onward to /articles, which
 * renders the full list left-aligned for reading.
 */
export default function Articles({
  limit,
  centered = false,
  onOpen,
}: {
  limit?: number | undefined;
  centered?: boolean | undefined;
  /** When given, rows (and "All articles") open in place instead of
   *  navigating — the big view. They stay real links, so a middle-click or
   *  a copied address still goes to the article's own page. */
  onOpen?: ((slug: string | null) => void) | undefined;
}) {
  const open = (slug: string | null) => (e: React.MouseEvent) => {
    if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onOpen(slug);
  };

  if (articles.length === 0) return <ComingSoon />;

  const shown = limit ? articles.slice(0, limit) : articles;

  return (
    <>
      <ol className={centered ? 'artlist artlist-center' : 'artlist'}>
        {shown.map((a) => (
          <li key={a.slug}>
            <Link to={`/articles/${a.slug}`} className="artrow" onClick={open(a.slug)}>
              <span className="artrow-meta num">
                <time dateTime={a.date}>{formatDate(a.date)}</time>
                <span aria-hidden="true"> · </span>
                {a.minutes} min read
                {a.draft && <span className="artrow-draft">Draft</span>}
              </span>
              <span className="artrow-title">
                {a.title}
                <span className="artrow-arrow" aria-hidden="true">
                  →
                </span>
              </span>
              <span className="artrow-summary">{a.summary}</span>
            </Link>
          </li>
        ))}
      </ol>
      {limit !== undefined && articles.length > limit && (
        <div className={centered ? 'text-center' : undefined}>
          <Link to="/articles" className="artmore" onClick={open(null)}>
            All {articles.length} articles <span aria-hidden="true">→</span>
          </Link>
        </div>
      )}
    </>
  );
}

/** No published articles yet: a radar listening for the first one, and what
 *  it will be about. Honest — nothing is linked, nothing is promised by date. */
function ComingSoon() {
  return (
    <div className="soon">
      <div className="soon-radar" aria-hidden="true" />
      <p className="soon-kicker">Coming soon</p>
      <h3 className="soon-title">First articles are on the way</h3>
      <p className="soon-text">
        Field notes on building with AI inside real marketing teams — written from the work, not about it.
      </p>
      <ul className="soon-topics" aria-label="Topics">
        <li>Applied AI</li>
        <li>Call intelligence</li>
        <li>Performance marketing</li>
      </ul>
    </div>
  );
}

