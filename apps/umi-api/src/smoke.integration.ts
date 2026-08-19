import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { JwtService } from './shared/auth/jwt.service';
import { CustomerSessionService } from './modules/cash/customer-session.service';
import { WalletPassService } from './modules/wallet/wallet-pass.service';

/**
 * EVERY READ ENDPOINT, AGAINST THE MIGRATED DATABASE.
 *
 * The unit and contract suites prove each route's shape against mocks. The SQL
 * preflight proves every statement — reads and writes alike — PARSES against the
 * build-v3 schema. Neither can say whether a route actually answers when a real
 * request carries a real credential and reaches real backfilled rows. That is
 * what this file is for, and a 500 here is a statement that it does not.
 *
 * WHY READS ONLY. Write coverage is not missing, it is elsewhere and it is
 * better placed: `sql-preflight` prepares every INSERT/UPDATE/DELETE against the
 * live schema, and the behavioural suites (`cash-seals`, `cash-login`,
 * `cash-logout`, `credential-upgrade`, `wallet-carry`, `loyalty-stamps`) drive
 * the write paths that have rules worth asserting. Firing 53 invented request
 * bodies at this clone would mutate the rehearsal data and prove less.
 *
 *   DATABASE_URL_APP=…rehearsal DATABASE_URL_WORKER=…rehearsal \
 *     npx vitest run --config vitest.integration.config.ts smoke
 */

/**
 * ROUTES THAT ARE NOT EXPECTED TO ANSWER, each with the reason it does not.
 *
 * The same discipline as `KNOWN_UNRESOLVED` in `sql-preflight.integration.ts`,
 * and for the same reason: a named exception can be counted, a disabled test
 * cannot. Two assertions make the list binding.
 *
 *   1. A route NOT listed here must answer below 400. New breakage is never
 *      masked.
 *   2. Every entry here must MATCH a route and must produce the status it
 *      claims. An entry whose route starts working fails this suite, which is
 *      what forces the entry to be deleted rather than quietly outliving the
 *      defect it describes.
 */
interface Expectation {
  /** Matched against the request url, after fixture substitution. */
  match: RegExp;
  status: number;
  why: string;
}

const GIFT_CARDS_AB13 =
  'AB#13 · merchant.loyalty_gift_card has 6 columns and the Cash repositories ' +
  'read ten. Deferred by owner decision D-1 of 2026-08-14: the gifting model ' +
  'arrives whole with PR #94, not as a hand-made delta. `sql-preflight` ' +
  'allowlists the same 7 statements. DELETE THIS when that lands.';

const EXPECTED: readonly Expectation[] = [
  { match: /\/admin\/gift-cards$/, status: 500, why: GIFT_CARDS_AB13 },
  { match: /\/cash\/gift-cards$/, status: 500, why: GIFT_CARDS_AB13 },
  { match: /\/gift\/[^/]+$/, status: 500, why: GIFT_CARDS_AB13 },
];

/**
 * ROUTES WHOSE ANSWER IS DECIDED BY CONFIGURATION, NOT BY THE SCHEMA.
 *
 * Wallet signing certificates and the brand-asset origin are environment values.
 * A machine that holds them gets a pass; a machine that does not gets a refusal,
 * and neither says anything about the migration. So the expectation is DERIVED
 * from the running app's own configuration rather than written down — the suite
 * then states the same truth in CI, on a laptop, and on the deployed host.
 *
 * Each still proves what this file is for. `v1/passes/:passTypeId/:serial`
 * authenticates against `merchant.loyalty_wallet_pass` BEFORE it looks at the
 * certificates, so reaching the unconfigured branch means that query ran and
 * matched a real pass.
 *
 * Note the routes disagree on how they say it — 503 with a message, 500 bare.
 * The bare 500 is Apple's side of the wire, where a 500 makes the phone retry.
 */
function environmentExceptions(wallet: WalletPassService): Expectation[] {
  const out: Expectation[] = [];
  if (!wallet.isConfigured()) {
    out.push(
      {
        match: /\/passes\/apple$/,
        status: 503,
        why: 'APPLE_SIGNER_CERT / APPLE_PASS_TYPE_ID / APPLE_TEAM_ID absent here.',
      },
      {
        match: /\/passes\/apple\/v1\/passes\//,
        status: 500,
        why: 'Apple signing certificates absent; the pass authenticated first.',
      },
    );
  }
  if (!wallet.isGoogleConfigured()) {
    out.push({
      match: /\/passes\/google$/,
      status: 503,
      why: 'GOOGLE_WALLET_* absent here.',
    });
  }
  if (!wallet.assetOrigin()) {
    // Worth stating plainly, because it is a cutover value nobody would miss
    // until a customer opened their pass: the Google hero image is fetched from
    // `WALLET_PUBLIC_ORIGIN`, and with no origin the fetch has no url to resolve
    // against. Unset, EVERY stamp strip 500s and every Google pass loses its
    // card face.
    out.push({
      match: /\/stamp-strip\//,
      status: 500,
      why: 'WALLET_PUBLIC_ORIGIN is unset, so the brand assets have no origin to load from.',
    });
  }
  return out;
}

