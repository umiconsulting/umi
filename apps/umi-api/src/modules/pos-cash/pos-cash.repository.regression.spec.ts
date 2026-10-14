import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('POS cash center SQL regression', () => {
  it('derives the cash business date in the merchant timezone, honoring business_day_start', () => {
    const source = readFileSync(join(__dirname, 'pos-cash.repository.ts'), 'utf8');
    // The cash business date MUST match merchant.tg_business_date: (now in the merchant
    // timezone) minus business_day_start, cast to date. A late-night café with
    // business_day_start != 00:00 would otherwise open a shift on a different trading day
    // than the sales it holds.
    expect(source).toContain('now() at time zone merchant.timezone');
    expect(source).toContain('merchant.business_day_start::interval');
    expect(source).not.toContain('SELECT current_date::text');
    // The old location-timezone coalesce ignored business_day_start — it must be gone.
    expect(source).not.toContain('coalesce(location.timezone,merchant.timezone)');
  });

  it('uses contiguous parameters for the active shift query', () => {
    const source = readFileSync(join(__dirname, 'pos-cash.repository.ts'), 'utf8');
    // The ACTIVE SHIFT read only — the commands that move money key on the
    // responsible operator for their own good reasons, so a slice wide enough to
    // catch them would say nothing about this one.
    const query = source.slice(
      source.indexOf('const current = await client.query<CashShift>('),
      source.indexOf('const adoptable'),
    );

    expect(query).toContain('device_id=$3::uuid');
    expect(query).not.toContain('device_id=$4::uuid');
    expect(query).toContain('[merchantId, locationId, deviceId]');
    // THE DRAWER'S CUSTODY IS THE TERMINAL'S, NOT THE PERSON'S.
    //
    // This query used to demand `responsible_operator_id = the caller`, and that
    // predicate stranded a café after an app update: the reinstall mints a new
    // operator session, the drawer is still held by this very terminal, and the
    // shift went INVISIBLE — so the till offered to open a shift the server then
    // refused, with no action that could work. Who opened the drawer still decides
    // what happens next (`operator_mismatch` → `['resume']`), but it must not decide
    // whether the terminal can see its own drawer. Measured on the iMin, 2026-10-11.
    expect(query).not.toContain('responsible_operator_id=$4::uuid');
    expect(query).not.toContain('AND responsible_operator_id');
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

  it('orders the ledger by the integer sequence, not by the text projection of it', () => {
    const source = readFileSync(join(__dirname, 'pos-cash.repository.ts'), 'utf8');
    // `expectedCash` projects `sequence::text`, and an output-column name shadows the
    // table's own column, so an unqualified `ORDER BY sequence` sorts the STRING and
    // returns 1, 10, 2, 3, … Verified on the rehearsal database at exactly ten entries.
    // `calculateExpectedCash` requires a strictly increasing sequence, so from the tenth
    // entry onwards the Caja screen answered 500 "Cash ledger order or amount is invalid."
    // Qualify the table so the bigint column wins.
    expect(source).not.toMatch(/ORDER BY sequence\b/);
    expect(source).toContain('ORDER BY merchant.cash_ledger_entry.sequence');
  });

  it('gives the till the shift journal, oldest first, from the newest end', () => {
    const source = readFileSync(join(__dirname, 'pos-cash.repository.ts'), 'utf8');
    // The operator reads the journal oldest-first, so the mapper reverses the rows.
    // The query itself pages from the newest end: a shift longer than the bound must
    // keep the entries the operator is standing next to, not the ones from opening.
    expect(source).toContain('ORDER BY le.sequence DESC LIMIT 200');
    expect(source).toContain('.reverse();');
    // The ledger stores a magnitude and the entry type carries the direction, so the
    // projection must not sign the amount on its way to the terminal.
    expect(source).toContain('amount: lineMoney(Number(row.amount))');
    expect(source).toContain('ledger,');
  });

  it('keeps the count exit behind the ledger and behind an unresolved difference', () => {
    const source = readFileSync(join(__dirname, 'pos-cash.repository.ts'), 'utf8');
    // The drawer may go back to open only while the count still describes the
    // drawer it was taken from: the shift's sequence and the count's sequence are
    // the same number, and the caller read that number.
    expect(source).toContain("AND status='reconciliation_required' AND version=$7");
    expect(source).toContain('AND ledger_sequence=$8');
    expect(source).toContain('COUNT_NOT_CANCELLABLE');
    expect(source).toContain('STALE_COUNT');
    // A recorded variance reason is a decision about money. This undoes a count,
    // not a decision, so the presence of a resolution refuses the exit.
    expect(source).toContain('VARIANCE_ALREADY_RESOLVED');
    // The exit no longer forces 'open'. A drawer whose count is still waiting for
    // approval stays in reconciliation, because from 'open' the close had no route
    // (the iMin shift of 2026-10-07 with its count of 2026-10-08). What the
    // resumption clears is the suspension.
    expect(source).toContain("THEN 'reconciliation_required'");
    expect(source).toContain('version=version+1,suspended_at=NULL');
  });
});
