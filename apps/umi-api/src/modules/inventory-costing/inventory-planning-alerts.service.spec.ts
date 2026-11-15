import { describe, expect, it, vi } from 'vitest';
import { InventoryPlanningAlertsService } from './inventory-planning-alerts.service';
function setup({ enabled = true, optIn = true, accepted = true, complete = true } = {}) {
  let claimed = false;
  const owner = {
    merchantId: 'merchant',
    userId: 'owner',
    email: 'owner@example.test',
    name: 'Test',
    timezone: 'America/Mazatlan',
    day: '2026-11-11',
  };
  const pg = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      void params;
      if (sql.includes('SELECT DISTINCT')) return { rows: optIn ? [owner] : [] };
      if (sql.startsWith('INSERT')) {
        if (claimed) return { rows: [] };
        claimed = true;
        return { rows: [{ id: 'delivery' }] };
      }
      return { rows: [] };
    }),
  };
  const config = {
    get: (key: string) =>
      key === 'INVENTORY_PLANNING_EMAIL_ENABLED'
        ? enabled
        : key === 'PUBLIC_DASHBOARD_URL'
          ? 'http://127.0.0.1:4095'
          : 'test',
  };
  const planning = {
    plan: vi.fn(async () => ({
      complete,
      from: '2026-11-11',
      to: '2026-11-12',
      items: [{ suggestedQuantity: 5 }],
    })),
  };
  const email = { send: vi.fn(async () => (accepted ? { messageId: 'provider' } : null)) };
  const service = new InventoryPlanningAlertsService(
    pg as never,
    config as never,
    planning as never,
    email as never,
  );
  return { service, email, pg };
}
describe('owner inventory digest', () => {
  it('claims a daily delivery once across repeated ticks', async () => {
    const { service, email } = setup();
    await service.tick();
    await service.tick();
    expect(email.send).toHaveBeenCalledTimes(1);
  });
  it.each([{ enabled: false }, { optIn: false }, { complete: false }])(
    'does not deliver without gates: %j',
    async (options) => {
      const { service, email } = setup(options);
      await service.tick();
      expect(email.send).not.toHaveBeenCalled();
    },
  );
  it('records an ambiguous provider result without automatically resending', async () => {
    const { service, email, pg } = setup({ accepted: false });
    await service.tick();
    await service.tick();
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(pg.query.mock.calls.some((call) => call[1]?.includes('unknown'))).toBe(true);
  });
});
