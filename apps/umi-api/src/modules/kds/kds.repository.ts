import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PgService } from '../../shared/database/pg.service';
import {
  BOARD_ACTIVE_STATUSES,
  KdsHttpError,
  type KitchenStatus,
  mapKitchenToOrderStatus,
  randomHex,
  sha256Hex,
  TERMINAL_STATUSES,
  validateTransition,
} from './dto/kds-contract';

/**
 * All KDS SQL. Everything runs on the **worker pool** (`pg.query` / `pg.workerTx`)
 * with an explicit `tenant_id = $1` predicate in every statement — NOT the RLS
 * `withTenant` path — for three reasons (spec §9.1/§11.2):
 *   1. the iPad path has no authenticated member user, so RLS would hide rows;
 *   2. `device.*` carries auth secrets (`token_hash`/`pin_hash`/`pin_salt`)
 *      REVOKEd from `umi_app`;
 *   3. transitions write `queue.outbox_events` (service-role-only schema).
 * Cross-tenant isolation is enforced by the explicit predicate + the guard stack
 * on the dashboard routes / the device-session scope on the iPad routes — the
 * same model the public cash routes use.
 *
 * There is no canonical `kds.*` schema or transition RPC: tickets are the
 * `ops.v_kds_tickets` projection over `ops.orders`/`ops.order_items`, and the
 * board write is `ops.order_items/orders.kitchen_status` + an append-only
 * `ops.order_events` row (+ an outbox notification).
 */

export interface StationRow {
  id: string;
  tenant_id: string;
  location_id: string | null;
  name: string;
}

export interface PairingRow {
  id: string;
  tenant_id: string;
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
  tenant_id: string;
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
  tenant_id: string;
  station_id: string | null;
  device_name: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
}

export interface OrderScopeRow {
  id: string;
  tenant_id: string;
  location_id: string | null;
  station_id: string | null;
  kitchen_status: KitchenStatus | null;
  person_id: string | null;
  source_transaction_id: string | null;
}

/** A raw v_kds_tickets row (+ joined name/phone/last-seq). Remapped in the service. */
export interface TicketRow {
  ticket_id: string;
  source_transaction_id: string | null;
  business_id: string;
  source_channel: string | null;
  status: KitchenStatus;
  station_id: string | null;
  station_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  pickup_person: string | null;
  customer_note: string | null;
  total_amount: string | number;
  created_at: string;
  updated_at: string;
  last_event_sequence: string | number;
  items: unknown;
}

export interface EventRow {
  sequence: string | number;
  ticket_id: string;
  business_id: string;
  source_transaction_id: string | null;
  kind: string | null;
  status: string | null;
  occurred_at: string;
  source: string | null;
  payload: unknown;
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

  // ── Stations (kitchen.stations) ────────────────────────────────────────────

  /** Active station within the tenant (+ optional location scope). */
  async loadStation(
    tenantId: string,
    locationId: string | null,
    stationId: string,
  ): Promise<StationRow | null> {
    // A missing locationId means "unscoped" (match the station at any location) —
    // NOT "root-location only". listStations() returns all-location stations, so
    // forcing location_id IS NULL here would reject a valid dashboard selection.
    const locClause = locationId ? 'AND location_id = $3' : '';
    const params = locationId
      ? [stationId, tenantId, locationId]
      : [stationId, tenantId];
    const { rows } = await this.pg.query<StationRow>(
      `SELECT id, tenant_id, location_id, name
         FROM kitchen.stations
        WHERE id = $1 AND tenant_id = $2 AND status = 'active' ${locClause}
        LIMIT 1`,
      params,
    );
    return rows[0] ?? null;
  }

