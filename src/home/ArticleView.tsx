import { useMemo } from 'react';
import { marked } from 'marked';
import { formatDate, type Article } from '../content/articles';

/**
 * One article's body — meta line, title, dek, rendered Markdown — shared by
 * the /articles/:slug page and the Articles big view, so the two can never
 * set the same words differently. Its own module because it carries the
 * Markdown renderer: the home page only fetches it when someone opens an
 * article.
 *
 * The Markdown is the owner's own, from files in this repo, so it is rendered
 * as-is — there is no visitor-supplied text anywhere in it.
 */
export default function ArticleView({
  article,
  heading: Heading = 'h1',
}: {
  article: Article;
  heading?: 'h1' | 'h3' | undefined;
}) {
  const html = useMemo(
    () => marked.parse(article.body, { async: false, gfm: true }),
    [article],
  );

  return (
    <article>
      <p className="reader-meta num">
        <time dateTime={article.date}>{formatDate(article.date)}</time>
        <span aria-hidden="true"> · </span>
        {article.minutes} min read
        {article.draft && <span className="artrow-draft">Draft</span>}
      </p>
      <Heading className="reader-title">{article.title}</Heading>
      <p className="reader-dek">{article.summary}</p>
      <div className="prose-mc" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
