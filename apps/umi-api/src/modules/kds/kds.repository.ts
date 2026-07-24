import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PgService } from '../../shared/database/pg.service';
import {
  BOARD_ACTIVE_STATUSES,
  KdsHttpError,
  type KitchenStatus,
  mapKitchenToOrderStatus,
  mapOrderToKitchenStatus,
  randomHex,
  sha256Hex,
  TERMINAL_STATUSES,
  validateTransition,
} from './dto/kds-contract';

/**
 * All KDS SQL. Everything runs on the **worker pool** (`pg.query` / `pg.workerTx`)
 * with an explicit `business_id = $1` predicate in every statement — NOT the RLS
 * `withTenant` path — for three reasons (spec §9.1/§11.2):
 *   1. the iPad path has no authenticated member user, so RLS would hide rows;
 *   2. sessions/pairing live in the SEALED `runtime` schema (auth secrets
 *      `token_hash`/`pin_hash`/`pin_salt`) with NO `umi_app` USAGE;
 *   3. transitions write `runtime.outbox_event` (service-role-only schema).
 * Cross-tenant isolation is enforced by the explicit predicate + the guard stack
 * on the dashboard routes / the device-session scope on the iPad routes — the
 * same model the public cash routes use.
 *
 * build-v2 mapping: stations `kitchen.stations`→`tenant.station`, devices
 * `device.devices`→`tenant.device`, sessions `device.sessions`→`runtime.session`
 * (`device_id`→`principal_id`, `principal_type='device'`), pairing
 * `device.pairing_requests`→`runtime.pairing`. Tickets are the
 * `runtime.v_kds_tickets` projection over `tenant."order"`/`order_item`; the
 * kitchen lifecycle is DE-OVERLOADED — the order's former `kitchen_status` is now
 * the latest `tenant.order_event` row, so a transition appends an event (carrying
 * `kitchen_status`) rather than mutating a column, and current status is derived.
 */

export interface StationRow {
  id: string;
  business_id: string;
  location_id: string | null;
  name: string;
}

export interface PairingRow {
  id: string;
  business_id: string;
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
  business_id: string;
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
  business_id: string;
  station_id: string | null;
  device_name: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
}

export interface OrderScopeRow {
  id: string;
  business_id: string;
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

// The customer name (tenant.customer) + best reply phone (tenant.contact) for a
// ticket — prefers the WhatsApp as-received raw_phone_number (avoids Twilio 63015),
// else the phone-channel normalized E.164. Shared by board reads.
// REPLY channels are ('whatsapp','phone') — deliberately NOT the identity dedup family
// ('phone','whatsapp','sms'): we never reply over SMS.
const CUSTOMER_NAME_PHONE_JOIN = `LEFT JOIN tenant.customer cu
    ON cu.business_id = t.business_id AND cu.id = t.customer_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(ct.raw_phone_number, ct.normalized_value) AS phone
      FROM tenant.contact ct
      JOIN umi.channel_type pch ON pch.id = ct.channel_id
     WHERE ct.business_id = cu.business_id AND ct.customer_id = cu.id
       AND pch.key IN ('whatsapp', 'phone')
     ORDER BY (pch.key = 'whatsapp') DESC, ct.is_primary DESC, ct.updated_at DESC
     LIMIT 1
  ) ph ON true`;

/**
 * The frozen `KDSEventRow` projection, shared by the cursor and the ticker so the two
 * cannot drift.
 *
 * Three of these columns are SYNTHESISED because build-v3's `order_event` is a thin
 * status spine — "real status transitions only, not a catch-all event log" — while the
 * Swift model declares all three NON-OPTIONAL:
 *   kind    -> `KitchenEventKind(kdsValue:)` accepts exactly four values and `throw`s
 *              on anything else. The backfill kept only `status_changed` (78 rows,
 *              having dropped order_upserted / status_change / snapshot_reconciled as
 *              sync-ingestion duplicates), so that is the honest constant: every row
 *              this table now holds IS a status change.
 *   source  -> the old `order_event.source` free-text is gone; a KDS-visible transition
 *              is written by the KDS.
 *   payload -> the old actor/reason blob is gone. Empty object, not null: Swift decodes
 *              a dictionary, and null fails the whole payload.
 * `business_id` comes from the parent order — `order_event` deliberately has no
 * business_id (RLS reaches it through customer_order), which is also why every query
 * here filters on `o.business_id`, not `e.business_id`.
 */
const EVENT_SELECT = `e.sequence,
              e.order_id                           AS ticket_id,
              o.business_id                        AS business_id,
              COALESCE(o.external_ref, o.id::text) AS source_transaction_id,
              'status_changed'                     AS kind,
              e.status,
              e.occurred_at,
              'kds'                                AS source,
              '{}'::jsonb                          AS payload`;

@Injectable()
export class KdsRepository {
  constructor(private readonly pg: PgService) {}

