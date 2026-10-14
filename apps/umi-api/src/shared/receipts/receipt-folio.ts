import type { PoolClient } from 'pg';

/**
 * The ticket number a person reads.
 *
 * `receipt_number` used to be `POS-<uuid of the payment attempt>`: the primary key of the
 * money, printed on paper. A UUID is the right key and the wrong label — it is not dictated,
 * typed without error, sorted, or read as a day and a branch (ADR
 * `2026-10-12-folio-visible-del-recibo`).
 *
 * The label is issued here and the key stays untouched. Three properties are deliberate:
 *
 * 1. **The scope is the merchant, the location and the OPERATIONAL day.** Not the calendar
 *    day: a café's day ends at 04:00, so the caller passes the date the ledger booked. Two
 *    tills in one branch share the day and must not share a number, which is what the row
 *    lock below gives them.
 * 2. **It is a row, not a sequence.** `nextval` is never reclaimed on abort — "PostgreSQL
 *    sequence objects cannot be used to obtain gapless sequences"
 *    (https://www.postgresql.org/docs/18/functions-sequence.html) — and one sequence cannot
 *    reset per day. A counter row can do both, and it takes its lock inside the caller's
 *    transaction, so the number and the receipt commit together or neither does.
 * 3. **Gaps are expected.** A counter is read and written by every checkout of the day, and
 *    `ON CONFLICT DO UPDATE` "guarantees an atomic INSERT or UPDATE outcome … even under
 *    high concurrency" (https://www.postgresql.org/docs/18/sql-insert.html). A sale that
 *    rolls back after taking a number burns it. That is cheaper than a gapless counter and
 *    it is the same property the account numbers already have.
 *
 * The number is four wide and GROWS past 9999 rather than wrapping or repeating, so a branch
 * that sells past 9999 tickets in a day goes from `9999` to `10000` and no two receipts of
 * the day collide.
 *
 * ⚠️ The padding is NOT done in SQL, and the reason is a measured defect: PostgreSQL's
 * `lpad(text, 4, '0')` **truncates** a value that is already wider than the target
 * (`lpad('10000',4,'0')` is `1000`, which would collide with ticket 1000 of the same day),
 * and `to_char(10000,'FM0000')` answers `####` instead. JavaScript's `padStart` only ever
 * pads, so the rule lives here where a unit test can hold it.
 *
 * `businessDate` is null when the caller's own row already keys on the database's
 * `current_date`, so the counter and the document it numbers agree by construction.
 */
export async function allocateReceiptFolio(
  client: PoolClient,
  scope: { merchantId: string; locationId: string; businessDate: string | null },
): Promise<string> {
  const { rows } = await client.query<{ folio: string }>(
    `INSERT INTO merchant.receipt_counter
       (merchant_id,location_id,business_date,last_number)
     VALUES ($1::uuid,$2::uuid,COALESCE($3::date,current_date),1)
     ON CONFLICT (merchant_id,location_id,business_date)
     DO UPDATE SET last_number = merchant.receipt_counter.last_number + 1,
                   updated_at  = now()
     RETURNING last_number::text AS folio`,
    [scope.merchantId, scope.locationId, scope.businessDate],
  );
  return rows[0].folio.padStart(4, '0');
}
