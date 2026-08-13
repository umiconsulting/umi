import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, 'kds.repository.ts'), 'utf8');

describe('KDS order scope query regression', () => {
  it('aggregates deterministic station UUID text within merchant order scope', () => {
    expect(source).toContain('min(i.station_id::text) AS station_id');
    expect(source).not.toContain('min(i.station_id)::text AS station_id');
    expect(source).toContain('array_agg(DISTINCT i.station_id::text)');
    expect(source).toContain('ko.merchant_id=$3::uuid');
    expect(source).toContain('i.kitchen_order_id=ko.id AND i.merchant_id=ko.merchant_id');
  });
});
