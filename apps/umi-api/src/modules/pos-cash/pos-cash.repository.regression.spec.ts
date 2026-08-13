import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('POS cash center SQL regression', () => {
  it('uses contiguous parameters for the active shift query', () => {
    const source = readFileSync(join(__dirname, 'pos-cash.repository.ts'), 'utf8');
    const query = source.slice(
      source.indexOf('FROM merchant.cash_shift'),
      source.indexOf('const mappedRegisters'),
    );

    expect(query).toContain('device_id=$3::uuid');
    expect(query).toContain('responsible_operator_id=$4::uuid');
    expect(query).not.toContain('device_id=$4::uuid');
    expect(query).toContain('[merchantId, locationId, deviceId, operatorId]');
  });
});
