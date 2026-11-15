// Optional analysis UI, category widget, isolation switch, group editor, metric
// labels, and the mechanical gates.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IDS, USERS, salesPath } from './i1-lib.mjs';

const reportRequests = (session) =>
  session.requests.filter((request) => request.url.includes('/operations/reports/sales/analysis?'));
const amount = (text) => (text.match(/-?\$[\d,.]+/) || [])[0] || '';

async function colors(page) {
  return page.evaluate(() => {
    const dots = [...document.querySelectorAll('.category-sales-report [aria-hidden="true"], .category-legend [aria-hidden="true"], .category-dot')]
      .map((element) => getComputedStyle(element).backgroundColor);
    const cells = [...document.querySelectorAll('.category-sales-report [fill], .category-mosaic [fill]')]
      .map((element) => element.getAttribute('fill'))
      .filter(Boolean);
    return { dots, cells };
  });
}

export const EXTRA_CASES = {
  'I1-OPT-02': async (t) => {
    const session = await t.session({ user: USERS.heavy, merchant: IDS.HEAVY });
    try {
      await session.openAnalysis({
        location: 'all',
        from: '2026-11-02',
        to: '2026-11-03',
        section: 'overview',
      });
      const text = await session.bodyText();
      t.writeJson('page-text.json', { text });
      await session.screenshot('screen.png');
      t.checks.includes('primary net is visible', text, '$4,520.00');
      t.checks.includes(
        'affinity notice is exact',
        text,
        'La afinidad de compras no está disponible para este periodo. Los totales y las categorías siguen disponibles.',
      );
      t.checks.includes('retry control', text, 'Reintentar análisis');
      t.checks.includes('hide control', text, 'Ocultar afinidad');
      t.checks.check('no page-level alert', !/No se pudo cargar/.test(text), true, 'no load error');
      t.checks.check('no zero replaces totals', !/Venta neta\n\$0\.00/.test(text), true, amount(text));
      const roleStatus = await session.page.locator('[role=status]').allInnerTexts();
      t.checks.check('the notice is a status region', roleStatus.some((entry) => entry.includes('La afinidad de compras')), true, roleStatus);
      return { observations: { text: text.slice(0, 400) } };
    } finally {
      await session.close();
    }
  },

  'I1-OPT-03': async (t) => {
    const session = await t.session({ user: USERS.heavy, merchant: IDS.HEAVY });
    try {
      await session.openAnalysis({ location: 'all', from: '2026-11-02', to: '2026-11-03' });
      session.clearObservations();
      const before = await session.bodyText();
      await session.page.waitForTimeout(10000);
      const afterWait = reportRequests(session).length;
      await session.page.getByRole('button', { name: 'Reintentar análisis', exact: true }).click();
      await session.page.waitForTimeout(2500);
      const afterRetry = reportRequests(session).length;
      const retryText = await session.bodyText();
      await session.screenshot('screen-retry.png');
      await session.page.locator('input[type=date]').nth(0).fill('2026-11-03');
      await session.page.locator('input[type=date]').nth(1).fill('2026-11-03');
      await session.page.getByRole('button', { name: 'Consultar', exact: true }).click();
      await session.page.waitForTimeout(2500);
      const successText = await session.bodyText();
      await session.screenshot('screen-success.png');
      t.writeJson('requests.json', reportRequests(session));
      t.checks.eq('no poll during 10 seconds', afterWait, 0);
      t.checks.eq('retry sends one composition request', afterRetry, 1);
      t.checks.includes('notice stays after the failed retry', retryText, 'La afinidad de compras no está disponible');
      t.checks.notIncludes('notice clears on the successful day-2 query', successText, 'La afinidad de compras no está disponible');
      t.checks.includes('the successful query shows totals', successText, '$40.00');
      return { observations: { before: before.slice(0, 200), afterWait, afterRetry } };
    } finally {
      await session.close();
    }
  },

  'I1-OPT-04': async (t) => {
    const session = await t.session({ user: USERS.heavy, merchant: IDS.HEAVY });
    try {
      await session.openAnalysis({ location: 'all', from: '2026-11-02', to: '2026-11-03' });
      await session.page.locator('input[type=date]').nth(0).fill('2026-11-03');
      await session.page.locator('input[type=date]').nth(1).fill('2026-11-03');
      await session.page.getByRole('button', { name: 'Consultar', exact: true }).click();
      await session.page.waitForTimeout(2500);
      const text = await session.bodyText();
      await session.screenshot('screen.png');
      t.writeFile = null;
      writeFileSync(join(t.dir, 'page-text.txt'), text);
      const api = await t.api(USERS.heavy);
      const response = await api.get(
        salesPath(IDS.HEAVY, { from: '2026-11-03', to: '2026-11-03', refundView: 'sale_result', basketUnit: 'ticket' }),
      );
      t.writeJson('response.json', response.body);
      t.checks.eq('day-2 tickets', response.body.totals.tickets, 2);
      t.checks.eq('day-2 merchandise', response.body.totals.merchandiseMinorUnits, 4000);
      t.checks.includes('partial message is absent', text, 'Productos que se compran juntos');
      t.checks.notIncludes('affinity notice is gone', text, 'La afinidad de compras no está disponible');
      return { observations: { totals: response.body.totals } };
    } finally {
      await session.close();
    }
  },

  'I1-CAT-01': async (t) => {
    const api = await t.api(USERS.owner);
    const response = await api.get(
      salesPath(IDS.M1, { from: '2026-11-02', to: '2026-11-04', refundView: 'sale_result', basketUnit: 'ticket' }),
    );
    t.writeJson('response.json', response.body);
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.openAnalysis({ location: 'all', from: '2026-11-02', to: '2026-11-04', section: 'categories' });
      const text = await session.bodyText();
      await session.screenshot('screen.png');
      writeFileSync(join(t.dir, 'page-text.txt'), text);
      t.checks.includes('Café amount', text, '$180.00');
      t.checks.includes('Pan amount', text, '$90.00');
      t.checks.includes('total row', text, 'Total\t$270.00');
      const rows = response.body.byCategory.map((row) => [row.label, row.netMinorUnits]);
      t.checks.eq('rows match the API', rows, [['Café', 18000], ['Pan', 9000]]);
      t.checks.eq('sum equals total', rows.reduce((sum, row) => sum + row[1], 0), response.body.totals.netMinorUnits);
      return { observations: { rows } };
    } finally {
      await session.close();
    }
  },

  'I1-CAT-02': async (t) => {
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    const original = await t.db.query(
      `select id, name, color from merchant.product_category where merchant_id=$1 order by name`,
      [IDS.M1],
    );
    try {
      await session.openAnalysis({ location: 'all', from: '2026-11-02', to: '2026-11-04', section: 'categories' });
      const before = await colors(session.page);
      await t.db.query(`update merchant.product_category set color='#123456' where merchant_id=$1 and name='Pan'`, [IDS.M1]);
      await session.page.reload({ waitUntil: 'domcontentloaded' });
      await session.page.waitForTimeout(2500);
      const after = await colors(session.page);
      await session.screenshot('screen-after.png');
      await t.db.query(`update merchant.product_category set color='not-a-color' where merchant_id=$1 and name='Pan'`, [IDS.M1]);
      await session.page.reload({ waitUntil: 'domcontentloaded' });
      await session.page.waitForTimeout(2500);
      const invalid = await colors(session.page);
      writeFileSync(join(t.dir, 'invalid-color.txt'), JSON.stringify(invalid, null, 2));
      t.writeJson('colors.json', { before, after, invalid });
      t.checks.check('before uses #D97706', before.dots.some((color) => color.includes('217, 119, 6') || color === '#D97706'), true, before);
      t.checks.check('after uses #123456', after.dots.some((color) => color.includes('18, 52, 86') || color === '#123456'), true, after);
      t.checks.check('invalid falls back to #8994a6', invalid.dots.some((color) => color.includes('137, 148, 166') || color === '#8994a6'), true, invalid);
      t.checks.check('no M2 color appears', !JSON.stringify([before, after, invalid]).includes('#7a5af8'), true, 'no M2 color');
      return { observations: { before, after, invalid } };
    } finally {
      for (const row of original) {
        await t.db.query(`update merchant.product_category set color=$2 where id=$1`, [row.id, row.color]);
      }
      await session.close();
    }
  },

  'I1-CAT-03': async (t) => {
    const zero = await t.session({ user: USERS.heavy, merchant: IDS.MZ });
    const negative = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await zero.page.goto(`${t.baseUrl}/reportes?from=2026-11-02&to=2026-11-02&refundView=sale_result&basketUnit=ticket&section=categories`, { waitUntil: 'domcontentloaded' });
      await zero.page.waitForTimeout(2200);
      const zeroText = await zero.bodyText();
      await zero.screenshot('screen-zero.png');
      await negative.page.goto(`${t.baseUrl}/reportes?from=2026-11-03&to=2026-11-03&refundView=period_movements&basketUnit=ticket&section=categories`, { waitUntil: 'domcontentloaded' });
      await negative.page.waitForTimeout(2200);
      const negativeText = await negative.bodyText();
      await negative.screenshot('screen-negative.png');
      await negative.page.route('**/operations/reports/sales/analysis?*', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        delete body.byCategory;
        await route.fulfill({ response, json: body });
      });
      await negative.page.reload({ waitUntil: 'domcontentloaded' });
      await negative.page.waitForTimeout(2200);
      const missingText = await negative.bodyText();
      await negative.screenshot('screen-missing.png');
      t.writeJson('page-text.json', { zeroText, negativeText, missingText });
      t.checks.includes('zero net message', zeroText, 'La venta neta es cero. No hay una participación porcentual que mostrar.');
      t.checks.includes(
        'negative message',
        negativeText,
        'Las devoluciones generan importes negativos. Consulta los importes por categoría; no se muestra una distribución porcentual.',
      );
      t.checks.includes('missing array message', missingText, 'El desglose por categoría no está disponible.');
      t.checks.includes('missing array retry', missingText, 'Reintentar');
      t.checks.check('no percentage mosaic in the unavailable state', !/Participación/.test(missingText), true, 'no mosaic');
      return { observations: {} };
    } finally {
      await negative.page.unroute('**/operations/reports/sales/analysis?*').catch(() => {});
      await zero.close();
      await negative.close();
    }
  },

  'I1-CAT-04': async (t) => {
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.gotoHome({ days: 30 });
      const before = await session.page.evaluate(() => {
        const svg = document.querySelector('.category-sales-report svg, .category-mosaic svg');
        const buttons = [...document.querySelectorAll('.category-sales-report button, .category-legend button')];
        return {
          svgRole: svg?.getAttribute('role'),
          svgName: svg?.getAttribute('aria-label'),
          buttons: buttons.map((button) => ({
            name: button.getAttribute('aria-label') || button.innerText.trim(),
            pressed: button.getAttribute('aria-pressed'),
          })),
        };
      });
      const first = session.page.locator('.category-sales-report button, .category-legend button').first();
      await first.focus();
      await session.page.keyboard.press('Space');
      await session.page.waitForTimeout(400);
      const pressed = await first.getAttribute('aria-pressed');
      const cells = await session.page.evaluate(() => {
        const dot = document.querySelector('.category-sales-report [aria-hidden="true"]');
        const group = document.querySelector('.category-sales-report [data-selected="true"], .category-sales-report .selected');
        return { dotHidden: dot?.getAttribute('aria-hidden'), opacity: group ? getComputedStyle(group).opacity : null };
      });
      await session.page.keyboard.press('Space');
      await session.page.waitForTimeout(300);
      const cleared = await first.getAttribute('aria-pressed');
      await session.openAnalysis({ location: 'all', from: '2026-11-02', to: '2026-11-04', section: 'categories' });
      const table = await session.page.evaluate(() => {
        const table = document.querySelector('.analysis-table table, table.analysis-table');
        return {
          caption: table?.querySelector('caption')?.innerText || null,
          rowHeaders: [...(table?.querySelectorAll('th[scope=row]') || [])].map((cell) => cell.innerText),
        };
      });
      t.writeJson('aria.json', { before, pressed, cleared, cells, table });
      await session.screenshot('screen.png');
      t.checks.eq('SVG role is img', before.svgRole, 'img');
      t.checks.eq('SVG name', before.svgName, 'Participación de venta neta por categoría');
      t.checks.check('legend names include category share and amount', before.buttons.every((button) => /\d+%/.test(button.name) && /\$/.test(button.name)), true, before.buttons);
      t.checks.eq('Space selects the legend', pressed, 'true');
      t.checks.eq('Space clears the selection', cleared, 'false');
      t.checks.eq('colour dot is aria-hidden', cells.dotHidden, 'true');
      t.checks.eq('table caption', table.caption, 'Importes exactos por categoría');
      t.checks.truthy('table has row headers', table.rowHeaders.length > 0);
      return { observations: { before, table } };
    } finally {
      await session.close();
    }
  },

  'I1-CAT-05': async (t) => {
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.gotoHome({ days: 30 });
      await session.page.getByRole('button', { name: 'Personalizar inicio', exact: true }).click();
      await session.page.waitForTimeout(400);
      const settings = await session.bodyText();
      await session.screenshot('screen-settings.png');
      await session.openAnalysis({ location: 'all', from: '2026-11-02', to: '2026-11-04', section: 'categories' });
      const detail = await session.bodyText();
      const caption = await session.page.evaluate(
        () => document.querySelector('.analysis-table table caption')?.innerText || null,
      );
      t.writeJson('page-text.json', { settings, detail });
      writeFileSync(join(t.dir, 'small-share.txt'), '<0.1% (model fixture; see category-sales unit test)\n');
      writeFileSync(join(t.dir, 'many-categories.txt'), '7 rows requires the component fixture; golden has 2 rows\n');
      t.checks.includes('indicator list includes the category widget', settings, 'Venta neta por categoría');
      t.checks.eq('detail table caption', caption, 'Importes exactos por categoría');
      t.checks.includes('home link describes the row count', detail, 'Ver las 2 categorías');
      return { observations: { caption } };
    } finally {
      await session.close();
    }
  },

  'I1-CAT-06': async (t) => {
    const original = await t.db.one(`select category_id from merchant.product where id=$1`, [IDS.P1]);
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await t.db.query(`update merchant.product set category_id=$2 where id=$1`, [IDS.P1, IDS.C2]);
      await session.openAnalysis({ location: 'all', from: '2026-11-02', to: '2026-11-04', section: 'categories' });
      const text = await session.bodyText();
      const api = await t.api(USERS.owner);
      const response = await api.get(
        salesPath(IDS.M1, { from: '2026-11-02', to: '2026-11-04', refundView: 'sale_result', basketUnit: 'ticket' }),
      );
      t.writeJson('response.json', response.body);
      await session.screenshot('screen.png');
      t.checks.eq('total stays 27000', response.body.totals.netMinorUnits, 27000);
      const pan = response.body.byCategory.find((row) => row.label === 'Pan');
      const cafe = response.body.byCategory.find((row) => row.label === 'Café');
      t.checks.eq('Café now holds 27000', cafe?.netMinorUnits, 27000);
      t.checks.check('Pan is absent or zero', !pan || pan.netMinorUnits === 0, 'absent or 0', pan ?? null);
      t.checks.includes('current-catalog note', text, 'Categorías y colores del catálogo actual.');
      return { observations: { categories: response.body.byCategory } };
    } finally {
      await t.db.query(`update merchant.product set category_id=$2 where id=$1`, [IDS.P1, original.category_id]);
      await session.close();
    }
  },

  'I1-ISO-05': async (t) => {
    const owner = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await owner.gotoHome({ days: 30 });
      const ownerText = await owner.bodyText();
      await owner.screenshot('screen-owner.png');
      t.checks.includes('owner sees 270.00', ownerText, '$270.00');
    } finally {
      await owner.close();
    }
    const denied = await t.session({ user: USERS.denied, merchant: IDS.M1, cookies: [], uiLogin: true });
    try {
      await denied.gotoHome({ days: 30, wait: false });
      await denied.page.waitForTimeout(1800);
      await denied.page.goto(`${t.baseUrl}/reportes?from=2026-11-02&to=2026-11-04&refundView=sale_result&basketUnit=ticket`, { waitUntil: 'domcontentloaded' });
      await denied.page.waitForTimeout(1800);
      const text = await denied.bodyText();
      writeFileSync(join(t.dir, 'page-text.txt'), text);
      await denied.screenshot('screen.png');
      t.checks.includes('denied state is visible', text, 'No tienes permiso para consultar estas ventas.');
      t.checks.notIncludes('old amount is absent', text, '270.00');
      t.checks.notIncludes('owner name is absent', text, 'I1 Owner');
      return { observations: {} };
    } finally {
      await denied.close();
    }
  },

  'I1-GRP-01': async (t) => {
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.openAnalysis({ location: 'all', from: '2026-11-02', to: '2026-11-04' });
      const before = await session.primaryText();
      session.clearObservations();
      await session.page.getByText('Grupos de productos', { exact: true }).click();
      await session.page.getByRole('button', { name: 'Crear grupo', exact: true }).click();
      await session.page.getByLabel('Nombre del grupo').fill('Grupo verificador');
      const checks = session.page.locator('.analysis-products input[type=checkbox]');
      await checks.nth(0).check();
      await checks.nth(1).check();
      await session.page.getByRole('button', { name: 'Guardar grupo', exact: true }).click();
      await session.page.waitForTimeout(2500);
      const text = await session.bodyText();
      const requests = reportRequests(session);
      const options = session.requests.filter((request) => request.url.includes('/analysis/options'));
      await session.screenshot('screen.png');
      t.writeJson('requests.json', { reports: requests, options });
      t.checks.includes('group button appears', text, 'Grupo verificador');
      t.checks.eq('one options request', options.length, 1);
      t.checks.eq('one report request', requests.length, 1);
      t.checks.eq('totals do not change', amount(await session.primaryText()), amount(before));
      return { observations: { reports: requests.length, options: options.length } };
    } finally {
      await t.db.query(`delete from merchant.sales_analysis_group_product where merchant_id=$1 and group_id in (select id from merchant.sales_analysis_group where merchant_id=$1 and name='Grupo verificador')`, [IDS.M1]);
      await t.db.query(`delete from merchant.sales_analysis_group where merchant_id=$1 and name='Grupo verificador'`, [IDS.M1]);
      await session.close();
    }
  },

  'I1-GRP-02': async (t) => {
    const group = await t.db.one(
      `select id, name from merchant.sales_analysis_group where merchant_id=$1 order by name limit 1`,
      [IDS.M1],
    );
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.openAnalysis({ location: 'all', from: '2026-11-02', to: '2026-11-04' });
      await session.page.getByText('Grupos de productos', { exact: true }).click();
      await session.page.getByRole('button', { name: group.name, exact: true }).click();
      session.clearObservations();
      await session.page.getByRole('button', { name: 'Eliminar grupo', exact: true }).click();
      await session.page.waitForTimeout(2500);
      const text = await session.bodyText();
      const url = session.page.url();
      await session.screenshot('screen.png');
      t.writeJson('requests.json', reportRequests(session));
      t.checks.notIncludes('group is absent', text, group.name);
      t.checks.check('the query has no deleted group key', !url.includes('groupA='), true, url);
      t.checks.check('the report response is 200', session.responses.filter((response) => response.url.includes('/analysis?')).every((response) => response.status === 200), true, session.responses.filter((response) => response.url.includes('/analysis?')));
      return { observations: { url } };
    } finally {
      await session.close();
      const existing = await t.db.one(`select id from merchant.sales_analysis_group where merchant_id=$1 and name=$2`, [IDS.M1, group.name]);
      if (!existing) {
        await t.db.query(
          `insert into merchant.sales_analysis_group(id,merchant_id,name,version,created_at,updated_at) values($1,$2,$3,1,pg_catalog.now(),pg_catalog.now())`,
          [group.id, IDS.M1, group.name],
        );
        await t.db.query(
          `insert into merchant.sales_analysis_group_product(merchant_id,group_id,product_id) values($1,$2,$3),($1,$2,$4) on conflict do nothing`,
          [IDS.M1, group.id, IDS.P1, IDS.P2],
        );
      }
    }
  },

  'I1-GRP-03': async (t) => {
    const group = await t.db.one(
      `select id, name, version from merchant.sales_analysis_group where merchant_id=$1 order by name limit 1`,
      [IDS.M1],
    );
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.openAnalysis({ location: 'all', from: '2026-11-02', to: '2026-11-04' });
      await session.page.getByText('Grupos de productos', { exact: true }).click();
      await session.page.getByRole('button', { name: group.name, exact: true }).click();
      const products = await t.db.query(
        `select product_id from merchant.sales_analysis_group_product where merchant_id=$1 and group_id=$2 order by product_id`,
        [IDS.M1, group.id],
      );
      const other = await t.api(USERS.owner);
      await other.request(
        `/api/merchants/${IDS.M1}/operations/reports/sales/analysis/groups/${group.id}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: group.name, productIds: products.map((row) => row.product_id), expectedVersion: group.version }),
        },
      );
      session.clearObservations();
      await session.page.getByRole('button', { name: 'Guardar grupo', exact: true }).click();
      await session.page.waitForTimeout(2000);
      const text = await session.bodyText();
      await session.screenshot('screen.png');
      t.writeJson('requests.json', reportRequests(session));
      t.checks.includes('conflict text is exact', text, 'El grupo cambió en otra sesión. Cierra el editor y actualiza los grupos.');
      t.checks.eq('no report request starts', reportRequests(session).length, 0);
      t.checks.includes('prior values are visible', text, 'Venta neta');
      return { observations: {} };
    } finally {
      await t.db.query(`update merchant.sales_analysis_group set version=1 where id=$1`, [group.id]);
      await session.close();
    }
  },

  'I1-GRP-04': async (t) => {
    return {
      status: 'BLOCKED',
      failure: {
        message:
          'The delayed-response race needs the i1-race.mjs release gate. The current browser route cannot prove the cache timestamp after release.',
      },
    };
  },

  'I1-GRP-05': async (t) => {
    return {
      status: 'BLOCKED',
      failure: {
        message:
          'The delayed-response delete race needs the i1-race.mjs release gate. The current browser route cannot prove invalidation after release.',
      },
    };
  },

  'I1-MET-05': async (t) => {
    const api = await t.api(USERS.owner);
    const summary = await api.get(
      `/api/merchants/${IDS.METRIC}/operations/reports/sales?range=last_7_days`,
    );
    t.writeJson('response.json', summary.body);
    t.checks.eq('net sales', summary.body.totals.netSalesMinorUnits, 49500);
    t.checks.eq('product mix sum', summary.body.productMix.reduce((sum, row) => sum + row.netMinorUnits, 0), 50000);
    t.checks.eq('items sold', summary.body.totals.itemsSold, 7);
    t.checks.eq('tips', summary.body.totals.tipsMinorUnits, 2500);
    const session = await t.session({ user: USERS.owner, merchant: IDS.METRIC });
    try {
      await session.page.goto(`${t.baseUrl}/reportes`, { waitUntil: 'domcontentloaded' });
      await session.page.waitForTimeout(1800);
      await session.page.getByRole('button', { name: 'Cobros originales', exact: true }).click();
      await session.page.waitForTimeout(1800);
      const text = await session.bodyText();
      await session.screenshot('screen.png');
      writeFileSync(join(t.dir, 'page-text.txt'), text);
      t.checks.includes('lead label', text, 'Ventas cobradas con propina');
      t.checks.includes('before-refunds note', text, 'antes de devoluciones');
      t.checks.notIncludes('lead is not labelled net sales', text, 'Ventas netas');
      t.checks.notIncludes('no product column says neto', text.toLowerCase(), 'neto');
      return { observations: { totals: summary.body.totals } };
    } finally {
      await session.close();
    }
  },

  'I1-MET-06': async (t) => {
    const api = await t.api(USERS.owner);
    const summary = await api.get(
      `/api/merchants/${IDS.METRIC}/operations/reports/sales?range=last_7_days`,
    );
    const session = await t.session({ user: USERS.owner, merchant: IDS.METRIC });
    try {
      await session.page.goto(`${t.baseUrl}/reportes`, { waitUntil: 'domcontentloaded' });
      await session.page.waitForTimeout(2200);
      const text = await session.bodyText();
      await session.screenshot('screen.png');
      const record = {
        value: summary.body.totals.discountMinorUnits,
        source: 'operations/reports/sales?range=last_7_days totals.discountMinorUnits',
        receiptsHold: 3000,
        label: (text.match(/Descuento[^\n]*\n?[^\n]*/) || [])[0] || null,
      };
      t.writeJson('discount.json', record);
      t.checks.eq('the value or the unavailable reason is recorded', Number.isInteger(record.value), true);
      t.checks.check(
        'the value is not a silent zero while receipts hold 3000',
        record.value !== 0 || /no disponible/i.test(record.label || ''),
        '3000 or a visible unavailable reason',
        record,
      );
      return { status: 'CHECK-ONLY', observations: record };
    } finally {
      await session.close();
    }
  },

  'I1-MET-09': async (t) => {
    const { execFileSync } = await import('node:child_process');
    const grep = spawnSync(
      'rg',
      ['-n', 'Ganancia|Utilidad|Contribución|availableCash|efectivoDisponible|disponible en caja', 'apps/umi-dashboard/src', 'apps/umi-api/src', '-g', '*.jsx', '-g', '*.js', '-g', '*.ts'],
      { cwd: t.run.worktree, encoding: 'utf8' },
    );
    writeFileSync(join(t.dir, 'grep.txt'), grep.stdout + grep.stderr);
    const session = await t.session({ user: USERS.owner, merchant: IDS.METRIC });
    try {
      await session.gotoHome({ days: 30 });
      const home = await session.bodyText();
      await session.screenshot('screen-home.png');
      await session.page.goto(`${t.baseUrl}/reportes`, { waitUntil: 'domcontentloaded' });
      await session.page.waitForTimeout(1200);
      await session.page.getByRole('button', { name: 'Cobros originales', exact: true }).click();
      await session.page.waitForTimeout(1800);
      const ventas = await session.bodyText();
      await session.screenshot('screen-ventas.png');
      const labels = { home, ventas };
      writeFileSync(join(t.dir, 'labels.txt'), JSON.stringify(labels, null, 2));
      t.checks.notIncludes('no cash label on a sales figure', home, 'efectivo disponible');
      t.checks.notIncludes('no profit label', home, 'Ganancia');
      t.checks.includes('Ventas lead label', ventas, 'Ventas cobradas con propina');
      t.checks.includes('net sales qualifier', home, 'sin propina, después de descuentos y devoluciones');
      t.checks.check('average ticket names the tip basis', /Ticket promedio (con|sin) propina/.test(home), true, (home.match(/Ticket promedio[^\n]*/) || [])[0]);
      t.checks.notIncludes('no product column says Neto', ventas, 'Neto');
      t.checks.notIncludes('no settled label', ventas, 'liquidado');
      t.checks.notIncludes('no zero stands for no sales', home, 'No hay ventas registradas en este periodo.');
      return { observations: { grep: grep.stdout.slice(0, 500) } };
    } finally {
      await session.close();
    }
  },

  'I1-GATE-02': async (t) => {
    const result = spawnSync('pnpm', ['check:pr'], { cwd: t.run.worktree, encoding: 'utf8', timeout: 600000 });
    writeFileSync(join(t.dir, 'check-pr.log'), `$ pnpm check:pr\n${result.stdout}${result.stderr}`);
    t.checks.eq('check:pr exit code', result.status, 0);
    t.checks.check('no lint, format, PR data or freeze error', !/error|ERR_|failed/i.test(result.stdout + result.stderr), true, result.status);
    return { observations: { exitCode: result.status } };
  },

  'I1-GATE-03': async (t) => {
    const { execFileSync } = await import('node:child_process');
    const catalog = execFileSync('rg', ['-n', '2\\.5[0-9]\\.[0-9]', 'packages/contract/src/catalog.ts'], { cwd: t.run.worktree, encoding: 'utf8' });
    const contract = execFileSync('rg', ['-n', 'basketState|SalesAnalysisBasketState|BASKETS_TOO_COMPLEX', 'packages/contract/src/sales-analysis.ts'], { cwd: t.run.worktree, encoding: 'utf8' });
    writeFileSync(join(t.dir, 'contract-invariants.txt'), catalog + contract);
    writeFileSync(join(t.dir, 'contract-sha.txt'), execFileSync('sha256sum', ['packages/contract/src/sales-analysis.ts'], { cwd: t.run.worktree, encoding: 'utf8' }));
    const generate = spawnSync('pnpm', ['--filter', '@umi/contract', 'generate:check'], { cwd: t.run.worktree, encoding: 'utf8', timeout: 300000 });
    writeFileSync(join(t.dir, 'generate-check.txt'), generate.stdout + generate.stderr);
    t.writeJson('contract.json', { version: catalog.trim(), invariants: contract.trim() });
    t.checks.check('contract version is 2.54.0 or later', /2\.5[4-9]\./.test(catalog), true, catalog.trim());
    t.checks.includes('basket state exists', contract, 'basketState');
    t.checks.includes('basket code exists', contract, 'BASKETS_TOO_COMPLEX');
    t.checks.eq('generate:check exits 0', generate.status, 0);
    return { observations: { version: catalog.trim() } };
  },

  'I1-GATE-04': async (t) => {
    const commands = [
      ['check:pr', ['check:pr']],
      ['typecheck', ['--filter', '@umi/api', 'typecheck']],
      ['api-test', ['--filter', '@umi/api', 'test']],
      ['dashboard-test', ['--filter', '@umi/dashboard', 'test']],
      ['dashboard-build', ['--filter', '@umi/dashboard', 'build']],
    ];
    const results = [];
    for (const [name, args] of commands) {
      const result = spawnSync('pnpm', args, { cwd: t.run.worktree, encoding: 'utf8', timeout: 900000 });
      writeFileSync(join(t.dir, `${name}.txt`), `$ pnpm ${args.join(' ')}\n${result.stdout}${result.stderr}`);
      results.push({ name, status: result.status });
      t.checks.eq(`${name} exits 0`, result.status, 0);
    }
    return { observations: { results } };
  },

  'I1-GATE-05': async (t) => {
    const files = [
      'manifest.json',
      'manifest.sha256',
      'verdict.md',
      'verdict.json',
    ];
    const present = files.map((name) => ({ name, path: join(t.run.out, name), exists: false }));
    for (const entry of present) {
      try {
        const { statSync } = await import('node:fs');
        entry.exists = statSync(entry.path).isFile();
      } catch {
        entry.exists = false;
      }
    }
    t.writeJson('manifest.json', present);
    t.checks.truthy('the final manifest exists', present.find((entry) => entry.name === 'manifest.json').exists);
    t.checks.truthy('the manifest hash exists', present.find((entry) => entry.name === 'manifest.sha256').exists);
    t.checks.check(
      'the verdict is verifier-owned',
      false,
      'a verifier verdict names the head, CI, browser evidence and performance sample',
      'not produced by the builder',
    );
    return {
      status: 'BLOCKED',
      failure: { message: 'GATE-05 needs the verifier verdict and verdict.json after all case results.' },
      observations: { present },
    };
  },
};
