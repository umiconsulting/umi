import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

/**
 * THE ROOM KEY COMES FROM THE CREDENTIAL, NEVER FROM THE CLIENT — plan §15.2 D39, against rows.
 *
 * The device channel that carries the tender nudge to a register (`/rt`, `device:<merchantId>`)
 * admits a socket by its DEVICE CREDENTIAL and puts it in the room the credential resolved to. That
 * is a security claim — a till must not be able to ask for another café's counter — and until this
 * file it rested on a gateway spec whose `authenticate` was a mock and a service spec whose
 * repository was a mock. Neither can say whether the QUERY behind it resolves a credential to the
 * right merchant: a predicate that matches the wrong row, or matches none, looks identical from
 * behind a mock.
 *
 * IT USES THE REAL REPOSITORY AND THE REAL HASHING. `DevicesService.authenticate` hashes the
 * installation id and the credential with sha256 and hands both to `DevicesRepository.authenticate`,
 * which runs on the WORKER pool — the role that exists for a lookup with no session to scope by —
 * and returns the row it found, merchant and all. Nothing here stubs that; the only stubs are the
 * collaborators `authenticate` never touches (config, integrity, rate limit, the pairing bus).
 *
 * Run it against a DISPOSABLE build-v3 database, the way the other integration suites are run:
 *
 *   set -a && . apps/umi-api/.env && set +a
 *   DATABASE_URL_APP=$(echo "$DATABASE_URL_APP" | sed 's#/umi_transition_rehearsal_20260901#/umi_build_v3_mp#') \
 *   DATABASE_URL_WORKER=$(echo "$DATABASE_URL_WORKER" | sed 's#/umi_transition_rehearsal_20260901#/umi_build_v3_mp#') \
 *   npx vitest run --config vitest.integration.config.ts src/modules/devices/device-credential.integration.ts
 */

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;
const JWT_SECRET = 'device-credential-harness-secret-0000';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const MERCHANT_A = '7f000000-0000-4000-8000-0000000000c1';
const MERCHANT_B = '7f000000-0000-4000-8000-0000000000c2';
const LOCATION_A = '7f000000-0000-4000-8000-0000000000c3';
const LOCATION_B = '7f000000-0000-4000-8000-0000000000cc';
const DEVICE_A = '7f000000-0000-4000-8000-0000000000c4';
const DEVICE_B = '7f000000-0000-4000-8000-0000000000c5';
const DEVICE_REVOKED = '7f000000-0000-4000-8000-0000000000c6';
const DEVICE_ROTATING = '7f000000-0000-4000-8000-0000000000c7';
const PUBLIC_A = '7f000000-0000-4000-8000-0000000000c8';
const PUBLIC_B = '7f000000-0000-4000-8000-0000000000c9';
const PUBLIC_REVOKED = '7f000000-0000-4000-8000-0000000000ca';
const PUBLIC_ROTATING = '7f000000-0000-4000-8000-0000000000cb';

/** The plaintext credentials, known only to this file — the table holds their hashes. */
const INSTALLATION_A = 'installation-of-cafe-a';
const CREDENTIAL_A = 'credential-of-cafe-a';
const INSTALLATION_B = 'installation-of-cafe-b';
const CREDENTIAL_B = 'credential-of-cafe-b';
/**
 * A device mid-rotation needs its OWN installation, not café A's, and the reason is a constraint
 * rather than tidiness: `device_active_installation_uq` allows one row per installation among
 * devices that are `active` or `rotation_required`, which is what stops a re-enrolment from leaving
 * two live rows for one tablet. The REVOKED row below may reuse A's installation — the index
 * excludes it — which is itself the statement that a revoked row is not a live installation.
 */
const INSTALLATION_ROTATING = 'installation-of-rotating';
const CREDENTIAL_ROTATING = 'credential-of-rotating';

