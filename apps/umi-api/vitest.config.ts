import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The default esbuild transform DROPS decorator metadata.
 *
 * `tsconfig.json` sets `emitDecoratorMetadata: true`, and esbuild does not
 * implement it — it has no `design:paramtypes` to emit. Every existing spec
 * constructs its class directly, so nothing noticed. The moment a spec boots a
 * real Nest module, Nest cannot resolve a constructor parameter by type and
 * every injected dependency arrives `undefined`.
 *
 * SWC does implement it. This config changes the TRANSFORM only: the same files
 * run, in the same order, under the same globs.
 *
 * `vitest.integration.config.ts` declares the SAME plugin. Vitest gives no way
 * to extend one config from another here, so the line is repeated. Change both
 * together: a suite that runs under one transform and not the other fails in a
 * way that looks like a code defect.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
