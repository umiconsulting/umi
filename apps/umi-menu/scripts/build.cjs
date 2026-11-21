const { mkdirSync, copyFileSync, cpSync, rmSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { buildSync } = require('esbuild');
const root = resolve(__dirname, '..');
const out = resolve(root, 'dist');
const apiOrigin = process.env.UMI_MENU_API_ORIGIN || 'https://api-staging.umiconsulting.co';
const url = new URL(apiOrigin);
if (
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== '/' ||
  (url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
)
  throw new Error('UMI_MENU_API_ORIGIN must be an HTTPS origin or local HTTP origin.');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const file of [
  'index.html',
  'base.js',
  'state.js',
  'app.js',
  'visual.js',
  'navigation.js',
  'mvp.css',
])
  copyFileSync(resolve(root, 'src', file), resolve(out, file));
buildSync({
  entryPoints: [resolve(root, 'src/api.js')],
  bundle: true,
  outfile: resolve(out, 'api.js'),
  platform: 'browser',
  format: 'iife',
  globalName: 'UmiMenuAPI',
  target: ['es2020'],
  minify: true,
  define: { __UMI_API_ORIGIN__: JSON.stringify(url.origin) },
});
cpSync(resolve(root, 'public'), out, { recursive: true });
writeFileSync(resolve(out, '_redirects'), '/* /index.html 200\n');
writeFileSync(
  resolve(out, '_headers'),
  '/*\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  Cache-Control: no-cache\n',
);
console.log(`Menú preparado en dist/. API: ${url.origin}`);
