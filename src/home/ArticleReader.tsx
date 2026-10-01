import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { articles, getArticle } from '../content/articles';
import { Empty } from '../ui/primitives';
import ArticleView from './ArticleView';

/**
 * One article, set for reading: a narrow measure, larger type than the rest
 * of the (deliberately dense) site, and no scenery behind it. The only chrome
 * is the way back and the way on. The body itself is ArticleView, shared
 * with the home page's Articles big view.
 */
export default function ArticleReader() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const article = getArticle(slug);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (!article) return;
    const prev = document.title;
    document.title = `${article.title} — Cameron Carpenter`;
    return () => {
      document.title = prev;
    };
  }, [article]);

  const idx = article ? articles.indexOf(article) : -1;
  // Newest first, so the NEXT thing to read is the older neighbour.
  const older = idx >= 0 ? articles[idx + 1] : undefined;
  const newer = idx > 0 ? articles[idx - 1] : undefined;

  return (
    <div className="reader">
      <header className="reader-bar">
        <Link to="/articles" className="reader-back">
          <span aria-hidden="true">←</span> Articles
        </Link>
        <Link to="/" className="reader-home">
          Cameron Carpenter
        </Link>
      </header>

      {!article ? (
        <main className="reader-col pagefade">
          <Empty
            title="That article isn’t here."
            hint="It may have been renamed or taken down. Everything that’s published is on the articles page."
            action={{ label: 'All articles', onClick: () => navigate('/articles') }}
          />
        </main>
      ) : (
        <main className="reader-col pagefade">
          <ArticleView article={article} />

          {(older || newer) && (
            <nav aria-label="More articles" className="reader-more">
              {newer ? (
                <Link to={`/articles/${newer.slug}`} className="reader-next">
                  <span className="reader-next-k">Newer</span>
                  <span className="reader-next-t">{newer.title}</span>
                </Link>
              ) : (
                <span />
              )}
              {older && (
                <Link to={`/articles/${older.slug}`} className="reader-next reader-next-r">
                  <span className="reader-next-k">Older</span>
                  <span className="reader-next-t">{older.title}</span>
                </Link>
              )}
            </nav>
          )}

          <footer className="reader-foot">
            <Link to="/articles" className="btn border border-rule bg-panel px-3.5 py-2 text-xs text-ink">
              ← All articles
            </Link>
          </footer>
        </main>
      )}
    </div>
  );
}
