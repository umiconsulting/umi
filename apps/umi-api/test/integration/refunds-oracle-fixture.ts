import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

/**
 * Isolated fixture for the refunds oracle.
 *
 * The fixture uses its own merchant, its own locations and its own products.
 * Fixture A is unchanged. One sale has a void, one has a full refund, one has
 * a partial refund, and one sale is outside the `today` window. Two exceptions
 * must stay out of the total: one `outcome_unknown` row, and one committed row
 * whose sale date is before the window.
 *
 * Every sale has one cart line. The line facts in `receipt_snapshot` are the
 * source that the refund line trigger checks, so the exception lines copy them.
 */
export interface RefundsOracleIds {
  merchant: string;
  location: string;
  user: string;
  staff: string;
  device: string;
  session: string;
  operator: string;
  product: string;
}

export type ExceptionType = 'void' | 'full_refund' | 'partial_refund';

export interface OracleSale {
  key: string;
  businessDate: string;
  netMinorUnits: number;
  tipMinorUnits: number;
  saleId: string;
  receiptId: string;
  lineId: string;
}

export interface OracleException {
  saleKey: string;
  type: ExceptionType;
  status: 'committed' | 'outcome_unknown';
  totalMinorUnits: number;
  tipMinorUnits: number;
  exceptionBusinessDate: string;
  exceptionId: string;
}

