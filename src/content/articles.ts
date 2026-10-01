/* ==== ARTICLES — one Markdown file per article ============================
 *
 * Every file in src/content/articles/ is an article, and nothing else needs
 * editing to publish one. The filename is the URL slug (`why-i-build.md` →
 * /articles/why-i-build), so keep it lowercase-and-dashes and never rename a
 * published one — that breaks every link anyone has shared.
 *
 * Each file opens with a front matter block:
 *
 *   ---
 *   title: Why I build my own tools
 *   date: 2026-10-04
 *   summary: One sentence that sells the click.
 *   draft: true        ← optional; drafts render in `npm run dev` only
 *   ---
 *
 * The body below it is plain Markdown. docs/writing-articles.md is a worked
 * example of every format the reader supports — copy it in as a starting
 * point (it lives outside this folder so it never renders, even in dev).
 * src/content/articles.test.ts checks every file's front matter, so a typo'd
 * date fails the tests instead of rendering "Invalid Date" on the live site.
 * ========================================================================= */

export type Article = {
  slug: string;
  title: string;
  /** ISO date, YYYY-MM-DD */
  date: string;
  summary: string;
  draft: boolean;
  /** Markdown body, front matter stripped */
  body: string;
  minutes: number;
};

const files = import.meta.glob('./articles/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Flat `key: value` front matter — all an article needs, so no YAML dep. */
export function parseArticle(slug: string, raw: string): Article {
  const m = raw.match(FRONT_MATTER);
  const meta: Record<string, string> = {};
  if (m) {
    for (const line of (m[1] ?? '').split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i < 1) continue;
      const key = line.slice(0, i).trim();
      const value = line
        .slice(i + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2');
      meta[key] = value;
    }
  }
  const body = m ? raw.slice(m[0].length) : raw;
  const words = body.split(/\s+/).filter(Boolean).length;
  return {
    slug,
    title: meta.title ?? '',
    date: meta.date ?? '',
    summary: meta.summary ?? '',
    draft: meta.draft === 'true',
    body,
    minutes: Math.max(1, Math.round(words / 230)),
  };
}

/** Every article on disk, drafts included, newest first. */
export const allArticles: Article[] = Object.entries(files)
  .map(([path, raw]) => parseArticle(path.split('/').pop()!.replace(/\.md$/, ''), raw))
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

/** What the site shows: drafts are visible in dev and never in a build. */
export const articles: Article[] = import.meta.env.DEV
  ? allArticles
  : allArticles.filter((a) => !a.draft);

export function getArticle(slug: string): Article | undefined {
  return articles.find((a) => a.slug === slug);
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** 'Sep 30, 2026'. Parsed as UTC so the day never slips across a timezone. */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : DATE_FMT.format(d);
}
