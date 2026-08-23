import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PosKitchenOrderQuery } from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import {
  KdsRepository,
  type OrderScopeRow,
  type TicketRow,
  type EventRow,
  type DeviceListRow,
} from './kds.repository';
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
} from './dto/kds-contract';

// Limit PIN attempts from one IP address.
const PAIR_RATE_MAX = 10;
const PAIR_RATE_WINDOW_MS = 60_000;

/** Serve the iPad KDS contract and the dashboard operations. */
@Injectable()
export class KdsService {
  constructor(
    private readonly repo: KdsRepository,
    private readonly rateLimit: RateLimitService,
  ) {}

  // ════════════════════════════ Device auth ════════════════════════════════

  /** Resolve the KDS device token and update its last-use time. */
  async verifyDevice(rawToken: string | undefined): Promise<KdsDeviceSession> {
    const token = rawToken?.trim();
    if (!token) throw new KdsHttpError(401, DEVICE_REVOKED_BODY);

    const row = await this.repo.findSessionByToken(sha256Hex(token));
    if (!row || row.is_active !== true) {
      throw new KdsHttpError(403, DEVICE_REVOKED_BODY);
    }

    const session: KdsDeviceSession = {
      deviceId: row.id,
      merchantId: row.merchant_id,
      locationId: typeof row.metadata?.location_id === 'string' ? row.metadata.location_id : null,
      stationId: row.station_id,
      deviceName: row.device_name,
      permissions: Array.isArray(row.metadata?.permissions)
        ? row.metadata.permissions.filter((value): value is string => typeof value === 'string')
        : ['kitchen.read', 'kitchen.prepare', 'kitchen.ready', 'kitchen.complete'],
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
      pairing.merchant_id,
      pairing.location_id,
      pairing.station_id ?? '',
    );
    if (!station) return { status: 404, body: { error: 'station_not_found' } };

    const session = await this.repo.createDeviceSession({
      merchantId: pairing.merchant_id,
      locationId: pairing.location_id,
      stationId: pairing.station_id,
      deviceName: pairing.requested_name || pairing.device_name,
    });

    // Atomically mark the pairing used, stamping the device it just produced (the
    // pairing's CHECK requires it). Lose the race ⇒ drop the new device and its
    // session so no orphan registry row is left behind.
    const claimed = await this.repo.claimPairing(pairingId, session.device_registry_id);
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
          merchant_id: session.merchant_id,
          // Keep tenant_id as a compatibility field for installed KDS clients.
          tenant_id: session.merchant_id,
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
    if (!session.permissions.includes('kitchen.read')) {
      return { status: 403, body: { error: 'kitchen_permission_denied' } };
    }

    if (action === 'snapshot') {
      if (!session.locationId || !session.stationId) {
        return { status: 403, body: { error: 'kitchen_device_not_assigned' } };
      }
      const rows = await this.repo.boardSnapshot(session.merchantId, session.locationId, [
        session.stationId,
      ]);
      return { status: 200, body: { ok: true, data: rows.map(toSnapshotRow) } };
    }

    if (action === 'events') {
      const afterValue = body.afterSequence ?? body.after_sequence;
      const after = Number.isFinite(Number(afterValue)) ? Number(afterValue) : 0;
      const limit = Number.isFinite(Number(body.limit))
        ? Math.min(Math.max(Number(body.limit), 1), 500)
        : 200;
      if (!session.locationId || !session.stationId) {
        return { status: 403, body: { error: 'kitchen_device_not_assigned' } };
      }
      const rows = await this.repo.ticketEvents(
        session.merchantId,
        session.locationId,
        [session.stationId],
        after,
        limit,
      );
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

    if (action === 'command') return this.canonicalCommand(session, body);

    if (action === 'transition_ticket') {
      const ticketId = asText(body.ticket_id);
      const target = asText(body.target_status) as KitchenStatus;
      if (!ticketId || !target) {
        return { status: 400, body: { error: 'missing_required_fields' } };
      }
      const identity = kitchenCommandIdentity(body);
      if (!identity) {
        return { status: 400, body: { error: 'kitchen_command_identity_required' } };
      }
      const order = await this.repo.loadOrderForScope(
        session.merchantId,
        ticketId,
        asUuid(ticketId),
      );
      if (!ticketBelongsToDevice(order, session)) {
        return { status: 404, body: { error: 'ticket_not_found' } };
      }
      const commandType =
        target === 'preparing' && order.kitchen_order_status === 'ready'
          ? 'recall'
          : target === 'cancelled'
            ? 'cancel_ack'
            : kitchenCommandType(target);
      const permission = kitchenPermission(commandType);
      if (!session.permissions.includes(permission)) {
        return { status: 403, body: { error: 'kitchen_permission_denied' } };
      }
      const result = await this.repo.executeKitchenCommand({
        session,
        order,
        commandId: identity.commandId,
        idempotencyKey: identity.idempotencyKey,
        correlationId: identity.correlationId,
        expectedVersion: identity.expectedVersion,
        commandType,
        targetStatus: canonicalKitchenStatus(target),
        itemIds: [],
        reasonCode: optText(body.cancellation_reason_code),
        reasonNote: optText(body.cancellation_reason_note),
        priority: null,
        payloadFingerprint: sha256Hex(
          JSON.stringify({
            ticketId,
            target,
            expectedVersion: identity.expectedVersion,
            reasonCode: optText(body.cancellation_reason_code),
            reasonNote: optText(body.cancellation_reason_note),
          }),
        ),
      });
      return {
        status: result.status === 'conflict' ? 409 : 200,
        body: {
          ok: true,
          data: result.result,
        },
      };
    }

    if (action === 'partial_cancel_items') {
      if (!session.permissions.includes('kitchen.cancel_ack')) {
        return { status: 403, body: { error: 'kitchen_permission_denied' } };
      }
      const ticketId = asText(body.ticket_id);
      const rawIds = Array.isArray(body.item_ids) ? (body.item_ids as unknown[]) : [];
      // Validate every id as a uuid BEFORE the `::uuid[]` cast (a bad value would
      // otherwise surface as a raw 500 instead of a clean 400).
      const mappedIds = rawIds.map((v) => asUuid(v));
      const reasonCode = asText(body.reason_code);
      if (!ticketId || mappedIds.length === 0 || mappedIds.some((x) => x === null) || !reasonCode) {
        return { status: 400, body: { error: 'missing_required_fields' } };
      }
      const identity = kitchenCommandIdentity(body);
      if (!identity) {
        return { status: 400, body: { error: 'kitchen_command_identity_required' } };
      }
      const itemIds = [...new Set(mappedIds as string[])];
      const order = await this.repo.loadOrderForScope(
        session.merchantId,
        ticketId,
        asUuid(ticketId),
      );
      if (!ticketBelongsToDevice(order, session)) {
        return { status: 404, body: { error: 'ticket_not_found' } };
      }

      const result = await this.repo.executeKitchenCommand({
        session,
        order,
        commandId: identity.commandId,
        idempotencyKey: identity.idempotencyKey,
        correlationId: identity.correlationId,
        expectedVersion: identity.expectedVersion,
        commandType: 'cancel_ack',
        targetStatus: null,
        itemIds,
        reasonCode,
        reasonNote: optText(body.reason_note),
        priority: null,
        payloadFingerprint: sha256Hex(
          JSON.stringify({
            ticketId,
            itemIds: [...itemIds].sort(),
            reasonCode,
            reasonNote: optText(body.reason_note),
            expectedVersion: identity.expectedVersion,
          }),
        ),
      });
      return {
        status: result.status === 'conflict' ? 409 : 200,
        body: {
          ok: true,
          data: result.result,
        },
      };
    }

    return { status: 400, body: { error: 'unknown_action' } };
  }

  private async canonicalCommand(
    session: KdsDeviceSession,
    body: Record<string, unknown>,
  ): Promise<KdsResult> {
    const kitchenOrderId = asUuid(body.kitchenOrderId);
    const commandTypeValue = asText(body.commandType);
    const allowedCommandTypes = [
      'start_preparation',
      'mark_item_ready',
      'mark_order_ready',
      'complete',
      'recall',
      'cancel_ack',
      'change_priority',
    ] as const;
    const commandType = allowedCommandTypes.includes(commandTypeValue as never)
      ? (commandTypeValue as
          | 'start_preparation'
          | 'mark_item_ready'
          | 'mark_order_ready'
          | 'complete'
          | 'recall'
          | 'cancel_ack'
          | 'change_priority')
      : null;
    const identity = kitchenCommandIdentity(body);
    if (!kitchenOrderId || !commandType || !identity) {
      return { status: 400, body: { error: 'missing_required_fields' } };
    }
    const permission = kitchenPermission(commandType);
    if (!session.permissions.includes(permission)) {
      return { status: 403, body: { error: 'kitchen_permission_denied' } };
    }
    const rawItemIds = Array.isArray(body.itemIds) ? body.itemIds : [];
    const parsedItemIds = rawItemIds.map(asUuid);
    if (parsedItemIds.some((value) => value === null)) {
      return { status: 400, body: { error: 'invalid_kitchen_item_id' } };
    }
    const itemIds = [...new Set(parsedItemIds as string[])];
    const order = await this.repo.loadOrderForScope(
      session.merchantId,
      kitchenOrderId,
      kitchenOrderId,
    );
    if (!ticketBelongsToDevice(order, session)) {
      return { status: 404, body: { error: 'ticket_not_found' } };
    }
    const priorityValue = asText(body.priority);
    const priority = ['normal', 'high', 'urgent'].includes(priorityValue)
      ? (priorityValue as 'normal' | 'high' | 'urgent')
      : null;
    const reasonCode = optText(body.reasonCode);
    const reasonNote = optText(body.reasonNote);
    if (
      (commandType === 'mark_item_ready' && itemIds.length === 0) ||
      (commandType === 'change_priority' && priority === null) ||
      (commandType === 'recall' && !reasonCode) ||
      (reasonCode?.length ?? 0) > 100 ||
      (reasonNote?.length ?? 0) > 500
    ) {
      return { status: 400, body: { error: 'invalid_kitchen_command' } };
    }
    const fingerprintInput = {
      kitchenOrderId,
      commandType,
      itemIds: [...itemIds].sort(),
      reasonCode,
      reasonNote,
      priority,
      expectedVersion: identity.expectedVersion,
    };
    const result = await this.repo.executeKitchenCommand({
      session,
      order,
      commandId: identity.commandId,
      idempotencyKey: identity.idempotencyKey,
      correlationId: identity.correlationId,
      expectedVersion: identity.expectedVersion,
      commandType,
      targetStatus: null,
      itemIds,
      reasonCode: fingerprintInput.reasonCode,
      reasonNote: fingerprintInput.reasonNote,
      priority,
      payloadFingerprint: sha256Hex(JSON.stringify(fingerprintInput)),
    });
    return {
      status: result.status === 'conflict' ? 409 : 200,
      body: { ok: true, data: result.result },
    };
  }

  // ════════════════════════════ Heartbeat ══════════════════════════════════

  async heartbeat(session: KdsDeviceSession, ip: string | null): Promise<KdsResult> {
    await this.repo.heartbeatTouch(session.deviceId, session.merchantId, ip);
    return { status: 200, body: { ok: true, ts: new Date().toISOString() } };
  }

  // ═══════════════════════════ Dashboard surface ════════════════════════════

  async statusForPos(
    user: AuthUser,
    merchantId: string,
    sourceOrderId: string,
    query: PosKitchenOrderQuery,
  ) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    const allowed = await this.repo.authorizePos(
      user.id,
      user.sessionId,
      user.deviceId,
      merchantId,
      query.locationId,
      query.operatorSessionId,
    );
    if (!allowed) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    const result = await this.repo.posKitchenStatus(merchantId, query.locationId, sourceOrderId);
    if (!result) throw new NotFoundException({ code: 'KITCHEN_ORDER_NOT_FOUND' });
    return result;
  }

