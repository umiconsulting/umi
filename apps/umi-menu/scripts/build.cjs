// Empaqueta el prototipo estático sin transformar sus scripts clásicos.
const { mkdirSync, copyFileSync, cpSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
for (const folder of ['dist', 'public']) {
  const out = resolve(root, folder);
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
    copyFileSync(resolve(root, file), resolve(out, file));
  for (const dir of ['files', 'qr'])
    cpSync(resolve(root, dir), resolve(out, dir), { recursive: true });
}
console.log('Menú estático preparado en dist/ y public/.');
