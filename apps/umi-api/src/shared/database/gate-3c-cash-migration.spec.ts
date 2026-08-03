import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/33_pos_cash.sql'),
  'utf8',
);
const checkout = readFileSync(
  resolve(process.cwd(), 'src/modules/pos-checkout/pos-checkout.repository.ts'),
  'utf8',
);
const repository = readFileSync(
  resolve(process.cwd(), 'src/modules/pos-cash/pos-cash.repository.ts'),
  'utf8',
);

describe('Gate 3C cash persistence', () => {
  it('creates one unresolved shift for each register', () => {
    expect(sql).toContain('cash_shift_one_unresolved_register');
    expect(sql).toContain("where status not in ('closed','blocked')");
    expect(sql).toContain('unique(merchant_id,opening_command_id)');
  });

  it('keeps ledger, count, reconciliation, and close facts immutable', () => {
    for (const trigger of [
      'cash_ledger_immutable',
      'cash_count_immutable',
      'cash_reconciliation_immutable',
      'cash_close_immutable',
    ]) {
      expect(sql).toContain(trigger);
    }
    expect(sql).toContain('unique(shift_id,sequence)');
    expect(sql).toContain('unique(tender_fact_id)');
  });

  it('posts the cash effect inside the authoritative checkout transaction', () => {
    expect(checkout).toContain('entry_type,\n            amount_minor_units');
    expect(checkout).toContain("'cash_sale'");
    expect(checkout).toContain('cash_received_minor_units');
    expect(checkout).toContain('change_given_minor_units');
    expect(checkout).toContain("WHERE id=$1::uuid AND status='open'");
  });

  it('enables merchant and location RLS for all cash tables', () => {
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('force row level security');
    expect(sql).toContain('merchant_id=umi.current_merchant() and location_id=umi.current_location()');
  });

  it('grants the RLS-confined API role the required cash writes', () => {
    expect(sql).toContain('merchant.cash_shift to api,worker');
    expect(sql).toContain('merchant.cash_shift_close,merchant.no_sale_drawer_event to api,worker');
  });

  it('binds terminal operations to operator, device, and session scope', () => {
    expect(repository).toContain('s.responsible_operator_id=$6::uuid');
    expect(repository).toContain('responsible_operator_id=$5::uuid AND device_id=$6::uuid');
    expect(repository).toContain('operator_session_id=$7::uuid');
  });

  it('closes with the selected count before it makes the shift terminal', () => {
    expect(repository).toContain('WHERE id=$2::uuid AND shift_id=$1::uuid');
    expect(repository.indexOf('INSERT INTO merchant.cash_shift_close')).toBeLessThan(
      repository.indexOf("SET status='closed',closed_at=$2::timestamptz"),
    );
    expect(repository).not.toContain('max(counted_minor_units)');
  });

  it('derives the shift business date on the server', () => {
    expect(repository).toContain('SELECT current_date::text AS value');
    expect(repository).not.toContain('dto.businessDate');
  });

  it('enforces a fingerprint-bound close approval threshold', () => {
    expect(repository).toContain(
      'expected.expectedDrawerCash.minorUnits > policy.closeApprovalThreshold.minorUnits',
    );
    expect(repository).toContain("permission: 'cash.shift.close'");
    expect(repository).toContain('APPROVAL_FINGERPRINT_MISMATCH');
  });

  it('rebinds a new session without changing an unresolved financial state', () => {
    expect(repository).toContain(
      "'counting',\n            'reconciliation_required',\n            'closing'",
    );
    expect(repository).toContain(
      "WHEN $7='open' AND status IN ('counting','reconciliation_required','closing')",
    );
    expect(repository).toContain("rows[0].status === 'reconciliation_required'");
  });
});
