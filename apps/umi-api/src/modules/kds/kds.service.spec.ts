import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { deviceStatus, KdsService, stationKeyFromName, ticketBelongsToDevice } from './kds.service';
import { KitchenBoardEvents } from '../realtime/kitchen-board.events';
import {
  DEVICE_REVOKED_BODY,
  hashPin,
  KdsHttpError,
  type KdsDeviceSession,
  sha256Hex,
  validateTransition,
} from './dto/kds-contract';

function make() {
  const repo = {
    findSessionByToken: vi.fn(),
    touchSession: vi.fn().mockResolvedValue(undefined),
    findPendingPairingsForPin: vi.fn().mockResolvedValue([]),
    setPairingRequestedName: vi.fn().mockResolvedValue(undefined),
    getPairing: vi.fn(),
    expirePairing: vi.fn().mockResolvedValue(undefined),
    loadStation: vi.fn(),
    findActiveStationByKey: vi.fn().mockResolvedValue(null),
    createStation: vi.fn().mockResolvedValue({
      id: 's1',
      station_key: 'estacion_fria',
      name: 'Estación Fría',
      status: 'active',
      sort_order: 0,
      location_id: null,
    }),
    listRoutes: vi.fn().mockResolvedValue([]),
    createRoute: vi.fn().mockResolvedValue({ id: 'route-1', version: 1 }),
    updateRoute: vi.fn().mockResolvedValue({ id: 'route-1', version: 2 }),
    createDeviceSession: vi.fn(),
    claimPairing: vi.fn(),
    deleteDevice: vi.fn().mockResolvedValue(undefined),
    boardSnapshot: vi.fn().mockResolvedValue([]),
    ticketEvents: vi.fn().mockResolvedValue([]),
    authorizePos: vi.fn().mockResolvedValue({
      allowed: true,
      permissions: ['kitchen.read', 'kitchen.prepare', 'kitchen.ready', 'kitchen.complete'],
    }),
    listStations: vi.fn().mockResolvedValue([]),
    executeKitchenCommand: vi.fn().mockResolvedValue({
      status: 'succeeded',
      result: { kitchenOrderId: 'o1', status: 'in_preparation', version: 2, sequence: 5 },
    }),
    loadOrderForScope: vi.fn(),
    heartbeatTouch: vi.fn().mockResolvedValue(true),
    sessionLastUsedAt: vi.fn().mockResolvedValue(null),
  };
  const rateLimit = {
    hit: vi.fn().mockReturnValue({ allowed: true, remaining: 9, resetAt: 0 }),
  };
  const realtime = { emitDevicesChanged: vi.fn() };
  // The board's wake-up bus (§8H step 8): a real instance, because `waitForChange` is a
  // subject and a stub of it would be a stub of the thing under test.
  const svc = new KdsService(
    repo as never,
    rateLimit as never,
    realtime as never,
    new KitchenBoardEvents(),
  );
  return { svc, repo, rateLimit, realtime };
}

const SESSION: KdsDeviceSession = {
  deviceId: 'dev-1',
  merchantId: 't1',
  locationId: 'loc-1',
  stationId: 'station-1',
  deviceName: 'iPad',
  permissions: ['kitchen.read', 'kitchen.prepare', 'kitchen.ready', 'kitchen.complete'],
};

const COMMAND = {
  command_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  idempotency_key: 'kitchen-command-1',
  correlation_id: 'kitchen-correlation-1',
  expected_version: 1,
};

describe('KdsService.verifyDevice', () => {
  it('missing token → 401 with the frozen device_revoked body', async () => {
    const { svc } = make();
    await expect(svc.verifyDevice(undefined)).rejects.toMatchObject({
      status: 401,
      body: DEVICE_REVOKED_BODY,
    });
  });

  it('unknown token → 403 device_revoked', async () => {
    const { svc, repo } = make();
    repo.findSessionByToken.mockResolvedValue(null);
    await expect(svc.verifyDevice('tok')).rejects.toBeInstanceOf(KdsHttpError);
    await expect(svc.verifyDevice('tok')).rejects.toMatchObject({ status: 403 });
  });

  it('inactive session → 403 device_revoked', async () => {
    const { svc, repo } = make();
    repo.findSessionByToken.mockResolvedValue({
      id: 's1',
      merchant_id: 't1',
      is_active: false,
      metadata: {},
    });
    await expect(svc.verifyDevice('tok')).rejects.toMatchObject({ status: 403 });
  });

  it('active session → normalized + touched (merchantId=merchant, location from metadata)', async () => {
    const { svc, repo } = make();
    repo.findSessionByToken.mockResolvedValue({
      id: 's1',
      merchant_id: 't1',
      station_id: 'st1',
      device_name: 'Expo',
      is_active: true,
      metadata: { location_id: 'loc-9' },
    });
    const session = await svc.verifyDevice('tok');
    expect(session).toMatchObject({
      deviceId: 's1',
      merchantId: 't1',
      locationId: 'loc-9',
      stationId: 'st1',
    });
    expect(repo.touchSession).toHaveBeenCalledWith('s1');
  });
});

