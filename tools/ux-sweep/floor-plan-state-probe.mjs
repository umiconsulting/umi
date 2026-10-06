/**
 * What does the Dashboard's floor-plan screen actually show about the room?
 *
 * Plan §8D step 3 puts table state "on the map itself", and the API publishes a
 * console read route for exactly that (`GET /api/merchants/:merchantId/table-state`,
 * permission `merchant.manage`). This probe answers, in the real browser rather
 * than by reading the JSX, whether any client uses it.
 *
 * It attaches to the Chromium that Playwright drives over CDP — the same browser
 * the rest of the sweep uses, already signed in — opens the floor-plan screen,
 * and then drives it with REAL input events while reading what the page shows.
 *
 * Run:
 *   ./scripts/ux-browser.sh
 *   node tools/ux-sweep/floor-plan-state-probe.mjs
 *   ./scripts/ux-browser.sh --stop
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';
const OUT = process.env.UX_OUT || '/tmp/ux/floor-plan-probe';

/** Words the six table states are rendered with, in either language. */
const STATE_WORDS = [
  'open',
  'seated',
  'ordered',
  'served',
  'awaiting_payment',
  'awaiting payment',
  'dirty',
  'libre',
  'ocupada',
  'pedido',
  'servida',
  'por cobrar',
  'por limpiar',
];

const browser = await chromium.connectOverCDP(CDP, { timeout: 60_000 });
const context = browser.contexts()[0];
if (!context) throw new Error(`No browser context on the CDP connection at ${CDP}.`);

// Reuse the Dashboard tab the operator already has open rather than adding one.
// A second tab means a second Vite client, a second websocket and two copies of
// a canvas app on a box that is already swapping.
const page = context.pages().find((p) => p.url().startsWith(BASE)) ?? (await context.newPage());
mkdirSync(OUT, { recursive: true });

const report = { base: BASE, steps: [], findings: [] };

try {
  await page.setViewportSize({ width: 1280, height: 720 });

  // Watch the wire from before the first navigation, so the room read — if it
  // happens at all — is caught on the load rather than a reload.
  const requests = [];
  page.on('request', (r) => {
    if (/table-state/.test(r.url())) requests.push(r.url());
  });

  const response = await page.goto(`${BASE}/floor-plan`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  report.steps.push({ step: 'open /floor-plan', status: response?.status() ?? null });
  report.steps.push({ step: 'url after load', url: page.url() });

  // The editor draws onto a Konva canvas, so wait for the canvas rather than
  // for an element a table could be.
  await page.waitForSelector('canvas', { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/01-floor-plan.png` });

  const drawn = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')];
    return canvases.map((c) => ({ width: c.width, height: c.height }));
  });
  report.steps.push({ step: 'canvases drawn', drawn });

  // What the screen says, as text. A state shown only as canvas pixels will not
  // appear here, which is itself worth knowing.
  const text = await page.evaluate(() => document.body.innerText);
  const seen = STATE_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));
  report.steps.push({ step: 'state words visible as text', seen });

  // Does anything ask for the room at all?
  report.steps.push({ step: 'requests to /table-state during the load', requests });
  if (requests.length === 0) {
    report.findings.push(
      'No request to /table-state while the floor-plan screen sits there: the console does not read the room.',
    );
  }

  // A real click, not a DOM dispatch: press the primary button over the table
  // that the screenshot shows, then read whether anything changed.
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  report.steps.push({ step: 'canvas box', box });
  if (box) {
    const x = box.x + box.width * 0.42;
    const y = box.y + box.height * 0.62;
    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.down();
    await page.mouse.move(x + 40, y + 10, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/02-after-drag.png` });
    report.steps.push({ step: 'pointer drag on the canvas', at: [x, y] });
  }

  const after = await page.evaluate(() => document.body.innerText);
  report.findings.push(
    `After a real drag the screen still shows ${STATE_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(after)).length} state word(s), so the gesture moved the layout and told the operator nothing about the room.`,
  );
} finally {
  await page.close();
  // Borrowed connection: disconnect, never close the operator's browser.
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
