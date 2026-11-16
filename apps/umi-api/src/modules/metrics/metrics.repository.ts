import { Injectable, NotFoundException } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import type {
  MetricsDimension,
  MetricsId,
  MetricsQueryInput,
  MetricsResponse,
  MetricsValue,
} from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import { coverageSources, DEFINITION_VERSION } from './metrics.catalog';
import {
  averageTicket,
  dimensionRowCeiling,
  periodWindow,
  unitsPerTicket,
  type PeriodWindow,
} from './metrics.formulas';

interface MetaRow {
  timezone: string;
  currency: string | null;
  today: string;
  capturedAt: string;
}

interface SaleGroup {
  k0?: string | null;
  k1?: string | null;
  net: string;
  orders: string;
  discount: string;
  tips: string;
}

interface ItemGroup {
  k0?: string | null;
  k1?: string | null;
  units: string;
}

interface RefundGroup {
  k0?: string | null;
  k1?: string | null;
  refund: string;
}

interface PaymentRow {
  method: string;
  amount?: string;
  totalItems?: string;
  totalAmount?: string;
}

interface GroupRow {
  key: string;
  label?: string;
  amount?: string;
  orders?: string;
  units?: string;
  totalItems?: string;
  totalAmount?: string;
  totalOrders?: string;
  totalUnits?: string;
  productId?: string | null;
  productName?: string;
  category?: string | null;
}

interface MetricReadResult {
  response: MetricsResponse;
  statementCount: number;
}

type Query = <T extends QueryResultRow>(sql: string, params: unknown[]) => Promise<T[]>;

const baseFrom = `FROM merchant.pos_committed_sale s
     JOIN merchant.receipt_snapshot r ON r.id=s.receipt_snapshot_id`;

const operatorJoin = `LEFT JOIN merchant.cash_shift csh ON csh.id=s.cash_shift_id
     LEFT JOIN merchant.staff st ON st.user_id=csh.responsible_operator_id AND st.merchant_id=s.merchant_id`;

const rangeWhere = `s.merchant_id=$1::uuid AND r.business_date BETWEEN $2::date AND $3::date
     AND ($4::uuid IS NULL OR s.location_id=$4::uuid)`;

const DIMENSION_SQL: Record<MetricsDimension, string> = {
  day: 'r.business_date::text',
  hour: "to_char((s.committed_at AT TIME ZONE $5), 'HH24')",
  channel: "coalesce(s.origin_channel,'walk_in')",
  operator: "coalesce(st.name,'—')",
  product: 'cl.product_id::text',
  category: "coalesce(pc.name,'—')",
};

const PRESET_LIMIT = {
  payment_mix: 8,
  channel_mix: 8,
  product_mix: 200,
  operator_mix: 100,
  hour_mix: 24,
} as const;

const number = (value: string | number | null | undefined): number => Number(value ?? 0);

/**
 * The read side of the semantic analytics route. One transaction per request,
 * scoped by `runWithMerchant`; every statement is parameterized and every
 * accepted dimension comes from a fixed map. The request never supplies SQL.
 */
@Injectable()
export class MetricsRepository {
  constructor(private readonly pg: PgService) {}

  read(
    userId: string,
    merchantId: string,
    locationId: string | null,
    query: MetricsQueryInput,
    asOf?: string,
  ): Promise<MetricsResponse> {
    return this.readWithStats(userId, merchantId, locationId, query, asOf).then(
      (result) => result.response,
    );
  }

  readWithStats(
    userId: string,
    merchantId: string,
    locationId: string | null,
    query: MetricsQueryInput,
    asOf?: string,
  ): Promise<MetricReadResult> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        let statementCount = 0;
        const run: Query = async (sql, params) => {
          statementCount += 1;
          const result = await client.query(sql, params);
          return result.rows;
        };

        const meta = await run<MetaRow>(
          `SELECT m.timezone, m.currency, (now() AT TIME ZONE m.timezone)::date::text AS today,
                  transaction_timestamp()::text AS "capturedAt"
           FROM merchant.merchant m WHERE m.id=$1::uuid`,
          [merchantId],
        );
        if (!meta[0]) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
        const timezone = meta[0].timezone ?? 'UTC';
        const currency = meta[0].currency ?? null;
        const today = asOf ?? meta[0].today;
        const capturedAt = new Date(meta[0].capturedAt).toISOString();
        const window = periodWindow(query.range, today);
        const dimensions = query.dimensions;
        const requested = new Set<MetricsId>(query.metrics);

