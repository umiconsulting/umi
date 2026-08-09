import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  deriveKitchenOrderStatus,
  type KitchenItemStatus,
  type KitchenOrderStatus,
  validateKitchenTransition,
} from './kitchen-domain';
import { PgService } from '../../shared/database/pg.service';
import { getRequestContext } from '../../shared/database/request-context';
import {
  type KdsDeviceSession,
  type KitchenStatus,
  randomHex,
  sha256Hex,
} from './dto/kds-contract';

/** The repository enforces the merchant, location, station, and device scope. */

export interface StationRow {
  id: string;
  merchant_id: string;
  location_id: string | null;
  name: string;
}

async function finishKitchenCommand(
  client: PoolClient,
  commandId: string,
  status: 'succeeded' | 'conflict',
  result: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `UPDATE merchant.kitchen_command SET status=$2,result=$3::jsonb,completed_at=clock_timestamp()
      WHERE id=$1::uuid`,
    [commandId, status, JSON.stringify(result)],
  );
}

async function auditKitchenConfiguration(
  client: PoolClient,
  input: {
    merchantId: string;
    locationId: string | null;
    eventType: string;
    entityType: string;
    entityId: string;
    publicData?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO merchant.audit_event
       (merchant_id,location_id,actor_user_id,command_id,event_type,entity_type,entity_id,
        outcome,public_data,correlation_id,event_hash)
     VALUES ($1::uuid,$2::uuid,$3::uuid,gen_random_uuid(),$4,$5,$6::uuid,
             'success',$7::jsonb,'kds-config-'||$6::text,'')`,
    [
      input.merchantId,
      input.locationId,
      getRequestContext()?.userId ?? null,
      input.eventType,
      input.entityType,
      input.entityId,
      JSON.stringify(input.publicData ?? {}),
    ],
  );
}

function kitchenEventKind(commandType: string): string {
  if (commandType === 'recall') return 'order_recalled';
  if (commandType === 'change_priority') return 'priority_changed';
  if (commandType === 'cancel_ack') return 'order_cancelled';
  if (commandType === 'mark_item_ready') return 'item_updated';
  return 'order_updated';
}

function commandTarget(
  commandType: string,
  _current: KitchenOrderStatus,
): KitchenOrderStatus | null {
  if (commandType === 'start_preparation' || commandType === 'recall') return 'in_preparation';
  if (commandType === 'mark_item_ready' || commandType === 'mark_order_ready') return 'ready';
  if (commandType === 'complete') return 'completed';
  if (commandType === 'cancel_ack') return 'cancelled';
  if (commandType === 'change_priority') return null;
  return null;
}

function mapCanonicalKitchenStatus(status: KitchenOrderStatus): KitchenStatus {
  switch (status) {
    case 'queued':
      return 'new';
    case 'in_preparation':
      return 'preparing';
    case 'partially_ready':
      return 'partial_cancelled';
    case 'ready':
    case 'completed':
    case 'cancelled':
      return status;
    case 'exception':
      return 'new';
  }
}

export interface PairingRow {
  id: string;
  merchant_id: string;
  location_id: string | null;
  station_id: string | null;
  device_name: string;
  status: string;
  expires_at: string;
  created_at: string;
}

export interface PairingPollRow {
  id: string;
  pin_hash: string;
  pin_salt: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  expires_at: string;
}

export interface PairingStatusRow {
  id: string;
  merchant_id: string;
  location_id: string | null;
  station_id: string | null;
  device_name: string;
  requested_name: string | null;
  status: string;
  expires_at: string;
  used_at: string | null;
}

export interface SessionRow {
  id: string;
  merchant_id: string;
  station_id: string | null;
  device_name: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
}

export interface OrderScopeRow {
  id: string;
  merchant_id: string;
  location_id: string | null;
  station_id: string | null;
  station_ids?: string[];
  kitchen_status: KitchenStatus | null;
  kitchen_order_status?: KitchenOrderStatus;
  version?: number;
  person_id: string | null;
  source_transaction_id: string | null;
  public_reference?: string;
}

/** A preparation-safe kitchen row for the iPad and dashboard adapters. */
export interface TicketRow {
  ticket_id: string;
  source_transaction_id: string | null;
  public_reference?: string;
  merchant_id: string;
  source_channel: string | null;
  location_id?: string;
  priority?: string;
  business_date?: string;
  preparation_started_at?: string | null;
  version?: number;
  status: KitchenStatus | KitchenOrderStatus;
  station_id: string | null;
  station_name: string | null;
  created_at: string;
  updated_at: string;
  last_event_sequence: string | number;
  items: unknown;
}

export interface EventRow {
  sequence: string | number;
  ticket_id: string;
  merchant_id: string;
  source_transaction_id: string | null;
  kind: string | null;
  status: string | null;
  occurred_at: string;
  source: string | null;
  payload: unknown;
  location_id?: string;
  station_id?: string | null;
  aggregate_version?: number;
  correlation_id?: string;
}

export interface DeviceListRow {
  device_id: string;
  device_registry_id: string | null;
  device_type: string | null;
  station_id: string | null;
  station_name: string | null;
  device_name: string | null;
  last_used_at: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
}

@Injectable()
export class KdsRepository {
  constructor(private readonly pg: PgService) {}

  async dashboardLocationAllowed(userId: string, merchantId: string, locationId: string) {
    const { rowCount } = await this.pg.query(
      `SELECT 1 FROM merchant.staff
        WHERE user_id=$1::uuid AND merchant_id=$2::uuid AND location_id=$3::uuid
          AND status='active'
        LIMIT 1`,
      [userId, merchantId, locationId],
    );
    return (rowCount ?? 0) === 1;
  }

  async dashboardResourceLocation(
    merchantId: string,
    resource: {
      stationId?: string;
      routeId?: string;
      deviceId?: string;
      pairingId?: string;
      ticketId?: string;
    },
  ): Promise<{ found: boolean; locationId: string | null }> {
    const entries = Object.entries(resource).filter((entry) => entry[1]);
    if (entries.length !== 1) return { found: false, locationId: null };
    const [kind, id] = entries[0];
    const queries: Record<string, string> = {
      stationId: `SELECT location_id::text FROM merchant.station
                   WHERE merchant_id=$1::uuid AND id::text=$2`,
      routeId: `SELECT location_id::text FROM merchant.kitchen_route
                 WHERE merchant_id=$1::uuid AND id::text=$2`,
      deviceId: `SELECT metadata->>'location_id' AS location_id FROM runtime.session
                  WHERE merchant_id=$1::uuid AND id::text=$2 AND principal_type='device'`,
      pairingId: `SELECT location_id::text FROM runtime.pairing
                   WHERE merchant_id=$1::uuid AND id::text=$2`,
      ticketId: `SELECT location_id::text FROM merchant.kitchen_order
                  WHERE merchant_id=$1::uuid AND (id::text=$2 OR public_reference=$2)`,
    };
    const sql = queries[kind];
    if (!sql) return { found: false, locationId: null };
    const { rows } = await this.pg.query<{ location_id: string | null }>(sql, [merchantId, id]);
    return rows[0]
      ? { found: true, locationId: rows[0].location_id }
      : { found: false, locationId: null };
  }

  async authorizePos(
    userId: string,
    sessionId: string,
    deviceId: string,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ): Promise<boolean> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const result = await client.query(
          `SELECT 1 FROM runtime.operator_session os
            JOIN merchant.device d ON d.id=os.device_id
           WHERE os.id=$6::uuid AND os.durable_session_id=$2::uuid
             AND os.user_id=$1::uuid AND os.device_id=$3::uuid
             AND os.merchant_id=$4::uuid AND os.location_id=$5::uuid
             AND os.state='active' AND os.expires_at>now() AND d.status='active'
             AND ('kitchen.read'=ANY(os.permissions) OR '*'=ANY(os.permissions))
             AND EXISTS (
               SELECT 1 FROM jsonb_array_elements(os.entitlements) e
                WHERE e->>'featureKey'='pos'
                  AND coalesce((e->>'enabled')::boolean,false)
             )`,
          [userId, sessionId, deviceId, merchantId, locationId, operatorSessionId],
        );
        return (result.rowCount ?? 0) === 1;
      },
      locationId,
    );
  }

  async posKitchenStatus(merchantId: string, locationId: string, sourceOrderId: string) {
    const { rows } = await this.pg.query<{
      kitchen_order_id: string;
      source_order_id: string;
      public_reference: string;
      status: KitchenOrderStatus;
      priority: string;
      version: string;
      station_ids: string[];
      updated_at: string;
    }>(
      `SELECT ko.id::text AS kitchen_order_id,ko.source_order_id::text,
              ko.public_reference,ko.status,ko.priority,ko.version::text,
              array_agg(DISTINCT i.station_id::text) FILTER (WHERE i.station_id IS NOT NULL)
                AS station_ids,
              ko.updated_at
         FROM merchant.kitchen_order ko
         JOIN merchant.kitchen_order_item i
           ON i.merchant_id=ko.merchant_id AND i.kitchen_order_id=ko.id
        WHERE ko.merchant_id=$1::uuid AND ko.location_id=$2::uuid
          AND ko.source_order_id=$3::uuid
        GROUP BY ko.id`,
      [merchantId, locationId, sourceOrderId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      kitchenOrderId: row.kitchen_order_id,
      sourceOrderId: row.source_order_id,
      publicReference: row.public_reference,
      status: row.status,
      priority: row.priority,
      version: Number(row.version),
      stationIds: row.station_ids ?? [],
      updatedAt: row.updated_at,
    };
  }

  // ── Stations (merchant.station; location_id -> location_id) ─────────────────────

  /** Active station within the merchant (+ optional location scope). */
  async loadStation(
    merchantId: string,
    locationId: string | null,
    stationId: string,
  ): Promise<StationRow | null> {
    // A missing locationId means "unscoped" (match the station at any location) —
    // NOT "root-location only". listStations() returns all-location stations, so
    // forcing location_id IS NULL here would reject a valid dashboard selection.
    const locClause = locationId ? 'AND location_id = $3' : '';
    const params = locationId ? [stationId, merchantId, locationId] : [stationId, merchantId];
    const { rows } = await this.pg.query<StationRow>(
      `SELECT id, merchant_id, location_id AS location_id, name
         FROM merchant.station
        WHERE id = $1 AND merchant_id = $2 AND status = 'active' ${locClause}
        LIMIT 1`,
      params,
    );
    return rows[0] ?? null;
  }

  async listStations(
    merchantId: string,
    locationId: string | null,
  ): Promise<
    Array<{
      id: string;
      station_key: string;
      name: string;
      status: string;
      sort_order: number;
      location_id: string | null;
    }>
  > {
    const locClause = locationId ? 'AND location_id = $2' : '';
    const params = locationId ? [merchantId, locationId] : [merchantId];
    const { rows } = await this.pg.query(
      `SELECT id, key AS station_key, name, status, sort_order, location_id AS location_id
         FROM merchant.station
        WHERE merchant_id = $1 AND status = 'active' ${locClause}
        ORDER BY sort_order ASC, name ASC`,
      params,
    );
    return rows as Array<{
      id: string;
      station_key: string;
      name: string;
      status: string;
      sort_order: number;
      location_id: string | null;
    }>;
  }

  /**
   * Active (non-archived) station with this key in the same location scope.
   * `IS NOT DISTINCT FROM` makes the location match NULL-safe, so this closes
   * the merchant-wide (`location_id IS NULL`) gap that the DB's
   * partial-unique indexes handle only when non-null.
   */
  async findActiveStationByKey(
    merchantId: string,
    locationId: string | null,
    stationKey: string,
  ): Promise<{ id: string } | null> {
    const { rows } = await this.pg.query<{ id: string }>(
      `SELECT id
         FROM merchant.station
        WHERE merchant_id = $1
          AND key = $2
          AND location_id IS NOT DISTINCT FROM $3
          AND status <> 'archived'
        LIMIT 1`,
      [merchantId, stationKey, locationId],
    );
    return rows[0] ?? null;
  }

  /** Create an active station. `sort_order` defaults to 0 (DB default). */
  async createStation(input: {
    merchantId: string;
    locationId: string | null;
    name: string;
    stationKey: string;
  }): Promise<{
    id: string;
    station_key: string;
    name: string;
    status: string;
    sort_order: number;
    location_id: string | null;
  }> {
    return this.pg.workerTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO merchant.station (merchant_id, location_id, key, name)
           VALUES ($1, $2, $3, $4)
         RETURNING id, key AS station_key, name, status, sort_order, location_id AS location_id`,
        [input.merchantId, input.locationId, input.stationKey, input.name],
      );
      const station = rows[0] as {
        id: string;
        station_key: string;
        name: string;
        status: string;
        sort_order: number;
        location_id: string | null;
      };
      await auditKitchenConfiguration(client, {
        merchantId: input.merchantId,
        locationId: input.locationId,
        eventType: 'kitchen_station_changed',
        entityType: 'kitchen_station',
        entityId: station.id,
        publicData: { action: 'created', stationKey: input.stationKey },
      });
      return station;
    });
  }

  /** Rename an active/disabled station. Returns null if not found. */
  async updateStation(input: { merchantId: string; stationId: string; name: string }): Promise<{
    id: string;
    station_key: string;
    name: string;
    status: string;
    sort_order: number;
    location_id: string | null;
  } | null> {
    return this.pg.workerTx(async (client) => {
      const { rows } = await client.query(
        `UPDATE merchant.station
          SET name = $3, updated_at = now()
        WHERE id = $1 AND merchant_id = $2 AND status <> 'archived'
      RETURNING id, key AS station_key, name, status, sort_order, location_id AS location_id`,
        [input.stationId, input.merchantId, input.name],
      );
      const station =
        (rows[0] as {
          id: string;
          station_key: string;
          name: string;
          status: string;
          sort_order: number;
          location_id: string | null;
        }) ?? null;
      if (station) {
        await auditKitchenConfiguration(client, {
          merchantId: input.merchantId,
          locationId: station.location_id,
          eventType: 'kitchen_station_changed',
          entityType: 'kitchen_station',
          entityId: station.id,
          publicData: { action: 'renamed' },
        });
      }
      return station;
    });
  }

  /**
   * Soft-delete a station (status → 'archived'). Never a hard DELETE: devices,
   * pairings and orders reference `station_id`, so archiving keeps history intact
   * while hiding it from the active list. Returns false if not found / already
   * archived.
   */
  async archiveStation(merchantId: string, stationId: string): Promise<boolean> {
    return this.pg.workerTx(async (client) => {
      const { rows } = await client.query<{ location_id: string | null }>(
        `UPDATE merchant.station
          SET status = 'archived', updated_at = now()
        WHERE id = $1 AND merchant_id = $2 AND status <> 'archived'
        RETURNING location_id`,
        [stationId, merchantId],
      );
      if (!rows[0]) return false;
      await auditKitchenConfiguration(client, {
        merchantId,
        locationId: rows[0].location_id,
        eventType: 'kitchen_station_changed',
        entityType: 'kitchen_station',
        entityId: stationId,
        publicData: { action: 'archived' },
      });
      return true;
    });
  }

  async listRoutes(merchantId: string, locationId: string) {
    const { rows } = await this.pg.query(
      `SELECT r.id,r.location_id,r.product_id,r.category_id,r.station_id,
              r.requires_preparation,r.route_priority,r.target_seconds,r.active,r.version,
              s.name AS station_name
         FROM merchant.kitchen_route r
         JOIN merchant.station s ON s.merchant_id=r.merchant_id AND s.id=r.station_id
        WHERE r.merchant_id=$1::uuid AND r.location_id=$2::uuid
        ORDER BY r.route_priority,r.id`,
      [merchantId, locationId],
    );
    return rows;
  }

  async createRoute(input: {
    merchantId: string;
    locationId: string;
    productId: string | null;
    categoryId: string | null;
    stationId: string;
    routePriority: number;
    targetSeconds: number | null;
  }) {
    return this.pg.workerTx(async (client) => {
      const station = await client.query(
        `SELECT 1 FROM merchant.station
          WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND id=$3::uuid AND status='active'`,
        [input.merchantId, input.locationId, input.stationId],
      );
      if (!station.rowCount) return null;
      const { rows } = await client.query(
        `INSERT INTO merchant.kitchen_route
           (merchant_id,location_id,product_id,category_id,station_id,route_priority,target_seconds)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7)
         RETURNING id,location_id,product_id,category_id,station_id,requires_preparation,
                   route_priority,target_seconds,active,version`,
        [
          input.merchantId,
          input.locationId,
          input.productId,
          input.categoryId,
          input.stationId,
          input.routePriority,
          input.targetSeconds,
        ],
      );
      const route = rows[0] ?? null;
      if (route) {
        await auditKitchenConfiguration(client, {
          merchantId: input.merchantId,
          locationId: input.locationId,
          eventType: 'kitchen_station_changed',
          entityType: 'kitchen_route',
          entityId: route.id,
          publicData: { action: 'route_created', stationId: input.stationId },
        });
      }
      return route;
    });
  }

  async updateRoute(input: {
    merchantId: string;
    routeId: string;
    stationId: string;
    active: boolean;
    routePriority: number;
    targetSeconds: number | null;
    expectedVersion: number;
  }) {
    return this.pg.workerTx(async (client) => {
      const { rows } = await client.query(
        `UPDATE merchant.kitchen_route r
          SET station_id=$3::uuid,active=$4,route_priority=$5,target_seconds=$6,
              version=version+1,updated_at=clock_timestamp()
        WHERE r.merchant_id=$1::uuid AND r.id=$2::uuid AND r.version=$7
          AND EXISTS (
            SELECT 1 FROM merchant.station s
             WHERE s.merchant_id=r.merchant_id AND s.location_id=r.location_id
               AND s.id=$3::uuid AND s.status='active'
          )
      RETURNING id,location_id,product_id,category_id,station_id,requires_preparation,
                route_priority,target_seconds,active,version`,
        [
          input.merchantId,
          input.routeId,
          input.stationId,
          input.active,
          input.routePriority,
          input.targetSeconds,
          input.expectedVersion,
        ],
      );
      const route = rows[0] ?? null;
      if (route) {
        await auditKitchenConfiguration(client, {
          merchantId: input.merchantId,
          locationId: route.location_id,
          eventType: 'kitchen_station_changed',
          entityType: 'kitchen_route',
          entityId: route.id,
          publicData: { action: 'route_updated', stationId: input.stationId },
        });
      }
      return route;
    });
  }

  // ── Pairing (runtime.pairing) ──────────────────────────────────────────────

  async insertPairingRequest(input: {
    merchantId: string;
    locationId: string | null;
    stationId: string;
    deviceName: string;
    pinHash: string;
    pinSalt: string;
    maxAttempts: number;
    expiresAt: string;
  }): Promise<PairingRow> {
    return this.pg.workerTx(async (client) => {
      const { rows } = await client.query<PairingRow>(
        `INSERT INTO runtime.pairing
         (merchant_id, location_id, station_id, device_name,
          pin_hash, pin_salt, status, max_attempts, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
       RETURNING id, merchant_id, location_id, station_id, device_name,
                 status, expires_at, created_at`,
        [
          input.merchantId,
          input.locationId,
          input.stationId,
          input.deviceName,
          input.pinHash,
          input.pinSalt,
          input.maxAttempts,
          input.expiresAt,
        ],
      );
      await auditKitchenConfiguration(client, {
        merchantId: input.merchantId,
        locationId: input.locationId,
        eventType: 'kitchen_station_changed',
        entityType: 'kds_pairing',
        entityId: rows[0].id,
        publicData: { action: 'pairing_created', stationId: input.stationId },
      });
      return rows[0];
    });
  }

  async listPairingRequests(
    merchantId: string,
    locationId: string | null,
    limit: number,
  ): Promise<Record<string, unknown>[]> {
    const locClause = locationId ? 'AND location_id = $2' : 'AND location_id IS NULL';
    const params = locationId ? [merchantId, locationId, limit] : [merchantId, limit];
    const limitParam = locationId ? '$3' : '$2';
    const { rows } = await this.pg.query(
      `SELECT id, merchant_id, location_id, station_id, device_name, requested_name,
              status, attempt_count, max_attempts, expires_at,
              approved_by, approved_at, used_at, denied_at, created_at
         FROM runtime.pairing
        WHERE merchant_id = $1 AND status IN ('pending', 'approved') ${locClause}
        ORDER BY created_at DESC
        LIMIT ${limitParam}`,
      params,
    );
    return rows;
  }

  /** Set a pairing pending→approved/denied. Returns null if not still pending. */
  async dispositionPairing(
    pairingId: string,
    merchantId: string,
    action: 'approve' | 'deny',
    adminUserId: string | null,
  ): Promise<{ id: string; status: string } | null> {
    const patch =
      action === 'approve'
        ? `status = 'approved', approved_by = $3, approved_at = now(), updated_at = now()`
        : `status = 'denied', denied_at = now(), updated_at = now()`;
    const params =
      action === 'approve' ? [pairingId, merchantId, adminUserId] : [pairingId, merchantId];
    // Approve requires a still-valid window. Deny is a dismissal, so it also
    // clears pending requests already past expires_at — those linger in the
    // list (status is still 'pending' until dismissed) and would otherwise be
    // impossible to remove.
    const freshnessClause = action === 'approve' ? `AND expires_at > now()` : '';
    return this.pg.workerTx(async (client) => {
      const { rows } = await client.query<{
        id: string;
        status: string;
        location_id: string | null;
      }>(
        `UPDATE runtime.pairing
          SET ${patch}
        WHERE id = $1 AND merchant_id = $2 AND status = 'pending'
          ${freshnessClause}
        RETURNING id,status,location_id`,
        params,
      );
      const pairing = rows[0] ?? null;
      if (pairing) {
        await auditKitchenConfiguration(client, {
          merchantId,
          locationId: pairing.location_id,
          eventType: 'kitchen_station_changed',
          entityType: 'kds_pairing',
          entityId: pairing.id,
          publicData: { action },
        });
      }
      return pairing;
    });
  }

  /** Newest pending non-expired requests, for the global PIN match (kds_start). */
  async findPendingPairingsForPin(limit: number): Promise<PairingPollRow[]> {
    const { rows } = await this.pg.query<PairingPollRow>(
      `SELECT id, pin_hash, pin_salt, status, attempt_count, max_attempts, expires_at
         FROM runtime.pairing
        WHERE status = 'pending' AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    );
    return rows;
  }

  /** Record the device name after a PIN match. */
  async setPairingRequestedName(pairingId: string, requestedName: string): Promise<void> {
    await this.pg.query(
      `UPDATE runtime.pairing
          SET requested_name = $2, updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [pairingId, requestedName],
    );
  }

  /** Read one pairing for the iPad status request. */
  async getPairing(pairingId: string): Promise<PairingStatusRow | null> {
    const { rows } = await this.pg.query<PairingStatusRow>(
      `SELECT id, merchant_id, location_id, station_id, device_name, requested_name,
              status, expires_at, used_at
         FROM runtime.pairing
        WHERE id = $1
        LIMIT 1`,
      [pairingId],
    );
    return rows[0] ?? null;
  }

  async expirePairing(pairingId: string): Promise<void> {
    await this.pg.query(
      `UPDATE runtime.pairing
          SET status = 'expired', updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [pairingId],
    );
  }

  /** Claim an approved pairing once and record its device. */
  async claimPairing(pairingId: string, deviceRegistryId: string): Promise<boolean> {
    const { rows } = await this.pg.query<{ id: string }>(
      `UPDATE runtime.pairing
          SET status = 'used', used_at = now(), device_id = $2, updated_at = now()
        WHERE id = $1 AND status = 'approved' AND used_at IS NULL
        RETURNING id`,
      [pairingId, deviceRegistryId],
    );
    return rows.length > 0;
  }

  /** Create the registry device and its runtime session in one transaction. */
  async createDeviceSession(input: {
    merchantId: string;
    locationId: string | null;
    stationId: string | null;
    deviceName: string;
  }): Promise<{
    id: string;
    merchant_id: string;
    station_id: string | null;
    device_name: string | null;
    token: string;
    device_registry_id: string;
  }> {
    const token = randomHex(32);
    const tokenHash = sha256Hex(token);
    return this.pg.workerTx(async (client) => {
      const dev = await client.query<{ id: string }>(
        `INSERT INTO merchant.device
           (merchant_id, location_id, station_id, name, kind, status)
         VALUES ($1, $2, $3, $4, 'kds', 'active')
         RETURNING id`,
        [input.merchantId, input.locationId, input.stationId, input.deviceName],
      );
      const deviceRegistryId = dev.rows[0].id;
      const sess = await client.query<{
        id: string;
        merchant_id: string;
        station_id: string | null;
        device_name: string | null;
      }>(
        `INSERT INTO runtime.session
           (merchant_id, principal_type, principal_id, station_id, device_name,
            token_hash, is_active, metadata)
         VALUES ($1, 'device', $2, $3, $4, $5, true,
                 jsonb_build_object(
                   'location_id', $6::text,
                   'permissions', jsonb_build_array(
                     'kitchen.read','kitchen.prepare','kitchen.ready','kitchen.complete'
                   )
                 ))
         RETURNING id, merchant_id, station_id, device_name`,
        [
          input.merchantId,
          deviceRegistryId,
          input.stationId,
          input.deviceName,
          tokenHash,
          input.locationId,
        ],
      );
      if (input.locationId && input.stationId) {
        await client.query(
          `INSERT INTO merchant.kitchen_device_station
             (merchant_id,location_id,device_id,station_id)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid)`,
          [input.merchantId, input.locationId, deviceRegistryId, input.stationId],
        );
      }
      await auditKitchenConfiguration(client, {
        merchantId: input.merchantId,
        locationId: input.locationId,
        eventType: 'kitchen_station_changed',
        entityType: 'kds_device',
        entityId: deviceRegistryId,
        publicData: { action: 'registered', stationId: input.stationId },
      });
      return { ...sess.rows[0], token, device_registry_id: deviceRegistryId };
    });
  }

  /**
   * Cleanup for a lost claim race — delete the registry row + its session. In
   * build-v2 the session's `principal_id` is a SOFT ref (NO FK), so the delete no
   * longer cascades; both rows are removed explicitly in one transaction.
   */
  async deleteDevice(deviceRegistryId: string): Promise<void> {
    await this.pg.workerTx(async (client) => {
      await client.query(
        `DELETE FROM runtime.session
          WHERE principal_type = 'device' AND principal_id = $1`,
        [deviceRegistryId],
      );
      await client.query(`DELETE FROM merchant.device WHERE id = $1`, [deviceRegistryId]);
    });
  }

  /** Device-auth lookup by token hash (the token itself is never stored). */
  async findSessionByToken(tokenHash: string): Promise<SessionRow | null> {
    const { rows } = await this.pg.query<SessionRow>(
      `SELECT s.id,s.merchant_id,coalesce(a.station_id,s.station_id) AS station_id,
              s.device_name,s.is_active,s.metadata
         FROM runtime.session s
         JOIN merchant.device d
           ON d.id=s.principal_id AND d.merchant_id=s.merchant_id AND d.status='active'
         LEFT JOIN merchant.kitchen_device_station a
           ON a.device_id=d.id AND a.merchant_id=d.merchant_id
          AND a.station_id=s.station_id AND a.active
        WHERE s.token_hash = $1 AND s.principal_type = 'device'
          AND (s.station_id IS NULL OR a.device_id IS NOT NULL)
        LIMIT 1`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  /** Liveness touch on every board/command poll (the prod heartbeat signal). */
  async touchSession(sessionId: string): Promise<void> {
    await this.pg.query(`UPDATE runtime.session SET last_used_at = now() WHERE id = $1`, [
      sessionId,
    ]);
  }

  /** Heartbeat endpoint: touch + record source ip in metadata. */
  async heartbeatTouch(sessionId: string, merchantId: string, ip: string | null): Promise<boolean> {
    const { rowCount } = await this.pg.query(
      `UPDATE runtime.session
          SET last_used_at = now(),
              metadata = metadata || jsonb_build_object('ip', $2::text)
        WHERE id = $1::uuid AND merchant_id=$3::uuid AND is_active = true`,
      [sessionId, ip, merchantId],
    );
    return (rowCount ?? 0) > 0;
  }

  async listDevices(merchantId: string, locationId: string | null): Promise<DeviceListRow[]> {
    const locClause = locationId ? `AND s.metadata->>'location_id' = $2` : '';
    const params = locationId ? [merchantId, locationId] : [merchantId];
    const { rows } = await this.pg.query<DeviceListRow>(
      `SELECT s.id AS device_id, s.principal_id AS device_registry_id,
              dv.kind AS device_type, s.station_id, st.name AS station_name,
              s.device_name, s.last_used_at, s.is_active, s.metadata
         FROM runtime.session s
         LEFT JOIN merchant.device dv
           ON dv.merchant_id = s.merchant_id AND dv.id = s.principal_id
         LEFT JOIN merchant.station st
           ON st.merchant_id = s.merchant_id AND st.id = s.station_id
        WHERE s.merchant_id = $1 AND s.is_active = true
          AND s.principal_type = 'device' ${locClause}
        ORDER BY s.last_used_at DESC NULLS LAST, s.created_at DESC`,
      params,
    );
    return rows;
  }

  /** Deactivate the session and archive its registry device row (one tx). */
  async revokeSession(merchantId: string, deviceId: string): Promise<boolean> {
    return this.pg.workerTx(async (client) => {
      const sess = await client.query<{ principal_id: string; location_id: string | null }>(
        `UPDATE runtime.session SET is_active = false
          WHERE id = $1 AND merchant_id = $2
        RETURNING principal_id,metadata->>'location_id' AS location_id`,
        [deviceId, merchantId],
      );
      if (sess.rowCount === 0) return false;
      const registryId = sess.rows[0]?.principal_id;
      if (registryId) {
        await client.query(
          `UPDATE merchant.device SET status = 'retired', updated_at = now()
            WHERE id = $1 AND merchant_id = $2`,
          [registryId, merchantId],
        );
      }
      await auditKitchenConfiguration(client, {
        merchantId,
        locationId: sess.rows[0]?.location_id ?? null,
        eventType: 'kitchen_station_changed',
        entityType: 'kds_device',
        entityId: registryId,
        publicData: { action: 'revoked' },
      });
      return true;
    });
  }

  /** Update the session's display fields and keep the registry row in sync. */
  async updateSession(
    merchantId: string,
    deviceId: string,
    patch: { deviceName?: string | null; stationId?: string | null },
  ): Promise<boolean> {
    // stationId === undefined → the PATCH omitted station_id, so leave it
    // untouched (a rename must not wipe the assignment). An explicit null clears.
    const setStation = patch.stationId !== undefined;
    return this.pg.workerTx(async (client) => {
      const sess = await client.query<{ principal_id: string; location_id: string | null }>(
        `UPDATE runtime.session
            SET device_name = COALESCE($3, device_name),
                station_id  = CASE WHEN $5 THEN $4 ELSE station_id END
          WHERE id = $1 AND merchant_id = $2
        RETURNING principal_id,metadata->>'location_id' AS location_id`,
        [deviceId, merchantId, patch.deviceName ?? null, patch.stationId ?? null, setStation],
      );
      if (sess.rowCount === 0) return false;
      const registryId = sess.rows[0]?.principal_id;
      if (registryId) {
        await client.query(
          `UPDATE merchant.device
              SET name = COALESCE($3, name),
                  station_id = CASE WHEN $5 THEN $4 ELSE station_id END,
                  updated_at = now()
            WHERE id = $1 AND merchant_id = $2`,
          [registryId, merchantId, patch.deviceName ?? null, patch.stationId ?? null, setStation],
        );
        if (setStation) {
          await client.query(
            `UPDATE merchant.kitchen_device_station
                SET active=false,configuration_version=configuration_version+1,
                    updated_at=clock_timestamp()
              WHERE merchant_id=$1::uuid AND device_id=$2::uuid AND active`,
            [merchantId, registryId],
          );
          const locationId = sess.rows[0]?.location_id;
          if (patch.stationId && locationId) {
            await client.query(
              `INSERT INTO merchant.kitchen_device_station
                 (merchant_id,location_id,device_id,station_id,active)
               VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,true)
               ON CONFLICT (device_id,station_id) DO UPDATE SET
                 active=true,configuration_version=merchant.kitchen_device_station.configuration_version+1,
                 updated_at=clock_timestamp()`,
              [merchantId, locationId, registryId, patch.stationId],
            );
          }
        }
      }
      await auditKitchenConfiguration(client, {
        merchantId,
        locationId: sess.rows[0]?.location_id ?? null,
        eventType: 'kitchen_station_changed',
        entityType: 'kds_device',
        entityId: registryId,
        publicData: {
          action: 'updated',
          assignmentChanged: setStation,
          stationId: patch.stationId ?? null,
        },
      });
      return true;
    });
  }

  // ── Exact station board and ordered event feed ─────────────────────────────
  async boardSnapshot(
    merchantId: string,
    locationId: string,
    stationIds: string[],
  ): Promise<TicketRow[]> {
    const { rows } = await this.pg.query<TicketRow>(
      `SELECT v.id::text AS ticket_id,v.source_order_id::text AS source_transaction_id,
              v.public_reference,
              v.merchant_id::text AS merchant_id,v.source AS source_channel,v.status,
              v.location_id::text,v.priority,v.business_date::text,
              v.preparation_started_at,v.version,
              v.station_id::text AS station_id,s.name AS station_name,
              v.queued_at AS created_at,
              v.updated_at AS updated_at,v.last_event_sequence,
              v.items
         FROM kds.station_order v
         JOIN merchant.station s ON s.id=v.station_id AND s.merchant_id=v.merchant_id
        WHERE v.merchant_id=$1::uuid AND v.location_id=$2::uuid
          AND v.station_id=ANY($3::uuid[])
          AND v.status IN ('queued','in_preparation','partially_ready','ready','exception')
        ORDER BY CASE v.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
                 v.queued_at,v.id`,
      [merchantId, locationId, stationIds],
    );
    return rows;
  }

  async ticketEvents(
    merchantId: string,
    locationId: string,
    stationIds: string[],
    afterSequence: number,
    limit: number,
  ): Promise<EventRow[]> {
    const { rows } = await this.pg.query<EventRow>(
      `SELECT e.sequence,e.kitchen_order_id::text AS ticket_id,
              e.merchant_id::text AS merchant_id,ko.source_order_id::text AS source_transaction_id,
              e.kind,e.status,e.occurred_at::text AS occurred_at,'umi_api'::text AS source,
              e.safe_payload AS payload,e.location_id::text,e.station_id::text,
              e.aggregate_version,e.correlation_id
         FROM kds.station_event e
         JOIN merchant.kitchen_order ko ON ko.id=e.kitchen_order_id AND ko.merchant_id=e.merchant_id
        WHERE e.merchant_id=$1::uuid AND e.location_id=$2::uuid
          AND e.sequence > $4
          AND (e.station_id=ANY($3::uuid[]) OR EXISTS (
            SELECT 1 FROM merchant.kitchen_order_item i
             WHERE i.merchant_id=e.merchant_id AND i.kitchen_order_id=e.kitchen_order_id
               AND i.station_id=ANY($3::uuid[])
          ))
        ORDER BY e.sequence ASC
        LIMIT LEAST(GREATEST($5, 1), 500)`,
      [merchantId, locationId, stationIds, afterSequence, limit],
    );
    return rows;
  }

  /** Most-recent events for the dashboard ticker. */
  async recentEvents(merchantId: string, limit: number): Promise<EventRow[]> {
    const { rows } = await this.pg.query<EventRow>(
      `SELECT e.sequence,e.kitchen_order_id AS ticket_id,e.merchant_id,
              ko.source_order_id AS source_transaction_id,e.kind,e.status,
              e.occurred_at,'umi_api'::text AS source,e.safe_payload AS payload
         FROM merchant.kitchen_event e
         JOIN merchant.kitchen_order ko
           ON ko.merchant_id=e.merchant_id AND ko.id=e.kitchen_order_id
        WHERE e.merchant_id = $1::uuid
        ORDER BY e.sequence DESC
        LIMIT LEAST(GREATEST($2, 1), 200)`,
      [merchantId, limit],
    );
    return rows;
  }

  /** Dashboard order list (status filter + recent window). */
  async listOrders(
    merchantId: string,
    statuses: KitchenStatus[] | null,
    locationId: string | null,
    sinceHours: number,
  ): Promise<TicketRow[]> {
    const params: unknown[] = [merchantId, sinceHours];
    let statusClause = '';
    if (statuses && statuses.length) {
      const canonical = statuses.flatMap((status) => {
        if (status === 'new' || status === 'accepted') return ['queued'];
        if (status === 'preparing') return ['in_preparation'];
        if (status === 'partial_cancelled') return ['partially_ready'];
        return [status];
      });
      params.push([...new Set(canonical)]);
      statusClause = `AND ko.status = ANY($${params.length}::text[])`;
    }
    let locClause = '';
    if (locationId) {
      params.push(locationId);
      locClause = `AND ko.location_id = $${params.length}::uuid`;
    }
    const { rows } = await this.pg.query<TicketRow>(
      `SELECT ko.id AS ticket_id,ko.source_order_id AS source_transaction_id,
              ko.public_reference,
              ko.merchant_id,ko.source AS source_channel,ko.status,
              NULL::uuid AS station_id,NULL::text AS station_name,
              ko.created_at,ko.updated_at,
              coalesce(e.last_event_sequence,0) AS last_event_sequence,
              coalesce(jsonb_agg(jsonb_build_object(
                'id',i.id::text,'productName',i.product_name,'variantName',i.variant_name,
                'modifiers',i.modifiers,'quantity',i.quantity,'preparationNote',i.preparation_note,
                'displayOrder',i.display_order,'targetSeconds',i.target_seconds,
                'status',i.status,'version',i.version
              ) order by i.display_order,i.id) filter (where i.id is not null),'[]'::jsonb) AS items
         FROM merchant.kitchen_order ko
         JOIN merchant.kitchen_order_item i
           ON i.merchant_id=ko.merchant_id AND i.kitchen_order_id=ko.id
         LEFT JOIN LATERAL (
           SELECT max(event.sequence) AS last_event_sequence
             FROM merchant.kitchen_event event
            WHERE event.merchant_id=ko.merchant_id AND event.kitchen_order_id=ko.id
         ) e ON true
        WHERE ko.merchant_id = $1::uuid
          AND ko.created_at >= now() - make_interval(hours => $2)
          ${statusClause}
          ${locClause}
        GROUP BY ko.id,e.last_event_sequence
        ORDER BY ko.created_at DESC`,
      params,
    );
    return rows;
  }

  // ── Command writes (transition / partial cancel) ───────────────────────────

  /** Load an order for the device-scope check (merchant-scoped; by id or source tx). */
  async loadOrderForScope(
    merchantId: string,
    ticketId: string,
    ticketUuid: string | null,
  ): Promise<OrderScopeRow | null> {
    const { rows } = await this.pg.query<
      OrderScopeRow & { status: KitchenOrderStatus; station_ids: string[]; version: string }
    >(
      `SELECT ko.id,ko.merchant_id,ko.location_id,
              min(i.station_id)::text AS station_id,
              array_agg(DISTINCT i.station_id::text) FILTER (WHERE i.station_id IS NOT NULL)
                AS station_ids,
              ko.status,ko.version::text,co.customer_id AS person_id,
              coalesce(co.external_ref,co.id::text) AS source_transaction_id
         FROM merchant.kitchen_order ko
         JOIN merchant.customer_order co ON co.id=ko.source_order_id AND co.merchant_id=ko.merchant_id
         JOIN merchant.kitchen_order_item i ON i.kitchen_order_id=ko.id AND i.merchant_id=ko.merchant_id
        WHERE ko.merchant_id=$3::uuid
          AND (($2::uuid IS NOT NULL AND ko.id=$2::uuid)
               OR ko.public_reference=$1 OR co.external_ref=$1)
        GROUP BY ko.id,co.id
        LIMIT 1`,
      [ticketId, ticketUuid, merchantId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      ...row,
      version: Number(row.version),
      kitchen_order_status: row.status,
      kitchen_status: mapCanonicalKitchenStatus(row.status),
    };
  }

  async executeKitchenCommand(input: {
    session: Omit<KdsDeviceSession, 'deviceId'> & { deviceId: string | null };
    actorUserId?: string | null;
    order: OrderScopeRow;
    commandId: string;
    idempotencyKey: string;
    correlationId: string;
    expectedVersion: number;
    commandType:
      | 'start_preparation'
      | 'mark_item_ready'
      | 'mark_order_ready'
      | 'complete'
      | 'recall'
      | 'cancel_ack'
      | 'change_priority';
    targetStatus: KitchenOrderStatus | null;
    itemIds: string[];
    reasonCode: string | null;
    reasonNote: string | null;
    priority: 'normal' | 'high' | 'urgent' | null;
    payloadFingerprint: string;
  }): Promise<{ status: 'succeeded' | 'conflict'; result: Record<string, unknown> }> {
    return this.pg.workerTx(async (client) => {
      const replay = await client.query<{
        id: string;
        idempotency_key: string;
        payload_fingerprint: string;
        status: string;
        result: Record<string, unknown> | null;
      }>(
        `SELECT id::text,idempotency_key,payload_fingerprint,status,result
           FROM merchant.kitchen_command
          WHERE merchant_id=$1::uuid AND (idempotency_key=$2 OR id=$3::uuid)
          FOR UPDATE`,
        [input.order.merchant_id, input.idempotencyKey, input.commandId],
      );
      if (replay.rows[0]) {
        if (
          replay.rows[0].id !== input.commandId ||
          replay.rows[0].idempotency_key !== input.idempotencyKey ||
          replay.rows[0].payload_fingerprint !== input.payloadFingerprint
        ) {
          return { status: 'conflict', result: { code: 'KITCHEN_FINGERPRINT_CONFLICT' } };
        }
        return {
          status: replay.rows[0].status === 'succeeded' ? 'succeeded' : 'conflict',
          result: replay.rows[0].result ?? { code: 'KITCHEN_COMMAND_CONFLICT' },
        };
      }

      const locked = await client.query<{
        id: string;
        status: KitchenOrderStatus;
        version: string;
        location_id: string;
      }>(
        `SELECT id::text,status,version::text,location_id::text
           FROM merchant.kitchen_order
          WHERE id=$1::uuid AND merchant_id=$2::uuid AND location_id=$3::uuid
          FOR UPDATE`,
        [input.order.id, input.order.merchant_id, input.session.locationId],
      );
      const current = locked.rows[0];
      const stationId = input.session.stationId;
      if (!current || !stationId || !input.session.locationId) {
        return { status: 'conflict', result: { code: 'KITCHEN_SCOPE_CONFLICT' } };
      }
      const assigned = await client.query(
        `SELECT 1 FROM merchant.kitchen_order_item i
          WHERE i.merchant_id=$1::uuid AND i.kitchen_order_id=$2::uuid
            AND i.station_id=$3::uuid LIMIT 1`,
        [input.order.merchant_id, input.order.id, stationId],
      );
      if (!assigned.rows[0]) {
        return { status: 'conflict', result: { code: 'KITCHEN_STATION_SCOPE_CONFLICT' } };
      }

      const command = await client.query(
        `INSERT INTO merchant.kitchen_command
           (id,merchant_id,location_id,device_id,actor_user_id,kitchen_order_id,kitchen_order_item_id,
            command_type,idempotency_key,payload_fingerprint,expected_version,status,
            correlation_id)
         VALUES ($1::uuid,$2::uuid,$3::uuid,
                 (SELECT s.principal_id FROM runtime.session s
                   WHERE s.id=$11::uuid AND s.merchant_id=$2::uuid AND s.is_active),
                 $12::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,'pending',$10)
         ON CONFLICT DO NOTHING`,
        [
          input.commandId,
          input.order.merchant_id,
          input.session.locationId,
          input.order.id,
          input.itemIds[0] ?? null,
          input.commandType,
          input.idempotencyKey,
          input.payloadFingerprint,
          input.expectedVersion,
          input.correlationId,
          input.session.deviceId,
          input.actorUserId ?? null,
        ],
      );
      if ((command.rowCount ?? 0) !== 1) {
        const winner = await client.query<{
          id: string;
          idempotency_key: string;
          payload_fingerprint: string;
          status: string;
          result: Record<string, unknown> | null;
        }>(
          `SELECT id::text,idempotency_key,payload_fingerprint,status,result
             FROM merchant.kitchen_command
            WHERE merchant_id=$1::uuid AND (idempotency_key=$2 OR id=$3::uuid)`,
          [input.order.merchant_id, input.idempotencyKey, input.commandId],
        );
        const recovered = winner.rows[0];
        if (
          recovered?.id === input.commandId &&
          recovered.idempotency_key === input.idempotencyKey &&
          recovered.payload_fingerprint === input.payloadFingerprint
        ) {
          return {
            status: recovered.status === 'succeeded' ? 'succeeded' : 'conflict',
            result: recovered.result ?? { code: 'KITCHEN_COMMAND_CONFLICT' },
          };
        }
        return { status: 'conflict', result: { code: 'KITCHEN_FINGERPRINT_CONFLICT' } };
      }

      if (Number(current.version) !== input.expectedVersion) {
        const result = {
          code: 'KITCHEN_VERSION_CONFLICT',
          expectedVersion: input.expectedVersion,
          currentVersion: Number(current.version),
        };
        await finishKitchenCommand(client, input.commandId, 'conflict', result);
        return { status: 'conflict', result };
      }

      const requestedStatus = commandTarget(input.commandType, current.status);
      if (
        requestedStatus &&
        !(
          requestedStatus === current.status &&
          ['start_preparation', 'mark_item_ready', 'mark_order_ready'].includes(input.commandType)
        ) &&
        validateKitchenTransition(current.status, requestedStatus, input.commandType === 'recall')
      ) {
        const result = { code: 'KITCHEN_INVALID_TRANSITION', currentStatus: current.status };
        await finishKitchenCommand(client, input.commandId, 'conflict', result);
        return { status: 'conflict', result };
      }

      let effectCount = 1;
      if (input.commandType === 'start_preparation' || input.commandType === 'recall') {
        const effect = await client.query(
          `UPDATE merchant.kitchen_order_item SET status='preparing',version=version+1,
                  preparation_started_at=coalesce(preparation_started_at,clock_timestamp()),
                  updated_at=clock_timestamp()
            WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid AND station_id=$3::uuid
              AND status IN ('queued','ready')`,
          [input.order.merchant_id, input.order.id, stationId],
        );
        effectCount = effect.rowCount ?? 0;
      } else if (input.commandType === 'mark_item_ready') {
        if (input.itemIds.length === 0) {
          effectCount = 0;
        } else {
          const eligible = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM merchant.kitchen_order_item
              WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid AND station_id=$3::uuid
                AND id=ANY($4::uuid[]) AND status IN ('queued','preparing')`,
            [input.order.merchant_id, input.order.id, stationId, input.itemIds],
          );
          if (Number(eligible.rows[0]?.count ?? 0) !== input.itemIds.length) {
            effectCount = 0;
          } else {
            const effect = await client.query(
              `UPDATE merchant.kitchen_order_item SET status='ready',version=version+1,
                  ready_at=clock_timestamp(),updated_at=clock_timestamp()
                WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid AND station_id=$3::uuid
                  AND id=ANY($4::uuid[]) AND status IN ('queued','preparing')`,
              [input.order.merchant_id, input.order.id, stationId, input.itemIds],
            );
            effectCount = effect.rowCount ?? 0;
          }
        }
      } else if (input.commandType === 'mark_order_ready') {
        const effect = await client.query(
          `UPDATE merchant.kitchen_order_item SET status='ready',version=version+1,
                  ready_at=clock_timestamp(),updated_at=clock_timestamp()
            WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid AND station_id=$3::uuid
              AND status IN ('queued','preparing')`,
          [input.order.merchant_id, input.order.id, stationId],
        );
        effectCount = effect.rowCount ?? 0;
      } else if (input.commandType === 'cancel_ack') {
        const eligible =
          input.itemIds.length === 0
            ? null
            : await client.query<{ count: string }>(
                `SELECT count(*)::text AS count FROM merchant.kitchen_order_item
                  WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid
                    AND station_id=$3::uuid AND id=ANY($4::uuid[])
                    AND status NOT IN ('cancelled','ready')`,
                [input.order.merchant_id, input.order.id, stationId, input.itemIds],
              );
        if (eligible && Number(eligible.rows[0]?.count ?? 0) !== input.itemIds.length) {
          effectCount = 0;
        } else {
          const effect = await client.query(
            `UPDATE merchant.kitchen_order_item SET status='cancelled',version=version+1,
                  cancelled_at=clock_timestamp(),updated_at=clock_timestamp()
              WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid AND station_id=$3::uuid
                AND (cardinality($4::uuid[])=0 OR id=ANY($4::uuid[]))
                AND status NOT IN ('cancelled','ready')`,
            [input.order.merchant_id, input.order.id, stationId, input.itemIds],
          );
          effectCount = effect.rowCount ?? 0;
        }
      }
      if (effectCount === 0) {
        const result = { code: 'KITCHEN_INVALID_TRANSITION', currentStatus: current.status };
        await finishKitchenCommand(client, input.commandId, 'conflict', result);
        return { status: 'conflict', result };
      }

      const itemRows = await client.query<{ status: KitchenItemStatus }>(
        `SELECT status FROM merchant.kitchen_order_item
          WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid`,
        [input.order.merchant_id, input.order.id],
      );
      let nextStatus: KitchenOrderStatus;
      if (input.commandType === 'complete') nextStatus = 'completed';
      else if (input.commandType === 'change_priority') nextStatus = current.status;
      else nextStatus = deriveKitchenOrderStatus(itemRows.rows.map((row) => row.status));
      const nextVersion = Number(current.version) + 1;
      const updated = await client.query<{ updated_at: Date | string }>(
        `UPDATE merchant.kitchen_order
            SET status=$3,priority=coalesce($4,priority),version=$5,
                preparation_started_at=CASE WHEN $3='in_preparation'
                  THEN coalesce(preparation_started_at,clock_timestamp()) ELSE preparation_started_at END,
                ready_at=CASE WHEN $3='ready' THEN clock_timestamp() ELSE ready_at END,
                completed_at=CASE WHEN $3='completed' THEN clock_timestamp() ELSE completed_at END,
                cancelled_at=CASE WHEN $3='cancelled' THEN clock_timestamp() ELSE cancelled_at END,
                cancellation_code=coalesce($6,cancellation_code),
                cancellation_note=coalesce($7,cancellation_note),updated_at=clock_timestamp()
          WHERE id=$1::uuid AND merchant_id=$2::uuid
          RETURNING updated_at`,
        [
          input.order.id,
          input.order.merchant_id,
          nextStatus,
          input.priority,
          nextVersion,
          input.reasonCode,
          input.reasonNote,
        ],
      );
      const kind = kitchenEventKind(input.commandType);
      const event = await client.query<{ sequence: string }>(
        `INSERT INTO merchant.kitchen_event
           (event_id,merchant_id,location_id,kitchen_order_id,kitchen_order_item_id,
            station_id,kind,aggregate_version,status,safe_payload,correlation_id)
         VALUES (gen_random_uuid(),$1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,
                 jsonb_build_object('reasonCode',$9::text),$10)
         RETURNING sequence::text`,
        [
          input.order.merchant_id,
          input.session.locationId,
          input.order.id,
          input.itemIds[0] ?? null,
          stationId,
          kind,
          nextVersion,
          nextStatus,
          input.reasonCode,
          input.correlationId,
        ],
      );
      await client.query(
        `INSERT INTO merchant.audit_event
           (merchant_id,location_id,actor_user_id,command_id,event_type,entity_type,entity_id,outcome,
            public_data,correlation_id,event_hash)
         VALUES ($1::uuid,$2::uuid,$9::uuid,$3::uuid,$4,'kitchen_order',$5::uuid,'success',
                 jsonb_build_object('stationId',$6::text,'status',$7::text),$8,'')`,
        [
          input.order.merchant_id,
          input.session.locationId,
          input.commandId,
          `kitchen.${input.commandType}`,
          input.order.id,
          stationId,
          nextStatus,
          input.correlationId,
          input.actorUserId ?? null,
        ],
      );
      const result = {
        kitchenOrderId: input.order.id,
        status: nextStatus,
        version: nextVersion,
        sequence: Number(event.rows[0]?.sequence ?? 0),
        updatedAt: new Date(updated.rows[0].updated_at).toISOString(),
      };
      await finishKitchenCommand(client, input.commandId, 'succeeded', result);
      return { status: 'succeeded', result };
    });
  }
}
