import { test as base, expect, chromium } from '@playwright/test';
import process from 'node:process';
import {
  replacementRecovery,
  staleRecovery,
  translatedError,
} from './recipe-sales-recovery-scenarios.js';

const test = base.extend({
  recipePage: async ({ browserName }, run) => {
    expect(browserName).toBe('chromium');
    const cdp = process.env.UMI_INVENTORY_CDP;
    const browser = cdp ? await chromium.connectOverCDP(cdp) : await chromium.launch();
    const context = cdp ? browser.contexts()[0] : await browser.newContext();
    const page = await context.newPage();
    await run(page);
    await page.close();
    if (!cdp) await browser.close();
  },
});

test('retries the exact confirmed replacement with its retained command identity', async ({
  recipePage: page,
  baseURL,
}) => {
  await replacementRecovery(page, baseURL);
});

test('reloads a stale recipe and saves with the new version', async ({
  recipePage: page,
  baseURL,
}) => {
  await staleRecovery(page, baseURL);
});

test('shows the Spanish domain error and keeps the draft editable', async ({
  recipePage: page,
  baseURL,
}) => {
  await translatedError(page, baseURL);
});
