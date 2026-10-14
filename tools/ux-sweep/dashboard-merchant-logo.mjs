/**
 * The café's logo, walked in the real console with real clicks.
 *
 * WHY THIS EXISTS. The API is provable with curl — a PUT stores the bytes, a GET
 * serves them, `merchant.logo_url` moves. What curl cannot show is the part the
 * owner actually does: pick a file in Ajustes, see it appear, and be able to take
 * it away again. Every failure this card can have is a browser failure — a hidden
 * input nobody can open, a preview that never leaves the old picture, a 413 from
 * the edge, an image that 404s through the dev proxy while its URL looks right.
 * So the walk asserts on PIXELS and on what the browser actually fetched, not on
 * the string it was handed.
 *
 * Run:
 *   ./scripts/ux-browser.sh
 *   UX_BASE=http://127.0.0.1:4020 UX_OWNER_EMAIL=owner@umipos.local \
 *     UX_OWNER_PASSWORD='...' \
 *     node tools/ux-sweep/dashboard-merchant-logo.mjs /tmp/umi-logo-b.png [outDir]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';
const EMAIL = process.env.UX_OWNER_EMAIL || '';
const PASSWORD = process.env.UX_OWNER_PASSWORD || '';
const LOGO = process.argv[2] || '/tmp/umi-logo-b.png';
const OUT = process.argv[3] || process.env.UX_OUT || '/tmp/ux/dashboard-merchant-logo';

const CARDS = /Logo del negocio|Business logo/;
const UPLOAD = /Subir logo|Upload logo|Cambiar logo|Change logo/;
const REMOVE = /Quitar logo|Remove logo/;
const UPDATED = /Logo actualizado|Logo updated/;
const NO_LOGO = /Sin logo|No logo/;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const say = (line) => process.stdout.write(`${line}\n`);
mkdirSync(OUT, { recursive: true });

const steps = [];
const record = (step, detail) => {
  steps.push({ step, ...detail });
  say(`${detail.ok === false ? '✗' : '✓'} ${step}${detail.note ? ` — ${detail.note}` : ''}`);
};

const browser = await chromium.connectOverCDP(CDP, { timeout: 60_000 });
const context = browser.contexts()[0];
if (!context) throw new Error(`No browser context on the CDP connection at ${CDP}.`);
const page = await context.newPage();
await page.setViewportSize({ width: 1280, height: 800 });

/**
 * The preview image's own identity: the URL it shows and whether it truly loaded.
 *
 * SCOPED TO THE CARD, and it did not used to be. This asked the whole document for
 * an `img` whose src mentions `/logos/`, which any OTHER image on the screen can
 * satisfy — the Wallet pass preview falls back to a static `/logos/{handle}-…png`
 * when the café has no logo, so "remove the logo" reported a failure while the card
 * was, in fact, showing `Sin logo` (measured 2026-10-11: the DELETE answered 200 and
 * the screenshot showed the empty frame). A walk that fails on a step that passed is
 * worse than no walk: it teaches everyone to ignore the red.
 *
 * The card is found by its own heading and taken up to the box that owns the file
 * input, which is the one element on this screen that is only ever the logo card.
 */
async function previewState() {
  return page.evaluate(() => {
    const heading = [...document.querySelectorAll('*')].find(
      (el) =>
        el.children.length === 0 &&
        /^(Logo del negocio|Business logo)$/.test((el.textContent || '').trim()),
    );
    let box = heading;
    while (box && !box.querySelector('input[type="file"]')) box = box.parentElement;
    const logo = box ? box.querySelector('img') : null;
    if (!logo) return { url: null, loaded: false };
    return {
      url: logo.getAttribute('src'),
      loaded: logo.complete && logo.naturalWidth > 0,
      width: logo.naturalWidth,
      height: logo.naturalHeight,
    };
  });
}

