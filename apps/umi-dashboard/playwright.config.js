import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.js',
  outputDir: '/tmp/umi-dashboard-playwright-results',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4011',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev --port 4011 --strictPort',
    url: 'http://127.0.0.1:4011',
    reuseExistingServer: false,
    env: {
      VITE_UMI_ENVIRONMENT: 'test',
      VITE_AUTH_MODE: 'cookie',
      VITE_API_BASE: '',
      VITE_API_PROXY_TARGET: 'http://127.0.0.1:1',
    },
  },
});
