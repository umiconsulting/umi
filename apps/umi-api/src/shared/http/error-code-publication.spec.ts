import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES } from '@umi/contract';

/**
 * The contract publishes a closed list of error codes, and the API may only
 * refuse with one of them.
 *
 * `AllExceptionsFilter` drops any code outside `API_ERROR_CODES` and re-labels
 * the refusal with the status: a 409 becomes `CONFLICT`, a 400 becomes
 * `VALIDATION_FAILED`. That allow-list is deliberate — a client should not be
 * handed whatever a module invented — but nothing checked that the modules stay
 * inside it, so `CONFLICT` became the answer to refusals the till has specific
 * words for. Measured on the iMin D3-504 on 2026-10-11: counting twice in the
 * same warehouse reached the operator as `La información cambió`, not as
 * `Ya hay un conteo abierto`.
 *
 * `unpublished-error-codes.json` is a ratchet, not a blessing: it is the debt as
 * it stands. A new code either joins `API_ERROR_CODES` or joins that file on
 * purpose, with its reason. Shrinking the file is the work.
 */
const ratchet = new Set<string>(
  JSON.parse(readFileSync(join(__dirname, 'unpublished-error-codes.json'), 'utf8')) as string[],
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.ts')) return [];
    if (entry.name.endsWith('.spec.ts')) return [];
    if (entry.name.endsWith('.integration.ts')) return [];
    return [path];
  });
}

function codesThrownByTheApi(): Set<string> {
  const codes = new Set<string>();
  for (const file of sourceFiles(join(__dirname, '..', '..'))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/code: '([A-Z][A-Z_]{3,})'/g)) {
      codes.add(match[1]);
    }
  }
  return codes;
}

describe('the API refuses only with codes the contract publishes', () => {
  it('has not grown the list of codes the client cannot be told about', () => {
    const published = API_ERROR_CODES as readonly string[];
    const unpublished = [...codesThrownByTheApi()]
      .filter((code) => !published.includes(code))
      .sort();
    const grown = unpublished.filter((code) => !ratchet.has(code));
    const shrunk = [...ratchet].filter((code) => !unpublished.includes(code));
    expect(
      grown,
      'these codes are thrown but neither published nor recorded in the ratchet',
    ).toEqual([]);
    expect(
      shrunk,
      'these codes are published now: take them out of unpublished-error-codes.json',
    ).toEqual([]);
  });
});