  async listDevicesForDashboard(
    merchantId: string,
    locationId: string | null,
  ): Promise<{ devices: unknown[] }> {
    const rows = await this.repo.listDevices(merchantId, locationId);
    return { devices: rows.map(toDeviceRow) };
  }

  async listOrdersForDashboard(
    merchantId: string,
    filter: string | undefined,
    locationId: string | null,
  ): Promise<{ orders: unknown[] }> {
    const statuses = orderFilterStatuses(filter);
    const rows = await this.repo.listOrders(merchantId, statuses, locationId, 24);
    return { orders: rows.map(toOrderRow) };
  }

  async tickerForDashboard(merchantId: string): Promise<{ events: unknown[] }> {
    const rows = await this.repo.recentEvents(merchantId, 50);
    return { events: rows.map(toTickerRow) };
  }

  async listStationsForDashboard(
    merchantId: string,
    locationId: string | null,
  ): Promise<{ stations: unknown[] }> {
    const stations = await this.repo.listStations(merchantId, locationId);
    return { stations };
  }

  /**
   * Create a station for the merchant (dashboard "Estaciones" panel + the
   * add-device empty state). `station_key` is derived from the name (accent-
   * folded slug) unless the caller passes one. Created at the active location
   * scope so it shows in that location's dropdown; unscoped (merchant-wide) when
   * no location is selected.
   */
  async createStation(
    merchantId: string,
    locationId: string | null,
    body: Record<string, unknown>,
  ): Promise<{ station: unknown }> {
    if (!locationId) throw new BadRequestException({ error: 'kitchen_location_required' });
    const name = asText(body.name);
    if (!name) throw new BadRequestException({ error: 'missing_station_name' });
    const stationKey = stationKeyFromName(asText(body.station_key) || name);
    if (!stationKey) {
      throw new BadRequestException({ error: 'invalid_station_name' });
    }
    // Detect an existing location key before the insert.
    const existing = await this.repo.findActiveStationByKey(merchantId, locationId, stationKey);
    if (existing) throw new ConflictException({ error: 'station_exists' });
    try {
      const station = await this.repo.createStation({
        merchantId,
        locationId,
        name,
        stationKey,
      });
      return { station };
    } catch (err) {
      // unique (merchant_id, location_id, station_key)
      if ((err as { code?: string })?.code === '23505') {
        throw new ConflictException({ error: 'station_exists' });
      }
      throw err;
    }
  }

