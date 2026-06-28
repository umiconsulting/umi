import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deviceStatus,
  KdsService,
  ticketBelongsToDevice,
  validateTransition,
} from './kds.service';
import {
  DEVICE_REVOKED_BODY,
  hashPin,
  KdsHttpError,
  type KdsDeviceSession,
} from './dto/kds-contract';

function make(notifyEnabled = true) {
  const repo = {
    findSessionByToken: vi.fn(),
    touchSession: vi.fn().mockResolvedValue(undefined),
    findPendingPairingsForPin: vi.fn().mockResolvedValue([]),
    setPairingRequestedName: vi.fn().mockResolvedValue(undefined),
    getPairing: vi.fn(),
    expirePairing: vi.fn().mockResolvedValue(undefined),
    loadStation: vi.fn(),
    createDeviceSession: vi.fn(),
    claimPairing: vi.fn(),
    deleteDevice: vi.fn().mockResolvedValue(undefined),
    boardSnapshot: vi.fn().mockResolvedValue([]),
    ticketEvents: vi.fn().mockResolvedValue([]),
    loadOrderForScope: vi.fn(),
    transitionTicket: vi.fn().mockResolvedValue({ sequence: 5 }),
    partialCancelItems: vi
      .fn()
      .mockResolvedValue({ sequence: 6, newStatus: 'partial_cancelled' }),
    heartbeatTouch: vi.fn().mockResolvedValue(true),
  };
  const config = { get: vi.fn().mockReturnValue(notifyEnabled) };
  const svc = new KdsService(repo as never, config as never);
  return { svc, repo };
}

