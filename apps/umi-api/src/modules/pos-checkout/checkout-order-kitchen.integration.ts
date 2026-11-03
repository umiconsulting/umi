import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { cancelSentOrderLine } from '../../shared/orders/cancel-sent-order-line';
import { TableMapRepository } from '../table-map/table-map.repository';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';
import { PosSaleRepository } from '../pos-sale/pos-sale.repository';
import { PosCheckoutRepository } from './pos-checkout.repository';

const dsn = process.env.CANCEL_VERIFY_DATABASE_URL;

/** Real order, payment, receipt, kitchen and inventory reservation SQL.
 * Stock tracking is disabled only in this disposable fixture. Loyalty closeout
 * uses an explicit no-op adapter and remains outside this test. */
describe.skipIf(!dsn)('checkout order and kitchen on a disposable populated copy', () => {
  it.each([
    { replaceAll: false, staleVisit: false },
    { replaceAll: true, staleVisit: false },
    { replaceAll: false, staleVisit: true },
  ])(
    'settles the same order; replace all: $replaceAll; older cart visit: $staleVisit',
    async ({ replaceAll, staleVisit }) => {
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
        const fixtureTableIds = [randomUUID(), randomUUID(), randomUUID()];
        const plan = {
          schemaVersion: 1,
          areas: [
            {
              id: randomUUID(),
              name: 'Checkout test',
              width: 1200,
              height: 800,
              elements: fixtureTableIds.map((id, index) => ({
                id,
                kind: 'table',
                shape: 'square',
                label: `Test ${index + 1}`,
                capacity: 4,
                x: 120 + index * 200,
                y: 120,
                width: 80,
                height: 80,
                rotation: 0,
              })),
            },
          ],
        };
        await client.query(
          `INSERT INTO merchant.floor_plan
             (merchant_id,location_id,version,draft,published_version,published,published_at)
           VALUES ($1::uuid,$2::uuid,1,$3::jsonb,1,$3::jsonb,now())
           ON CONFLICT (merchant_id,location_id) DO UPDATE SET
             version=merchant.floor_plan.version+1,draft=$3::jsonb,
             published_version=merchant.floor_plan.version+1,published=$3::jsonb,published_at=now()`,
          [row.merchant_id, row.location_id, JSON.stringify(plan)],
        );
        const room = new TableMapRepository({} as never);
        const tables = await room.servingTables(client, row.merchant_id, row.location_id);
        const snapshot = await room.readInTransaction(client, row.merchant_id, row.location_id);
        const table = [...tables.values()].find(
          (candidate) =>
            candidate.capacity >= 2 &&
            !snapshot.states.some((state) => state.tableId === candidate.tableId && state.seatedAt),
        );
        expect(table, 'The disposable fixture needs a free table for two people.').toBeDefined();
        const party = replaceAll
          ? await room.merge(client, row.merchant_id, row.location_id, {
              tableIds: fixtureTableIds.slice(0, 2),
              partySize: 2,
            })
          : await room.seat(client, row.merchant_id, row.location_id, {
              tableId: table!.tableId,
              partySize: 2,
            });
        const seated = party.find((entry) => entry.tableId === table!.tableId)!;
        await client.query(
          `UPDATE merchant.pos_cart SET table_id=$2::uuid,table_name=$3,
             table_visit_id=(SELECT visit_id FROM merchant.table_state
               WHERE merchant_id=$4::uuid AND location_id=$5::uuid AND table_id=$2::uuid)
           WHERE id=$1::uuid`,
          [row.id, table!.tableId, table!.label, row.merchant_id, row.location_id],
        );
        const visit = await client.query(
          `SELECT visit_id FROM merchant.table_state
           WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=$3::uuid`,
          [row.merchant_id, row.location_id, table!.tableId],
        );
        if (staleVisit) {
          await client.query(
            'UPDATE merchant.pos_cart SET table_visit_id=$2::uuid WHERE id=$1::uuid',
            [row.id, randomUUID()],
          );
        }
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
        const beforeCommit = await room.readInTransaction(client, row.merchant_id, row.location_id);
        expect(
          beforeCommit.states.find((entry) => entry.tableId === table!.tableId)?.paidAt,
        ).toBeNull();
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
        const paidTable = await client.query(
          `SELECT state,seated_at,party_size,group_id,visit_id,paid_at
             FROM merchant.table_state
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid
              AND table_id=(SELECT table_id FROM merchant.pos_cart WHERE id=$3::uuid)`,
          [row.merchant_id, row.location_id, row.id],
        );
        expect(paidTable.rows[0]).toMatchObject({
          state: 'seated',
          seated_at: new Date(seated.seatedAt!),
          party_size: 2,
          group_id: seated.groupId,
          visit_id: visit.rows[0].visit_id,
        });
        if (staleVisit) expect(paidTable.rows[0].paid_at).toBeNull();
        else expect(paidTable.rows[0].paid_at).toBeInstanceOf(Date);
        const paidRoom = await room.readInTransaction(client, row.merchant_id, row.location_id);
        for (const member of party) {
          expect(paidRoom.states.find((entry) => entry.tableId === member.tableId)).toMatchObject({
            state: 'seated',
            partySize: 2,
            groupId: seated.groupId,
            paidAt: paidTable.rows[0].paid_at?.toISOString() ?? null,
            openAccountId: null,
          });
        }
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
        if (staleVisit) return;

        // Un consumo nuevo añade saldo a la misma visita; su cancelación conserva a las personas.
        const carts = new PosCartRepository({} as never);
        const sales = new PosSaleRepository({} as never, carts);
        const next = await carts.openTable(
          client,
          row.merchant_id,
          row.location_id,
          row.operator_session_id,
          table!.tableId,
        );
        expect(next).not.toBeNull();
        const withBalance = await room.readInTransaction(client, row.merchant_id, row.location_id);
        for (const member of party) {
          expect(
            withBalance.states.find((entry) => entry.tableId === member.tableId),
          ).toMatchObject({
            paidAt: paidTable.rows[0].paid_at.toISOString(),
            openAccountId: next!.id,
          });
        }
        await sales.cancelCarriedOver(
          client,
          row.merchant_id,
          row.user_id,
          false,
          {
            locationId: row.location_id,
            operatorSessionId: row.operator_session_id,
            idempotencyKey: randomUUID(),
            accounts: [{ cartId: next!.id, expectedVersion: next!.version }],
            reasonCode: 'operator_mistake',
            reason: 'Disposable second-consumption test',
          },
          { allowCurrentBusinessDay: true },
        );
        const afterCancellation = await room.readInTransaction(
          client,
          row.merchant_id,
          row.location_id,
        );
        expect(
          afterCancellation.states.find((entry) => entry.tableId === table!.tableId),
        ).toMatchObject({
          state: 'seated',
          seatedAt: seated.seatedAt,
          partySize: 2,
          paidAt: paidTable.rows[0].paid_at.toISOString(),
          openAccountId: null,
        });

        const takeaway = await carts.openTable(
          client,
          row.merchant_id,
          row.location_id,
          row.operator_session_id,
          table!.tableId,
        );
        await expect(
          carts.setFulfillment(
            client,
            row.merchant_id,
            takeaway!.id,
            takeaway!.version,
            row.operator_session_id,
            'takeout',
          ),
        ).resolves.toBe(true);
        const afterTakeaway = await room.readInTransaction(
          client,
          row.merchant_id,
          row.location_id,
        );
        expect(
          afterTakeaway.states.find((entry) => entry.tableId === table!.tableId),
        ).toMatchObject({
          state: 'seated',
          partySize: 2,
          paidAt: paidTable.rows[0].paid_at.toISOString(),
        });

        const moved = await room.move(client, row.merchant_id, row.location_id, {
          fromTableId: table!.tableId,
          toTableId: fixtureTableIds[2],
        });
        expect(moved.find((entry) => entry.tableId === fixtureTableIds[2])).toMatchObject({
          state: 'seated',
          seatedAt: seated.seatedAt,
          partySize: 2,
          paidAt: paidTable.rows[0].paid_at.toISOString(),
        });
        expect(moved.find((entry) => entry.tableId === table!.tableId)).toMatchObject({
          state: 'dirty',
          paidAt: null,
        });
        const cleared = await room.clear(client, row.merchant_id, row.location_id, {
          tableId: fixtureTableIds[2],
        });
        expect(cleared).toMatchObject([{ state: 'dirty', paidAt: null, seatedAt: null }]);
        await room.openTable(client, row.merchant_id, row.location_id, {
          tableId: fixtureTableIds[2],
        });
        const newParty = await room.seat(client, row.merchant_id, row.location_id, {
          tableId: fixtureTableIds[2],
          partySize: 1,
        });
        expect(newParty).toMatchObject([{ state: 'seated', paidAt: null, partySize: 1 }]);
      } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.end();
      }
    },
  );
});