  // ── Stations (tenant.station; location_id -> branch_id) ─────────────────────

  /** Active station within the tenant (+ optional location scope). */
  async loadStation(
    tenantId: string,
    locationId: string | null,
    stationId: string,
  ): Promise<StationRow | null> {
    // A missing locationId means "unscoped" (match the station at any location) —
    // NOT "root-location only". listStations() returns all-location stations, so
    // forcing branch_id IS NULL here would reject a valid dashboard selection.
    const locClause = locationId ? 'AND branch_id = $3' : '';
    const params = locationId ? [stationId, tenantId, locationId] : [stationId, tenantId];
    const { rows } = await this.pg.query<StationRow>(
      `SELECT id, business_id, branch_id AS location_id, name
         FROM tenant.station
        WHERE id = $1 AND business_id = $2 AND status = 'active' ${locClause}
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
    const locClause = locationId ? 'AND branch_id = $2' : '';
    const params = locationId ? [tenantId, locationId] : [tenantId];
    const { rows } = await this.pg.query(
      `SELECT id, station_key, name, status, sort_order, branch_id AS location_id
         FROM tenant.station
        WHERE business_id = $1 AND status = 'active' ${locClause}
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
   * the tenant-wide (`branch_id IS NULL`) gap that the DB's
   * partial-unique indexes handle only when non-null.
   */
  async findActiveStationByKey(
    tenantId: string,
    locationId: string | null,
    stationKey: string,
  ): Promise<{ id: string } | null> {
    const { rows } = await this.pg.query<{ id: string }>(
      `SELECT id
         FROM tenant.station
        WHERE business_id = $1
          AND station_key = $2
          AND branch_id IS NOT DISTINCT FROM $3
          AND status <> 'archived'
        LIMIT 1`,
      [tenantId, stationKey, locationId],
    );
    return rows[0] ?? null;
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
      `INSERT INTO tenant.station (business_id, branch_id, station_key, name)
         VALUES ($1, $2, $3, $4)
       RETURNING id, station_key, name, status, sort_order, branch_id AS location_id`,
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
  async updateStation(input: { tenantId: string; stationId: string; name: string }): Promise<{
    id: string;
    station_key: string;
    name: string;
    status: string;
    sort_order: number;
    location_id: string | null;
  } | null> {
    const { rows } = await this.pg.query(
      `UPDATE tenant.station
          SET name = $3, updated_at = now()
        WHERE id = $1 AND business_id = $2 AND status <> 'archived'
      RETURNING id, station_key, name, status, sort_order, branch_id AS location_id`,
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
      `UPDATE tenant.station
          SET status = 'archived', updated_at = now()
        WHERE id = $1 AND business_id = $2 AND status <> 'archived'`,
      [stationId, tenantId],
    );
    return (rowCount ?? 0) > 0;
  }

  // ── Pairing (runtime.pairing) ──────────────────────────────────────────────

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
      `INSERT INTO runtime.pairing
         (business_id, location_id, station_id, device_name,
          pin_hash, pin_salt, status, max_attempts, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
       RETURNING id, business_id, location_id, station_id, device_name,
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
    const locClause = locationId ? 'AND location_id = $2' : 'AND location_id IS NULL';
    const params = locationId ? [tenantId, locationId, limit] : [tenantId, limit];
    const limitParam = locationId ? '$3' : '$2';
    const { rows } = await this.pg.query(
      `SELECT id, business_id, location_id, station_id, device_name, requested_name,
              status, attempt_count, max_attempts, expires_at,
              approved_by, approved_at, used_at, denied_at, created_at
         FROM runtime.pairing
        WHERE business_id = $1 AND status IN ('pending', 'approved') ${locClause}
        ORDER BY created_at DESC
        LIMIT ${limitParam}`,
      params,
    );
    return rows;
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
      action === 'approve' ? [pairingId, tenantId, adminUserId] : [pairingId, tenantId];
    // Approve requires a still-valid window. Deny is a dismissal, so it also
    // clears pending requests already past expires_at — those linger in the
    // list (status is still 'pending' until dismissed) and would otherwise be
    // impossible to remove.
    const freshnessClause = action === 'approve' ? `AND expires_at > now()` : '';
    const { rows } = await this.pg.query<{ id: string; status: string }>(
      `UPDATE runtime.pairing
          SET ${patch}
        WHERE id = $1 AND business_id = $2 AND status = 'pending'
          ${freshnessClause}
        RETURNING id, status`,
      params,
    );
    return rows[0] ?? null;
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

  /** Record the device's chosen name after a PIN match (does not touch attempts). */
  async setPairingRequestedName(pairingId: string, requestedName: string): Promise<void> {
    await this.pg.query(
      `UPDATE runtime.pairing
          SET requested_name = $2, updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [pairingId, requestedName],
    );
  }

  /** Read a pairing by id only (the iPad polls by pairing_id). */
  async getPairing(pairingId: string): Promise<PairingStatusRow | null> {
    const { rows } = await this.pg.query<PairingStatusRow>(
      `SELECT id, business_id, location_id, station_id, device_name, requested_name,
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

  /** Atomically claim an approved pairing (guards concurrent device claims). */
  async claimPairing(pairingId: string): Promise<boolean> {
    const { rows } = await this.pg.query<{ id: string }>(
      `UPDATE runtime.pairing
          SET status = 'used', used_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'approved' AND used_at IS NULL
        RETURNING id`,
      [pairingId],
    );
    return rows.length > 0;
  }

  // ── Device sessions (runtime.session + tenant.device) ──────────────────────

  /**
   * Provision a device for a claimed pairing in ONE worker transaction: a durable
   * `tenant.device` registry row (typed `kds`) + a `runtime.session` row
   * (`principal_type='device'`, `principal_id` = the registry id). Returns the
   * one-time plaintext token (never stored — only its sha256 hash is) and the
   * registry id (`device_registry_id`) for race cleanup. The session `id` stays the
   * frozen `device_session.device_id` the iPad sees. `runtime.session` has no
   * `branch_id`, so the location is parked in `metadata`.
   */
  async createDeviceSession(input: {
    tenantId: string;
    locationId: string | null;
    stationId: string | null;
    deviceName: string;
  }): Promise<{
    id: string;
    business_id: string;
    station_id: string | null;
    device_name: string | null;
    token: string;
    device_registry_id: string;
  }> {
    const token = randomHex(32);
    const tokenHash = sha256Hex(token);
    return this.pg.workerTx(async (client) => {
      const dev = await client.query<{ id: string }>(
        `INSERT INTO tenant.device
           (business_id, branch_id, station_id, name, device_type, status)
         VALUES ($1, $2, $3, $4, 'kds', 'active')
         RETURNING id`,
        [input.tenantId, input.locationId, input.stationId, input.deviceName],
      );
      const deviceRegistryId = dev.rows[0].id;
      const sess = await client.query<{
        id: string;
        business_id: string;
        station_id: string | null;
        device_name: string | null;
      }>(
        `INSERT INTO runtime.session
           (business_id, principal_type, principal_id, station_id, device_name,
            token_hash, is_active, metadata)
         VALUES ($1, 'device', $2, $3, $4, $5, true,
                 jsonb_build_object('location_id', $6::text))
         RETURNING id, business_id, station_id, device_name`,
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
      await client.query(`DELETE FROM tenant.device WHERE id = $1`, [deviceRegistryId]);
    });
  }

  /** Device-auth lookup by token hash (the token itself is never stored). */
  async findSessionByToken(tokenHash: string): Promise<SessionRow | null> {
    const { rows } = await this.pg.query<SessionRow>(
      `SELECT id, business_id, station_id, device_name, is_active, metadata
         FROM runtime.session
        WHERE token_hash = $1 AND principal_type = 'device'
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
  async heartbeatTouch(deviceId: string, ip: string | null): Promise<boolean> {
    const { rowCount } = await this.pg.query(
      `UPDATE runtime.session
          SET last_used_at = now(),
              metadata = metadata || jsonb_build_object('ip', $2::text)
        WHERE id = $1 AND is_active = true`,
      [deviceId, ip],
    );
    return (rowCount ?? 0) > 0;
  }

  async listDevices(tenantId: string, locationId: string | null): Promise<DeviceListRow[]> {
    const locClause = locationId ? `AND s.metadata->>'location_id' = $2` : '';
    const params = locationId ? [tenantId, locationId] : [tenantId];
    const { rows } = await this.pg.query<DeviceListRow>(
      `SELECT s.id AS device_id, s.principal_id AS device_registry_id,
              dv.device_type, s.station_id, st.name AS station_name,
              s.device_name, s.last_used_at, s.is_active, s.metadata
         FROM runtime.session s
         LEFT JOIN tenant.device dv
           ON dv.business_id = s.business_id AND dv.id = s.principal_id
         LEFT JOIN tenant.station st
           ON st.business_id = s.business_id AND st.id = s.station_id
        WHERE s.business_id = $1 AND s.is_active = true
          AND s.principal_type = 'device' ${locClause}
        ORDER BY s.last_used_at DESC NULLS LAST, s.created_at DESC`,
      params,
    );
    return rows;
  }

  /** Deactivate the session and archive its registry device row (one tx). */
  async revokeSession(tenantId: string, deviceId: string): Promise<boolean> {
    return this.pg.workerTx(async (client) => {
      const sess = await client.query(
        `UPDATE runtime.session SET is_active = false
          WHERE id = $1 AND business_id = $2
        RETURNING principal_id`,
        [deviceId, tenantId],
      );
      if (sess.rowCount === 0) return false;
      const registryId = sess.rows[0]?.principal_id;
      if (registryId) {
        await client.query(
          `UPDATE tenant.device SET status = 'archived', updated_at = now()
            WHERE id = $1 AND business_id = $2`,
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
        `UPDATE runtime.session
            SET device_name = COALESCE($3, device_name),
                station_id  = CASE WHEN $5 THEN $4 ELSE station_id END
          WHERE id = $1 AND business_id = $2
        RETURNING principal_id`,
        [deviceId, tenantId, patch.deviceName ?? null, patch.stationId ?? null, setStation],
      );
      if (sess.rowCount === 0) return false;
      const registryId = sess.rows[0]?.principal_id;
      if (registryId) {
        await client.query(
          `UPDATE tenant.device
              SET name = COALESCE($3, name),
                  station_id = CASE WHEN $5 THEN $4 ELSE station_id END,
                  updated_at = now()
            WHERE id = $1 AND business_id = $2`,
          [registryId, tenantId, patch.deviceName ?? null, patch.stationId ?? null, setStation],
        );
      }
      return true;
    });
  }

  // ── Board reads (runtime.v_kds_tickets + tenant.order_event) ────────────────

  /**
   * Board snapshot for a device. Reads the canonical projection, resolves
   * customer name (`tenant.customer`) + reply phone (`tenant.contact`),
   * derives `last_event_sequence`, and scopes by tenant + station (NULL station =
   * broadcast, matching the legacy `get_board_snapshot`). Only on-board
   * (non-terminal) statuses are returned. The service remaps items to the frozen
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
              t.business_id        AS business_id,
              t.source_channel,
              t.status,
              t.station_id,
              t.station_name,
              cu.name            AS customer_name,
              ph.phone           AS customer_phone,
              t.pickup_person,
              t.customer_note,
              (t.total_cents::numeric / 100) AS total_amount,
              t.created_at,
              t.updated_at,
              t.last_event_sequence,
              t.items
         FROM tenant.kds_ticket t
         ${CUSTOMER_NAME_PHONE_JOIN}
        WHERE t.business_id = $1
          AND ($2::text IS NULL OR t.station_id IS NULL OR t.station_id = $2::uuid)
          AND t.status = ANY($3::text[])
        ORDER BY t.created_at ASC`,
      [tenantId, stationId, statuses.map(mapKitchenToOrderStatus)],
    );
    return rows;
  }

  /**
   * Event stream cursor (`tenant.order_event` ordered by its identity `sequence`).
   *
   * The station filter is GONE, not forgotten. It used to read `o.station_id`, and in
   * build-v3 an order carries no station at all (ORDER_MODEL §5 — the KDS derives a
   * ticket's station from the device login instead, and the column was null on 100% of
   * source orders). The old predicate was `station_id IS NULL OR station_id = $n`, so
   * with every order null it already matched everything: this is the same broadcast
   * behaviour the board snapshot has, now stated instead of simulated. `stationId` is
   * therefore no longer a parameter — a filter that cannot filter is worse than none,
   * because it reads like a security boundary. It returns when per-line routing lands
   * (deferred `order_item.station_id`), and then it belongs on the LINE, not the order.
   */
  async ticketEvents(tenantId: string, afterSequence: number, limit: number): Promise<EventRow[]> {
    const { rows } = await this.pg.query<EventRow>(
      `SELECT ${EVENT_SELECT}
         FROM tenant.order_event e
         JOIN tenant.customer_order o ON o.id = e.order_id
        WHERE o.business_id = $1
          AND e.sequence > $2
        ORDER BY e.sequence ASC
        LIMIT LEAST(GREATEST($3, 1), 1000)`,
      [tenantId, afterSequence, limit],
    );
    return rows;
  }

  /** Most-recent events for the dashboard ticker. */
  async recentEvents(tenantId: string, limit: number): Promise<EventRow[]> {
    const { rows } = await this.pg.query<EventRow>(
      `SELECT ${EVENT_SELECT}
         FROM tenant.order_event e
         JOIN tenant.customer_order o ON o.id = e.order_id
        WHERE o.business_id = $1
        ORDER BY e.sequence DESC
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
      // The caller filters in the iPad's vocabulary; the view speaks build-v3's.
      // Deduplicated because accepted/partial_cancelled/preparing all collapse onto
      // `preparing` — without it, asking for two of them repeats the value in ANY().
      params.push([...new Set(statuses.map(mapKitchenToOrderStatus))]);
      statusClause = `AND t.status = ANY($${params.length}::text[])`;
    }
    let locClause = '';
    if (locationId) {
      params.push(locationId);
      // NULL-escape the branch filter: WhatsApp orders arrive with
      // branch_id = NULL (the channel account isn't branch-bound), and the
      // dashboard always sends a selected branch (it defaults to the
      // oldest-active location). A plain `branch_id = $N` therefore hides every
      // WhatsApp ticket. Unrouted (NULL) orders are tenant-wide and must surface
      // on any branch — same reason the iPad boardSnapshot query carries no
      // location filter at all.
      locClause = `AND (o.branch_id = $${params.length} OR o.branch_id IS NULL)`;
    }
    const { rows } = await this.pg.query<TicketRow>(
      `SELECT t.ticket_id,
              t.source_transaction_id,
              t.business_id        AS business_id,
              t.source_channel,
              t.status,
              t.station_id,
              t.station_name,
              cu.name            AS customer_name,
              ph.phone           AS customer_phone,
              t.pickup_person,
              t.customer_note,
              (t.total_cents::numeric / 100) AS total_amount,
              t.created_at,
              t.updated_at,
              0 AS last_event_sequence,
              t.items
         FROM tenant.kds_ticket t
         JOIN tenant.customer_order o ON o.id = t.ticket_id
         ${CUSTOMER_NAME_PHONE_JOIN}
        WHERE t.business_id = $1
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
    const { rows } = await this.pg.query<OrderScopeRow & { status: string }>(
      `SELECT o.id, o.business_id, o.branch_id AS location_id,
              NULL::uuid AS station_id,
              o.status,
              o.customer_id AS person_id,
              COALESCE(o.external_ref, o.id::text) AS source_transaction_id
         FROM tenant.customer_order o
        WHERE o.business_id = $3
          AND (($2::uuid IS NOT NULL AND o.id = $2::uuid)
               OR o.external_ref = $1)
        ORDER BY CASE
          WHEN $2::uuid IS NOT NULL AND o.id = $2::uuid THEN 0 ELSE 1
        END
        LIMIT 1`,
      [ticketId, ticketUuid, tenantId],
    );
    const row = rows[0];
    if (!row) return null;
    // The kitchen status is no longer derived from the journal: build-v3 collapsed the
    // two status axes onto customer_order.status, and order_event is the transition
    // stream rather than the place the current value lives (ORDER_MODEL §1 — "the
    // ticket reads the snapshot; the spine drives the change").
    return { ...row, kitchen_status: mapOrderToKitchenStatus(row.status) };
  }

  /** Next per-tenant kitchen_sequence (no sequence object exists — MAX+1 in-tx). */
  private async nextKitchenSequence(client: PoolClient, tenantId: string): Promise<number> {
    // Serialize per-tenant sequence allocation: MAX+1 under default isolation can
    // hand the same number to concurrent transitions (cursor consumers using
    // `> after_sequence` would then miss one). The xact-scoped advisory lock is
    // released automatically at COMMIT/ROLLBACK.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [
      `kds:kitchen_sequence:${tenantId}`,
    ]);
    const { rows } = await client.query<{ seq: string }>(
      `SELECT COALESCE(MAX(kitchen_sequence), 0) + 1 AS seq
         FROM tenant.order_event WHERE business_id = $1`,
      [tenantId],
    );
    return Number(rows[0]?.seq ?? 1);
  }

  /**
   * Lock the order row (FOR UPDATE, serializing concurrent transitions) and derive
   * its current kitchen status from the latest journal event. Returns null when the
   * order does not exist. Replaces the old `SELECT kitchen_status FROM ops.orders
   * FOR UPDATE` now that kitchen status lives in `tenant.order_event`.
   */
  private async lockOrderAndStatus(
    client: PoolClient,
    orderId: string,
    tenantId: string,
  ): Promise<{ kitchenStatus: KitchenStatus | null } | null> {
    const locked = await client.query<{ status: string }>(
      `SELECT status FROM tenant.customer_order
        WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [orderId, tenantId],
    );
    const row = locked.rows[0];
    if (!row) return null;
    // One query, not two: the lock and the current status now come from the same row.
    // The old pair existed because kitchen status lived in the journal while the lock
    // was on the order — build-v3 collapsed the axes, so the locked row already holds
    // the authoritative value and there is no window between reading them.
    return { kitchenStatus: mapOrderToKitchenStatus(row.status) };
  }

  private async customerPhone(
    client: PoolClient,
    tenantId: string,
    personId: string | null,
  ): Promise<string | null> {
    if (!personId) return null;
    // personId is a tenant.customer.id; the reply address is the customer's best
    // reachability value — WhatsApp as-received display_value (avoids Twilio
    // 63015) else the phone E.164.
    const { rows } = await client.query<{ phone: string | null }>(
      `SELECT COALESCE(ct.raw_phone_number, ct.normalized_value) AS phone
         FROM tenant.customer cu
         JOIN tenant.contact ct
           ON ct.business_id = cu.business_id AND ct.customer_id = cu.id
         JOIN umi.channel_type ch ON ch.id = ct.channel_id
        WHERE cu.id = $1 AND cu.business_id = $2
          AND ch.key IN ('whatsapp', 'phone')
        ORDER BY (ch.key = 'whatsapp') DESC, ct.is_primary DESC, ct.updated_at DESC
        LIMIT 1`,
      [personId, tenantId],
    );
    return rows[0]?.phone ?? null;
  }

  /**
   * Transition a ticket's kitchen_status in ONE worker transaction: set the
   * order's business status + propagate to line items, APPEND the
   * `tenant.order_event` journal row (carrying the new `kitchen_status` — the
   * de-overloaded source of truth), and (when `notify` resolves a body) enqueue a
   * `twilio.status_notification` outbox row. The append-only journal + the
   * deterministic outbox idempotency key make re-runs safe.
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
      // Lock + derive current status so a concurrent transition can't make this one
      // overwrite stale state or emit a wrong old_status. The service pre-checks
      // against a pre-transaction snapshot; this is the authoritative re-check.
      const locked = await this.lockOrderAndStatus(client, order.id, order.business_id);
      if (!locked) {
        throw new KdsHttpError(404, { error: 'ticket_not_found' });
      }
      const currentStatus = locked.kitchenStatus;
      const invalid = validateTransition(currentStatus, targetStatus);
      if (invalid) throw new KdsHttpError(422, { error: invalid });

      const seq = await this.nextKitchenSequence(client, order.business_id);
      const orderStatus = mapKitchenToOrderStatus(targetStatus);
      const isCancel = targetStatus === 'cancelled';

      // The order keeps only its coarse business status; the fine kitchen lifecycle
      // lives in the journal (below).
      await client.query(
        `UPDATE tenant."order"
            SET status = $3, updated_at = now()
          WHERE id = $1 AND business_id = $2`,
        [order.id, order.business_id, orderStatus],
      );

      // Propagate to non-cancelled line items (cancelled lines keep their state).
      await client.query(
        `UPDATE tenant.order_item
            SET kitchen_status = $3, updated_at = now()
          WHERE order_id = $1 AND business_id = $2 AND is_cancelled = false`,
        [order.id, order.business_id, targetStatus],
      );

      await client.query(
        `INSERT INTO tenant.order_event
           (business_id, order_id, event_kind, old_status, new_status, kitchen_status,
            reason, reason_code, reason_note, kitchen_sequence, source,
            idempotency_key, payload, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, 'kds', $10, $11::jsonb, now())
         ON CONFLICT (business_id, idempotency_key)
           WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [
          order.business_id,
          order.id,
          isCancel ? 'cancellation' : 'kitchen',
          currentStatus,
          targetStatus,
          isCancel ? input.cancellationReasonCode : null,
          input.cancellationReasonCode,
          input.cancellationReasonNote,
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
        const phone = await this.customerPhone(client, order.business_id, order.person_id);
        if (phone) {
          await client.query(
            `INSERT INTO runtime.outbox_event
               (business_id, event_type, aggregate_id, idempotency_key, payload)
             VALUES ($1, 'twilio.status_notification', $2, $3, $4::jsonb)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [
              order.business_id,
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
   * items, recompute the order total, set the order's business status
   * (partial_cancelled, or cancelled when nothing remains) + APPEND a
   * `partial_cancellation` journal row (carrying the new kitchen_status + reason),
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
      // Lock + derive current status so a transition that committed just before this
      // lock can't be overwritten and the event can't carry a stale old_status.
      const locked = await this.lockOrderAndStatus(client, order.id, order.business_id);
      if (!locked) {
        throw new KdsHttpError(404, { error: 'ticket_not_found' });
      }
      const currentStatus = locked.kitchenStatus;
      // A completed/cancelled order can't be partially cancelled.
      if (currentStatus && TERMINAL_STATUSES.includes(currentStatus)) {
        throw new KdsHttpError(422, {
          error: `invalid_transition: ${currentStatus} -> partial_cancelled`,
        });
      }

      // Flag the targeted items as cancelled.
      const cancelled = await client.query<{ quantity: number; name: string }>(
        `UPDATE tenant.order_item
            SET is_cancelled = true, kitchen_status = 'cancelled', updated_at = now()
          WHERE order_id = $1 AND business_id = $2 AND id = ANY($3::uuid[])
            AND is_cancelled = false
        RETURNING quantity, name`,
        [order.id, order.business_id, input.itemIds],
      );
      // Every requested id must have matched an active line on this order;
      // otherwise roll back rather than mutate the order / notify the customer.
      if ((cancelled.rowCount ?? 0) !== input.itemIds.length) {
        throw new KdsHttpError(422, { error: 'partial_cancel_items_not_found' });
      }

      // Remaining (non-cancelled) items → drives total + whole-order status.
      const remaining = await client.query<{ quantity: number; name: string }>(
        `SELECT quantity, name FROM tenant.order_item
          WHERE order_id = $1 AND business_id = $2 AND is_cancelled = false`,
        [order.id, order.business_id],
      );

      const newStatus: KitchenStatus =
        remaining.rows.length === 0 ? 'cancelled' : 'partial_cancelled';
      const seq = await this.nextKitchenSequence(client, order.business_id);

      await client.query(
        `UPDATE tenant."order"
            SET status = $3,
                total_cents = COALESCE((
                  SELECT SUM(unit_price_cents * quantity)
                    FROM tenant.order_item
                   WHERE order_id = $1 AND business_id = $2 AND is_cancelled = false
                ), 0),
                updated_at = now()
          WHERE id = $1 AND business_id = $2`,
        [order.id, order.business_id, mapKitchenToOrderStatus(newStatus)],
      );

      await client.query(
        `INSERT INTO tenant.order_event
           (business_id, order_id, event_kind, old_status, new_status, kitchen_status,
            reason, reason_code, reason_note, kitchen_sequence, source,
            idempotency_key, payload, occurred_at)
         VALUES ($1, $2, 'partial_cancellation', $3, $4, $4, $5, $5, $6, $7, 'kds',
                 $8, $9::jsonb, now())
         ON CONFLICT (business_id, idempotency_key)
           WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [
          order.business_id,
          order.id,
          currentStatus,
          newStatus,
          input.reasonCode,
          input.reasonNote,
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

      const phone = await this.customerPhone(client, order.business_id, order.person_id);
      // Only emit when notifications are enabled (buildNotifyBody returns null
      // when KDS_STATUS_NOTIFY_ENABLED is off) AND a customer phone exists.
      const body = phone ? input.buildNotifyBody(cancelled.rows, remaining.rows) : null;
      if (phone && body) {
        await client.query(
          `INSERT INTO runtime.outbox_event
             (business_id, event_type, aggregate_id, idempotency_key, payload)
           VALUES ($1, 'twilio.cancel_notification', $2, $3, $4::jsonb)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            order.business_id,
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