export async function seedRefundsOracle(pool: Pool) {
  const ids: RefundsOracleIds = {
    merchant: randomUUID(),
    location: randomUUID(),
    user: randomUUID(),
    staff: randomUUID(),
    device: randomUUID(),
    session: randomUUID(),
    operator: randomUUID(),
    product: randomUUID(),
  };
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into merchant.merchant(id,name,handle,timezone,business_day_start)
       values ($1::uuid,'Devoluciones de prueba',$1::text,'America/Mazatlan','04:00')`,
      [ids.merchant],
    );
    await client.query(
      `insert into merchant.location(id,merchant_id,name) values ($1,$2,'Única')`,
      [ids.location, ids.merchant],
    );
    await client.query(`insert into umi."user"(id,full_name) values ($1,'Operador de prueba')`, [
      ids.user,
    ]);
    await client.query(
      `insert into merchant.staff(id,merchant_id,user_id,role_id,name)
       select $1,$2,$3,id,'Operador' from umi.role where key='owner'`,
      [ids.staff, ids.merchant, ids.user],
    );
    await client.query(
      `insert into merchant.device(id,merchant_id,location_id,name,kind)
       values ($1,$2,$3,'Caja de devoluciones','pos_terminal')`,
      [ids.device, ids.merchant, ids.location],
    );
    await client.query(
      `insert into runtime.session(id,merchant_id,principal_type,principal_id,token_hash,expires_at)
       values ($1,$2,'user',$3,$4,now()+interval '1 day')`,
      [ids.session, ids.merchant, ids.user, randomUUID()],
    );
    await client.query(
      `insert into runtime.operator_session(id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,permissions,entitlements,expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,array['sale.lifecycle'],'[]',now()+interval '1 day')`,
      [ids.operator, ids.session, ids.user, ids.staff, ids.device, ids.merchant, ids.location],
    );
    await client.query(
      `insert into merchant.product(id,merchant_id,category_id,name)
       values ($1,$2,null,'Café americano')`,
      [ids.product, ids.merchant],
    );

    const sales = new Map<string, OracleSale>();

    async function insertSale(
      key: string,
      businessDate: string,
      netMinorUnits: number,
      tipMinorUnits: number,
    ): Promise<OracleSale> {
      const cart = randomUUID();
      const attempt = randomUUID();
      const order = randomUUID();
      const receipt = randomUUID();
      const saleId = randomUUID();
      const line = randomUUID();
      await client.query(
        `insert into merchant.pos_cart(id,merchant_id,location_id,operator_session_id,original_operator_session_id,original_operator_user_id,operator_user_id,status,lifecycle_state)
         values($1,$2,$3,$4,$4,$5,$5,'committed','committed')`,
        [cart, ids.merchant, ids.location, ids.operator, ids.user],
      );
      await client.query(
        `insert into merchant.pos_cart_line(id,merchant_id,cart_id,product_id,identity_key,product_name,quantity,base_price,tax_rate_basis_points)
         values($1,$2,$3,$4,$5,'Café americano',1,10000,0)`,
        [line, ids.merchant, cart, ids.product, createHash('sha256').update(line).digest('hex')],
      );
      await client.query(
        `insert into merchant.pos_payment_attempt(id,merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,proof_source,correlation_id)
         values($1::uuid,$2,$3,$4,'cash',$5,'MXN','succeeded','cash',$1::text)`,
        [attempt, ids.merchant, ids.location, cart, netMinorUnits + tipMinorUnits],
      );
      await client.query(
        `insert into merchant.customer_order(id,merchant_id,location_id,source,status,placed_at)
         values($1,$2,$3,'pos','completed',$4::date + interval '18 hours')`,
        [order, ids.merchant, ids.location, businessDate],
      );
      const snapshot = {
        lines: [
          {
            lineRef: line,
            description: 'Café americano',
            quantity: 1,
            lineTotal: { minorUnits: 10000, currency: 'MXN' },
            discount: { minorUnits: 1000, currency: 'MXN' },
            tip: { minorUnits: tipMinorUnits, currency: 'MXN' },
          },
        ],
        grandTotal: { minorUnits: netMinorUnits + tipMinorUnits, currency: 'MXN' },
        tip: { minorUnits: tipMinorUnits, currency: 'MXN' },
        discountTotal: { minorUnits: 1000, currency: 'MXN' },
      };
      await client.query(
        `insert into merchant.receipt_snapshot(id,merchant_id,location_id,order_id,payment_attempt_id,receipt_number,business_date,currency,grand_total,snapshot)
         values($1::uuid,$2,$3,$4,$5,$1::text,$6::date,'MXN',$7,$8)`,
        [
          receipt,
          ids.merchant,
          ids.location,
          order,
          attempt,
          businessDate,
          netMinorUnits + tipMinorUnits,
          JSON.stringify(snapshot),
        ],
      );
      await client.query(
        `insert into merchant.pos_committed_sale(id,merchant_id,location_id,cart_id,order_id,payment_attempt_id,receipt_snapshot_id,totals_fingerprint,committed_at)
         values($1,$2,$3,$4,$5,$6,$7,repeat('a',64),$8::date + interval '19 hours')`,
        [saleId, ids.merchant, ids.location, cart, order, attempt, receipt, businessDate],
      );
      const sale: OracleSale = {
        key,
        businessDate,
        netMinorUnits,
        tipMinorUnits,
        saleId,
        receiptId: receipt,
        lineId: line,
      };
      sales.set(key, sale);
      return sale;
    }

    const exceptions: OracleException[] = [];

    async function insertException(
      saleKey: string,
      type: ExceptionType,
      status: 'committed' | 'outcome_unknown',
      totalMinorUnits: number,
      tipMinorUnits: number,
      exceptionBusinessDate: string,
      line: {
        merchandiseMinorUnits: number;
        discountMinorUnits: number;
        tipMinorUnits: number;
        totalMinorUnits: number;
      },
    ): Promise<OracleException> {
      const sale = sales.get(saleKey);
      if (!sale) throw new Error(`unknown sale ${saleKey}`);
      const preview = randomUUID();
      const exceptionId = randomUUID();
      await client.query(
        `insert into merchant.pos_exception_preview(id,merchant_id,location_id,sale_id,original_receipt_id,operator_session_id,device_id,exception_type,reason_code,
         selection,line_allocations,tender_allocations,allocation_policy,restock_intents,merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,remaining_after_minor_units,
         currency,approval_required,sale_version,exception_version,preview_fingerprint,correlation_id,expires_at)
         values($1::uuid,$2,$3,$4,$5,$6,$7,$8,'customer_return','[]','[]','[]','proportional','[]',$9,0,$10,$11,$12,$13,'MXN',false,1,0,repeat('b',64),$1::text,now()+interval '1 hour')`,
        [
          preview,
          ids.merchant,
          ids.location,
          sale.saleId,
          sale.receiptId,
          ids.operator,
          ids.device,
          type,
          line.merchandiseMinorUnits,
          line.discountMinorUnits,
          line.tipMinorUnits,
          line.totalMinorUnits,
          sale.netMinorUnits + sale.tipMinorUnits - line.totalMinorUnits,
        ],
      );
      await client.query(
        `insert into merchant.pos_sale_exception(id,merchant_id,location_id,sale_id,original_receipt_id,preview_id,exception_type,status,reason_code,operator_id,operator_session_id,device_id,device_credential_version,
         command_id,idempotency_key,command_fingerprint,preview_fingerprint,merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,currency,business_date,correlation_id,committed_at)
         values($1::uuid,$2,$3,$4,$5,$6,$7,$8,'customer_return',$9,$10,$11,1,$1,$1,repeat('a',64),repeat('b',64),$12,0,$13,$14,$15,'MXN',$16::date,$1::text,$16::date + interval '20 hours')`,
        [
          exceptionId,
          ids.merchant,
          ids.location,
          sale.saleId,
          sale.receiptId,
          preview,
          type,
          status,
          ids.user,
          ids.operator,
          ids.device,
          line.merchandiseMinorUnits,
          line.discountMinorUnits,
          line.tipMinorUnits,
          line.totalMinorUnits,
          exceptionBusinessDate,
        ],
      );
      await client.query(
        `insert into merchant.pos_sale_exception_line(merchant_id,location_id,exception_id,sale_id,sale_line_id,original_quantity,compensated_quantity,
         original_merchandise_minor_units,original_tax_minor_units,original_discount_minor_units,original_tip_minor_units,original_total_minor_units,
         merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,currency,restock_decision)
         values($1,$2,$3,$4,$5,1,1,10000,0,1000,$6,$7,$8,0,$9,$10,$11,'MXN','do_not_restock')`,
        [
          ids.merchant,
          ids.location,
          exceptionId,
          sale.saleId,
          sale.lineId,
          sale.tipMinorUnits,
          sale.netMinorUnits + sale.tipMinorUnits,
          line.merchandiseMinorUnits,
          line.discountMinorUnits,
          line.tipMinorUnits,
          line.totalMinorUnits,
        ],
      );
      const result: OracleException = {
        saleKey,
        type,
        status,
        totalMinorUnits,
        tipMinorUnits,
        exceptionBusinessDate,
        exceptionId,
      };
      exceptions.push(result);
      return result;
    }

    await insertSale('void_sale', '2026-11-03', 9000, 0);
    await insertSale('full_refund_sale', '2026-11-03', 9000, 2000);
    await insertSale('partial_refund_sale', '2026-11-03', 9000, 500);
    await insertSale('outside_sale', '2026-11-01', 9000, 1000);
    await insertSale('uncommitted_sale', '2026-11-03', 9000, 0);

    await insertException('void_sale', 'void', 'committed', 9000, 0, '2026-11-03', {
      merchandiseMinorUnits: 10000,
      discountMinorUnits: 1000,
      tipMinorUnits: 0,
      totalMinorUnits: 9000,
    });
    await insertException(
      'full_refund_sale',
      'full_refund',
      'committed',
      11000,
      2000,
      '2026-11-03',
      {
        merchandiseMinorUnits: 10000,
        discountMinorUnits: 1000,
        tipMinorUnits: 2000,
        totalMinorUnits: 11000,
      },
    );
    await insertException(
      'partial_refund_sale',
      'partial_refund',
      'committed',
      4500,
      500,
      '2026-11-03',
      {
        merchandiseMinorUnits: 5000,
        discountMinorUnits: 1000,
        tipMinorUnits: 500,
        totalMinorUnits: 4500,
      },
    );
    await insertException(
      'uncommitted_sale',
      'partial_refund',
      'outcome_unknown',
      1000,
      0,
      '2026-11-03',
      {
        merchandiseMinorUnits: 1000,
        discountMinorUnits: 0,
        tipMinorUnits: 0,
        totalMinorUnits: 1000,
      },
    );
    await insertException('outside_sale', 'full_refund', 'committed', 10000, 1000, '2026-11-03', {
      merchandiseMinorUnits: 10000,
      discountMinorUnits: 1000,
      tipMinorUnits: 1000,
      totalMinorUnits: 10000,
    });

    await client.query('commit');
    return { ids, sales: [...sales.values()], exceptions };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
