import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('POS cash center SQL regression', () => {
  it('uses the merchant timezone for the cash business date', () => {
    const source = readFileSync(join(__dirname, 'pos-cash.repository.ts'), 'utf8');
    expect(source).toContain('now() at time zone coalesce(location.timezone,merchant.timezone)');
    expect(source).not.toContain('SELECT current_date::text');
  });

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

  it('sends ledgerSequence as a number, never as a bigint string', () => {
    const source = readFileSync(join(__dirname, 'pos-cash.repository.ts'), 'utf8');
    // `ledger_sequence` is bigint and node-postgres returns bigint as a STRING to
    // protect precision. The contract types it as a number and the Dart client
    // casts it to one, so an unqualified projection crashed every suspend, resume
    // and recount on the terminal — with the shift already changed on the server.
    expect(source).not.toContain('ledger_sequence AS "ledgerSequence"');
    expect(source).toContain('ledger_sequence::int AS "ledgerSequence"');
  });
});