describe('KdsService.pairing — kds_start', () => {
  it('rejects a non-6-digit pin', async () => {
    const { svc } = make();
    const r = await svc.pairing({ action: 'kds_start', pin: '12' });
    expect(r).toEqual({ status: 400, body: { error: 'invalid_pin' } });
  });

  it('matches a pending pin and records the device name without bumping attempts', async () => {
    const { svc, repo } = make();
    repo.findPendingPairingsForPin.mockResolvedValue([
      {
        id: 'p1',
        pin_hash: hashPin('123456', 'salt'),
        pin_salt: 'salt',
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        expires_at: '2999-01-01T00:00:00Z',
      },
    ]);
    const r = await svc.pairing({
      action: 'kds_start',
      pin: '123456',
      device_name: 'Cocina 1',
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ pairing_id: 'p1', status: 'pending' });
    expect(repo.setPairingRequestedName).toHaveBeenCalledWith('p1', 'Cocina 1');
  });

  it('skips exhausted requests and 404s when no pin matches', async () => {
    const { svc, repo } = make();
    repo.findPendingPairingsForPin.mockResolvedValue([
      {
        id: 'p1',
        pin_hash: hashPin('123456', 'salt'),
        pin_salt: 'salt',
        status: 'pending',
        attempt_count: 5,
        max_attempts: 5,
        expires_at: '2999-01-01T00:00:00Z',
      },
    ]);
    const r = await svc.pairing({ action: 'kds_start', pin: '123456' });
    expect(r).toEqual({ status: 404, body: { error: 'pairing_not_found' } });
    expect(repo.setPairingRequestedName).not.toHaveBeenCalled();
  });

  it('429s kds_start when the per-IP rate limit is exceeded', async () => {
    const { svc, repo, rateLimit } = make();
    rateLimit.hit.mockReturnValueOnce({ allowed: false, remaining: 0, resetAt: 0 });
    const r = await svc.pairing({ action: 'kds_start', pin: '123456' }, '1.2.3.4');
    expect(r).toEqual({ status: 429, body: { error: 'rate_limited' } });
    expect(repo.findPendingPairingsForPin).not.toHaveBeenCalled();
  });

  it('skips the rate limit when no IP is provided', async () => {
    const { svc, rateLimit } = make();
    await svc.pairing({ action: 'kds_start', pin: '123456' });
    expect(rateLimit.hit).not.toHaveBeenCalled();
  });
});

describe('KdsService.pairing — kds_status', () => {
  const approved = {
    id: 'p1',
    merchant_id: 't1',
    location_id: null,
    station_id: 'st1',
    device_name: 'iPad',
    requested_name: 'Cocina 1',
    status: 'approved',
    expires_at: '2999-01-01T00:00:00Z',
    used_at: null,
  };

  it('issues a device session + token on an approved+claimed pairing', async () => {
    const { svc, repo } = make();
    repo.getPairing.mockResolvedValue(approved);
    repo.loadStation.mockResolvedValue({ id: 'st1', name: 'Expo', merchant_id: 't1' });
    repo.createDeviceSession.mockResolvedValue({
      id: 'sess-1',
      merchant_id: 't1',
      station_id: 'st1',
      device_name: 'Cocina 1',
      token: 'plaintext-token',
      device_registry_id: 'reg-1',
    });
    repo.claimPairing.mockResolvedValue(true);

    const r = await svc.pairing({
      action: 'kds_status',
      pairing_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      status: 'approved',
      device_session: {
        device_id: 'sess-1',
        token: 'plaintext-token',
        merchant_id: 't1',
        tenant_id: 't1',
        station_name: 'Expo',
      },
    });
  });

  it('drops the session and returns used on a lost claim race', async () => {
    const { svc, repo } = make();
    repo.getPairing.mockResolvedValue(approved);
    repo.loadStation.mockResolvedValue({ id: 'st1', name: 'Expo', merchant_id: 't1' });
    repo.createDeviceSession.mockResolvedValue({
      id: 'sess-1',
      merchant_id: 't1',
      station_id: 'st1',
      device_name: 'x',
      token: 't',
      device_registry_id: 'reg-1',
    });
    repo.claimPairing.mockResolvedValue(false);

    const r = await svc.pairing({
      action: 'kds_status',
      pairing_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    });
    expect(r).toEqual({ status: 409, body: { status: 'used' } });
    expect(repo.deleteDevice).toHaveBeenCalledWith('reg-1');
  });

  it('expires a stale pending pairing', async () => {
    const { svc, repo } = make();
    repo.getPairing.mockResolvedValue({
      ...approved,
      status: 'pending',
      expires_at: '2000-01-01T00:00:00Z',
    });
    const r = await svc.pairing({
      action: 'kds_status',
      pairing_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    });
    expect(r).toEqual({ status: 200, body: { status: 'expired' } });
    expect(repo.expirePairing).toHaveBeenCalled();
  });
});

