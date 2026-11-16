import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

// Gate-3 dashboard capture. Real Chromium over CDP, real clicks, two phases.
//
//   node tools/verification/gate3-dashboard-capture.mjs --phase before
//   node tools/verification/gate3-dashboard-capture.mjs --phase after
//
// The fixture is fixed. The harness reads fixture.json for D0 and the ids.
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const phase = option('--phase', 'after');
const baseUrl = option('--base-url', 'http://127.0.0.1:4000');
const out = resolve(
  option('--out', `docs/verification/2026-11-16-semantic-api-gate3/dashboard/${phase}`),
);
const fixturePath = option(
  '--fixture',
  join(process.cwd(), 'tools/verification/fixtures/semantic-gate3/fixture.json'),
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const head = option('--head', process.env.GATE3_HEAD ?? 'unknown');
const baseHead = option('--base-head', 'dfa7a78a94e696eb67fc4606b281268746128ec8');
mkdirSync(join(out, 'screens'), { recursive: true });
mkdirSync(join(out, 'crops'), { recursive: true });

const RANGES = [
  { id: 'today', code: 'T', label: 'Hoy', short: 'today' },
  { id: 'yesterday', code: 'Y', label: 'Ayer', short: 'yesterday' },
  { id: 'last_7_days', code: 'W', label: '7 días', short: '7d' },
  { id: 'last_30_days', code: 'M', label: '30 días', short: '30d' },
];
const VIEWS = [
  { id: 'resumen', code: 'RES', label: 'Cobros originales' },
  { id: 'productos', code: 'PRO', label: 'Producto' },
  { id: 'categorias', code: 'CAT', label: 'Categoría' },
  { id: 'operadores', code: 'OPE', label: 'Operador' },
  { id: 'horas', code: 'HOR', label: 'Hora' },
];

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(500);
  await page.locator('#login-email').fill(fixture.accounts.centro);
  await page.locator('#login-pw').fill('Umi2026!');
  await page.getByRole('button', { name: /Entrar/ }).click();
  await page.waitForTimeout(2200);
}

async function openReport(page) {
  await page.goto(`${baseUrl}/reportes`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1800);
  await page
    .getByRole('button', { name: 'Cobros originales', exact: true })
    .waitFor({ timeout: 20000 });
}

async function selectLocation(page, name) {
  const trigger = page.locator('[aria-label="Sucursal"]').first();
  await trigger.waitFor({ timeout: 10000 });
  const current = (await trigger.innerText()).trim();
  if (current === name) return;
  await trigger.click();
  await page.waitForTimeout(400);
  await page.getByRole('option', { name, exact: true }).click();
  await page.waitForTimeout(1800);
}

async function setRange(page, label) {
  await page
    .getByRole('group', { name: 'Rango de fechas' })
    .getByRole('button', { name: label, exact: true })
    .click();
  await page.waitForTimeout(1700);
}

async function setView(page, view) {
  if (view.id === 'resumen') {
    await page.getByRole('button', { name: 'Cobros originales', exact: true }).click();
    await page.waitForTimeout(1800);
    await page
      .getByText('Ventas cobradas con propina', { exact: true })
      .waitFor({ timeout: 20000 });
    return;
  }
  await page.getByRole('button', { name: 'Tabla dinámica', exact: true }).click();
  await page.waitForTimeout(500);
  await page
    .getByRole('group', { name: 'Agrupar por' })
    .getByRole('button', { name: view.label, exact: true })
    .click();
  await page.waitForTimeout(700);
}

async function readFacts(page) {
  const summary = page.locator('section.surface').first();
  const lead = await summary.locator('div.figures').first().innerText();
  const facts = {};
  for (const [key, label] of [
    ['orders', 'Órdenes'],
    ['ticket', 'Ticket cobrado con propina'],
    ['items', 'Ítems vendidos'],
    ['discounts', 'Descuentos'],
    ['tips', 'Propinas'],
  ]) {
    facts[key] = await summary
      .getByText(label, { exact: true })
      .locator('..')
      .locator('div.figures')
      .innerText();
  }
  let delta = null;
  const deltaNode = page.getByText(/vs\. período anterior/);
  if (await deltaNode.count()) delta = (await deltaNode.first().innerText()).trim();
  return { lead: lead.trim(), facts, delta };
}

async function readNarrative(page) {
  const title = page.getByText('Resumen del periodo', { exact: true });
  if (!(await title.count())) return null;
  return (await title.locator('..').locator('p').innerText()).trim();
}

async function readPayment(page) {
  const title = page.getByText('Método de pago', { exact: true });
  if (!(await title.count())) return { present: false, rows: [], text: null };
  const text = await title.locator('..').innerText();
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = [];
  for (let i = 1; i + 2 < lines.length; i += 3) {
    rows.push({ label: lines[i], percent: lines[i + 1], amount: lines[i + 2] });
  }
  return { present: true, rows, text };
}