interface Fixtures {
  merchantId: string;
  handle: string;
  customerId: string;
  cardId: string;
  serial: string;
  appleToken: string;
  userId: string;
  email: string;
  locationId: string | null;
}

/**
 * Resolved FROM THE DATABASE rather than from environment variables.
 *
 * Eight hand-copied UUIDs is eight chances to test the wrong row, and a fixture
 * that no longer exists reads exactly like a broken endpoint. Asking the clone
 * which customer has an active card with an Apple pass makes the suite run on
 * any rehearsal database without anybody remembering anything.
 */
async function resolveFixtures(dsn: string): Promise<Fixtures> {
  const client = new Client({ connectionString: dsn });
  await client.connect();
  try {
    const { rows } = await client.query<Fixtures>(
      // The merchant with the MOST active products, deliberately. Every
      // product-gated route 403s for a café that has not bought the product —
      // correctly — so picking the richest café is what makes the matrix cover
      // KDS and the conversation pipeline instead of skipping them.
      `WITH carded AS (
         SELECT c.merchant_id, c.customer_id, c.id AS card_id,
                p.external_object_id AS serial, p.web_service_token AS apple_token,
                (SELECT count(*)
                   FROM umi.effective_entitlement ee
                   JOIN umi.subscription s ON s.merchant_id = ee.merchant_id
                  WHERE ee.merchant_id = c.merchant_id AND ee.enabled) AS products
           FROM merchant.loyalty_wallet_pass p
           JOIN merchant.loyalty_card c
             ON c.id = p.card_id AND c.status = 'active'
          WHERE p.platform = 'apple' AND p.web_service_token IS NOT NULL
          ORDER BY products DESC, c.id
          LIMIT 1
       )
       SELECT m.id::text        AS "merchantId",
              m.handle          AS handle,
              k.customer_id::text AS "customerId",
              k.card_id::text   AS "cardId",
              k.serial          AS serial,
              k.apple_token     AS "appleToken",
              u.id::text        AS "userId",
              u.email           AS email,
              (SELECT l.id::text FROM merchant.location l
                WHERE l.merchant_id = m.id ORDER BY l.id LIMIT 1) AS "locationId"
         FROM carded k
         JOIN merchant.merchant m ON m.id = k.merchant_id
         CROSS JOIN LATERAL (
           SELECT u.id, u.email
             FROM umi.user_role ur
             JOIN umi."user" u ON u.id = ur.user_id
            WHERE ur.is_platform AND ur.revoked_at IS NULL
            ORDER BY u.created_at
            LIMIT 1
         ) u`,
    );
    const f = rows[0];
    if (!f) {
      throw new Error(
        'No fixture found, so there is nothing to smoke. This is a MIGRATION-family ' +
          'instrument: point it at a backfilled clone of production, not at a pristine ' +
          'build (`npm run test:integration:migration`).\n' +
          'On a clone that IS backfilled, the usual cause is a backfill run WITHOUT ' +
          '`BOOTSTRAP_EMAIL`. `seed_rbac.sql` then falls back to bootstrap@localhost.invalid, ' +
          'which matches no real user, `umi.user_role` comes out EMPTY, and the migrated ' +
          'platform has no administrator at all.',
      );
    }
    return f;
  } finally {
    await client.end();
  }
}

interface Result {
  url: string;
  declared: string;
  status: number;
}

