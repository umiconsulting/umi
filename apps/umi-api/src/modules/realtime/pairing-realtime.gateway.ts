import { Logger, type OnModuleInit } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import {
  REALTIME_EVENT_PAIRING_CHANGED,
  REALTIME_EVENT_TENDER_ATTEMPT_CHANGED,
  REALTIME_NAMESPACE,
  deviceRoom,
  pairingRoom,
} from '@umi/contract';
import type { Namespace, Socket } from 'socket.io';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import { DevicesService } from '../devices/devices.service';
import { DashboardRealtimeEvents } from './dashboard-realtime.events';
import { DevicePairingEvents } from './device-pairing.events';

/**
 * Shape of the handshake `auth` payload this channel accepts. A device sends ONE of two
 * triples: the pairing one while it is being paired, or the credential one afterwards.
 */
interface DeviceHandshake {
  pairingSessionId?: unknown;
  pollingCredential?: unknown;
  installationId?: unknown;
  /** The device's own public id, from the pairing claim. */
  publicId?: unknown;
  /** The device credential the pairing delivered — the same one its REST calls carry. */
  credential?: unknown;
}

/** What a socket proved, and therefore which room it may join. */
type DeviceChannel =
  | { readonly kind: 'pairing'; readonly pairingSessionId: string }
  | {
      readonly kind: 'device';
      readonly merchantId: string;
    };

/**
 * The one rejection message. Every failure returns this exact string, so a caller
 * cannot learn which value was wrong, nor whether the session exists.
 */
const REJECTED = 'unauthorized';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

@WebSocketGateway({
  namespace: REALTIME_NAMESPACE,
  // Nest's `enableCors` covers the HTTP server only; Socket.IO carries its own
  // CORS config. Both read the same allowlist, and the config schema already
  // rejects a wildcard origin in deployed environments.
  cors: { origin: corsOriginsFromEnvironment(), credentials: true },
})
export class PairingRealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleInit {
  private readonly logger = new Logger(PairingRealtimeGateway.name);

  @WebSocketServer()
  private readonly server!: Namespace;

  constructor(
    private readonly devices: DevicesService,
    private readonly events: DevicePairingEvents,
    private readonly rateLimit: RateLimitService,
    /**
     * THE SAME EVENT BUS THE DASHBOARD READS, deliberately. The nudge is produced by the
     * database (`TenderAttemptListener`), and the bus is the fan-out point: one source, two
     * rooms, and no second emitter that could disagree with the first about what happened.
     */
    private readonly tenders: DashboardRealtimeEvents,
  ) {}

  onModuleInit(): void {
    this.events.stream$.subscribe((event) => {
      this.server
        ?.to(pairingRoom(event.pairingSessionId))
        .emit(REALTIME_EVENT_PAIRING_CHANGED, event);
    });

    /**
     * AND THE TILL'S OWN WAKE-UP (plan §11.4 item 2, §5's budget).
     *
     * Until this room existed, the register learned that the terminal had answered the only way
     * it could: by asking at `queryAfterSeconds`, the vendor's own ten- and forty-second windows.
     * That is why §5's "resolution visible in the till under 2 s after the notification" measured
     * nothing: the notification resolved the attempt on the server in about a second, and the
     * screen found out up to forty seconds later.
     *
     * IDS ONLY, like every other nudge here: the till re-reads the attempt over REST, so the
     * socket can never disagree with the row, and a spoofed or replayed event can only make a
     * register ask a question it is already entitled to ask.
     */
    this.tenders.tenderAttemptChanged$.subscribe((event) => {
      this.server
        ?.to(deviceRoom(event.merchantId))
        .emit(REALTIME_EVENT_TENDER_ATTEMPT_CHANGED, event);
    });
  }

