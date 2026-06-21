/**
 * Side-effect module: loads .env.local then .env into process.env.
 * Import this FIRST in a script, before any app module that reads env at
 * load time (auth.ts, prisma, etc.) — ESM evaluates imports in source order.
 */
import fs from 'fs';
import path from 'path';

function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    process.env[k] = raw.replace(/^['"]|['"]$/g, '');
  }
}

loadDotEnv(path.join(process.cwd(), '.env.local'));
loadDotEnv(path.join(process.cwd(), '.env'));
