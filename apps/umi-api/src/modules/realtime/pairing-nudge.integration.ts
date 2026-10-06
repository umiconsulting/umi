import { createHash, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Client } from 'pg';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REALTIME_EVENT_PAIRING_CHANGED, REALTIME_NAMESPACE } from '@umi/contract';
import { AppModule } from '../../app.module';
import { DevicesService } from '../devices/devices.service';

/**
 * THE NUDGE REACHES THE WAITING DEVICE, AND ONLY THAT DEVICE.
 *
 * The unit suite proves the gateway calls `to(room).emit(...)`. It cannot prove
 * that a real Socket.IO client, connected through the real Fastify server, is in
 * that room and receives the frame. That gap is not theoretical: an earlier draft
 * rejected bad handshakes in `handleConnection`, which passed every unit test and
 * still admitted every socket on the wire, because the client is already
 * connected by the time that hook runs.
 *
 * So this boots the real application, connects a real client, and approves a real
 * enrollment request.
 *
 * Self-seeding; everything it writes is removed.
 *
 *   DATABASE_URL_APP=... DATABASE_URL_WORKER=... REDIS_URL=... \
 *     npx vitest run --config vitest.integration.config.ts pairing-nudge
 */

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3';

interface Seed {
  requestId: string;
  sessionId: string;
  pollingCredential: string;
  installationId: string;
}

describe('pairing nudge · reaches the waiting device only', () => {
  let app: NestFastifyApplication;
  let db: Client;
  let port: number;
  let merchantId: string;
  let userId: string;
  const seeded: string[] = [];

  const seed = async (): Promise<Seed> => {
    const requestId = randomUUID();
    const sessionId = randomUUID();
    const pollingCredential = `polling-${randomUUID()}`;
    const installationId = `installation-${randomUUID()}`;
    await db.query(
      `INSERT INTO runtime.device_enrollment_request
         (id, merchant_id, display_name, device_kind, platform, setup_code_hash,
          idempotency_key, state, installation_hash, expires_at, created_by)
       VALUES ($1::uuid,$2::uuid,'Nudge harness','pos_terminal','linux',$3,
               gen_random_uuid(),'awaiting_approval',$4, now() + interval '5 minutes', $5::uuid)`,
      [requestId, merchantId, hash(`setup-${requestId}`), hash(installationId), userId],
    );
    await db.query(
      `INSERT INTO runtime.device_pairing_session (id, enrollment_request_id, polling_credential_hash)
       VALUES ($1::uuid,$2::uuid,$3)`,
      [sessionId, requestId, hash(pollingCredential)],
    );
    seeded.push(requestId);
    return { requestId, sessionId, pollingCredential, installationId };
  };

  const connect = (entry: Seed): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
      const socket = io(`http://127.0.0.1:${port}${REALTIME_NAMESPACE}`, {
        auth: {
          pairingSessionId: entry.sessionId,
          pollingCredential: entry.pollingCredential,
          installationId: entry.installationId,
        },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (error) => reject(error));
    });

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.getHttpServer().address();
    if (address === null || typeof address === 'string') {
      throw new Error('the harness needs a bound TCP port');
    }
    port = address.port;

    db = new Client({ connectionString: WORKER_DSN });
    await db.connect();
    merchantId = (await db.query<{ id: string }>('SELECT id::text FROM merchant.merchant LIMIT 1'))
      .rows[0].id;
    userId = (await db.query<{ id: string }>('SELECT id::text FROM umi."user" LIMIT 1')).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    for (const requestId of seeded) {
      const device = await db
        ?.query<{ id: string }>(
          `DELETE FROM runtime.device_enrollment_request WHERE id = $1::uuid
             RETURNING device_id::text AS id`,
          [requestId],
        )
        .catch(() => undefined);
      const deviceId = device?.rows[0]?.id;
      if (deviceId) {
        await db
          .query('DELETE FROM merchant.device WHERE id = $1::uuid', [deviceId])
          .catch(() => {});
      }
    }
    await db?.end().catch(() => {});
    await app?.close();
  }, 30_000);

  it('delivers the approval nudge to the approved session and to no other', async () => {
    const mine = await seed();
    const other = await seed();
    const mySocket = await connect(mine);
    const otherSocket = await connect(other);

    const nudge = new Promise<Record<string, unknown>>((resolve) => {
      mySocket.on(REALTIME_EVENT_PAIRING_CHANGED, resolve);
    });
    const strayNudges: unknown[] = [];
    otherSocket.on(REALTIME_EVENT_PAIRING_CHANGED, (payload) => strayNudges.push(payload));

    await app.get(DevicesService).approve(merchantId, userId, mine.requestId, randomUUID(), null);

    const received = await Promise.race([
      nudge,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('no nudge within 5s')), 5_000),
      ),
    ]);

    expect(received).toMatchObject({
      pairingSessionId: mine.sessionId,
      state: 'credential_ready',
    });
    // The nudge is a signal, never a delivery: no device, no credential.
    expect(Object.keys(received).sort()).toEqual(['occurredAt', 'pairingSessionId', 'state']);
    expect(strayNudges).toEqual([]);

    mySocket.close();
    otherSocket.close();
  }, 30_000);

  it('refuses a socket whose triplet does not match', async () => {
    const entry = await seed();
    await expect(
      connect({ ...entry, pollingCredential: 'a different credential' }),
    ).rejects.toThrow('unauthorized');
  }, 30_000);
});