describe('KdsService.board', () => {
  it('reads only the assigned location and station', async () => {
    const { svc, repo } = make();
    const session = { ...SESSION, locationId: 'loc-1', stationId: 'station-1' };
    await svc.board(session, { action: 'snapshot' });
    expect(repo.boardSnapshot).toHaveBeenCalledWith('t1', 'loc-1', ['station-1']);
  });

  it('returns preparation facts without contact or money data', async () => {
    const { svc, repo } = make();
    repo.boardSnapshot.mockResolvedValue([
      {
        ticket_id: 'o1',
        source_transaction_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
        public_reference: '1024',
        merchant_id: 't1',
        source_channel: 'pos',
        location_id: 'loc-1',
        business_date: '2026-08-09',
        priority: 'normal',
        version: 1,
        status: 'queued',
        station_id: 'station-1',
        station_name: 'Kitchen',
        created_at: 'now',
        updated_at: 'now',
        last_event_sequence: '3',
        items: [
          {
            ticket_item_id: 'i1',
            name: 'Latte',
            quantity: 1,
            status: 'queued',
            modifiers: [],
            version: 1,
            display_order: 0,
          },
        ],
      },
    ]);
    const r = await svc.board(SESSION, { action: 'snapshot' });
    expect(r.status).toBe(200);
    const data = (
      r.body as {
        data: Array<{ items: Array<{ productName: string }>; lastEventSequence: number }>;
      }
    ).data;
    expect(data[0].items[0].productName).toBe('Latte');
    expect(data[0].lastEventSequence).toBe(3);
    expect(JSON.stringify(data[0])).not.toContain('customer');
    expect(JSON.stringify(data[0])).not.toContain('4500');
  });

  it('session_status returns the device id', async () => {
    const { svc } = make();
    const r = await svc.board(SESSION, { action: 'session_status' });
    expect(r).toEqual({ status: 200, body: { ok: true, device_id: 'dev-1' } });
  });
});

describe('KdsService.command — transition_ticket', () => {
  const order = {
    id: 'o1',
    merchant_id: 't1',
    location_id: 'loc-1',
    station_id: 'station-1',
    station_ids: ['station-1'],
    kitchen_status: 'new',
    person_id: 'p1',
    source_transaction_id: null,
  };

  it('400s on missing fields', async () => {
    const { svc } = make();
    const r = await svc.command(SESSION, { action: 'transition_ticket', ticket_id: 'o1' });
    expect(r).toEqual({ status: 400, body: { error: 'missing_required_fields' } });
  });

  it('requires stable command identity and optimistic version', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue({ ...order, version: 1 });
    const r = await svc.command(SESSION, {
      action: 'transition_ticket',
      ticket_id: 'o1',
      target_status: 'preparing',
    });
    expect(r).toEqual({ status: 400, body: { error: 'kitchen_command_identity_required' } });
  });

  it('404s when the ticket is not in the device scope', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue({ ...order, merchant_id: 'OTHER' });
    const r = await svc.command(SESSION, {
      action: 'transition_ticket',
      ticket_id: 'o1',
      target_status: 'accepted',
      ...COMMAND,
    });
    expect(r).toEqual({ status: 404, body: { error: 'ticket_not_found' } });
  });

  it('422s on an invalid transition', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue({ ...order, kitchen_status: 'completed' });
    repo.executeKitchenCommand.mockResolvedValue({
      status: 'conflict',
      result: { code: 'KITCHEN_INVALID_TRANSITION' },
    });
    const r = await svc.command(SESSION, {
      action: 'transition_ticket',
      ticket_id: 'o1',
      target_status: 'preparing',
      ...COMMAND,
    });
    expect(r.status).toBe(409);
  });

  it('runs an authoritative kitchen transition', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue(order);
    const r = await svc.command(SESSION, {
      action: 'transition_ticket',
      ticket_id: 'o1',
      target_status: 'accepted',
      ...COMMAND,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, data: { status: 'in_preparation', sequence: 5 } });
    expect(repo.executeKitchenCommand).toHaveBeenCalledTimes(1);
  });

  it('uses one canonical command path', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue(order);
    await svc.command(SESSION, {
      action: 'transition_ticket',
      ticket_id: 'o1',
      target_status: 'accepted',
      ...COMMAND,
    });
    expect(repo.executeKitchenCommand).toHaveBeenCalledTimes(1);
  });
});

