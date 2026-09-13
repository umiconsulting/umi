import { test, expect } from '@playwright/test';

const merchantId = '11111111-1111-4111-8111-111111111111';
const locationId = '22222222-2222-4222-8222-222222222222';

async function openEditor(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const server = {
    state: {
      locationId,
      version: 0,
      draft: null,
      publishedVersion: 0,
      published: null,
      publishedAt: null,
    },
    writes: [],
    delay: 0,
  };
  await page.addInitScript(() => {
    localStorage.setItem('umi.dashboard.locale', 'en');
    localStorage.setItem(
      'umi-dashboard-local-session',
      JSON.stringify({
        user: { id: '33333333-3333-4333-8333-333333333333', displayName: 'Test owner' },
        accessExpiresAt: Date.now() + 3600000,
      }),
    );
  });
  // Every API response is local to this test. No business records are changed.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/me/merchants'))
      return route.fulfill({ json: { merchants: [{ id: merchantId, name: 'Test café' }] } });
    if (url.pathname.endsWith('/capabilities'))
      return route.fulfill({
        json: {
          merchant: { id: merchantId, name: 'Test café' },
          locations: [{ id: locationId, name: 'Centro', status: 'active' }],
          selectedLocation: { id: locationId, name: 'Centro', status: 'active' },
          canSwitchLocations: true,
          membership: { permissions: ['merchant.manage'], role: 'owner' },
          products: { dashboard: { status: 'active' } },
        },
      });
    if (url.pathname.includes('/floor-plan')) {
      if (request.method() !== 'GET') {
        const body = request.postDataJSON();
        expect(body.expectedVersion).toBe(server.state.version);
        server.writes.push(body);
        server.state = { ...server.state, version: server.state.version + 1 };
        if (body.document) server.state.draft = body.document;
        else
          server.state = {
            ...server.state,
            published: structuredClone(server.state.draft),
            publishedVersion: server.state.version,
            publishedAt: new Date().toISOString(),
          };
        if (server.delay) await new Promise((resolve) => setTimeout(resolve, server.delay));
      }
      return route.fulfill({ json: server.state });
    }
    if (request.method() !== 'GET') throw new Error(`Unexpected write: ${url.pathname}`);
    return route.fulfill({ json: {} });
  });
  await page.goto('/floor-plan');
  await expect(page.getByRole('button', { name: 'Round table', exact: true })).toBeVisible();
  return { server, errors };
}

async function geometry(page, label) {
  return page.evaluate((label) => {
    const stage = window.Konva.stages[0];
    const node = stage.find('Group').find((node) => node.findOne('Text')?.text() === label);
    const origin = stage.container().getBoundingClientRect();
    const position = node.getAbsolutePosition();
    return {
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
      screenX: origin.x + position.x,
      screenY: origin.y + position.y,
      scale: stage.scaleX(),
    };
  }, label);
}

async function assertSaved(page, server, label) {
  await expect(page.getByText('Draft saved', { exact: true })).toBeVisible();
  const saved = server.state.draft.areas[0].elements.find((item) => item.label === label);
  const node = await geometry(page, label);
  expect(node).toMatchObject({
    x: saved.x,
    y: saved.y,
    rotation: saved.rotation,
    scaleX: 1,
    scaleY: 1,
  });
  return saved;
}

test('rotation and consecutive drags keep one geometry through zoom and publication', async ({
  page,
}) => {
  const { server, errors } = await openEditor(page);
  await page.getByRole('button', { name: 'Rectangular table', exact: true }).click();
  await assertSaved(page, server, 'T1');
  const initialWrites = server.writes.length;
  const center = await geometry(page, 'T1');
  const handle = await page.evaluate(() => {
    const stage = window.Konva.stages[0];
    const node = stage.findOne('Transformer').findOne('.rotater');
    const p = node.getAbsolutePosition();
    const r = stage.container().getBoundingClientRect();
    return { x: r.x + p.x, y: r.y + p.y };
  });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(
    center.screenX - (handle.y - center.screenY),
    center.screenY + (handle.x - center.screenX),
    { steps: 12 },
  );
  await page.waitForTimeout(1100);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
  expect(server.writes).toHaveLength(initialWrites);
  await page.mouse.up();
  expect((await geometry(page, 'T1')).rotation).toBe(90);
  for (const distance of [40, 60]) {
    const start = await geometry(page, 'T1');
    await page.mouse.move(start.screenX, start.screenY);
    await page.mouse.down();
    await page.mouse.move(start.screenX - distance, start.screenY, { steps: 6 });
    await page.waitForTimeout(1100);
    expect(server.writes).toHaveLength(initialWrites);
    await page.mouse.up();
  }
  const saved = await assertSaved(page, server, 'T1');
  expect(saved.rotation).toBe(90);
  expect(server.writes).toHaveLength(initialWrites + 1);
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('0.5');
  expect(await geometry(page, 'T1')).toMatchObject({ x: saved.x, y: saved.y, rotation: 90 });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View published', exact: true })).toBeEnabled();
  expect(server.state.published.areas[0].elements[0]).toEqual(saved);
  expect(errors).toEqual([]);
});