describe('build-v3 smoke · every read endpoint', () => {
  let app: NestFastifyApplication;
  let fx: Fixtures;
  let expected: readonly Expectation[];
  const routes: string[] = [];
  const results: Result[] = [];
  let staffCookie = '';
  let customerBearer = '';

  /** Real ids substituted for every path parameter Fastify declares. */
  function fill(url: string): string {
    return url
      .replace(/:merchantRef/g, fx.handle)
      .replace(/:handle/g, fx.handle)
      .replace(/:merchantId/g, fx.merchantId)
      // `:contactId` is named for the old identity spine. build-v3 collapsed it:
      // every Customer 360 read keys on `merchant.customer.id`.
      .replace(/:contactId/g, fx.customerId)
      .replace(/:customerId/g, fx.customerId)
      .replace(/:cardId/g, fx.cardId)
      .replace(/:staffId/g, fx.userId)
      .replace(/:locationId/g, fx.locationId ?? fx.merchantId)
      .replace(/:stationId/g, fx.locationId ?? fx.merchantId)
      .replace(/:ticketId/g, '00000000-0000-4000-8000-000000000000')
      .replace(/:deviceId/g, '00000000-0000-4000-8000-000000000000')
      .replace(/:passTypeId/g, 'pass.co.umicash.loyalty')
      .replace(/:serial/g, fx.serial)
      // `{filled}-{required}.png`, content-addressed. Anything else is a 400,
      // correctly — the route parses the state out of its own url.
      .replace(/:state/g, '3-10.png')
      .replace(/:code/g, 'SMOKECODE')
      .replace(/:id\b/g, fx.customerId);
  }

  /**
   * THREE CREDENTIALS, one per audience, chosen by the route's declared shape.
   *
   * A staff cookie on a customer route reads as a broken endpoint when it is a
   * broken harness. The register, the customer's own card page and Apple's
   * servers authenticate in three different ways, and all three are real here:
   * signed with the app's own keys, or read out of the pass row itself.
   */
  function headersFor(declared: string): Record<string, string> {
    if (/\/passes\/apple\/v1\/passes\//.test(declared)) {
      return { authorization: `ApplePass ${fx.appleToken}` };
    }
    if (/\/card(\/qr)?$|\/passes\/(apple|google)$/.test(declared)) {
      return { authorization: `Bearer ${customerBearer}` };
    }
    return { cookie: staffCookie };
  }

  beforeAll(async () => {
    fx = await resolveFixtures(process.env.DATABASE_URL_WORKER!);

    // Wired like `main.ts`. Without `fastifyCookie` the AuthGuard sees no cookies
    // at all and answers `authentication_required` for every route — which reads
    // exactly like a broken token and is not one.
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ trustProxy: true }),
      { logger: false },
    );
    await app.register(fastifyCookie);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    const fastify = app.getHttpAdapter().getInstance();
    fastify.addHook('onRoute', (r: { method: string | string[]; url: string }) => {
      const methods = Array.isArray(r.method) ? r.method : [r.method];
      for (const m of methods) if (m === 'GET') routes.push(r.url);
    });
    await app.init();
    await fastify.ready();

    // REAL sessions, signed with the app's own keys, so the guard chain runs for
    // real rather than being stubbed out.
    const jwt = app.get(JwtService);
    staffCookie = `umi_access=${await jwt.signAccess({ sub: fx.userId, email: fx.email })}`;
    customerBearer = await app
      .get(CustomerSessionService)
      .signAccessToken(fx.customerId, 'CUSTOMER', fx.merchantId);

    expected = [...EXPECTED, ...environmentExceptions(app.get(WalletPassService))];
  }, 120_000);

  afterAll(async () => {
    const declaredFor = (r: Result) => expected.find((e) => e.match.test(r.url));
    const unexpected = results.filter((r) => r.status >= 400 && !declaredFor(r));
    console.log(`\n=== SMOKE: ${results.length} GET routes · ${fx?.handle} ===`);
    console.log(`  answered (<400) ........ ${results.filter((r) => r.status < 400).length}`);
    console.log(`  declared exception ..... ${results.filter((r) => declaredFor(r)).length}`);
    console.log(`  UNEXPECTED ............. ${unexpected.length}`);
    for (const r of unexpected) console.log(`    ${r.status}  ${r.url}`);
    await app?.close();
  });

  it('every route answers, or is a declared exception', async () => {
    for (const declared of routes) {
      const url = fill(declared);
      const res = await app.inject({ method: 'GET', url, headers: headersFor(declared) });
      results.push({ url, declared, status: res.statusCode });
    }
    expect(results.length).toBeGreaterThan(20);

    const failures = results
      .filter((r) => r.status >= 400)
      .filter((r) => !expected.some((e) => e.match.test(r.url) && e.status === r.status))
      .map((r) => `${r.status} ${r.url}`);
    expect(failures).toEqual([]);
  }, 300_000);

  it('no declared exception has quietly started working', () => {
    // The half of the contract that keeps the list honest. When the gift-card
    // model lands these routes answer, this assertion fails, and the entry is
    // deleted by the same pull request rather than by somebody remembering.
    const stale = expected
      .filter((e) => {
        const hit = results.filter((r) => e.match.test(r.url));
        return hit.length === 0 || hit.every((r) => r.status !== e.status);
      })
      .map((e) => `${e.match} no longer answers ${e.status} — ${e.why}`);
    expect(stale).toEqual([]);
  });
});