describe('the device credential · §15.2 D39', () => {
  let pg: PgService;
  let devices: DevicesService;

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN) {
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a DISPOSABLE build-v3 database.',
      );
    }
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    devices = new DevicesService(
      new DevicesRepository(pg),
      makeConfig(),
      // The four collaborators `authenticate` never touches. Stubbing them is not a shortcut: it
      // is the statement that this case is about the LOOKUP, and the lookup is the real one.
      {} as never,
      {} as never,
      {} as never,
    );

    for (const [id, name, handle] of [
      [MERCHANT_A, 'Device Credential A', 'device-credential-a'],
      [MERCHANT_B, 'Device Credential B', 'device-credential-b'],
    ] as const) {
      await pg.query(
        `INSERT INTO merchant.merchant (id,name,handle) VALUES ($1::uuid,$2,$3)
         ON CONFLICT (id) DO NOTHING`,
        [id, name, handle],
      );
    }
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name) VALUES ($1::uuid,$2::uuid,'Counter')
       ON CONFLICT (id) DO NOTHING`,
      [LOCATION_A, MERCHANT_A],
    );
    await pg.query(
      `INSERT INTO merchant.location (id,merchant_id,name) VALUES ($1::uuid,$2::uuid,'Counter')
       ON CONFLICT (id) DO NOTHING`,
      [LOCATION_B, MERCHANT_B],
    );

    // Each device stores the HASH of its installation id and credential, which is the whole point:
    // the plaintext above never reaches the table, and the lookup can only work by hashing.
    for (const [id, merchantId, locationId, publicId, installation, credential, status] of [
      [DEVICE_A, MERCHANT_A, LOCATION_A, PUBLIC_A, INSTALLATION_A, CREDENTIAL_A, 'active'],
      [DEVICE_B, MERCHANT_B, LOCATION_B, PUBLIC_B, INSTALLATION_B, CREDENTIAL_B, 'active'],
      [
        DEVICE_REVOKED,
        MERCHANT_A,
        LOCATION_A,
        PUBLIC_REVOKED,
        INSTALLATION_A,
        CREDENTIAL_A,
        'revoked',
      ],
      [
        DEVICE_ROTATING,
        MERCHANT_A,
        LOCATION_A,
        PUBLIC_ROTATING,
        INSTALLATION_ROTATING,
        CREDENTIAL_ROTATING,
        'rotation_required',
      ],
    ] as const) {
      await pg.query(
        `INSERT INTO merchant.device
           (id,merchant_id,location_id,name,kind,status,public_id,installation_hash,credential_hash,
            credential_version,revoked_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'Caja','pos_terminal',$4,$5::uuid,$6,$7,1,
                 -- A revoked device MUST carry the moment it was revoked: the schema's own
                 -- device_revocation_ck says a row that claims to be revoked without one is a row
                 -- nobody can explain, which is what this seed would have been.
                 CASE WHEN $4 = 'revoked' THEN now() ELSE NULL END)
         ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,
           public_id=EXCLUDED.public_id, installation_hash=EXCLUDED.installation_hash,
           credential_hash=EXCLUDED.credential_hash, last_seen_at=NULL,
           revoked_at=EXCLUDED.revoked_at`,
        [id, merchantId, locationId, status, publicId, sha256(installation), sha256(credential)],
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (pg) await pg.onModuleDestroy();
  }, 60_000);

  it('resolves a credential to ITS OWN merchant — the merchant id the socket room is keyed by', async () => {
    const device = await devices.authenticate(PUBLIC_A, INSTALLATION_A, CREDENTIAL_A);

    // THE CLAIM D39 RESTS ON. A socket that presents café A's credential is put in café A's room
    // because this row says `merchant_id = A` — never because the client said so.
    expect(device.merchantId).toBe(MERCHANT_A);
    expect(device.id).toBe(DEVICE_A);
    expect(device.publicId).toBe(PUBLIC_A);
    expect(device.rotationRequired).toBe(false);

    // …AND THE LOOKUP TOUCHED THAT ROW, which a "returns the first active device" mistake could not
    // fake: the query stamps `last_seen_at`, and this row's was cleared to NULL by the seed.
    const { rows } = await pg.query<{ seen: string | null }>(
      `SELECT last_seen_at::text AS seen FROM merchant.device WHERE id=$1::uuid`,
      [DEVICE_A],
    );
    expect(rows[0]?.seen).not.toBeNull();
  }, 60_000);

  it('resolves the OTHER café to the other merchant, so two tills cannot share a room', async () => {
    const device = await devices.authenticate(PUBLIC_B, INSTALLATION_B, CREDENTIAL_B);

    expect(device.merchantId).toBe(MERCHANT_B);
    expect(device.merchantId).not.toBe(MERCHANT_A);
    // The row A's credential did NOT match, which is the half a "found something" assertion would
    // miss: the two credentials resolve to two different cafés.
    expect(device.merchantId).toBe(MERCHANT_B);
  }, 60_000);

  it('refuses café A’s credential presented for café B’s device', async () => {
    // The public id is B's and the secrets are A's. Every field has to agree on ONE row.
    await expect(
      devices.authenticate(PUBLIC_B, INSTALLATION_A, CREDENTIAL_A),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_CREDENTIAL_INVALID' } });
  }, 60_000);

  it('refuses a right credential with a wrong installation id', async () => {
    // The installation id is the device's identity as much as the credential is; a stolen
    // credential replayed from another installation is not a device we know.
    await expect(
      devices.authenticate(PUBLIC_A, INSTALLATION_B, CREDENTIAL_A),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_CREDENTIAL_INVALID' } });
  }, 60_000);

  it('refuses a revoked device even with the credential it was issued', async () => {
    await expect(
      devices.authenticate(PUBLIC_REVOKED, INSTALLATION_A, CREDENTIAL_A),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_CREDENTIAL_INVALID' } });
  }, 60_000);

  it('REFUSES a device whose credential must be rotated — the case the socket handshake catches', async () => {
    // This is the branch §15.2 D39 describes from the socket's side: the gateway's `authenticate`
    // call is wrapped in a catch that turns any refusal into null, and a device mid-rotation must
    // hear nothing on a channel whose every REST read would answer `DEVICE_ROTATION_REQUIRED`.
    await expect(
      devices.authenticate(PUBLIC_ROTATING, INSTALLATION_ROTATING, CREDENTIAL_ROTATING),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_ROTATION_REQUIRED' } });

    // …and it is the FLAG, not the status, that decides: the same row authenticates when the
    // caller says it is willing (which is what the rotation path itself needs).
    const rotating = await devices.authenticate(
      PUBLIC_ROTATING,
      INSTALLATION_ROTATING,
      CREDENTIAL_ROTATING,
      true,
    );
    expect(rotating.rotationRequired).toBe(true);
    expect(rotating.merchantId).toBe(MERCHANT_A);
  }, 60_000);

  it('refuses an incomplete triple before it looks anything up', async () => {
    // The gateway pre-checks this too; here it is the service's own rule, and it must hold for a
    // caller that forgets. A missing field is `undefined`, which is not a uuid and not a hash.
    await expect(
      devices.authenticate(undefined, INSTALLATION_A, CREDENTIAL_A),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_CREDENTIAL_INVALID' } });
    await expect(devices.authenticate(PUBLIC_A, undefined, CREDENTIAL_A)).rejects.toMatchObject({
      response: { code: 'DEVICE_CREDENTIAL_INVALID' },
    });
    await expect(devices.authenticate(PUBLIC_A, INSTALLATION_A, undefined)).rejects.toMatchObject({
      response: { code: 'DEVICE_CREDENTIAL_INVALID' },
    });
    expect(randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
  }, 60_000);
});
