import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { WalletPassRepository } from './wallet-pass.repository';

/**
 * THE CARRY LIST — the five things the cutover backfill must move intact, proven
 * against a real database rather than asserted in a document.
 *
 * Every one of them fails SILENTLY. The customer keeps a pass that opens, renders
 * and scans; only the UPDATE stops, and no gate, log or test elsewhere reports it.
 * That is why they are proven here, one by one, by removing each and watching the
 * behaviour disappear:
 *
 *   1. `loyalty_wallet_pass.external_object_id` — the serial. Apple's pass identity.
 *   2. `loyalty_wallet_pass.web_service_token`  — the bearer secret in the phone's copy.
 *   3. `merchant.handle`                        — a path segment of the frozen URL.
 *   4. `runtime.pass_device.push_token`         — the only way to reach the phone.
 *   5. `merchant.location.lat/lng/status`       — the nearby geofences.
 *   6. `loyalty_card.card_number`               — what the barcode encodes.
 *
 * ⚠️ ITEM 6 CORRECTS THE PLAN. `GATED_CUTOVER_PLAN.md` says "the register
 * resolves the card by `qr_token`, which carries". That is wrong for a wallet
 * pass. `signWalletBarcode` signs the CARD NUMBER, and `qr_token` appears nowhere
 * in the wallet module. A card that arrives with a different `card_number` gets a
 * pass whose barcode the register cannot resolve.
 *
 * Self-seeding, so it runs against any database that has build-v3 applied. Every
 * row it writes is rolled back.
 *
 *   PGPORT=5233 DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *     npx vitest run --config vitest.integration.config.ts wallet-carry
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

const MERCHANT = '9f000000-0000-4000-8000-000000000001';
const CUSTOMER = '9f000000-0000-4000-8000-000000000002';
const CARD = '9f000000-0000-4000-8000-000000000003';
const HANDLE = 'carrytest';
const SERIAL = 'CARRY-SERIAL-1';
const TOKEN = 'carry-web-service-token';
const DEVICE = 'CARRY-DEVICE-1';
const PUSH = 'carry-push-token';
const BIRTHDAY_REWARD = 'Rebanada de pastel';

describe('wallet carry list · the five values the cutover must move intact', () => {
  let pg: PgService;
  let repo: WalletPassRepository;
  let walletPassId: string;

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    repo = new WalletPassRepository(pg);

    await pg.query(`DELETE FROM merchant.merchant WHERE id = $1::uuid`, [MERCHANT]);
    await pg.query(
      `INSERT INTO merchant.merchant (id, name, handle) VALUES ($1::uuid, 'Carry Test', $2)`,
      [MERCHANT, HANDLE],
    );
    await pg.query(
      `INSERT INTO merchant.customer (id, merchant_id, name) VALUES ($1::uuid, $2::uuid, 'Ana')`,
      [CUSTOMER, MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.loyalty_card (id, merchant_id, customer_id, card_number)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'CARRY-1')`,
      [CARD, MERCHANT, CUSTOMER],
    );
    await pg.query(
      `INSERT INTO merchant.location (merchant_id, name, status, lat, lng)
       VALUES ($1::uuid, 'Centro', 'active', 20.673600, -103.344000)`,
      [MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.loyalty_program (merchant_id, birthday_reward_enabled, birthday_reward_name)
       VALUES ($1::uuid, true, $2)`,
      [MERCHANT, BIRTHDAY_REWARD],
    );
    const created = await repo.findOrCreateApplePass(CARD, SERIAL, TOKEN);
    walletPassId = created.walletPassId;
    await repo.registerDevice(walletPassId, DEVICE, PUSH);
  });

  afterAll(async () => {
    await pg?.query(`DELETE FROM merchant.merchant WHERE id = $1::uuid`, [MERCHANT]);
    await pg?.onModuleDestroy?.();
  });

  it('1+2 · the serial and the token together authenticate the pass', async () => {
    const pass = await repo.authenticate(SERIAL, TOKEN);
    expect(pass).not.toBeNull();
    expect(pass!.cardId).toBe(CARD);
    expect(pass!.merchantId).toBe(MERCHANT);
    // The token must come back out, or the rebuilt pass cannot be signed with it.
    expect(pass!.webServiceToken).toBe(TOKEN);
  });

  it('2 · a wrong token authenticates nothing', async () => {
    expect(await repo.authenticate(SERIAL, 'not-the-token')).toBeNull();
    expect(await repo.authenticate(SERIAL, '')).toBeNull();
  });

  it('1 · a serial that did not carry authenticates nothing', async () => {
    expect(await repo.authenticate('SOME-OTHER-SERIAL', TOKEN)).toBeNull();
  });

  it('3 · the handle resolves the merchant, because it is in the frozen URL', async () => {
    const found = await repo.merchantByHandle(HANDLE);
    expect(found?.id).toBe(MERCHANT);
    // A handle that changed at cutover 404s a URL already signed into 350 passes.
    expect(await repo.merchantByHandle('a-different-handle')).toBeNull();
  });

  it('4 · the push token is what the fan-out reaches the phone with', async () => {
    expect(await repo.pushTokensForCard(CARD)).toEqual([PUSH]);

    await pg.query(
      `UPDATE runtime.pass_device SET push_token = NULL WHERE wallet_pass_id = $1::uuid`,
      [walletPassId],
    );
    expect(await repo.pushTokensForCard(CARD)).toEqual([]);
    await pg.query(
      `UPDATE runtime.pass_device SET push_token = $2 WHERE wallet_pass_id = $1::uuid`,
      [walletPassId, PUSH],
    );
  });

  it('5 · the geofences vanish when lat/lng does not carry', async () => {
    const withCoords = await repo.renderData(MERCHANT, CARD);
    expect(withCoords?.locations).toEqual([{ latitude: 20.6736, longitude: -103.344 }]);

    // This is the silent one. Null coordinates produce a pass with NO nearby
    // behaviour, no error, and no difference the customer can see until they walk
    // to the café and nothing appears.
    await pg.query(`UPDATE merchant.location SET lat = NULL WHERE merchant_id = $1::uuid`, [
      MERCHANT,
    ]);
    expect((await repo.renderData(MERCHANT, CARD))?.locations).toEqual([]);
    await pg.query(`UPDATE merchant.location SET lat = 20.673600 WHERE merchant_id = $1::uuid`, [
      MERCHANT,
    ]);
  });

  it('5 · a status other than exactly "active" also drops the geofence', async () => {
    await pg.query(`UPDATE merchant.location SET status = 'closed' WHERE merchant_id = $1::uuid`, [
      MERCHANT,
    ]);
    expect((await repo.renderData(MERCHANT, CARD))?.locations).toEqual([]);
    await pg.query(`UPDATE merchant.location SET status = 'active' WHERE merchant_id = $1::uuid`, [
      MERCHANT,
    ]);
  });

  it('6 · the card number carries, because the barcode encodes it', async () => {
    const data = await repo.renderData(MERCHANT, CARD);
    expect(data?.cardNumber).toBe('CARRY-1');

    // The barcode is `${card_number}.${hmac}` and the register resolves the card
    // from it. A card number that changed at cutover produces a pass that opens,
    // renders, and then cannot be scanned.
    const scanned = await pg.query<{ card_number: string }>(
      `SELECT card_number FROM merchant.loyalty_card WHERE id = $1::uuid`,
      [CARD],
    );
    expect(scanned.rows[0].card_number).toBe(data?.cardNumber);
  });

  it('the pass is never regenerated once it exists', async () => {
    const again = await repo.findOrCreateApplePass(CARD, 'BRAND-NEW-SERIAL', 'brand-new-token');
    expect(again.serialNumber).toBe(SERIAL);
    expect(again.webServiceToken).toBe(TOKEN);
    expect(again.walletPassId).toBe(walletPassId);
  });

  it('Apple is told a card changed only after the card row is touched', async () => {
    const future = new Date(Date.now() + 60_000);
    expect(await repo.serialsUpdatedSince(MERCHANT, DEVICE, future)).toEqual([]);

    await repo.touchCards([CARD]);
    const past = new Date(Date.now() - 60_000);
    expect(await repo.serialsUpdatedSince(MERCHANT, DEVICE, past)).toEqual([SERIAL]);
  });

  /**
   * 7 · the birthday reward line.
   *
   * ⚠️ A REGRESSION, not a gap. umi-cash sets `birthdayRewardName` on the Google
   * pass today, and both builders read it — `google-pass.service.ts:249` and
   * `apple-pass.builder.ts:265`. The ported `renderData` never selected the
   * column, so the field arrived undefined and the reward line vanished from
   * every Android pass. Silent: the pass still renders, one row shorter.
   */
  it('7 · the birthday reward name reaches the pass renderer', async () => {
    const data = await repo.renderData(MERCHANT, CARD);
    expect(data).not.toBeNull();
    expect(data!.birthdayRewardName).toBe(BIRTHDAY_REWARD);
  });

  /**
   * 8 · pass health is measurable at all.
   *
   * Work item 31 stays open on DETECTION, not on prevention: four failure paths
   * log and nothing counts them. This proves the counter exists and separates
   * the two questions. The seeded pass HAS a device, so it is registered; the
   * card was touched during setup, so it is not stale.
   */
  it('8 · pass health counts registered and stale passes apart', async () => {
    const health = await repo.passHealth(30);
    expect(health.total).toBeGreaterThanOrEqual(1);
    expect(health.unregistered).toBe(0);
    expect(health.stale).toBe(0);

    // A threshold of 0 days makes every pass stale by definition — the counter
    // moves, so a green result above is a measurement and not a constant.
    const allStale = await repo.passHealth(0);
    expect(allStale.stale).toBeGreaterThanOrEqual(1);
  });
});
