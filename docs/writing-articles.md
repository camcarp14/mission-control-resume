---
title: How to publish an article here
date: 2026-09-30
summary: The whole workflow is one Markdown file — this sample shows every formatting option the reader supports.
draft: true
---

This is a worked example, kept in `docs/` so it never renders. Copy it into `src/content/articles/` as a starting point, rename it, and replace the words. While its front matter says `draft: true` it shows only in `npm run dev`; delete that line to publish.

## Publishing a new article

1. Add a file to `src/content/articles/`. The filename becomes the URL: `why-i-build.md` is served at `/articles/why-i-build`.
2. Start it with the front matter block you see at the top of this file — `title`, `date` (YYYY-MM-DD), and a one-sentence `summary`.
3. Write the body in plain Markdown underneath.
4. Delete the `draft: true` line when it's ready to go live, then deploy.

The list sorts itself newest-first by `date`, and the reading time is calculated for you.

## What the reader supports

Regular paragraphs, *italics*, **bold**, and [links](https://camcarp.com). Headings with `##` and `###`.

### Lists

- Bulleted lists
- Like this one

### Quotes

> A pull quote or a quote from someone else sits here, set off with a rule on its left.

### Code

Inline `code`, or a block:

```
function hello() {
  return 'world';
}
```

### Images

Put the file in `public/articles/` and reference it by its root path: `![Alt text](/articles/my-chart.png)`.

---

A horizontal rule (three dashes) breaks a long piece into parts.
