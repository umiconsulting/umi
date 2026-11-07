import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  SalesAnalysisGroup,
  SalesAnalysisGroupWrite,
  SalesAnalysisQuery,
} from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import type { AnalysisSale } from './sales-analysis';

interface ProductOption {
  id: string;
  name: string;
  categoryId: string | null;
  category: string | null;
  categoryColor: string | null;
}
interface AnalysisContext {
  timezone: string;
  currency: string;
  today: string;
  capturedAt: string;
  firstSaleDate: string | null;
  products: ProductOption[];
  groups: SalesAnalysisGroup[];
  locations: { id: string; name: string }[];
}

const MAX_REPORT_TICKETS = 20_000;
const MAX_CATALOG_PRODUCTS = 5000;

@Injectable()
export class SalesAnalysisRepository {
  constructor(private readonly pg: PgService) {}

  options(userId: string, merchantId: string, locationId: string | null) {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      (client) => this.context(client, merchantId, locationId),
      locationId,
    );
  }

  read(userId: string, merchantId: string, locationId: string | null, query: SalesAnalysisQuery) {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const context = await this.context(client, merchantId, locationId);
        const sales = await client.query<AnalysisSale & { currency: string }>(
          `
        select s.id::text, s.location_id::text as "locationId", l.name as "locationName",
          r.business_date::text as day, to_char(o.placed_at at time zone $5, 'HH24') as hour,
          extract(isodow from r.business_date)::text as weekday,
          c.table_visit_id::text as "visitId", r.currency,
          (r.grand_total - coalesce((r.snapshot->'tip'->>'minorUnits')::bigint, 0))::float8 as "merchandiseMinorUnits",
          coalesce((r.snapshot->'tip'->>'minorUnits')::bigint, 0)::float8 as "tipsMinorUnits",
          coalesce((r.snapshot->'discountTotal'->>'minorUnits')::bigint, 0)::float8 as "discountsMinorUnits",
          exists (select 1 from jsonb_array_elements(r.snapshot->'lines') item where item->'discount' is null) as "legacyDiscount",
          coalesce((select jsonb_agg(jsonb_build_object(
            'id', item->>'lineRef', 'productId', cl.product_id, 'name', item->>'description', 'quantity', (item->>'quantity')::int,
            'merchandiseMinorUnits', case
              when item->'discount' is not null and item->'discount' <> 'null'::jsonb
                then (item->'lineTotal'->>'minorUnits')::bigint - (item->'discount'->>'minorUnits')::bigint
              when coalesce((r.snapshot->'discountTotal'->>'minorUnits')::bigint, 0) = 0
                then (item->'lineTotal'->>'minorUnits')::bigint
              else null end
          ) order by ordinal)
          from jsonb_array_elements(r.snapshot->'lines') with ordinality as receipt_line(item, ordinal)
          left join merchant.pos_cart_line cl on cl.cart_id = s.cart_id and cl.id::text = item->>'lineRef'), '[]') as lines,
          coalesce((select jsonb_agg(jsonb_build_object(
            'id', x.id, 'day', x.business_date::text, 'hour', to_char(x.committed_at at time zone $5, 'HH24'),
            'weekday', extract(isodow from x.business_date)::text,
            'merchandiseMinorUnits', x.total_minor_units - x.tip_minor_units, 'tipsMinorUnits', x.tip_minor_units,
            'quantities', coalesce((select jsonb_agg(jsonb_build_object('lineId', xl.sale_line_id, 'quantity', xl.compensated_quantity,
              'merchandiseMinorUnits', xl.total_minor_units - xl.tip_minor_units))
              from merchant.pos_sale_exception_line xl where xl.exception_id = x.id and xl.merchant_id = $1::uuid), '[]')
          ) order by x.committed_at, x.id)
          from merchant.pos_sale_exception x
          where x.sale_id = s.id and x.merchant_id = $1::uuid and x.status = 'committed' and x.committed_at <= $6::timestamptz), '[]') as refunds
        from merchant.pos_committed_sale s
        join merchant.receipt_snapshot r on r.id = s.receipt_snapshot_id and r.merchant_id = s.merchant_id
        join merchant.customer_order o on o.id = s.order_id and o.merchant_id = s.merchant_id
        join merchant.pos_cart c on c.id = s.cart_id and c.merchant_id = s.merchant_id
        join merchant.location l on l.id = s.location_id and l.merchant_id = s.merchant_id
        where s.merchant_id = $1::uuid and ($4::uuid is null or s.location_id = $4::uuid)
          and s.committed_at <= $6::timestamptz
          and (r.business_date between $2::date and $3::date
            or ($7::boolean and exists (select 1 from merchant.pos_sale_exception x
              where x.sale_id = s.id and x.merchant_id = $1::uuid and x.status = 'committed'
                and x.business_date between $2::date and $3::date and x.committed_at <= $6::timestamptz)))
        order by o.placed_at, s.id limit $8
      `,
          [
            merchantId,
            query.from,
            query.to,
            locationId,
            context.timezone,
            context.capturedAt,
            query.refundView === 'period_movements',
            MAX_REPORT_TICKETS + 1,
          ],
        );
        if (sales.rows.length > MAX_REPORT_TICKETS)
          throw new UnprocessableEntityException({ code: 'REPORT_RANGE_TOO_LARGE' });
        if (sales.rows.some((sale) => sale.currency !== context.currency))
          throw new ConflictException({ code: 'REPORT_CURRENCY_MISMATCH' });
        return { context, sales: sales.rows };
      },
      locationId,
    );
  }

  saveGroup(userId: string, merchantId: string, groupId: string, input: SalesAnalysisGroupWrite) {
    return this.pg.runWithMerchant(merchantId, userId, async (client) => {
      await this.lockGroups(client, merchantId);
      const products = await client.query(
        'select id from merchant.product where merchant_id = $1::uuid and id = any($2::uuid[])',
        [merchantId, input.productIds],
      );
      if (products.rowCount !== input.productIds.length)
        throw new UnprocessableEntityException({ code: 'REPORT_GROUP_PRODUCT_INVALID' });
      const groups = await this.groups(client, merchantId);
      const existing = groups.find((group) => group.id === groupId);
      if (
        existing &&
        existing.name === input.name &&
        sameProducts(existing.productIds, input.productIds)
      )
        return existing;
      if ((existing?.version ?? 0) !== input.expectedVersion)
        throw new ConflictException({ code: 'REPORT_GROUP_CHANGED' });
      if (!existing && groups.length >= 200)
        throw new UnprocessableEntityException({ code: 'REPORT_GROUP_LIMIT' });
      try {
        if (existing) {
          await client.query(
            'update merchant.sales_analysis_group set name = $3, version = version + 1, updated_at = now() where merchant_id = $1::uuid and id = $2::uuid',
            [merchantId, groupId, input.name],
          );
        } else {
          await client.query(
            'insert into merchant.sales_analysis_group (merchant_id, id, name) values ($1::uuid, $2::uuid, $3)',
            [merchantId, groupId, input.name],
          );
        }
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new ConflictException({ code: 'REPORT_GROUP_NAME_EXISTS' });
        throw error;
      }
      await client.query(
        'delete from merchant.sales_analysis_group_product where merchant_id = $1::uuid and group_id = $2::uuid',
        [merchantId, groupId],
      );
      await client.query(
        `insert into merchant.sales_analysis_group_product (merchant_id, group_id, product_id)
        select $1::uuid, $2::uuid, unnest($3::uuid[])`,
        [merchantId, groupId, input.productIds],
      );
      return {
        id: groupId,
        name: input.name,
        productIds: input.productIds,
        version: (existing?.version ?? 0) + 1,
      };
    });
  }

  deleteGroup(userId: string, merchantId: string, groupId: string, expectedVersion: number) {
    return this.pg.runWithMerchant(merchantId, userId, async (client) => {
      await this.lockGroups(client, merchantId);
      const result = await client.query(
        'delete from merchant.sales_analysis_group where merchant_id = $1::uuid and id = $2::uuid and version = $3 returning id',
        [merchantId, groupId, expectedVersion],
      );
      if (!result.rowCount) throw new ConflictException({ code: 'REPORT_GROUP_CHANGED' });
      return { deleted: true };
    });
  }

  private lockGroups(client: PoolClient, merchantId: string) {
    return client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `sales-analysis-groups:${merchantId}`,
    ]);
  }

  private async groups(client: PoolClient, merchantId: string): Promise<SalesAnalysisGroup[]> {
    return (
      await client.query<SalesAnalysisGroup>(
        `
      select g.id::text, g.name, g.version,
        coalesce(array_agg(p.product_id::text order by p.product_id) filter (where p.product_id is not null), '{}') as "productIds"
      from merchant.sales_analysis_group g
      left join merchant.sales_analysis_group_product p on p.merchant_id = g.merchant_id and p.group_id = g.id
      where g.merchant_id = $1::uuid group by g.id order by g.name, g.id
    `,
        [merchantId],
      )
    ).rows;
  }

  private async context(
    client: PoolClient,
    merchantId: string,
    locationId: string | null,
  ): Promise<AnalysisContext> {
    const meta = await client.query<Omit<AnalysisContext, 'products' | 'groups' | 'locations'>>(
      `
      select m.timezone, m.currency,
        ((now() at time zone m.timezone) - m.business_day_start::interval)::date::text as today,
        transaction_timestamp()::text as "capturedAt",
        (select min(r.business_date)::text from merchant.pos_committed_sale s
          join merchant.receipt_snapshot r on r.id = s.receipt_snapshot_id and r.merchant_id = s.merchant_id
          where s.merchant_id = m.id and ($2::uuid is null or s.location_id = $2::uuid)) as "firstSaleDate"
      from merchant.merchant m where m.id = $1::uuid
    `,
      [merchantId, locationId],
    );
    if (!meta.rows[0]) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    const products = await client.query<ProductOption>(
      `
      select p.id::text, p.name, p.category_id::text as "categoryId", pc.name as category, pc.color as "categoryColor"
      from merchant.product p left join merchant.product_category pc on pc.id = p.category_id and pc.merchant_id = p.merchant_id
      where p.merchant_id = $1::uuid order by p.name, p.id limit $2
    `,
      [merchantId, MAX_CATALOG_PRODUCTS + 1],
    );
    if (products.rows.length > MAX_CATALOG_PRODUCTS)
      throw new UnprocessableEntityException({ code: 'REPORT_CATALOG_TOO_LARGE' });
    const locations = await client.query<{ id: string; name: string }>(
      'select id::text, name from merchant.location where merchant_id = $1::uuid and ($2::uuid is null or id = $2::uuid) order by name, id',
      [merchantId, locationId],
    );
    return {
      ...meta.rows[0],
      capturedAt: new Date(meta.rows[0].capturedAt).toISOString(),
      products: products.rows,
      groups: await this.groups(client, merchantId),
      locations: locations.rows,
    };
  }
}

function sameProducts(first: string[], second: string[]) {
  const sortedSecond = [...second].sort();
  return (
    first.length === second.length &&
    [...first].sort().every((id, index) => id === sortedSecond[index])
  );
}
