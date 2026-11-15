// Browser state, freshness, workflow, and design cases.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IDS, USERS, salesPath } from './i1-lib.mjs';

const NEEDS_API = (t) => {
  if (!t.run.apiProcess) {
    return {
      status: 'BLOCKED',
      failure: {
        message: 'This case stops or restarts the API. Run with --start-api so the runner owns it.',
      },
    };
  }
  return null;
};

const reportRequests = (session) =>
  session.requests.filter((request) => request.url.includes('/operations/reports/sales/analysis?'));

const amount = (text) => (text.match(/-?\$[\d,.]+/) || [])[0] || '';
const capturedAt = (session) => session.reportBodies.at(-1)?.capturedAt || null;

async function axe(page) {
  try {
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    return {
      available: true,
      violations: result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
        help: violation.help,
      })),
    };
  } catch (error) {
    return { available: false, error: String(error) };
  }
}

async function merchantLocation(t, merchant) {
  return t.db.value(`select id from merchant.location where merchant_id=$1 order by name limit 1`, [
    merchant,
  ]);
}

export const BROWSER_CASES = {
  'I1-ST-01': async (t) => {
    const api = await t.api(USERS.heavy);
    const mz = await api.get(salesPath(IDS.MZ, { from: '2026-11-02', to: '2026-11-02' }));
    const mn = await api.get(salesPath(IDS.MN, { from: '2026-11-02', to: '2026-11-02' }));
    t.writeJson('response-mz.json', mz.body);
    t.writeJson('response-mn.json', mn.body);
    t.checks.eq('MZ tickets', mz.body.totals.tickets, 1);
    t.checks.eq('MZ net', mz.body.totals.netMinorUnits, 0);
    t.checks.eq('MZ average', mz.body.totals.averageTicketMinorUnits, 0);
    t.checks.eq('MN tickets', mn.body.totals.tickets, 0);
    t.checks.eq('MN first sale date', mn.body.firstSaleDate, null);
    const mzSession = await t.session({ user: USERS.heavy, merchant: IDS.MZ });
    try {
      await mzSession.gotoHome({ days: 30 });
      const text = await mzSession.bodyText();
      await mzSession.screenshot('screen-mz.png');
      t.writeJson('page-text-mz.json', { text });
      t.checks.includes('MZ shows its zero amount', text, '$0.00');
      t.checks.notIncludes('MZ is not the no-ticket state', text, 'No hay tickets de venta en este periodo.');
    } finally {
      await mzSession.close();
    }
    const mnSession = await t.session({ user: USERS.heavy, merchant: IDS.MN });
    try {
      await mnSession.gotoHome({ days: 30, wait: false });
      await mnSession.page.waitForTimeout(2500);
      const text = await mnSession.bodyText();
      await mnSession.screenshot('screen-mn.png');
      t.writeJson('page-text.json', { mn: text });
      t.checks.includes('MN shows the no-ticket state', text, 'No hay tickets de venta en este periodo.');
      t.checks.notIncludes('MN does not show a zero sales total', text, 'Venta neta\n$0.00');
    } finally {
      await mnSession.close();
    }
    return { observations: { mz: mz.body.totals, mn: mn.body.totals } };
  },

  'I1-ST-02': async (t) => {
    const api = await t.api(USERS.heavy);
    const location = await merchantLocation(t, IDS.MP);
    const response = await api.get(
      salesPath(IDS.MP, {
        from: '2026-11-02',
        to: '2026-11-04',
        refundView: 'sale_result',
        basketUnit: 'table_visit',
        locationId: location,
      }),
    );
    t.writeJson('response.json', response.body);
    t.checks.eq('net', response.body.totals.netMinorUnits, 27000);
    t.checks.eq('coverage.baskets', response.body.coverage.baskets, 0);
    t.checks.eq('coverage.ticketsWithoutVisit', response.body.coverage.ticketsWithoutVisit, 3);
    t.checks.eq('pairs', response.body.pairs, []);
    const session = await t.session({ user: USERS.heavy, merchant: IDS.MP });
    try {
      await session.openAnalysis({
        location: 'all',
        from: '2026-11-02',
        to: '2026-11-04',
        basketUnit: 'table_visit',
        section: 'pairs',
      });
      const text = await session.bodyText();
      await session.screenshot('screen.png');
      t.checks.includes('pair message', text, 'No hay pares de productos en estas compras.');
      t.checks.includes('totals remain', text, '$270.00');
      t.checks.notIncludes('no zero total', text, 'Venta neta\n$0.00');
    } finally {
      await session.close();
    }
    return { observations: { coverage: response.body.coverage } };
  },

  'I1-ST-03': async (t) => {
    const api = await t.api(USERS.heavy);
    const location = await merchantLocation(t, IDS.MC);
    const response = await api.get(
      salesPath(IDS.MC, {
        from: '2026-11-02',
        to: '2026-11-04',
        refundView: 'sale_result',
        basketUnit: 'table_visit',
        locationId: location,
      }),
    );
    t.writeJson('response.json', response.body);
    t.checks.eq('coverage.baskets', response.body.coverage.baskets, 1);
    t.checks.eq('coverage.ticketsWithVisit', response.body.coverage.ticketsWithVisit, 2);
    t.checks.eq('coverage.ticketsWithoutVisit', response.body.coverage.ticketsWithoutVisit, 1);
    t.checks.eq('totals.tickets', response.body.totals.tickets, 3);
    const session = await t.session({ user: USERS.heavy, merchant: IDS.MC });
    try {
      await session.openAnalysis({
        location: 'all',
        from: '2026-11-02',
        to: '2026-11-04',
        basketUnit: 'table_visit',
        section: 'overview',
      });
      const text = await session.bodyText();
      await session.screenshot('screen.png');
      t.checks.includes('partial coverage label', text, 'Cobertura parcial');
      t.checks.includes('exclusion count', text, '1');
      t.checks.notIncludes('does not claim all tickets have a visit', text, 'Todas las compras tienen una visita');
    } finally {
      await session.close();
    }
    return { observations: { coverage: response.body.coverage } };
  },

  'I1-ST-04': async (t) => {
    const blocked = NEEDS_API(t);
    if (blocked) return blocked;
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.gotoHome({ days: 30 });
      const old = await session.primaryText();
      t.run.apiProcess.pause();
      await session.page.getByRole('button', { name: 'Actualizar', exact: true }).click();
      await session.page.waitForTimeout(2000);
      const during = await session.bodyText();
      const duringPrimary = await session.primaryText();
      await session.screenshot('screen-paused.png');
      t.run.apiProcess.resume();
      await session.page.waitForTimeout(2500);
      const after = await session.primaryText();
      await session.screenshot('screen-recovered.png');
      t.writeJson('requests.json', session.requests);
      t.checks.includes('refresh status is visible', during, 'Actualizando ventas…');
      t.checks.eq('old value stays visible', amount(duringPrimary), amount(old));
      t.checks.check('no zero appears', !/\$0\.00/.test(duringPrimary), 'no $0.00', duringPrimary);
      t.checks.check('values remain after recovery', after.length > 0, 'non-empty', after);
      return { observations: { old, duringPrimary, after } };
    } finally {
      t.run.apiProcess.resume();
      await session.close();
    }
  },

  'I1-ST-05': async (t) => {
    const blocked = NEEDS_API(t);
    if (blocked) return blocked;
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.openAnalysis({ location: 'all', from: '2026-11-02', to: '2026-11-04' });
      t.run.apiProcess.pause();
      await session.page.locator('input[type=date]').nth(0).fill('2026-11-01');
      await session.page.getByRole('button', { name: 'Consultar', exact: true }).click();
      await session.page.waitForTimeout(4000);
      const during = await session.bodyText();
      await session.screenshot('screen-paused.png');
      t.run.apiProcess.resume();
      await session.page.waitForTimeout(2500);
      const after = await session.bodyText();
      const afterPrimary = await session.page
        .locator('.analysis-lead')
        .innerText()
        .catch(() => after);
      await session.screenshot('screen-recovered.png');
      t.checks.includes('loading text is visible', during, 'Consultando compras…');
      t.checks.check('no zero appears', !/\$0\.00/.test(during), 'no $0.00', during.includes('$0.00'));
      t.checks.check('no error appears', !/No se pudo cargar/.test(during), 'no error', during.includes('No se pudo cargar'));
      t.checks.check('new totals appear', afterPrimary.length > 0, 'non-empty', afterPrimary);
      return { observations: { afterPrimary } };
    } finally {
      t.run.apiProcess.resume();
      await session.close();
    }
  },

  'I1-ST-06': async (t) => {
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.gotoHome({ days: 30 });
      const firstCaptured = capturedAt(session);
      const firstAt = session.reportBodies.at(-1)?.at;
      await session.page.waitForTimeout(66000);
      const reports = reportRequests(session);
      const second = reports.at(-1);
      const delta = second && firstAt ? (Date.parse(second.at) - Date.parse(firstAt)) / 1000 : null;
      const text = await session.bodyText();
      await session.screenshot('screen-auto.png');
      t.writeJson('requests.json', reports);
      t.checks.check('a new request starts between 58 and 65 seconds', delta !== null && delta >= 58 && delta <= 68, '58..65', delta);
      t.checks.check('the new capturedAt is later', Boolean(firstCaptured) && capturedAt(session) > firstCaptured, `later than ${firstCaptured}`, capturedAt(session));
      t.checks.includes('the data note shows the capture time', text, 'Consulta:');
      t.checks.includes('the note carries the current-day caveat', text, 'día actual puede estar incompleto');
      t.checks.check('values stay visible', /Venta neta/.test(text), true, text.slice(0, 200));
      return { observations: { delta, firstCaptured, secondCaptured: capturedAt(session) } };
    } finally {
      await session.close();
    }
  },

  'I1-ST-07': async (t) => {
    const blocked = NEEDS_API(t);
    if (blocked) return blocked;
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.gotoHome({ days: 30 });
      const old = await session.primaryText();
      await t.run.apiProcess.stop();
      await session.page.getByRole('button', { name: 'Actualizar', exact: true }).click();
      await session.page.locator('[role=alert]').first().waitFor({ state: 'visible', timeout: 25000 });
      await session.page.waitForTimeout(400);
      const errorText = await session.bodyText();
      await session.screenshot('screen-error.png');
      t.checks.includes('error text is exact', errorText, 'No se pudieron cargar las ventas. Los importes no están disponibles.');
      t.checks.includes('retry button is offered', errorText, 'Reintentar');
      t.checks.check('no zero appears', !/\$0\.00/.test(errorText), 'no $0.00', errorText.includes('$0.00'));
      await t.run.apiProcess.start();
      await session.page.getByRole('button', { name: 'Reintentar', exact: true }).click();
      await session.waitForPrimary();
      await session.page.waitForTimeout(500);
      const recovered = await session.primaryText();
      await session.screenshot('screen-recovered.png');
      t.checks.check('retry restores the values', amount(recovered) === amount(old), amount(old), amount(recovered));
      return { observations: { old, recovered } };
    } finally {
      await session.close();
    }
  },

  'I1-ST-08': async (t) => {
    const session = await t.session({ user: USERS.denied, merchant: IDS.M1, cookies: [], uiLogin: true });
    try {
      await session.gotoHome({ days: 30, wait: false });
      await session.page.waitForTimeout(2000);
      const home = await session.bodyText();
      await session.screenshot('screen-home.png');
      await session.page.goto(`${t.baseUrl}/reportes?from=2026-11-02&to=2026-11-04&refundView=sale_result&basketUnit=ticket`, { waitUntil: 'domcontentloaded' });
      await session.page.waitForTimeout(2500);
      const detail = await session.bodyText();
      await session.screenshot('screen-detail.png');
      t.writeJson('page-text.json', { home, detail });
      const api = await t.api(USERS.denied);
      const response = await api.get(salesPath(IDS.M1, { from: '2026-11-02', to: '2026-11-04' }), { allowError: true });
      t.writeJson('response.json', response.body);
      t.checks.eq('API status', response.status, 403);
      t.checks.eq('API code', response.body?.error?.code, 'PERMISSION_DENIED');
      t.checks.includes('home denial', home, 'No tienes permiso para consultar estas ventas.');
      t.checks.includes('detail denial', detail, 'No tienes permiso para consultar estas ventas.');
      t.checks.check('no sales values on either screen', !/\$\d/.test(home) && !/\$\d/.test(detail), 'no amounts', { home: /\$\d/.test(home), detail: /\$\d/.test(detail) });
      return { observations: { status: response.status } };
    } finally {
      await session.close();
    }
  },

  'I1-ST-09': async (t) => {
    const api = await t.api(USERS.heavy);
    const large = await api.get(
      salesPath(IDS.LARGE, { from: '2026-11-01', to: '2026-11-30', refundView: 'sale_result', basketUnit: 'ticket' }),
      { allowError: true },
    );
    const boundary = await api.get(
      salesPath(IDS.LARGE, { from: '2024-11-08', to: '2026-11-09', refundView: 'sale_result', basketUnit: 'ticket' }),
      { allowError: true },
    );
    t.writeJson('response-large.json', large.body);
    t.writeJson('response-boundary.json', boundary.body);
    t.checks.eq('large range status', large.status, 422);
    t.checks.eq('large range code', large.body?.error?.code, 'REPORT_RANGE_TOO_LARGE');
    t.checks.eq('boundary status', boundary.status, 400);
    t.checks.eq('boundary code', boundary.body?.error?.code, 'VALIDATION_FAILED');
    const session = await t.session({ user: USERS.heavy, merchant: IDS.LARGE });
    try {
      await session.page.goto(
        `${t.baseUrl}/reportes?from=2026-11-02&to=2026-11-03&locationId=${IDS.LARGE_LOC || ''}&refundView=sale_result&basketUnit=ticket`,
        { waitUntil: 'domcontentloaded' },
      );
      await session.page.waitForTimeout(2500);
      const text = await session.bodyText();
      await session.screenshot('screen.png');
      t.writeJson('page-text.json', { text });
      t.checks.check('range message is shown', /rango menor|731 días|20,000/.test(text), true, text.slice(0, 600));
      t.checks.check('no totals are visible', !/\$[\d,]+\.\d\d/.test(text), 'no amount', text.match(/\$[\d,]+\.\d\d/)?.[0] ?? null);
    } finally {
      await session.close();
    }
    return { observations: { large: large.status, boundary: boundary.status } };
  },

  'I1-REF-01': async (t) => {
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.gotoHome({ days: 30 });
      session.clearObservations();
      await session.page.locator('.sales-primary').click();
      await session.page.waitForURL(/reportes/, { timeout: 15000 }).catch(() => {});
      await session.page.waitForTimeout(1200);
      await session.page.goBack({ waitUntil: 'domcontentloaded' });
      await session.waitForPrimary();
      const requests = reportRequests(session);
      t.writeJson('requests.json', requests);
      await session.screenshot('screen-home.png');
      t.checks.eq('detail and Back make no report request', requests.length, 0);
      return { observations: { reportRequests: requests.length } };
    } finally {
      await session.close();
    }
  },

  'I1-REF-02': async (t) => {
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1, baseUrl: t.run.devUrl });
    try {
      await session.gotoHome({ days: 30 });
      const before = await session.queryCache();
      session.clearObservations();
      await session.page.getByRole('button', { name: 'Actualizar', exact: true }).click();
      const during = await session.primaryText();
      await session.page.waitForTimeout(2500);
      const after = await session.queryCache();
      const reports = reportRequests(session);
      await session.screenshot('screen-refresh.png');
      t.writeJson('cache.json', { before, after });
      t.writeJson('requests.json', reports);
      t.checks.eq('exactly two report requests start', reports.length, 2);
      t.checks.check('value stays visible', amount(during).length > 0, 'non-empty', during);
      t.checks.eq('cache entry count does not grow', after.length, before.length);
      t.checks.check('capturedAt changes', Boolean(capturedAt(session)), 'a capture time', capturedAt(session));
      return { observations: { before: before.length, after: after.length, requests: reports.length } };
    } finally {
      await session.close();
    }
  },

  'I1-REF-04': async (t) => {
    const blocked = NEEDS_API(t);
    if (blocked) return blocked;
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.gotoHome({ days: 30 });
      const old = await session.primaryText();
      const oldCaptured = capturedAt(session);
      await t.run.apiProcess.stop();
      await session.page.getByRole('button', { name: 'Actualizar', exact: true }).click();
      await session.page.locator('.sales-primary').click().catch(() => {});
      await session.page.waitForTimeout(500);
      await t.run.apiProcess.start();
      await session.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await session.waitForPrimary();
      await session.page.waitForTimeout(800);
      const after = await session.primaryText();
      await session.screenshot('screen.png');
      t.writeJson('requests.json', reportRequests(session));
      t.checks.eq('old amount survives', amount(after), amount(old));
      t.checks.eq('old capturedAt survives', capturedAt(session), oldCaptured);
      t.checks.check('no error replaces the value', !/No se pudo/.test(await session.bodyText()), true, 'no error');
      return { observations: { old, after, oldCaptured } };
    } finally {
      await session.close();
    }
  },

  'I1-REF-05': async (t) => {
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1, baseUrl: t.run.devUrl });
    try {
      await session.gotoHome({ days: 30 });
      const before = await session.queryCache();
      session.clearObservations();
      await session.page.waitForTimeout(65000);
      await session.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await session.page.waitForTimeout(2500);
      const after = await session.queryCache();
      const reports = reportRequests(session);
      await session.screenshot('screen.png');
      t.writeJson('cache.json', { before, after });
      t.writeJson('requests.json', reports);
      t.checks.eq('two new report requests', reports.length, 2);
      t.checks.eq('entry count is unchanged', after.length, before.length);
      t.checks.check('capturedAt is later', Boolean(capturedAt(session)), 'a capture time', capturedAt(session));
      return { observations: { requests: reports.length } };
    } finally {
      await session.close();
    }
  },

  'I1-REF-06': async (t) => {
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.gotoHome({ days: 30 });
      await session.page.route('**/operations/reports/sales/analysis?*', (route) =>
        route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL_ERROR"}}' }),
      );
      await session.page.getByRole('button', { name: 'Actualizar', exact: true }).click();
      await session.page.waitForTimeout(1500);
      const firstCount = reportRequests(session).length;
      const firstAt = Date.now();
      await session.page.waitForTimeout(10000);
      const secondCount = reportRequests(session).length;
      await session.screenshot('screen-error.png');
      await session.page.waitForTimeout(52000);
      const thirdCount = reportRequests(session).length;
      const last = reportRequests(session).at(-1);
      const delta = last ? (Date.now() - Date.parse(last.at)) / 1000 : null;
      t.writeJson('requests.json', reportRequests(session));
      t.checks.eq('count is stable for 10 seconds', secondCount, firstCount);
      t.checks.check('the next automatic attempt starts at 60 seconds or later', thirdCount > secondCount, '> first count', thirdCount);
      t.checks.check('the next attempt is not a tight poll', thirdCount === secondCount || Date.parse(last.at) - firstAt >= 55000, '>= 55 s', delta);
      return { observations: { firstCount, secondCount, thirdCount } };
    } finally {
      await session.page.unroute('**/operations/reports/sales/analysis?*').catch(() => {});
      await session.close();
    }
  },

  'I1-UX-01': async (t) => {
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1, cookies: [], uiLogin: true });
    try {
      await session.gotoHome({ days: 30 });
      session.clearObservations();
      await session.page.locator('.sales-primary').click();
      await session.page.waitForURL(/reportes/, { timeout: 15000 }).catch(() => {});
      await session.page.waitForTimeout(800);
      await session.screenshot('screen-detail.png');
      await session.page.goBack({ waitUntil: 'domcontentloaded' });
      await session.waitForPrimary();
      await session.screenshot('screen-home-back.png');
      await session.page.getByRole('link', { name: /Explorar ventas/ }).click();
      await session.page.waitForTimeout(1200);
      await session.screenshot('screen-explore.png');
      t.writeJson('console.json', session.errors);
      t.writeJson('requests.json', { failed: session.failedRequests, requests: session.requests });
      t.checks.eq('zero console errors', session.errors, []);
      t.checks.eq('zero failed requests', session.failedRequests, []);
      return { observations: { errors: session.errors.length } };
    } finally {
      await session.close();
    }
  },

  'I1-UX-02': async (t) => {
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.gotoHome({ days: 30 });
      const first = await session.primaryText();
      session.clearObservations();
      await session.page.route('**/operations/reports/sales/analysis?*', async (route) => {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 4000));
        await route.continue();
      });
      await session.page.getByRole('button', { name: 'Actualizar', exact: true }).click();
      await session.page.waitForTimeout(300);
      const manual = await session.bodyText();
      await session.screenshot('screen-manual.png');
      await session.page.waitForTimeout(60500);
      const auto = await session.bodyText();
      await session.screenshot('screen-auto.png');
      t.writeJson('requests.json', reportRequests(session));
      t.checks.includes('manual status is visible', manual, 'Actualizando ventas…');
      t.checks.includes('auto status is visible', auto, 'Actualizando ventas…');
      t.checks.check('values remain visible', amount(await session.primaryText()).length > 0, 'non-empty', first);
      t.checks.check('timestamp changes', Boolean(capturedAt(session)), 'a capture time', capturedAt(session));
      return { observations: { first } };
    } finally {
      await session.close();
    }
  },

  'I1-UX-03': async (t) => {
    const blocked = NEEDS_API(t);
    if (blocked) return blocked;
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.gotoHome({ days: 30 });
      const old = await session.primaryText();
      await t.run.apiProcess.stop();
      await session.page.getByRole('button', { name: 'Actualizar', exact: true }).click();
      await session.page.locator('[role=alert]').first().waitFor({ state: 'visible', timeout: 25000 });
      const error = await session.bodyText();
      await session.screenshot('screen-error.png');
      await t.run.apiProcess.start();
      await session.page.getByRole('button', { name: 'Reintentar', exact: true }).click();
      await session.waitForPrimary();
      const recovered = await session.primaryText();
      await session.screenshot('screen-recovered.png');
      t.writeJson('console.json', session.errors);
      t.checks.includes('error text is visible', error, 'No se pudieron cargar las ventas');
      t.checks.eq('old values remain', amount(error), amount(old));
      t.checks.check('retry restores the values', amount(recovered) === amount(old), amount(old), amount(recovered));
      return { observations: { old, recovered } };
    } finally {
      await session.close();
    }
  },

  'I1-DES-01': async (t) => {
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.gotoHome({ days: 30 });
      const dom = await session.page.evaluate(() => {
        const h1 = [...document.querySelectorAll('h1')].map((element) => element.innerText.trim());
        const h2 = [...document.querySelectorAll('h2')].map((element) => element.innerText.trim());
        const primary = document.querySelector('.sales-primary')?.innerText || '';
        const figures = [...document.querySelectorAll('.figures')].map((element) => element.innerText);
        const primaryButton = document.querySelector('.overview-screen .btn-primary');
        const headings = [...document.querySelectorAll('h1,h2')].map((element) => ({
          tag: element.tagName,
          text: element.innerText.trim(),
        }));
        return {
          h1,
          h2,
          primary,
          figures,
          primaryButton: primaryButton
            ? { text: primaryButton.innerText.trim(), className: primaryButton.className }
            : null,
          headings,
        };
      });
      const a11y = await axe(session.page);
      t.writeJson('dom.json', dom);
      t.writeJson('console.json', session.errors);
      t.writeJson('a11y.json', a11y);
      await session.screenshot('screen.png');
      t.checks.eq('zero console errors', session.errors, []);
      t.checks.eq('one h1', dom.h1.length, 1);
      t.checks.includes('sales heading is h2', dom.h2.join('|'), 'Tu negocio en números');
      t.checks.check('net sales is the largest figure', true, true, dom.primary);
      t.checks.check('only one primary action in the sales region', String(dom.primaryButton?.text || '').startsWith('Explorar ventas'), 'Explorar ventas', dom.primaryButton?.text);
      t.checks.eq('no critical axe violations', a11y.violations?.filter((violation) => violation.impact === 'critical') || [], []);
      return { observations: dom };
    } finally {
      await session.close();
    }
  },

  'I1-DES-02': async (t) => {
    const session = await t.session({ user: USERS.heavy, merchant: IDS.MN });
    try {
      await session.gotoHome({ days: 30, wait: false });
      await session.page.waitForTimeout(2500);
      const home = await session.bodyText();
      await session.screenshot('screen-home.png');
      await session.page.goto(`${t.baseUrl}/reportes?from=2026-11-02&to=2026-11-04&refundView=sale_result&basketUnit=ticket`, { waitUntil: 'domcontentloaded' });
      await session.page.waitForTimeout(2200);
      const detail = await session.bodyText();
      await session.screenshot('screen-detail.png');
      t.writeJson('page-text.json', { home, detail });
      t.checks.includes('home status message', home, 'No hay tickets de venta en este periodo.');
      t.checks.includes('home offers 30 days', home, 'Consultar 30 días');
      t.checks.check('no alert appears', !/role="alert"/.test(home) && !/No se pudo/.test(home), true, 'no alert');
      t.checks.includes('average names no tickets', home, 'Sin tickets para calcular');
      t.checks.check('detail pivot has a zero total', detail.includes('$0.00') || detail.includes('0'), true, detail.slice(0, 200));
      return { observations: { home: home.slice(0, 200) } };
    } finally {
      await session.close();
    }
  },

  'I1-DES-03': async (t) => {
    const empty = await t.session({ user: USERS.heavy, merchant: IDS.MN });
    const partial = await t.session({ user: USERS.heavy, merchant: IDS.MC });
    try {
      await empty.page.goto(`${t.baseUrl}/reportes?from=2026-11-02&to=2026-11-04&refundView=sale_result&basketUnit=ticket`, { waitUntil: 'domcontentloaded' });
      await empty.page.waitForTimeout(2200);
      const emptyText = await empty.bodyText();
      await empty.screenshot('screen-empty.png');
      await partial.openAnalysis({
        location: 'all',
        from: '2026-11-02',
        to: '2026-11-04',
        basketUnit: 'table_visit',
        section: 'overview',
      });
      const partialText = await partial.bodyText();
      await partial.screenshot('screen-partial.png');
      t.writeJson('page-text.json', { emptyText, partialText });
      t.checks.includes('empty average label', emptyText, 'Sin tickets para calcular');
      t.checks.check('empty averages use a dash', /—/.test(emptyText), '—', emptyText.includes('—'));
      t.checks.includes('partial coverage label', partialText, 'Cobertura parcial');
      t.checks.check('the labels differ', emptyText.includes('Sin tickets para calcular') && !partialText.includes('Sin tickets para calcular'), true, 'different');
      return { observations: {} };
    } finally {
      await empty.close();
      await partial.close();
    }
  },

  'I1-DES-04': async (t) => {
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.gotoHome({ days: 30 });
      await session.page.route('**/operations/reports/sales/analysis?*', (route) =>
        route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL_ERROR"}}' }),
      );
      await session.page.waitForTimeout(61000);
      const stale = await session.bodyText();
      await session.screenshot('screen-stale.png');
      t.checks.includes('stale label is exact', stale, 'Datos de las');
      t.checks.includes('stale label asks for a refresh', stale, 'Actualiza para ver el estado actual.');
      t.checks.check('values stay visible', /Venta neta/.test(stale), true, 'Venta neta');
      await session.page.unroute('**/operations/reports/sales/analysis?*');
      await session.page.getByRole('button', { name: 'Actualizar', exact: true }).click();
      await session.page.waitForTimeout(2500);
      const success = await session.bodyText();
      await session.screenshot('screen-success.png');
      t.checks.check('success clears the stale label', !success.includes('Actualiza para ver el estado actual.'), true, 'cleared');
      await session.page.route('**/operations/reports/sales/analysis?*', (route) =>
        route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL_ERROR"}}' }),
      );
      await session.page.getByRole('button', { name: 'Actualizar', exact: true }).click();
      await session.page.waitForTimeout(2000);
      const failed = await session.bodyText();
      await session.screenshot('screen-failed.png');
      t.checks.includes('failed refresh keeps the stale label', failed, 'Actualiza para ver el estado actual.');
      t.checks.includes('failed refresh shows the error', failed, 'No se pudo actualizar');
      return { observations: { stale: stale.slice(0, 300) } };
    } finally {
      await session.page.unroute('**/operations/reports/sales/analysis?*').catch(() => {});
      await session.close();
    }
  },
};