        const needsSale = [
          'net_sales',
          'orders',
          'average_ticket',
          'discounts',
          'tips',
          'units_per_ticket',
        ].some((id) => requested.has(id as MetricsId));
        const needsItems = requested.has('items_sold') || requested.has('units_per_ticket');
        const needsRefunds = requested.has('refunds');
        const needsPrior = requested.has('prior_net_sales');

        const scopeAndPeriod = {
          definitionVersion: DEFINITION_VERSION,
          scope: {
            merchantId,
            locationId,
            currency,
            timezone,
            attribution: { category: 'current' as const },
          },
          period: {
            range: query.range,
            start: window.start,
            end: window.end,
            bucket: window.bucket,
            comparison: { start: window.priorStart, end: window.priorEnd },
          },
          coverage: {
            sources: coverageSources(query.metrics),
            committedOnly: true as const,
            refundsIncluded: needsRefunds,
          },
          freshness: { capturedAt },
        };

        if (dimensions.length === 0) {
          const totals = await this.totalsValues(
            run,
            merchantId,
            locationId,
            timezone,
            capturedAt,
            window,
            query,
            needsSale,
            needsItems,
            needsRefunds,
            needsPrior,
          );
          return {
            statementCount,
            response: {
              ...scopeAndPeriod,
              truncated: totals.truncated,
              totals: { values: totals.values },
            },
          };
        }

