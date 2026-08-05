import { ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  AvailabilityResult,
  InventoryAdjustment,
  InventoryCountResult,
  InventoryMutationResult,
  InventoryOverview,
  InventoryHistoryResult,
  InventoryQuery,
  InventoryReconciliation,
  QuarantineRecord,
  RestockCommand,
  SubmitInventoryCountRequest,
  WasteRecord,
  DamageRecord,
  CreateInventoryCountRequest,
} from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import { commandFingerprint } from '../integrity/canonical-json';
import { inventoryOperationFingerprint } from './inventory-errors';

export interface InventoryAuthorization {
  operatorId: string;
  deviceId: string;
  credentialVersion: number;
  permissions: string[];
}

interface LedgerRow {
  id: string;
  merchantId: string;
  locationId: string;
  inventoryLocationId: string;
  inventoryItemId: string;
  sequence: string;
  entryType: string;
  quantity: string;
  quantityScale: number;
  unit: string;
  effectOnHand: string;
  effectReserved: string;
  effectCommitted: string;
  effectDamaged: string;
  effectQuarantine: string;
  effectWaste: string;
  effectInTransit: string;
  commandId: string;
  sourceType: string;
  sourceId: string;
  saleId: string | null;
  saleLineId: string | null;
  refundId: string | null;
  countId: string | null;
  operatorId: string;
  deviceId: string;
  credentialVersion: number;
  businessDate: string;
  correlationId: string;
  occurredAt: string;
}

const hasPermission = (authorization: InventoryAuthorization, permission: string) =>
  authorization.permissions.includes('*') || authorization.permissions.includes(permission);

@Injectable()
export class PosInventoryRepository {
  constructor(private readonly pg: PgService) {}

