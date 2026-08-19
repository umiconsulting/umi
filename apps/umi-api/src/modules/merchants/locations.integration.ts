import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { PasswordService } from '../../shared/auth/password.service';
import { MerchantsRepository } from './merchants.repository';
import { MerchantsService } from './merchants.service';
import { runWithRequestContext } from '../../shared/database/request-context';

/**
 * CAN A CAFÉ OPEN A SECOND BRANCH, AND CLOSE ONE?
 *
 * Provisioning writes a café's first location and then nothing could touch it
 * again. `updateLocation` reached name, timezone, aliases and descriptor — not the
 * address, not the pin — and there was no way at all to add a second branch. The
 * only surface that could was the legacy `/umi/*` panel in umi-cash, reading
 * `core.tenants` through Prisma, which stops existing at the cutover.
 *
 * Runs against the PRISTINE build for the same reason `provision.integration.ts`
 * does: a branch editor that only works because production happened to carry a row
 * is not a branch editor.
 */

const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:5233/umi_build_v3_ci';
const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_build_v3_ci';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const EMAIL = 'locations-harness@umi.invalid';

/**
 * Every location read and write goes through `withMerchant`, which takes its RLS
 * context from the request. The suite supplies the same context the AuthGuard
 * would, so these run on the umi_app pool under RLS exactly as a request does —
 * not on the worker pool, which would prove nothing about tenancy.
 */
function asMerchant<T>(merchantId: string, fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ merchantId, userId: null, requestId: 'locations-harness' }, fn);
}

describe('a café adding, editing and closing its own branches', () => {
  let pg: PgService;
  let service: MerchantsService;
  let merchantId: string;
  let userId: string;
  let firstLocationId: string;

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    service = new MerchantsService(new MerchantsRepository(pg), new PasswordService());

    await pg.query(`DELETE FROM umi."user" WHERE email = $1`, [EMAIL]);
    await pg.query(`DELETE FROM merchant.merchant WHERE name = 'Locations Harness'`);

    const out = await service.provision({
      name: 'Locations Harness',
      city: 'Guadalajara',
      plan: 'growth',
      cardPrefix: 'LOC',
      primaryColor: '#1A5632',
      secondaryColor: '#0F3A21',
      adminEmail: EMAIL,
      adminPassword: 'a-strong-enough-password',
      adminName: 'Ana',
      locations: [
        { name: 'Centro', address: 'Av. Chapultepec 1', latitude: 20.6736, longitude: -103.344 },
      ],
    });
    merchantId = out.merchantId;
    userId = out.userId;
    const profiles = await asMerchant(merchantId, () => service.listLocationProfiles(merchantId));
    firstLocationId = profiles[0].id;
  }, 60_000);

  afterAll(async () => {
    await pg
      ?.query(`DELETE FROM merchant.merchant WHERE id = $1::uuid`, [merchantId])
      .catch(() => {});
    await pg?.query(`DELETE FROM umi."user" WHERE id = $1::uuid`, [userId]).catch(() => {});
    await pg?.onModuleDestroy?.();
  });

  it('shows the branch the café was opened with, address and pin included', async () => {
    const [centro] = await asMerchant(merchantId, () => service.listLocationProfiles(merchantId));
    expect(centro.name).toBe('Centro');
    expect(centro.address).toBe('Av. Chapultepec 1');
    expect(centro.latitude).toBeCloseTo(20.6736, 4);
    expect(centro.longitude).toBeCloseTo(-103.344, 4);
    expect(centro.status).toBe('active');
  });

  it('adds a second branch, which is the whole reason this exists', async () => {
    const created = await asMerchant(merchantId, () =>
      service.createLocation(merchantId, {
        name: 'Congreso',
        address: 'Congreso 22',
        latitude: 20.6801,
        longitude: -103.3502,
      }),
    );
    expect(created.name).toBe('Congreso');
    expect(created.address).toBe('Congreso 22');
    expect(created.status).toBe('active');

    const profiles = await asMerchant(merchantId, () => service.listLocationProfiles(merchantId));
    expect(profiles.map((l) => l.name)).toEqual(['Centro', 'Congreso']);
  });

  it('moves a branch: a new address and a new pin', async () => {
    const updated = await asMerchant(merchantId, () =>
      service.updateLocation(merchantId, firstLocationId, {
        address: 'Av. Vallarta 500',
        latitude: 20.6745,
        longitude: -103.3701,
      }),
    );
    expect(updated.address).toBe('Av. Vallarta 500');
    expect(updated.latitude).toBeCloseTo(20.6745, 4);
    expect(updated.longitude).toBeCloseTo(-103.3701, 4);
    // Untouched fields stay: a patch is a patch.
    expect(updated.name).toBe('Centro');
  });

  it('clears an address the café no longer wants recorded', async () => {
    const updated = await asMerchant(merchantId, () =>
      service.updateLocation(merchantId, firstLocationId, {
        address: null,
        latitude: null,
        longitude: null,
      }),
    );
    expect(updated.address).toBeNull();
    expect(updated.latitude).toBeNull();
    expect(updated.longitude).toBeNull();
  });

  it('closes a branch, and the closed branch stays visible so it can be reopened', async () => {
    const closed = await asMerchant(merchantId, () =>
      service.updateLocation(merchantId, firstLocationId, { status: 'closed' }),
    );
    expect(closed.status).toBe('closed');

    const profiles = await asMerchant(merchantId, () => service.listLocationProfiles(merchantId));
    expect(profiles.find((l) => l.id === firstLocationId)?.status).toBe('closed');

    const reopened = await asMerchant(merchantId, () =>
      service.updateLocation(merchantId, firstLocationId, { status: 'active' }),
    );
    expect(reopened.status).toBe('active');
  });

  it('editing the nicknames does not erase the address or the descriptor', async () => {
    // THE REGRESSION THIS SUITE EXISTS FOR. `updateLocation` told "not sent" from
    // "clear it" with hasOwnProperty, and the DTO is compiled at ES2023 where every
    // DECLARED field becomes an own property — so a patch carrying only `aliases`
    // looked like a patch carrying all of them, set to undefined. Saving a nickname
    // would have wiped the branch's address and its human hint.
    //
    // The patch here is the shape a DTO produces, undefined keys and all, because
    // that is what the repository actually receives.
    await asMerchant(merchantId, () =>
      service.updateLocation(merchantId, firstLocationId, {
        address: 'Av. Juárez 10',
        descriptor: 'la del centro',
        latitude: 20.6,
        longitude: -103.3,
      }),
    );

    const patched = await asMerchant(merchantId, () =>
      service.updateLocation(merchantId, firstLocationId, {
        aliases: ['centro'],
        name: undefined,
        address: undefined,
        descriptor: undefined,
        latitude: undefined,
        longitude: undefined,
      }),
    );

    expect(patched.aliases).toEqual(['centro']);
    expect(patched.address).toBe('Av. Juárez 10');
    expect(patched.descriptor).toBe('la del centro');
    expect(patched.latitude).toBeCloseTo(20.6, 4);
    expect(patched.longitude).toBeCloseTo(-103.3, 4);
  });

  it('refuses to add a branch to a café that is not yours', async () => {
    // The repository carries an explicit merchant predicate as well as RLS. A
    // location created under someone else's id must not appear anywhere.
    const other = '00000000-0000-0000-0000-000000000000';
    await expect(
      asMerchant(other, () => service.createLocation(other, { name: 'Ajena' })),
    ).rejects.toThrow();
    const profiles = await asMerchant(merchantId, () => service.listLocationProfiles(merchantId));
    expect(profiles.map((l) => l.name)).not.toContain('Ajena');
  });
});
