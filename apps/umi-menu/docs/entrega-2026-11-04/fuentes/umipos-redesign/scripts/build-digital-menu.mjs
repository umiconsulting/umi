// Bundle the existing menu prototype into this Pages site, without a second host.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const flow = new URL('../umi-menu-preview/flow/', root)
const target = new URL('public/menu-digital/', root)
const tour = new URL('recorrido/', target)
execFileSync(process.execPath, ['scripts/sync-menu.mjs'], { cwd: flow, stdio: 'inherit' })
mkdirSync(target, { recursive: true })
cpSync(new URL('playground/flow-data.ts', flow), new URL('src/digital-menu-flow-data.ts', root))
execFileSync(process.execPath, [
  'node_modules/vite/bin/vite.js', 'build', 'playground',
  '--config', 'playground/vite.config.ts',
  '--base', '/menu-digital/recorrido/',
  '--outDir', fileURLToPath(tour), '--emptyOutDir',
], { cwd: flow, stdio: 'inherit' })
writeFileSync(new URL('menu.html', target), readFileSync(new URL('menu.html', tour), 'utf8').replace('</body>', '<script src="./preview-state.js"></script>\n</body>'))
cpSync(new URL('menu-preview-state.js', import.meta.url), new URL('preview-state.js', target))
cpSync(new URL('playground/public/assets/', flow), new URL('assets/', target), { recursive: true })
console.log('Menú y recorrido preparados en public/menu-digital/.')
