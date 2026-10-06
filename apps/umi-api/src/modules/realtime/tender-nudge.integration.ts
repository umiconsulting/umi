import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { REALTIME_EVENT_TENDER_ATTEMPT_CHANGED, REALTIME_NAMESPACE } from '@umi/contract';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../../app.module';
import { PgService } from '../../shared/database/pg.service';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';

/**
 * THE WHOLE HOP, ON A REAL SOCKET — plan §15, and the half §15.4 item 1 said was unproven.
 *
 * Every other case in this workstream stops one step short of the register. The gateway's own
 * spec drives the namespace middleware with a fake socket; the client's tests drive a fake
 * channel; the database's trigger has never been fired in front of a listening client. So the
 * chain "the attempt resolves → the database NOTIFYs → the listener hears it → the bus fans it out
 * → the gateway addresses the device room → the REGISTER receives it" was six links each proved
 * separately and never once end to end.
 *
 * THIS FILE CLOSES ALL SIX. It boots the real application on a real port, connects a real
 * socket.io client with a real device credential, and then writes an attempt row — which is what
 * the tender path does — and waits for the nudge to arrive at the client. Nothing between the
 * INSERT and the client's callback is stubbed: the trigger, the LISTEN, the in-process bus, the
 * room, and the wire.
 *
 * WHAT IT STILL DOES NOT PROVE is the vendor. A real terminal answering a real order is Phase 0's
 * and Phase 5 step 5's, and §15.4 item 1 keeps saying so; what is proven here is that when OUR
 * database records a resolution, the register hears about it — which is the whole of what "under
 * two seconds after the notification" measures, minus the notification.
 *
 *   set -a && . apps/umi-api/.env && set +a
 *   DATABASE_URL_APP=… DATABASE_URL_WORKER=… \
 *   npx vitest run --config vitest.integration.config.ts src/modules/realtime/tender-nudge.integration.ts
 */

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET: 'tender-nudge-harness-secret-0000',
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const MERCHANT = '7f000000-0000-4000-8000-0000000000b1';
const LOCATION = '7f000000-0000-4000-8000-0000000000b2';
const DEVICE = '7f000000-0000-4000-8000-0000000000b3';
const PUBLIC_ID = '7f000000-0000-4000-8000-0000000000b4';
const USER = '7f000000-0000-4000-8000-0000000000b5';
const SESSION = '7f000000-0000-4000-8000-0000000000b6';
const OPERATOR_SESSION = '7f000000-0000-4000-8000-0000000000b7';
const STAFF = '7f000000-0000-4000-8000-0000000000b8';
const INSTALLATION = 'installation-of-the-listening-till';
const CREDENTIAL = 'credential-of-the-listening-till';

