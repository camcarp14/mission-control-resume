/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
