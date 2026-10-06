import { describe, expect, it, vi } from 'vitest';
import {
  REALTIME_EVENT_PAIRING_CHANGED,
  REALTIME_EVENT_TENDER_ATTEMPT_CHANGED,
} from '@umi/contract';
import { DashboardRealtimeEvents } from './dashboard-realtime.events';
import { DevicePairingEvents } from './device-pairing.events';
import { PairingRealtimeGateway } from './pairing-realtime.gateway';

const SESSION = '11111111-1111-4111-8111-111111111111';
const MERCHANT = '22222222-2222-4222-8222-222222222222';
const PUBLIC_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT = '44444444-4444-4444-8444-444444444444';

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
  authenticate: unknown = vi
    .fn()
    .mockResolvedValue({ id: 'device-1', merchantId: MERCHANT, publicId: PUBLIC_ID }),
) => {
  const devices = { authorizePairingSocket: authorize, authenticate };
  const events = new DevicePairingEvents();
  const tenders = new DashboardRealtimeEvents();
  const rateLimit = {
    hit: vi.fn().mockReturnValue({ allowed, remaining: 10, resetAt: Date.now() + 60_000 }),
  };
  const gateway = new PairingRealtimeGateway(devices as never, events, rateLimit as never, tenders);
  return { gateway, devices, events, rateLimit, tenders };
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

/**
 * THE TILL'S OWN CHANNEL (plan §11.4 item 2, §5's budget). A paired register proves its DEVICE
 * CREDENTIAL — the one its REST calls carry — and hears its own counter's terminal nudges, so the
 * screen learns what the terminal answered in about a second instead of asking at the vendor's
 * forty-second window.
 */
describe('the device channel', () => {
  const deviceAuth = {
    publicId: PUBLIC_ID,
    installationId: 'installation-id-value',
    credential: 'device-credential-value',
  };

  it('admits a paired register by its credential and joins only its MERCHANT room', async () => {
    const { gateway, devices } = make();
    const socket = socketWith(deviceAuth);

    const result = await runMiddleware(gateway, socket);
    expect(result.accepted).toBe(true);
    expect(devices.authenticate).toHaveBeenCalledWith(
      PUBLIC_ID,
      'installation-id-value',
      'device-credential-value',
    );
    // IT NEVER CONSULTS THE PAIRING PATH: a paired register is not a pairing session, and asking
    // both would be two authorities where one is enough.
    expect(devices.authorizePairingSocket).not.toHaveBeenCalled();

    gateway.handleConnection(socket as never);
    // The room key is the MERCHANT from the row the credential resolved to — never a value the
    // client sent — so a register cannot ask to hear another café's counter.
    expect(socket.join).toHaveBeenCalledWith(`device:${MERCHANT}`);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('refuses a credential the devices service rejects, with the same constant message', async () => {
    const { gateway } = make(undefined, true, vi.fn().mockResolvedValue(null));

    const result = await runMiddleware(gateway, socketWith(deviceAuth));

    expect(result).toEqual({ accepted: false, message: 'unauthorized' });
  });

  it('refuses a register whose credential must be rotated, exactly as its REST calls do', async () => {
    // `authenticate` throws `DEVICE_ROTATION_REQUIRED` for one. A socket that could hear about a
    // terminal while every read of it is refused would be a channel to nowhere.
    const { gateway } = make(
      undefined,
      true,
      vi.fn().mockRejectedValue(new Error('device rotation required')),
    );

    const result = await runMiddleware(gateway, socketWith(deviceAuth));

    expect(result).toEqual({ accepted: false, message: 'unauthorized' });
  });

  it('refuses a credential handshake with no installation id, before reaching the database', async () => {
    const { gateway, devices } = make();

    const result = await runMiddleware(
      gateway,
      socketWith({ publicId: PUBLIC_ID, credential: 'device-credential-value' }),
    );

    expect(result).toEqual({ accepted: false, message: 'unauthorized' });
    expect(devices.authenticate).not.toHaveBeenCalled();
  });

  it('emits the tender nudge to the merchant device room, ids only', () => {
    const { gateway, tenders } = make();
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    Reflect.set(gateway, 'server', { to });
    gateway.onModuleInit();

    const event = {
      merchantId: MERCHANT,
      attemptId: ATTEMPT,
      commandIdentity: null,
      cartId: null,
      locationId: null,
      state: 'succeeded',
      occurredAt: '2026-09-17T12:00:00.000Z',
    };
    tenders.emitTenderAttemptChanged(event as never);

    expect(to).toHaveBeenCalledWith(`device:${MERCHANT}`);
    expect(emit).toHaveBeenCalledWith(REALTIME_EVENT_TENDER_ATTEMPT_CHANGED, event);
    // A nudge, not a delivery: the amount, the provider's status and the proof stay in the row.
    expect(Object.keys(emit.mock.calls[0][1])).not.toContain('amountMinorUnits');
    expect(Object.keys(emit.mock.calls[0][1])).not.toContain('providerStatus');
  });
});