  authorize(
    userId: string,
    durableSessionId: string,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    deviceId: string,
    permission: string,
  ): Promise<InventoryAuthorization | null> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const { rows } = await client.query<InventoryAuthorization>(
          `SELECT os.user_id::text AS "operatorId",os.device_id::text AS "deviceId",
                  d.credential_version AS "credentialVersion",os.permissions
             FROM runtime.operator_session os
             JOIN merchant.device d ON d.id=os.device_id AND d.merchant_id=os.merchant_id
            WHERE os.id=$5::uuid AND os.durable_session_id=$2::uuid
              AND os.user_id=$1::uuid AND os.merchant_id=$3::uuid
              AND os.location_id=$4::uuid AND os.device_id=$6::uuid
              AND os.state='active' AND os.expires_at>clock_timestamp()
              AND d.status='active' AND d.credential_version>0
              AND ($7=ANY(os.permissions) OR '*'=ANY(os.permissions))
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(os.entitlements) e
                WHERE e->>'featureKey'='pos' AND coalesce((e->>'enabled')::boolean,false))`,
          [
            userId,
            durableSessionId,
            merchantId,
            locationId,
            operatorSessionId,
            deviceId,
            permission,
          ],
        );
        return rows[0] ?? null;
      },
      locationId,
    );
  }

  mutationApprovalRequirement(
    userId: string,
    merchantId: string,
    dto: InventoryAdjustment | WasteRecord | DamageRecord | QuarantineRecord,
  ): Promise<{ permission: string; fingerprint: string } | null> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        await this.assertCurrentPolicy(client, merchantId, dto);
        await this.assertBalanceVersion(client, merchantId, dto);
        const quantity = await this.normalizeQuantity(
          client,
          merchantId,
          dto.inventoryItemId,
          dto.quantity,
        );
        if (await this.requiresNegativeStockApproval(client, merchantId, dto, quantity.value)) {
          return {
            permission: 'inventory.negative_stock.override',
            fingerprint: this.operationFingerprint('pos.inventory.mutation', dto),
          };
        }
        const { rows } = await client.query<{
          adjustmentThreshold: string;
          wasteThreshold: string;
        }>(
          `SELECT adjustment_approval_threshold::text AS "adjustmentThreshold",
                  waste_approval_threshold::text AS "wasteThreshold"
             FROM merchant.inventory_policy
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid
              AND inventory_location_id=$3::uuid AND expires_at>clock_timestamp()`,
          [merchantId, dto.locationId, dto.inventoryLocationId],
        );
        if (!rows[0]) throw new ConflictException({ code: 'INVENTORY_POLICY_REQUIRED' });
        const threshold =
          'direction' in dto
            ? Number(rows[0].adjustmentThreshold)
            : 'reason' in dto && !('action' in dto) && !('disposition' in dto)
              ? Number(rows[0].wasteThreshold)
              : 0;
        if (quantity.value <= threshold) return null;
        return {
          permission: this.mutationApprovalPermission(dto),
          fingerprint: this.operationFingerprint('pos.inventory.mutation', dto),
        };
      },
      dto.locationId,
    );
  }

  countApprovalRequirement(
    userId: string,
    merchantId: string,
    dto: InventoryReconciliation,
  ): Promise<{ permission: string; fingerprint: string } | null> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        await this.assertCurrentPolicy(client, merchantId, dto);
        const result = await client.query<{
          requiresApproval: boolean;
          requiresNegativeOverride: boolean;
        }>(
          `SELECT coalesce(bool_or(l.absolute_variance>p.count_variance_tolerance),false)
                    AS "requiresApproval",
                  coalesce(bool_or(i.negative_stock_policy='manager_override'
                    AND coalesce(b.available,0)+l.signed_variance<0),false)
                    AS "requiresNegativeOverride"
             FROM merchant.inventory_count c
             JOIN merchant.inventory_count_line l ON l.count_id=c.id
             JOIN merchant.inventory_item i ON i.id=l.inventory_item_id
             JOIN merchant.inventory_policy p ON p.merchant_id=c.merchant_id
              AND p.location_id=c.location_id AND p.inventory_location_id=c.inventory_location_id
             LEFT JOIN merchant.stock_balance b ON b.inventory_location_id=c.inventory_location_id
              AND b.inventory_item_id=l.inventory_item_id
            WHERE c.id=$1::uuid AND c.merchant_id=$2::uuid AND c.location_id=$3::uuid
              AND c.attempt=$4 AND c.snapshot_ledger_sequence=$5
            GROUP BY p.count_variance_tolerance`,
          [dto.countId, merchantId, dto.locationId, dto.countAttempt, dto.snapshotLedgerSequence],
        );
        if (!result.rows[0]) throw new ConflictException({ code: 'STALE_INVENTORY_COUNT' });
        return result.rows[0].requiresNegativeOverride || result.rows[0].requiresApproval
          ? {
              permission: result.rows[0].requiresNegativeOverride
                ? 'inventory.negative_stock.override'
                : 'inventory.count.approve',
              fingerprint: this.operationFingerprint('pos.inventory.count.reconcile', dto),
            }
          : null;
      },
      dto.locationId,
    );
  }

  overview(userId: string, merchantId: string, query: InventoryQuery): Promise<InventoryOverview> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        await client.query(`SELECT merchant.expire_inventory_reservations($1::uuid,$2::uuid)`, [
          merchantId,
          query.locationId,
        ]);
        const policyResult = await client.query<{
          id: string;
          version: string;
          inventoryLocationId: string;
          trackingEnabled: boolean;
          defaultReservationRequired: boolean;
          defaultNegativeStockPolicy: string;
          adjustmentApprovalThreshold: string;
          wasteApprovalThreshold: string;
          countVarianceTolerance: string;
          blindCount: boolean;
          offlineMutationsAllowed: boolean;
          issuedAt: string;
          expiresAt: string;
          fingerprint: string;
        }>(
          `SELECT id::text,version,inventory_location_id::text AS "inventoryLocationId",
                  tracking_enabled AS "trackingEnabled",
                  default_reservation_required AS "defaultReservationRequired",
                  default_negative_stock_policy AS "defaultNegativeStockPolicy",
                  adjustment_approval_threshold::text AS "adjustmentApprovalThreshold",
                  waste_approval_threshold::text AS "wasteApprovalThreshold",
                  count_variance_tolerance::text AS "countVarianceTolerance",
                  blind_count AS "blindCount",offline_mutations_allowed AS "offlineMutationsAllowed",
                  issued_at::text AS "issuedAt",expires_at::text AS "expiresAt",fingerprint
             FROM merchant.inventory_policy
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid`,
          [merchantId, query.locationId],
        );
        const policy = policyResult.rows[0];
        if (!policy) throw new ConflictException({ code: 'INVENTORY_POLICY_REQUIRED' });
        const locations = await client.query<{
          id: string;
          merchantId: string;
          locationId: string;
          publicReference: string;
          displayName: string;
          type: string;
          active: boolean;
          saleFulfillmentEligible: boolean;
          reservationEligible: boolean;
          countEligible: boolean;
          version: number;
          createdAt: string;
          archivedAt: string | null;
        }>(
          `SELECT id::text,merchant_id::text AS "merchantId",location_id::text AS "locationId",
                  public_reference AS "publicReference",display_name AS "displayName",
                  location_type AS type,active,sale_fulfillment_eligible AS "saleFulfillmentEligible",
                  reservation_eligible AS "reservationEligible",count_eligible AS "countEligible",
                  version,created_at::text AS "createdAt",archived_at::text AS "archivedAt"
             FROM merchant.inventory_location
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid
              AND ($3::uuid IS NULL OR id=$3::uuid)
            ORDER BY public_reference LIMIT $4`,
          [merchantId, query.locationId, query.inventoryLocationId ?? null, query.limit],
        );
        const offset = query.cursor ? Number(query.cursor) : 0;
        if (!Number.isInteger(offset) || offset < 0) {
          throw new ConflictException({ code: 'INVENTORY_CURSOR_INVALID' });
        }
        const items = await client.query<{
          id: string;
          merchantId: string;
          publicReference: string;
          displayName: string;
          type: string;
          baseUnit: string;
          scale: number;
          active: boolean;
          trackingPolicy: string;
          negativeStockPolicy: string;
          reservationRequired: boolean;
          lowStockThreshold: string | null;
          version: number;
          createdAt: string;
          archivedAt: string | null;
        }>(
          `SELECT id::text,merchant_id::text AS "merchantId",public_reference AS "publicReference",
                  display_name AS "displayName",item_type AS type,base_unit AS "baseUnit",
                  quantity_scale AS scale,active,tracking_policy AS "trackingPolicy",
                  negative_stock_policy AS "negativeStockPolicy",
                  reservation_required AS "reservationRequired",
                  low_stock_threshold::text AS "lowStockThreshold",version,
                  created_at::text AS "createdAt",archived_at::text AS "archivedAt"
             FROM merchant.inventory_item
            WHERE merchant_id=$1::uuid AND ($2::uuid IS NULL OR id=$2::uuid)
            ORDER BY public_reference,id LIMIT $3 OFFSET $4`,
          [merchantId, query.itemId ?? null, query.limit + 1, offset],
        );
        const pageItems = items.rows.slice(0, query.limit);
        const hasMore = items.rows.length > query.limit;
        const balances = await this.balances(
          client,
          merchantId,
          query.locationId,
          query.inventoryLocationId ?? policy.inventoryLocationId,
          pageItems.map((item) => item.id),
        );
        const restockReviews = await client.query<{
          restockIntentId: string;
          exceptionId: string;
          saleLineId: string;
          decision: string;
          quantity: number;
          version: number;
          status: string;
          components: Array<{
            inventoryItemId: string;
            displayName: string;
            publicReference: string;
            maximum: { value: number; scale: number; unit: string };
            recipeEffect: boolean;
          }>;
        }>(
          `SELECT i.id::text AS "restockIntentId",x.exception_id::text AS "exceptionId",
                  i.sale_line_id::text AS "saleLineId",i.decision,i.quantity,i.version,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM merchant.inventory_restock_outcome review
                     WHERE review.restock_intent_id=i.id AND review.outcome='review_required'
                  ) THEN 'review_required' ELSE 'intent_only' END AS status,
                  coalesce(c.components,'[]'::jsonb) AS components
             FROM merchant.pos_restock_intent i
             JOIN merchant.pos_sale_exception_line x ON x.id=i.exception_line_id
             LEFT JOIN LATERAL (
               SELECT jsonb_agg(jsonb_build_object(
                 'inventoryItemId',source.inventory_item_id,
                 'displayName',source.display_name,
                 'publicReference',source.public_reference,
                 'maximum',jsonb_build_object('value',source.maximum,'scale',source.quantity_scale,
                   'unit',source.unit),
                 'recipeEffect',source.recipe_effect
               ) ORDER BY source.inventory_item_id) AS components
               FROM (
                 SELECT e.inventory_item_id::text,item.display_name,item.public_reference,
                        floor(sum(e.quantity)::numeric*i.quantity/x.original_quantity)::bigint AS maximum,
                        e.quantity_scale,e.unit,
                        bool_or(e.public_data ? 'recipeId' AND e.public_data->>'recipeId' IS NOT NULL)
                          AS recipe_effect
                   FROM merchant.stock_ledger_entry e
                   JOIN merchant.inventory_item item ON item.id=e.inventory_item_id
                    AND item.merchant_id=e.merchant_id
                  WHERE e.sale_line_id=i.sale_line_id AND e.entry_type='sale_committed'
                    AND e.merchant_id=i.merchant_id
                  GROUP BY e.inventory_item_id,item.display_name,item.public_reference,
                           e.quantity_scale,e.unit
               ) source
             ) c ON true
            WHERE i.merchant_id=$1::uuid AND i.location_id=$2::uuid
              AND i.inventory_status IN ('intent_only','review_required')
              AND NOT EXISTS (
                SELECT 1 FROM merchant.inventory_restock_outcome terminal
                 WHERE terminal.restock_intent_id=i.id AND terminal.outcome<>'review_required'
              )
            ORDER BY i.created_at,i.id LIMIT 100`,
          [merchantId, query.locationId],
        );
        const activeCountRow = await client.query<{ id: string }>(
          `SELECT id::text FROM merchant.inventory_count
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid
              AND inventory_location_id=$3::uuid AND operator_session_id=$4::uuid
              AND status IN ('draft','counting','submitted','variance_calculated',
                'reconciliation_required','approved')
            ORDER BY created_at DESC,id DESC LIMIT 1`,
          [merchantId, query.locationId, policy.inventoryLocationId, query.operatorSessionId],
        );
        const activeCount = activeCountRow.rows[0]
          ? await this.countResult(
              client,
              merchantId,
              query.locationId,
              activeCountRow.rows[0].id,
              'inventory-active-count',
            )
          : null;
        return {
          policy: {
            version: policy.version,
            merchantId,
            locationId: query.locationId,
            trackingEnabled: policy.trackingEnabled,
            defaultReservationRequired: policy.defaultReservationRequired,
            defaultNegativeStockPolicy: policy.defaultNegativeStockPolicy as never,
            adjustmentApprovalThreshold: {
              value: Number(policy.adjustmentApprovalThreshold),
              scale: 0,
              unit: 'unit',
            },
            wasteApprovalThreshold: {
              value: Number(policy.wasteApprovalThreshold),
              scale: 0,
              unit: 'unit',
            },
            countVarianceTolerance: {
              value: Number(policy.countVarianceTolerance),
              scale: 0,
              unit: 'unit',
            },
            blindCount: policy.blindCount,
            offlineMutationsAllowed: policy.offlineMutationsAllowed,
            issuedAt: policy.issuedAt,
            expiresAt: policy.expiresAt,
            fingerprint: policy.fingerprint,
          },
          locations: locations.rows as never,
          items: pageItems.map((row) => ({
            ...row,
            lowStockThreshold:
              row.lowStockThreshold === null
                ? null
                : { value: Number(row.lowStockThreshold), scale: row.scale, unit: row.baseUnit },
          })) as never,
          balances,
          restockReviews: restockReviews.rows as never,
          activeCount,
          page: {
            limit: query.limit,
            hasMore,
            nextCursor: hasMore ? String(offset + query.limit) : null,
          },
        };
      },
      query.locationId,
    );
  }

  availability(
    userId: string,
    merchantId: string,
    query: InventoryQuery & { catalogItemIds?: string },
    correlationId: string,
  ): Promise<AvailabilityResult> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const ids = (query.catalogItemIds ?? query.catalogItemId ?? '')
          .split(',')
          .filter(Boolean)
          .slice(0, 250);
        const { rows } = await client.query<{
          catalogItemId: string;
          variantId: string | null;
          inventoryLocationId: string | null;
          state: string;
          available: string | null;
          scale: number | null;
          unit: string | null;
          ledgerSequence: string;
          mappingVersion: number | null;
          recipeVersion: number | null;
          policyVersion: string;
          checkedAt: string;
        }>(
          `WITH mapped AS (
             SELECT m.* FROM merchant.inventory_catalog_mapping m
              WHERE m.merchant_id=$1::uuid AND m.active
                AND (cardinality($3::uuid[])=0 OR m.product_id=ANY($3::uuid[]))
              ORDER BY m.product_id,m.variant_id LIMIT 250
           ), consumption AS (
             SELECT m.id AS mapping_id,b.available AS raw_available,
                    floor(b.available::numeric*m.conversion_denominator/
                      m.conversion_numerator)::bigint AS catalog_available,
                    b.ledger_sequence,i.low_stock_threshold
               FROM mapped m
               JOIN merchant.inventory_item i ON i.id=m.inventory_item_id AND i.active
               LEFT JOIN merchant.stock_balance b ON b.inventory_item_id=i.id
                AND b.inventory_location_id=(SELECT inventory_location_id
                  FROM merchant.inventory_policy WHERE merchant_id=$1::uuid AND location_id=$2::uuid)
              WHERE m.mapping_type='direct'
             UNION ALL
             SELECT m.id,b.available,
                    floor(b.available::numeric*r.yield_quantity*rc.conversion_denominator*
                      power(10::numeric,rc.quantity_scale)/
                      (rc.quantity*rc.conversion_numerator*
                        power(10::numeric,r.yield_scale+i.quantity_scale)))::bigint,
                    b.ledger_sequence,i.low_stock_threshold
               FROM mapped m
               JOIN merchant.inventory_recipe r ON r.id=m.recipe_id AND r.active
               JOIN merchant.inventory_recipe_component rc ON rc.recipe_id=r.id
                AND rc.modifier_id IS NULL
               JOIN merchant.inventory_item i ON i.id=rc.inventory_item_id AND i.active
               LEFT JOIN merchant.stock_balance b ON b.inventory_item_id=i.id
                AND b.inventory_location_id=(SELECT inventory_location_id
                  FROM merchant.inventory_policy WHERE merchant_id=$1::uuid AND location_id=$2::uuid)
              WHERE m.mapping_type IN ('recipe','bundle')
           )
           SELECT m.product_id::text AS "catalogItemId",m.variant_id::text AS "variantId",
                  p.inventory_location_id::text AS "inventoryLocationId",
                  CASE WHEN m.mapping_type='non_stock' THEN 'available'
                    WHEN count(c.mapping_id)=0 OR bool_or(c.raw_available IS NULL) THEN 'unknown'
                    WHEN min(c.catalog_available)<=0 THEN 'unavailable'
                    WHEN bool_or(c.low_stock_threshold IS NOT NULL
                      AND c.raw_available<=c.low_stock_threshold) THEN 'low_stock'
                    ELSE 'available' END AS state,
                  CASE WHEN m.mapping_type='non_stock' THEN null
                    ELSE min(c.catalog_available)::text END AS available,
                  CASE WHEN m.mapping_type='non_stock' THEN null ELSE 0 END AS scale,
                  CASE WHEN m.mapping_type='non_stock' THEN null ELSE 'portion' END AS unit,
                  coalesce(max(c.ledger_sequence),0)::text AS "ledgerSequence",
                  m.version AS "mappingVersion",r.version AS "recipeVersion",
                  p.version AS "policyVersion",clock_timestamp()::text AS "checkedAt"
             FROM mapped m
             JOIN merchant.inventory_policy p ON p.merchant_id=m.merchant_id
              AND p.location_id=$2::uuid AND p.tracking_enabled
             LEFT JOIN merchant.inventory_recipe r ON r.id=m.recipe_id AND r.active
             LEFT JOIN consumption c ON c.mapping_id=m.id
            GROUP BY m.id,m.product_id,m.variant_id,m.mapping_type,m.version,
              p.inventory_location_id,p.version,r.version
            ORDER BY m.product_id,m.variant_id LIMIT 250`,
          [merchantId, query.locationId, ids],
        );
        const byCatalog = new Map<string, (typeof rows)[number]>();
        for (const row of rows) {
          const key = `${row.catalogItemId}:${row.variantId ?? ''}`;
          const prior = byCatalog.get(key);
          if (!prior || Number(row.available ?? -1) < Number(prior.available ?? -1)) {
            byCatalog.set(key, row);
          }
        }
        return {
          entries: [...byCatalog.values()].map((row) => ({
            catalogItemId: row.catalogItemId,
            variantId: row.variantId,
            inventoryLocationId: row.inventoryLocationId,
            state: row.state as never,
            availableQuantity:
              row.available === null || row.scale === null || row.unit === null
                ? null
                : { value: Number(row.available), scale: row.scale, unit: row.unit as never },
            ledgerSequence: Number(row.ledgerSequence),
            mappingVersion: row.mappingVersion,
            recipeVersion: row.recipeVersion,
            policyVersion: row.policyVersion,
            stale: false,
            checkedAt: row.checkedAt,
          })),
          correlationId,
        };
      },
      query.locationId,
    );
  }

  history(
    userId: string,
    merchantId: string,
    query: InventoryQuery,
  ): Promise<InventoryHistoryResult> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        let cursorAt: string | null = null;
        let cursorId: string | null = null;
        if (query.cursor) {
          try {
            const decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as {
              occurredAt?: unknown;
              id?: unknown;
            };
            if (typeof decoded.occurredAt !== 'string' || typeof decoded.id !== 'string') {
              throw new Error('shape');
            }
            if (
              Number.isNaN(Date.parse(decoded.occurredAt)) ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                decoded.id,
              )
            ) {
              throw new Error('value');
            }
            cursorAt = decoded.occurredAt;
            cursorId = decoded.id;
          } catch {
            throw new ConflictException({ code: 'INVENTORY_CURSOR_INVALID' });
          }
        }
        const { rows } = await client.query<LedgerRow>(
          `SELECT id::text,merchant_id::text AS "merchantId",location_id::text AS "locationId",
                  inventory_location_id::text AS "inventoryLocationId",
                  inventory_item_id::text AS "inventoryItemId",sequence::text,
                  entry_type AS "entryType",quantity::text,quantity_scale AS "quantityScale",unit,
                  effect_on_hand::text AS "effectOnHand",effect_reserved::text AS "effectReserved",
                  effect_committed::text AS "effectCommitted",effect_damaged::text AS "effectDamaged",
                  effect_quarantine::text AS "effectQuarantine",effect_waste::text AS "effectWaste",
                  effect_in_transit::text AS "effectInTransit",command_id::text AS "commandId",
                  source_aggregate_type AS "sourceType",source_aggregate_id::text AS "sourceId",
                  sale_id::text AS "saleId",sale_line_id::text AS "saleLineId",
                  refund_id::text AS "refundId",count_id::text AS "countId",
                  operator_id::text AS "operatorId",device_id::text AS "deviceId",credential_version AS "credentialVersion",
                  business_date::text AS "businessDate",correlation_id AS "correlationId",
                  occurred_at::text AS "occurredAt"
             FROM merchant.stock_ledger_entry
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid
              AND ($3::uuid IS NULL OR inventory_location_id=$3::uuid)
              AND ($4::uuid IS NULL OR inventory_item_id=$4::uuid)
              AND ($5::timestamptz IS NULL OR (occurred_at,id)<($5::timestamptz,$6::uuid))
            ORDER BY occurred_at DESC,id DESC LIMIT $7`,
          [
            merchantId,
            query.locationId,
            query.inventoryLocationId ?? null,
            query.itemId ?? null,
            cursorAt,
            cursorId,
            query.limit + 1,
          ],
        );
        const hasMore = rows.length > query.limit;
        const pageRows = rows.slice(0, query.limit);
        const last = pageRows.at(-1);
        return {
          entries: pageRows.map((row) => this.ledger(row)),
          page: {
            limit: query.limit,
            hasMore,
            nextCursor:
              hasMore && last
                ? Buffer.from(
                    JSON.stringify({ occurredAt: last.occurredAt, id: last.id }),
                  ).toString('base64url')
                : null,
          },
        };
      },
      query.locationId,
    );
  }

  recovery(userId: string, merchantId: string, locationId: string, commandId: string) {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const { rows } = await client.query<{ status: string; result: unknown }>(
          `SELECT status,response_data AS result FROM merchant.business_command
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND command_id=$3::uuid
              AND command_type LIKE 'pos.inventory.%'`,
          [merchantId, locationId, commandId],
        );
        return {
          commandId,
          state: rows[0] ? 'recovered' : 'query_required',
          result: rows[0]?.result ?? null,
          conflict: null,
        };
      },
      locationId,
    );
  }

  async mutate(
    client: PoolClient,
    merchantId: string,
    authorization: InventoryAuthorization,
    dto: InventoryAdjustment | WasteRecord | DamageRecord | QuarantineRecord,
    correlationId: string,
  ): Promise<InventoryMutationResult> {
    await this.assertCurrentPolicy(client, merchantId, dto);
    await this.assertBalanceVersion(client, merchantId, dto);
    const payloadFingerprint = this.operationFingerprint('pos.inventory.mutation', dto);
    const entry = this.mutationEntry(dto);
    const normalizedQuantity = await this.normalizeQuantity(
      client,
      merchantId,
      dto.inventoryItemId,
      dto.quantity,
    );
    if (!hasPermission(authorization, entry.permission)) {
      throw new ConflictException({ code: 'PERMISSION_REVOKED' });
    }
    const policy = await client.query<{
      adjustmentThreshold: string;
      wasteThreshold: string;
    }>(
      `SELECT adjustment_approval_threshold::text AS "adjustmentThreshold",
              waste_approval_threshold::text AS "wasteThreshold"
         FROM merchant.inventory_policy
        WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND inventory_location_id=$3::uuid
          AND expires_at>clock_timestamp()`,
      [merchantId, dto.locationId, dto.inventoryLocationId],
    );
    if (!policy.rows[0]) throw new ConflictException({ code: 'INVENTORY_POLICY_REQUIRED' });
    const negativeStockApproval = await this.requiresNegativeStockApproval(
      client,
      merchantId,
      dto,
      normalizedQuantity.value,
    );
    const approvalPermission = this.mutationApprovalPermission(dto);
    const threshold =
      'direction' in dto
        ? Number(policy.rows[0].adjustmentThreshold)
        : 'reason' in dto && !('action' in dto) && !('disposition' in dto)
          ? Number(policy.rows[0].wasteThreshold)
          : 0;
    if (negativeStockApproval || normalizedQuantity.value > threshold) {
      await this.consumeApproval(
        client,
        dto,
        merchantId,
        negativeStockApproval ? 'inventory.negative_stock.override' : approvalPermission,
        payloadFingerprint,
      );
    }
    const { rows } = await client.query<LedgerRow>(
      `SELECT (merchant.append_stock_ledger(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::uuid,$8::uuid,$9,$10,$11::uuid,
        $12::uuid,$13::uuid,$14,$15::date,$16,null,null,null,null,$17::jsonb)).*`,
      [
        merchantId,
        dto.locationId,
        dto.inventoryLocationId,
        dto.inventoryItemId,
        entry.type,
        normalizedQuantity.value,
        dto.commandId,
        dto.idempotencyKey,
        payloadFingerprint,
        'inventory_operation',
        dto.commandId,
        authorization.operatorId,
        authorization.deviceId,
        authorization.credentialVersion,
        dto.businessDate,
        correlationId,
        JSON.stringify({
          ...entry.publicData,
          ...(negativeStockApproval ? { negativeStockApprovalId: dto.approvalId } : {}),
        }),
      ],
    );
    return this.mutationResult(
      client,
      merchantId,
      dto.locationId,
      dto.commandId,
      rows,
      correlationId,
    );
  }

  async restock(
    client: PoolClient,
    merchantId: string,
    authorization: InventoryAuthorization,
    dto: RestockCommand,
    correlationId: string,
  ): Promise<InventoryMutationResult> {
    await this.assertCurrentPolicy(client, merchantId, dto);
    const fingerprint = this.operationFingerprint('pos.inventory.restock', dto);
    await this.consumeApproval(client, dto, merchantId, 'inventory.restock.approve', fingerprint);
    const intentResult = await client.query<{
      id: string;
      decision: string;
      quantity: number;
      exceptionId: string;
      exceptionLineId: string;
      saleLineId: string;
    }>(
      `SELECT i.id::text,i.decision,i.quantity,l.id::text AS "exceptionLineId",
              l.exception_id::text AS "exceptionId",
              i.sale_line_id::text AS "saleLineId"
         FROM merchant.pos_restock_intent i
         JOIN merchant.pos_sale_exception_line l ON l.id=i.exception_line_id
        WHERE i.id=$1::uuid AND i.merchant_id=$2::uuid AND i.location_id=$3::uuid
          AND i.version=$4
          AND i.inventory_status IN ('intent_only','review_required')
          AND NOT EXISTS (
            SELECT 1 FROM merchant.inventory_restock_outcome terminal
             WHERE terminal.restock_intent_id=i.id AND terminal.outcome<>'review_required'
          )
        FOR UPDATE`,
      [dto.restockIntentId, merchantId, dto.locationId, dto.expectedVersion],
    );
    const intent = intentResult.rows[0];
    if (!intent) throw new ConflictException({ code: 'RESTOCK_INTENT_NOT_ELIGIBLE' });
    const consumed = await client.query<{
      inventoryItemId: string;
      quantity: string;
      inventoryLocationId: string;
      saleId: string;
      mappingType: string;
      scale: number;
      unit: string;
    }>(
      `SELECT e.inventory_item_id::text AS "inventoryItemId",
              floor(sum(e.quantity)::numeric*$1/x.original_quantity)::text AS quantity,
              e.inventory_location_id::text AS "inventoryLocationId",e.sale_id::text AS "saleId",
              e.quantity_scale AS scale,e.unit,
              CASE WHEN bool_or(e.public_data ? 'recipeId' AND e.public_data->>'recipeId' IS NOT NULL)
                THEN 'recipe' ELSE 'direct' END AS "mappingType"
         FROM merchant.stock_ledger_entry e
         JOIN merchant.pos_sale_exception_line x ON x.id=$2::uuid
        WHERE e.sale_line_id=$3::uuid
          AND e.entry_type='sale_committed' AND e.merchant_id=$4::uuid
        GROUP BY e.inventory_item_id,e.inventory_location_id,e.sale_id,e.quantity_scale,e.unit,
                 x.original_quantity
        ORDER BY e.inventory_item_id`,
      [intent.quantity, intent.exceptionLineId, intent.saleLineId, merchantId],
    );
    const ledger: LedgerRow[] = [];
    const planned = [] as Array<{
      original: (typeof consumed.rows)[number];
      decision: string;
      quantity: { value: number; scale: number; unit: string };
    }>;
    let needsReview = false;
    for (const original of consumed.rows) {
      const component = dto.componentDecisions.find(
        (decision) => decision.inventoryItemId === original.inventoryItemId,
      );
      const decision =
        component?.outcome ??
        (original.mappingType === 'recipe'
          ? 'review_required'
          : this.restockOutcome(intent.decision));
      if (decision === 'review_required') needsReview = true;
      const quantity = component?.quantity
        ? await this.normalizeQuantity(
            client,
            merchantId,
            original.inventoryItemId,
            component.quantity,
          )
        : { value: Number(original.quantity), scale: original.scale, unit: original.unit };
      if (quantity.value > Number(original.quantity)) {
        throw new ConflictException({ code: 'RESTOCK_EXCEEDS_ORIGINAL_CONSUMPTION' });
      }
      planned.push({ original, decision, quantity });
    }
    if (
      new Set(dto.componentDecisions.map((decision) => decision.inventoryItemId)).size !==
      dto.componentDecisions.length
    ) {
      throw new ConflictException({ code: 'DUPLICATE_RESTOCK_COMPONENT' });
    }
    if (needsReview) {
      await client.query(
        `INSERT INTO merchant.inventory_restock_outcome(
          merchant_id,location_id,restock_intent_id,outcome,command_id,command_fingerprint,
          inventory_location_id,resolved_by)
         VALUES($1::uuid,$2::uuid,$3::uuid,'review_required',$4::uuid,$5,$6::uuid,$7::uuid)`,
        [
          merchantId,
          dto.locationId,
          intent.id,
          dto.commandId,
          fingerprint,
          dto.inventoryLocationId,
          authorization.operatorId,
        ],
      );
      return this.mutationResult(
        client,
        merchantId,
        dto.locationId,
        dto.commandId,
        [],
        correlationId,
      );
    }
    for (const { original, decision, quantity } of planned) {
      if (decision === 'not_applicable') continue;
      const type =
        decision === 'restocked'
          ? 'refund_restocked'
          : decision === 'inspection_queued'
            ? 'inspection_queued'
            : 'refund_not_restocked';
      const row = await client.query<LedgerRow>(
        `SELECT (merchant.append_stock_ledger(
          $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::uuid,$8::uuid,$9,
          'refund_restock',$10::uuid,$11::uuid,$12::uuid,$13,$14::date,$15,
          $16::uuid,$17::uuid,$10::uuid,null,$18::jsonb)).*`,
        [
          merchantId,
          dto.locationId,
          original.inventoryLocationId,
          original.inventoryItemId,
          type,
          quantity.value,
          dto.commandId,
          dto.idempotencyKey,
          fingerprint,
          intent.exceptionId,
          authorization.operatorId,
          authorization.deviceId,
          authorization.credentialVersion,
          dto.businessDate,
          correlationId,
          original.saleId,
          intent.saleLineId,
          JSON.stringify({ restockIntentId: intent.id, outcome: decision }),
        ],
      );
      ledger.push(row.rows[0]);
    }
    const terminalOutcomes = new Set(planned.map((entry) => entry.decision));
    const outcome =
      terminalOutcomes.size === 0
        ? 'not_applicable'
        : terminalOutcomes.size === 1
          ? [...terminalOutcomes][0]
          : 'component_resolved';
    await client.query(
      `INSERT INTO merchant.inventory_restock_outcome(
        merchant_id,location_id,restock_intent_id,outcome,command_id,command_fingerprint,
        inventory_location_id,resolved_by)
       VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::uuid)`,
      [
        merchantId,
        dto.locationId,
        intent.id,
        outcome,
        dto.commandId,
        fingerprint,
        dto.inventoryLocationId,
        authorization.operatorId,
      ],
    );
    return this.mutationResult(
      client,
      merchantId,
      dto.locationId,
      dto.commandId,
      ledger,
      correlationId,
    );
  }

  async createCount(
    client: PoolClient,
    merchantId: string,
    authorization: InventoryAuthorization,
    dto: CreateInventoryCountRequest,
    correlationId: string,
  ): Promise<InventoryCountResult> {
    await this.assertCurrentPolicy(client, merchantId, dto);
    const locationVersion = await client.query<{ version: number }>(
      `SELECT version FROM merchant.inventory_location
        WHERE id=$1::uuid AND merchant_id=$2::uuid AND location_id=$3::uuid AND active
        FOR UPDATE`,
      [dto.inventoryLocationId, merchantId, dto.locationId],
    );
    if (locationVersion.rows[0]?.version !== dto.expectedVersion) {
      throw new ConflictException({ code: 'INVENTORY_VERSION_CHANGED' });
    }
    const fingerprint = commandFingerprint('pos.inventory.count.create', dto);
    const scopeResult = await client.query<{ itemIds: string[] }>(
      `SELECT array_agg(i.id::text ORDER BY i.id) AS "itemIds"
         FROM merchant.inventory_item i
         JOIN merchant.stock_balance b ON b.inventory_item_id=i.id
        WHERE i.merchant_id=$1::uuid AND i.active AND b.inventory_location_id=$2::uuid
          AND ($3='full_location' OR i.id=ANY($4::uuid[]))`,
      [merchantId, dto.inventoryLocationId, dto.scope, dto.itemIds],
    );
    const itemIds = scopeResult.rows[0]?.itemIds ?? [];
    if (
      itemIds.length === 0 ||
      (dto.scope !== 'full_location' && itemIds.length !== new Set(dto.itemIds).size)
    ) {
      throw new ConflictException({ code: 'INVENTORY_COUNT_SCOPE_MISMATCH' });
    }
    const { rows } = await client.query<{ id: string; createdAt: string; snapshot: string }>(
      `INSERT INTO merchant.inventory_count(
        merchant_id,location_id,inventory_location_id,public_reference,count_scope,status,blind,
        snapshot_ledger_sequence,snapshot_item_sequences,item_scope,operator_id,
        operator_session_id,device_id,command_id,command_fingerprint)
       WITH snapshot AS (
         SELECT coalesce(max(coalesce(b.ledger_sequence,0)),0) AS maximum,
                jsonb_object_agg(scope_item.id::text,coalesce(b.ledger_sequence,0)) AS item_sequences
           FROM unnest($10::uuid[]) scope_item(id)
           LEFT JOIN merchant.stock_balance b ON b.inventory_location_id=$3::uuid
            AND b.inventory_item_id=scope_item.id
       )
       SELECT $1::uuid,$2::uuid,$3::uuid,'IC-'||upper(substr(replace($4::text,'-',''),1,12)),
              $5,'counting',p.blind_count,s.maximum,s.item_sequences,$10::uuid[],$6::uuid,
              $7::uuid,$8::uuid,$4::uuid,$9
         FROM merchant.inventory_policy p CROSS JOIN snapshot s
        WHERE p.merchant_id=$1::uuid AND p.location_id=$2::uuid AND p.inventory_location_id=$3::uuid
       RETURNING id::text,created_at::text AS "createdAt",snapshot_ledger_sequence::text AS snapshot`,
      [
        merchantId,
        dto.locationId,
        dto.inventoryLocationId,
        dto.commandId,
        dto.scope,
        authorization.operatorId,
        dto.operatorSessionId,
        authorization.deviceId,
        fingerprint,
        itemIds,
      ],
    );
    if (!rows[0]) throw new ConflictException({ code: 'INVENTORY_POLICY_REQUIRED' });
    return {
      count: {
        id: rows[0].id,
        merchantId,
        locationId: dto.locationId,
        inventoryLocationId: dto.inventoryLocationId,
        status: 'counting',
        scope: dto.scope,
        blind: true,
        snapshotLedgerSequence: Number(rows[0].snapshot),
        attempt: 1,
        lines: [],
        createdAt: rows[0].createdAt,
        submittedAt: null,
      },
      variances: [],
      entries: [],
      recovered: false,
      correlationId,
    };
  }

  async submitCount(
    client: PoolClient,
    merchantId: string,
    dto: SubmitInventoryCountRequest,
    correlationId: string,
  ): Promise<InventoryCountResult> {
    await this.assertCurrentPolicy(client, merchantId, dto);
    const count = await client.query<{
      id: string;
      inventoryLocationId: string;
      scope: string;
      blind: boolean;
      createdAt: string;
      itemScope: string[];
      snapshotItemSequences: Record<string, number>;
    }>(
      `SELECT id::text,inventory_location_id::text AS "inventoryLocationId",count_scope AS scope,
              blind,created_at::text AS "createdAt",item_scope::text[] AS "itemScope",
              snapshot_item_sequences AS "snapshotItemSequences"
         FROM merchant.inventory_count
        WHERE id=$1::uuid AND merchant_id=$2::uuid AND location_id=$3::uuid
          AND status='counting' AND attempt=$4 AND snapshot_ledger_sequence=$5
        FOR UPDATE`,
      [dto.countId, merchantId, dto.locationId, dto.attempt, dto.snapshotLedgerSequence],
    );
    if (!count.rows[0]) throw new ConflictException({ code: 'STALE_INVENTORY_COUNT' });
    const submittedItems = [...new Set(dto.lines.map((line) => line.inventoryItemId))].sort();
    if (
      submittedItems.length !== dto.lines.length ||
      submittedItems.join(',') !== [...count.rows[0].itemScope].sort().join(',')
    ) {
      throw new ConflictException({ code: 'INVENTORY_COUNT_SCOPE_MISMATCH' });
    }
    for (const line of dto.lines) {
      const countedQuantity = await this.normalizeQuantity(
        client,
        merchantId,
        line.inventoryItemId,
        line.counted,
        true,
      );
      const inserted = await client.query(
        `INSERT INTO merchant.inventory_count_line(
          merchant_id,count_id,inventory_item_id,expected_quantity,counted_quantity,
          quantity_scale,unit,note)
         SELECT $1::uuid,$2::uuid,$3::uuid,coalesce(b.on_hand,0),$4,$5,$6,$7
           FROM merchant.inventory_item i
           LEFT JOIN merchant.stock_balance b ON b.inventory_location_id=$8::uuid
            AND b.inventory_item_id=i.id
          WHERE i.id=$3::uuid AND i.merchant_id=$1::uuid
            AND coalesce(b.ledger_sequence,0)=$9
          RETURNING id`,
        [
          merchantId,
          dto.countId,
          line.inventoryItemId,
          countedQuantity.value,
          countedQuantity.scale,
          countedQuantity.unit,
          line.note,
          count.rows[0].inventoryLocationId,
          count.rows[0].snapshotItemSequences[line.inventoryItemId] ?? 0,
        ],
      );
      if (inserted.rowCount !== 1) {
        throw new ConflictException({ code: 'STALE_INVENTORY_COUNT' });
      }
    }
    await client.query(
      `UPDATE merchant.inventory_count SET status='reconciliation_required',submitted_at=clock_timestamp(),
         version=version+1 WHERE id=$1::uuid`,
      [dto.countId],
    );
    return this.countResult(client, merchantId, dto.locationId, dto.countId, correlationId);
  }

  async reconcileCount(
    client: PoolClient,
    merchantId: string,
    authorization: InventoryAuthorization,
    dto: InventoryReconciliation,
    correlationId: string,
  ): Promise<InventoryCountResult> {
    await this.assertCurrentPolicy(client, merchantId, dto);
    const fingerprint = this.operationFingerprint('pos.inventory.count.reconcile', dto);
    const count = await client.query<{
      inventoryLocationId: string;
      operatorId: string;
      snapshotItemSequences: Record<string, number>;
      tolerance: string;
    }>(
      `SELECT c.inventory_location_id::text AS "inventoryLocationId",
              c.operator_id::text AS "operatorId",c.snapshot_item_sequences AS "snapshotItemSequences",
              p.count_variance_tolerance::text AS tolerance
         FROM merchant.inventory_count c
         JOIN merchant.inventory_policy p ON p.merchant_id=c.merchant_id
          AND p.location_id=c.location_id AND p.inventory_location_id=c.inventory_location_id
        WHERE c.id=$1::uuid AND c.merchant_id=$2::uuid AND c.location_id=$3::uuid
          AND c.status='reconciliation_required' AND c.attempt=$4
          AND c.snapshot_ledger_sequence=$5 FOR UPDATE OF c`,
      [dto.countId, merchantId, dto.locationId, dto.countAttempt, dto.snapshotLedgerSequence],
    );
    if (!count.rows[0]) throw new ConflictException({ code: 'STALE_INVENTORY_COUNT' });
    const stale = await client.query<{ stale: boolean }>(
      `SELECT exists(
         SELECT 1 FROM jsonb_each_text($2::jsonb) snapshot(item_id,sequence)
         LEFT JOIN merchant.stock_balance b ON b.inventory_location_id=$1::uuid
          AND b.inventory_item_id=snapshot.item_id::uuid
        WHERE coalesce(b.ledger_sequence,0)<>snapshot.sequence::bigint
       ) AS stale`,
      [count.rows[0].inventoryLocationId, JSON.stringify(count.rows[0].snapshotItemSequences)],
    );
    if (stale.rows[0].stale) {
      throw new ConflictException({ code: 'STALE_INVENTORY_COUNT' });
    }
    const lines = await client.query<{
      id: string;
      inventoryItemId: string;
      absolute: string;
      signed: string;
      negativeOverride: boolean;
    }>(
      `SELECT id::text,inventory_item_id::text AS "inventoryItemId",
              l.absolute_variance::text AS absolute,l.signed_variance::text AS signed,
              (i.negative_stock_policy='manager_override'
                AND coalesce(b.available,0)+l.signed_variance<0) AS "negativeOverride"
         FROM merchant.inventory_count_line l
         JOIN merchant.inventory_item i ON i.id=l.inventory_item_id
         LEFT JOIN merchant.stock_balance b ON b.inventory_location_id=$2::uuid
          AND b.inventory_item_id=l.inventory_item_id
        WHERE l.count_id=$1::uuid ORDER BY l.inventory_item_id`,
      [dto.countId, count.rows[0].inventoryLocationId],
    );
    const tolerance = Number(count.rows[0].tolerance);
    const requiresApproval = lines.rows.some((line) => Number(line.absolute) > tolerance);
    const requiresNegativeOverride = lines.rows.some((line) => line.negativeOverride);
    if (requiresNegativeOverride || requiresApproval) {
      await this.consumeApproval(
        client,
        dto,
        merchantId,
        requiresNegativeOverride ? 'inventory.negative_stock.override' : 'inventory.count.approve',
        fingerprint,
      );
    }
    for (const line of lines.rows) {
      if (Number(line.absolute) !== 0 && !dto.reasons[line.inventoryItemId]) {
        throw new ConflictException({ code: 'INVENTORY_VARIANCE_REASON_REQUIRED' });
      }
    }
    for (const line of lines.rows) {
      if (Number(line.absolute) === 0) continue;
      await client.query(
        `SELECT merchant.append_stock_ledger(
          $1::uuid,$2::uuid,$3::uuid,$4::uuid,'count_correction',$5,$6::uuid,$7::uuid,$8,
          'inventory_count',$9::uuid,$10::uuid,$11::uuid,$12,$13::date,$14,
          null,null,null,$9::uuid,$15::jsonb)`,
        [
          merchantId,
          dto.locationId,
          count.rows[0].inventoryLocationId,
          line.inventoryItemId,
          Number(line.absolute),
          dto.commandId,
          dto.idempotencyKey,
          fingerprint,
          dto.countId,
          authorization.operatorId,
          authorization.deviceId,
          authorization.credentialVersion,
          dto.businessDate,
          correlationId,
          JSON.stringify({
            direction: Number(line.signed) > 0 ? 'increase' : 'decrease',
            reason: dto.reasons[line.inventoryItemId],
            ...(line.negativeOverride ? { negativeStockApprovalId: dto.approvalId } : {}),
          }),
        ],
      );
    }
    await client.query(
      `INSERT INTO merchant.inventory_reconciliation(
        merchant_id,location_id,count_id,count_attempt,snapshot_ledger_sequence,command_id,
        command_fingerprint,approval_id,operator_id,summary)
       VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7,$8::uuid,$9::uuid,$10::jsonb)`,
      [
        merchantId,
        dto.locationId,
        dto.countId,
        dto.countAttempt,
        dto.snapshotLedgerSequence,
        dto.commandId,
        fingerprint,
        dto.approvalId,
        authorization.operatorId,
        JSON.stringify({ reasons: dto.reasons }),
      ],
    );
    await client.query(
      `UPDATE merchant.inventory_count SET status='committed',committed_at=clock_timestamp(),
       version=version+1 WHERE id=$1::uuid`,
      [dto.countId],
    );
    return this.countResult(client, merchantId, dto.locationId, dto.countId, correlationId);
  }

  private mutationEntry(dto: InventoryAdjustment | WasteRecord | DamageRecord | QuarantineRecord) {
    if ('direction' in dto) {
      return {
        type: dto.direction === 'increase' ? 'adjustment_increase' : 'adjustment_decrease',
        permission:
          dto.direction === 'increase' ? 'inventory.adjust.increase' : 'inventory.adjust.decrease',
        publicData: { reason: dto.reason },
      };
    }
    if ('disposition' in dto) {
      return {
        type:
          dto.disposition === 'quarantine'
            ? 'quarantine_entered'
            : dto.disposition === 'waste'
              ? 'waste_recorded'
              : 'damage_recorded',
        permission: 'inventory.damage.create',
        publicData: { reason: dto.reason, disposition: dto.disposition },
      };
    }
    if ('action' in dto) {
      return {
        type:
          dto.action === 'enter_quarantine'
            ? 'quarantine_entered'
            : dto.action === 'dispose_from_quarantine'
              ? 'waste_recorded'
              : 'quarantine_released',
        permission:
          dto.action === 'enter_quarantine'
            ? 'inventory.quarantine.enter'
            : 'inventory.quarantine.release',
        publicData: { reason: dto.reason, action: dto.action },
      };
    }
    return {
      type: 'waste_recorded',
      permission: 'inventory.waste.create',
      publicData: { reason: dto.reason },
    };
  }

  private restockOutcome(decision: string) {
    if (decision === 'restock') return 'restocked';
    if (decision === 'do_not_restock') return 'not_restocked';
    if (decision === 'inspection_required') return 'inspection_queued';
    if (decision === 'unknown_until_inventory_review') return 'review_required';
    return 'not_applicable';
  }

  private mutationApprovalPermission(
    dto: InventoryAdjustment | WasteRecord | DamageRecord | QuarantineRecord,
  ) {
    if ('direction' in dto) return 'inventory.adjust.approve';
    if ('disposition' in dto) return 'inventory.damage.approve';
    if ('action' in dto) return 'inventory.quarantine.approve';
    return 'inventory.waste.approve';
  }

  private operationFingerprint(
    type: string,
    dto: { approvalId: string | null; approvalFingerprint: string | null },
  ) {
    return inventoryOperationFingerprint(type, dto);
  }

  private async consumeApproval(
    client: PoolClient,
    dto: {
      approvalId: string | null;
      approvalFingerprint: string | null;
      commandId: string;
      locationId: string;
    },
    merchantId: string,
    permission: string,
    expectedFingerprint: string,
  ) {
    if (!dto.approvalId || !dto.approvalFingerprint) {
      throw new ConflictException({
        code: 'APPROVAL_REQUIRED',
        fieldErrors: {
          approvalPermission: [permission],
          approvalFingerprint: [expectedFingerprint],
        },
      });
    }
    if (dto.approvalFingerprint !== expectedFingerprint) {
      throw new ConflictException({ code: 'APPROVAL_FINGERPRINT_MISMATCH' });
    }
    const result = await client.query(
      `UPDATE runtime.elevation_grant
          SET consumed_at=clock_timestamp(),consumed_by_command_id=$6::uuid
        WHERE id=$1::uuid AND merchant_id=$2::uuid AND location_id=$3::uuid
          AND permission_key=$4 AND command_fingerprint=$5
          AND method='manager_approval' AND expires_at>clock_timestamp()
          AND consumed_at IS NULL`,
      [dto.approvalId, merchantId, dto.locationId, permission, expectedFingerprint, dto.commandId],
    );
    if (result.rowCount !== 1) throw new ConflictException({ code: 'APPROVAL_INVALID' });
  }

  private async mutationResult(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    commandId: string,
    rows: LedgerRow[],
    correlationId: string,
  ): Promise<InventoryMutationResult> {
    const itemIds = rows.map((row) => row.inventoryItemId);
    const location = rows[0]?.inventoryLocationId ?? null;
    const balances = location
      ? await this.balances(client, merchantId, locationId, location, [...new Set(itemIds)])
      : [];
    return {
      commandId,
      entries: rows.map((row) => this.ledger(row)),
      balances,
      recovered: false,
      correlationId,
    };
  }

  private ledger(row: LedgerRow): InventoryMutationResult['entries'][number] {
    return {
      id: row.id,
      merchantId: row.merchantId,
      locationId: row.locationId,
      inventoryLocationId: row.inventoryLocationId,
      inventoryItemId: row.inventoryItemId,
      sequence: Number(row.sequence),
      type: row.entryType as never,
      quantity: { value: Number(row.quantity), scale: row.quantityScale, unit: row.unit as never },
      effects: {
        onHand: Number(row.effectOnHand),
        reserved: Number(row.effectReserved),
        committed: Number(row.effectCommitted),
        damaged: Number(row.effectDamaged),
        quarantine: Number(row.effectQuarantine),
        waste: Number(row.effectWaste),
        inTransit: Number(row.effectInTransit),
      },
      commandId: row.commandId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      saleId: row.saleId,
      saleLineId: row.saleLineId,
      refundId: row.refundId,
      countId: row.countId,
      operatorId: row.operatorId,
      deviceId: row.deviceId,
      credentialVersion: row.credentialVersion,
      businessDate: row.businessDate,
      correlationId: row.correlationId,
      occurredAt: row.occurredAt,
    };
  }

  private async balances(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    inventoryLocationId: string,
    itemIds: string[] | null,
  ): Promise<InventoryOverview['balances']> {
    const { rows } = await client.query<{
      inventoryItemId: string;
      inventoryLocationId: string;
      unit: string;
      scale: number;
      onHand: string;
      reserved: string;
      available: string;
      committed: string;
      damaged: string;
      quarantine: string;
      waste: string;
      inTransit: string;
      ledgerSequence: string;
      version: string;
      calculatedAt: string;
    }>(
      `SELECT inventory_item_id::text AS "inventoryItemId",
              inventory_location_id::text AS "inventoryLocationId",unit,quantity_scale AS scale,
              on_hand::text AS "onHand",reserved::text,available::text,committed::text,
              damaged::text,quarantine::text,waste::text,in_transit::text AS "inTransit",
              ledger_sequence::text AS "ledgerSequence",version::text,
              calculated_at::text AS "calculatedAt"
         FROM merchant.stock_balance WHERE merchant_id=$1::uuid AND location_id=$2::uuid
          AND inventory_location_id=$3::uuid
          AND ($4::uuid[] IS NULL OR inventory_item_id=ANY($4::uuid[]))
        ORDER BY inventory_item_id LIMIT 250`,
      [merchantId, locationId, inventoryLocationId, itemIds],
    );
    return rows.map((row) => ({
      ...row,
      onHand: Number(row.onHand),
      reserved: Number(row.reserved),
      available: Number(row.available),
      committed: Number(row.committed),
      damaged: Number(row.damaged),
      quarantine: Number(row.quarantine),
      waste: Number(row.waste),
      inTransit: Number(row.inTransit),
      ledgerSequence: Number(row.ledgerSequence),
      version: Number(row.version),
      unit: row.unit as never,
    }));
  }

  private async countResult(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    countId: string,
    correlationId: string,
  ): Promise<InventoryCountResult> {
    const count = await client.query<{
      id: string;
      inventoryLocationId: string;
      status: string;
      scope: string;
      blind: boolean;
      snapshot: string;
      attempt: number;
      createdAt: string;
      submittedAt: string | null;
      tolerance: string;
    }>(
      `SELECT c.id::text,c.inventory_location_id::text AS "inventoryLocationId",c.status,
              c.count_scope AS scope,c.blind,c.snapshot_ledger_sequence::text AS snapshot,c.attempt,
              c.created_at::text AS "createdAt",c.submitted_at::text AS "submittedAt",
              p.count_variance_tolerance::text AS tolerance
         FROM merchant.inventory_count c
         JOIN merchant.inventory_policy p ON p.merchant_id=c.merchant_id
          AND p.location_id=c.location_id AND p.inventory_location_id=c.inventory_location_id
        WHERE c.id=$1::uuid AND c.merchant_id=$2::uuid AND c.location_id=$3::uuid`,
      [countId, merchantId, locationId],
    );
    const row = count.rows[0];
    if (!row) throw new ConflictException({ code: 'INVENTORY_COUNT_NOT_FOUND' });
    const lines = await client.query<{
      inventoryItemId: string;
      expected: string;
      counted: string;
      signed: string;
      absolute: string;
      scale: number;
      unit: string;
      note: string | null;
    }>(
      `SELECT inventory_item_id::text AS "inventoryItemId",expected_quantity::text AS expected,
              counted_quantity::text AS counted,signed_variance::text AS signed,
              absolute_variance::text AS absolute,quantity_scale AS scale,unit,note
         FROM merchant.inventory_count_line WHERE count_id=$1::uuid ORDER BY inventory_item_id`,
      [countId],
    );
    const ledger = await client.query<LedgerRow>(
      `SELECT id::text,merchant_id::text AS "merchantId",location_id::text AS "locationId",
              inventory_location_id::text AS "inventoryLocationId",
              inventory_item_id::text AS "inventoryItemId",sequence::text,
              entry_type AS "entryType",quantity::text,quantity_scale AS "quantityScale",unit,
              effect_on_hand::text AS "effectOnHand",effect_reserved::text AS "effectReserved",
              effect_committed::text AS "effectCommitted",effect_damaged::text AS "effectDamaged",
              effect_quarantine::text AS "effectQuarantine",effect_waste::text AS "effectWaste",
              effect_in_transit::text AS "effectInTransit",command_id::text AS "commandId",
              source_aggregate_type AS "sourceType",source_aggregate_id::text AS "sourceId",
              sale_id::text AS "saleId",sale_line_id::text AS "saleLineId",
              refund_id::text AS "refundId",count_id::text AS "countId",
              operator_id::text AS "operatorId",device_id::text AS "deviceId",
              credential_version AS "credentialVersion",business_date::text AS "businessDate",
              correlation_id AS "correlationId",occurred_at::text AS "occurredAt"
         FROM merchant.stock_ledger_entry
        WHERE merchant_id=$1::uuid AND count_id=$2::uuid ORDER BY inventory_item_id,sequence`,
      [merchantId, countId],
    );
    return {
      count: {
        id: row.id,
        merchantId,
        locationId,
        inventoryLocationId: row.inventoryLocationId,
        status: row.status as never,
        scope: row.scope as never,
        blind: row.blind,
        snapshotLedgerSequence: Number(row.snapshot),
        attempt: row.attempt,
        lines: lines.rows.map((line) => ({
          inventoryItemId: line.inventoryItemId,
          counted: { value: Number(line.counted), scale: line.scale, unit: line.unit as never },
          note: line.note,
        })),
        createdAt: row.createdAt,
        submittedAt: row.submittedAt,
      },
      variances: lines.rows.map((line) => ({
        inventoryItemId: line.inventoryItemId,
        expected: { value: Number(line.expected), scale: line.scale, unit: line.unit as never },
        counted: { value: Number(line.counted), scale: line.scale, unit: line.unit as never },
        signed: { value: Number(line.signed), scale: line.scale, unit: line.unit as never },
        absolute: { value: Number(line.absolute), scale: line.scale, unit: line.unit as never },
        tolerance: { value: Number(row.tolerance), scale: line.scale, unit: line.unit as never },
        withinTolerance: Number(line.absolute) <= Number(row.tolerance),
        reasonRequired: Number(line.absolute) !== 0,
        approvalRequired: Number(line.absolute) > Number(row.tolerance),
        ledgerSequence: Number(row.snapshot),
      })),
      entries: ledger.rows.map((entry) => this.ledger(entry)),
      recovered: false,
      correlationId,
    };
  }

  private async assertCurrentPolicy(
    client: PoolClient,
    merchantId: string,
    dto: { locationId: string; inventoryLocationId: string; policyFingerprint: string },
  ) {
    const policy = await client.query<{ fingerprint: string }>(
      `SELECT fingerprint FROM merchant.inventory_policy
        WHERE merchant_id=$1::uuid AND location_id=$2::uuid
          AND inventory_location_id=$3::uuid AND expires_at>clock_timestamp()
        FOR SHARE`,
      [merchantId, dto.locationId, dto.inventoryLocationId],
    );
    if (!policy.rows[0]) throw new ConflictException({ code: 'INVENTORY_POLICY_REQUIRED' });
    if (policy.rows[0].fingerprint !== dto.policyFingerprint) {
      throw new ConflictException({ code: 'INVENTORY_POLICY_CHANGED' });
    }
  }

  private async assertBalanceVersion(
    client: PoolClient,
    merchantId: string,
    dto: {
      locationId: string;
      inventoryLocationId: string;
      inventoryItemId: string;
      expectedVersion: number;
    },
  ) {
    await client.query(
      `SELECT 1 FROM merchant.inventory_item
        WHERE id=$1::uuid AND merchant_id=$2::uuid AND active FOR UPDATE`,
      [dto.inventoryItemId, merchantId],
    );
    const balance = await client.query<{ version: string }>(
      `SELECT version::text FROM merchant.stock_balance
        WHERE merchant_id=$1::uuid AND location_id=$2::uuid
          AND inventory_location_id=$3::uuid AND inventory_item_id=$4::uuid FOR UPDATE`,
      [merchantId, dto.locationId, dto.inventoryLocationId, dto.inventoryItemId],
    );
    const currentVersion = Number(balance.rows[0]?.version ?? 1);
    if (currentVersion !== dto.expectedVersion) {
      throw new ConflictException({ code: 'INVENTORY_VERSION_CHANGED' });
    }
  }

  private async requiresNegativeStockApproval(
    client: PoolClient,
    merchantId: string,
    dto: InventoryAdjustment | WasteRecord | DamageRecord | QuarantineRecord,
    quantity: number,
  ): Promise<boolean> {
    const result = await client.query<{ policy: string; available: string }>(
      `SELECT i.negative_stock_policy AS policy,coalesce(b.available,0)::text AS available
         FROM merchant.inventory_item i
         LEFT JOIN merchant.stock_balance b ON b.merchant_id=i.merchant_id
          AND b.inventory_item_id=i.id AND b.inventory_location_id=$3::uuid
        WHERE i.id=$1::uuid AND i.merchant_id=$2::uuid`,
      [dto.inventoryItemId, merchantId, dto.inventoryLocationId],
    );
    const row = result.rows[0];
    if (!row || row.policy !== 'manager_override') return false;
    const reducesAvailability =
      ('direction' in dto && dto.direction === 'decrease') ||
      'disposition' in dto ||
      ('reason' in dto && !('direction' in dto) && !('action' in dto)) ||
      ('action' in dto && dto.action === 'enter_quarantine');
    return reducesAvailability && Number(row.available) - quantity < 0;
  }

  private async normalizeQuantity(
    client: PoolClient,
    merchantId: string,
    inventoryItemId: string,
    quantity: { value: number; scale: number; unit: string },
    allowZero = false,
  ): Promise<{ value: number; scale: number; unit: string }> {
    const itemResult = await client.query<{
      baseUnit: string;
      targetScale: number;
      active: boolean;
    }>(
      `SELECT base_unit AS "baseUnit",quantity_scale AS "targetScale",active
         FROM merchant.inventory_item
        WHERE id=$1::uuid AND merchant_id=$2::uuid`,
      [inventoryItemId, merchantId],
    );
    const item = itemResult.rows[0];
    if (!item || !item.active) {
      throw new ConflictException({ code: 'INVENTORY_ITEM_ARCHIVED' });
    }

    let numerator = 1n;
    let denominator = 1n;
    let roundingPolicy = 'exact';
    if (quantity.unit !== item.baseUnit) {
      const conversionResult = await client.query<{
        numerator: string;
        denominator: string;
        targetScale: number;
        roundingPolicy: string;
      }>(
        `SELECT numerator::text,denominator::text,target_scale AS "targetScale",
                rounding_policy AS "roundingPolicy"
           FROM merchant.inventory_unit_conversion
          WHERE merchant_id=$1::uuid AND inventory_item_id=$2::uuid
            AND from_unit=$3 AND to_unit=$4 AND active
          ORDER BY version DESC LIMIT 1`,
        [merchantId, inventoryItemId, quantity.unit, item.baseUnit],
      );
      const conversion = conversionResult.rows[0];
      if (!conversion || conversion.targetScale !== item.targetScale) {
        throw new ConflictException({ code: 'INVENTORY_UNIT_CONVERSION_REQUIRED' });
      }
      numerator = BigInt(conversion.numerator);
      denominator = BigInt(conversion.denominator);
      roundingPolicy = conversion.roundingPolicy;
    }

    const scaledNumerator = BigInt(quantity.value) * numerator * 10n ** BigInt(item.targetScale);
    const scaledDenominator = denominator * 10n ** BigInt(quantity.scale);
    let converted = scaledNumerator / scaledDenominator;
    const remainder = scaledNumerator % scaledDenominator;
    if (remainder !== 0n) {
      if (roundingPolicy === 'exact') {
        throw new ConflictException({ code: 'INVENTORY_QUANTITY_NOT_EXACT' });
      }
      if (roundingPolicy === 'ceiling') converted += 1n;
      if (roundingPolicy === 'half_up' && remainder * 2n >= scaledDenominator) converted += 1n;
    }
    if (
      converted < 0n ||
      (!allowZero && converted === 0n) ||
      converted > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new ConflictException({ code: 'INVENTORY_QUANTITY_OUT_OF_RANGE' });
    }
    return { value: Number(converted), scale: item.targetScale, unit: item.baseUnit };
  }
}
