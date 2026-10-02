import { defineConfig } from '@playwright/test';

/**
 * UI regression and accessibility checks on the web export.
 *
 * Screenshots are compared against baselines rendered in the Playwright Linux
 * container (the same image CI runs in), so run this through
 * `npm run test:web` rather than a bare `playwright test` on Windows or macOS,
 * whose font rendering differs.
 */
export default defineConfig({
  testDir: 'tests/web',
  snapshotPathTemplate: '{testDir}/__snapshots__/{projectName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  expect: {
    // The container renders identically run to run, so no per-pixel tolerance:
    // even a one-step colour change in a token is a change to review.
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', threshold: 0 },
  },
  use: {
    baseURL: 'http://localhost:8099',
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 } } },
    // WCAG 1.4.10 reflow: content must work at 320 CSS pixels wide.
    { name: 'reflow-320', use: { viewport: { width: 320, height: 640 } } },
  ],
  webServer: {
    command: 'node tests/web/serve.mjs',
    url: 'http://localhost:8099',
    reuseExistingServer: !process.env.CI,
  },
});
