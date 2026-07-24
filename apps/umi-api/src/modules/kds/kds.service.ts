import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import {
  KdsRepository,
  type OrderScopeRow,
  type TicketRow,
  type EventRow,
  type DeviceListRow,
} from './kds.repository';
import { partialCancelNotificationBody, statusNotificationBody } from './kds-notify.copy';
import {
  asSixDigitPin,
  asText,
  asUuid,
  DEVICE_LIVE_MS,
  DEVICE_OFFLINE_MS,
  DEVICE_REVOKED_BODY,
  type KdsDeviceSession,
  type KdsResult,
  KdsHttpError,
  type KitchenStatus,
  MAX_ATTEMPTS,
  PAIRING_LIST_LIMIT,
  PIN_SCAN_LIMIT,
  PIN_TTL_MINUTES,
  POLL_AFTER_SECONDS,
  hashPin,
  randomHex,
  randomPin,
  sha256Hex,
  validateTransition,
} from './dto/kds-contract';

// Per-IP brute-force guard on kds_start (the public PIN-guess vector). A legit
// pairing is a single PIN entry; 10/min/IP is generous for staff yet caps an
// attacker far below the 6-digit space within a pairing's 10-min TTL.
const PAIR_RATE_MAX = 10;
const PAIR_RATE_WINDOW_MS = 60_000;

/**
 * KDS domain logic. Two faces over one canonical model:
 *   - the FROZEN iPad contract (`pairing`/`board`/`command`/`verifyDevice`),
 *     which returns `{status, body}` envelopes the controller sends verbatim
 *     (errors are values, not thrown — except device auth, a typed throw the
 *     controller catches); and
 *   - the dashboard owner surface (`*ForDashboard`, pairing admin, transition),
 *     which returns plain objects and throws Nest HTTP exceptions.
 */
@Injectable()
export class KdsService {
  private readonly notifyEnabled: boolean;

  constructor(
    private readonly repo: KdsRepository,
    private readonly rateLimit: RateLimitService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.notifyEnabled = config.get('KDS_STATUS_NOTIFY_ENABLED', {
      infer: true,
    });
  }

  // ════════════════════════════ Device auth ════════════════════════════════

  /**
   * Resolve the `x-kds-device-token` header to a session, or throw the frozen
   * `device_revoked` body (401 missing / 403 inactive). Touches `last_used_at`
   * (the prod heartbeat signal).
   */
  async verifyDevice(rawToken: string | undefined): Promise<KdsDeviceSession> {
    const token = rawToken?.trim();
    if (!token) throw new KdsHttpError(401, DEVICE_REVOKED_BODY);

    const row = await this.repo.findSessionByToken(sha256Hex(token));
    if (!row || row.is_active !== true) {
      throw new KdsHttpError(403, DEVICE_REVOKED_BODY);
    }

    const session: KdsDeviceSession = {
      deviceId: row.id,
      tenantId: row.business_id,
      businessId: row.business_id,
      locationId: typeof row.metadata?.location_id === 'string' ? row.metadata.location_id : null,
      stationId: row.station_id,
      deviceName: row.device_name,
    };
    await this.repo.touchSession(session.deviceId);
    return session;
  }

  // ═══════════════════════════ iPad: pairing ════════════════════════════════

  /** Device-side pairing (kds_start / kds_status). Admin actions are dashboard-only. */
  async pairing(body: Record<string, unknown>, ip: string | null = null): Promise<KdsResult> {
    const action = asText(body.action);
    if (!action) return { status: 400, body: { error: 'missing_action' } };

    if (action === 'kds_start') return this.kdsStart(body, ip);
    if (action === 'kds_status') return this.kdsStatus(body);
    return { status: 400, body: { error: 'unknown_action' } };
  }

