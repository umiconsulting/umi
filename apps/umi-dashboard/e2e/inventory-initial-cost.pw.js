import { test, expect, chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { verifyInitialCost } from './inventory-initial-cost-scenarios.js';

test('initial cost persists and real purchases take priority', async ({
  browserName,
}, testInfo) => {
  test.setTimeout(120000);
  test.skip(
    !process.env.UMI_INITIAL_COST_FIXTURE,
    'Requires an isolated local API fixture and a signed-in CDP browser.',
  );
  expect(browserName).toBe('chromium');
  const fixture = JSON.parse(readFileSync(process.env.UMI_INITIAL_COST_FIXTURE, 'utf8'));
  const browser = await chromium.connectOverCDP(
    process.env.UMI_INVENTORY_CDP || 'http://127.0.0.1:9225',
  );
  const page = await browser.contexts()[0].newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(process.env.UMI_INITIAL_COST_BASE || 'http://127.0.0.1:4043/inventory');
    await verifyInitialCost({ page, fixture, expect, evidenceDir: testInfo.outputDir });
  } finally {
    await page.close();
  }
});
