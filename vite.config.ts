/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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

export default defineConfig({
  plugins: [react(), asyncCss()],
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
