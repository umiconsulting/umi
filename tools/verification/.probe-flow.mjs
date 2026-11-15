import { chromium } from '@playwright/test';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'es-MX',
});
await context.addInitScript(() => {
  try {
    localStorage.setItem('umi.dashboard.locale', 'es');
  } catch {}
});
const page = await context.newPage();
const reqs = [];
page.on('request', (r) => {
  if (r.url().includes('/api/')) reqs.push(r.url());
});
await page.goto('http://127.0.0.1:4000/login', { waitUntil: 'domcontentloaded' });
await page.locator('input[type=email]').fill('verifier.owner@local.test');
await page.locator('input[type=password]').fill('I1Local2026!');
await page.getByRole('button', { name: 'Entrar' }).click();
await page.waitForTimeout(2000);
reqs.length = 0;
await page.goto('http://127.0.0.1:4000/?home=1&days=30', { waitUntil: 'domcontentloaded' });
await page.locator('.sales-primary').waitFor({ state: 'visible', timeout: 20000 });
await page.waitForTimeout(1200);
console.log('URL', page.url());
console.log('PRIMARY_TEXT', JSON.stringify(await page.locator('.sales-primary').innerText()));
console.log(
  'SALES_REGION',
  await page.locator('.sales-region').count(),
  await page
    .locator('[class*=sales]')
    .evaluateAll((els) => [...new Set(els.map((e) => e.className))].slice(0, 40)),
);
console.log('BUTTONS', await page.getByRole('button').allInnerTexts());
console.log('LINKS', await page.getByRole('link').allInnerTexts());
console.log('REQS', reqs);
console.log('BODY', (await page.locator('body').innerText()).slice(0, 3500));
await page.screenshot({
  path: '/home/juan/Projects/umiconsulting/umi/.analytics-i1-exec-2f52a6d5-20261115/run/probe-home2.png',
  fullPage: true,
});
// click primary
await page.locator('.sales-primary').click();
await page.waitForURL(/analisis|sales|reportes/, { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(2500);
console.log('DETAIL_URL', page.url());
console.log('DETAIL_BODY', (await page.locator('body').innerText()).slice(0, 2500));
console.log(
  'DETAIL_CLASSES',
  await page
    .locator('[class*=analysis]')
    .evaluateAll((els) => [...new Set(els.map((e) => e.className))].slice(0, 30)),
);
await page.screenshot({
  path: '/home/juan/Projects/umiconsulting/umi/.analytics-i1-exec-2f52a6d5-20261115/run/probe-detail.png',
  fullPage: true,
});
await context.close();
await browser.close();
