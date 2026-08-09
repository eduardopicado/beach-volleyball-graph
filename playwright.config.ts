/**
 * Browser smoke tests for the *built* site.
 *
 * These run against `vite preview` serving `dist/`, not the dev server, and at
 * the same `base` the deploy uses — so the thing under test is byte-identical
 * to the thing that ships, including the prerendered HTML and the asset URLs
 * that a wrong base path would break.
 *
 * The unit suite (`npm test`) covers pure logic and never loads a page. This
 * covers the other half: does the page actually render, and does what it
 * renders agree with the JSON it was built from.
 */

import { defineConfig, devices } from '@playwright/test';

/** Must match the BASE_PATH the site was built with, or preview 404s. */
const BASE_PATH = process.env.BASE_PATH ?? '/';
const PORT = Number(process.env.E2E_PORT ?? 4173);
const LOCAL_URL = `http://localhost:${PORT}${BASE_PATH}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // A stray `test.only` should fail the run rather than silently skip the suite.
  forbidOnly: !!process.env.CI,
  // One retry: a smoke suite that blocks deploys must not cry wolf over a
  // single slow frame. A genuinely broken page fails both attempts.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: LOCAL_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: LOCAL_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