  private async kdsStart(body: Record<string, unknown>, ip: string | null): Promise<KdsResult> {
    const pin = asSixDigitPin(body.pin);
    const requestedName = asText(body.device_name) || 'Kitchen iPad';
    if (!pin) return { status: 400, body: { error: 'invalid_pin' } };

    // Brute-force guard: cap PIN guesses per source IP. A pairing-row attempt
    // counter is unenforceable in this flow (a global PIN match can't attribute
    // a wrong guess to a specific pairing), so rate-limit the endpoint instead.
    if (ip && !this.rateLimit.hit(`kds:pair:${ip}`, PAIR_RATE_MAX, PAIR_RATE_WINDOW_MS).allowed) {
      return { status: 429, body: { error: 'rate_limited' } };
    }

    const candidates = await this.repo.findPendingPairingsForPin(PIN_SCAN_LIMIT);
    for (const p of candidates) {
      if (p.attempt_count >= p.max_attempts) continue;
      if (hashPin(pin, p.pin_salt) !== p.pin_hash) continue;

      // PIN matched — only record the device name (attempt_count tracks failed
      // guesses; wrong PINs are rate-limited by TTL, mirroring the edge fn).
      await this.repo.setPairingRequestedName(p.id, requestedName);
      return {
        status: 200,
        body: {
          pairing_id: p.id,
          status: 'pending',
          poll_after_seconds: POLL_AFTER_SECONDS,
          expires_at: p.expires_at,
        },
      };
    }
    return { status: 404, body: { error: 'pairing_not_found' } };
  }

  private async kdsStatus(body: Record<string, unknown>): Promise<KdsResult> {
    const pairingId = asUuid(body.pairing_id);
    if (!pairingId) {
      return { status: 400, body: { error: 'missing_pairing_id' } };
    }

    const pairing = await this.repo.getPairing(pairingId);
    if (!pairing) return { status: 404, body: { error: 'pairing_not_found' } };

    if (pairing.status === 'pending' && new Date(pairing.expires_at).getTime() <= Date.now()) {
      await this.repo.expirePairing(pairingId);
      return { status: 200, body: { status: 'expired' } };
    }

    if (pairing.status !== 'approved') {
      return {
        status: 200,
        body: {
          status: pairing.status,
          ...(pairing.status === 'pending' ? { poll_after_seconds: POLL_AFTER_SECONDS } : {}),
        },
      };
    }

    if (pairing.used_at) return { status: 409, body: { status: 'used' } };

    const station = await this.repo.loadStation(
      pairing.business_id,
      pairing.location_id,
      pairing.station_id ?? '',
    );
    if (!station) return { status: 404, body: { error: 'station_not_found' } };

    const session = await this.repo.createDeviceSession({
      tenantId: pairing.business_id,
      locationId: pairing.location_id,
      stationId: pairing.station_id,
      deviceName: pairing.requested_name || pairing.device_name,
    });

    // Atomically mark the pairing used; lose the race ⇒ drop the new device
    // (cascades the session) so no orphan registry row is left behind.
    const claimed = await this.repo.claimPairing(pairingId);
    if (!claimed) {
      await this.repo.deleteDevice(session.device_registry_id);
      return { status: 409, body: { status: 'used' } };
    }

    return {
      status: 200,
      body: {
        status: 'approved',
        device_session: {
          device_id: session.id,
          token: session.token,
          business_id: session.business_id,
          // frozen iPad KDS contract still reads `tenant_id`; keep the wire key
          // (sourced from the renamed column) until the device is updated.
          tenant_id: session.business_id,
          location_id: pairing.location_id,
          station_id: session.station_id,
          station_name: station.name,
          device_name: session.device_name,
        },
      },
    };
  }

  // ════════════════════════════ iPad: board ════════════════════════════════

  async board(session: KdsDeviceSession, body: Record<string, unknown>): Promise<KdsResult> {
    const action = asText(body.action);
    if (!action) return { status: 400, body: { error: 'missing_action' } };

    if (action === 'snapshot') {
      const rows = await this.repo.boardSnapshot(session.tenantId, session.stationId);
      return { status: 200, body: { ok: true, data: rows.map(toSnapshotRow) } };
    }

    if (action === 'events') {
      const after = Number.isFinite(Number(body.after_sequence)) ? Number(body.after_sequence) : 0;
      const limit = Number.isFinite(Number(body.limit))
        ? Math.min(Math.max(Number(body.limit), 1), 500)
        : 200;
      const rows = await this.repo.ticketEvents(session.tenantId, session.stationId, after, limit);
      return { status: 200, body: { ok: true, data: rows.map(toEventRow) } };
    }

    if (action === 'session_status') {
      return { status: 200, body: { ok: true, device_id: session.deviceId } };
    }

    return { status: 400, body: { error: 'unknown_action' } };
  }

