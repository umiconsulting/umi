/**
 * Does the Costos y márgenes screen read the four costing routes, and does it tell the
 * truth about a number the server did not fully price?
 *
 * WHY THIS EXISTS. The screen's whole reason for existing is D47: the day read once
 * reported cost 0 and a 100 percent margin for a café that had no recipes, because a
 * zero stood in for an unknown. A component test can assert the model returns null; only
 * the real page can show that the null became a NAMED STATE on screen and not a dash, a
 * zero, or a confident percentage.
 *
 * So this probe does what an owner does: opens the console at `/`, CLICKS the nav entry
 * (`Negocio → Costos y márgenes`), and then reads what is on the page — the requests the
 * screen issued, the rows of each table, and whether a row with no cost ever carries a
 * margin. It clicks real elements with real input, over CDP, in a real window.
 *
 * Run:
 *   ./scripts/ux-browser.sh
 *   node tools/ux-sweep/costing-screen-probe.mjs
 *   ./scripts/ux-browser.sh --stop
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';
const OUT = process.env.UX_OUT || '/tmp/ux/costing-probe';
// The nav entry is matched in either language. The console follows the operator's
// language, and a probe that only knew Spanish reported a missing screen the first time
// the profile was set to English.
const NAV_LABEL = new RegExp(process.env.UX_NAV || '^(Costos y márgenes|Costs and margins)$');
/**
 * The branch the sales are at. Two of the four reads are location-scoped, so a day table
 * only appears for the branch that traded: on the rehearsal café everything is at
 * Chapultepec, and the console opens on Congreso.
 */
const BRANCH = process.env.UX_BRANCH || 'Chapultepec';
/**
 * A plate whose recipe exists and whose ingredient was never received, created by
 * `costing-incomplete-fixture.mjs`. It is the one state the rehearsal café cannot show on
 * its own, and it is the case D47 is about.
 */
const INCOMPLETE_PLATE = process.env.UX_INCOMPLETE || 'Prueba de costo';
/** A number the server did not price, in either language. */
const NO_COST = /(sin costo|no cost)/i;

const browser = await chromium.connectOverCDP(CDP, { timeout: 60_000 });
const context = browser.contexts()[0];
if (!context) throw new Error(`No browser context on the CDP connection at ${CDP}.`);

// Reuse the operator's Dashboard tab: a second tab is a second Vite client and a second
// copy of the app on a box that swaps.
const page = context.pages().find((p) => p.url().startsWith(BASE)) ?? (await context.newPage());
mkdirSync(OUT, { recursive: true });

const report = { base: BASE, steps: [], findings: [], tables: null, requests: [] };
/**
 * The branch the console was on when this probe started.
 *
 * A probe borrows the operator's session — and the branch is a PERSISTED preference
 * (`umi-dashboard-selected-location`), so switching it here changes what every later tool
 * sees. This is not hypothetical: leaving it on Chapultepec failed two cases of
 * `floor-plan-map.spec.mjs`, which attaches to the same browser over CDP and asserts the
 * console's branch is Congreso. So the original branch is restored in `finally`.
 */
let originalBranch = null;

/**
 * The screen must be worked full screen: a windowed console is a smaller viewport, and
 * viewport size has already produced a false defect on this box.
 */
async function ensureFullScreen() {
  const session = await context.newCDPSession(page);
  const { windowId } = await session.send('Browser.getWindowForTarget');
  const { bounds } = await session.send('Browser.getWindowBounds', { windowId });
  if (bounds.windowState !== 'fullscreen') {
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'fullscreen' },
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  const after = await session.send('Browser.getWindowBounds', { windowId });
  const inner = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  report.steps.push({
    step: 'window',
    was: bounds.windowState,
    now: after.bounds.windowState,
    inner,
  });
  return inner;
}

/** Read a table into rows of cell text, by its column headers. */
async function readAllTables() {
  return page.evaluate(() =>
    [...document.querySelectorAll('table')].map((table) => ({
      head: [...table.querySelectorAll('thead th')].map((th) => th.innerText.trim()),
      rows: [...table.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => td.innerText.replace(/\s+/g, ' ').trim()),
      ),
    })),
  );
}

