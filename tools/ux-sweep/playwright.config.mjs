import { defineConfig } from '@playwright/test';

/**
 * Config for the ux-sweep Playwright tests (visual regression today).
 *
 * The tests do not launch their own browser: they attach to the operator's
 * Chromium over CDP, which is already signed in to the local Dashboard. That is
 * why `workers` is 1 — one browser, one window, one shared session. See
 * `visual-regression.spec.mjs` for the fixture and `tools/ux-sweep/README.md`
 * for the exact commands.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.mjs',
  // Failures write renders, diffs and error contexts here. Keeping them outside
  // the repository stops `format:check` and `git status` from picking up build
  // output that the repo never asked for.
  outputDir: '/tmp/ux/playwright-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  expect: {
    toHaveScreenshot: {
      // The Dashboard renders live data, so a pixel-exact match would fail on a
      // currency amount. A 2 percent budget catches layout and style drift
      // without failing on a number that changed.
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
});
