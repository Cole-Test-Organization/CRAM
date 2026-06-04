import { defineConfig, devices } from '@playwright/test';

// The app under test is stood up and torn down by dev/scripts/test/run-e2e-tests.js
// (build GUI → migrate → seed → boot the REAL Fastify API serving the GUI + /api
// on ONE origin). Playwright therefore does NOT own a `webServer` here — it just
// drives the already-running, seeded stack at BASE_URL. See TEST-SPEC.md §6–7.
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:3201';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',

  // Serial. Every journey writes to ONE shared seeded database (same stance as
  // the backend suite's `--test-concurrency=1`). Determinism over speed — this
  // is the thin cap of the trophy, not the fat middle.
  workers: 1,
  fullyParallel: false,

  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },

  reporter: isCI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    // Failure-triage artifacts ONLY — NOT visual-regression baselines. Per
    // TEST-SPEC §7, pixel/screenshot DIFFING (`toHaveScreenshot`) is deliberately
    // out of scope (that's the brittle kind). A trace/screenshot captured when a
    // run goes red is just for debugging, never an assertion.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    // Thin cap: Chromium desktop only. Cross-browser and mobile-viewport E2E are
    // a deliberate future expansion, not part of the Phase-4 thin layer.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