test('a long drag pauses autosave and publishes the visible coordinates', async ({ page }) => {
  const { server, errors } = await openEditor(page);
  await page.getByRole('button', { name: 'Round table', exact: true }).click();
  const start = await geometry(page, 'T1');
  await page.mouse.move(start.screenX, start.screenY);
  await page.mouse.down();
  await page.mouse.move(start.screenX - 120, start.screenY - 50, { steps: 8 });
  // Cross the autosave deadline while the pointer remains down.
  await page.waitForTimeout(1200);
  expect(server.writes).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
  await page.mouse.move(start.screenX - 150, start.screenY - 60, { steps: 4 });
  await page.mouse.up();
  const saved = await assertSaved(page, server, 'T1');
  expect(saved.x).not.toBe(start.x);
  expect(saved.x % 20).toBe(0);
  await expect(page.getByLabel('X position', { exact: true })).toHaveValue(String(saved.x));

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await geometry(page, 'T1')).toMatchObject({ x: start.x, y: start.y });
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await assertSaved(page, server, 'T1');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View published', exact: true })).toBeEnabled();
  expect(server.state.published.areas[0].elements[0]).toEqual(saved);
  await page.getByRole('button', { name: 'View published', exact: true }).click();
  expect(await geometry(page, 'T1')).toMatchObject({ x: saved.x, y: saved.y });
  await page.reload();
  await expect(page.getByRole('button', { name: 'T1 · 4', exact: true })).toBeVisible();
  expect(await geometry(page, 'T1')).toMatchObject({ x: saved.x, y: saved.y });
  expect(errors).toEqual([]);
});

test('snapping to the existing position reconciles the canvas without an extra save', async ({
  page,
}) => {
  const { server, errors } = await openEditor(page);
  await page.getByRole('button', { name: 'Round table', exact: true }).click();
  await assertSaved(page, server, 'T1');
  const writes = server.writes.length;
  const start = await geometry(page, 'T1');
  await page.mouse.move(start.screenX, start.screenY);
  await page.mouse.down();
  await page.mouse.move(start.screenX + 8 * start.scale, start.screenY, { steps: 4 });
  await page.mouse.up();
  expect(await geometry(page, 'T1')).toMatchObject({ x: start.x, y: start.y });
  await page.waitForTimeout(1100);
  expect(server.writes).toHaveLength(writes);
  expect(errors).toEqual([]);
});

test('a long resize normalizes scale and locks edits during a delayed save', async ({ page }) => {
  const { server, errors } = await openEditor(page);
  server.delay = 1500;
  await page.getByRole('button', { name: 'Rectangular table', exact: true }).click();
  const before = await geometry(page, 'T1');
  const anchor = await page.evaluate(() => {
    const stage = window.Konva.stages[0];
    const node = stage.findOne('Transformer').findOne('.bottom-right');
    const p = node.getAbsolutePosition();
    const r = stage.container().getBoundingClientRect();
    return { x: r.x + p.x, y: r.y + p.y };
  });
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  await page.mouse.move(anchor.x + 70, anchor.y + 40, { steps: 8 });
  await page.waitForTimeout(1200);
  expect(server.writes).toHaveLength(0);
  await page.mouse.up();
  await expect(page.getByText('Saving…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
  const duringSave = await geometry(page, 'T1');
  await page.mouse.move(duringSave.screenX, duringSave.screenY);
  await page.mouse.down();
  await page.mouse.move(duringSave.screenX + 30, duringSave.screenY + 30, { steps: 4 });
  await page.mouse.up();
  expect(await geometry(page, 'T1')).toMatchObject({ x: duringSave.x, y: duringSave.y });
  const saved = await assertSaved(page, server, 'T1');
  expect(saved.width).toBeGreaterThan(100);
  expect(saved.height).toBeGreaterThan(70);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await geometry(page, 'T1')).toMatchObject({
    x: before.x,
    y: before.y,
    scaleX: 1,
    scaleY: 1,
  });
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('100');
  await expect(page.getByLabel('Height', { exact: true })).toHaveValue('70');
  expect(errors).toEqual([]);
});
