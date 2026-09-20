import { defineConfig } from 'vite';

/**
 * Twinfabric builds two ways on purpose:
 *
 *   npm run dev / build   Vite resolves `three` from node_modules.
 *   no toolchain at all   the import map in index.html resolves `three` from a
 *                         CDN, and any static file server runs the app as-is.
 *
 * The import map is inert under Vite (the bundler rewrites bare specifiers
 * before the browser ever consults it), so both paths coexist. Keeping the
 * zero-install path alive matters: this project is used by AV and facilities
 * engineers on locked-down machines with no Node.
 */
export default defineConfig({
  base: './',
  server: {
    port: 8123,
    open: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // The pure layers are the ones worth measuring; three/ and ui/ need a
      // browser and are covered by manual QA until a headless harness exists.
      include: ['src/core/**', 'src/model/**', 'src/logic/**', 'src/persist/**'],
    },
  },
});
