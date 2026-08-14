import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('POS elevation audit SQL regression', () => {
  it('casts permission parameters used only in JSON metadata', () => {
    const source = readFileSync(join(__dirname, 'pos-entry.repository.ts'), 'utf8');

    expect(source).toContain("'operator_pin','permission',$6::text");
    expect(source).toContain("'manager_approval','permission',$5::text");
  });
});
