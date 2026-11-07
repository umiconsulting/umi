import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export async function seedSalesAnalysis(pool: Pool) {
  const ids = {
    merchant: randomUUID(),
    neighbour: randomUUID(),
    location: randomUUID(),
    branch: randomUUID(),
    user: randomUUID(),
    staff: randomUUID(),
    device: randomUUID(),
    session: randomUUID(),
    operator: randomUUID(),
    breadCategory: randomUUID(),
    coffeeCategory: randomUUID(),
    bread: randomUUID(),
    coffee: randomUUID(),
    foreignProduct: randomUUID(),
  };
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into merchant.merchant(id,name,handle,timezone,business_day_start)
      values ($1::uuid,'Análisis de prueba',$1::text,'America/Mazatlan','04:00'),($2::uuid,'Otro negocio',$2::text,'UTC','00:00')`,
      [ids.merchant, ids.neighbour],
    );
    await client.query(
      `insert into merchant.location(id,merchant_id,name) values ($1,$3,'Centro'),($2,$3,'Norte')`,
      [ids.location, ids.branch, ids.merchant],
    );
    await client.query(
      `insert into umi."user"(id,full_name) values ($1,'Administración de prueba')`,
      [ids.user],
    );
    await client.query(
      `insert into merchant.staff(id,merchant_id,user_id,role_id,name)
      select $1,$2,$3,id,'Administración' from umi.role where key='owner'`,
      [ids.staff, ids.merchant, ids.user],
    );
    await client.query(
      `insert into merchant.device(id,merchant_id,location_id,name,kind) values ($1,$2,$3,'Caja de prueba','pos_terminal')`,
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
      `insert into merchant.product_category(id,merchant_id,name) values ($1,$3,'Pan'),($2,$3,'Café')`,
      [ids.breadCategory, ids.coffeeCategory, ids.merchant],
    );
    await client.query(
      `insert into merchant.product(id,merchant_id,category_id,name) values ($1,$3,$4,'Concha'),($2,$3,$5,'Café americano'),($6,$7,null,'Producto ajeno')`,
      [
        ids.bread,
        ids.coffee,
        ids.merchant,
        ids.breadCategory,
        ids.coffeeCategory,
        ids.foreignProduct,
        ids.neighbour,
      ],
    );

    async function sale(
      location: string,
      placed: string,
      total: number,
      tip: number,
      products: string[],
    ) {
      const cart = randomUUID(),
        attempt = randomUUID(),
        order = randomUUID(),
        receipt = randomUUID(),
        saleId = randomUUID();
      await client.query(
        `insert into merchant.pos_cart(id,merchant_id,location_id,operator_session_id,original_operator_session_id,original_operator_user_id,operator_user_id,status,lifecycle_state)
        values($1,$2,$3,$4,$4,$5,$5,'committed','committed')`,
        [cart, ids.merchant, location, ids.operator, ids.user],
      );
      const lines = [];
      for (const product of products) {
        const line = randomUUID();
        const name = product === ids.bread ? 'Concha' : 'Café americano';
        await client.query(
          `insert into merchant.pos_cart_line(id,merchant_id,cart_id,product_id,identity_key,product_name,quantity,base_price,tax_rate_basis_points)
          values($1,$2,$3,$4,$5,$6,1,10000,0)`,
          [
            line,
            ids.merchant,
            cart,
            product,
            createHash('sha256').update(line).digest('hex'),
            name,
          ],
        );
        lines.push({
          lineRef: line,
          description: name,
          quantity: 1,
          lineTotal: { minorUnits: 10000, currency: 'MXN' },
          discount: { minorUnits: 1000, currency: 'MXN' },
          tip: { minorUnits: product === ids.coffee ? tip : 0, currency: 'MXN' },
        });
      }
      await client.query(
        `insert into merchant.pos_payment_attempt(id,merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,proof_source,correlation_id)
        values($1::uuid,$2,$3,$4,'cash',$5,'MXN','succeeded','cash',$1::text)`,
        [attempt, ids.merchant, location, cart, total + tip],
      );
      await client.query(
        `insert into merchant.customer_order(id,merchant_id,location_id,source,status,placed_at) values($1,$2,$3,'pos','completed',$4)`,
        [order, ids.merchant, location, placed],
      );
      const snapshot = {
        lines,
        grandTotal: { minorUnits: total + tip, currency: 'MXN' },
        tip: { minorUnits: tip, currency: 'MXN' },
        discountTotal: { minorUnits: products.length * 1000, currency: 'MXN' },
      };
      await client.query(
        `insert into merchant.receipt_snapshot(id,merchant_id,location_id,order_id,payment_attempt_id,receipt_number,business_date,currency,grand_total,snapshot)
        select $1::uuid,$2,$3,$4,$5,$1::text,((($8::timestamptz + interval '1 hour') at time zone 'America/Mazatlan') - interval '4 hours')::date,'MXN',$6,$7 from merchant.customer_order where id=$4`,
        [
          receipt,
          ids.merchant,
          location,
          order,
          attempt,
          total + tip,
          JSON.stringify(snapshot),
          placed,
        ],
      );
      await client.query(
        `insert into merchant.pos_committed_sale(id,merchant_id,location_id,cart_id,order_id,payment_attempt_id,receipt_snapshot_id,totals_fingerprint,committed_at)
        values($1,$2,$3,$4,$5,$6,$7,repeat('a',64),$8::timestamptz+interval '1 hour')`,
        [saleId, ids.merchant, location, cart, order, attempt, receipt, placed],
      );
      return { saleId, receipt, lineId: lines[0].lineRef };
    }
    const first = await sale(ids.location, '2026-11-02T16:00:00Z', 18000, 1500, [
      ids.bread,
      ids.coffee,
    ]);
    await sale(ids.location, '2026-11-02T17:00:00Z', 9000, 0, [ids.bread]);
    await sale(ids.branch, '2026-11-04T10:30:00Z', 9000, 0, [ids.coffee]);
    const preview = randomUUID();
    await client.query(
      `insert into merchant.pos_exception_preview(id,merchant_id,location_id,sale_id,original_receipt_id,operator_session_id,device_id,exception_type,reason_code,
      selection,line_allocations,tender_allocations,allocation_policy,restock_intents,merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,remaining_after_minor_units,
      currency,approval_required,sale_version,exception_version,preview_fingerprint,correlation_id,expires_at)
      values($1::uuid,$2,$3,$4,$5,$6,$7,'partial_refund','customer_return','[]','[]','[]','proportional','[]',10000,0,1000,0,9000,10500,'MXN',false,1,0,repeat('b',64),$1::text,now()+interval '1 hour')`,
      [preview, ids.merchant, ids.location, first.saleId, first.receipt, ids.operator, ids.device],
    );
    const refund = randomUUID();
    await client.query(
      `insert into merchant.pos_sale_exception(id,merchant_id,location_id,sale_id,original_receipt_id,preview_id,exception_type,status,reason_code,operator_id,operator_session_id,device_id,device_credential_version,
      command_id,idempotency_key,command_fingerprint,preview_fingerprint,merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,currency,business_date,correlation_id,committed_at)
      values($1::uuid,$2,$3,$4,$5,$6,'partial_refund','committed','customer_return',$7,$8,$9,1,$1,$1,repeat('a',64),repeat('b',64),10000,0,1000,0,9000,'MXN','2026-11-03',$1::text,'2026-11-03T19:00:00Z')`,
      [
        refund,
        ids.merchant,
        ids.location,
        first.saleId,
        first.receipt,
        preview,
        ids.user,
        ids.operator,
        ids.device,
      ],
    );
    await client.query(
      `insert into merchant.pos_sale_exception_line(merchant_id,location_id,exception_id,sale_id,sale_line_id,original_quantity,compensated_quantity,
      original_merchandise_minor_units,original_tax_minor_units,original_discount_minor_units,original_tip_minor_units,original_total_minor_units,
      merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,total_minor_units,currency,restock_decision)
      values($1,$2,$3,$4,$5,1,1,10000,0,1000,0,9000,10000,0,1000,0,9000,'MXN','do_not_restock')`,
      [ids.merchant, ids.location, refund, first.saleId, first.lineId],
    );
    await client.query('commit');
    return ids;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