describe('the tender nudge reaches a register · §15', () => {
  let app: NestFastifyApplication;
  let pg: PgService;
  let port: number;
  let socket: Socket | null = null;

  const connect = async (): Promise<boolean> => {
    socket = io(`http://127.0.0.1:${port}${REALTIME_NAMESPACE}`, {
      // THE DEVICE HANDSHAKE, exactly as the till sends it: the credential the REST calls carry.
      auth: { publicId: PUBLIC_ID, installationId: INSTALLATION, credential: CREDENTIAL },
      transports: ['websocket'],
      reconnection: false,
    });
    return new Promise<boolean>((resolve) => {
      socket?.once('connect', () => resolve(true));
      socket?.once('connect_error', () => resolve(false));
    });
  };

  const waitForNudge = (timeoutMs: number): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no nudge arrived within ${timeoutMs} ms`)),
        timeoutMs,
      );
      socket?.once(REALTIME_EVENT_TENDER_ATTEMPT_CHANGED, (payload: unknown) => {
        clearTimeout(timer);
        resolve(payload as Record<string, unknown>);
      });
    });

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN) {
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a DISPOSABLE build-v3 database.',
      );
    }

    // THE REAL APPLICATION, on a real port. The same AppModule the API boots with, so the
    // gateways, the LISTENing listener and the in-process bus are the ones production uses.
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    port = address.port;

    pg = new PgService(makeConfig());
    await pg.onModuleInit();

    await pg.query(
      `INSERT INTO merchant.merchant (id,name,handle) VALUES ($1::uuid,'Nudge Café','nudge-cafe')
       ON CONFLICT (id) DO NOTHING`,
      [MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name) VALUES ($1::uuid,$2::uuid,'Counter')
       ON CONFLICT (id) DO NOTHING`,
      [LOCATION, MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.device
         (id,merchant_id,location_id,name,kind,status,public_id,installation_hash,credential_hash)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Caja','pos_terminal','active',$4::uuid,$5,$6)
       ON CONFLICT (id) DO UPDATE SET status='active', public_id=EXCLUDED.public_id,
         installation_hash=EXCLUDED.installation_hash, credential_hash=EXCLUDED.credential_hash`,
      [DEVICE, MERCHANT, LOCATION, PUBLIC_ID, sha256(INSTALLATION), sha256(CREDENTIAL)],
    );

    // The cart the attempt hangs off needs an operator behind it: `pos_cart.operator_session_id`
    // and its `*_user_id` columns are NOT NULL and cross-referenced (50_cross_schema_fk), so a
    // fixture cannot invent them — the same three rows the till creates when a cashier signs in.
    await pg.query(
      `INSERT INTO umi."user" (id,full_name) VALUES ($1::uuid,'Cajera') ON CONFLICT (id) DO NOTHING`,
      [USER],
    );
    await pg.query(
      `INSERT INTO runtime.session (id,merchant_id,principal_type,principal_id,token_hash,expires_at)
       VALUES ($1::uuid,$2::uuid,'user',$3::uuid,repeat('e',64),now()+interval '1 day')
       ON CONFLICT (id) DO NOTHING`,
      [SESSION, MERCHANT, USER],
    );
    await pg.query(
      `INSERT INTO merchant.staff (id,merchant_id,user_id,role_id,name)
       SELECT $1::uuid,$2::uuid,$3::uuid,(SELECT id FROM umi.role WHERE key='cashier'),'Cajera'
       ON CONFLICT (id) DO NOTHING`,
      [STAFF, MERCHANT, USER],
    );
    await pg.query(
      `INSERT INTO runtime.operator_session
         (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,permissions,
          entitlements,expires_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
               ARRAY['checkout.commit'],'[{"featureKey":"pos","enabled":true}]'::jsonb,
               now()+interval '1 day')
       ON CONFLICT (id) DO NOTHING`,
      [OPERATOR_SESSION, SESSION, USER, STAFF, DEVICE, MERCHANT, LOCATION],
    );
  }, 120_000);

  afterAll(async () => {
    socket?.close();
    if (pg) await pg.onModuleDestroy();
    if (app) await app.close();
  }, 60_000);

  it('admits the register by its credential, and only then', async () => {
    // A socket with no device credential is refused before it connects — the same constant
    // rejection the pairing path gives. This is the check that makes the room meaningful.
    const anonymous = io(`http://127.0.0.1:${port}${REALTIME_NAMESPACE}`, {
      auth: {},
      transports: ['websocket'],
      reconnection: false,
    });
    const refused = await new Promise<boolean>((resolve) => {
      anonymous.once('connect', () => resolve(false));
      anonymous.once('connect_error', () => resolve(true));
    });
    anonymous.close();
    expect(refused).toBe(true);

    expect(await connect()).toBe(true);
  }, 60_000);

  it('DELIVERS the nudge to the register when our own database records the resolution', async () => {
    const cartId = randomUUID();
    const attemptId = randomUUID();
    await pg.query(
      `INSERT INTO merchant.pos_cart
         (id,merchant_id,location_id,operator_session_id,original_operator_session_id,
          original_operator_user_id,operator_user_id,status,lifecycle_state,business_date)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$4::uuid,$5::uuid,$5::uuid,
               'committed','committed',current_date)
       ON CONFLICT (id) DO NOTHING`,
      [cartId, MERCHANT, LOCATION, OPERATOR_SESSION, USER],
    );

    // THE WRITE THE TENDER PATH MAKES when a terminal answers. `succeeded` with its proof named is
    // what the schema demands of a success, and it is what fires `payment_attempt_notify_resolution`.
    const nudge = waitForNudge(10_000);
    await pg.query(
      `INSERT INTO merchant.pos_payment_attempt
         (id,merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,
          proof_source,correlation_id,resolved_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'cash',500,'MXN','succeeded','cash',$5,now())`,
      [attemptId, MERCHANT, LOCATION, cartId, `nudge-${attemptId}`],
    );
    const event = await nudge;

    // THE FIVE LINKS AFTER THE INSERT, asserted on the payload the CLIENT received: the trigger's
    // ids, the listener's parse, the bus, and the room the credential earned.
    expect(event.merchantId).toBe(MERCHANT);
    expect(event.attemptId).toBe(attemptId);
    expect(event.commandIdentity).toBeNull();
    expect(event.cartId).toBe(cartId);
    // IDS ONLY, which is the doctrine: no amount, no provider status, no proof rides the socket.
    expect(Object.keys(event).sort()).toEqual([
      'attemptId',
      'cartId',
      'commandIdentity',
      'merchantId',
    ]);
  }, 60_000);
});