  // ═══════════════════════════ iPad: command ════════════════════════════════

  async command(session: KdsDeviceSession, body: Record<string, unknown>): Promise<KdsResult> {
    const action = asText(body.action);
    if (!action) return { status: 400, body: { error: 'missing_action' } };

    if (action === 'transition_ticket') {
      const ticketId = asText(body.ticket_id);
      const target = asText(body.target_status) as KitchenStatus;
      if (!ticketId || !target) {
        return { status: 400, body: { error: 'missing_required_fields' } };
      }
      const order = await this.repo.loadOrderForScope(session.tenantId, ticketId, asUuid(ticketId));
      if (!ticketBelongsToDevice(order, session)) {
        return { status: 404, body: { error: 'ticket_not_found' } };
      }
      const err = validateTransition(order.kitchen_status, target);
      if (err) return { status: 422, body: { error: err } };

      const result = await this.repo.transitionTicket({
        order: order,
        targetStatus: target,
        actorId: session.deviceId,
        actorChannel: session.stationId,
        cancellationReasonCode: optText(body.cancellation_reason_code),
        cancellationReasonNote: optText(body.cancellation_reason_note),
        notifyBody: this.notifyEnabled ? statusNotificationBody(target) : null,
      });
      return {
        status: 200,
        body: {
          ok: true,
          data: { ticket_id: order.id, status: target, sequence: result.sequence },
        },
      };
    }

    if (action === 'partial_cancel_items') {
      const ticketId = asText(body.ticket_id);
      const rawIds = Array.isArray(body.item_ids) ? (body.item_ids as unknown[]) : [];
      // Validate every id as a uuid BEFORE the `::uuid[]` cast (a bad value would
      // otherwise surface as a raw 500 instead of a clean 400).
      const mappedIds = rawIds.map((v) => asUuid(v));
      const reasonCode = asText(body.reason_code);
      if (!ticketId || mappedIds.length === 0 || mappedIds.some((x) => x === null) || !reasonCode) {
        return { status: 400, body: { error: 'missing_required_fields' } };
      }
      const itemIds = [...new Set(mappedIds as string[])];
      const order = await this.repo.loadOrderForScope(session.tenantId, ticketId, asUuid(ticketId));
      if (!ticketBelongsToDevice(order, session)) {
        return { status: 404, body: { error: 'ticket_not_found' } };
      }

      const result = await this.repo.partialCancelItems({
        order: order,
        itemIds,
        reasonCode,
        reasonNote: optText(body.reason_note),
        actorId: session.deviceId,
        actorChannel: session.stationId,
        buildNotifyBody: (cancelled, remaining) =>
          this.notifyEnabled ? partialCancelNotificationBody(cancelled, remaining) : null,
      });
      return {
        status: 200,
        body: {
          ok: true,
          data: {
            ticket_id: order.id,
            status: result.newStatus,
            sequence: result.sequence,
          },
        },
      };
    }

    return { status: 400, body: { error: 'unknown_action' } };
  }

  // ════════════════════════════ Heartbeat ══════════════════════════════════

  async heartbeat(body: Record<string, unknown>, ip: string | null): Promise<KdsResult> {
    const deviceId = asUuid(body.device_id);
    if (deviceId) await this.repo.heartbeatTouch(deviceId, ip);
    // Always 200 (fire-and-forget liveness ping), mirroring the legacy contract.
    return { status: 200, body: { ok: true, ts: new Date().toISOString() } };
  }

  // ═══════════════════════════ Dashboard surface ════════════════════════════

  async listDevicesForDashboard(
    tenantId: string,
    locationId: string | null,
  ): Promise<{ devices: unknown[] }> {
    const rows = await this.repo.listDevices(tenantId, locationId);
    return { devices: rows.map(toDeviceRow) };
  }

  async listOrdersForDashboard(
    tenantId: string,
    filter: string | undefined,
    locationId: string | null,
  ): Promise<{ orders: unknown[] }> {
    const statuses = orderFilterStatuses(filter);
    const rows = await this.repo.listOrders(tenantId, statuses, locationId, 24);
    return { orders: rows.map(toOrderRow) };
  }

  async tickerForDashboard(tenantId: string): Promise<{ events: unknown[] }> {
    const rows = await this.repo.recentEvents(tenantId, 50);
    return { events: rows.map(toTickerRow) };
  }