  /** Rename a station (keeps the stable `station_key`). */
  async updateStation(
    merchantId: string,
    stationId: string,
    body: Record<string, unknown>,
  ): Promise<{ station: unknown }> {
    const id = asUuid(stationId);
    if (!id) throw new BadRequestException({ error: 'invalid_station_id' });
    const name = asText(body.name);
    if (!name) throw new BadRequestException({ error: 'missing_station_name' });
    const station = await this.repo.updateStation({
      merchantId,
      stationId: id,
      name,
    });
    if (!station) throw new NotFoundException({ error: 'station_not_found' });
    return { station };
  }

  /** Archive a station (soft delete — hidden from the active list). */
  async archiveStation(merchantId: string, stationId: string): Promise<{ ok: true }> {
    const id = asUuid(stationId);
    if (!id) throw new BadRequestException({ error: 'invalid_station_id' });
    const ok = await this.repo.archiveStation(merchantId, id);
    if (!ok) throw new NotFoundException({ error: 'station_not_found' });
    return { ok: true };
  }

  async listRoutes(merchantId: string, locationId: string | null) {
    const location = asUuid(locationId);
    if (!location) throw new BadRequestException({ error: 'location_required' });
    return { routes: await this.repo.listRoutes(merchantId, location) };
  }

  async createRoute(merchantId: string, locationId: string | null, body: Record<string, unknown>) {
    const location = asUuid(locationId);
    const stationId = asUuid(body.stationId ?? body.station_id);
    const productId =
      body.productId || body.product_id ? asUuid(body.productId ?? body.product_id) : null;
    const categoryId =
      body.categoryId || body.category_id ? asUuid(body.categoryId ?? body.category_id) : null;
    const routePriority = Number(body.routePriority ?? body.route_priority ?? 100);
    const targetValue = body.targetSeconds ?? body.target_seconds;
    const targetSeconds = targetValue == null ? null : Number(targetValue);
    if (
      !location ||
      !stationId ||
      (productId !== null && categoryId !== null) ||
      !Number.isInteger(routePriority) ||
      routePriority < 0 ||
      routePriority > 10_000 ||
      (targetSeconds !== null &&
        (!Number.isInteger(targetSeconds) || targetSeconds < 30 || targetSeconds > 86_400))
    ) {
      throw new BadRequestException({ error: 'invalid_kitchen_route' });
    }
    try {
      const route = await this.repo.createRoute({
        merchantId,
        locationId: location,
        productId,
        categoryId,
        stationId,
        routePriority,
        targetSeconds,
      });
      if (!route) throw new NotFoundException({ error: 'station_not_found' });
      return { route };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException({ error: 'kitchen_route_exists' });
      }
      throw error;
    }
  }

  async updateRoute(merchantId: string, routeId: string, body: Record<string, unknown>) {
    const id = asUuid(routeId);
    const stationId = asUuid(body.stationId ?? body.station_id);
    const expectedVersion = Number(body.expectedVersion ?? body.expected_version);
    const routePriority = Number(body.routePriority ?? body.route_priority ?? 100);
    const targetValue = body.targetSeconds ?? body.target_seconds;
    const targetSeconds = targetValue == null ? null : Number(targetValue);
    const active = body.active !== false;
    if (
      !id ||
      !stationId ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 1 ||
      !Number.isInteger(routePriority) ||
      routePriority < 0 ||
      routePriority > 10_000 ||
      (targetSeconds !== null &&
        (!Number.isInteger(targetSeconds) || targetSeconds < 30 || targetSeconds > 86_400))
    ) {
      throw new BadRequestException({ error: 'invalid_kitchen_route' });
    }
    const route = await this.repo.updateRoute({
      merchantId,
      routeId: id,
      stationId,
      active,
      routePriority,
      targetSeconds,
      expectedVersion,
    });
    if (!route) throw new ConflictException({ error: 'kitchen_route_conflict' });
    return { route };
  }

  async listPairingsForDashboard(
    merchantId: string,
    locationId: string | null,
  ): Promise<{ pairings: unknown[] }> {
    const pairings = await this.repo.listPairingRequests(
      merchantId,
      locationId,
      PAIRING_LIST_LIMIT,
    );
    return { pairings };
  }

  /** Create a pairing PIN (dashboard `provision` + `pairing-pin` both land here). */
  async createPairing(
    merchantId: string,
    locationId: string | null,
    body: Record<string, unknown>,
  ): Promise<{ pairing: Record<string, unknown> }> {
    const stationId = asUuid(body.station_id);
    const deviceName = asText(body.device_name) || asText(body.name);
    if (!stationId || !deviceName) {
      throw new BadRequestException({ error: 'missing_required_fields' });
    }
    const station = await this.repo.loadStation(merchantId, locationId, stationId);
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
      merchantId,
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
    merchantId: string,
    pairingId: string,
    adminUserId: string | null,
  ): Promise<{ ok: true; pairing: { id: string; status: string } }> {
    const id = asUuid(pairingId);
    if (!id) throw new BadRequestException({ error: 'invalid_pairing_id' });
    const updated = await this.repo.dispositionPairing(id, merchantId, 'approve', adminUserId);
    if (!updated) throw new BadRequestException({ error: 'pairing_not_pending' });
    return { ok: true, pairing: updated };
  }

  async denyPairing(
    merchantId: string,
    pairingId: string,
  ): Promise<{ ok: true; pairing: { id: string; status: string } }> {
    const id = asUuid(pairingId);
    if (!id) throw new BadRequestException({ error: 'invalid_pairing_id' });
    const updated = await this.repo.dispositionPairing(id, merchantId, 'deny', null);
    if (!updated) throw new BadRequestException({ error: 'pairing_not_pending' });
    return { ok: true, pairing: updated };
  }

  async updateDevice(
    merchantId: string,
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
    const ok = await this.repo.updateSession(merchantId, id, patch);
    if (!ok) throw new NotFoundException({ error: 'device_not_found' });
    return { ok: true };
  }

  async revokeDevice(merchantId: string, deviceId: string): Promise<{ ok: true }> {
    const id = asUuid(deviceId);
    if (!id) throw new BadRequestException({ error: 'invalid_device_id' });
    const ok = await this.repo.revokeSession(merchantId, id);
    if (!ok) throw new NotFoundException({ error: 'device_not_found' });
    return { ok: true };
  }

  /** Dashboard-driven status transition (owner-authed; same canonical write). */
  async transitionFromDashboard(
    merchantId: string,
    actorUserId: string | null,
    ticketId: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: true; data: unknown }> {
    const actorId = asUuid(actorUserId);
    const stationId = asUuid(body.stationId ?? body.station_id);
    const identity = kitchenCommandIdentity(body);
    const target = asText(body.targetStatus ?? body.target_status);
    const reasonCode = optText(body.reasonCode ?? body.reason_code);
    const reasonNote = optText(body.reasonNote ?? body.reason_note);
    if (
      !actorId ||
      !stationId ||
      !identity ||
      target !== 'in_preparation' ||
      !reasonCode ||
      reasonCode.length > 100 ||
      (reasonNote?.length ?? 0) > 500
    ) {
      throw new BadRequestException({ error: 'kitchen_recall_fields_required' });
    }
    const order = await this.repo.loadOrderForScope(merchantId, ticketId, asUuid(ticketId));
    if (!order || !order.location_id || !order.station_ids?.includes(stationId)) {
      throw new NotFoundException({ error: 'ticket_not_found' });
    }
    const result = await this.repo.executeKitchenCommand({
      session: {
        deviceId: null,
        merchantId,
        locationId: order.location_id,
        stationId,
        deviceName: null,
        permissions: ['kitchen.recall'],
      },
      actorUserId: actorId,
      order,
      commandId: identity.commandId,
      idempotencyKey: identity.idempotencyKey,
      correlationId: identity.correlationId,
      expectedVersion: identity.expectedVersion,
      commandType: 'recall',
      targetStatus: 'in_preparation',
      itemIds: [],
      reasonCode,
      reasonNote,
      priority: null,
      payloadFingerprint: sha256Hex(
        JSON.stringify({
          ticketId,
          stationId,
          target: 'in_preparation',
          expectedVersion: identity.expectedVersion,
        }),
      ),
    });
    if (result.status === 'conflict') {
      throw new ConflictException(result.result);
    }
    return { ok: true, data: result.result };
  }
}

