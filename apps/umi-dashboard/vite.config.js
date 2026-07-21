import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.VITE_DEV_PORT || 4000);
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:4001';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // Committed design tokens, resolved at build time (no workspace/npm
        // dependency) so it works identically under Vercel's app-scoped npm build.
        '@umi/tokens': fileURLToPath(new URL('../../packages/tokens/dist', import.meta.url)),
        // Shared HTTP contract, consumed FROM SOURCE (Vite transpiles the zero-dep
        // routes entry) — same reason: no build artifact needed for the npm build.
        '@umi/contract': fileURLToPath(new URL('../../packages/contract/src', import.meta.url)),
      },
    },
    server: {
      port,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
    },
  };
});