  async listStationsForDashboard(
    tenantId: string,
    locationId: string | null,
  ): Promise<{ stations: unknown[] }> {
    const stations = await this.repo.listStations(tenantId, locationId);
    return { stations };
  }

  /**
   * Create a station for the tenant (dashboard "Estaciones" panel + the
   * add-device empty state). `station_key` is derived from the name (accent-
   * folded slug) unless the caller passes one. Created at the active location
   * scope so it shows in that location's dropdown; unscoped (tenant-wide) when
   * no location is selected.
   */
  async createStation(
    tenantId: string,
    locationId: string | null,
    body: Record<string, unknown>,
  ): Promise<{ station: unknown }> {
    const name = asText(body.name);
    if (!name) throw new BadRequestException({ error: 'missing_station_name' });
    const stationKey = stationKeyFromName(asText(body.station_key) || name);
    if (!stationKey) {
      throw new BadRequestException({ error: 'invalid_station_name' });
    }
    // Pre-check catches tenant-wide (location_id IS NULL) duplicates the DB's
    // NULL-distinct unique index would let through; the 23505 catch below is the
    // race backstop and covers location-scoped dupes.
    const existing = await this.repo.findActiveStationByKey(tenantId, locationId, stationKey);
    if (existing) throw new ConflictException({ error: 'station_exists' });
    try {
      const station = await this.repo.createStation({
        tenantId,
        locationId,
        name,
        stationKey,
      });
      return { station };
    } catch (err) {
      // unique (business_id, location_id, station_key)
      if ((err as { code?: string })?.code === '23505') {
        throw new ConflictException({ error: 'station_exists' });
      }
      throw err;
    }
  }

  /** Rename a station (keeps the stable `station_key`). */
  async updateStation(
    tenantId: string,
    stationId: string,
    body: Record<string, unknown>,
  ): Promise<{ station: unknown }> {
    const id = asUuid(stationId);
    if (!id) throw new BadRequestException({ error: 'invalid_station_id' });
    const name = asText(body.name);
    if (!name) throw new BadRequestException({ error: 'missing_station_name' });
    const station = await this.repo.updateStation({
      tenantId,
      stationId: id,
      name,
    });
    if (!station) throw new NotFoundException({ error: 'station_not_found' });
    return { station };
  }

  /** Archive a station (soft delete — hidden from the active list). */
  async archiveStation(tenantId: string, stationId: string): Promise<{ ok: true }> {
    const id = asUuid(stationId);
    if (!id) throw new BadRequestException({ error: 'invalid_station_id' });
    const ok = await this.repo.archiveStation(tenantId, id);
    if (!ok) throw new NotFoundException({ error: 'station_not_found' });
    return { ok: true };
  }

  async listPairingsForDashboard(
    tenantId: string,
    locationId: string | null,
  ): Promise<{ pairings: unknown[] }> {
    const pairings = await this.repo.listPairingRequests(tenantId, locationId, PAIRING_LIST_LIMIT);
    return { pairings };
  }

  /** Create a pairing PIN (dashboard `provision` + `pairing-pin` both land here). */
  async createPairing(
    tenantId: string,
    locationId: string | null,
    body: Record<string, unknown>,
  ): Promise<{ pairing: Record<string, unknown> }> {
    const stationId = asUuid(body.station_id);
    const deviceName = asText(body.device_name) || asText(body.name);
    if (!stationId || !deviceName) {
      throw new BadRequestException({ error: 'missing_required_fields' });
    }
    const station = await this.repo.loadStation(tenantId, locationId, stationId);
    if (!station) throw new NotFoundException({ error: 'station_not_found' });
    // When the dashboard didn't scope by location, anchor the pairing to the
    // station's own location so kds_status re-resolves the same station
    // (loadStation now treats a missing locationId as unscoped, not root-only).
    const pairingLocationId = locationId ?? station.location_id;

    const pin = randomPin();
    const pinSalt = randomHex(16);
    const pinHash = hashPin(pin, pinSalt);
    const expiresAt = new Date(Date.now() + PIN_TTL_MINUTES * 60_000).toISOString();

    const row = await this.repo.insertPairingRequest({
      tenantId,
      locationId: pairingLocationId,
      stationId,
      deviceName,
      pinHash,
      pinSalt,
      maxAttempts: MAX_ATTEMPTS,
      expiresAt,
    });
    return {
      pairing: {
        ...row,
        station_name: station.name,
        pin,
        poll_after_seconds: POLL_AFTER_SECONDS,
      },
    };
  }

