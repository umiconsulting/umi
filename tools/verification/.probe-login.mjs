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
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:4000/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(1000);
console.log('LOGIN TEXT', (await page.locator('body').innerText()).slice(0, 400));
await page.locator('input[type=email]').fill('verifier.owner@local.test');
await page.locator('input[type=password]').fill('I1Local2026!');
await page.getByRole('button', { name: /Entrar|Sign in/ }).click();
await page.waitForTimeout(2500);
console.log('AFTER URL', page.url());
console.log('AFTER TEXT', (await page.locator('body').innerText()).slice(0, 1200));
await page.goto('http://127.0.0.1:4000/?home=1&days=30', {
  waitUntil: 'domcontentloaded',
  timeout: 20000,
});
await page.waitForTimeout(3500);
console.log('HOME URL', page.url());
console.log('PRIMARY', await page.locator('.sales-primary').count());
console.log('HOME TEXT', (await page.locator('body').innerText()).slice(0, 1500));
console.log('ERRORS', errors);
await page.screenshot({
  path: '/home/juan/Projects/umiconsulting/umi/.analytics-i1-exec-2f52a6d5-20261115/run/probe-home.png',
  fullPage: true,
});
await context.close();
await browser.close();