async function readChannel(page) {
  const title = page.getByText('Canal de venta', { exact: true });
  if (!(await title.count())) return { present: false, text: null, rows: [] };
  const text = await title.locator('..').innerText();
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = [];
  for (let i = 1; i + 2 < lines.length; i += 3) {
    rows.push({ label: lines[i], percent: lines[i + 1], amount: lines[i + 2] });
  }
  return { present: true, text, rows };
}

async function readSeries(page) {
  const titles = await page
    .locator('[role=img][aria-label="Serie de ventas del periodo"] [title]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('title')));
  const labels = await page
    .locator('[role=img][aria-label="Serie de ventas del periodo"] .figures')
    .allInnerTexts();
  return titles.map((title, index) => ({ title, label: labels[index] ?? null }));
}

async function readPivot(page) {
  const table = page.locator('table.report-pivot-table').last();
  if (!(await table.count())) return { headers: [], rows: [], total: null };
  const headers = await table.locator('thead th').allInnerTexts();
  const rows = await table
    .locator('tbody tr')
    .evaluateAll((trs) =>
      trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())),
    );
  const total = await table
    .locator('tfoot tr')
    .evaluateAll((trs) =>
      trs.length ? [...trs[0].querySelectorAll('td')].map((td) => td.innerText.trim()) : [],
    );
  return { headers: headers.map((h) => h.trim()), rows, total };
}

function attachNetwork(page, state) {
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (
      !/\/api\/merchants\/[^/]+\/(operations\/reports\/sales(\/insight)?|metrics\/(query|insight))$/.test(
        url.pathname,
      )
    )
      return;
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    let requestBody = null;
    try {
      requestBody = response.request().postDataJSON();
    } catch {
      requestBody = null;
    }
    state.requests.push({
      method: response.request().method(),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      status: response.status(),
      requestBody,
      responseBody: body,
    });
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) {
      state.consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => state.pageErrors.push(error.message));
}

async function captureCell(page, state, cell) {
  state.requests = [];
  state.consoleErrors = [];
  state.pageErrors = [];
  await setView(page, cell.view);
  await setRange(page, cell.rangeLabel);
  await page.waitForTimeout(600);

  const summary = cell.view.id === 'resumen';
  const facts = summary ? await readFacts(page) : { lead: null, facts: {}, delta: null };
  const narrative = summary ? await readNarrative(page) : null;
  const payment = summary ? await readPayment(page) : { present: false, rows: [], text: null };
  const channel = summary ? await readChannel(page) : { present: false, text: null, rows: [] };
  const series = summary ? await readSeries(page) : [];
  const pivot = await readPivot(page);

  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  await page.evaluate(() => window.scrollTo(0, 0));
  const screenPath = join(out, 'screens', `${cell.id}.png`);
  await page.screenshot({
    path: screenPath,
    mask: [page.locator('.clock')],
    maskColor: '#ffffff',
  });
  const fullPath = join(out, 'screens', `${cell.id}-full.png`);
  await page.screenshot({
    path: fullPath,
    fullPage: true,
    mask: [page.locator('.clock')],
    maskColor: '#ffffff',
  });
  const header = await page.locator('header.topbar').boundingBox();
  const cropY = Math.max(120, Math.ceil((header?.y ?? 0) + (header?.height ?? 120)));
  const cropPath = join(out, 'crops', `${cell.id}-${viewport.width}.png`);
  await page.screenshot({
    path: cropPath,
    clip: { x: 0, y: cropY, width: viewport.width, height: viewport.height - cropY },
    mask: [page.locator('.clock')],
    maskColor: '#ffffff',
  });

  const source = state.requests.length ? [...state.requests] : (state.lastRequests ?? []);
  if (summary && state.requests.length) state.lastRequests = [...state.requests];
  const insight = summary ? source.find((request) => request.path.endsWith('/insight')) : null;
  let narrativeShot = null;
  if (cell.id === 'DB-T-CEN-RES' && narrative) {
    const title = page.getByText('Resumen del periodo', { exact: true });
    const path = join(out, 'narrative.png');
    await title.locator('..').screenshot({ path });
    narrativeShot = { path: `${phase}/narrative.png`, sha256: sha256(path) };
  }
  return {
    ...cell,
    lead: facts.lead,
    facts: facts.facts,
    delta: facts.delta,
    narrative,
    paymentMix: payment,
    channelPanel: channel,
    series,
    pivot,
    request: source[0] ?? null,
    requests: source,
    requestReused: state.requests.length === 0 && source.length > 0,
    insightRequest: insight ?? null,
    consoleErrors: [...state.consoleErrors],
    pageErrors: [...state.pageErrors],
    screenshot: {
      path: `${phase}/screens/${cell.id}.png`,
      sha256: sha256(screenPath),
      width: viewport.width,
      height: viewport.height,
    },
    fullScreenshot: { path: `${phase}/screens/${cell.id}-full.png`, sha256: sha256(fullPath) },
    crop: {
      path: `${phase}/crops/${cell.id}-${viewport.width}.png`,
      sha256: sha256(cropPath),
      width: viewport.width,
      height: viewport.height - cropY,
      clipY: cropY,
    },
    narrativeScreenshot: narrativeShot,
  };
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'es-MX',
});
await context.addInitScript(() => localStorage.setItem('umi.dashboard.locale', 'es'));
const page = await context.newPage();
const state = { requests: [], consoleErrors: [], pageErrors: [] };
attachNetwork(page, state);