  async approvePairing(
    tenantId: string,
    pairingId: string,
    adminUserId: string | null,
  ): Promise<{ ok: true; pairing: { id: string; status: string } }> {
    const id = asUuid(pairingId);
    if (!id) throw new BadRequestException({ error: 'invalid_pairing_id' });
    const updated = await this.repo.dispositionPairing(id, tenantId, 'approve', adminUserId);
    if (!updated) throw new BadRequestException({ error: 'pairing_not_pending' });
    return { ok: true, pairing: updated };
  }

  async denyPairing(
    tenantId: string,
    pairingId: string,
  ): Promise<{ ok: true; pairing: { id: string; status: string } }> {
    const id = asUuid(pairingId);
    if (!id) throw new BadRequestException({ error: 'invalid_pairing_id' });
    const updated = await this.repo.dispositionPairing(id, tenantId, 'deny', null);
    if (!updated) throw new BadRequestException({ error: 'pairing_not_pending' });
    return { ok: true, pairing: updated };
  }

  async updateDevice(
    tenantId: string,
    deviceId: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    const id = asUuid(deviceId);
    if (!id) throw new BadRequestException({ error: 'invalid_device_id' });
    // Only touch station_id when the PATCH actually carries it, so a rename-only
    // update doesn't wipe the device's station assignment.
    const patch: { deviceName: string | null; stationId?: string | null } = {
      deviceName: optText(body.device_name),
    };
    if ('station_id' in body) patch.stationId = asUuid(body.station_id);
    const ok = await this.repo.updateSession(tenantId, id, patch);
    if (!ok) throw new NotFoundException({ error: 'device_not_found' });
    return { ok: true };
  }

  async revokeDevice(tenantId: string, deviceId: string): Promise<{ ok: true }> {
    const id = asUuid(deviceId);
    if (!id) throw new BadRequestException({ error: 'invalid_device_id' });
    const ok = await this.repo.revokeSession(tenantId, id);
    if (!ok) throw new NotFoundException({ error: 'device_not_found' });
    return { ok: true };
  }

  /** Dashboard-driven status transition (owner-authed; same canonical write). */
  async transitionFromDashboard(
    tenantId: string,
    actorUserId: string | null,
    ticketId: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: true; data: unknown }> {
    const target = asText(body.target_status) as KitchenStatus;
    if (!target) {
      throw new BadRequestException({ error: 'missing_required_fields' });
    }
    const order = await this.repo.loadOrderForScope(tenantId, ticketId, asUuid(ticketId));
    if (!order) {
      throw new NotFoundException({ error: 'ticket_not_found' });
    }
    const err = validateTransition(order.kitchen_status, target);
    if (err) throw new BadRequestException({ error: err });

    let result: { sequence: number };
    try {
      result = await this.repo.transitionTicket({
        order,
        targetStatus: target,
        actorId: actorUserId,
        actorChannel: 'dashboard',
        cancellationReasonCode: optText(body.cancellation_reason_code),
        cancellationReasonNote: optText(body.cancellation_reason_note),
        notifyBody: this.notifyEnabled ? statusNotificationBody(target) : null,
      });
    } catch (e) {
      // The repo re-checks under a row lock; surface a lost-race conflict as a
      // proper HTTP status (the iPad path catches KdsHttpError directly).
      if (e instanceof KdsHttpError) {
        throw new HttpException(e.body as string | Record<string, unknown>, e.status);
      }
      throw e;
    }
    return {
      ok: true,
      data: { ticket_id: order.id, status: target, sequence: result.sequence },
    };
  }
}

// ── pure helpers (exported for unit tests) ─────────────────────────────────

function optText(value: unknown): string | null {
  const t = asText(value);
  return t.length ? t : null;
}

/**
 * Slugify a station name into a stable `station_key` (unique per tenant+location):
 * lowercase, strip accents (estación → estacion), non-alphanumerics → `_`,
 * trim leading/trailing separators, cap at 40 chars. Returns '' for names with
 * no usable characters (caller rejects those).
 */