describe('KdsService.command — financial separation', () => {
  it('denies legacy item cancellation without the exact permission', async () => {
    const { svc } = make();
    const r = await svc.command(SESSION, {
      action: 'partial_cancel_items',
      ticket_id: 'o1',
      reason_code: 'out_of_stock',
    });
    expect(r).toEqual({ status: 403, body: { error: 'kitchen_permission_denied' } });
  });

  it('does not let an ordinary KDS device cancel commercial items', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue({
      id: 'o1',
      merchant_id: 't1',
      location_id: 'loc-1',
      station_id: 'station-1',
      station_ids: ['station-1'],
      kitchen_status: 'preparing',
      person_id: 'p1',
      source_transaction_id: null,
    });
    const r = await svc.command(SESSION, {
      action: 'partial_cancel_items',
      ticket_id: 'o1',
      item_ids: ['3f2504e0-4f89-41d3-9a0c-0305e82c3301'],
      reason_code: 'out_of_stock',
      ...COMMAND,
    });
    expect(r).toEqual({ status: 403, body: { error: 'kitchen_permission_denied' } });
    expect(repo.executeKitchenCommand).not.toHaveBeenCalled();
  });
});

describe('KdsService.command — canonical request', () => {
  it('binds an optimistic version and stable command identity', async () => {
    const { svc, repo } = make();
    const kitchenOrderId = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';
    repo.loadOrderForScope.mockResolvedValue({
      id: kitchenOrderId,
      merchant_id: 't1',
      location_id: 'loc-1',
      station_id: 'station-1',
      station_ids: ['station-1'],
      kitchen_status: 'new',
      kitchen_order_status: 'queued',
      version: 1,
      person_id: null,
      source_transaction_id: null,
    });
    const result = await svc.command(SESSION, {
      action: 'command',
      commandId: COMMAND.command_id,
      idempotencyKey: COMMAND.idempotency_key,
      correlationId: COMMAND.correlation_id,
      expectedVersion: 1,
      kitchenOrderId,
      commandType: 'start_preparation',
      itemIds: [],
    });
    expect(result.status).toBe(200);
    expect(repo.executeKitchenCommand).toHaveBeenCalledWith(
      expect.objectContaining({ commandType: 'start_preparation', expectedVersion: 1 }),
    );
  });

  // §8H step 4. The iPad's body is the frozen native client's shape — it is not
  // zod-validated — so the course has to be judged here. A value the CHECK would refuse
  // must be a 400 that names the field, and the interesting refusals are the ones the
  // contract's `z.number()` would refuse too: `'2'` coerces to a course without this
  // guard, and 2.5 is not a course at all.
  it('fires a course in 1..20 and refuses anything else with a 400', async () => {
    const { svc, repo } = make();
    const kitchenOrderId = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';
    repo.loadOrderForScope.mockResolvedValue({
      id: kitchenOrderId,
      merchant_id: 't1',
      location_id: 'loc-1',
      station_id: 'station-1',
      station_ids: ['station-1'],
      kitchen_status: 'new',
      kitchen_order_status: 'queued',
      version: 1,
      person_id: null,
      source_transaction_id: null,
    });
    const body = (courseNumber: unknown) => ({
      action: 'command',
      commandId: COMMAND.command_id,
      idempotencyKey: COMMAND.idempotency_key,
      correlationId: COMMAND.correlation_id,
      expectedVersion: 1,
      kitchenOrderId,
      commandType: 'fire_course',
      itemIds: [],
      courseNumber,
    });

    expect((await svc.command(SESSION, body(2))).status).toBe(200);
    expect(repo.executeKitchenCommand).toHaveBeenCalledWith(
      expect.objectContaining({ commandType: 'fire_course', courseNumber: 2 }),
    );

    for (const refused of [0, 21, '2', 2.5, null]) {
      repo.executeKitchenCommand.mockClear();
      expect(await svc.command(SESSION, body(refused))).toEqual({
        status: 400,
        body: { error: 'invalid_kitchen_command' },
      });
      expect(repo.executeKitchenCommand).not.toHaveBeenCalled();
    }
  });
});

describe('KdsService unknown actions', () => {
  it('pairing/board/command 400 on unknown action', async () => {
    const { svc } = make();
    expect(await svc.pairing({ action: 'nope' })).toMatchObject({ status: 400 });
    expect(await svc.board(SESSION, { action: 'nope' })).toMatchObject({ status: 400 });
    expect(await svc.command(SESSION, { action: 'nope' })).toMatchObject({ status: 400 });
  });
});

