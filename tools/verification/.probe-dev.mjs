import { chromium } from '@playwright/test';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'es-MX',
});
await context.addInitScript(() => localStorage.setItem('umi.dashboard.locale', 'es'));
const page = await context.newPage();
const errs = [];
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text());
});
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:4002/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2000);
console.log('URL', page.url());
console.log('TEXT', (await page.locator('body').innerText()).slice(0, 500));
if (await page.locator('input[type=email]').count()) {
  await page.locator('input[type=email]').fill('verifier.owner@local.test');
  await page.locator('input[type=password]').fill('I1Local2026!');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForTimeout(2500);
}
await page.goto('http://127.0.0.1:4002/?home=1&days=30', {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
});
await page.waitForTimeout(4000);
console.log('HOME', page.url(), 'primary', await page.locator('.sales-primary').count());
console.log('TEXT', (await page.locator('body').innerText()).slice(0, 800));
console.log('ERRS', errs);
await page.screenshot({
  path: '/home/juan/Projects/umiconsulting/umi/.analytics-i1-exec-2f52a6d5-20261115/run/probe-dev.png',
  fullPage: true,
});
await context.close();
await browser.close();
