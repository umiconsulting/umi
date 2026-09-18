/**
 * Visual regression for the Dashboard.
 *
 * Plan §7 Step F3: pin one viewport pair and fail when a shared style change
 * moves the wrong screens. The pair is the reference hardware from §4 — the
 * café tablet at 1024 x 768 and the counter terminal at 1280 x 720.
 *
 * The route list is deliberately small. The shell (sidebar, topbar, cards)
 * repeats on every route, so six screens prove the same thing without checking
 * in two images per screen that mostly differ by their table contents:
 *
 *   /                   the owner's first screen and the hero metrics
 *   /operations         the operational bridge, densest form surface
 *   /reportes           the reporting surface
 *   /catalog-inventory  the longest lists, the most repeated row markup
 *   /floor-plan         a canvas the shell does not otherwise draw, and the one
 *                       lazy route — its chunk, its toolbar and its palette
 *   /login              the unauthenticated surface, no shell at all
 *
 * Run:
 *   pnpm ux:visual              # compare against the checked-in baselines
 *   pnpm ux:visual:update       # re-record the baselines
 *
 * Requires the same logged-in Chromium on CDP that the other harnesses use.
 */

import { chromium, expect, test as base } from '@playwright/test';

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';

const ROUTES = [
  { name: 'overview', path: '/' },
  { name: 'operations', path: '/operations' },
  { name: 'reportes', path: '/reportes' },
  { name: 'catalog-inventory', path: '/catalog-inventory' },
  { name: 'floor-plan', path: '/floor-plan' },
  { name: 'login', path: '/login' },
];

/** The reference hardware from §4 of the plan. */
const VIEWPORTS = [
  { name: 'tablet-1024x768', width: 1024, height: 768 },
  { name: 'terminal-1280x720', width: 1280, height: 720 },
];

/**
 * Attach to the operator's browser instead of launching one, so the Dashboard
 * is already signed in and the baselines match what the operator sees.
 * `UX_VISUAL_LAUNCH=1` launches a throwaway Chromium instead — useful if the
 * CDP browser is gone, and it then needs UX_STORAGE_STATE to have a session.
 */
const test = base.extend({
  browser: [
    async ({}, use) => {
      if (process.env.UX_VISUAL_LAUNCH === '1') {
        const browser = await chromium.launch();
        await use(browser);
        await browser.close();
        return;
      }
      const browser = await chromium.connectOverCDP(CDP);
      // The connection is to a browser someone else owns. Disconnecting must
      // not close it, so this is treated as a borrow, not a launch.
      await use(browser);
    },
    { scope: 'worker' },
  ],
  context: async ({ browser }, use) => {
    if (process.env.UX_VISUAL_LAUNCH === '1') {
      const context = await browser.newContext({
        storageState: process.env.UX_STORAGE_STATE || undefined,
      });
      await use(context);
      await context.close();
      return;
    }
    const context = browser.contexts()[0];
    if (!context) throw new Error(`No browser context on the CDP connection at ${CDP}.`);
    await use(context);
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
});

/**
 * Mark text that is expected to change between two runs of the same screen —
 * clocks, relative durations, live counters. Marking is done from here rather
 * than from app code so the regression harness cannot quietly relax the product.
 */
async function maskVolatile(page) {
  await page.evaluate(() => {
    // Volatile text: a clock, a live marker, or the CONNECTIVITY STATE.
    //
    // The connectivity chip reads `Online` when the API answers and
    // `Offline · Retry` when it does not, so it is a value that changes on its
    // own - and it was being pinned into every baseline. That made the gate
    // flaky in the worst way: `overview` failed on a transient the screen does
    // not own, and a baseline recorded while the API was down would have frozen
    // "Offline" as the expected render.
    const VOLATILE =
      /\b\d{1,2}:\d{2}(:\d{2})?\b|\bhace\b|\bEN VIVO\b|\bLIVE\b|\bONLINE\b|\bOFFLINE\b|\bRETRY\b|\bSIN CONEXI[ÓO]N\b|\bEN L[ÍI]NEA\b|\bCONECTANDO\b/i;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const marked = new Set();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.textContent || '').trim();
      if (!text || !VOLATILE.test(text)) continue;
      const el = node.parentElement?.closest('span, div, td, th, li, p, time, strong, b, em');
      if (el && !marked.has(el)) {
        el.setAttribute('data-ux-volatile', '1');
        marked.add(el);
      }
    }
  });
}

