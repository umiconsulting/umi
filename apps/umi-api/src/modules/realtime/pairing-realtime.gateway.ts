import { Logger, type OnModuleInit } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { REALTIME_EVENT_PAIRING_CHANGED, REALTIME_NAMESPACE, pairingRoom } from '@umi/contract';
import type { Namespace, Socket } from 'socket.io';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import { DevicesService } from '../devices/devices.service';
import { DevicePairingEvents } from './device-pairing.events';

/** Shape of the handshake `auth` payload a pairing device sends. */
interface PairingHandshake {
  pairingSessionId?: unknown;
  pollingCredential?: unknown;
  installationId?: unknown;
}

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
  ) {}

  onModuleInit(): void {
    this.events.stream$.subscribe((event) => {
      this.server
        ?.to(pairingRoom(event.pairingSessionId))
        .emit(REALTIME_EVENT_PAIRING_CHANGED, event);
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
        (sessionId) => {
          if (!sessionId) {
            next(new Error(REJECTED));
            return;
          }
          socket.data.pairingSessionId = sessionId;
          next();
        },
        (error: unknown) => {
          // Never leak a lookup failure to the device: the poll route stays the
          // authoritative path, so a failed handshake costs latency, not delivery.
          this.logger.error('pairing socket handshake failed', error);
          next(new Error(REJECTED));
        },
      );
    });
  }

  handleConnection(socket: Socket): void {
    const pairingSessionId = socket.data?.pairingSessionId as string | undefined;
    if (!pairingSessionId) {
      // Unreachable while the middleware above is registered. Fail closed anyway.
      socket.disconnect(true);
      return;
    }
    void socket.join(pairingRoom(pairingSessionId));
  }

  /** Returns the pairing session id to join, or null for every failure. */
  private async authorize(socket: Socket): Promise<string | null> {
    const auth = (socket.handshake?.auth ?? {}) as PairingHandshake;
    const { pairingSessionId, pollingCredential, installationId } = auth;

    if (
      !isNonEmptyString(pairingSessionId) ||
      !isNonEmptyString(pollingCredential) ||
      !isNonEmptyString(installationId)
    ) {
      return null;
    }

    const address = socket.handshake?.address ?? 'unknown';
    if (!this.rateLimit.hit(`device-pairing:socket-ip:${address}`, 180, 5 * 60_000).allowed) {
      return null;
    }

    const session = await this.devices.authorizePairingSocket({
      pairingSessionId,
      pollingCredential,
      installationId,
    });
    return session?.pairingSessionId ?? null;
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