  async listStations(
    tenantId: string,
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
    const params = locationId ? [tenantId, locationId] : [tenantId];
    const { rows } = await this.pg.query(
      `SELECT id, station_key, name, status, sort_order, location_id
         FROM kitchen.stations
        WHERE tenant_id = $1 AND status = 'active' ${locClause}
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

  /** Create an active station. `sort_order` defaults to 0 (DB default). */
  async createStation(input: {
    tenantId: string;
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
    const { rows } = await this.pg.query(
      `INSERT INTO kitchen.stations (tenant_id, location_id, station_key, name)
         VALUES ($1, $2, $3, $4)
       RETURNING id, station_key, name, status, sort_order, location_id`,
      [input.tenantId, input.locationId, input.stationKey, input.name],
    );
    return rows[0] as {
      id: string;
      station_key: string;
      name: string;
      status: string;
      sort_order: number;
      location_id: string | null;
    };
  }

  /** Rename an active/disabled station. Returns null if not found. */
  async updateStation(input: {
    tenantId: string;
    stationId: string;
    name: string;
  }): Promise<{
    id: string;
    station_key: string;
    name: string;
    status: string;
    sort_order: number;
    location_id: string | null;
  } | null> {
    const { rows } = await this.pg.query(
      `UPDATE kitchen.stations
          SET name = $3, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND status <> 'archived'
      RETURNING id, station_key, name, status, sort_order, location_id`,
      [input.stationId, input.tenantId, input.name],
    );
    return (
      (rows[0] as {
        id: string;
        station_key: string;
        name: string;
        status: string;
        sort_order: number;
        location_id: string | null;
      }) ?? null
    );
  }

  /**
   * Soft-delete a station (status → 'archived'). Never a hard DELETE: devices,
   * pairings and orders reference `station_id`, so archiving keeps history intact
   * while hiding it from the active list. Returns false if not found / already
   * archived.
   */
  async archiveStation(tenantId: string, stationId: string): Promise<boolean> {
    const { rowCount } = await this.pg.query(
      `UPDATE kitchen.stations
          SET status = 'archived', updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND status <> 'archived'`,
      [stationId, tenantId],
    );
    return (rowCount ?? 0) > 0;
  }

  // ── Pairing (device.pairing_requests) ──────────────────────────────────────

  async insertPairingRequest(input: {
    tenantId: string;
    locationId: string | null;
    stationId: string;
    deviceName: string;
    pinHash: string;
    pinSalt: string;
    maxAttempts: number;
    expiresAt: string;
  }): Promise<PairingRow> {
    const { rows } = await this.pg.query<PairingRow>(
      `INSERT INTO device.pairing_requests
         (tenant_id, location_id, station_id, device_name,
          pin_hash, pin_salt, status, max_attempts, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
       RETURNING id, tenant_id, location_id, station_id, device_name,
                 status, expires_at, created_at`,
      [
        input.tenantId,
        input.locationId,
        input.stationId,
        input.deviceName,
        input.pinHash,
        input.pinSalt,
        input.maxAttempts,
        input.expiresAt,
      ],
    );
    return rows[0];
  }

  async listPairingRequests(
    tenantId: string,
    locationId: string | null,
    limit: number,
  ): Promise<Record<string, unknown>[]> {
    const locClause = locationId
      ? 'AND location_id = $2'
      : 'AND location_id IS NULL';
    const params = locationId
      ? [tenantId, locationId, limit]
      : [tenantId, limit];
    const limitParam = locationId ? '$3' : '$2';
    const { rows } = await this.pg.query(
      `SELECT id, tenant_id, location_id, station_id, device_name, requested_name,
              status, attempt_count, max_attempts, expires_at,
              approved_by, approved_at, used_at, denied_at, created_at
         FROM device.pairing_requests
        WHERE tenant_id = $1 AND status IN ('pending', 'approved') ${locClause}
        ORDER BY created_at DESC
        LIMIT ${limitParam}`,
      params,
    );
    return rows as Record<string, unknown>[];
  }

  /** Set a pairing pending→approved/denied. Returns null if not still pending. */
  async dispositionPairing(
    pairingId: string,
    tenantId: string,
    action: 'approve' | 'deny',
    adminUserId: string | null,
  ): Promise<{ id: string; status: string } | null> {
    const patch =
      action === 'approve'
        ? `status = 'approved', approved_by = $3, approved_at = now(), updated_at = now()`
        : `status = 'denied', denied_at = now(), updated_at = now()`;
    const params =
      action === 'approve'
        ? [pairingId, tenantId, adminUserId]
        : [pairingId, tenantId];
    const { rows } = await this.pg.query<{ id: string; status: string }>(
      `UPDATE device.pairing_requests
          SET ${patch}
        WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
          AND expires_at > now()
        RETURNING id, status`,
      params,
    );
    return rows[0] ?? null;
  }

  /** Newest pending non-expired requests, for the global PIN match (kds_start). */
  async findPendingPairingsForPin(
    limit: number,
  ): Promise<PairingPollRow[]> {
    const { rows } = await this.pg.query<PairingPollRow>(
      `SELECT id, pin_hash, pin_salt, status, attempt_count, max_attempts, expires_at
         FROM device.pairing_requests
        WHERE status = 'pending' AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    );
    return rows;
  }

  /** Record the device's chosen name after a PIN match (does not touch attempts). */
  async setPairingRequestedName(
    pairingId: string,
    requestedName: string,
  ): Promise<void> {
    await this.pg.query(
      `UPDATE device.pairing_requests
          SET requested_name = $2, updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [pairingId, requestedName],
    );
  }

  /** Read a pairing by id only (the iPad polls by pairing_id). */
  async getPairing(pairingId: string): Promise<PairingStatusRow | null> {
    const { rows } = await this.pg.query<PairingStatusRow>(
      `SELECT id, tenant_id, location_id, station_id, device_name, requested_name,
              status, expires_at, used_at
         FROM device.pairing_requests
        WHERE id = $1
        LIMIT 1`,
      [pairingId],
    );
    return rows[0] ?? null;
  }

  async expirePairing(pairingId: string): Promise<void> {
    await this.pg.query(
      `UPDATE device.pairing_requests
          SET status = 'expired', updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [pairingId],
    );
  }

  /** Atomically claim an approved pairing (guards concurrent device claims). */
  async claimPairing(pairingId: string): Promise<boolean> {
    const { rows } = await this.pg.query<{ id: string }>(
      `UPDATE device.pairing_requests
          SET status = 'used', used_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'approved' AND used_at IS NULL
        RETURNING id`,
      [pairingId],
    );
    return rows.length > 0;
  }

  // ── Device sessions (device.sessions) ──────────────────────────────────────

  /**
   * Provision a device for a claimed pairing in ONE worker transaction: a durable
   * `device.devices` registry row (typed `kds` — the same registry POS/printers
   * will use, discriminated by `device_type`) + a `device.sessions` row linked to
   * it. Returns the one-time plaintext token (never stored — only its sha256 hash
   * is) and the registry id (`device_registry_id`) for race cleanup. The session
   * `id` stays the frozen `device_session.device_id` the iPad sees. `device.sessions`
   * has no `location_id` column, so the location is parked in `metadata`.
   */
  async createDeviceSession(input: {
    tenantId: string;
    locationId: string | null;
    stationId: string | null;
    deviceName: string;
  }): Promise<{
    id: string;
    tenant_id: string;
    station_id: string | null;
    device_name: string | null;
    token: string;
    device_registry_id: string;
  }> {
    const token = randomHex(32);
    const tokenHash = sha256Hex(token);
    return this.pg.workerTx(async (client) => {
      const dev = await client.query<{ id: string }>(
        `INSERT INTO device.devices
           (tenant_id, location_id, station_id, name, device_type, status)
         VALUES ($1, $2, $3, $4, 'kds', 'active')
         RETURNING id`,
        [input.tenantId, input.locationId, input.stationId, input.deviceName],
      );
      const deviceRegistryId = dev.rows[0].id;
      const sess = await client.query<{
        id: string;
        tenant_id: string;
        station_id: string | null;
        device_name: string | null;
      }>(
        `INSERT INTO device.sessions
           (tenant_id, device_id, station_id, device_name, token_hash, is_active, metadata)
         VALUES ($1, $2, $3, $4, $5, true, jsonb_build_object('location_id', $6::text))
         RETURNING id, tenant_id, station_id, device_name`,
        [
          input.tenantId,
          deviceRegistryId,
          input.stationId,
          input.deviceName,
          tokenHash,
          input.locationId,
        ],
      );
      return { ...sess.rows[0], token, device_registry_id: deviceRegistryId };
    });
  }

  /** Cleanup for a lost claim race — delete the registry row (cascades the session). */
  async deleteDevice(deviceRegistryId: string): Promise<void> {
    await this.pg.query(`DELETE FROM device.devices WHERE id = $1`, [
      deviceRegistryId,
    ]);
  }

  /** Device-auth lookup by token hash (the token itself is never stored). */
  async findSessionByToken(tokenHash: string): Promise<SessionRow | null> {
    const { rows } = await this.pg.query<SessionRow>(
      `SELECT id, tenant_id, station_id, device_name, is_active, metadata
         FROM device.sessions
        WHERE token_hash = $1
        LIMIT 1`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  /** Liveness touch on every board/command poll (the prod heartbeat signal). */
  async touchSession(sessionId: string): Promise<void> {
    await this.pg.query(
      `UPDATE device.sessions SET last_used_at = now() WHERE id = $1`,
      [sessionId],
    );
  }

  /** Heartbeat endpoint: touch + record source ip in metadata. */
  async heartbeatTouch(
    deviceId: string,
    ip: string | null,
  ): Promise<boolean> {
    const { rowCount } = await this.pg.query(
      `UPDATE device.sessions
          SET last_used_at = now(),
              metadata = metadata || jsonb_build_object('ip', $2::text)
        WHERE id = $1 AND is_active = true`,
      [deviceId, ip],
    );
    return (rowCount ?? 0) > 0;
  }

  async listDevices(
    tenantId: string,
    locationId: string | null,
  ): Promise<DeviceListRow[]> {
    const locClause = locationId ? `AND s.metadata->>'location_id' = $2` : '';
    const params = locationId ? [tenantId, locationId] : [tenantId];
    const { rows } = await this.pg.query<DeviceListRow>(
      `SELECT s.id AS device_id, s.device_id AS device_registry_id,
              dv.device_type, s.station_id, st.name AS station_name,
              s.device_name, s.last_used_at, s.is_active, s.metadata
         FROM device.sessions s
         LEFT JOIN device.devices dv
           ON dv.tenant_id = s.tenant_id AND dv.id = s.device_id
         LEFT JOIN kitchen.stations st
           ON st.tenant_id = s.tenant_id AND st.id = s.station_id
        WHERE s.tenant_id = $1 AND s.is_active = true ${locClause}
        ORDER BY s.last_used_at DESC NULLS LAST, s.created_at DESC`,
      params,
    );
    return rows;
  }

  /** Deactivate the session and archive its registry device row (one tx). */
  async revokeSession(tenantId: string, deviceId: string): Promise<boolean> {
    return this.pg.workerTx(async (client) => {
      const sess = await client.query(
        `UPDATE device.sessions SET is_active = false
          WHERE id = $1 AND tenant_id = $2
        RETURNING device_id`,
        [deviceId, tenantId],
      );
      if (sess.rowCount === 0) return false;
      const registryId = sess.rows[0]?.device_id;
      if (registryId) {
        await client.query(
          `UPDATE device.devices SET status = 'archived', updated_at = now()
            WHERE id = $1 AND tenant_id = $2`,
          [registryId, tenantId],
        );
      }
      return true;
    });
  }

  /** Update the session's display fields and keep the registry row in sync. */
  async updateSession(
    tenantId: string,
    deviceId: string,
    patch: { deviceName?: string | null; stationId?: string | null },
  ): Promise<boolean> {
    // stationId === undefined → the PATCH omitted station_id, so leave it
    // untouched (a rename must not wipe the assignment). An explicit null clears.
    const setStation = patch.stationId !== undefined;
    return this.pg.workerTx(async (client) => {
      const sess = await client.query(
        `UPDATE device.sessions
            SET device_name = COALESCE($3, device_name),
                station_id  = CASE WHEN $5 THEN $4 ELSE station_id END
          WHERE id = $1 AND tenant_id = $2
        RETURNING device_id`,
        [
          deviceId,
          tenantId,
          patch.deviceName ?? null,
          patch.stationId ?? null,
          setStation,
        ],
      );
      if (sess.rowCount === 0) return false;
      const registryId = sess.rows[0]?.device_id;
      if (registryId) {
        await client.query(
          `UPDATE device.devices
              SET name = COALESCE($3, name),
                  station_id = CASE WHEN $5 THEN $4 ELSE station_id END,
                  updated_at = now()
            WHERE id = $1 AND tenant_id = $2`,
          [
            registryId,
            tenantId,
            patch.deviceName ?? null,
            patch.stationId ?? null,
            setStation,
          ],
        );
      }
      return true;
    });
  }

  // ── Board reads (ops.v_kds_tickets + ops.order_events) ─────────────────────

  /**
   * Board snapshot for a device. Reads the canonical projection, resolves
   * customer name/phone from `core.people`, derives `last_event_sequence`, and
   * scopes by tenant + station (NULL station = broadcast, matching the legacy
   * `get_board_snapshot`). Only on-board (non-terminal) statuses are returned —
   * a deliberate bound over the unfiltered legacy snapshot (the live view keeps
   * completed/cancelled orders forever). The service remaps items to the frozen
   * shape (`unit_price` in currency units).
   */
  async boardSnapshot(
    tenantId: string,
    stationId: string | null,
    statuses: KitchenStatus[] = BOARD_ACTIVE_STATUSES,
  ): Promise<TicketRow[]> {
    const { rows } = await this.pg.query<TicketRow>(
      `SELECT t.ticket_id,
              t.source_transaction_id,
              t.tenant_id        AS business_id,
              t.source_channel,
              t.status,
              t.station_id,
              t.station_name,
              p.display_name     AS customer_name,
              p.normalized_phone AS customer_phone,
              t.pickup_person,
              t.customer_note,
              (t.total_cents::numeric / 100) AS total_amount,
              t.created_at,
              t.updated_at,
              COALESCE(ev.last_seq, 0) AS last_event_sequence,
              t.items
         FROM ops.v_kds_tickets t
         LEFT JOIN core.people p
           ON p.tenant_id = t.tenant_id AND p.id = t.customer_person_id
         LEFT JOIN LATERAL (
           SELECT MAX(oe.kitchen_sequence) AS last_seq
             FROM ops.order_events oe
            WHERE oe.tenant_id = t.tenant_id AND oe.order_id = t.ticket_id
         ) ev ON true
        WHERE t.tenant_id = $1
          AND ($2::text IS NULL OR t.station_id IS NULL OR t.station_id = $2)
          AND t.status = ANY($3::text[])
        ORDER BY t.created_at ASC`,
      [tenantId, stationId, statuses],
    );
    return rows;
  }

  /**
   * Event stream cursor (ops.order_events ordered by kitchen_sequence), scoped
   * to the device's station the same way the board snapshot is (NULL-station
   * orders broadcast to every board) so a station-bound iPad can't read other
   * stations' events through the cursor.
   */
  async ticketEvents(
    tenantId: string,
    stationId: string | null,
    afterSequence: number,
    limit: number,
  ): Promise<EventRow[]> {
    const { rows } = await this.pg.query<EventRow>(
      `SELECT e.kitchen_sequence       AS sequence,
              e.order_id                AS ticket_id,
              e.tenant_id               AS business_id,
              o.source_transaction_id,
              e.event_kind              AS kind,
              e.new_status              AS status,
              e.occurred_at,
              e.source,
              e.payload
         FROM ops.order_events e
         JOIN ops.orders o
           ON o.tenant_id = e.tenant_id AND o.id = e.order_id
        WHERE e.tenant_id = $1
          AND e.kitchen_sequence IS NOT NULL
          AND e.kitchen_sequence > $3
          AND ($2::text IS NULL OR o.station_id IS NULL OR o.station_id = $2)
        ORDER BY e.kitchen_sequence ASC
        LIMIT LEAST(GREATEST($4, 1), 1000)`,
      [tenantId, stationId, afterSequence, limit],
    );
    return rows;
  }

  /** Most-recent events for the dashboard ticker. */
  async recentEvents(
    tenantId: string,
    limit: number,
  ): Promise<EventRow[]> {
    const { rows } = await this.pg.query<EventRow>(
      `SELECT e.kitchen_sequence       AS sequence,
              e.order_id                AS ticket_id,
              e.tenant_id               AS business_id,
              o.source_transaction_id,
              e.event_kind              AS kind,
              e.new_status              AS status,
              e.occurred_at,
              e.source,
              e.payload
         FROM ops.order_events e
         JOIN ops.orders o
           ON o.tenant_id = e.tenant_id AND o.id = e.order_id
        WHERE e.tenant_id = $1 AND e.kitchen_sequence IS NOT NULL
        ORDER BY e.kitchen_sequence DESC
        LIMIT LEAST(GREATEST($2, 1), 200)`,
      [tenantId, limit],
    );
    return rows;
  }

  /** Dashboard order list (status filter + recent window). */
  async listOrders(
    tenantId: string,
    statuses: KitchenStatus[] | null,
    locationId: string | null,
    sinceHours: number,
  ): Promise<TicketRow[]> {
    const params: unknown[] = [tenantId, sinceHours];
    let statusClause = '';
    if (statuses && statuses.length) {
      params.push(statuses);
      statusClause = `AND t.status = ANY($${params.length}::text[])`;
    }
    let locClause = '';
    if (locationId) {
      params.push(locationId);
      locClause = `AND o.location_id = $${params.length}`;
    }
    const { rows } = await this.pg.query<TicketRow>(
      `SELECT t.ticket_id,
              t.source_transaction_id,
              t.tenant_id        AS business_id,
              t.source_channel,
              t.status,
              t.station_id,
              t.station_name,
              p.display_name     AS customer_name,
              p.normalized_phone AS customer_phone,
              t.pickup_person,
              t.customer_note,
              (t.total_cents::numeric / 100) AS total_amount,
              t.created_at,
              t.updated_at,
              0 AS last_event_sequence,
              t.items
         FROM ops.v_kds_tickets t
         JOIN ops.orders o ON o.tenant_id = t.tenant_id AND o.id = t.ticket_id
         LEFT JOIN core.people p
           ON p.tenant_id = t.tenant_id AND p.id = t.customer_person_id
        WHERE t.tenant_id = $1
          AND t.created_at >= now() - make_interval(hours => $2)
          ${statusClause}
          ${locClause}
        ORDER BY t.created_at DESC`,
      params,
    );
    return rows;
  }

  // ── Command writes (transition / partial cancel) ───────────────────────────

  /** Load an order for the device-scope check (tenant-scoped; by id or source tx). */
  async loadOrderForScope(
    tenantId: string,
    ticketId: string,
    ticketUuid: string | null,
  ): Promise<OrderScopeRow | null> {
    const { rows } = await this.pg.query<OrderScopeRow>(
      `SELECT id, tenant_id, location_id, station_id, kitchen_status,
              person_id, source_transaction_id
         FROM ops.orders
        WHERE tenant_id = $3
          AND (($2::uuid IS NOT NULL AND id = $2::uuid)
               OR source_transaction_id = $1)
        ORDER BY CASE
          WHEN $2::uuid IS NOT NULL AND id = $2::uuid THEN 0 ELSE 1
        END
        LIMIT 1`,
      [ticketId, ticketUuid, tenantId],
    );
    return rows[0] ?? null;
  }

  /** Next per-tenant kitchen_sequence (no sequence object exists — MAX+1 in-tx). */
  private async nextKitchenSequence(
    client: PoolClient,
    tenantId: string,
  ): Promise<number> {
    // Serialize per-tenant sequence allocation: MAX+1 under default isolation can
    // hand the same number to concurrent transitions (cursor consumers using
    // `> after_sequence` would then miss one). The xact-scoped advisory lock is
    // released automatically at COMMIT/ROLLBACK.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [
      `kds:kitchen_sequence:${tenantId}`,
    ]);
    const { rows } = await client.query<{ seq: string }>(
      `SELECT COALESCE(MAX(kitchen_sequence), 0) + 1 AS seq
         FROM ops.order_events WHERE tenant_id = $1`,
      [tenantId],
    );
    return Number(rows[0]?.seq ?? 1);
  }

  private async customerPhone(
    client: PoolClient,
    tenantId: string,
    personId: string | null,
  ): Promise<string | null> {
    if (!personId) return null;
    const { rows } = await client.query<{ normalized_phone: string | null }>(
      `SELECT normalized_phone FROM core.people WHERE id = $1 AND tenant_id = $2`,
      [personId, tenantId],
    );
    return rows[0]?.normalized_phone ?? null;
  }

  /**
   * Transition a ticket's kitchen_status in ONE worker transaction:
   * update order + items, append the order_events journal row, and (when
   * `notify` resolves a body) enqueue a `twilio.status_notification` outbox row.
   * Append-only `ops.order_events` + the deterministic outbox idempotency key
   * make re-runs safe.
   */
  async transitionTicket(input: {
    order: OrderScopeRow;
    targetStatus: KitchenStatus;
    actorId: string | null;
    actorChannel: string | null;
    cancellationReasonCode: string | null;
    cancellationReasonNote: string | null;
    notifyBody: string | null;
  }): Promise<{ sequence: number }> {
    const { order, targetStatus } = input;
    return this.pg.workerTx(async (client) => {
      // Lock + re-read the order so a concurrent transition can't make this one
      // overwrite stale state or emit a wrong old_status. The service pre-checks
      // against a pre-transaction snapshot; this is the authoritative re-check.
      const locked = await client.query<{
        kitchen_status: KitchenStatus | null;
      }>(
        `SELECT kitchen_status FROM ops.orders
          WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [order.id, order.tenant_id],
      );
      if (locked.rowCount === 0) {
        throw new KdsHttpError(404, { error: 'ticket_not_found' });
      }
      const currentStatus = locked.rows[0].kitchen_status;
      const invalid = validateTransition(currentStatus, targetStatus);
      if (invalid) throw new KdsHttpError(422, { error: invalid });

      const seq = await this.nextKitchenSequence(client, order.tenant_id);
      const orderStatus = mapKitchenToOrderStatus(targetStatus);
      const isCancel = targetStatus === 'cancelled';

      await client.query(
        `UPDATE ops.orders
            SET kitchen_status = $3,
                status = $4,
                cancellation_reason_code = COALESCE($5, cancellation_reason_code),
                cancellation_reason_note = COALESCE($6, cancellation_reason_note),
                cancellation_reason = CASE WHEN $7 THEN COALESCE($5, cancellation_reason) ELSE cancellation_reason END,
                updated_at = now()
          WHERE id = $1 AND tenant_id = $2`,
        [
          order.id,
          order.tenant_id,
          targetStatus,
          orderStatus,
          input.cancellationReasonCode,
          input.cancellationReasonNote,
          isCancel,
        ],
      );

      // Propagate to non-cancelled line items (cancelled lines keep their state).
      await client.query(
        `UPDATE ops.order_items
            SET kitchen_status = $3, updated_at = now()
          WHERE order_id = $1 AND tenant_id = $2 AND is_cancelled = false`,
        [order.id, order.tenant_id, targetStatus],
      );

      await client.query(
        `INSERT INTO ops.order_events
           (tenant_id, order_id, event_kind, old_status, new_status,
            kitchen_sequence, source, idempotency_key, payload, occurred_at)
         VALUES ($1, $2, 'status_changed', $3, $4, $5, 'kds', $6, $7::jsonb, now())
         ON CONFLICT (tenant_id, idempotency_key)
           WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [
          order.tenant_id,
          order.id,
          currentStatus,
          targetStatus,
          seq,
          `kds:transition:${order.id}:${seq}`,
          JSON.stringify({
            actor_source: 'kds_app',
            actor_id: input.actorId,
            actor_channel: input.actorChannel,
            target_status: targetStatus,
          }),
        ],
      );

      if (input.notifyBody) {
        const phone = await this.customerPhone(
          client,
          order.tenant_id,
          order.person_id,
        );
        if (phone) {
          await client.query(
            `INSERT INTO queue.outbox_events
               (tenant_id, event_type, aggregate_id, idempotency_key, payload)
             VALUES ($1, 'twilio.status_notification', $2, $3, $4::jsonb)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [
              order.tenant_id,
              order.id,
              `kds:notify:${order.id}:${targetStatus}:${seq}`,
              JSON.stringify({
                to: phone,
                body: input.notifyBody,
                ticket_id: order.id,
                target_status: targetStatus,
                event_sequence: seq,
                source_transaction_id: order.source_transaction_id,
              }),
            ],
          );
        }
      }

      return { sequence: seq };
    });
  }

  /**
   * Partial-cancel specific line items in ONE worker transaction: flag the
   * items, recompute the order total, set the order's kitchen_status
   * (partial_cancelled, or cancelled when nothing remains), append the journal,
   * and enqueue a `twilio.cancel_notification` outbox row.
   */
  async partialCancelItems(input: {
    order: OrderScopeRow;
    itemIds: string[];
    reasonCode: string;
    reasonNote: string | null;
    actorId: string | null;
    actorChannel: string | null;
    buildNotifyBody: (
      cancelled: Array<{ quantity: number; name: string }>,
      remaining: Array<{ quantity: number; name: string }>,
    ) => string | null;
  }): Promise<{ sequence: number; newStatus: KitchenStatus }> {
    const { order } = input;
    return this.pg.workerTx(async (client) => {
      // Lock + re-read the order so a transition that committed just before this
      // lock can't be overwritten and the event can't carry a stale old_status.
      const locked = await client.query<{
        kitchen_status: KitchenStatus | null;
      }>(
        `SELECT kitchen_status FROM ops.orders
          WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [order.id, order.tenant_id],
      );
      if (locked.rowCount === 0) {
        throw new KdsHttpError(404, { error: 'ticket_not_found' });
      }
      const currentStatus = locked.rows[0].kitchen_status;
      // A completed/cancelled order can't be partially cancelled.
      if (currentStatus && TERMINAL_STATUSES.includes(currentStatus)) {
        throw new KdsHttpError(422, {
          error: `invalid_transition: ${currentStatus} -> partial_cancelled`,
        });
      }

      // Flag the targeted items as cancelled.
      const cancelled = await client.query<{ quantity: number; name: string }>(
        `UPDATE ops.order_items
            SET is_cancelled = true, kitchen_status = 'cancelled', updated_at = now()
          WHERE order_id = $1 AND tenant_id = $2 AND id = ANY($3::uuid[])
            AND is_cancelled = false
        RETURNING quantity, name`,
        [order.id, order.tenant_id, input.itemIds],
      );
      // Every requested id must have matched an active line on this order;
      // otherwise roll back rather than mutate the order / notify the customer.
      if ((cancelled.rowCount ?? 0) !== input.itemIds.length) {
        throw new KdsHttpError(422, { error: 'partial_cancel_items_not_found' });
      }

      // Remaining (non-cancelled) items → drives total + whole-order status.
      const remaining = await client.query<{ quantity: number; name: string }>(
        `SELECT quantity, name FROM ops.order_items
          WHERE order_id = $1 AND tenant_id = $2 AND is_cancelled = false`,
        [order.id, order.tenant_id],
      );

      const newStatus: KitchenStatus =
        remaining.rows.length === 0 ? 'cancelled' : 'partial_cancelled';
      const seq = await this.nextKitchenSequence(client, order.tenant_id);

      await client.query(
        `UPDATE ops.orders
            SET kitchen_status = $3,
                status = $4,
                total_cents = COALESCE((
                  SELECT SUM(unit_price_cents * quantity)
                    FROM ops.order_items
                   WHERE order_id = $1 AND tenant_id = $2 AND is_cancelled = false
                ), 0),
                partial_cancellation_reason = $5,
                partial_cancellation_reason_code = $5,
                partial_cancellation_reason_note = $6,
                updated_at = now()
          WHERE id = $1 AND tenant_id = $2`,
        [
          order.id,
          order.tenant_id,
          newStatus,
          mapKitchenToOrderStatus(newStatus),
          input.reasonCode,
          input.reasonNote,
        ],
      );

      await client.query(
        `INSERT INTO ops.order_events
           (tenant_id, order_id, event_kind, old_status, new_status,
            kitchen_sequence, source, idempotency_key, payload, occurred_at)
         VALUES ($1, $2, 'status_changed', $3, $4, $5, 'kds', $6, $7::jsonb, now())
         ON CONFLICT (tenant_id, idempotency_key)
           WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [
          order.tenant_id,
          order.id,
          currentStatus,
          newStatus,
          seq,
          `kds:partial_cancel:${order.id}:${seq}`,
          JSON.stringify({
            actor_source: 'kds_app',
            actor_id: input.actorId,
            actor_channel: input.actorChannel,
            reason_code: input.reasonCode,
            cancelled_item_ids: input.itemIds,
          }),
        ],
      );

      const phone = await this.customerPhone(
        client,
        order.tenant_id,
        order.person_id,
      );
      // Only emit when notifications are enabled (buildNotifyBody returns null
      // when KDS_STATUS_NOTIFY_ENABLED is off) AND a customer phone exists.
      const body = phone
        ? input.buildNotifyBody(cancelled.rows, remaining.rows)
        : null;
      if (phone && body) {
        await client.query(
          `INSERT INTO queue.outbox_events
             (tenant_id, event_type, aggregate_id, idempotency_key, payload)
           VALUES ($1, 'twilio.cancel_notification', $2, $3, $4::jsonb)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            order.tenant_id,
            order.id,
            `kds:cancel:${order.id}:${seq}`,
            JSON.stringify({ to: phone, body, ticket_id: order.id }),
          ],
        );
      }

      return { sequence: seq, newStatus };
    });
  }
}
