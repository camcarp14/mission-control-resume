import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import Articles from './Articles';

/** /articles — every article, in the reader's calm layout rather than the
 *  home page's three columns. The home column shows the latest few and
 *  links here once there are more. */
export default function ArticlesPage() {
  useEffect(() => {
    window.scrollTo(0, 0);
    const prev = document.title;
    document.title = 'Articles — Cameron Carpenter';
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <div className="reader">
      <header className="reader-bar">
        <Link to="/" className="reader-back">
          <span aria-hidden="true">←</span> Home
        </Link>
        <Link to="/" className="reader-home">
          Cameron Carpenter
        </Link>
      </header>
      <main className="reader-col pagefade">
        <h1 className="reader-title">Articles</h1>
        <div className="mt-8">
          <Articles />
        </div>
      </main>
    </div>
  );
}