try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await sleep(1500);

  const signIn = async () => {
    const password = page.locator('#login-pw, input[type="password"]');
    if ((await password.count()) === 0) return false;
    if (!EMAIL || !PASSWORD)
      throw new Error('The console is signed out and no credentials were given.');
    await page.locator('#login-email, input[type="email"]').first().fill(EMAIL);
    await password.first().fill(PASSWORD);
    await page
      .getByRole('button', { name: /entrar|sign in|iniciar|continuar|log in/i })
      .first()
      .click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(2500);
    return true;
  };

  const signedIn = await signIn();
  record('sign in', {
    ok: true,
    note: signedIn ? 'typed a credential' : 'session was already live',
  });

  // Ajustes, by its nav entry and then by what only that screen shows.
  await page
    .locator('nav button, nav a, aside button, aside a')
    .filter({ hasText: /Ajustes|Settings/ })
    .first()
    .click();
  await sleep(2500);
  const heading = page.getByRole('heading', { name: CARDS }).first();
  await heading.scrollIntoViewIfNeeded();
  await sleep(600);
  record('open Ajustes and find the card', {
    ok: (await heading.count()) > 0,
    note: `at ${BASE}/ajustes`,
  });
  await page.screenshot({ path: `${OUT}/00-before.png` });

  const before = await previewState();

  // ── the picture is on screen BEFORE its bytes finish travelling ───────────
  //
  // The owner's question, and the reason this step exists: the card used to say
  // `Subiendo…` next to the OLD mark (or an empty frame) until the request came
  // back, so an owner who picked the wrong file had nothing to correct against. The
  // upload is held open here so the pending state can be observed at all — a fast
  // local PUT would be over before a screenshot.
  let releaseUpload;
  const holdUpload = new Promise((resolve) => {
    releaseUpload = resolve;
  });
  await page.route('**/branding/logo', async (route) => {
    // Held only while the promise is pending, and it is resolved below: the later
    // re-uploads in this walk pass straight through. The route is deliberately NOT
    // removed mid-flight — `unroute` while a handler is still awaiting its own
    // `continue()` throws `Route is already handled`.
    if (route.request().method() === 'PUT') await holdUpload;
    await route.continue().catch(() => {});
  });
  await page.locator('input[type="file"]').last().setInputFiles(LOGO);
  await sleep(400);
  const inFlight = await previewState();
  record('the picked file shows while its bytes travel', {
    ok: Boolean(inFlight.url) && inFlight.url.startsWith('blob:') === true && inFlight.loaded,
    note: inFlight.url
      ? `${inFlight.url.slice(0, 24)}… ${inFlight.width}×${inFlight.height}`
      : 'nothing on screen',
  });
  await page.screenshot({ path: `${OUT}/00b-uploading.png` });
  releaseUpload();

  // ── upload ────────────────────────────────────────────────────────────────
  await page.waitForFunction(
    (previousUrl) => {
      const img = [...document.querySelectorAll('img')].find((i) =>
        /\/logos\//.test(i.getAttribute('src') || ''),
      );
      return Boolean(img) && img.getAttribute('src') !== previousUrl;
    },
    before.url,
    { timeout: 30_000 },
  );
  await sleep(1500);
  const after = await previewState();
  record('upload the logo through the card', {
    ok: Boolean(after.url) && after.url !== before.url && after.loaded,
    note: `${LOGO} → ${after.url}${after.loaded ? ` (${after.width}×${after.height} rendered)` : ' (NOT LOADED)'}`,
  });
  const updated = page.getByText(UPDATED).first();
  record('the card says it saved', { ok: (await updated.count()) > 0 });
  await page.screenshot({ path: `${OUT}/01-after-upload.png` });

  // ── remove ────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: REMOVE }).first().click();
  await sleep(2500);
  const cleared = await previewState();
  record('remove the logo', {
    ok: cleared.url === null && (await page.getByText(NO_LOGO).first().count()) > 0,
    note: 'the preview goes back to Sin logo',
  });
  await page.screenshot({ path: `${OUT}/02-after-remove.png` });

  // ── and back on, because a card that can only be emptied once is half a card ──
  await page.locator('input[type="file"]').last().setInputFiles(LOGO);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('img')].some(
        (i) => /\/logos\//.test(i.getAttribute('src') || '') && i.complete && i.naturalWidth > 0,
      ),
    null,
    { timeout: 30_000 },
  );
  await sleep(1200);
  const again = await previewState();
  record('upload it a second time', {
    ok: Boolean(again.url) && again.loaded,
    note: again.url,
  });
  await page.screenshot({ path: `${OUT}/03-uploaded-again.png` });
} catch (error) {
  // A WALK THAT CRASHES MUST NOT REPORT SUCCESS.
  //
  // `finally` used to end with `process.exit(0)` whenever no step had been recorded
  // as failed, so an exception anywhere between two steps — a timeout waiting for
  // the preview to change, for instance — printed "2/2 steps passed" and left the
  // reason nowhere. The failure becomes a step of its own, and the verdict follows.
  record('the walk itself', {
    ok: false,
    note: error && error.message ? error.message.split('\n')[0] : String(error),
  });
} finally {
  const failed = steps.filter((step) => step.ok === false);
  writeFileSync(`${OUT}/walk.json`, JSON.stringify({ base: BASE, logo: LOGO, steps }, null, 2));
  await page.close().catch(() => {});
  say(`${steps.length - failed.length}/${steps.length} steps passed; evidence in ${OUT}`);
  // The CDP websocket keeps the event loop alive after the walk is over, and a
  // harness that never returns is a harness nobody runs twice. Closing the
  // CONNECTION (not the browser — it is the operator's) is not enough, so the
  // process states its verdict and leaves.
  process.exit(failed.length > 0 ? 1 : 0);
}
