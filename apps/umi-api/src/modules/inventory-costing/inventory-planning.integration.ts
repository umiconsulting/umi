import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InventoryQuery, InventoryPlan } from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import { MetricsService } from '../../shared/operations/metrics.service';
import { PosInventoryRepository } from '../pos-inventory/pos-inventory.repository';
import { InventoryCostingRepository } from './inventory-costing.repository';
import { InventoryCostingService } from './inventory-costing.service';
import { InventoryPlanningService } from './inventory-planning.service';

// Run only against an explicitly configured disposable database, using real RLS roles.
describe('inventory planning and policy lifecycle against PostgreSQL', () => {
  let pg: PgService;
  let repo: PosInventoryRepository;
  let merchantId: string;
  let locationId: string;
  let userId: string;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL_APP || !process.env.DATABASE_URL_WORKER)
      throw new Error('Set disposable app and worker database URLs');
    pg = new PgService({ get: (key: string) => process.env[key] } as never);
    await pg.onModuleInit();
    repo = new PosInventoryRepository(pg);
  });
  beforeEach(async () => {
    merchantId = randomUUID();
    locationId = randomUUID();
    userId = randomUUID();
    await pg.query(
      `INSERT INTO merchant.merchant(id,name,handle,currency,timezone) VALUES($1,'Planning test',$2,'MXN','America/Mazatlan')`,
      [merchantId, `planning-${merchantId}`],
    );
    await pg.query(
      `INSERT INTO merchant.location(id,merchant_id,name) VALUES($1,$2,'Test branch')`,
      [locationId, merchantId],
    );
    await pg.query(`INSERT INTO umi."user"(id,full_name) VALUES($1,'Planning test owner')`, [
      userId,
    ]);
  });
  afterAll(async () => {
    await pg?.onModuleDestroy();
  });
  const overview = () =>
    repo.overview(
      userId,
      merchantId,
      InventoryQuery.parse({ locationId, operatorSessionId: randomUUID() }),
    );
  it('creates one conservative policy and stock area under simultaneous reads', async () => {
    await Promise.all([overview(), overview()]);
    const rows = await pg.query(`SELECT * FROM merchant.inventory_policy WHERE merchant_id=$1`, [
      merchantId,
    ]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({
      default_negative_stock_policy: 'block',
      default_reservation_required: true,
      offline_mutations_allowed: false,
    });
    const areas = await pg.query(
      `SELECT id FROM merchant.inventory_location WHERE merchant_id=$1`,
      [merchantId],
    );
    expect(areas.rowCount).toBe(1);
    const audit = await pg.query(
      `SELECT event_type FROM merchant.audit_event WHERE merchant_id=$1 AND entity_type='inventory_policy'`,
      [merchantId],
    );
    expect(audit.rows).toEqual([{ event_type: 'inventory.policy.created' }]);
  });
  it('keeps current policies unchanged and preserves custom rules when renewing', async () => {
    await overview();
    const original = (
      await pg.query(`SELECT * FROM merchant.inventory_policy WHERE merchant_id=$1`, [merchantId])
    ).rows[0];
    await overview();
    expect(
      (
        await pg.query(`SELECT fingerprint FROM merchant.inventory_policy WHERE merchant_id=$1`, [
          merchantId,
        ])
      ).rows[0].fingerprint,
    ).toBe(original.fingerprint);
    await pg.query(
      `UPDATE merchant.inventory_policy SET issued_at=now()-interval '2 days',expires_at=now()-interval '1 day',default_negative_stock_policy='manager_override',adjustment_approval_threshold=42 WHERE merchant_id=$1`,
      [merchantId],
    );
    await Promise.all([overview(), overview()]);
    const renewed = (
      await pg.query(`SELECT * FROM merchant.inventory_policy WHERE merchant_id=$1`, [merchantId])
    ).rows[0];
    expect(renewed.fingerprint).not.toBe(original.fingerprint);
    await expect(
      repo.mutationApprovalRequirement(userId, merchantId, {
        locationId,
        inventoryLocationId: original.inventory_location_id,
        policyFingerprint: original.fingerprint,
      } as never),
    ).rejects.toMatchObject({ response: { code: 'INVENTORY_POLICY_CHANGED' } });
    expect(renewed.default_negative_stock_policy).toBe('manager_override');
    expect(renewed.adjustment_approval_threshold).toBe('42');
    const audits = await pg.query(
      `SELECT id FROM merchant.audit_event WHERE merchant_id=$1 AND event_type='inventory.policy.renewed'`,
      [merchantId],
    );
    expect(audits.rowCount).toBe(1);
  });
  it('does not provision an unrelated branch', async () => {
    await expect(
      repo.overview(
        userId,
        merchantId,
        InventoryQuery.parse({ locationId: randomUUID(), operatorSessionId: randomUUID() }),
      ),
    ).rejects.toThrow();
    expect(
      (
        await pg.query(`SELECT id FROM merchant.inventory_policy WHERE merchant_id=$1`, [
          merchantId,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it('runs all planning queries under RLS and withholds estimates for an empty business', async () => {
    const costingRepo = new InventoryCostingRepository(pg);
    const costing = new InventoryCostingService(costingRepo, new MetricsService());
    const planning = new InventoryPlanningService(pg, costingRepo, costing, {
      get: () => false,
    } as never);
    const plan = await planning.plan(
      { merchantId, locationId, permissions: ['merchant.manage'] } as never,
      {},
    );
    expect(InventoryPlan.parse(plan)).toMatchObject({
      merchantId,
      locationId,
      complete: false,
      products: [],
      items: [],
      notifications: { emailOptIn: false },
    });
    expect(plan.warnings).toContain('purchase_days_not_configured');
  });
});
