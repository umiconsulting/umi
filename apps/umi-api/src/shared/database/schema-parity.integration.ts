import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema';
import { PgService } from './pg.service';

/**
 * Schema-parity gate — the check that makes the build-v2 → build-v3 rename sweep
 * VERIFIABLE. Every table the backend names lives inside a SQL string, so `tsc`
 * cannot catch a stale `tenant.card`. This test extracts every schema-qualified
 * table reference from the backend source and asserts it exists as a real
 * relation/function in the live build-v3 DB. A single leftover build-v2 name
 * (e.g. `tenant.card`, `runtime.outbox_events`) fails here with its file:line.
 *
 * Extraction is anchored to SQL clause keywords (FROM/JOIN/INTO/UPDATE) so a JS
 * property access on a variable named `tenant`/`runtime`/`umi` (e.g.
 * `tenant.timezone`) is NOT mistaken for a table reference.
 */

const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3';

// The D1 boot guard refuses to boot a BYPASSRLS app pool, so the app pool must connect
// as an INHERIT member of `api` (api_login) exactly as prod provisions it — even though
// this check only queries on the worker pool.
const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:5233/umi_backfill_v3';

// `from|join|into|update [only] <schema>.<name>` — the places a table name appears.
// The optional `"` group is load-bearing: build-v2 used `tenant."order"` (a reserved
// word), and a bare [a-z_] charclass silently CANNOT match it — that blind spot hid a
// 9th identifier across 24 call sites. Never narrow this back.
const TABLE_REF =
  /\b(?:from|join|into|update)\s+(?:only\s+)?(umi|tenant|runtime)\.("?)([a-z_][a-z0-9_]*)\2/gi;

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.endsWith('.ts')) continue;
    if (name.endsWith('.spec.ts') || name.endsWith('.integration.ts') || name.endsWith('.d.ts'))
      continue;
    // entry.parentPath (node 20.12+) / fallback to path property
    const dir =
      (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
      (entry as unknown as { path: string }).path;
    out.push(join(dir, name));
  }
  return out;
}

interface Ref {
  ident: string;
  file: string;
  line: number;
}

function extractRefs(srcRoot: string): Ref[] {
  const refs: Ref[] = [];
  for (const file of sourceFiles(srcRoot)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((lineText, i) => {
      for (const m of lineText.matchAll(TABLE_REF)) {
        refs.push({
          ident: `${m[1]}.${m[3]}`.toLowerCase(),
          file: file.slice(srcRoot.length + 1),
          line: i + 1,
        });
      }
    });
  }
  return refs;
}

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN, // D1 boot guard: app pool must be an `api` member
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

describe('build-v3 schema parity · backend SQL references real relations', () => {
  let pg: PgService;
  let valid: Set<string>;

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    const rels = await pg.query<{ ident: string }>(`
      select table_schema || '.' || table_name as ident
        from information_schema.tables
       where table_schema in ('umi','tenant','runtime')
      union
      select n.nspname || '.' || p.proname
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('umi','tenant','runtime')
    `);
    valid = new Set(rels.rows.map((r) => r.ident.toLowerCase()));
  });

  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('every table reference in backend SQL exists in build-v3', () => {
    const refs = extractRefs(join(process.cwd(), 'src'));
    expect(refs.length).toBeGreaterThan(0); // guard: the extractor actually found SQL

    const violations = new Map<string, string[]>();
    for (const r of refs) {
      if (valid.has(r.ident)) continue;
      const at = `${r.file}:${r.line}`;
      const list = violations.get(r.ident) ?? [];
      if (!list.includes(at)) list.push(at);
      violations.set(r.ident, list);
    }

    if (violations.size > 0) {
      const report = [...violations.entries()]
        .sort()
        .map(([ident, ats]) => `  ✗ ${ident}\n      ${ats.join('\n      ')}`)
        .join('\n');
      throw new Error(
        `${violations.size} build-v2 identifier(s) not present in build-v3:\n${report}`,
      );
    }
  });
});