/**
 * Pin the theme for the screenshot.
 *
 * The theme is a stored preference (`umi-theme`) that resolves through the OS
 * when unset, and this browser is shared with people who toggle it. Without
 * pinning, two runs of the same screen differ by palette and the check reports a
 * style regression that is not one. The baselines record the default palette.
 */
async function pinTheme(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('umi-theme', 'umi');
    } catch {
      // Storage can be blocked; emulateMedia below still fixes the OS side.
    }
  });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

/**
 * Pin the locale for the screenshot, for the same reason as the theme.
 *
 * The language is a stored preference (`umi.dashboard.locale`) that falls back to
 * the browser's `navigator.language` and then to Spanish, and the café record's
 * own locale can override the browser while nobody has chosen yet. This browser is
 * shared with people who switch it, so without a pin the same screen renders in a
 * different language between two runs and the check reports a style regression
 * that is not one. It is a real false failure: with the preference set to `es`
 * this spec failed four of its ten baselines and passed all ten when it was
 * unset.
 *
 * The pin is `en` because that is what the recorded baselines contain — they were
 * taken with the preference unset and the reference browser reporting `en-US`.
 * Pinning the language the baselines already have keeps them valid; re-recording
 * them in Spanish is a separate decision about the product's screenshots, not a
 * harness fix. Writing the preference is also what closes the second
 * nondeterminism: `applyMerchantLocale` follows the café record only while no
 * choice is stored, so a stored one pins that path too.
 */
async function pinLocale(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('umi.dashboard.locale', 'en');
    } catch {
      // Storage can be blocked; there is no other place to pin the language from.
    }
  });
}

for (const viewport of VIEWPORTS) {
  for (const route of ROUTES) {
    test(`${route.name} at ${viewport.name}`, async ({ page }) => {
      await pinTheme(page);
      await pinLocale(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
      // WAIT FOR THE SCREEN, NOT FOR THE CLOCK.
      //
      // This used to be `waitForTimeout(2000)`, and a fixed sleep cannot tell a
      // rendered screen from a loading one. The reports baseline was recorded
      // during an outage - `OFFLINE · RETRY`, "The sales report could not be
      // loaded.", an empty body - and a healthy screen two seconds after
      // `domcontentloaded` looks enough like it, under a 2 percent pixel budget
      // and a mostly-white canvas, that the test passed either way. A gate that
      // passes on a screen it never saw is worse than no gate: it would also
      // have passed while the outage was real.
      //
      // The read has landed when the network goes quiet, so that is the signal,
      // bounded. If it never quiets the test FAILS and says which route, because
      // the alternative is pinning whatever happened to be on screen.
      try {
        await page.waitForLoadState('networkidle', { timeout: 20_000 });
      } catch {
        throw new Error(
          `${route.name} never went network-idle at ${viewport.name}: its data had not landed, so a ` +
            'screenshot here would pin a loading frame rather than the screen.',
        );
      }
      // A short settle for the paint the data triggered, not a substitute for it.
      await page.waitForTimeout(400);

      // REFUSE TO PIN A FAILURE.
      //
      // The `reportes` baseline on record is an outage frame - `OFFLINE · RETRY`,
      // "The sales report could not be loaded.", an empty body. It was recorded
      // by hand at some point and every run since has compared against it, so
      // the check was asserting that the screen still looks broken. Nothing
      // stops a person from re-recording a failure either, so the guard belongs
      // here: if the screen is in an error state, this fails and says so.
      const body = await page.evaluate(() => document.body.innerText || '');
      const errorState = body.match(
        // The BODY's failure affordances. The masthead's connectivity chip reads
        // "Offline · Retry" too, and that is a volatile value rather than a
        // failed screen - it is masked above, not treated as a failure here.
        /could not be loaded|could not be [a-z]+ed|failed to load|is unavailable|no se pudo cargar/i,
      );
      if (errorState) {
        throw new Error(
          `${route.name} at ${viewport.name} is showing an error state ("${errorState[0]}"); ` +
            'screenshotting it would pin a failure as the baseline.',
        );
      }

      await maskVolatile(page);

      await expect(page).toHaveScreenshot(`${route.name}-${viewport.name}.png`, {
        mask: [page.locator('[data-ux-volatile]')],
      });
    });
  }
}
