import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { deviceStatus, KdsService, stationKeyFromName, ticketBelongsToDevice } from './kds.service';
import {
  DEVICE_REVOKED_BODY,
  hashPin,
  KdsHttpError,
  type KdsDeviceSession,
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
    executeKitchenCommand: vi.fn().mockResolvedValue({
      status: 'succeeded',
      result: { kitchenOrderId: 'o1', status: 'in_preparation', version: 2, sequence: 5 },
    }),
    loadOrderForScope: vi.fn(),
    heartbeatTouch: vi.fn().mockResolvedValue(true),
  };
  const rateLimit = {
    hit: vi.fn().mockReturnValue({ allowed: true, remaining: 9, resetAt: 0 }),
  };
  const svc = new KdsService(repo as never, rateLimit as never);
  return { svc, repo, rateLimit };
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
