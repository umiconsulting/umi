import { defineConfig } from 'vitest/config';
import path from 'path';

// Minimal unit-test runner. Resolves the `@/` alias to match tsconfig paths.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
