import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The default esbuild transform DROPS decorator metadata.
 *
 * `tsconfig.json` sets `emitDecoratorMetadata: true`. esbuild does not implement
 * it, so there is no `design:paramtypes` to emit. Every earlier spec builds its
 * class directly, so nothing found this. A spec that boots a real Nest module
 * does find it: Nest cannot resolve a constructor parameter by type, and every
 * injected dependency arrives `undefined`.
 *
 * SWC implements it. This config changes the TRANSFORM only. The same files run,
 * in the same order, under the same globs.
 *
 * `vitest.integration.config.ts` merges this file with `mergeConfig`, so the two
 * suites always share one transform.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
