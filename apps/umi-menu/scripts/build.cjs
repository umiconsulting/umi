// Copia el sitio estático. La documentación nunca entra en la salida pública.
const { mkdirSync, copyFileSync, cpSync, rmSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const out = resolve(root, 'dist');
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
]) {
  copyFileSync(resolve(root, 'src', file), resolve(out, file));
}
cpSync(resolve(root, 'public'), out, { recursive: true });
console.log('Menú estático preparado en dist/.');
