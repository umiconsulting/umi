import { Logger, type OnModuleInit } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import {
  DASHBOARD_EVENT_DEVICES_CHANGED,
  DASHBOARD_REALTIME_NAMESPACE,
  dashboardRoom,
} from '@umi/contract';
import type { Namespace, Socket } from 'socket.io';
import { JwtService } from '../../shared/auth/jwt.service';
import { AuthRepository } from '../auth/auth.repository';
import { ACCESS_COOKIE } from '../auth/auth.types';
import { effectivePermissions, hasPermission, normalizeRoleKey } from '../auth/roles';
import { DashboardRealtimeEvents } from './dashboard-realtime.events';

/** The one rejection message. Every failure returns this exact string, so a caller
 * cannot learn which value was wrong. */
const REJECTED = 'unauthorized';

@WebSocketGateway({
  namespace: DASHBOARD_REALTIME_NAMESPACE,
  // Nest's `enableCors` covers the HTTP server only; Socket.IO carries its own
  // CORS config. Both read the same allowlist.
  cors: { origin: corsOriginsFromEnvironment(), credentials: true },
})
export class DashboardRealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleInit {
  private readonly logger = new Logger(DashboardRealtimeGateway.name);

  @WebSocketServer()
  private readonly server!: Namespace;

  constructor(
    private readonly events: DashboardRealtimeEvents,
    private readonly jwt: JwtService,
    private readonly authRepo: AuthRepository,
  ) {}

  onModuleInit(): void {
    this.events.stream$.subscribe((event) => {
      this.server?.to(dashboardRoom(event.merchantId)).emit(DASHBOARD_EVENT_DEVICES_CHANGED, event);
    });
  }

  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      void this.authorize(socket).then(
        (merchantId) => {
          if (!merchantId) {
            next(new Error(REJECTED));
            return;
          }
          socket.data.merchantId = merchantId;
          next();
        },
        (error: unknown) => {
          this.logger.error('dashboard socket handshake failed', error);
          next(new Error(REJECTED));
        },
      );
    });
  }

  handleConnection(socket: Socket): void {
    const merchantId = socket.data?.merchantId as string | undefined;
    if (!merchantId) {
      socket.disconnect(true);
      return;
    }
    void socket.join(dashboardRoom(merchantId));
  }

  /** Returns the merchant id to join, or null for every failure. */
  private async authorize(socket: Socket): Promise<string | null> {
    const merchantId = socket.handshake?.auth?.merchantId;
    if (typeof merchantId !== 'string' || merchantId.length === 0) return null;

    const token = readCookie(socket.handshake?.headers?.cookie, ACCESS_COOKIE);
    if (!token) return null;

    let claims;
    try {
      claims = await this.jwt.verifyAccess(token);
    } catch {
      return null;
    }

    const access = await this.authRepo.findMembershipAccess(claims.sub, merchantId);
    if (!access) return null;

    const role = normalizeRoleKey(access.roles);
    const permissions = effectivePermissions(role, access.permissions);
    if (!hasPermission(permissions, 'kitchen.diagnostics')) return null;

    return merchantId;
  }
}

/** Read a single cookie by name from a raw Cookie header string. */
function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const prefix = `${name}=`;
  for (const part of cookieHeader.split(';')) {
    const segment = part.trim();
    if (segment.startsWith(prefix)) {
      return decodeURIComponent(segment.slice(prefix.length));
    }
  }
  return null;
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
