import { defineConfig } from '@playwright/test';

// Reuse only the explicitly configured disposable stack and its CDP browser.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'inventory-import.pw.js',
  outputDir: '/private/tmp/umi-inventory-import-playwright-results',
  workers: 1,
  timeout: 240000,
});
