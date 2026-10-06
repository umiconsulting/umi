import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { PasswordService } from '../../shared/auth/password.service';
import { posPinLookupHash } from '../../shared/auth/pos-pin';
import { AuthRepository } from './auth.repository';

/**
 * THE TILL READS THE EMPLOYMENT, NOT THE INVITATION.
 *
 * The dashboard writes an operator's login `invited` whenever the typed email is
 * free — `staff.repository.ts` explains the security-gate reason — and NOTHING in
 * this API ever moves it to `active`: there is no invitation endpoint to send or
 * accept. So an operator recorded with a free email + a till PIN used to be
 * refused at the PIN screen for ever, because `findPosPinStaff` demanded
 * `u.status = 'active'` on the login. A merchant saw a PERMISSION_DENIED for a
 * PIN they had just typed themselves.
 *
 * The predicate is a JOIN over two tables and a status column, so a mocked
 * repository cannot see it: it returns whatever the test says. These cases run
 * the REAL query against the REAL schema, one row per state, and the point is
 * the pairs — an `invited` login works, a `suspended` LOGIN does not, and a
 * `disabled` EMPLOYMENT does not even though its login is fine.
 *
 * Self-seeding; everything it writes is removed.
 *
 *   DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *     npx vitest run --config vitest.integration.config.ts pos-pin-eligibility
 */

const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:5233/umi_backfill_v3';
const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3';

const JWT_SECRET = 'pos-pin-harness-secret-0000000000000000';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const MERCHANT = '9e000000-0000-4000-8000-0000000000e1';
const LOCATION = '9e000000-0000-4000-8000-0000000000e2';
const OTHER_LOCATION = '9e000000-0000-4000-8000-0000000000e3';

/** One login per state under test. The database, not the test, decides their fate. */
const USERS = {
  invited: '9e000000-0000-4000-8000-0000000000f1',
  active: '9e000000-0000-4000-8000-0000000000f2',
  suspended: '9e000000-0000-4000-8000-0000000000f3',
  disabledEmployment: '9e000000-0000-4000-8000-0000000000f4',
} as const;

const PINS = {
  invited: '2468',
  active: '1357',
  suspended: '8642',
  disabledEmployment: '9753',
} as const;

const UNKNOWN_PIN = '1111';
/** Employed at the other till only: here the row exists and the scope excludes it. */
const OTHER_TILL_USER = '9e000000-0000-4000-8000-0000000000f5';
const OTHER_TILL_PIN = '1234';

