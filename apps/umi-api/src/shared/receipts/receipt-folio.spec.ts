import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { allocateReceiptFolio } from './receipt-folio';

const MERCHANT = '8f662886-0000-4000-8000-0000000000a1';
const LOCATION = '8f662886-0000-4000-8000-0000000000a2';

/**
 * A client that answers the counter statement with the number the caller wants to see, and
 * records the SQL and the parameters it was handed.
 */
function harness(lastNumber: string) {
  const statements: string[] = [];
  const parameters: unknown[][] = [];
  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      statements.push(text);
      parameters.push(values ?? []);
      return { rows: [{ folio: lastNumber }], rowCount: 1 };
    }),
  } as unknown as PoolClient;
  return { statements, parameters, client };
}

describe('allocateReceiptFolio', () => {
  it('issues one atomic counter increment for the merchant, the location and the day', async () => {
    const { statements, parameters, client } = harness('7');

    const folio = await allocateReceiptFolio(client, {
      merchantId: MERCHANT,
      locationId: LOCATION,
      businessDate: '2026-10-12',
    });

    // ONE statement: the number and its increment cannot be split by a crash, and
    // `ON CONFLICT DO UPDATE` is what makes two tills of one branch share the day safely.
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('INSERT INTO merchant.receipt_counter');
    expect(statements[0]).toContain('ON CONFLICT (merchant_id,location_id,business_date)');
    expect(statements[0]).toContain('merchant.receipt_counter.last_number + 1');
    // The day is the caller's when it has one, and the database's today when it does not.
    expect(statements[0]).toContain('COALESCE($3::date,current_date)');
    expect(parameters[0]).toEqual([MERCHANT, LOCATION, '2026-10-12']);
    expect(folio).toBe('0007');
  });

  it('keeps the database’s own day when the caller has no date', async () => {
    const { parameters, client } = harness('1');

    await allocateReceiptFolio(client, {
      merchantId: MERCHANT,
      locationId: LOCATION,
      businessDate: null,
    });

    expect(parameters[0]).toEqual([MERCHANT, LOCATION, null]);
  });

  /**
   * THE BOUNDARY THAT BIT ONCE, MEASURED.
   *
   * The padding used to be `lpad(last_number::text, 4, '0')` inside the statement, which
   * TRUNCATES a wider value: `lpad('10000',4,'0')` is `1000`, so the ten-thousandth ticket of
   * a day would have collided with ticket 1000 of the same day and the sale would have died
   * on the unique constraint at commit. `to_char(10000,'FM0000')` answers `####`, so it is no
   * better. `padStart` only ever pads.
   */
  it('pads to four and never truncates a branch that sells past 9999', async () => {
    expect(
      await allocateReceiptFolio(harness('999').client, {
        merchantId: MERCHANT,
        locationId: LOCATION,
        businessDate: '2026-10-12',
      }),
    ).toBe('0999');
    expect(
      await allocateReceiptFolio(harness('10000').client, {
        merchantId: MERCHANT,
        locationId: LOCATION,
        businessDate: '2026-10-12',
      }),
    ).toBe('10000');
  });
});