describe('pure helpers', () => {
  it('ticketBelongsToDevice honors merchant/location/station scope', () => {
    expect(
      ticketBelongsToDevice(
        {
          id: 'o',
          merchant_id: 't1',
          location_id: 'loc-1',
          station_id: 'station-1',
          station_ids: ['station-1'],
          kitchen_status: 'new',
          person_id: null,
          source_transaction_id: null,
        },
        SESSION,
      ),
    ).toBe(true);
    expect(
      ticketBelongsToDevice(
        {
          id: 'o',
          merchant_id: 'other',
          location_id: null,
          station_id: null,
          kitchen_status: 'new',
          person_id: null,
          source_transaction_id: null,
        },
        SESSION,
      ),
    ).toBe(false);
    expect(ticketBelongsToDevice(null, SESSION)).toBe(false);
  });

  it('ticketBelongsToDevice rejects null location and null station as wildcards', () => {
    const boundSession: KdsDeviceSession = {
      ...SESSION,
      locationId: 'loc-1',
      stationId: 'st-1',
    };
    expect(
      ticketBelongsToDevice(
        {
          id: 'o',
          merchant_id: 't1',
          location_id: null,
          station_id: null,
          kitchen_status: 'new',
          person_id: null,
          source_transaction_id: null,
        },
        boundSession,
      ),
    ).toBe(false);
    // A different, explicit location on the order is still rejected (merchant-scoped, not global).
    expect(
      ticketBelongsToDevice(
        {
          id: 'o',
          merchant_id: 't1',
          location_id: 'loc-2',
          station_id: null,
          kitchen_status: 'new',
          person_id: null,
          source_transaction_id: null,
        },
        boundSession,
      ),
    ).toBe(false);
  });

  it('createStation requires a location', async () => {
    const { svc, repo } = make();
    await expect(svc.createStation('t1', null, { name: 'Estación Fría' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.createStation).not.toHaveBeenCalled();
  });

  it('createStation blocks a duplicate active key before inserting', async () => {
    const { svc, repo } = make();
    repo.findActiveStationByKey.mockResolvedValue({ id: 'existing' });
    await expect(
      svc.createStation('t1', 'location-1', { name: 'Estación Fría' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.findActiveStationByKey).toHaveBeenCalledWith('t1', 'location-1', 'estacion_fria');
    expect(repo.createStation).not.toHaveBeenCalled();
  });

  it('createStation inserts an accent-folded key when unique', async () => {
    const { svc, repo } = make();
    const out = await svc.createStation('t1', 'location-1', { name: 'Estación Fría' });
    expect(repo.createStation).toHaveBeenCalledWith({
      merchantId: 't1',
      locationId: 'location-1',
      name: 'Estación Fría',
      stationKey: 'estacion_fria',
    });
    expect(out.station).toMatchObject({ id: 's1' });
  });

  it('stationKeyFromName slugifies (accent-folded, cap 40)', () => {
    expect(stationKeyFromName('Cocina Caliente')).toBe('cocina_caliente');
    expect(stationKeyFromName('Estación Fría')).toBe('estacion_fria');
    expect(stationKeyFromName('  Bar / Pass  ')).toBe('bar_pass');
    expect(stationKeyFromName('PASTELERÍA #2')).toBe('pasteleria_2');
    expect(stationKeyFromName('!!!')).toBe(''); // no usable chars ⇒ caller rejects
    expect(stationKeyFromName('x'.repeat(60)).length).toBe(40);
  });

  it('creates a location route through server authority', async () => {
    const { svc, repo } = make();
    await svc.createRoute(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      {
        stationId: 'a2000000-0000-4000-8000-000000000001',
        productId: 'a3000000-0000-4000-8000-000000000001',
        routePriority: 10,
        targetSeconds: 600,
      },
    );
    expect(repo.createRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId: 'a1000000-0000-4000-8000-000000000001',
        stationId: 'a2000000-0000-4000-8000-000000000001',
        productId: 'a3000000-0000-4000-8000-000000000001',
        categoryId: null,
        routePriority: 10,
      }),
    );
  });

  it('validateTransition enforces the matrix', () => {
    expect(validateTransition('new', 'accepted')).toBeNull();
    expect(validateTransition('new', 'cancelled')).toBeNull();
    expect(validateTransition('completed', 'preparing')).toMatch(/invalid_transition/);
    expect(validateTransition('new', 'bogus' as never)).toMatch(/invalid_target_status/);
    expect(validateTransition(null, 'accepted')).toBeNull(); // null current ⇒ 'new'
  });

  it('deviceStatus derives live/slow/offline from last_used_at', () => {
    expect(deviceStatus(null)).toBe('offline');
    expect(deviceStatus(new Date().toISOString())).toBe('live');
    expect(deviceStatus(new Date(Date.now() - 15_000).toISOString())).toBe('slow');
    expect(deviceStatus(new Date(Date.now() - 60_000).toISOString())).toBe('offline');
  });
});

describe('KdsService.heartbeat realtime wake-up', () => {
  it('emits a devices-changed wake-up when a device comes back online', async () => {
    const { svc, repo, realtime } = make();
    repo.sessionLastUsedAt.mockResolvedValue(new Date(Date.now() - 30_000).toISOString());
    await svc.heartbeat(SESSION, null);
    expect(realtime.emitDevicesChanged).toHaveBeenCalledTimes(1);
  });

  it('stays silent on a steady-state live heartbeat', async () => {
    const { svc, repo, realtime } = make();
    repo.sessionLastUsedAt.mockResolvedValue(new Date(Date.now() - 2_000).toISOString());
    await svc.heartbeat(SESSION, null);
    expect(realtime.emitDevicesChanged).not.toHaveBeenCalled();
  });
});

// Forward advance from a permission-guarded staff session (dashboard/POS operator), the
// sibling of the recall-only `transitionFromDashboard`. It reuses the same deep
// `executeKitchenCommand` path the device command uses, so start/ready/complete finally
// have a permission-gated entry point that is NOT the device-token path.
/**
 * Defect D33, the client-facing half: the till works the board it can see.
 *
 * `boardForPos` already authorised a STATION-LESS POS device by location + operator
 * session. The command route must authorise and scope the same way, or the board is a
 * view with no verbs — which is exactly what the sweep found: every ticket on the board
 * was unclosable because `ticketBelongsToDevice` needs a station the till does not have.
 */
describe('KdsService.commandForPos', () => {
  const POS_USER = {
    id: '44444444-4444-4444-8444-444444444444',
    email: null,
    sessionId: '55555555-5555-4555-8555-555555555555',
    deviceId: '66666666-6666-4666-8666-666666666666',
  };
  const LOCATION = 'a1000000-0000-4000-8000-000000000001';
  const OTHER_LOCATION = 'a1000000-0000-4000-8000-000000000002';
  const ST1 = 'a2000000-0000-4000-8000-000000000001';
  const ST2 = 'a2000000-0000-4000-8000-000000000002';
  const OPERATOR = '77777777-7777-4777-8777-777777777777';
  const ORDER = {
    id: 'a4000000-0000-4000-8000-000000000001',
    merchant_id: 't1',
    location_id: LOCATION,
    station_id: ST1,
    station_ids: [ST1, ST2],
    kitchen_status: 'new' as const,
    kitchen_order_status: 'queued' as const,
    version: 1,
    person_id: null,
    source_transaction_id: 'a4000000-0000-4000-8000-000000000002',
  };
  const ITEM = 'a5000000-0000-4000-8000-000000000001';

  const dto = (input: {
    commandType:
      | 'start_preparation'
      | 'mark_item_ready'
      | 'mark_order_ready'
      | 'complete'
      | 'recall'
      | 'change_priority'
      | 'fire_course';
    itemIds?: string[];
    reasonCode?: string | null;
    priority?: 'normal' | 'high' | 'urgent' | null;
    expectedVersion?: number;
    courseNumber?: number | null;
  }) => ({
    action: 'command' as const,
    commandId: '88888888-8888-4888-8888-888888888888',
    idempotencyKey: 'pos-kitchen-command-1',
    correlationId: 'pos-kitchen-correlation-1',
    expectedVersion: input.expectedVersion ?? 1,
    kitchenOrderId: ORDER.id,
    commandType: input.commandType,
    itemIds: input.itemIds ?? [],
    reasonCode: input.reasonCode ?? null,
    reasonNote: null,
    priority: input.priority ?? null,
    // §8H step 4: required by the strict contract, null for every command but fire_course.
    courseNumber: input.courseNumber ?? null,
    locationId: LOCATION,
    operatorSessionId: OPERATOR,
  });

  it('scopes a station-less session to the stations of its own location', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue(ORDER);
    repo.listStations.mockResolvedValue([{ id: ST1 }, { id: ST2 }]);

    const result = await svc.commandForPos(
      POS_USER,
      't1',
      dto({ commandType: 'start_preparation' }),
    );

    expect(result.ok).toBe(true);
    expect(repo.authorizePos).toHaveBeenCalledWith(
      POS_USER.id,
      POS_USER.sessionId,
      POS_USER.deviceId,
      't1',
      LOCATION,
      OPERATOR,
    );
    const arg = repo.executeKitchenCommand.mock.calls[0][0];
    expect(arg.commandType).toBe('start_preparation');
    expect(arg.actorUserId).toBe(POS_USER.id);
    // The person is the actor and the session names no station: `kitchen_command`
    // permits exactly one of device_id / actor_user_id.
    expect(arg.session).toMatchObject({
      deviceId: null,
      stationId: null,
      merchantId: 't1',
      locationId: LOCATION,
    });
    expect(arg.stationScope).toEqual([ST1, ST2]);
    // The fingerprint uses the device path's own key order, so the same logical
    // command carries ONE identity across both transports and a replay is a replay.
    expect(arg.payloadFingerprint).toBe(
      sha256Hex(
        JSON.stringify({
          kitchenOrderId: ORDER.id,
          commandType: 'start_preparation',
          itemIds: [],
          reasonCode: null,
          reasonNote: null,
          priority: null,
          expectedVersion: 1,
        }),
      ),
    );
  });

  it('refuses a ticket no active station of the location holds', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue({ ...ORDER, station_ids: ['archived-station'] });
    repo.listStations.mockResolvedValue([{ id: ST1 }]);

    await expect(
      svc.commandForPos(POS_USER, 't1', dto({ commandType: 'start_preparation' })),
    ).rejects.toMatchObject({ response: { code: 'KITCHEN_ORDER_NOT_ROUTED' } });
    expect(repo.executeKitchenCommand).not.toHaveBeenCalled();
  });

  it('tells a gone ticket apart from one at another location', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue(null);
    await expect(
      svc.commandForPos(POS_USER, 't1', dto({ commandType: 'start_preparation' })),
    ).rejects.toMatchObject({ response: { code: 'KITCHEN_ORDER_NOT_FOUND' } });

    repo.loadOrderForScope.mockResolvedValue({ ...ORDER, location_id: OTHER_LOCATION });
    await expect(
      svc.commandForPos(POS_USER, 't1', dto({ commandType: 'start_preparation' })),
    ).rejects.toMatchObject({
      response: {
        code: 'KITCHEN_ORDER_OUT_OF_SCOPE',
        details: { locationId: OTHER_LOCATION },
      },
    });
  });

  it('names the permission a command type needs', async () => {
    const { svc, repo } = make();
    repo.authorizePos.mockResolvedValue({
      allowed: true,
      permissions: ['kitchen.read', 'kitchen.prepare'],
    });
    repo.loadOrderForScope.mockResolvedValue(ORDER);
    repo.listStations.mockResolvedValue([{ id: ST1 }]);

    await expect(
      svc.commandForPos(POS_USER, 't1', dto({ commandType: 'mark_item_ready', itemIds: [ITEM] })),
    ).rejects.toMatchObject({
      response: {
        code: 'KITCHEN_PERMISSION_REQUIRED',
        details: { requiredPermission: 'kitchen.ready', commandType: 'mark_item_ready' },
      },
    });
    expect(repo.executeKitchenCommand).not.toHaveBeenCalled();
  });

  it('lets recall through with kitchen.recall, and demands its reason', async () => {
    const { svc, repo } = make();
    repo.authorizePos.mockResolvedValue({
      allowed: true,
      permissions: ['kitchen.read', 'kitchen.recall'],
    });
    repo.loadOrderForScope.mockResolvedValue(ORDER);
    repo.listStations.mockResolvedValue([{ id: ST1 }]);

    await expect(
      svc.commandForPos(POS_USER, 't1', dto({ commandType: 'recall' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    const recalled = await svc.commandForPos(
      POS_USER,
      't1',
      dto({ commandType: 'recall', reasonCode: 'too_early' }),
    );
    expect(recalled.ok).toBe(true);
    expect(repo.executeKitchenCommand.mock.calls[0][0].reasonCode).toBe('too_early');
  });

  it('refuses a session that is not authorised at all', async () => {
    const { svc, repo } = make();
    repo.authorizePos.mockResolvedValue({ allowed: false, permissions: [] });
    await expect(
      svc.commandForPos(POS_USER, 't1', dto({ commandType: 'start_preparation' })),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
  });

  it('refuses a session with no enrolled device', async () => {
    const { svc } = make();
    await expect(
      svc.commandForPos({ ...POS_USER, deviceId: null }, 't1', dto({ commandType: 'complete' })),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_NOT_ENROLLED' } });
  });

  it('turns a journal conflict into a 409 carrying the repo result', async () => {
    const { svc, repo } = make();
    repo.authorizePos.mockResolvedValue({
      allowed: true,
      permissions: ['kitchen.read', 'kitchen.complete'],
    });
    repo.loadOrderForScope.mockResolvedValue(ORDER);
    repo.listStations.mockResolvedValue([{ id: ST1 }]);
    repo.executeKitchenCommand.mockResolvedValue({
      status: 'conflict',
      result: { code: 'KITCHEN_VERSION_CONFLICT', expectedVersion: 1, currentVersion: 2 },
    });

    await expect(
      svc.commandForPos(POS_USER, 't1', dto({ commandType: 'complete' })),
    ).rejects.toMatchObject({
      response: { code: 'KITCHEN_VERSION_CONFLICT', currentVersion: 2 },
    });
  });
});

describe('KdsService.advanceFromDashboard', () => {
  const ACTOR = '33333333-3333-4333-8333-333333333333';
  const ST1 = '11111111-1111-4111-8111-111111111111';
  const ST2 = '22222222-2222-4222-8222-222222222222';
  const ORDER = {
    id: 'o1',
    merchant_id: 't1',
    location_id: 'loc-1',
    station_ids: [ST1],
    status: 'queued',
    version: '1',
  };

  it('advances a ticket to preparation, reusing executeKitchenCommand', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue(ORDER);
    const res = await svc.advanceFromDashboard('t1', ACTOR, 'o1', 'start_preparation', {
      ...COMMAND,
    });
    expect(res.ok).toBe(true);
    expect(repo.executeKitchenCommand).toHaveBeenCalledTimes(1);
    const arg = repo.executeKitchenCommand.mock.calls[0][0];
    expect(arg.commandType).toBe('start_preparation');
    expect(arg.actorUserId).toBe(ACTOR);
    expect(arg.session).toMatchObject({
      merchantId: 't1',
      locationId: 'loc-1',
      stationId: ST1,
      deviceId: null,
    });
  });

  it('maps ready and complete command types straight through', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue(ORDER);
    await svc.advanceFromDashboard('t1', ACTOR, 'o1', 'mark_order_ready', { ...COMMAND });
    expect(repo.executeKitchenCommand.mock.calls[0][0].commandType).toBe('mark_order_ready');
    await svc.advanceFromDashboard('t1', ACTOR, 'o1', 'complete', { ...COMMAND });
    expect(repo.executeKitchenCommand.mock.calls[1][0].commandType).toBe('complete');
  });

  it('honours an explicit stationId the ticket is routed to', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue({ ...ORDER, station_ids: [ST1, ST2] });
    await svc.advanceFromDashboard('t1', ACTOR, 'o1', 'start_preparation', {
      ...COMMAND,
      stationId: ST2,
    });
    expect(repo.executeKitchenCommand.mock.calls[0][0].session.stationId).toBe(ST2);
  });

  it('accepts a session actor id that is a valid UUID but not a strict v4', async () => {
    // Umi mints user ids like this (version nibble `f`); the strict asUuid would reject it.
    const REAL_ACTOR = '29b4e9bf-16ff-f3b2-6499-b885014589a5';
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue(ORDER);
    const res = await svc.advanceFromDashboard('t1', REAL_ACTOR, 'o1', 'start_preparation', {
      ...COMMAND,
    });
    expect(res.ok).toBe(true);
    expect(repo.executeKitchenCommand.mock.calls[0][0].actorUserId).toBe(REAL_ACTOR);
  });

  it('rejects when the optimistic-concurrency identity is missing', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue(ORDER);
    await expect(
      svc.advanceFromDashboard('t1', ACTOR, 'o1', 'start_preparation', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.executeKitchenCommand).not.toHaveBeenCalled();
  });

  it('is NOT_FOUND when the ticket does not exist for the merchant', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue(null);
    await expect(
      svc.advanceFromDashboard('t1', ACTOR, 'missing', 'start_preparation', { ...COMMAND }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is NOT_FOUND when an explicit station is not one the ticket is routed to', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue(ORDER);
    await expect(
      svc.advanceFromDashboard('t1', ACTOR, 'o1', 'start_preparation', {
        ...COMMAND,
        stationId: '99999999-9999-4999-8999-999999999999',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps a repository conflict to CONFLICT', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue(ORDER);
    repo.executeKitchenCommand.mockResolvedValue({ status: 'conflict', result: { error: 'x' } });
    await expect(
      svc.advanceFromDashboard('t1', ACTOR, 'o1', 'start_preparation', { ...COMMAND }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

/**
 * §8H step 2, the API half: the board is refused to an operator who may not read
 * it.
 *
 * The client now hides the `Cocina` destination without `kitchen.read`, and
 * hiding is not enforcement — `authorizePos` is what actually keeps a cashier
 * out. These pin the refusal as the typed one the till turns into a permission
 * message, and pin the empty case as an empty BOARD rather than a refusal: a
 * location with no stations has no kitchen to show, which is not the same
 * statement as "you may not look".
 */
describe('KdsService.boardForPos', () => {
  const POS_USER = {
    id: '44444444-4444-4444-8444-444444444444',
    email: null,
    sessionId: '55555555-5555-4555-8555-555555555555',
    deviceId: '66666666-6666-4666-8666-666666666666',
  };
  const QUERY = {
    locationId: 'a1000000-0000-4000-8000-000000000001',
    operatorSessionId: '77777777-7777-4777-8777-777777777777',
  };

  it('refuses an operator whose session holds no kitchen.read', async () => {
    const { svc, repo } = make();
    repo.authorizePos.mockResolvedValue({ allowed: false, permissions: [] });

    await expect(svc.boardForPos(POS_USER, 't1', QUERY)).rejects.toMatchObject({
      response: { code: 'PERMISSION_DENIED' },
    });
  });

  it('refuses a caller with no enrolled device', async () => {
    const { svc } = make();

    await expect(
      svc.boardForPos({ ...POS_USER, deviceId: null }, 't1', QUERY),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_NOT_ENROLLED' } });
  });

  it('answers an empty board for a location with no stations', async () => {
    const { svc, repo } = make();
    repo.listStations.mockResolvedValue([]);

    await expect(svc.boardForPos(POS_USER, 't1', QUERY)).resolves.toMatchObject({
      ok: true,
      data: [],
    });
    // Nothing to fill a board with, so the snapshot is never read.
    expect(repo.boardSnapshot).not.toHaveBeenCalled();
  });
});
