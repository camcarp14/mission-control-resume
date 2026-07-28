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
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