/**
 * The one table whose headers all match, or null.
 *
 * Tables are told apart by their HEADERS and not by their order: the plate-detail table
 * only exists once a plate is opened, so an index would mean something different before
 * and after the click.
 */
function tableWith(tables, patterns) {
  return (
    tables.find((table) => patterns.every((p) => table.head.some((cell) => p.test(cell)))) ?? null
  );
}

try {
  await ensureFullScreen();

  page.on('request', (request) => {
    if (/inventory-costing/.test(request.url())) report.requests.push(request.url());
  });
  const responses = [];
  page.on('response', (response) => {
    if (/inventory-costing/.test(response.url())) {
      responses.push({ url: response.url(), status: response.status() });
    }
  });

  // ── 1. Land on the console root, not on the screen ─────────────────────────
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(3000);
  report.steps.push({ step: 'landed', url: page.url() });
  await page.screenshot({ path: `${OUT}/01-console-root.png` });

  // ── 2. Reach the screen the way a person does ──────────────────────────────
  const navEntry = page.getByRole('button', { name: NAV_LABEL });
  await navEntry.waitFor({ state: 'visible', timeout: 20_000 });
  const navBox = await navEntry.boundingBox();
  await navEntry.click();
  await page.waitForTimeout(4000);
  report.steps.push({
    step: 'clicked the nav entry',
    label: String(NAV_LABEL),
    at: navBox,
    url: page.url(),
  });
  await page.screenshot({ path: `${OUT}/02-costing-screen.png`, fullPage: true });

  const heading = await page.evaluate(() => document.querySelector('h1')?.innerText ?? null);
  report.steps.push({ step: 'masthead title', heading });

  // ── 3. What the screen asked the API for ───────────────────────────────────
  report.steps.push({
    step: 'costing requests',
    count: report.requests.length,
    routes: [...new Set(report.requests.map((url) => new URL(url).pathname))].sort(),
    statuses: responses.map((r) => `${new URL(r.url).pathname.split('/').pop()} ${r.status}`),
  });

  // ── 4. The tables, as the DOM has them ────────────────────────────────────
  const tables = await readAllTables();
  const days = tableWith(tables, [/^(Día|Day)$/i, /^(Tickets)$/i, /^(Platillos|Dishes)$/i]);
  const plates = tableWith(tables, [
    /^(Platillo|Dish)$/i,
    /^(Precio|Price)$/i,
    /^(Estado|Status|State)$/i,
  ]);
  const forecast = tableWith(tables, [
    /^(Insumo|Ingredient)$/i,
    /^(Existencia|On hand)$/i,
    /^(Alcanza|Lasts)$/i,
  ]);
  const basis = tableWith(tables, [/^(Recepciones|Receipts)$/i, /^(Costo unitario|Unit cost)$/i]);
  report.tables = {
    headersOnPage: tables.map((table) => table.head),
    days: days ? days.rows.length : null,
    plates: plates ? plates.rows.length : null,
    forecast: forecast ? forecast.rows.length : null,
    basis: basis ? basis.rows.length : null,
  };
  report.steps.push({ step: 'tables found', ...report.tables });

  // ── 5. The honesty rule, checked against the rendered cells ───────────────
  // A row that says "Sin costo" in the Costo column must carry NO margin: not a number,
  // not a zero, not a percentage. This is D47, read off the screen rather than the model.
  const lying = [];
  const checkRows = (table, name, costIndex, marginIndex, percentIndex) => {
    if (!table) return;
    for (const row of table.rows) {
      const cost = row[costIndex] ?? '';
      if (!NO_COST.test(cost)) continue;
      const margin = row[marginIndex] ?? '';
      const percent = row[percentIndex] ?? '';
      if (/\d/.test(margin) || /\d/.test(percent)) {
        lying.push({ table: name, row, margin, percent });
      }
    }
  };
  checkRows(days, 'days', 2, 3, 4);
  checkRows(plates, 'plates', 2, 3, 4);
  report.steps.push({
    step: 'rows with no cost that still show a margin',
    count: lying.length,
    examples: lying.slice(0, 5),
  });
  if (lying.length > 0) {
    report.findings.push(
      `${lying.length} row(s) show a margin beside a cost the server did not price — D47 on screen.`,
    );
  }

  const uncostedDays = (days?.rows ?? []).filter((row) => NO_COST.test(row[2] ?? '')).length;
  report.steps.push({
    step: 'day rows',
    total: days?.rows?.length ?? 0,
    withoutCost: uncostedDays,
    sample: (days?.rows ?? []).slice(0, 3),
  });

  // ── 5b. Switch the branch, because the day numbers are BRANCH numbers ─────
  // Two of the four reads are location-scoped, so the console's own branch switcher is
  // part of this screen's contract. This clicks it the way a person would, then re-reads
  // the same four reads for the branch that actually traded — which is where the D47
  // state is visible, since the rehearsal café's menu is almost entirely un-reciped.
  const locationTrigger = page.getByRole('button', { name: /^(Location|Sucursal)$/ });
  if (await locationTrigger.count()) {
    originalBranch = (await locationTrigger.innerText()).trim();
    await locationTrigger.click();
    await page.waitForTimeout(600);
    const option = page.getByRole('option', { name: BRANCH, exact: true });
    if (await option.count()) {
      await option.click();
      await page.waitForTimeout(4000);
      const atBranch = await readAllTables();
      const branchDays = tableWith(atBranch, [
        /^(Día|Day)$/i,
        /^(Tickets)$/i,
        /^(Platillos|Dishes)$/i,
      ]);
      report.steps.push({
        step: `switched the branch to ${BRANCH}`,
        window: await page.evaluate(
          () => document.body.innerText.match(/(From|Del)[^\n]{0,60}·[^\n]{0,20}/)?.[0] ?? null,
        ),
        dayRows: branchDays?.rows ?? null,
      });
      // The honesty rule again, on the branch that traded: a day with a revenue and no
      // cost must not carry a margin figure.
      const branchLying = (branchDays?.rows ?? []).filter(
        (row) => NO_COST.test(row[2] ?? '') && (/\d/.test(row[3] ?? '') || /\d/.test(row[4] ?? '')),
      );
      if (branchLying.length > 0) {
        report.findings.push(
          `${branchLying.length} day row(s) at ${BRANCH} show a margin beside an unknown cost.`,
        );
      }
      await page.screenshot({ path: `${OUT}/03-days-at-branch.png`, fullPage: true });
    } else {
      report.findings.push(`No branch option named ${BRANCH} in the console's switcher.`);
    }
  }

  // ── 6. A real click on a plate, to see what it is made of ─────────────────
  if (plates && plates.rows.length > 0) {
    const plateButton = page.locator('tbody tr button').first();
    const plateBox = await plateButton.boundingBox();
    await plateButton.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/03-plate-detail.png`, fullPage: true });
    const detail = await page.evaluate(() => {
      const card = [...document.querySelectorAll('.card')].find((node) =>
        /(Costo del platillo|Dish cost)/i.test(node.innerText),
      );
      return card ? card.innerText.replace(/\n+/g, ' | ').slice(0, 900) : null;
    });
    report.steps.push({ step: 'opened a plate', at: plateBox, detail });
  }

  // ── 7. The honest empty-ish view: what has no cost at all ─────────────────
  const uncostedTab = page.getByRole('button', { name: /^(Sin costo|No cost) \(/ });
  if (await uncostedTab.count()) {
    await uncostedTab.click();
    await page.waitForTimeout(1200);
    const uncostedPlates = tableWith(await readAllTables(), [
      /^(Platillo|Dish)$/i,
      /^(Precio|Price)$/i,
      /^(Estado|Status|State)$/i,
    ]);
    report.steps.push({
      step: 'sin costo view',
      rows: uncostedPlates?.rows.length ?? 0,
      sample: (uncostedPlates?.rows ?? []).slice(0, 4),
    });
    await page.screenshot({ path: `${OUT}/04-uncosted-plates.png`, fullPage: true });
  }

  // ── 7b. The plate that cannot be costed, opened by searching for it ───────
  // `costing-incomplete-fixture.mjs` creates it (a recipe whose only ingredient was never
  // received). Finding it takes a search and a click, which is exactly how an owner would
  // reach it, and the card must NAME the ingredient and the reason instead of showing a
  // margin. If the fixture is not applied this step reports that it skipped.
  const search = page.getByPlaceholder(/(Buscar un platillo|Search for a dish)/);
  if (await search.count()) {
    await search.fill(INCOMPLETE_PLATE);
    await page.waitForTimeout(900);
    const found = tableWith(await readAllTables(), [
      /^(Platillo|Dish)$/i,
      /^(Precio|Price)$/i,
      /^(Estado|Status|State)$/i,
    ]);
    report.steps.push({ step: 'searched for the uncostable plate', rows: found?.rows ?? null });
    const button = page.locator('tbody tr button').first();
    if (found && found.rows.length > 0) {
      await button.click();
      await page.waitForTimeout(1200);
      const card = await page.evaluate(() => {
        const node = [...document.querySelectorAll('.card')].find((element) =>
          /(Costo del platillo|Dish cost)/i.test(element.innerText),
        );
        return node ? node.innerText.replace(/\n+/g, ' | ') : null;
      });
      report.steps.push({
        step: 'the uncostable plate, opened',
        card: card?.slice(0, 700) ?? null,
      });
      // The rule, read off the card: it must name the missing ingredient, and it must not
      // carry a margin number.
      const namesIngredient = /(Jarabe de vainilla|vanilla syrup)/i.test(card ?? '');
      const showsMargin = /(MARGEN|MARGIN)[^|]*MX\$[0-9]/i.test(card ?? '');
      if (!namesIngredient) {
        report.findings.push(
          'The uncostable plate does not name the ingredient whose price is missing.',
        );
      }
      if (showsMargin) {
        report.findings.push('The uncostable plate shows a margin figure it cannot have.');
      }
      report.steps.push({ step: 'uncostable card checks', namesIngredient, showsMargin });
      await page.screenshot({ path: `${OUT}/05-uncostable-plate.png`, fullPage: true });
    } else {
      report.findings.push(
        `No plate matched "${INCOMPLETE_PLATE}" — run costing-incomplete-fixture.mjs --apply first.`,
      );
    }
    await search.fill('');
    await page.waitForTimeout(600);
  }

  // ── 8. And what the range control does ────────────────────────────────────
  const week = page.getByRole('button', { name: /^7 (días|days)$/ });
  if (await week.count()) {
    const before = report.requests.length;
    await week.click();
    await page.waitForTimeout(3000);
    const windowLabel = await page.evaluate(() => {
      const match = document.body.innerText.match(/Del .+ al .+ · \d+ días/);
      const english = document.body.innerText.match(/From .+ to .+ · \d+ days/);
      return match ? match[0] : english ? english[0] : null;
    });
    report.steps.push({
      step: 'clicked 7 días',
      newRequests: report.requests.length - before,
      windowLabel,
      url: page.url(),
    });
    await page.screenshot({ path: `${OUT}/05-seven-days.png`, fullPage: true });
  }
} finally {
  // Put the console back on the branch it was on. A probe that leaves the session changed
  // is a probe that breaks the next one, and the branch is stored, not per-tab.
  if (originalBranch) {
    try {
      const trigger = page.getByRole('button', { name: /^(Location|Sucursal)$/ });
      if ((await trigger.count()) > 0) {
        await trigger.click();
        await page.waitForTimeout(500);
        const back = page.getByRole('option', { name: originalBranch, exact: true });
        if ((await back.count()) > 0) {
          await back.click();
          await page.waitForTimeout(2500);
          report.steps.push({ step: 'restored the branch', to: originalBranch });
        }
      }
    } catch (restoreError) {
      report.findings.push(
        `The branch could not be restored to ${originalBranch}: ${restoreError.message}. ` +
          'The console is left on another branch, and the pinned-route specs assert Congreso.',
      );
    }
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await page.close();
  // Borrowed connection: disconnect, never close the operator's browser.
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
