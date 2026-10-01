/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { WORK_META, WORK_POSITIONING } from './src/work/positioning';

/**
 * The pre-rendered gate shell in index.html is fully inline-styled, so the
 * external stylesheet has no business render-blocking the first paint — it
 * cost a full RTT + transfer of LCP on 4G (measured: LCP passed the 1.5s bar
 * by 2ms with it blocking). React can't mount before the (10x larger) JS
 * arrives anyway, so the CSS always wins that race and there is no unstyled
 * flash. noscript keeps the blocking link for the JS-disabled case.
 */
const asyncCss = (): Plugin => ({
  name: 'async-css',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (html) =>
      html.replace(
        /<link rel="stylesheet"([^>]*)>/g,
        `<link rel="stylesheet"$1 media="print" onload="this.media='all'"><noscript><link rel="stylesheet"$1></noscript>`,
      ),
  },
});

/**
 * /work gets its OWN document. The site is an SPA, so every path is served
 * index.html — whose title and og/twitter tags describe the home page. A
 * /work link pasted into LinkedIn or Slack would unfurl as the home page.
 * This emits work/index.html (served for /work by a netlify.toml rewrite):
 * the finished index.html with /work's title, description, canonical, og
 * and twitter tags, and a /work header shell in place of the home one, so
 * first paint is the page's own header. Every replacement must land — a
 * miss throws and fails the build rather than shipping the wrong card.
 */
const workPage = (): Plugin => ({
  name: 'work-page',
  apply: 'build',
  // order 'post': Vite's own HTML plugin emits index.html in this same hook,
  // and a normal-order hook runs before it, finding no index.html at all.
  generateBundle: { order: 'post', handler(_options, bundle) {
    const index = bundle['index.html'];
    if (!index || index.type !== 'asset') return;
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const { title, description, url } = WORK_META;
    const swaps: [RegExp, string][] = [
      [/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`],
      [/(name="description"\s+content=")[^"]*(")/, `$1${esc(description)}$2`],
      [/(rel="canonical" href=")[^"]*(")/, `$1${url}$2`],
      [/(property="og:url" content=")[^"]*(")/, `$1${url}$2`],
      [/(property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`],
      [/(property="og:description"\s+content=")[^"]*(")/, `$1${esc(description)}$2`],
      [/(name="twitter:title" content=")[^"]*(")/, `$1${esc(title)}$2`],
      [/(name="twitter:description"\s+content=")[^"]*(")/, `$1${esc(description)}$2`],
      [
        /<main class="mc-shell">[\s\S]*?<\/main>/,
        `<main class="mc-shell mc-work"><div><p class="mc-eyebrow">Proof of work</p>` +
          `<h1 class="mc-h1">Cameron Carpenter.</h1><p class="mc-intro">${esc(WORK_POSITIONING)}</p></div></main>`,
      ],
    ];
    let html = String(index.source);
    for (const [re, to] of swaps) {
      if (!re.test(html)) throw new Error(`[work-page] index.html no longer matches ${re} — /work would unfurl as the home page`);
      html = html.replace(re, to);
    }
    this.emitFile({ type: 'asset', fileName: 'work/index.html', source: html });
  } },
});

export default defineConfig({
  plugins: [react(), asyncCss(), workPage()],
  build: {
    // Budget discipline for the throttled-3G bar. Vite warns above this so a
    // dependency that blows the budget is caught at build time, not in a trace.
    chunkSizeWarningLimit: 180,
    rollupOptions: {
      output: {
        // Split the vendor floor out so route chunks stay small and the shell
        // can paint before the rest of the app arrives.
        // Function form, not object form: object-form manualChunks hoists the
        // named chunks into the ENTRY's preload graph — measured: an explicit
        // 'motion' entry made index.html modulepreload 87 kB of Framer Motion
        // on the gate screen, which the gate never imports. With the function
        // form, modules stay exactly where the import graph puts them: react
        // in the entry, framer-motion inside the lazy flight chunk, supabase
        // in its own lazy chunk.
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('react-router')) return 'react';
          if (id.includes('@supabase')) return 'supabase';
          // three.js deliberately gets NO named chunk: naming one ('gl') made
          // Rollup colocate Vite's shared preload-helper into it, which made
          // the ENTRY statically import the 966 kB chunk and modulepreload it
          // on the gate — measured FCP 1216ms → 2570ms. Left alone, the whole
          // WebGL stack rides inside the lazy Flight chunk (like
          // framer-motion), fetched only after a code redeems. Second time a
          // named chunk has hoisted into the entry preload graph in this
          // repo; treat any new manualChunks entry as guilty until the dist
          // index.html proves otherwise.
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