export function stationKeyFromName(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function ticketBelongsToDevice(
  order: OrderScopeRow | null,
  session: KdsDeviceSession,
): order is OrderScopeRow {
  if (!order) return false;
  const tenantMatches = order.business_id === session.tenantId;
  const locationMatches =
    !session.locationId || order.location_id === session.locationId || order.location_id == null;
  const stationMatches =
    !session.stationId || order.station_id === session.stationId || order.station_id == null;
  return tenantMatches && locationMatches && stationMatches;
}

export function deviceStatus(lastUsedAt: string | null): string {
  if (!lastUsedAt) return 'offline';
  const ms = Date.now() - new Date(lastUsedAt).getTime();
  if (ms < DEVICE_LIVE_MS) return 'live';
  if (ms < DEVICE_OFFLINE_MS) return 'slow';
  return 'offline';
}

function remapItems(items: unknown): unknown[] {
  if (!Array.isArray(items)) return [];
  return items.map((raw) => {
    const i = (raw ?? {}) as Record<string, unknown>;
    const cents = Number(i.unit_price_cents ?? 0);
    return {
      ticket_item_id: i.ticket_item_id,
      name: i.name,
      quantity: i.quantity,
      variant_name: i.variant_name,
      notes: i.notes,
      is_cancelled: i.is_cancelled,
      unit_price: cents / 100,
      display_order: i.display_order,
    };
  });
}

function toSnapshotRow(t: TicketRow) {
  return {
    ticket_id: t.ticket_id,
    source_transaction_id: t.source_transaction_id,
    business_id: t.business_id,
    source_channel: t.source_channel,
    status: t.status,
    station_id: t.station_id,
    station_name: t.station_name,
    customer_name: t.customer_name,
    customer_phone: t.customer_phone,
    pickup_person: t.pickup_person,
    customer_note: t.customer_note,
    total_amount: Number(t.total_amount),
    created_at: t.created_at,
    updated_at: t.updated_at,
    last_event_sequence: Number(t.last_event_sequence),
    items: remapItems(t.items),
  };
}

function toEventRow(e: EventRow) {
  return {
    sequence: Number(e.sequence),
    ticket_id: e.ticket_id,
    business_id: e.business_id,
    source_transaction_id: e.source_transaction_id,
    kind: e.kind,
    status: e.status,
    occurred_at: e.occurred_at,
    source: e.source,
    payload: e.payload,
  };
}

function toOrderRow(t: TicketRow) {
  const items = remapItems(t.items);
  return {
    ticket_id: t.ticket_id,
    source_transaction_id: t.source_transaction_id,
    status: t.status,
    station_id: t.station_id,
    station_name: t.station_name,
    customer_name: t.customer_name,
    customer_phone: t.customer_phone,
    pickup_person: t.pickup_person,
    customer_note: t.customer_note,
    total_amount: Number(t.total_amount),
    created_at: t.created_at,
    updated_at: t.updated_at,
    items,
    items_count: items.length,
  };
}

function toDeviceRow(d: DeviceListRow) {
  const status = deviceStatus(d.last_used_at);
  const secondsAgo = d.last_used_at
    ? Math.floor((Date.now() - new Date(d.last_used_at).getTime()) / 1000)
    : null;
  return {
    device_id: d.device_id,
    device_registry_id: d.device_registry_id,
    device_type: d.device_type ?? 'kds',
    device_name: d.device_name,
    station_id: d.station_id,
    station_name: d.station_name,
    last_used_at: d.last_used_at,
    ip: typeof d.metadata?.ip === 'string' ? d.metadata.ip : null,
    status,
    secondsAgo,
    lastSeen: d.last_used_at,
  };
}

function toTickerRow(e: EventRow) {
  return {
    sequence: Number(e.sequence),
    ticket_id: e.ticket_id,
    source_transaction_id: e.source_transaction_id,
    kind: e.kind,
    status: e.status,
    occurred_at: e.occurred_at,
  };
}

function orderFilterStatuses(filter: string | undefined): KitchenStatus[] | null {
  switch (filter) {
    case 'active':
      return ['new', 'accepted', 'preparing', 'ready', 'partial_cancelled'];
    case 'completed':
      return ['completed'];
    case 'cancelled':
      return ['cancelled'];
    default:
      return null; // 'all' or unset → every status within the window
  }
}
