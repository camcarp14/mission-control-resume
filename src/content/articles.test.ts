/* ==== ARTICLES CONTENT TEST ============================================== */
import { describe, it, expect } from 'vitest';
import { allArticles, formatDate, parseArticle } from './articles';

/**
 * Every article file on disk, drafts included — a draft is tomorrow's live
 * article, so it has to parse today. Each check is here because its failure
 * renders: a missing title is a blank link in the list, a malformed date is
 * "Invalid Date" on the live site, a bad slug is a URL nobody can type.
 */
describe('articles content contract', () => {
  it('parses flat front matter and strips it from the body', () => {
    const a = parseArticle(
      'x',
      '---\ntitle: "Quoted: with a colon"\ndate: 2026-01-02\nsummary: s\ndraft: true\n---\n\nHello there world',
    );
    expect(a.title).toBe('Quoted: with a colon');
    expect(a.date).toBe('2026-01-02');
    expect(a.draft).toBe(true);
    expect(a.body.trim()).toBe('Hello there world');
    expect(a.minutes).toBe(1);
  });

  it('formats dates in UTC so the day never slips', () => {
    expect(formatDate('2026-09-30')).toBe('Sep 30, 2026');
  });

  it('has unique slugs', () => {
    const slugs = allArticles.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  for (const a of allArticles) {
    describe(`article ${a.slug}`, () => {
      it('has a URL-safe slug (the filename)', () => {
        expect(a.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      });

      it('has a title, a summary, and a body', () => {
        expect(a.title.trim().length, 'front matter needs title:').toBeGreaterThan(0);
        expect(a.summary.trim().length, 'front matter needs summary:').toBeGreaterThan(0);
        expect(a.body.trim().length, 'article body is empty').toBeGreaterThan(0);
      });

      it('has a real YYYY-MM-DD date', () => {
        expect(a.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const d = new Date(`${a.date}T00:00:00Z`);
        expect(Number.isNaN(d.getTime())).toBe(false);
        expect(d.toISOString().slice(0, 10), 'date does not exist on the calendar').toBe(a.date);
      });
    });
  }
});