// ── pure helpers (exported for unit tests) ─────────────────────────────────

function optText(value: unknown): string | null {
  const t = asText(value);
  return t.length ? t : null;
}

function kitchenCommandIdentity(body: Record<string, unknown>): {
  commandId: string;
  idempotencyKey: string;
  correlationId: string;
  expectedVersion: number;
} | null {
  const commandId = asUuid(body.commandId ?? body.command_id);
  const idempotencyKey = asText(body.idempotencyKey ?? body.idempotency_key);
  const correlationId = asText(body.correlationId ?? body.correlation_id);
  const expectedVersion = Number(body.expectedVersion ?? body.expected_version);
  if (
    !commandId ||
    idempotencyKey.length < 8 ||
    correlationId.length < 8 ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 1
  ) {
    return null;
  }
  return { commandId, idempotencyKey, correlationId, expectedVersion };
}

function kitchenPermission(commandType: string): string {
  if (commandType === 'mark_item_ready' || commandType === 'mark_order_ready') {
    return 'kitchen.ready';
  }
  if (commandType === 'complete') return 'kitchen.complete';
  if (commandType === 'recall') return 'kitchen.recall';
  if (commandType === 'cancel_ack') return 'kitchen.cancel_ack';
  if (commandType === 'change_priority') return 'kitchen.priority';
  return 'kitchen.prepare';
}

