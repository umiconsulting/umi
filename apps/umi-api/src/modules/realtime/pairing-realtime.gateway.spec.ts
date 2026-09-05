import { describe, expect, it, vi } from 'vitest';
import { REALTIME_EVENT_PAIRING_CHANGED } from '@umi/contract';
import { DevicePairingEvents } from './device-pairing.events';
import { PairingRealtimeGateway } from './pairing-realtime.gateway';

const SESSION = '11111111-1111-4111-8111-111111111111';

const socketWith = (auth: Record<string, unknown>, address = '203.0.113.10') => ({
  handshake: { auth, address },
  data: {} as Record<string, unknown>,
  join: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn(),
});

const validAuth = {
  pairingSessionId: SESSION,
  pollingCredential: 'polling-credential-value',
  installationId: 'installation-id-value',
};

const make = (
  authorize: unknown = vi.fn().mockResolvedValue({ pairingSessionId: SESSION }),
  allowed = true,
) => {
  const devices = { authorizePairingSocket: authorize };
  const events = new DevicePairingEvents();
  const rateLimit = {
    hit: vi.fn().mockReturnValue({ allowed, remaining: 10, resetAt: Date.now() + 60_000 }),
  };
  const gateway = new PairingRealtimeGateway(devices as never, events, rateLimit as never);
  return { gateway, devices, events, rateLimit };
};

/**
 * Drives the namespace middleware the way Socket.IO does, and reports what the
 * client would see: a connection, or a refusal carrying a constant message.
 */
const runMiddleware = async (
  gateway: PairingRealtimeGateway,
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

describe('PairingRealtimeGateway handshake', () => {
  it('admits a valid triplet and joins only its own pairing room', async () => {
    const { gateway, devices } = make();
    const socket = socketWith(validAuth);

    const result = await runMiddleware(gateway, socket);
    expect(result.accepted).toBe(true);
    expect(devices.authorizePairingSocket).toHaveBeenCalledWith(validAuth);

    gateway.handleConnection(socket as never);
    expect(socket.join).toHaveBeenCalledWith(`pairing:${SESSION}`);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it.each([
    ['missing session id', { ...validAuth, pairingSessionId: undefined }],
    ['missing credential', { ...validAuth, pollingCredential: undefined }],
    ['missing installation id', { ...validAuth, installationId: undefined }],
    ['empty credential', { ...validAuth, pollingCredential: '' }],
    ['no auth payload at all', {}],
  ])('refuses an incomplete handshake before it connects: %s', async (_label, auth) => {
    const { gateway, devices } = make();

    const result = await runMiddleware(gateway, socketWith(auth));

    expect(result).toEqual({ accepted: false, message: 'unauthorized' });
    // An incomplete payload must not even reach the database.
    expect(devices.authorizePairingSocket).not.toHaveBeenCalled();
  });

  it('refuses a triplet the devices service rejects', async () => {
    const { gateway } = make(vi.fn().mockResolvedValue(null));

    const result = await runMiddleware(gateway, socketWith(validAuth));

    expect(result).toEqual({ accepted: false, message: 'unauthorized' });
  });

  it('refuses once the per-IP handshake budget is spent', async () => {
    const { gateway, devices } = make(undefined, false);

    const result = await runMiddleware(gateway, socketWith(validAuth));

    expect(result).toEqual({ accepted: false, message: 'unauthorized' });
    expect(devices.authorizePairingSocket).not.toHaveBeenCalled();
  });

  it('refuses with the same message when the lookup throws', async () => {
    const { gateway } = make(vi.fn().mockRejectedValue(new Error('database is down')));

    const result = await runMiddleware(gateway, socketWith(validAuth));

    // Identical to every other refusal: the device learns nothing from the shape.
    expect(result).toEqual({ accepted: false, message: 'unauthorized' });
  });

  it('fails closed if a socket ever reaches connection unauthorized', () => {
    const { gateway } = make();
    const socket = socketWith(validAuth);

    gateway.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });
});

describe('PairingRealtimeGateway emit', () => {
  it('emits a decision only to the room of its own pairing session', () => {
    const { gateway, events } = make();
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    Reflect.set(gateway, 'server', { to });
    gateway.onModuleInit();

    const event = {
      pairingSessionId: SESSION,
      state: 'credential_ready' as const,
      occurredAt: '2026-09-01T00:00:00.000Z',
    };
    events.emitPairingChanged(event);

    expect(to).toHaveBeenCalledWith(`pairing:${SESSION}`);
    expect(emit).toHaveBeenCalledWith(REALTIME_EVENT_PAIRING_CHANGED, event);
    // The nudge carries no credential and no device.
    expect(Object.keys(emit.mock.calls[0][1])).toEqual(['pairingSessionId', 'state', 'occurredAt']);
  });
});