        const limit = Math.min(query.limit ?? 100, dimensionRowCeiling(dimensions));
        const response = await this.rowsResponse(
          run,
          merchantId,
          locationId,
          timezone,
          capturedAt,
          window,
          query,
          needsSale,
          needsItems,
          needsRefunds,
          limit,
        );
        return {
          statementCount,
          response: { ...scopeAndPeriod, ...response },
        };
      },
      locationId,
    );
  }

  private async totalsValues(
    run: Query,
    merchantId: string,
    locationId: string | null,
    timezone: string,
    capturedAt: string,
    window: PeriodWindow,
    query: MetricsQueryInput,
    needsSale: boolean,
    needsItems: boolean,
    needsRefunds: boolean,
    needsPrior: boolean,
  ): Promise<{ values: Record<string, MetricsValue>; truncated: boolean }> {
    const saleRows = needsSale
      ? await run<SaleGroup>(
          `SELECT coalesce(sum(r.grand_total),0)::bigint AS net, count(*)::bigint AS orders,
                  coalesce(sum((r.snapshot->'discountTotal'->>'minorUnits')::bigint),0)::bigint AS discount,
                  coalesce(sum((r.snapshot->'tip'->>'minorUnits')::bigint),0)::bigint AS tips
           ${baseFrom} WHERE ${rangeWhere}`,
          [merchantId, window.start, window.end, locationId],
        )
      : [];
    const itemRows = needsItems
      ? await run<ItemGroup>(
          `SELECT coalesce(sum(cl.quantity),0)::bigint AS units
           ${baseFrom}
           JOIN merchant.pos_cart_line cl ON cl.cart_id=s.cart_id
           WHERE ${rangeWhere}`,
          [merchantId, window.start, window.end, locationId],
        )
      : [];
    const priorRows = needsPrior
      ? await run<SaleGroup>(
          `SELECT coalesce(sum(r.grand_total),0)::bigint AS net, 0::bigint AS orders,
                  0::bigint AS discount, 0::bigint AS tips
           ${baseFrom} WHERE ${rangeWhere}`,
          [merchantId, window.priorStart, window.priorEnd, locationId],
        )
      : [];
    const refundRows = needsRefunds
      ? await run<RefundGroup>(
          `SELECT coalesce(sum(x.total_minor_units - x.tip_minor_units),0)::bigint AS refund
           FROM merchant.pos_sale_exception x
           JOIN merchant.pos_committed_sale s ON s.id=x.sale_id
           JOIN merchant.receipt_snapshot r ON r.id=s.receipt_snapshot_id
           WHERE x.status='committed' AND ${rangeWhere} AND x.committed_at <= $5::timestamptz`,
          [merchantId, window.start, window.end, locationId, capturedAt],
        )
      : [];

    const net = number(saleRows[0]?.net);
    const orders = number(saleRows[0]?.orders);
    const items = number(itemRows[0]?.units);
    const prior = number(priorRows[0]?.net);
    const refunds = number(refundRows[0]?.refund);

    const values: Record<string, MetricsValue> = {};
    let truncated = false;

    for (const id of query.metrics) {
      if (id === 'net_sales') values[id] = net;
      else if (id === 'orders') values[id] = orders;
      else if (id === 'average_ticket') values[id] = averageTicket(net, orders);
      else if (id === 'items_sold') values[id] = items;
      else if (id === 'units_per_ticket') values[id] = unitsPerTicket(orders, items);
      else if (id === 'discounts') values[id] = number(saleRows[0]?.discount);
      else if (id === 'tips') values[id] = number(saleRows[0]?.tips);
      else if (id === 'prior_net_sales') values[id] = prior;
      else if (id === 'refunds') values[id] = refunds;
      else {
        const distribution = await this.distribution(
          run,
          id,
          merchantId,
          locationId,
          timezone,
          window,
        );
        values[id] = distribution.value;
        if (distribution.truncated) truncated = true;
      }
    }
    return { values, truncated };
  }

  private async rowsResponse(
    run: Query,
    merchantId: string,
    locationId: string | null,
    timezone: string,
    capturedAt: string,
    window: PeriodWindow,
    query: MetricsQueryInput,
    needsSale: boolean,
    needsItems: boolean,
    needsRefunds: boolean,
    limit: number,
  ): Promise<
    Omit<MetricsResponse, 'definitionVersion' | 'scope' | 'period' | 'coverage' | 'freshness'>
  > {
    const dimensions = query.dimensions;
    const usesHour = dimensions.includes('hour');
    // The union is cut once, after the families merge. Each family therefore
    // returns every group in the window, and the row limit applies to the
    // distinct dimension tuples, not to each family separately.
    const groupedParams = usesHour
      ? [merchantId, window.start, window.end, locationId, timezone]
      : [merchantId, window.start, window.end, locationId];

    const saleRows = needsSale
      ? await run<SaleGroup>(this.groupedSaleSql(dimensions), groupedParams)
      : [];
    const itemRows = needsItems
      ? await run<ItemGroup>(this.groupedItemsSql(dimensions), groupedParams)
      : [];
    const refundRows = needsRefunds
      ? await run<RefundGroup>(
          this.groupedRefundsSql(dimensions),
          usesHour
            ? [merchantId, window.start, window.end, locationId, timezone, capturedAt]
            : [merchantId, window.start, window.end, locationId, capturedAt],
        )
      : [];

    interface Accumulator {
      keys: (string | null)[];
      values: Record<string, number | null>;
    }
    const tuples = new Map<string, Accumulator>();
    const ensure = (row: { k0?: string | null; k1?: string | null }): Accumulator => {
      const keys = [row.k0 ?? null, row.k1 ?? null].slice(0, dimensions.length);
      const key = JSON.stringify(keys);
      let found = tuples.get(key);
      if (!found) {
        found = { keys, values: {} };
        tuples.set(key, found);
      }
      return found;
    };

    for (const row of saleRows) {
      const entry = ensure(row);
      entry.values.net_sales = number(row.net);
      entry.values.orders = number(row.orders);
      entry.values.discounts = number(row.discount);
      entry.values.tips = number(row.tips);
    }
    for (const row of itemRows) {
      ensure(row).values.items_sold = number(row.units);
    }
    for (const row of refundRows) {
      ensure(row).values.refunds = number(row.refund);
    }

    const rows = [...tuples.values()]
      .sort((left, right) => compareTuples(left.keys, right.keys))
      .map((entry) => {
        const dimensionsValue: Record<string, string> = {};
        dimensions.forEach((dimension, index) => {
          dimensionsValue[dimension] = entry.keys[index] ?? '—';
        });
        const values: Record<string, MetricsValue> = {};
        for (const id of query.metrics) {
          if (id === 'net_sales') values[id] = entry.values.net_sales ?? 0;
          else if (id === 'orders') values[id] = entry.values.orders ?? 0;
          else if (id === 'average_ticket')
            values[id] = averageTicket(entry.values.net_sales ?? 0, entry.values.orders ?? 0);
          else if (id === 'items_sold') values[id] = entry.values.items_sold ?? 0;
          else if (id === 'units_per_ticket')
            values[id] = unitsPerTicket(entry.values.orders ?? 0, entry.values.items_sold ?? 0);
          else if (id === 'discounts') values[id] = entry.values.discounts ?? 0;
          else if (id === 'tips') values[id] = entry.values.tips ?? 0;
          else if (id === 'refunds') values[id] = entry.values.refunds ?? 0;
          // prior_net_sales and the presets accept no dimension, so the request
          // validator refuses them here before a query runs.
        }
        return { dimensions: dimensionsValue, values };
      });

    const rowsTotal = rows.length;
    const truncated = rowsTotal > limit;
    return {
      truncated,
      ...(truncated ? { rowsTotal } : {}),
      rows: truncated ? rows.slice(0, limit) : rows,
    };
  }

  private groupedSaleSql(dimensions: readonly MetricsDimension[]): string {
    const needsOperator = dimensions.includes('operator');
    const select = `${dimensions
      .map((dimension, index) => `${DIMENSION_SQL[dimension]} AS k${index}`)
      .join(', ')}, `;
    const group = `GROUP BY ${dimensions.map((_, index) => `k${index}`).join(', ')}
       ORDER BY ${dimensions.map((_, index) => `k${index}`).join(', ')}`;
    return `SELECT ${select}coalesce(sum(r.grand_total),0)::bigint AS net, count(*)::bigint AS orders,
              coalesce(sum((r.snapshot->'discountTotal'->>'minorUnits')::bigint),0)::bigint AS discount,
              coalesce(sum((r.snapshot->'tip'->>'minorUnits')::bigint),0)::bigint AS tips
       ${baseFrom}
       ${needsOperator ? operatorJoin : ''}
       WHERE ${rangeWhere}
       ${group}`;
  }

  private groupedItemsSql(dimensions: readonly MetricsDimension[]): string {
    const needsOperator = dimensions.includes('operator');
    const needsCategory = dimensions.includes('category');
    const select = dimensions
      .map((dimension, index) => `${DIMENSION_SQL[dimension]} AS k${index}`)
      .join(', ');
    const group = `GROUP BY ${dimensions.map((_, index) => `k${index}`).join(', ')}
       ORDER BY ${dimensions.map((_, index) => `k${index}`).join(', ')}`;
    return `SELECT ${select}, coalesce(sum(cl.quantity),0)::bigint AS units
       ${baseFrom}
       JOIN merchant.pos_cart_line cl ON cl.cart_id=s.cart_id
       ${needsCategory ? 'LEFT JOIN merchant.product p ON p.id=cl.product_id LEFT JOIN merchant.product_category pc ON pc.id=p.category_id' : ''}
       ${needsOperator ? operatorJoin : ''}
       WHERE ${rangeWhere}
       ${group}`;
  }

  private groupedRefundsSql(dimensions: readonly MetricsDimension[]): string {
    const needsOperator = dimensions.includes('operator');
    const select = dimensions
      .map((dimension, index) => `${DIMENSION_SQL[dimension]} AS k${index}`)
      .join(', ');
    const usesHour = dimensions.includes('hour');
    const capturedAtParam = usesHour ? '$6' : '$5';
    const group = `GROUP BY ${dimensions.map((_, index) => `k${index}`).join(', ')}
       ORDER BY ${dimensions.map((_, index) => `k${index}`).join(', ')}`;
    return `SELECT ${select}, coalesce(sum(x.total_minor_units - x.tip_minor_units),0)::bigint AS refund
       FROM merchant.pos_sale_exception x
       JOIN merchant.pos_committed_sale s ON s.id=x.sale_id
       JOIN merchant.receipt_snapshot r ON r.id=s.receipt_snapshot_id
       ${needsOperator ? operatorJoin : ''}
       WHERE x.status='committed' AND ${rangeWhere} AND x.committed_at <= ${capturedAtParam}::timestamptz
       ${group}`;
  }

  private async distribution(
    run: Query,
    id: MetricsId,
    merchantId: string,
    locationId: string | null,
    timezone: string,
    window: PeriodWindow,
  ): Promise<{ value: MetricsValue; truncated: boolean }> {
    if (id === 'payment_mix') {
      const rows = await run<PaymentRow>(
        `WITH payment AS (
           SELECT tf.tender_type AS method, coalesce(sum(tf.amount_minor_units),0)::bigint AS amount
           ${baseFrom}
           JOIN merchant.pos_tender_fact tf ON tf.cart_id=s.cart_id AND tf.status='committed'
           WHERE ${rangeWhere}
           GROUP BY tf.tender_type
           UNION ALL
           SELECT cva.tender_type AS method, coalesce(sum(cva.committed_minor_units),0)::bigint AS amount
           ${baseFrom}
           JOIN merchant.customer_value_tender_allocation cva ON cva.sale_id=s.id
           WHERE ${rangeWhere}
           GROUP BY cva.tender_type
         )
         SELECT method, amount, count(*) OVER ()::bigint AS "totalItems",
                coalesce(sum(amount) OVER (),0)::bigint AS "totalAmount"
         FROM payment ORDER BY amount DESC, method ASC LIMIT $5`,
        [merchantId, window.start, window.end, locationId, PRESET_LIMIT.payment_mix],
      );
      const items = rows.map((row) => ({
        method: row.method,
        amountMinorUnits: number(row.amount),
      }));
      return distributionResult(
        items,
        { amountMinorUnits: number(rows[0]?.totalAmount) },
        Number(rows[0]?.totalItems ?? 0),
        PRESET_LIMIT.payment_mix,
      );
    }

    if (id === 'channel_mix') {
      const rows = await run<GroupRow>(
        `SELECT coalesce(s.origin_channel,'walk_in') AS key,
                coalesce(sum(r.grand_total),0)::bigint AS amount, count(*)::bigint AS orders,
                count(*) OVER ()::bigint AS "totalItems",
                coalesce(sum(sum(r.grand_total)) OVER (),0)::bigint AS "totalAmount",
                coalesce(sum(count(*)) OVER (),0)::bigint AS "totalOrders"
         ${baseFrom} WHERE ${rangeWhere}
         GROUP BY 1 ORDER BY amount DESC, key ASC LIMIT $5`,
        [merchantId, window.start, window.end, locationId, PRESET_LIMIT.channel_mix],
      );
      const items = rows.map((row) => ({
        channel: row.key,
        netSalesMinorUnits: number(row.amount),
        orders: number(row.orders),
      }));
      return distributionResult(
        items,
        {
          netSalesMinorUnits: number(rows[0]?.totalAmount),
          orders: number(rows[0]?.totalOrders),
        },
        Number(rows[0]?.totalItems ?? 0),
        PRESET_LIMIT.channel_mix,
      );
    }

    if (id === 'product_mix') {
      const rows = await run<GroupRow>(
        `SELECT cl.product_id::text AS "productId", min(cl.product_name) AS "productName",
                min(pc.name) AS category, sum(cl.quantity)::bigint AS units,
                sum(cl.quantity*(cl.base_price+cl.variant_delta+cl.modifier_total))::bigint AS amount,
                count(*) OVER ()::bigint AS "totalItems",
                coalesce(sum(sum(cl.quantity)) OVER (),0)::bigint AS "totalUnits",
                coalesce(sum(sum(cl.quantity*(cl.base_price+cl.variant_delta+cl.modifier_total))) OVER (),0)::bigint AS "totalAmount"
         ${baseFrom}
         JOIN merchant.pos_cart_line cl ON cl.cart_id=s.cart_id
         LEFT JOIN merchant.product p ON p.id=cl.product_id
         LEFT JOIN merchant.product_category pc ON pc.id=p.category_id
         WHERE ${rangeWhere}
         GROUP BY cl.product_id
         ORDER BY amount DESC, cl.product_id::text ASC NULLS LAST
         LIMIT $5`,
        [merchantId, window.start, window.end, locationId, PRESET_LIMIT.product_mix],
      );
      const items = rows.map((row) => ({
        productId: row.productId ?? null,
        productName: row.productName ?? '—',
        category: row.category ?? null,
        units: number(row.units),
        merchandiseMinorUnits: number(row.amount),
      }));
      return distributionResult(
        items,
        {
          units: number(rows[0]?.totalUnits),
          merchandiseMinorUnits: number(rows[0]?.totalAmount),
        },
        Number(rows[0]?.totalItems ?? 0),
        PRESET_LIMIT.product_mix,
      );
    }

    if (id === 'operator_mix') {
      const rows = await run<GroupRow>(
        `SELECT coalesce(st.name,'—') AS key, sum(cl.quantity)::bigint AS units,
                sum(cl.quantity*(cl.base_price+cl.variant_delta+cl.modifier_total))::bigint AS amount,
                count(*) OVER ()::bigint AS "totalItems",
                coalesce(sum(sum(cl.quantity)) OVER (),0)::bigint AS "totalUnits",
                coalesce(sum(sum(cl.quantity*(cl.base_price+cl.variant_delta+cl.modifier_total))) OVER (),0)::bigint AS "totalAmount"
         ${baseFrom}
         JOIN merchant.pos_cart_line cl ON cl.cart_id=s.cart_id
         ${operatorJoin}
         WHERE ${rangeWhere}
         GROUP BY 1 ORDER BY amount DESC, key ASC LIMIT $5`,
        [merchantId, window.start, window.end, locationId, PRESET_LIMIT.operator_mix],
      );
      const items = rows.map((row) => ({
        operator: row.key,
        units: number(row.units),
        merchandiseMinorUnits: number(row.amount),
      }));
      return distributionResult(
        items,
        {
          units: number(rows[0]?.totalUnits),
          merchandiseMinorUnits: number(rows[0]?.totalAmount),
        },
        Number(rows[0]?.totalItems ?? 0),
        PRESET_LIMIT.operator_mix,
      );
    }

    if (id === 'hour_mix') {
      const rows = await run<GroupRow>(
        `SELECT to_char((s.committed_at AT TIME ZONE $5), 'HH24') AS key,
                sum(cl.quantity)::bigint AS units,
                sum(cl.quantity*(cl.base_price+cl.variant_delta+cl.modifier_total))::bigint AS amount,
                count(*) OVER ()::bigint AS "totalItems",
                coalesce(sum(sum(cl.quantity)) OVER (),0)::bigint AS "totalUnits",
                coalesce(sum(sum(cl.quantity*(cl.base_price+cl.variant_delta+cl.modifier_total))) OVER (),0)::bigint AS "totalAmount"
         ${baseFrom}
         JOIN merchant.pos_cart_line cl ON cl.cart_id=s.cart_id
         WHERE ${rangeWhere}
         GROUP BY 1 ORDER BY key ASC LIMIT $6`,
        [merchantId, window.start, window.end, locationId, timezone, PRESET_LIMIT.hour_mix],
      );
      const items = rows.map((row) => ({
        hour: row.key,
        units: number(row.units),
        merchandiseMinorUnits: number(row.amount),
      }));
      return distributionResult(
        items,
        {
          units: number(rows[0]?.totalUnits),
          merchandiseMinorUnits: number(rows[0]?.totalAmount),
        },
        Number(rows[0]?.totalItems ?? 0),
        PRESET_LIMIT.hour_mix,
      );
    }

    const hourly = window.bucket === 'hour';
    const limit = hourly ? 24 : 31;
    const rows = await run<GroupRow>(
      hourly
        ? `SELECT to_char((s.committed_at AT TIME ZONE $5), 'HH24') AS label,
                  coalesce(sum(r.grand_total),0)::bigint AS amount,
                  count(*) OVER ()::bigint AS "totalItems",
                  coalesce(sum(sum(r.grand_total)) OVER (),0)::bigint AS "totalAmount"
           ${baseFrom} WHERE ${rangeWhere}
           GROUP BY 1 ORDER BY 1 ASC LIMIT $6`
        : `SELECT r.business_date::text AS label, coalesce(sum(r.grand_total),0)::bigint AS amount,
                  count(*) OVER ()::bigint AS "totalItems",
                  coalesce(sum(sum(r.grand_total)) OVER (),0)::bigint AS "totalAmount"
           ${baseFrom} WHERE ${rangeWhere}
           GROUP BY 1 ORDER BY 1 ASC LIMIT $5`,
      hourly
        ? [merchantId, window.start, window.end, locationId, timezone, limit]
        : [merchantId, window.start, window.end, locationId, limit],
    );
    const items = rows.map((row) => ({
      label: row.label ?? row.key,
      netSalesMinorUnits: number(row.amount),
    }));
    return distributionResult(
      items,
      { netSalesMinorUnits: number(rows[0]?.totalAmount) },
      Number(rows[0]?.totalItems ?? 0),
      limit,
    );
  }
}

function distributionResult(
  items: unknown[],
  total: Record<string, number>,
  totalItems: number,
  limit: number,
): { value: MetricsValue; truncated: boolean } {
  const truncated = totalItems > items.length;
  return {
    value: { items, truncated, limit, totalItems, total } as unknown as MetricsValue,
    truncated,
  };
}

function compareTuples(left: (string | null)[], right: (string | null)[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? '';
    const b = right[index] ?? '';
    const order = a.localeCompare(b, 'en');
    if (order !== 0) return order;
  }
  return 0;
}
