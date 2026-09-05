import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A parameter that appears ONLY inside `jsonb_build_object` gives PostgreSQL
 * nothing to infer a type from, and the statement fails to prepare. Every such
 * parameter therefore carries an explicit `::text`.
 *
 * The manager method used to be the literal `'manager_approval'`. It became a
 * parameter when a card approval had to be recorded as a card approval rather
 * than as a typed PIN, which brought it under this same rule.
 */
describe('POS elevation audit SQL regression', () => {
  it('casts permission parameters used only in JSON metadata', () => {
    const source = readFileSync(join(__dirname, 'pos-entry.repository.ts'), 'utf8');

    expect(source).toContain("'operator_pin','permission',$6::text");
    expect(source).toContain("jsonb_build_object('method',$6::text,'permission',$5::text)");
  });
});
