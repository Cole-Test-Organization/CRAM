import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

// Test-only config, deliberately separate from vite.config.ts so the
// `resolve.conditions` tweak below (needed for Solid under test) can never leak
// into the production `vite build`. Vitest auto-discovers this file.
export default defineConfig({
  plugins: [solid()],
  // Solid publishes separate server/client builds. Force the dev/browser build
  // so component rendering + reactivity behave the same as they do in the app.
  resolve: {
    conditions: ['development', 'browser'],
  },
  test: {
    // jsdom is the in-memory DOM — gives us document/window/HTMLElement in Node
    // with no real browser and no painting.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
