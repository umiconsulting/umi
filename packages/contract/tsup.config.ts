import { defineConfig } from 'tsup';

// Dual CJS + ESM + .d.ts so both consumers resolve cleanly:
//   - umi-api (NestJS, CommonJS runtime) require()s dist/index.cjs; its node10
//     tsconfig reads the top-level main/types.
//   - umi-dashboard (Vite/ESM) imports the routes entry (via a source alias in
//     dev/build; the ESM dist is here for any packaged consumer).
export default defineConfig({
  entry: ['src/index.ts', 'src/routes.ts', 'src/entitlements.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  target: 'node22',
  clean: true,
  sourcemap: false,
  // No code-splitting: two tiny entries → keep flat index.*/routes.* outputs,
  // no chunk-*.js files cluttering dist/.
  splitting: false,
});