const SESSION: KdsDeviceSession = {
  deviceId: 'dev-1',
  tenantId: 't1',
  businessId: 't1',
  locationId: null,
  stationId: null,
  deviceName: 'iPad',
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
      tenant_id: 't1',
      is_active: false,
      metadata: {},
    });
    await expect(svc.verifyDevice('tok')).rejects.toMatchObject({ status: 403 });
  });

  it('active session → normalized + touched (businessId=tenant, location from metadata)', async () => {
    const { svc, repo } = make();
    repo.findSessionByToken.mockResolvedValue({
      id: 's1',
      tenant_id: 't1',
      station_id: 'st1',
      device_name: 'Expo',
      is_active: true,
      metadata: { location_id: 'loc-9' },
    });
    const session = await svc.verifyDevice('tok');
    expect(session).toMatchObject({
      deviceId: 's1',
      tenantId: 't1',
      businessId: 't1',
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
});

describe('KdsService.pairing — kds_status', () => {
  const approved = {
    id: 'p1',
    tenant_id: 't1',
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
    repo.loadStation.mockResolvedValue({ id: 'st1', name: 'Expo', tenant_id: 't1' });
    repo.createDeviceSession.mockResolvedValue({
      id: 'sess-1',
      tenant_id: 't1',
      station_id: 'st1',
      device_name: 'Cocina 1',
      token: 'plaintext-token',
      device_registry_id: 'reg-1',
    });
    repo.claimPairing.mockResolvedValue(true);

    const r = await svc.pairing({ action: 'kds_status', pairing_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      status: 'approved',
      device_session: {
        device_id: 'sess-1',
        token: 'plaintext-token',
        business_id: 't1',
        tenant_id: 't1',
        station_name: 'Expo',
      },
    });
  });

  it('drops the session and returns used on a lost claim race', async () => {
    const { svc, repo } = make();
    repo.getPairing.mockResolvedValue(approved);
    repo.loadStation.mockResolvedValue({ id: 'st1', name: 'Expo', tenant_id: 't1' });
    repo.createDeviceSession.mockResolvedValue({ id: 'sess-1', tenant_id: 't1', station_id: 'st1', device_name: 'x', token: 't', device_registry_id: 'reg-1' });
    repo.claimPairing.mockResolvedValue(false);

    const r = await svc.pairing({ action: 'kds_status', pairing_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' });
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
    const r = await svc.pairing({ action: 'kds_status', pairing_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' });
    expect(r).toEqual({ status: 200, body: { status: 'expired' } });
    expect(repo.expirePairing).toHaveBeenCalled();
  });
});

describe('KdsService.board', () => {
  it('remaps snapshot items to the frozen shape (unit_price in currency)', async () => {
    const { svc, repo } = make();
    repo.boardSnapshot.mockResolvedValue([
      {
        ticket_id: 'o1',
        source_transaction_id: null,
        business_id: 't1',
        source_channel: 'whatsapp',
        status: 'new',
        station_id: null,
        station_name: null,
        customer_name: 'Ana',
        customer_phone: '+521',
        pickup_person: null,
        customer_note: null,
        total_amount: '50',
        created_at: 'now',
        updated_at: 'now',
        last_event_sequence: '3',
        items: [
          { ticket_item_id: 'i1', name: 'Latte', quantity: 1, unit_price_cents: 4500, display_order: 0 },
        ],
      },
    ]);
    const r = await svc.board(SESSION, { action: 'snapshot' });
    expect(r.status).toBe(200);
    const data = (r.body as { data: Array<{ items: Array<{ unit_price: number }>; last_event_sequence: number }> }).data;
    expect(data[0].items[0].unit_price).toBe(45);
    expect(data[0].last_event_sequence).toBe(3);
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
    tenant_id: 't1',
    location_id: null,
    station_id: null,
    kitchen_status: 'new',
    person_id: 'p1',
    source_transaction_id: null,
  };

  it('400s on missing fields', async () => {
    const { svc } = make();
    const r = await svc.command(SESSION, { action: 'transition_ticket', ticket_id: 'o1' });
    expect(r).toEqual({ status: 400, body: { error: 'missing_required_fields' } });
  });

  it('404s when the ticket is not in the device scope', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue({ ...order, tenant_id: 'OTHER' });
    const r = await svc.command(SESSION, {
      action: 'transition_ticket',
      ticket_id: 'o1',
      target_status: 'accepted',
    });
    expect(r).toEqual({ status: 404, body: { error: 'ticket_not_found' } });
  });

  it('422s on an invalid transition', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue({ ...order, kitchen_status: 'completed' });
    const r = await svc.command(SESSION, {
      action: 'transition_ticket',
      ticket_id: 'o1',
      target_status: 'preparing',
    });
    expect(r.status).toBe(422);
  });

  it('transitions and passes a notify body when notifications are enabled', async () => {
    const { svc, repo } = make(true);
    repo.loadOrderForScope.mockResolvedValue(order);
    const r = await svc.command(SESSION, {
      action: 'transition_ticket',
      ticket_id: 'o1',
      target_status: 'accepted',
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, data: { status: 'accepted', sequence: 5 } });
    expect(repo.transitionTicket.mock.calls[0][0].notifyBody).toBe(
      'Tu pedido fue aceptado y está en cola en cocina.',
    );
  });

  it('passes a null notify body when notifications are disabled', async () => {
    const { svc, repo } = make(false);
    repo.loadOrderForScope.mockResolvedValue(order);
    await svc.command(SESSION, {
      action: 'transition_ticket',
      ticket_id: 'o1',
      target_status: 'accepted',
    });
    expect(repo.transitionTicket.mock.calls[0][0].notifyBody).toBeNull();
  });
});

describe('KdsService.command — partial_cancel_items', () => {
  it('400s without item_ids', async () => {
    const { svc } = make();
    const r = await svc.command(SESSION, {
      action: 'partial_cancel_items',
      ticket_id: 'o1',
      reason_code: 'out_of_stock',
    });
    expect(r).toEqual({ status: 400, body: { error: 'missing_required_fields' } });
  });

  it('cancels items and returns the new status', async () => {
    const { svc, repo } = make();
    repo.loadOrderForScope.mockResolvedValue({
      id: 'o1',
      tenant_id: 't1',
      location_id: null,
      station_id: null,
      kitchen_status: 'preparing',
      person_id: 'p1',
      source_transaction_id: null,
    });
    const r = await svc.command(SESSION, {
      action: 'partial_cancel_items',
      ticket_id: 'o1',
      item_ids: ['i1'],
      reason_code: 'out_of_stock',
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, data: { status: 'partial_cancelled' } });
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
  it('ticketBelongsToDevice honors tenant/location/station scope', () => {
    expect(
      ticketBelongsToDevice(
        { id: 'o', tenant_id: 't1', location_id: null, station_id: null, kitchen_status: 'new', person_id: null, source_transaction_id: null },
        SESSION,
      ),
    ).toBe(true);
    expect(
      ticketBelongsToDevice(
        { id: 'o', tenant_id: 'other', location_id: null, station_id: null, kitchen_status: 'new', person_id: null, source_transaction_id: null },
        SESSION,
      ),
    ).toBe(false);
    expect(ticketBelongsToDevice(null, SESSION)).toBe(false);
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
    expect(deviceStatus(new Date(Date.now() - 60_000).toISOString())).toBe('offline');
  });
});
