import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';
import { TableMapRepository } from '../table-map/table-map.repository';

const databaseUrl = process.env.PARTIAL_GUARD_DATABASE_URL;
const merchantId = process.env.PARTIAL_GUARD_MERCHANT_ID;
const locationId = process.env.PARTIAL_GUARD_LOCATION_ID;
const cartId = process.env.PARTIAL_GUARD_CART_ID;

describe.skipIf(!databaseUrl || !merchantId || !locationId || !cartId)(
  'guardas de abono incierto en PostgreSQL real',
  () => {
    it('bloquea edición y movimiento sin tender fact ni payment attempt', async () => {
      const pool = new Pool({ connectionString: databaseUrl, max: 1 });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('app.current_merchant',$1,true),
                  set_config('app.current_location',$2,true)`,
          [merchantId, locationId],
        );
        const cart = await client.query<{
          table_id: string;
          operator_session_id: string;
          version: number;
        }>(
          `SELECT table_id::text,operator_session_id::text,version
           FROM merchant.pos_cart
           WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND id=$3::uuid
             AND status IN ('draft','prepared') AND table_id IS NOT NULL FOR UPDATE`,
          [merchantId, locationId, cartId],
        );
        expect(cart.rows).toHaveLength(1);
        const account = cart.rows[0];
        const existing = await client.query(
          `SELECT 1 FROM merchant.pos_partial_payment WHERE merchant_id=$1::uuid AND cart_id=$2::uuid
           UNION ALL SELECT 1 FROM merchant.pos_payment_attempt WHERE merchant_id=$1::uuid AND cart_id=$2::uuid
             AND status NOT IN ('declined','cancelled')
           UNION ALL SELECT 1 FROM merchant.pos_tender_fact WHERE merchant_id=$1::uuid AND cart_id=$2::uuid
           UNION ALL SELECT 1 FROM merchant.pos_checkout_draft WHERE merchant_id=$1::uuid AND cart_id=$2::uuid
             AND state IN ('payment_accepted','payment_unknown','receipt_available','completed')`,
          [merchantId, cartId],
        );
        expect(existing.rowCount).toBe(0);

        const tables = new TableMapRepository({} as never);
        const plan = await tables.servingTables(client, merchantId!, locationId!);
        const source = plan.get(account.table_id);
        expect(source).toBeDefined();
        const state = await client.query<{ party_size: number; group_id: string | null }>(
          `SELECT party_size,group_id::text FROM merchant.table_state
           WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=$3::uuid`,
          [merchantId, locationId, account.table_id],
        );
        expect(state.rows[0]?.group_id).toBeNull();
        const occupied = await client.query<{ table_id: string }>(
          `SELECT table_id::text FROM merchant.table_state
           WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND seated_at IS NOT NULL`,
          [merchantId, locationId],
        );
        const occupiedIds = new Set(occupied.rows.map((row) => row.table_id));
        const destination = [...plan.values()].find(
          (table) =>
            table.tableId !== account.table_id &&
            !occupiedIds.has(table.tableId) &&
            table.capacity >= (state.rows[0]?.party_size ?? 0),
        );
        expect(destination).toBeDefined();

        await client.query(
          `INSERT INTO merchant.pos_partial_payment
             (merchant_id,location_id,cart_id,tender_id,position,cart_version,
              cart_fingerprint,base_due_minor_units,currency,tender_type,
              amount_minor_units,status,operator_session_id,command_id)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,0,$5,repeat('0',64),
                   100,'MXN','manual_terminal',100,'outcome_unknown',$6::uuid,$7::uuid)`,
          [
            merchantId,
            locationId,
            cartId,
            randomUUID(),
            account.version,
            account.operator_session_id,
            randomUUID(),
          ],
        );
        const carts = new PosCartRepository({} as never);
        await expect(
          carts.assertFinanciallyMutable(client, merchantId!, cartId!),
        ).rejects.toMatchObject({ response: { code: 'CART_PAYMENT_UNRESOLVED' } });
        await expect(
          tables.move(client, merchantId!, locationId!, {
            fromTableId: account.table_id,
            toTableId: destination!.tableId,
          }),
        ).rejects.toMatchObject({ response: { code: 'CART_PAYMENT_UNRESOLVED' } });
        const stillHere = await client.query<{ table_id: string }>(
          `SELECT table_id::text FROM merchant.pos_cart WHERE merchant_id=$1::uuid AND id=$2::uuid`,
          [merchantId, cartId],
        );
        expect(stillHere.rows[0]?.table_id).toBe(account.table_id);
      } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.end();
      }
    });
  },
);