  /**
   * Authorization runs as namespace middleware, not in `handleConnection`. By the
   * time `handleConnection` runs the client is already connected and has seen its
   * `connect` event; disconnecting there would let an unauthorized socket exist,
   * however briefly. Middleware refuses before the connection is established.
   */
  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      void this.authorize(socket).then(
        (channel) => {
          if (!channel) {
            next(new Error(REJECTED));
            return;
          }
          socket.data.channel = channel;
          next();
        },
        (error: unknown) => {
          // Never leak a lookup failure to the device: the poll route stays the
          // authoritative path, so a failed handshake costs latency, not delivery.
          this.logger.error('device socket handshake failed', error);
          next(new Error(REJECTED));
        },
      );
    });
  }

  handleConnection(socket: Socket): void {
    const channel = socket.data?.channel as DeviceChannel | undefined;
    if (!channel) {
      // Unreachable while the middleware above is registered. Fail closed anyway.
      socket.disconnect(true);
      return;
    }
    // ONE ROOM PER SOCKET, AND WHICH ONE IS WHAT THE HANDSHAKE PROVED. A pairing socket joins
    // its session's room and hears only pairing changes; a paired register joins its MERCHANT's
    // device room and hears its own counter's terminal nudges. There is no room that carries
    // both, so proving one thing can never be a way into the other.
    void socket.join(
      channel.kind === 'pairing'
        ? pairingRoom(channel.pairingSessionId)
        : deviceRoom(channel.merchantId),
    );
  }

  /**
   * WHICH ROOM THIS SOCKET MAY JOIN, or null for every failure — the same "one answer, no
   * detail" rule the rejection message keeps.
   *
   * TWO CREDENTIALS, ONE AT A TIME. A device that is still being paired has a pairing session id
   * and its polling credential, and gets the pairing room. A paired register has its device
   * credential — the very one its REST calls carry — and gets its merchant's device room, whose
   * key comes from the ROW the credential resolved to and never from anything the client said.
   * A client that presents both is a device channel and not a pairing session, because the
   * credential is the stronger claim.
   */
  private async authorize(socket: Socket): Promise<DeviceChannel | null> {
    const auth = (socket.handshake?.auth ?? {}) as DeviceHandshake;
    const address = socket.handshake?.address ?? 'unknown';

    const publicId = auth.publicId;
    const credential = auth.credential;
    // ALL THREE, checked here rather than left to the service, for the same reason the pairing
    // branch checks its own three: a socket handshake is unauthenticated input, and an incomplete
    // one must not become a lookup.
    if (
      isNonEmptyString(publicId) &&
      isNonEmptyString(auth.installationId) &&
      isNonEmptyString(credential)
    ) {
      // The same rate limit as the pairing handshake: an unauthenticated socket may try, and may
      // not try forever. It is counted per address, so one register's reconnects cannot lock out
      // another's — and a register that reconnects in a loop is a real thing this must survive.
      if (!this.rateLimit.hit(`device-socket-ip:${address}`, 180, 5 * 60_000).allowed) {
        return null;
      }
      const device = await this.devices
        .authenticate(publicId, auth.installationId, credential)
        .catch(() => null);
      // A device that must rotate is refused here exactly as its REST calls are: a socket that
      // could hear about a terminal while every read of it is refused would be a channel to
      // nowhere. `authenticate` throws for that, and the catch above turns it into null.
      return device ? { kind: 'device', merchantId: device.merchantId } : null;
    }

    const { pairingSessionId, pollingCredential, installationId } = auth;

    if (
      !isNonEmptyString(pairingSessionId) ||
      !isNonEmptyString(pollingCredential) ||
      !isNonEmptyString(installationId)
    ) {
      return null;
    }

    if (!this.rateLimit.hit(`device-pairing:socket-ip:${address}`, 180, 5 * 60_000).allowed) {
      return null;
    }

    const session = await this.devices.authorizePairingSocket({
      pairingSessionId,
      pollingCredential,
      installationId,
    });
    return session ? { kind: 'pairing', pairingSessionId: session.pairingSessionId } : null;
  }
}

/**
 * Read at class-decoration time, before the DI container exists. The value comes
 * from the same `CORS_ORIGINS` variable `main.ts` uses; an unset variable leaves
 * the namespace closed to browsers, which is the safe default for a device channel.
 */
function corsOriginsFromEnvironment(): string[] {
  return (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
