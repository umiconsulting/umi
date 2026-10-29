import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { cancelSentOrderLine } from '../../shared/orders/cancel-sent-order-line';
import { PosCheckoutRepository } from './pos-checkout.repository';

const dsn = process.env.CANCEL_VERIFY_DATABASE_URL;

/** Real order, payment, receipt, kitchen and inventory reservation SQL.
 * Stock tracking is disabled only in this disposable fixture. Loyalty closeout
 * uses an explicit no-op adapter and remains outside this test. */
describe.skipIf(!dsn)('checkout order and kitchen on a disposable populated copy', () => {
  it.each([false, true])(
    'settles the same order after correction; replace all sent lines: %s',
    async (replaceAll) => {
      const pool = new Pool({ connectionString: dsn });
      const client = await pool.connect();
      try {
        const db = await client.query('SELECT current_database() AS name');
        expect(db.rows[0].name).toContain('verify');
        const fixture = readFileSync(
          resolve(process.cwd(), 'test/integration/cancel-sent-cart-line.sql'),
          'utf8',
        );
        await client.query(fixture.split('-- Exercise the narrow definer')[0]);
        const scoped =
          await client.query(`SELECT c.id,c.merchant_id,c.location_id,c.operator_session_id,
        c.business_date::text,c.fired_order_id,os.user_id,os.device_id,
        current_setting('test.line_a') AS line_a,current_setting('test.line_b') AS line_b
        FROM merchant.pos_cart c JOIN runtime.operator_session os ON os.id=c.operator_session_id
        WHERE c.id=current_setting('test.cart')::uuid`);
        const row = scoped.rows[0];
        await client.query(`UPDATE merchant.customer_order SET external_ref=$2 WHERE id=$1`, [
          row.fired_order_id,
          `pos-cart:${row.id}`,
        ]);
        await client.query('SET LOCAL ROLE api');
        await expect(
          cancelSentOrderLine(client, {
            merchantId: row.merchant_id,
            locationId: row.location_id,
            cartId: row.id,
            lineId: row.line_b,
            operatorSessionId: row.operator_session_id,
            expectedVersion: 1,
            reasonCode: 'operator_mistake',
            correlationId: 'test-correction',
          }),
        ).resolves.toBe('cancelled');
        if (replaceAll) {
          await expect(
            cancelSentOrderLine(client, {
              merchantId: row.merchant_id,
              locationId: row.location_id,
              cartId: row.id,
              lineId: row.line_a,
              operatorSessionId: row.operator_session_id,
              expectedVersion: 1,
              reasonCode: 'operator_mistake',
              correlationId: 'test-correction-all',
            }),
          ).resolves.toBe('cancelled');
        }
        await client.query('RESET ROLE');
        // Reuse the cart position for a replacement. Production removes the old
        // cart line and adds a new line; commercial and kitchen history stay intact.
        await client.query(
          `UPDATE merchant.pos_cart_line SET fired_at=NULL,order_item_id=NULL
        WHERE id=$1 OR ($2 AND cart_id=$3)`,
          [row.line_b, replaceAll, row.id],
        );
        const lines = await client.query(
          `SELECT id,product_id,course_number FROM merchant.pos_cart_line
        WHERE cart_id=$1 ORDER BY course_number`,
          [row.id],
        );
        const productId = lines.rows[0].product_id;
        await client.query('UPDATE merchant.product SET requires_preparation=true WHERE id=$1', [
          productId,
        ]);
        const station = await client.query(
          'SELECT id FROM merchant.station WHERE merchant_id=$1 AND location_id=$2 LIMIT 1',
          [row.merchant_id, row.location_id],
        );
        await client.query(
          `INSERT INTO merchant.kitchen_route
        (merchant_id,location_id,station_id,product_id,route_priority,active,requires_preparation)
        VALUES ($1,$2,$3,$4,999,true,true)`,
          [row.merchant_id, row.location_id, station.rows[0].id, productId],
        );
        const attempt = randomUUID();
        await client.query(
          `INSERT INTO merchant.pos_payment_attempt
        (id,merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,correlation_id,proof_source)
        VALUES ($1,$2,$3,$4,'external_terminal',300,'MXN','succeeded','test-manual-terminal','operator_attested')`,
          [attempt, row.merchant_id, row.location_id, row.id],
        );
        const money = (minorUnits: number) => ({ minorUnits, currency: 'MXN' });
        const checkoutId = randomUUID();
        const noOpCalls: string[] = [];
        const scopedClient = {
          query: (sql: string, values?: unknown[]) => {
            if (sql.includes('merchant.commit_customer_value_closeout')) {
              noOpCalls.push(sql);
              return Promise.resolve({ rows: [{ result: {} }], rowCount: 1 });
            }
            return client.query(sql, values);
          },
        } as unknown as PoolClient;
        const receiptLines = lines.rows.map((line, index) => ({
          description: 'Same product',
          variantName: index === 0 ? 'Small' : 'Large',
          quantity: 1,
          unitPrice: money(index === 0 ? 100 : 200),
          modifiers: [],
          note: null,
        }));
        const checkoutCart = {
          id: row.id,
          merchantId: row.merchant_id,
          locationId: row.location_id,
          operatorSessionId: row.operator_session_id,
          version: 1,
          businessDate: row.business_date,
          customerId: null,
          originOrderId: null,
          originChannel: null,
          fulfillmentType: 'dine_in',
          lines: lines.rows.map((line) => ({
            id: line.id,
            productId: line.product_id,
            courseNumber: line.course_number,
          })),
        };
        const authorization = {
          operatorId: row.user_id,
          deviceId: row.device_id,
          credentialVersion: 1,
        };
        await client.query(
          `UPDATE merchant.inventory_policy SET tracking_enabled=false
        WHERE merchant_id=$1 AND location_id=$2`,
          [row.merchant_id, row.location_id],
        );
        const repository = new PosCheckoutRepository({} as never);
        const reservation = await repository.reserve(
          scopedClient,
          checkoutCart as never,
          receiptLines,
          authorization as never,
          randomUUID(),
          randomUUID(),
          'a'.repeat(64),
          'test-reserve',
          null,
        );
        expect(reservation.status).toBe('reserved');
        const result = await repository.commit(
          scopedClient,
          checkoutCart as never,
          { fingerprint: 'a'.repeat(64), totals: { grandTotal: money(300) } } as never,
          [{ attempt: { id: attempt, amount: money(300), method: 'external_terminal' } }] as never,
          { tenders: [], amountDue: money(300) } as never,
          checkoutId,
          reservation,
          {
            receiptRef: `TEST-${randomUUID()}`,
            currency: 'MXN',
            grandTotal: money(300),
            receiptDestination: 'display',
            lines: receiptLines,
          } as never,
          null,
          randomUUID(),
          authorization as never,
          'test-checkout-pending',
          randomUUID(),
          'basis',
          null,
        );
        expect(result.sale.orderId).toBe(row.fired_order_id);
        const releasedTable = await client.query(
          `SELECT state,seated_at,visit_id
             FROM merchant.table_state
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid
              AND table_id=(SELECT table_id FROM merchant.pos_cart WHERE id=$3::uuid)`,
          [row.merchant_id, row.location_id, row.id],
        );
        expect(releasedTable.rows[0]).toMatchObject({
          state: 'dirty',
          seated_at: null,
          visit_id: null,
        });
        const items = await client.query(
          'SELECT id,voided_at,variant_name,course_number FROM merchant.order_item WHERE order_id=$1',
          [row.fired_order_id],
        );
        expect(items.rows).toHaveLength(replaceAll ? 4 : 3);
        expect(items.rows.filter((item) => !item.voided_at)).toHaveLength(2);
        const mapped = await client.query(
          `SELECT l.id,l.order_item_id,l.fired_at,k.status,k.course_number
        FROM merchant.pos_cart_line l JOIN merchant.kitchen_order_item k ON k.source_order_item_id=l.order_item_id
        WHERE l.cart_id=$1 ORDER BY l.course_number`,
          [row.id],
        );
        expect(mapped.rows).toHaveLength(2);
        expect(mapped.rows.every((line) => line.fired_at && line.status === 'queued')).toBe(true);
        expect(mapped.rows.map((line) => line.course_number)).toEqual([1, 2]);
        const paid = await client.query(
          `SELECT p.amount,p.status,r.currency,r.grand_total,
        (SELECT count(*) FROM merchant.kitchen_order WHERE source_order_id=$1)::integer AS tickets
        FROM merchant.payment p JOIN merchant.receipt_snapshot r ON r.order_id=p.order_id WHERE p.order_id=$1`,
          [row.fired_order_id],
        );
        expect(paid.rows).toHaveLength(1);
        expect(paid.rows[0]).toMatchObject({
          amount: '300',
          status: 'captured',
          currency: 'MXN',
          grand_total: '300',
          tickets: 1,
        });
        const reserved = await client.query(
          'SELECT status FROM merchant.inventory_reservation WHERE id=$1',
          [reservation.id],
        );
        expect(reserved.rows[0].status).toBe('committed');
        expect(noOpCalls).toHaveLength(1);
      } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.end();
      }
    },
  );
});
