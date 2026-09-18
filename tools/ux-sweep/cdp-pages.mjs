/**
 * List what the CDP browser currently has open.
 *
 * A quick diagnostic for the sweep harnesses: they attach to a browser somebody
 * else owns, so "the navigation timed out" is usually about the state of that
 * browser rather than about the server.
 */
import { chromium } from '@playwright/test';

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const CLOSE_STALE = process.argv.includes('--close-stale');

const browser = await chromium.connectOverCDP(CDP);
const contexts = browser.contexts();
console.log(`contexts: ${contexts.length}`);
let n = 0;
let closed = 0;
for (const [ci, context] of contexts.entries()) {
  for (const page of context.pages()) {
    n += 1;
    let title = '';
    let url = page.url();
    try {
      title = await page.title();
    } catch {
      title = '(title unavailable)';
    }
    // `:4002` is the Flutter WEB build of the POS, which the plan retired
    // (docs/architecture/2026-09-16-pos-is-a-native-app.md). A tab still pointed
    // at it is a leftover of a harness run against an artifact that is not the
    // product, and it keeps costing memory and pointer focus.
    const stale = /:4002(\/|$)/.test(url);
    console.log(
      `  ctx${ci} page${n}  ${url}\n            title=${JSON.stringify(title)}${stale ? '   [STALE web POS]' : ''}`,
    );
    if (CLOSE_STALE && stale) {
      await page.close();
      closed += 1;
    }
  }
}
if (n === 0) console.log('  (no pages)');
if (CLOSE_STALE) console.log(`closed ${closed} stale page(s)`);
await browser.close();
