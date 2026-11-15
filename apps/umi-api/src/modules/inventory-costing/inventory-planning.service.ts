import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { Injectable } from '@nestjs/common';
import type { InventoryPlan, InventoryPlanQuery } from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import type { MerchantAccess } from '../auth/auth.types';
import { resolveLocationAuthority } from '../auth/location-authority';
import { InventoryCostingRepository } from './inventory-costing.repository';
import { InventoryCostingService } from './inventory-costing.service';
import {
  add,
  ceil,
  holdout,
  predictPeriod,
  purchaseHorizon,
  shiftDate,
  type Fraction,
  netRequirements,
} from './inventory-planning-domain';
import { toSafeNumber, quantityCostMinor } from './inventory-costing-domain';

@Injectable()
export class InventoryPlanningService {
  constructor(
    private readonly pg: PgService,
    private readonly repo: InventoryCostingRepository,
    private readonly costing: InventoryCostingService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async plan(access: MerchantAccess, query: InventoryPlanQuery): Promise<InventoryPlan> {
    const merchantId = access.merchantId;
    const locationId = resolveLocationAuthority(access, query.locationId);
    const context = await this.pg.runWithMerchant(
      merchantId,
      null,
      async (client) => {
        const result = await client.query<{
          today: string;
          timezone: string;
          purchaseDays: number[];
          emailOptIn: boolean;
        }>(
          `SELECT ((now() AT TIME ZONE timezone) - business_day_start::interval)::date::text AS today, timezone, purchase_days AS "purchaseDays", inventory_planning_email_enabled AS "emailOptIn" FROM merchant.merchant WHERE id=$1::uuid`,
          [merchantId],
        );
        return result.rows[0];
      },
      locationId,
    );
    if (!context) throw new Error('Merchant not found');
    const dates = purchaseHorizon(context.today, context.purchaseDays);
    const from = shiftDate(context.today, -63);
    const to = shiftDate(context.today, -1);
    const [read, plates, costs, items] = await Promise.all([
      this.pg.runWithMerchant(
        merchantId,
        null,
        async (client) => {
          const sales = await client.query<{
            productId: string;
            variantId: string | null;
            day: string;
            quantity: string;
            trainingQuantity: string;
            firstDay: string;
          }>(
            `
          WITH lines AS (
            SELECT l.product_id, l.variant_id, r.business_date,
              greatest(0, l.quantity - coalesce((SELECT sum(xl.compensated_quantity)
                FROM merchant.pos_sale_exception x JOIN merchant.pos_sale_exception_line xl ON xl.exception_id=x.id AND xl.merchant_id=x.merchant_id
                WHERE x.merchant_id=s.merchant_id AND x.sale_id=s.id AND x.status='committed' AND xl.sale_line_id=l.id AND x.business_date <= $4::date),0)) AS quantity,
              CASE WHEN s.committed_at >= (($5::date + m.business_day_start) AT TIME ZONE m.timezone) THEN 0 ELSE greatest(0,l.quantity - coalesce((SELECT sum(xl.compensated_quantity)
                FROM merchant.pos_sale_exception x JOIN merchant.pos_sale_exception_line xl ON xl.exception_id=x.id AND xl.merchant_id=x.merchant_id
                WHERE x.merchant_id=s.merchant_id AND x.sale_id=s.id AND x.status='committed' AND xl.sale_line_id=l.id AND x.business_date < $5::date AND x.committed_at < (($5::date + m.business_day_start) AT TIME ZONE m.timezone)),0)) END AS training_quantity
            FROM merchant.pos_committed_sale s
            JOIN merchant.merchant m ON m.id=s.merchant_id
            JOIN merchant.pos_cart_line l ON l.cart_id=s.cart_id AND l.merchant_id=s.merchant_id
            JOIN merchant.receipt_snapshot r ON r.id=s.receipt_snapshot_id AND r.merchant_id=s.merchant_id
            WHERE s.merchant_id=$1::uuid AND ($2::uuid IS NULL OR s.location_id=$2::uuid) AND r.business_date <= $4::date
          ), first_seen AS (SELECT product_id, variant_id, min(business_date) AS first_day FROM lines GROUP BY 1,2)
          SELECT l.product_id::text AS "productId", l.variant_id::text AS "variantId", l.business_date::text AS day,
            sum(l.quantity)::text AS quantity, sum(l.training_quantity)::text AS "trainingQuantity", f.first_day::text AS "firstDay"
          FROM lines l JOIN first_seen f ON f.product_id=l.product_id AND f.variant_id IS NOT DISTINCT FROM l.variant_id
          WHERE l.business_date BETWEEN $3::date AND $4::date GROUP BY 1,2,3,f.first_day`,
            [merchantId, locationId, from, to, shiftDate(context.today, -7)],
          );
          const balances = await client.query<{ itemId: string; available: string }>(
            `SELECT inventory_item_id::text AS "itemId", sum(available)::text AS available FROM merchant.stock_balance WHERE merchant_id=$1::uuid AND ($2::uuid IS NULL OR location_id=$2::uuid) GROUP BY 1`,
            [merchantId, locationId],
          );
          // Immediate recipe components, not cost leaves: existing preparations cover demand first.
          const edges = await client.query<{
            mappingId: string | null;
            parentId: string | null;
            itemId: string;
            numerator: string;
            denominator: string;
          }>(
            `
          WITH recipe_sources AS (
            SELECT m.id AS mapping_id, NULL::uuid AS parent_id, r.id AS recipe_id, 0 AS parent_scale
              FROM merchant.inventory_catalog_mapping m JOIN merchant.inventory_recipe r ON r.id=m.recipe_id AND r.merchant_id=m.merchant_id AND r.active
              WHERE m.merchant_id=$1::uuid AND m.active AND m.mapping_type IN ('recipe','bundle')
            UNION ALL
            SELECT NULL::uuid,r.target_item_id,r.id,i.quantity_scale FROM merchant.inventory_recipe r
              JOIN merchant.inventory_item i ON i.id=r.target_item_id AND i.merchant_id=r.merchant_id
              WHERE r.merchant_id=$1::uuid AND r.active AND i.active AND i.tracking_policy <> 'not_tracked'
          )
          SELECT s.mapping_id::text AS "mappingId",s.parent_id::text AS "parentId",c.inventory_item_id::text AS "itemId",
            trunc(c.quantity::numeric*c.conversion_numerator*power(10::numeric,r.yield_scale)*power(10::numeric,i.quantity_scale))::text AS numerator,
            trunc(r.yield_quantity::numeric*c.conversion_denominator*power(10::numeric,c.quantity_scale)*power(10::numeric,s.parent_scale))::text AS denominator
          FROM recipe_sources s JOIN merchant.inventory_recipe r ON r.id=s.recipe_id AND r.merchant_id=$1::uuid
            JOIN merchant.inventory_recipe_component c ON c.recipe_id=r.id AND c.merchant_id=r.merchant_id AND c.modifier_id IS NULL
            JOIN merchant.inventory_item i ON i.id=c.inventory_item_id AND i.merchant_id=c.merchant_id
          UNION ALL
          SELECT m.id::text,NULL::text,m.inventory_item_id::text,m.conversion_numerator::text,m.conversion_denominator::text
            FROM merchant.inventory_catalog_mapping m WHERE m.merchant_id=$1::uuid AND m.active AND m.mapping_type='direct'`,
            [merchantId],
          );
          const metadata = await client.query<{
            itemId: string;
            tracked: boolean;
            hasRecipe: boolean;
          }>(
            `SELECT i.id::text AS "itemId",i.tracking_policy <> 'not_tracked' AS tracked, EXISTS(SELECT 1 FROM merchant.inventory_recipe r WHERE r.merchant_id=i.merchant_id AND r.target_item_id=i.id AND r.active) AS "hasRecipe" FROM merchant.inventory_item i WHERE i.merchant_id=$1::uuid AND i.active`,
            [merchantId],
          );
          const deliveries = await client.query<{
            day: string;
            state: 'sending' | 'sent' | 'unknown';
          }>(
            `SELECT business_date::text AS day,state FROM merchant.inventory_planning_delivery WHERE merchant_id=$1::uuid AND business_date >= $2::date ORDER BY created_at DESC LIMIT 20`,
            [merchantId, shiftDate(context.today, -7)],
          );
          return {
            sales: sales.rows,
            balances: balances.rows,
            deliveries: deliveries.rows,
            edges: edges.rows,
            metadata: metadata.rows,
          };
        },
        locationId,
      ),
      this.repo.readPlates(merchantId, { productId: null, variantId: null, includeUnmapped: true }),
      this.costing.costBasis(access, { includeWithoutReceipts: true }),
      this.repo.items(merchantId),
    ]);
    const warnings = new Set<string>();
    if (!dates.length) warnings.add('purchase_days_not_configured');
    const groups = new Map<
      string,
      {
        productId: string;
        variantId: string | null;
        firstDay: string | null;
        history: Map<string, bigint>;
        training: Map<string, bigint>;
      }
    >();
    const key = (product: string, variant: string | null) => `${product}:${variant ?? ''}`;
    for (const mapping of plates.mappings)
      if (mapping.productActive)
        groups.set(key(mapping.productId, mapping.variantId), {
          productId: mapping.productId,
          variantId: mapping.variantId,
          firstDay: null,
          history: new Map(),
          training: new Map(),
        });
    for (const row of read.sales) {
      if (
        !plates.mappings.some(
          (mapping) => mapping.productId === row.productId && mapping.productActive,
        )
      )
        continue;
      const id = key(row.productId, row.variantId);
      if (!groups.has(id))
        groups.set(id, {
          productId: row.productId,
          variantId: row.variantId,
          firstDay: row.firstDay,
          history: new Map(),
          training: new Map(),
        });
      const group = groups.get(id)!;
      group.firstDay = row.firstDay;
      group.history.set(row.day, BigInt(row.quantity));
      group.training.set(row.day, BigInt(row.trainingQuantity));
    }
    const demands = new Map<string, Fraction>();
    let complete = dates.length > 0;
    const products: InventoryPlan['products'] = [];
    for (const group of groups.values()) {
      if (
        group.variantId === null &&
        !group.firstDay &&
        [...groups.values()].some(
          (other) =>
            other.productId === group.productId && other.variantId !== null && other.firstDay,
        )
      )
        continue;
      const mapping =
        plates.mappings.find(
          (m) => m.productId === group.productId && m.variantId === group.variantId,
        ) ?? plates.mappings.find((m) => m.productId === group.productId && m.variantId === null);
      if (mapping && !mapping.productActive) continue;
      const estimate = predictPeriod(group.history, group.firstDay, dates, context.today);
      const components = read.edges.filter((c) => c.mappingId === mapping?.mappingId);
      const mapped =
        Boolean(mapping?.mappingId) &&
        (mapping?.mappingType === 'non_stock' ||
          (components.length > 0 &&
            components.every(
              (c) =>
                BigInt(c.denominator) > 0n &&
                read.metadata.some((item) => item.itemId === c.itemId),
            )));
      if (!estimate) {
        complete = false;
        warnings.add('insufficient_sales_history');
      }
      if (!mapped) {
        complete = false;
        warnings.add('incomplete_recipes');
      }
      if (estimate && mapped)
        for (const component of components) {
          if (!read.metadata.find((item) => item.itemId === component.itemId)?.tracked) continue;
          const term = {
            n: estimate.n * BigInt(component.numerator),
            d: estimate.d * BigInt(component.denominator),
          };
          demands.set(
            component.itemId,
            add(demands.get(component.itemId) ?? { n: 0n, d: 1n }, term),
          );
        }
      products.push({
        productId: group.productId,
        variantId: group.variantId,
        name: `${mapping?.productName ?? 'Producto'}${mapping?.variantName ? ' · ' + mapping.variantName : ''}`,
        expectedUnits: estimate ? toSafeNumber(ceil(estimate)) : null,
        historyFrom: group.firstDay,
        mapped,
        validation: holdout(group.history, group.firstDay, context.today, group.training),
      });
    }
    if (!products.length) {
      complete = false;
      warnings.add('insufficient_sales_history');
    }
    const balances = new Map(read.balances.map((b) => [b.itemId, BigInt(b.available)]));
    const costMap = new Map(costs.items.map((c) => [c.inventoryItemId, c.unitCostMinor]));
    const trackedItems = items.filter(
      (i) => i.active && read.metadata.find((m) => m.itemId === i.inventoryItemId)?.tracked,
    );
    const requirements = netRequirements(
      demands,
      new Map(
        trackedItems.map((item) => [
          item.inventoryItemId,
          {
            available: balances.get(item.inventoryItemId) ?? 0n,
            minimum: BigInt(item.lowStockThreshold ?? '0'),
            ...(read.metadata.find((m) => m.itemId === item.inventoryItemId)?.hasRecipe
              ? {
                  components: read.edges
                    .filter(
                      (edge) =>
                        edge.parentId === item.inventoryItemId &&
                        read.metadata.find((m) => m.itemId === edge.itemId)?.tracked !== false,
                    )
                    .map((edge) => ({
                      itemId: edge.itemId,
                      quantity: { n: BigInt(edge.numerator), d: BigInt(edge.denominator) },
                    })),
                }
              : {}),
          },
        ]),
      ),
    );
    if (!requirements) {
      complete = false;
      warnings.add('incomplete_recipes');
    }
    const plannedItems: InventoryPlan['items'] = trackedItems.map((item) => {
      const available = balances.get(item.inventoryItemId) ?? 0n;
      const requirement = requirements?.get(item.inventoryItemId);
      const consumption = requirement?.consumption ?? 0n;
      const minimum = BigInt(item.lowStockThreshold ?? '0');
      const suggested = requirement?.suggested ?? 0n;
      const cost = costMap.get(item.inventoryItemId) ?? null;
      return {
        replenishment: read.metadata.find((m) => m.itemId === item.inventoryItemId)?.hasRecipe
          ? 'prepare'
          : 'purchase',
        inventoryItemId: item.inventoryItemId,
        name: item.displayName,
        unit: item.baseUnit,
        scale: item.quantityScale,
        available: toSafeNumber(available),
        minimum: item.lowStockThreshold === null ? null : toSafeNumber(minimum),
        expectedConsumption: complete ? toSafeNumber(consumption) : null,
        suggestedQuantity: complete ? toSafeNumber(suggested) : null,
        estimatedCostMinor:
          complete && !requirement?.prepare && cost !== null
            ? toSafeNumber(
                quantityCostMinor({ value: suggested, scale: item.quantityScale }, BigInt(cost)),
              )
            : null,
      };
    });
    return {
      notifications: {
        emailOptIn: context.emailOptIn,
        configured: Boolean(
          this.config.get('INVENTORY_PLANNING_EMAIL_ENABLED', { infer: true }) &&
          this.config.get('SMTP_HOST', { infer: true }) &&
          this.config.get('EMAIL_FROM', { infer: true }),
        ),
        deliveries: read.deliveries,
      },
      merchantId,
      locationId,
      asOf: new Date().toISOString(),
      timezone: context.timezone,
      from: context.today,
      to: dates.at(-1) ?? null,
      nextPurchaseDate: dates.length ? shiftDate(context.today, dates.length) : null,
      historyFrom: shiftDate(context.today, -56),
      historyTo: to,
      complete,
      warnings: [...warnings],
      products,
      items: plannedItems,
    };
  }
}
