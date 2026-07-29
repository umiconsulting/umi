import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../supabase/migrations/20260729000300_gate_3a_sale_lifecycle.sql'),
  'utf8',
);
const repository = readFileSync(
  resolve(process.cwd(), 'src/modules/pos-sale/pos-sale.repository.ts'),
  'utf8',
);

describe('Gate 3A sale lifecycle migration', () => {
  it('permits lifecycle work only for operational POS roles', () => {
    expect(sql).toContain("r.key in ('owner','admin','manager','supervisor','cashier','staff')");
    expect(sql).toContain("r.key in ('owner','admin','manager','supervisor')");
  });

  it('keeps one editable sale for each operator session', () => {
    expect(sql).toContain('create unique index pos_cart_active_operator_uidx');
    expect(sql).toContain("'building_cart','ready_for_checkout','recovered'");
    expect(sql).toContain('on tenant.pos_cart(business_id,branch_id,operator_user_id)');
  });

  it('keeps committed and cancelled lifecycle records explicit', () => {
    expect(sql).toContain("'committed','cancelled','recovered'");
    expect(sql).toContain('cancellation_reason');
    expect(sql).toContain('original_operator_session_id');
    expect(sql).toContain("old.lifecycle_state in ('committed','cancelled')");
    expect(sql).toContain('invalid sale lifecycle transition');
  });

  it('uses operator identity or elevated permission for suspended ownership', () => {
    expect(repository).toContain('current_operator.user_id=sale.original_operator_user_id');
    expect(repository).toContain("'sale.resume.any'=ANY(os.permissions)");
  });

  it('scopes current and history reads to the tenant and branch', () => {
    expect(repository).toContain('business_id=$1::uuid');
    expect(repository).toContain('branch_id=$2::uuid');
    expect(repository).toContain('c.branch_id=$2::uuid');
  });
});
