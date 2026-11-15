import { test, expect } from '@playwright/test';

async function openSettings(page, options = {}) {
  const id = '11111111-1111-4111-8111-111111111111';
  const state = { days: [], writes: [], fail: false, ...options };
  await page.addInitScript(() => {
    localStorage.setItem('umi.dashboard.locale', 'es');
    localStorage.setItem(
      'umi-dashboard-local-session',
      JSON.stringify({
        user: { id: '33333333-3333-4333-8333-333333333333', displayName: 'Test owner' },
        accessExpiresAt: Date.now() + 3600000,
      }),
    );
  });
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith('/me/merchants'))
      return route.fulfill({ json: { merchants: [{ id, name: 'Test café' }] } });
    if (path.endsWith('/capabilities'))
      return route.fulfill({
        json: {
          merchant: { id, name: 'Test café' },
          membership: { permissions: ['merchant.manage'], role: 'owner' },
          products: { dashboard: { status: 'active' } },
          locations: [],
        },
      });
    if (path.endsWith('/settings')) {
      if (req.method() === 'PATCH') {
        state.writes.push(req.postDataJSON());
        if (state.fail) return route.fulfill({ status: 500, json: { message: 'Save failed' } });
        state.days = req.postDataJSON().purchaseDays;
      }
      return route.fulfill({ json: { name: 'Test café', purchaseDays: state.days } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/settings');
  const form = page.getByRole('region', { name: 'Días de compra' });
  await expect(form.getByRole('checkbox', { name: 'Lunes' })).toBeVisible();
  return { form, state };
}

test('saves only purchaseDays, cancels locally, and survives reload', async ({ page }) => {
  const { form, state } = await openSettings(page);
  await expect(form.getByText('Sin configurar')).toBeVisible();
  await form.getByRole('checkbox', { name: 'Lunes' }).check();
  await form.getByRole('button', { name: 'Cancelar' }).click();
  expect(state.writes).toEqual([]);
  await expect(form.getByRole('checkbox', { name: 'Lunes' })).not.toBeChecked();
  await form.getByRole('checkbox', { name: 'Lunes' }).check();
  await form.getByRole('checkbox', { name: 'Domingo' }).check();
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(form.getByText('Cambios guardados')).toBeVisible();
  expect(state.writes).toEqual([{ purchaseDays: [0, 1] }]);
  await page.reload();
  await expect(form.getByRole('checkbox', { name: 'Domingo' })).toBeChecked();
  await form.getByRole('checkbox', { name: 'Domingo' }).uncheck();
  await form.getByRole('checkbox', { name: 'Lunes' }).uncheck();
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect.poll(() => state.days).toEqual([]);
});

test('retains the draft after a failed save and fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { form, state } = await openSettings(page, { fail: true });
  await form.getByRole('checkbox', { name: 'Martes' }).check();
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(form.getByRole('checkbox', { name: 'Martes' })).toBeChecked();
  state.fail = false;
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(form.getByText('Cambios guardados')).toBeVisible();
  expect(await form.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});