describe('pos PIN eligibility · the employment is the gate, the suspension is the lock', () => {
  let pg: PgService;
  let repo: AuthRepository;
  const passwords = new PasswordService();
  const lookup = (merchantId: string, pin: string) => posPinLookupHash(JWT_SECRET, merchantId, pin);

  async function seedStaff(input: {
    id: string;
    userId: string;
    name: string;
    status: 'active' | 'disabled';
    locationId: string | null;
    pin: string;
  }): Promise<void> {
    const hashed = passwords.hash(input.pin, randomBytes(16).toString('hex'));
    await pg.query(
      `INSERT INTO merchant.staff
         (id, merchant_id, location_id, user_id, role_id, name, email, status,
          operator_pin_salt, operator_pin_hash, operator_pin_lookup)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
               (SELECT id FROM umi.role WHERE key = 'staff'),
               $5::text, $6::text, $7::text, $8::text, $9::text, $10::text)`,
      [
        input.id,
        MERCHANT,
        input.locationId,
        input.userId,
        input.name,
        `${input.name.toLowerCase().replace(/\s+/g, '.')}@example.test`,
        input.status,
        hashed.salt,
        hashed.hash,
        lookup(MERCHANT, input.pin),
      ],
    );
  }

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    repo = new AuthRepository(pg);

    await pg.query(`DELETE FROM merchant.merchant WHERE id = $1::uuid`, [MERCHANT]);
    await pg.query(`DELETE FROM umi."user" WHERE id = ANY($1::uuid[])`, [
      // `Object.values` on an `as const` map infers the four literals, and
      // `concat` refuses a fifth one; widen to the parameter's own type instead.
      [...Object.values<string>(USERS), OTHER_TILL_USER],
    ]);

    await pg.query(`INSERT INTO merchant.merchant (id, name, handle) VALUES ($1::uuid, $2, $3)`, [
      MERCHANT,
      'PIN Eligibility Harness',
      'pin-eligibility-harness',
    ]);
    await pg.query(
      `INSERT INTO merchant.location (id, merchant_id, name) VALUES
         ($1::uuid, $3::uuid, 'Mostrador'), ($2::uuid, $3::uuid, 'Barra')`,
      [LOCATION, OTHER_LOCATION, MERCHANT],
    );

    // The login states. `invited` is what the dashboard actually writes for a
    // free address; `active` is the PIN-only operator (no email) and the control.
    await pg.query(
      `INSERT INTO umi."user" (id, email, full_name, status) VALUES
         ($1::uuid, $5, 'Invitada',        'invited'),
         ($2::uuid, $6, 'Activa',          'active'),
         ($3::uuid, $7, 'Suspendida',      'suspended'),
         ($4::uuid, $8, 'Baja',            'active')`,
      [
        USERS.invited,
        USERS.active,
        USERS.suspended,
        USERS.disabledEmployment,
        'ux.pin.invited@example.test',
        'ux.pin.active@example.test',
        'ux.pin.suspended@example.test',
        'ux.pin.disabled@example.test',
      ],
    );
    await pg.query(
      `INSERT INTO umi."user" (id, full_name, status) VALUES ($1::uuid, $2, 'active')`,
      [OTHER_TILL_USER, 'Otra Sucursal'],
    );

    await seedStaff({
      id: '9e000000-0000-4000-8000-000000000101',
      userId: USERS.invited,
      name: 'Invitada',
      status: 'active',
      locationId: LOCATION,
      pin: PINS.invited,
    });
    await seedStaff({
      id: '9e000000-0000-4000-8000-000000000102',
      userId: USERS.active,
      name: 'Activa',
      status: 'active',
      locationId: LOCATION,
      pin: PINS.active,
    });
    await seedStaff({
      id: '9e000000-0000-4000-8000-000000000103',
      userId: USERS.suspended,
      name: 'Suspendida',
      status: 'active',
      locationId: LOCATION,
      pin: PINS.suspended,
    });
    // The mirror image of the invited case: a healthy login, a disabled employment.
    await seedStaff({
      id: '9e000000-0000-4000-8000-000000000104',
      userId: USERS.disabledEmployment,
      name: 'Baja',
      status: 'disabled',
      locationId: LOCATION,
      pin: PINS.disabledEmployment,
    });
    // Employed at the other till. Its PIN is valid; only the scope excludes it.
    await seedStaff({
      id: '9e000000-0000-4000-8000-000000000105',
      userId: OTHER_TILL_USER,
      name: 'Otra Sucursal',
      status: 'active',
      locationId: OTHER_LOCATION,
      pin: OTHER_TILL_PIN,
    });
  });

  afterAll(async () => {
    await pg?.query(`DELETE FROM merchant.merchant WHERE id = $1::uuid`, [MERCHANT]);
    await pg?.query(`DELETE FROM umi."user" WHERE id = ANY($1::uuid[])`, [
      [...Object.values<string>(USERS), OTHER_TILL_USER],
    ]);
    await pg?.onModuleDestroy?.();
  });

  it('FINDS an invited login — the operator the dashboard just created', async () => {
    const record = await repo.findPosPinStaff(MERCHANT, LOCATION, lookup(MERCHANT, PINS.invited));

    expect(record).not.toBeNull();
    expect(record?.userId).toBe(USERS.invited);
    expect(record?.email).toBe('ux.pin.invited@example.test');
    expect(record?.displayName).toBe('Invitada');
    // The hash is what the service verifies the typed PIN against.
    expect(passwords.verify(PINS.invited, record!.pinSalt, record!.pinHash)).toBe(true);
  });

  it('still finds an active login — the fix did not trade one state for another', async () => {
    const record = await repo.findPosPinStaff(MERCHANT, LOCATION, lookup(MERCHANT, PINS.active));
    expect(record?.userId).toBe(USERS.active);
  });

  it('REFUSES a suspended login whose employment and PIN are otherwise fine', async () => {
    await expect(
      repo.findPosPinStaff(MERCHANT, LOCATION, lookup(MERCHANT, PINS.suspended)),
    ).resolves.toBeNull();
  });

  it('REFUSES a disabled employment whose login is active', async () => {
    await expect(
      repo.findPosPinStaff(MERCHANT, LOCATION, lookup(MERCHANT, PINS.disabledEmployment)),
    ).resolves.toBeNull();
  });

  it('REFUSES a PIN nothing matches', async () => {
    await expect(
      repo.findPosPinStaff(MERCHANT, LOCATION, lookup(MERCHANT, UNKNOWN_PIN)),
    ).resolves.toBeNull();
  });

  it('scopes the PIN to the till it was granted for', async () => {
    // Same merchant, same valid PIN, same everything — only the location differs.
    const atOwnTill = await repo.findPosPinStaff(
      MERCHANT,
      OTHER_LOCATION,
      lookup(MERCHANT, OTHER_TILL_PIN),
    );
    expect(atOwnTill?.userId).toBe(OTHER_TILL_USER);
    await expect(
      repo.findPosPinStaff(MERCHANT, LOCATION, lookup(MERCHANT, OTHER_TILL_PIN)),
    ).resolves.toBeNull();
  });
});
