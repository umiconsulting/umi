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
const cart = readFileSync(
  resolve(process.cwd(), 'src/modules/pos-cart/pos-cart.repository.ts'),
  'utf8',
);

describe('Gate 3C cash persistence', () => {
  it('creates one unresolved shift for each register', () => {
    expect(sql).toContain('cash_shift_one_unresolved_register');
    // `recovered` counts as resolved. A shift a manager counted out has handed the
    // register back, and leaving it out of this predicate is what once made the
    // register unusable for ever.
    expect(sql).toContain("where status not in ('closed','blocked','recovered')");
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
    expect(sql).toContain(
      'merchant_id=umi.current_merchant() and location_id=umi.current_location()',
    );
  });

  it('grants the RLS-confined API role the required cash writes', () => {
    expect(sql).toContain('merchant.cash_shift to api,worker');
    expect(sql).toContain('merchant.cash_shift_close,merchant.no_sale_drawer_event,');
    expect(sql).toContain('merchant.cash_shift_custody_event to api,worker');
  });

  it('binds terminal operations to the operator, the HOLDING device, and the session', () => {
    expect(repository).toContain('s.responsible_operator_id=$6::uuid');
    expect(repository).toContain('responsible_operator_id=$5::uuid AND holding_device_id=$6::uuid');
    expect(repository).toContain('operator_session_id=$7::uuid');
  });

  it('lets custody move to another terminal without touching the opening device', () => {
    // `device_id` is the terminal that took responsibility for the drawer and
    // `tg_closed_cash_shift_immutable` pins it. `holding_device_id` is the terminal
    // speaking for it right now, and only that one moves.
    expect(sql).toContain('new.device_id<>old.device_id');
    expect(sql).not.toContain('new.holding_device_id<>old.holding_device_id');
    expect(repository).toContain('SET holding_device_id=$6::uuid');
    expect(repository).not.toContain('SET device_id=');
  });

  it('records both sides of every custody move', () => {
    expect(sql).toContain('create table merchant.cash_shift_custody_event');
    expect(sql).toContain("event_type in ('device_adoption','manager_recovery')");
    expect(sql).toContain('previous_holding_device_id');
    expect(sql).toContain('new_holding_device_id');
    expect(repository).toContain('INSERT INTO merchant.cash_shift_custody_event');
  });

  it('hands the register back when a manager recovers a shift', () => {
    const recover = repository.indexOf("SET status='recovered'");
    expect(recover).toBeGreaterThan(-1);
    expect(repository.indexOf('current_shift_id=NULL', recover)).toBeGreaterThan(recover);
  });

  it('dates a cash sale by the shift, never by the cart it came from', () => {
    // `pos_cart.business_date` is stamped at creation and does not move. A cart
    // resumed after midnight still says yesterday, and this trigger compares that
    // date against the open shift's — which used to fail the whole checkout with
    // a 500 nobody could read.
    expect(sql).toContain('shift_row.business_date<>new.business_date');
    expect(checkout).toContain('let businessDate = cart.businessDate;');
    expect(checkout).toContain('businessDate = eligible.rows[0].businessDate;');
    // The customer's copy names the same day the ledger booked.
    expect(checkout).toContain('{ ...receipt, businessDate }');
    // And the ledger insert takes the resolved date, not the cart's.
    const ledger = checkout.indexOf('INSERT INTO merchant.cash_ledger_entry');
    expect(ledger).toBeGreaterThan(-1);
    const args = checkout.slice(ledger, ledger + 1400);
    expect(args).toContain('businessDate,');
    expect(args).not.toContain('cart.businessDate,');
  });

  it('lets a checkout draft follow its cart to a new session or device', () => {
    const checkoutSource = checkout;
    // The draft used to be matched on the session and device stored inside it, so
    // a cashier signing in again — or a web terminal that came back as a new
    // device — could never pay that cart: the upsert matched nothing and threw
    // "Checkout draft is immutable or belongs to another context".
    expect(checkoutSource).toContain('operator_session_id=excluded.operator_session_id');
    expect(checkoutSource).toContain('device_id=excluded.device_id');
    expect(checkoutSource).not.toContain(
      'AND merchant.pos_checkout_draft.operator_session_id=$4::uuid',
    );
    expect(checkoutSource).not.toContain('AND merchant.pos_checkout_draft.device_id=$5::uuid');
    // The guards that actually matter stay.
    expect(checkoutSource).toContain(
      "state NOT IN ('completed','receipt_available','payment_unknown')",
    );
    expect(checkoutSource).toContain("prior->>'status'='confirmed_success'");
  });

  it('re-dates a cart the moment it is resumed', () => {
    expect(cart).toContain("lifecycle_state='recovered'");
    expect(cart).toContain('business_date=excluded.business_date');
  });

  it('closes with the selected count before it makes the shift terminal', () => {
    expect(repository).toContain('WHERE id=$2::uuid AND shift_id=$1::uuid');
    expect(repository.indexOf('INSERT INTO merchant.cash_shift_close')).toBeLessThan(
      repository.indexOf("SET status='closed',closed_at=$2::timestamptz"),
    );
    expect(repository).not.toContain('max(counted_minor_units)');
  });

  it('derives the shift business date on the server', () => {
    expect(repository).toContain(
      'now() at time zone coalesce(location.timezone,merchant.timezone)',
    );
    expect(repository).not.toContain('dto.businessDate');
  });

  it('enforces a fingerprint-bound close approval threshold', () => {
    expect(repository).toContain(
      'expected.expectedDrawerCash.minorUnits > policy.closeApprovalThreshold.minorUnits',
    );
    expect(repository).toContain("permission: 'cash.shift.close.approve'");
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
