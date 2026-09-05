import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { AuthRepository } from './auth.repository';
import { deviceProofPayload, verifyDeviceProof } from '../devices/device-proof';

/**
 * THE DEVICE KEY MUST SURVIVE THE ROUND TRIP THROUGH POSTGRES.
 *
 * Proof-of-possession only holds if the public key the client registered at
 * pairing is the SAME bytes the server reads back at login. That is a claim
 * about a COLUMN — `merchant.device.ephemeral_public_key` — and about the two
 * queries that read it: `validatePosDevice` (pin login, app-substrate pool) and
 * `validatePosSession` (refresh, worker pool JOIN). A mocked repository returns
 * whatever it was told for both the faithful column and a truncated one alike,
 * so this fact can only be proven against a real database.
 *
 * The suite seeds one KEYED device and one LEGACY (null-key) device, then asserts:
 *   1. `validatePosDevice` reads the stored key back byte-for-byte, and a proof
 *      freshly signed by the matching private key verifies against THAT key.
 *   2. A legacy device reads back a null key (gradual-rollout pass-through).
 *   3. `validatePosSession` reads the same key through the worker-pool JOIN.
 * So the whole chain — pairing writes, login reads, verifier accepts — is proven
 * on the real schema, not on a mock.
 *
 * Self-seeding against any build-v3 database; everything it writes is removed.
 *
 *   DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *     npx vitest run --config vitest.integration.config.ts pos-device-proof
 */

const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:5233/umi_backfill_v3';
const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const MERCHANT = '9f000000-0000-4000-8000-0000000000e1';
const LOCATION = '9f000000-0000-4000-8000-0000000000e2';
const DEVICE_KEYED = '9f000000-0000-4000-8000-0000000000e3';
const DEVICE_LEGACY = '9f000000-0000-4000-8000-0000000000e4';
const OPERATOR = '9f000000-0000-4000-8000-0000000000e5';
const SESSION = '9f000000-0000-4000-8000-0000000000e6';

const INSTALL_KEYED = 'install-keyed-device-pos-proof';
const CRED_KEYED = 'credential-keyed-device-pos-proof';
const INSTALL_LEGACY = 'install-legacy-device-pos-proof';
const CRED_LEGACY = 'credential-legacy-device-pos-proof';

