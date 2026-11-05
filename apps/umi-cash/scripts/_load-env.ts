/** Load optional local configuration for the HTTP broadcast tool. */
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    process.env[key] ??= value;
  }
}
