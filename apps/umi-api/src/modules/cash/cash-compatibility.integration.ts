import { WalletPassRepository } from '../wallet/wallet-pass.repository';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import { PasswordService } from '../../shared/auth/password.service';
import { MerchantsRepository } from '../merchants/merchants.repository';
import { MerchantsService } from '../merchants/merchants.service';
import { CashRepository } from './cash.repository';
import { CashPublicController } from './cash-public.controller';
import { CashPlatformController } from './cash-platform.controller';
import { CashPlatformRepository } from './cash-platform.repository';

describe('old Cash interfaces on the canonical schema', () => {
  let pg: PgService;
  let cash: CashRepository;
  let platform: CashPlatformRepository;
  let controller: CashPlatformController;
  const merchants: string[] = [];
  const users: string[] = [];
  const cards: string[] = [];
  const locations: string[] = [];
  const scope = <T>(index: number, fn: () => T) =>
    runWithRequestContext(
      {
        merchantId: merchants[index],
        userId: users[index],
        requestId: randomUUID(),
      },
      fn,
    );

  beforeAll(async () => {
    const env = {
      DATABASE_URL_APP:
        process.env.DATABASE_URL_APP ??
        'postgresql://api_login:harness_api@127.0.0.1:5233/umi_build_v3_ci',
      DATABASE_URL_WORKER:
        process.env.DATABASE_URL_WORKER ??
        'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_build_v3_ci',
    };
    pg = new PgService({ get: (key: keyof typeof env) => env[key] } as unknown as ConfigService<
      AppConfig,
      true
    >);
    await pg.onModuleInit();
    cash = new CashRepository(pg);
    platform = new CashPlatformRepository(pg);
    controller = new CashPlatformController(platform, cash, {
      refreshMerchant: async () => undefined,
      refreshMerchantWithCounts: async () => ({ cards: 0, sent: 0 }),
      refreshMerchantGoogleObjects: async () => ({ total: 0, refreshed: 0, missing: 0, failed: 0 }),
    } as never);
    const provisioning = new MerchantsService(new MerchantsRepository(pg), new PasswordService());
    for (let i = 0; i < 2; i++) {
      const fixture = await provisioning.provision({
        name: `Cash compatibility ${i}`,
        plan: 'pro',
        cardPrefix: `CC${i}`.replace('0', 'A').replace('1', 'B'),
        primaryColor: '#123456',
        adminEmail: `cash-${randomUUID()}@umi.invalid`,
        adminPassword: 'fixture-password-only',
        locations: [{ name: 'Test counter' }],
      });
      merchants.push(fixture.merchantId);
      users.push(fixture.userId);
      const customer = (
        await pg.query<{ id: string }>(
          'INSERT INTO merchant.customer (merchant_id,name) VALUES ($1::uuid,$2) RETURNING id::text',
          [fixture.merchantId, `Customer ${i}`],
        )
      ).rows[0].id;
      const card = (
        await pg.query<{ id: string }>(
          'INSERT INTO merchant.loyalty_card (merchant_id,customer_id,card_number) VALUES ($1::uuid,$2::uuid,$3) RETURNING id::text',
          [fixture.merchantId, customer, `CHECK-${i}`],
        )
      ).rows[0].id;
      cards.push(card);
      await pg.query(
        "INSERT INTO merchant.loyalty_wallet_pass (card_id,platform,external_object_id) VALUES ($1::uuid,'google',$2)",
        [card, `fixture-${card}`],
      );
      await pg.query(
        "INSERT INTO runtime.reminder_sent (merchant_id,card_id,reminder_type) VALUES ($1::uuid,$2::uuid,'welcome_no_visit')",
        [fixture.merchantId, card],
      );
      locations.push(
        (
          await pg.query<{ id: string }>(
            'SELECT id::text FROM merchant.location WHERE merchant_id=$1::uuid',
            [fixture.merchantId],
          )
        ).rows[0].id,
      );
    }
  });

  it('resolves new wallet URLs by UUID and renders the same public reference', async () => {
    const wallet = new WalletPassRepository(pg);
    expect(await wallet.merchantByHandle(merchants[0])).toMatchObject({ id: merchants[0] });
    expect((await wallet.renderData(merchants[0], cards[0]))?.merchantHandle).toBe(merchants[0]);
  });

  afterAll(async () => {
    if (!pg) return;
    if (merchants.length)
      await pg.query('DELETE FROM merchant.merchant WHERE id=ANY($1::uuid[])', [merchants]);
    if (users.length) await pg.query('DELETE FROM umi."user" WHERE id=ANY($1::uuid[])', [users]);
    await pg.onModuleDestroy();
  });

  it('serves the public storefront and the complete internal list without legacy tables', async () => {
    const response = await scope(0, () =>
      new CashPublicController(cash).config({
        merchantId: merchants[0],
        name: 'Test',
        handle: null,
      }),
    );
    expect(response.slug).toBe(merchants[0]);
    expect(response.locations).toHaveLength(1);
    expect(response.rewardProfile.visitsRequired).toBe(10);
    const [listed] = await platform.list(merchants[0]);
    expect(listed._count).toEqual({ users: 1, cards: 1 });
  });

  it('preserves split shifts and date exceptions during an internal admin edit', async () => {
    await pg.query('UPDATE merchant.merchant SET open_hours=$2::jsonb WHERE id=$1::uuid', [
      merchants[0],
      JSON.stringify({
        mon: [
          { open: '08:00', close: '16:00' },
          { open: '19:00', close: '22:00' },
        ],
        exceptions: [{ date: '2026-12-25', closed: true }],
      }),
    ]);
    await scope(0, () =>
      controller.update(merchants[0], {
        name: 'Updated café',
        businessHours: { mon: { open: true, from: '09:30', to: '17:15' } },
      }),
    );
    const row = (
      await pg.query<{ open_hours: { mon: unknown[]; exceptions: unknown[] } }>(
        'SELECT open_hours FROM merchant.merchant WHERE id=$1::uuid',
        [merchants[0]],
      )
    ).rows[0];
    expect(row.open_hours.mon).toEqual([
      { open: '09:30', close: '17:15' },
      { open: '19:00', close: '22:00' },
    ]);
    expect(row.open_hours.exceptions).toEqual([{ date: '2026-12-25', closed: true }]);
  });

  it('rolls back the whole edit when a location belongs to another merchant', async () => {
    await expect(
      scope(0, () =>
        controller.update(merchants[0], {
          name: 'Must roll back',
          locations: [{ id: locations[1], name: 'Foreign counter' }],
        }),
      ),
    ).rejects.toThrow();
    const row = (
      await pg.query<{ name: string; status: string }>(
        'SELECT m.name,l.status FROM merchant.merchant m JOIN merchant.location l ON l.merchant_id=m.id WHERE m.id=$1::uuid',
        [merchants[0]],
      )
    ).rows[0];
    expect(row).toEqual({ name: 'Updated café', status: 'active' });
  });

  it('keeps the upper reward when an internal admin changes the base reward', async () => {
    await pg.query(
      "INSERT INTO merchant.loyalty_reward (merchant_id,type,kind,name,stamps_required,active) VALUES ($1::uuid,'stamps_free_item','upgrade','Upper reward',12,true)",
      [merchants[0]],
    );
    await scope(0, () =>
      controller.update(merchants[0], { rewardName: 'Base reward', visitsRequired: 8 }),
    );
    const result = await scope(0, () => cash.rewardConfig(merchants[0]));
    expect(result.active[0]).toMatchObject({ rewardName: 'Base reward', visitsRequired: 8 });
    expect(result.upgrade[0]).toMatchObject({ rewardName: 'Upper reward', visitsRequired: 12 });
  });

  it('returns only the selected merchant reminder records and no invented message bodies', async () => {
    const response = await cash.messageHistory(merchants[0], 1, 50, null);
    expect(response.total).toBe(1);
    expect(response.events).toHaveLength(1);
    expect(response.events[0]).toMatchObject({
      body: null,
      customer: { cardId: cards[0], name: 'Customer 0' },
    });
  });

  it('previews an announcement without a write, then updates only the named merchant', async () => {
    expect(
      await controller.broadcast({
        reference: merchants[0],
        message: 'Test announcement',
        dryRun: true,
      }),
    ).toEqual({ total: 1, dryRun: true });
    const before = await pg.query<{ lifecycle_message: string | null }>(
      'SELECT lifecycle_message FROM merchant.loyalty_card WHERE id=$1::uuid',
      [cards[0]],
    );
    expect(before.rows[0].lifecycle_message).toBeNull();
    await controller.broadcast({ reference: merchants[0], message: 'Test announcement' });
    const rows = (
      await pg.query<{ id: string; lifecycle_message: string | null }>(
        'SELECT id::text,lifecycle_message FROM merchant.loyalty_card WHERE id=ANY($1::uuid[])',
        [cards],
      )
    ).rows;
    expect(rows.find((r) => r.id === cards[0])?.lifecycle_message).toBe('Test announcement');
    expect(rows.find((r) => r.id === cards[1])?.lifecycle_message).toBeNull();
  });
});