function canonicalKitchenStatus(
  status: KitchenStatus,
): 'queued' | 'in_preparation' | 'ready' | 'completed' | 'cancelled' {
  switch (status) {
    case 'new':
      return 'queued';
    case 'accepted':
    case 'preparing':
    case 'partial_cancelled':
      return 'in_preparation';
    case 'ready':
    case 'completed':
    case 'cancelled':
      return status;
  }
}

function kitchenCommandType(
  status: KitchenStatus,
): 'start_preparation' | 'mark_order_ready' | 'complete' {
  if (status === 'ready') return 'mark_order_ready';
  if (status === 'completed') return 'complete';
  return 'start_preparation';
}

/**
 * Slugify a station name into a stable `station_key` (unique per merchant+location):
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
  if (!session.locationId || !session.stationId) return false;
  const stationIds = order.station_ids ?? (order.station_id ? [order.station_id] : []);
  return (
    order.merchant_id === session.merchantId &&
    order.location_id === session.locationId &&
    stationIds.includes(session.stationId)
  );
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
    return {
      id: i.ticket_item_id ?? i.id,
      productName: i.name ?? i.productName,
      quantity: i.quantity,
      variantName: i.variant_name ?? i.variantName ?? null,
      preparationNote: i.notes ?? i.preparationNote ?? null,
      modifiers: i.modifiers ?? [],
      status: i.status ?? 'queued',
      displayOrder: i.display_order ?? i.displayOrder,
      targetSeconds: i.targetSeconds ?? null,
      version: i.version ?? 1,
    };
  });
}

function toSnapshotRow(t: TicketRow) {
  return {
    id: t.ticket_id,
    sourceOrderId: t.source_transaction_id,
    publicReference: t.public_reference ?? t.source_transaction_id,
    merchantId: t.merchant_id,
    locationId: (t as TicketRow & { location_id?: string }).location_id,
    source: t.source_channel,
    status: t.status,
    priority: (t as TicketRow & { priority?: string }).priority ?? 'normal',
    stationId: t.station_id,
    businessDate: (t as TicketRow & { business_date?: string }).business_date,
    queuedAt: t.created_at,
    preparationStartedAt:
      (t as TicketRow & { preparation_started_at?: string }).preparation_started_at ?? null,
    updatedAt: t.updated_at,
    version: (t as TicketRow & { version?: number }).version ?? 1,
    lastEventSequence: Number(t.last_event_sequence),
    items: remapItems(t.items),
  };
}

function toEventRow(e: EventRow) {
  return {
    sequence: Number(e.sequence),
    kitchenOrderId: e.ticket_id,
    merchantId: e.merchant_id,
    sourceOrderId: e.source_transaction_id,
    kind: e.kind,
    status: e.status,
    occurredAt: e.occurred_at,
    source: e.source,
    payload: e.payload,
    locationId: e.location_id,
    stationId: e.station_id ?? null,
    aggregateVersion: e.aggregate_version ?? 1,
    correlationId: e.correlation_id ?? 'kitchen-event',
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
