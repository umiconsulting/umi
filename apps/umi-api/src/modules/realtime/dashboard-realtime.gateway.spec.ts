import { describe, expect, it, vi } from 'vitest';
import { DASHBOARD_EVENT_DEVICES_CHANGED } from '@umi/contract';
import { DashboardRealtimeGateway } from './dashboard-realtime.gateway';
import { DashboardRealtimeEvents } from './dashboard-realtime.events';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const COOKIE = `umi_access=abc123; umi_refresh=def456`;

const socketWith = (auth: Record<string, unknown>, cookie = COOKIE) => ({
  handshake: { auth, headers: { cookie } },
  data: {} as Record<string, unknown>,
  join: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn(),
});

const membership = (overrides: Record<string, unknown> = {}) =>
  Object.assign(
    {
      merchantId: MERCHANT_ID,
      handle: 'test',
      name: 'Test',
      timezone: 'America/Mexico_City',
      membershipId: 'm1',
      roles: ['super_admin'],
      permissions: ['*'],
      locationId: null,
    },
    overrides,
  );

const make = (
  jwtResult: unknown = { sub: 'user-1', email: 'a@b.co', sessionId: 'sid', deviceId: null },
  repoResult: unknown = membership(),
  jwtImpl?: unknown,
) => {
  const events = new DashboardRealtimeEvents();
  const jwt = {
    verifyAccess: jwtImpl || vi.fn().mockResolvedValue(jwtResult),
  };
  const authRepo = { findMembershipAccess: vi.fn().mockResolvedValue(repoResult) };
  const gateway = new DashboardRealtimeGateway(events, jwt as never, authRepo as never);
  return { gateway, events, jwt, authRepo };
};

const runMiddleware = async (
  gateway: DashboardRealtimeGateway,
  socket: ReturnType<typeof socketWith>,
): Promise<{ accepted: boolean; message?: string }> => {
  let register: (socket: unknown, next: (err?: Error) => void) => void = () => {};
  gateway.afterInit({ use: (fn: never) => (register = fn) } as never);
  return new Promise((resolve) => {
    register(socket, (error) =>
      resolve(error ? { accepted: false, message: error.message } : { accepted: true }),
    );
  });
};

describe('DashboardRealtimeGateway handshake', () => {
  it('admits a valid dashboard session and joins the merchant room', async () => {
    const { gateway, authRepo } = make();
    const socket = socketWith({ merchantId: MERCHANT_ID });

    const result = await runMiddleware(gateway, socket);
    expect(result.accepted).toBe(true);
    expect(authRepo.findMembershipAccess).toHaveBeenCalledWith('user-1', MERCHANT_ID);

    gateway.handleConnection(socket as never);
    expect(socket.join).toHaveBeenCalledWith(`dashboard:${MERCHANT_ID}`);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it.each([
    ['no merchant id', {}],
    ['empty merchant id', { merchantId: '' }],
  ])('refuses without a merchant id: %s', async (_label, auth) => {
    const { gateway, authRepo, jwt } = make();
    const result = await runMiddleware(gateway, socketWith(auth));
    expect(result).toEqual({ accepted: false, message: 'unauthorized' });
    expect(authRepo.findMembershipAccess).not.toHaveBeenCalled();
    expect(jwt.verifyAccess).not.toHaveBeenCalled();
  });

  it('refuses when the access cookie is missing', async () => {
    const { gateway, jwt } = make();
    const result = await runMiddleware(gateway, socketWith({ merchantId: MERCHANT_ID }, ''));
    expect(result).toEqual({ accepted: false, message: 'unauthorized' });
    expect(jwt.verifyAccess).not.toHaveBeenCalled();
  });

  it('refuses when the JWT is invalid', async () => {
    const { gateway } = make(
      undefined,
      membership(),
      vi.fn().mockRejectedValue(new Error('jwt invalid')),
    );
    const result = await runMiddleware(gateway, socketWith({ merchantId: MERCHANT_ID }));
    expect(result).toEqual({ accepted: false, message: 'unauthorized' });
  });

  it('refuses when the user has no membership', async () => {
    const { gateway } = make({ sub: 'user-1' }, null);
    const result = await runMiddleware(gateway, socketWith({ merchantId: MERCHANT_ID }));
    expect(result).toEqual({ accepted: false, message: 'unauthorized' });
  });

  it('refuses when the member lacks the kitchen.diagnostics permission', async () => {
    const { gateway } = make(
      { sub: 'user-1' },
      membership({ roles: ['staff'], permissions: ['kitchen.read'] }),
    );
    const result = await runMiddleware(gateway, socketWith({ merchantId: MERCHANT_ID }));
    expect(result).toEqual({ accepted: false, message: 'unauthorized' });
  });

  it('fails closed on an unauthorized connection', () => {
    const { gateway } = make();
    const socket = socketWith({});
    gateway.handleConnection(socket as never);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });
});

describe('DashboardRealtimeGateway emit', () => {
  it('emits a devices-changed wake-up only to the merchant room', () => {
    const { gateway, events } = make();
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    Reflect.set(gateway, 'server', { to });
    gateway.onModuleInit();

    const event = {
      merchantId: MERCHANT_ID,
      locationId: null,
      occurredAt: '2026-09-01T00:00:00.000Z',
    };
    events.emitDevicesChanged(event);

    expect(to).toHaveBeenCalledWith(`dashboard:${MERCHANT_ID}`);
    expect(emit).toHaveBeenCalledWith(DASHBOARD_EVENT_DEVICES_CHANGED, event);
  });
});
