// API-first cases: optional analysis, isolation, group races, and metric reads.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ApiClient, Database, IDS, USERS, equalJson, salesPath } from './i1-lib.mjs';

const errorCode = (body) => body?.error?.code ?? body?.code ?? null;
const errorMessage = (body) => body?.error?.message ?? body?.message ?? null;

function allKeys(value, prefix = '', output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => allKeys(item, `${prefix}[${index}]`, output));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      output.push(prefix ? `${prefix}.${key}` : key);
      allKeys(item, prefix ? `${prefix}.${key}` : key, output);
    }
  }
  return output;
}
function moneyEntries(value, prefix = '', output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => moneyEntries(item, `${prefix}[${index}]`, output));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      if (/MinorUnits$/.test(key) && typeof item === 'number')
        output.push({ key: next, value: item });
      moneyEntries(item, next, output);
    }
  }
  return output;
}

export const API_CASES = {
  'I1-OPT-01': async (t) => {
    const api = await t.api(USERS.heavy);
    const response = await api.get(
      salesPath(IDS.HEAVY, {
        from: '2026-11-02',
        to: '2026-11-03',
        refundView: 'sale_result',
        basketUnit: 'ticket',
      }),
    );
    t.writeJson('response.json', response.body);
    t.writeJson('basket-state.json', response.body.basketState);
    t.checks.eq('status is 200', response.status, 200);
    t.checks.eq('basketState', response.body.basketState, {
      state: 'unavailable',
      code: 'BASKETS_TOO_COMPLEX',
    });
    for (const key of ['coverage', 'unitsDistribution', 'pairs', 'selectedGroups']) {
      t.checks.check(
        `${key} is absent`,
        !(key in response.body),
        'absent',
        key in response.body ? 'present' : 'absent',
      );
    }
    t.checks.eq('totals', response.body.totals, {
      tickets: 3,
      units: 452,
      merchandiseMinorUnits: 452000,
      refundsMinorUnits: 0,
      netMinorUnits: 452000,
      averageTicketMinorUnits: 150667,
      unitsPerTicket: 150.66666666666666,
      tipsMinorUnits: 0,
      discountsMinorUnits: 0,
    });
    t.checks.check(
      'no top-level error',
      !('error' in response.body),
      'absent',
      'error' in response.body,
    );
    t.checks.check(
      'no top-level code',
      !('code' in response.body),
      'absent',
      'code' in response.body,
    );
    return { observations: { basketState: response.body.basketState } };
  },

  'I1-OPT-05': async (t) => {
    const api = await t.api(USERS.heavy);
    const requests = [
      ['large', IDS.LARGE, 422, 'REPORT_RANGE_TOO_LARGE'],
      ['catalog', IDS.CATALOG, 422, 'REPORT_CATALOG_TOO_LARGE'],
      ['currency', IDS.MIXED, 409, 'REPORT_CURRENCY_MISMATCH'],
      ['group', IDS.M1, 422, 'REPORT_GROUP_INVALID'],
      ['overflow', IDS.OVERFLOW, 422, 'REPORT_AMOUNT_OUT_OF_RANGE'],
    ];
    const responses = {};
    for (const [name, merchant, status, code] of requests) {
      const path =
        name === 'group'
          ? `${salesPath(merchant, {
              from: '2026-11-02',
              to: '2026-11-04',
              refundView: 'sale_result',
              basketUnit: 'ticket',
            })}&groupA=missing-group`
          : salesPath(merchant, {
              from: '2026-11-01',
              to: '2026-11-30',
              refundView: 'sale_result',
              basketUnit: 'ticket',
            });
      const client = name === 'group' ? await t.api(USERS.owner) : api;
      const response = await client.get(path, { allowError: true });
      responses[name] = {
        status: response.status,
        code: errorCode(response.body),
        body: response.body,
      };
      t.writeJson(`response-${name}.json`, response.body);
      t.checks.eq(`${name} status`, response.status, status);
      t.checks.eq(`${name} code`, errorCode(response.body), code);
      t.checks.check(
        `${name} has no totals`,
        !('totals' in response.body),
        'absent',
        'totals' in response.body,
      );
    }
    const heavy = await api.get(
      salesPath(IDS.HEAVY, {
        from: '2026-11-02',
        to: '2026-11-03',
        refundView: 'sale_result',
        basketUnit: 'ticket',
      }),
    );
    t.writeJson('response-heavy.json', heavy.body);
    t.checks.eq('heavy is 200', heavy.status, 200);
    t.checks.eq('heavy basket code', heavy.body.basketState?.code, 'BASKETS_TOO_COMPLEX');
    t.checks.check('heavy is not 422', heavy.status !== 422, 'not 422', heavy.status);
    return { observations: responses };
  },

  'I1-ISO-01': async (t) => {
    const api = await t.api(USERS.owner);
    const response = await api.get(salesPath(IDS.M2, { from: '2026-11-02', to: '2026-11-04' }), {
      allowError: true,
    });
    t.writeJson('response.json', response.body);
    t.checks.eq('status', response.status, 404);
    t.checks.eq('message', errorMessage(response.body), 'merchant_not_found');
    for (const key of ['totals', 'byCategory']) {
      t.checks.check(`${key} is absent`, !(key in response.body), 'absent', key in response.body);
    }
    return { observations: { status: response.status } };
  },

  'I1-ISO-02': async (t) => {
    const api = await t.api(USERS.branch);
    const denied = await api.get(
      salesPath(IDS.M1, {
        from: '2026-11-02',
        to: '2026-11-04',
        locationId: IDS.L2,
        refundView: 'sale_result',
        basketUnit: 'ticket',
      }),
      { allowError: true },
    );
    const owned = await api.get(
      salesPath(IDS.M1, {
        from: '2026-11-02',
        to: '2026-11-04',
        refundView: 'sale_result',
        basketUnit: 'ticket',
      }),
    );
    t.writeJson('response-l2.json', denied.body);
    t.writeJson('response-no-location.json', owned.body);
    t.checks.eq('L2 status', denied.status, 403);
    t.checks.check(
      'L2 refusal names location_switch_denied',
      `${errorCode(denied.body)} ${errorMessage(denied.body)}`.includes('location_switch_denied'),
      true,
      { code: errorCode(denied.body), message: errorMessage(denied.body) },
    );
    t.checks.eq('no-location status', owned.status, 200);
    const locations = (owned.body.byLocation || []).map((row) => row.label);
    t.checks.eq('only L1 data', locations, ['Centro']);
    return { observations: { locations } };
  },

  'I1-ISO-03': async (t) => {
    const api = await t.api(USERS.denied);
    const response = await api.get(salesPath(IDS.M1, { from: '2026-11-02', to: '2026-11-04' }), {
      allowError: true,
    });
    t.writeJson('response.json', response.body);
    t.checks.eq('status', response.status, 403);
    t.checks.eq('code', errorCode(response.body), 'PERMISSION_DENIED');
    t.checks.check('no totals', !('totals' in response.body), 'absent', 'totals' in response.body);
    return { observations: { status: response.status } };
  },

  'I1-ISO-06': async (t) => {
    const other = await t.api(USERS.other);
    const options = await other.get(
      `/api/merchants/${IDS.M2}/operations/reports/sales/analysis/options`,
    );
    t.writeJson('options.json', options.body);
    const names = (options.body.groups || []).map((group) => group.name);
    t.checks.check('M2 options have no group G', !names.includes('Grupo G'), false, names);
    t.checks.eq('M2 group list is empty', names.length, 0);

    const rlsPool = new Database(t.run.dbName, { user: 'api_login', password: 'i1_local_api' });
    let rlsRows;
    try {
      const client = await rlsPool.pool.connect();
      try {
        await client.query('begin');
        await client.query(
          `select set_config('app.current_merchant',$1,true), set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)`,
          [IDS.M2, IDS.U5],
        );
        rlsRows = (
          await client.query(
            `select count(*)::int n from merchant.sales_analysis_group where merchant_id=$1`,
            [IDS.M1],
          )
        ).rows[0].n;
        await client.query('commit');
      } finally {
        client.release();
      }
    } finally {
      await rlsPool.close();
    }
    t.writeJson('rls.json', { merchantContext: IDS.M2, queriedMerchant: IDS.M1, rows: rlsRows });
    t.checks.eq('RLS returns 0 rows', rlsRows, 0);

    const groupId = '6e2c1a9b-6b5f-5a4d-9d7a-55e2f0a1c9b2';
    const save = await other.request(
      `/api/merchants/${IDS.M2}/operations/reports/sales/analysis/groups/${groupId}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Grupo H', productIds: [IDS.P3], expectedVersion: 0 }),
        allowError: true,
      },
    );
    t.writeJson('response.json', save.body);
    t.checks.eq('save H status', save.status, 200);
    t.checks.eq('save H name', save.body?.name, 'Grupo H');

    const m1 = await t.db.one(
      `select name, version from merchant.sales_analysis_group where merchant_id=$1 and name='Grupo G'`,
      [IDS.M1],
    );
    const m2 = await t.db.one(
      `select name, version from merchant.sales_analysis_group where merchant_id=$1 and name='Grupo H'`,
      [IDS.M2],
    );
    t.checks.eq('M1 G is unchanged', m1, { name: 'Grupo G', version: 1 });
    t.checks.truthy('M2 H exists', Boolean(m2));
    await t.db.query(
      `delete from merchant.sales_analysis_group_product where merchant_id=$1 and group_id=$2`,
      [IDS.M2, groupId],
    );
    await t.db.query(`delete from merchant.sales_analysis_group where merchant_id=$1 and id=$2`, [
      IDS.M2,
      groupId,
    ]);
    return { observations: { rlsRows, names } };
  },

  'I1-GRP-06': async (t) => {
    const group = await t.db.one(
      `select g.id, g.name, g.version from merchant.sales_analysis_group g where g.merchant_id=$1 order by g.name limit 1`,
      [IDS.M1],
    );
    const products = await t.db.query(
      `select product_id from merchant.sales_analysis_group_product where merchant_id=$1 and group_id=$2 order by product_id`,
      [IDS.M1, group.id],
    );
    const productIds = products.map((row) => row.product_id);
    const a = await t.api(USERS.owner);
    const b = await t.api(USERS.owner);
    const url = `/api/merchants/${IDS.M1}/operations/reports/sales/analysis/groups/${group.id}`;
    const body = (name) => JSON.stringify({ name, productIds, expectedVersion: group.version });
    const first = await a.request(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: body('Ganador A'),
      allowError: true,
    });
    const second = await b.request(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: body('Ganador B'),
      allowError: true,
    });
    t.writeJson('response-a.json', first.body);
    t.writeJson('response-b.json', second.body);
    const statuses = [first.status, second.status].sort((x, y) => x - y);
    t.checks.eq('one 200 and one 409', statuses, [200, 409]);
    const loser = first.status === 409 ? first : second;
    t.checks.eq('loser code', errorCode(loser.body), 'REPORT_GROUP_CHANGED');
    const stored = await t.db.one(
      `select name, version from merchant.sales_analysis_group where id=$1`,
      [group.id],
    );
    t.writeJson('options.json', { stored, groupId: group.id });
    t.checks.eq('stored version is 2', stored.version, 2);
    t.checks.eq(
      'stored name is the winning write',
      stored.name,
      first.status === 200 ? 'Ganador A' : 'Ganador B',
    );
    await t.db.query(
      `update merchant.sales_analysis_group set name=$2, version=$3, updated_at=pg_catalog.now() where id=$1`,
      [group.id, group.name, group.version],
    );
    return { observations: { statuses, stored } };
  },

  'I1-MET-01': async (t) => {
    const oracle = join(t.fixtures, 'business/fixture-check.py');
    const result = spawnSync('python3', [oracle], { encoding: 'utf8', timeout: 120000 });
    (await import('node:fs')).writeFileSync(
      join(t.dir, 'fixture-check.txt'),
      `$ python3 ${oracle}\n${result.stdout}${result.stderr}`,
    );
    t.checks.eq('oracle exit code', result.status, 0);
    const output = result.stdout;
    const expected = [
      "TOTAL {'tickets': 2, 'units': 1, 'merch': 25000, 'refunds': 17000, 'net': 8000, 'tips': 0, 'disc': 1000, 'avg': 4000, 'upt': 0.5}",
      "TOTAL {'tickets': 2, 'units': 4, 'merch': 25000, 'refunds': 0, 'net': 25000, 'tips': 2000, 'disc': 1000, 'avg': 12500, 'upt': 2.0}",
      "TOTAL {'tickets': 0, 'units': -3, 'merch': 0, 'refunds': 17000, 'net': -17000, 'tips': -2000, 'disc': 0, 'avg': None, 'upt': None}",
      "TOTAL {'tickets': 4, 'units': 3, 'merch': 47000, 'refunds': 24000, 'net': 23000, 'tips': 500, 'disc': 3000, 'avg': 5750, 'upt': 0.75}",
    ];
    for (const line of expected)
      t.checks.includes(`oracle line: ${line.slice(7, 40)}`, output, line);
    t.checks.includes(
      'Ventas summary values',
      output,
      "{'netSales': 49500, 'orders': 4, 'avg': 12375, 'tips': 2500, 'itemsSold': 7, 'productMix': 50000}",
    );
    return { observations: { exitCode: result.status } };
  },

  'I1-MET-02': async (t) => {
    const api = await t.api(USERS.owner);
    const get = async (from, to, view, name) => {
      const response = await api.get(
        salesPath(IDS.METRIC, { from, to, refundView: view, basketUnit: 'ticket' }),
      );
      t.writeJson(`${name}.json`, response.body);
      return response.body;
    };
    const a = await get('2026-11-02', '2026-11-02', 'sale_result', 'response-a');
    const b = await get('2026-11-02', '2026-11-02', 'period_movements', 'response-b');
    const c = await get('2026-11-03', '2026-11-03', 'period_movements', 'response-c');
    t.checks.eq('A tickets', a.totals.tickets, 2);
    t.checks.eq('A net', a.totals.netMinorUnits, 8000);
    t.checks.eq('A refunds', a.totals.refundsMinorUnits, 17000);
    t.checks.eq('A tips', a.totals.tipsMinorUnits, 0);
    t.checks.eq('B net', b.totals.netMinorUnits, 25000);
    t.checks.eq('B refunds', b.totals.refundsMinorUnits, 0);
    t.checks.eq('B units', b.totals.units, 4);
    t.checks.eq('C net', c.totals.netMinorUnits, -17000);
    t.checks.eq('C tickets', c.totals.tickets, 0);
    t.checks.eq('C average', c.totals.averageTicketMinorUnits, null);

    const session = await t.session({ merchant: IDS.METRIC, location: IDS.METRIC_L1 });
    try {
      await session.page.goto(
        `${t.baseUrl}/reportes?from=2026-11-03&to=2026-11-03&locationId=${IDS.METRIC_L1}&refundView=period_movements&basketUnit=ticket&section=overview`,
        { waitUntil: 'domcontentloaded' },
      );
      await session.page.waitForTimeout(2500);
      const text = await session.bodyText();
      (await import('node:fs')).writeFileSync(join(t.dir, 'page-text.txt'), text);
      await session.screenshot('screen-c.png');
      t.checks.includes('negative money is visible', text, '-$170.00');
      t.checks.includes(
        'average uses the unavailable mark',
        text,
        'Ticket promedio sin propina\n—',
      );
      t.checks.check(
        'average is not zero',
        !/Ticket promedio sin propina\n\$0\.00/.test(text),
        'not $0.00',
        (text.match(/Ticket promedio sin propina\n([^\n]*)/) || [])[1],
      );
      t.checks.includes(
        'analysis label names the qualifier',
        text,
        'sin propina, después de descuentos y devoluciones',
      );
    } finally {
      await session.close();
    }
    return { observations: { a: a.totals, b: b.totals, c: c.totals } };
  },

  'I1-MET-03': async (t) => {
    const api = await t.api(USERS.owner);
    const d = (
      await api.get(
        salesPath(IDS.METRIC, {
          from: '2026-11-01',
          to: '2026-11-30',
          refundView: 'sale_result',
          basketUnit: 'ticket',
        }),
      )
    ).body;
    const e = (
      await api.get(
        salesPath(IDS.METRIC, {
          from: '2026-11-01',
          to: '2026-11-30',
          refundView: 'period_movements',
          basketUnit: 'ticket',
        }),
      )
    ).body;
    t.writeJson('response-d.json', d);
    t.writeJson('response-e.json', e);
    const locations = Object.fromEntries(
      d.byLocation.map((row) => [row.label, { net: row.netMinorUnits, tickets: row.tickets }]),
    );
    t.checks.eq('Centro', locations.Centro, { net: 16000, tickets: 3 });
    t.checks.eq('Norte', locations.Norte, { net: 7000, tickets: 1 });
    t.checks.eq('location sum', locations.Centro.net + locations.Norte.net, d.totals.netMinorUnits);
    t.checks.eq('D category rows', d.byCategory.length, 2);
    t.checks.check(
      'no Postres category row',
      !d.byCategory.some((row) => row.label === 'Postres'),
      'absent',
      d.byCategory.map((row) => row.label),
    );
    const sumD = d.byCategory.reduce((sum, row) => sum + row.netMinorUnits, 0);
    const sumE = e.byCategory.reduce((sum, row) => sum + row.netMinorUnits, 0);
    t.checks.eq('D category sum', sumD, 23000);
    t.checks.eq('E category sum', sumE, 23000);

    const session = await t.session({ merchant: IDS.METRIC, location: IDS.METRIC_L1 });
    try {
      await session.openAnalysis({
        location: 'all',
        from: '2026-11-01',
        to: '2026-11-08',
        section: 'locations',
      });
      const locationsText = await session.bodyText();
      await session.screenshot('screen-locations.png');
      t.checks.includes('Centro value', locationsText, '$160.00');
      t.checks.includes('Norte value', locationsText, '$70.00');
      await session.page.getByRole('button', { name: 'Categorías', exact: true }).click();
      await session.page.waitForTimeout(600);
      const categoryText = await session.bodyText();
      t.writeJson('page-text.json', { locationsText, categoryText });
      await session.screenshot('screen-categories.png');
      t.checks.includes(
        'Postres has no sales',
        categoryText.toLowerCase(),
        'sin ventas en el periodo',
      );
    } finally {
      await session.close();
    }
    return { observations: { locations, sumD, sumE } };
  },

  'I1-MET-04': async (t) => {
    const api = await t.api(USERS.owner);
    const d = (
      await api.get(
        salesPath(IDS.METRIC, {
          from: '2026-11-01',
          to: '2026-11-30',
          refundView: 'sale_result',
          basketUnit: 'ticket',
        }),
      )
    ).body;
    t.writeJson('response.json', d);
    const hour = d.byHour.find((row) => row.key === '01');
    const day4 = d.byDay.find((row) => row.key === '2026-11-04');
    const day5 = d.byDay.find((row) => row.key === '2026-11-05');
    t.checks.eq('hour 01 net', hour?.netMinorUnits, 8000);
    t.checks.truthy('day 2026-11-04 exists', Boolean(day4));
    t.checks.check('no 2026-11-05 row', !day5, 'absent', day5 ?? null);
    const session = await t.session({ merchant: IDS.METRIC, location: IDS.METRIC_L1 });
    try {
      await session.page.goto(
        `${t.baseUrl}/reportes?from=2026-11-01&to=2026-11-30&locationId=${IDS.METRIC_L1}&refundView=sale_result&basketUnit=ticket&section=time`,
        { waitUntil: 'domcontentloaded' },
      );
      await session.page.waitForTimeout(2200);
      await session.screenshot('screen.png');
      t.checks.includes('hour 01 is visible', await session.bodyText(), '01:00');
    } finally {
      await session.close();
    }
    return { observations: { hour, day4, day5 } };
  },

  'I1-MET-07': async (t) => {
    const api = await t.api(USERS.owner);
    const bodies = [];
    for (const [name, from, to, view] of [
      ['A', '2026-11-02', '2026-11-02', 'sale_result'],
      ['B', '2026-11-02', '2026-11-02', 'period_movements'],
      ['C', '2026-11-03', '2026-11-03', 'period_movements'],
      ['D', '2026-11-01', '2026-11-30', 'sale_result'],
      ['E', '2026-11-01', '2026-11-30', 'period_movements'],
    ]) {
      bodies.push(
        (await api.get(salesPath(IDS.METRIC, { from, to, refundView: view, basketUnit: 'ticket' })))
          .body,
      );
    }
    const summary = (
      await api.get(`/api/merchants/${IDS.METRIC}/operations/reports/sales?range=last_7_days`)
    ).body;
    bodies.push(summary);
    const money = bodies.flatMap((body) => moneyEntries(body));
    t.writeJson('types.json', money);
    t.checks.truthy(
      'every money field is safe integer',
      money.every((entry) => Number.isSafeInteger(entry.value)),
    );
    const keys = [...new Set(bodies.flatMap((body) => allKeys(body)))];
    (await import('node:fs')).writeFileSync(join(t.dir, 'keys.txt'), keys.join('\n') + '\n');
    const forbidden = ['availableCash', 'efectivoDisponible', 'profit', 'contribution', 'margin'];
    for (const key of forbidden) {
      t.checks.check(
        `no forbidden key ${key}`,
        !keys.some((item) => item.toLowerCase().includes(key.toLowerCase())),
        'absent',
        keys.filter((item) => item.toLowerCase().includes(key.toLowerCase())),
      );
    }
    return { observations: { moneyFields: money.length } };
  },

  'I1-MET-08': async (t) => {
    const api = await t.api(USERS.owner);
    const d = (
      await api.get(
        salesPath(IDS.METRIC, {
          from: '2026-11-01',
          to: '2026-11-30',
          refundView: 'sale_result',
          basketUnit: 'ticket',
        }),
      )
    ).body;
    t.writeJson('response.json', d);
    const hour = d.byHour.find((row) => row.key === '10');
    t.checks.eq('hour 10 tickets', hour?.tickets, 1);
    t.checks.eq('hour 10 net', hour?.netMinorUnits, 0);
    t.checks.eq('hour 10 average', hour?.averageTicketMinorUnits, 0);
    const session = await t.session({ merchant: IDS.METRIC, location: IDS.METRIC_L1 });
    try {
      await session.page.goto(
        `${t.baseUrl}/reportes?from=2026-11-01&to=2026-11-30&locationId=${IDS.METRIC_L1}&refundView=sale_result&basketUnit=ticket&section=time`,
        { waitUntil: 'domcontentloaded' },
      );
      await session.page.waitForTimeout(2200);
      const text = await session.bodyText();
      await session.screenshot('screen.png');
      t.checks.includes('hour 10 shows a zero average', text, '$0.00');
      t.checks.notIncludes('hour 10 does not say sin datos', text.toLowerCase(), 'sin datos');
    } finally {
      await session.close();
    }
    return { observations: { hour } };
  },

  'I1-GATE-01': async (t) => {
    const { execFileSync } = await import('node:child_process');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: t.run.worktree,
      encoding: 'utf8',
    }).trim();
    const checkedOut = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: t.run.worktree,
      encoding: 'utf8',
    }).trim();
    const ancestor = (() => {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', t.run.baseline, head], {
          cwd: t.run.worktree,
        });
        return 0;
      } catch {
        return 1;
      }
    })();
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: t.run.worktree,
      encoding: 'utf8',
    });
    let candidateAncestor = 1;
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', t.run.candidate, head], {
        cwd: t.run.worktree,
      });
      candidateAncestor = 0;
    } catch {
      candidateAncestor = 1;
    }
    t.writeJson('gate.json', {
      head,
      candidate: t.run.candidate,
      checkedOut,
      baseline: t.run.baseline,
      ancestor,
      candidateAncestor,
      clean: status.trim() === '',
    });
    (await import('node:fs')).writeFileSync(join(t.dir, 'git-status.txt'), status);
    t.checks.eq('local head equals the checked-out head', head, checkedOut);
    t.checks.eq('the candidate is an ancestor of the local head', candidateAncestor, 0);
    t.checks.eq('baseline is an ancestor', ancestor, 0);
    t.checks.eq('tracked tree is clean', status.trim(), '');
    return { observations: { head, ancestor } };
  },
};