await login(page);
await openReport(page);

const cells = [];
for (const range of RANGES) {
  for (const view of VIEWS) {
    cells.push(
      await captureCell(page, state, {
        id: `DB-${range.code}-CEN-${view.code}`,
        range: range.id,
        rangeLabel: range.label,
        location: 'Centro',
        locationId: fixture.locations.centro,
        view,
        viewLabel: view.label,
      }),
    );
  }
}

const narrativeCell = cells.find((cell) => cell.id === 'DB-T-CEN-RES');

const extras = [];
await selectLocation(page, 'Norte');
for (const [id, view] of [
  ['DB-T-NOR-RES', VIEWS[0]],
  ['DB-T-NOR-HOR', VIEWS[4]],
]) {
  extras.push(
    await captureCell(page, state, {
      id,
      range: 'today',
      rangeLabel: 'Hoy',
      location: 'Norte',
      locationId: fixture.locations.norte,
      view,
      viewLabel: view.label,
    }),
  );
}

await selectLocation(page, 'Centro');
await page.setViewportSize({ width: 390, height: 844 });
for (const [id, view] of [
  ['DB-T-CEN-MOB-RES', VIEWS[0]],
  ['DB-T-CEN-MOB-HOR', VIEWS[4]],
]) {
  extras.push(
    await captureCell(page, state, {
      id,
      range: 'today',
      rangeLabel: 'Hoy',
      location: 'Centro',
      locationId: fixture.locations.centro,
      view,
      viewLabel: view.label,
      viewport: '390x844',
    }),
  );
}

state.requests = [];
state.consoleErrors = [];
state.pageErrors = [];
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${baseUrl}/reportes`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
const s00Text = await page.locator('body').innerText();
await page.evaluate(() => window.scrollTo(0, 0));
const s00Path = join(out, 'screens', 'DB-T-CEN-ANALYSIS.png');
await page.screenshot({
  path: s00Path,
  mask: [page.locator('.clock')],
  maskColor: '#ffffff',
});
const s00Full = join(out, 'screens', 'DB-T-CEN-ANALYSIS-full.png');
await page.screenshot({
  path: s00Full,
  fullPage: true,
  mask: [page.locator('.clock')],
  maskColor: '#ffffff',
});
const s00Crop = join(out, 'crops', 'DB-T-CEN-ANALYSIS-1440.png');
await page.screenshot({
  path: s00Crop,
  clip: { x: 0, y: 120, width: 1440, height: 780 },
});
const s00 = {
  id: 'DB-T-CEN-ANALYSIS',
  ok: s00Text.includes('Análisis de compras') && !s00Text.includes('No se pudo'),
  bodyHasAnalysis: s00Text.includes('Análisis de compras'),
  screenshot: {
    path: `${phase}/screens/DB-T-CEN-ANALYSIS.png`,
    sha256: sha256(s00Path),
    width: 1440,
    height: 900,
  },
  fullScreenshot: {
    path: `${phase}/screens/DB-T-CEN-ANALYSIS-full.png`,
    sha256: sha256(s00Full),
  },
  crop: {
    path: `${phase}/crops/DB-T-CEN-ANALYSIS-1440.png`,
    sha256: sha256(s00Crop),
    width: 1440,
    height: 780,
  },
  consoleErrors: [...state.consoleErrors],
  pageErrors: [...state.pageErrors],
};

writeFileSync(
  join(out, 'evidence.json'),
  `${JSON.stringify(
    {
      phase,
      capturedAt: new Date().toISOString(),
      d0: fixture.d0,
      head,
      baseHead,
      baseUrl,
      viewport: '1440x900',
      mobileViewport: '390x844',
      fixtureRecord: fixture.record,
      seedSha256: fixture.seedSha256,
      locationControl:
        'The capture uses the Sucursal control in the report topbar. It selects Centro and Norte.',
      clockMask:
        'The .clock element is masked in full screenshots. The crop is the main element and excludes the topbar.',
      cells,
      extras,
      s00,
      narrative: narrativeCell
        ? {
            text: narrativeCell.narrative,
            screenshot: narrativeCell.narrativeScreenshot,
            request: narrativeCell.insightRequest,
          }
        : null,
      counts: {
        cells: cells.length,
        extras: extras.length + 1,
        total: cells.length + extras.length + 1,
      },
    },
    null,
    2,
  )}\n`,
);
console.log(`WROTE ${out} cells=${cells.length} extras=${extras.length + 1}`);
await context.close();
await browser.close();