describe('pos device proof · the registered key survives the round trip', () => {
  let pg: PgService;
  let repo: AuthRepository;
  // The Ed25519 public key exactly as the client registers it: the JWK `x`
  // coordinate, base64url — the same encoding `verifyDeviceProof` expects.
  let publicKeyB64Url: string;
  let privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];

  const cleanup = async () => {
    await pg.query(`DELETE FROM runtime.session WHERE id = $1::uuid`, [SESSION]);
    await pg.query(`DELETE FROM merchant.device WHERE id = ANY($1::uuid[])`, [
      [DEVICE_KEYED, DEVICE_LEGACY],
    ]);
    await pg.query(`DELETE FROM merchant.location WHERE id = $1::uuid`, [LOCATION]);
    await pg.query(`DELETE FROM merchant.merchant WHERE id = $1::uuid`, [MERCHANT]);
  };

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    repo = new AuthRepository(pg);

    const pair = generateKeyPairSync('ed25519');
    privateKey = pair.privateKey;
    publicKeyB64Url = (pair.publicKey.export({ format: 'jwk' }) as { x: string }).x;

    await cleanup();

    await pg.query(
      `INSERT INTO merchant.merchant (id, name, handle) VALUES ($1::uuid, 'Device Proof Test', 'deviceprooftest')`,
      [MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.location (id, merchant_id, name) VALUES ($1::uuid, $2::uuid, 'Counter')`,
      [LOCATION, MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.device
         (id, merchant_id, location_id, name, kind, status, installation_hash,
          credential_hash, credential_version, platform, mobility, ephemeral_public_key)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Till A', 'pos_terminal', 'active', $4, $5, 1,
               'linux', 'static', $6)`,
      [
        DEVICE_KEYED,
        MERCHANT,
        LOCATION,
        sha256(INSTALL_KEYED),
        sha256(CRED_KEYED),
        publicKeyB64Url,
      ],
    );
    await pg.query(
      `INSERT INTO merchant.device
         (id, merchant_id, location_id, name, kind, status, installation_hash,
          credential_hash, credential_version, platform, mobility, ephemeral_public_key)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Till B', 'pos_terminal', 'active', $4, $5, 1,
               'linux', 'static', NULL)`,
      [DEVICE_LEGACY, MERCHANT, LOCATION, sha256(INSTALL_LEGACY), sha256(CRED_LEGACY)],
    );
    await pg.query(
      `INSERT INTO runtime.session
         (id, merchant_id, principal_type, principal_id, token_hash, metadata, expires_at,
          is_active, refresh_family_id, created_at)
       VALUES ($1::uuid, $2::uuid, 'device', $3::uuid, $4,
               jsonb_build_object('app','pos','operatorUserId',$5::text,'locationId',$6::text),
               now() + interval '1 hour', true, gen_random_uuid(), now())`,
      [SESSION, MERCHANT, DEVICE_KEYED, sha256('pos-session-token'), OPERATOR, LOCATION],
    );
  });

  afterAll(async () => {
    await cleanup();
    await pg?.onModuleDestroy?.();
  });

  const validateKeyed = () =>
    repo.validatePosDevice({
      deviceId: DEVICE_KEYED,
      merchantId: MERCHANT,
      locationId: LOCATION,
      installationHash: sha256(INSTALL_KEYED),
      credentialHash: sha256(CRED_KEYED),
    });

  it('reads the registered key back byte-for-byte at pin login', async () => {
    const device = await validateKeyed();
    expect(device.allowed).toBe(true);
    expect(device.ephemeralPublicKey).toBe(publicKeyB64Url);
  });

  it('accepts a proof freshly signed by the key the database returned', async () => {
    const device = await validateKeyed();
    const timestampIso = new Date().toISOString();
    const message = Buffer.from(deviceProofPayload(INSTALL_KEYED, timestampIso), 'utf8');
    const signatureB64Url = cryptoSign(null, message, privateKey).toString('base64url');

    // The public key is the one round-tripped through Postgres, not an in-memory copy.
    expect(
      verifyDeviceProof(
        {
          publicKeyB64Url: device.ephemeralPublicKey as string,
          installationId: INSTALL_KEYED,
          timestampIso,
          signatureB64Url,
        },
        { now: new Date(timestampIso) },
      ),
    ).toBe(true);
  });

  it('rejects a tampered signature against the round-tripped key', async () => {
    const device = await validateKeyed();
    const timestampIso = new Date().toISOString();
    const message = Buffer.from(deviceProofPayload(INSTALL_KEYED, timestampIso), 'utf8');
    const bytes = cryptoSign(null, message, privateKey);
    bytes[0] ^= 0xff;
    expect(
      verifyDeviceProof(
        {
          publicKeyB64Url: device.ephemeralPublicKey as string,
          installationId: INSTALL_KEYED,
          timestampIso,
          signatureB64Url: bytes.toString('base64url'),
        },
        { now: new Date(timestampIso) },
      ),
    ).toBe(false);
  });

  it('reads a null key for a legacy device (gradual-rollout pass-through)', async () => {
    const device = await repo.validatePosDevice({
      deviceId: DEVICE_LEGACY,
      merchantId: MERCHANT,
      locationId: LOCATION,
      installationHash: sha256(INSTALL_LEGACY),
      credentialHash: sha256(CRED_LEGACY),
    });
    expect(device.allowed).toBe(true);
    expect(device.ephemeralPublicKey).toBeNull();
  });

  it('refuses a device whose credential hash does not match', async () => {
    const device = await repo.validatePosDevice({
      deviceId: DEVICE_KEYED,
      merchantId: MERCHANT,
      locationId: LOCATION,
      installationHash: sha256(INSTALL_KEYED),
      credentialHash: sha256('the-wrong-credential'),
    });
    expect(device.allowed).toBe(false);
    expect(device.ephemeralPublicKey).toBeNull();
  });

  it('reads the same key through the worker-pool session JOIN at refresh', async () => {
    const session = await repo.validatePosSession({
      sessionId: SESSION,
      userId: OPERATOR,
      installationHash: sha256(INSTALL_KEYED),
      credentialHash: sha256(CRED_KEYED),
    });
    expect(session).not.toBeNull();
    expect(session?.deviceId).toBe(DEVICE_KEYED);
    expect(session?.ephemeralPublicKey).toBe(publicKeyB64Url);
  });
});
