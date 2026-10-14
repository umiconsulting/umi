import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/migrations/040_onca_checkout_policy.sql'),
  'utf8',
);

describe('ONCA initial checkout policy migration', () => {
  let db: Client;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_WORKER) {
      throw new Error('Set DATABASE_URL_WORKER to a populated local test database');
    }
    db = new Client({ connectionString: process.env.DATABASE_URL_WORKER });
    await db.connect();
    await db.query('begin');
  });

  afterAll(async () => {
    if (db) {
      await db.query('rollback');
      await db.end();
    }
  });

  it('creates a cash-only policy once and preserves an existing policy', async () => {
    const merchant = await db.query<{ id: string }>(
      "select id::text from merchant.merchant where handle='onca'",
    );
    expect(merchant.rowCount).toBe(1);
    const merchantId = merchant.rows[0].id;

    const before = await db.query<{ id: string; value: unknown }>(
      `select id::text, to_jsonb(p) as value
         from merchant.pos_checkout_policy p
        where merchant_id=$1 order by id`,
      [merchantId],
    );

    // La sucursal existe solo dentro de esta transacción de prueba.
    const testLocation = await db.query<{ id: string }>(
      `insert into merchant.location (merchant_id,name,status)
       values ($1,'ONCA test política 040','active') returning id::text`,
      [merchantId],
    );
    const locationId = testLocation.rows[0].id;

    await db.query(sql);
    const first = await db.query<{
      version: string;
      currency: string;
      manualTerminalEnabled: boolean;
      bankTransferEnabled: boolean;
      mixedTenderEnabled: boolean;
      maximumTenderLines: number;
      allowDineInWithoutTable: boolean;
      tipsEnabled: boolean;
      discountsEnabled: boolean;
      bankTransferHolderName: string | null;
      bankTransferBankName: string | null;
      bankTransferClabe: string | null;
      bankTransferAccountNumber: string | null;
    }>(
      `select version,currency,
              manual_terminal_enabled as "manualTerminalEnabled",
              bank_transfer_enabled as "bankTransferEnabled",
              mixed_tender_enabled as "mixedTenderEnabled",
              maximum_tender_lines as "maximumTenderLines",
              allow_dine_in_without_table as "allowDineInWithoutTable",
              tips_enabled as "tipsEnabled",
              discounts_enabled as "discountsEnabled",
              bank_transfer_holder_name as "bankTransferHolderName",
              bank_transfer_bank_name as "bankTransferBankName",
              bank_transfer_clabe as "bankTransferClabe",
              bank_transfer_account_number as "bankTransferAccountNumber"
         from merchant.pos_checkout_policy
        where merchant_id=$1 and location_id=$2`,
      [merchantId, locationId],
    );
    expect(first.rowCount).toBe(1);
    expect(first.rows[0]).toEqual({
      version: 'onca-initial-cash-only-v1',
      currency: 'MXN',
      manualTerminalEnabled: false,
      bankTransferEnabled: false,
      mixedTenderEnabled: false,
      maximumTenderLines: 1,
      allowDineInWithoutTable: false,
      tipsEnabled: false,
      discountsEnabled: false,
      bankTransferHolderName: null,
      bankTransferBankName: null,
      bankTransferClabe: null,
      bankTransferAccountNumber: null,
    });

    const firstJson = await db.query<{ value: unknown }>(
      `select to_jsonb(p) as value from merchant.pos_checkout_policy p
        where merchant_id=$1 and location_id=$2`,
      [merchantId, locationId],
    );
    await db.query(sql);
    const second = await db.query<{ value: unknown }>(
      `select to_jsonb(p) as value from merchant.pos_checkout_policy p
        where merchant_id=$1 and location_id=$2`,
      [merchantId, locationId],
    );
    expect(second.rows).toEqual(firstJson.rows);

    const existing = await db.query<{ id: string; value: unknown }>(
      `select id::text, to_jsonb(p) as value
         from merchant.pos_checkout_policy p
        where merchant_id=$1 and id::text = any($2::text[]) order by id`,
      [merchantId, before.rows.map((row) => row.id)],
    );
    expect(existing.rows).toEqual(before.rows);

    const missing = await db.query<{ count: string }>(
      `select count(*)::text
         from merchant.location l
         left join merchant.pos_checkout_policy p
           on p.merchant_id=l.merchant_id and p.location_id=l.id
        where l.merchant_id=$1 and l.status='active' and p.id is null`,
      [merchantId],
    );
    expect(missing.rows[0].count).toBe('0');
  });
});
