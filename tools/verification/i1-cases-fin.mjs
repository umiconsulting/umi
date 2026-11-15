// I1 financial equality cases (FIN-01 to FIN-06).
import { IDS, USERS, equalJson, salesPath } from './i1-lib.mjs';

const GOLDEN = {
  from: '2026-11-02',
  to: '2026-11-04',
  refundView: 'sale_result',
  basketUnit: 'ticket',
};

function moneyFields(value, path = '', output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => moneyFields(item, `${path}[${index}]`, output));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const next = path ? `${path}.${key}` : key;
      if (/MinorUnits$/.test(key) && typeof item === 'number') output.push({ path: next, value: item });
      moneyFields(item, next, output);
    }
  }
  return output;
}

function normalized(body) {
  const clone = structuredClone(body);
  clone.capturedAt = '<capturedAt>';
  return clone;
}

export const FIN_CASES = {
  'I1-FIN-01': async (t) => {
    const api = await t.api(USERS.owner);
    const response = await api.get(salesPath(IDS.M1, GOLDEN));
    t.writeJson('response.json', response.body);
    const body = response.body;
    t.checks.eq('status is 200', response.status, 200);
    t.checks.eq('totals', body.totals, {
      tickets: 3,
      units: 3,
      merchandiseMinorUnits: 36000,
      refundsMinorUnits: 9000,
      netMinorUnits: 27000,
      averageTicketMinorUnits: 9000,
      unitsPerTicket: 1,
      tipsMinorUnits: 1500,
      discountsMinorUnits: 4000,
    });
    t.checks.eq('basketState', body.basketState, { state: 'complete', code: null });
    t.checks.eq('coverage', body.coverage, {
      baskets: 3,
      ticketsWithVisit: 0,
      ticketsWithoutVisit: 3,
      ticketsWithoutProducts: 0,
      refundedUnits: 1,
      legacyDiscountTickets: 0,
      pairsAvailable: 1,
      categoriesUseCurrentCatalog: true,
    });
    t.checks.eq('byHour keys', body.byHour.map((row) => row.key), ['03', '09', '10']);
    const categories = Object.fromEntries(body.byCategory.map((row) => [row.label, row.netMinorUnits]));
    t.checks.eq('byCategory net', categories, { 'Café': 18000, Pan: 9000 });
    t.checks.eq('pairs length', body.pairs.length, 1);
    const money = moneyFields(body);
    t.checks.truthy(
      'every money field is a safe integer',
      money.every((entry) => Number.isSafeInteger(entry.value)),
    );
    t.log(`money fields: ${money.length}`);
    return { observations: { totals: body.totals, coverage: body.coverage, pairs: body.pairs.length } };
  },

  'I1-FIN-02': async (t) => {
    const api = await t.api(USERS.owner);
    const response = await api.get(
      salesPath(IDS.M1, {
        from: '2026-11-03',
        to: '2026-11-03',
        refundView: 'period_movements',
        basketUnit: 'ticket',
      }),
    );
    t.writeJson('response.json', response.body);
    const body = response.body;
    t.checks.eq('status is 200', response.status, 200);
    t.checks.eq('tickets', body.totals.tickets, 0);
    t.checks.eq('netMinorUnits', body.totals.netMinorUnits, -9000);
    t.checks.eq('refundsMinorUnits', body.totals.refundsMinorUnits, 9000);
    t.checks.eq('averageTicketMinorUnits', body.totals.averageTicketMinorUnits, null);
    t.checks.eq('units', body.totals.units, -1);
    t.checks.eq('byHour[0].key', body.byHour[0]?.key, '12');
    t.checks.eq('coverage.baskets', body.coverage?.baskets, 0);
    t.checks.eq('coverage.refundedUnits', body.coverage?.refundedUnits, 1);
    return { observations: { totals: body.totals } };
  },

  'I1-FIN-03': async (t) => {
    let baselineSale;
    let baselineMovements;
    if (t.run.baselineApiUrl) {
      const { ApiClient } = await import('./i1-lib.mjs');
      const baseline = new ApiClient(t.run.baselineApiUrl);
      await baseline.login(USERS.owner);
      baselineSale = await baseline.get(salesPath(IDS.M1, GOLDEN));
      baselineMovements = await baseline.get(
        salesPath(IDS.M1, {
          from: '2026-11-03',
          to: '2026-11-03',
          refundView: 'period_movements',
          basketUnit: 'ticket',
        }),
      );
    } else {
      const { readJson } = await import('./i1-lib.mjs');
      try {
        baselineSale = { body: readJson(`${t.run.baselineDir}/sale-result.json`) };
        baselineMovements = { body: readJson(`${t.run.baselineDir}/period-movements.json`) };
      } catch {
        return {
          status: 'BLOCKED',
          failure: {
            message:
              'No baseline response is stored. Capture baseline sale-result.json and period-movements.json first.',
          },
        };
      }
    }
    const api = await t.api(USERS.owner);
    const sale = await api.get(salesPath(IDS.M1, GOLDEN));
    const movements = await api.get(
      salesPath(IDS.M1, {
        from: '2026-11-03',
        to: '2026-11-03',
        refundView: 'period_movements',
        basketUnit: 'ticket',
      }),
    );
    t.writeJson('baseline-sale-result.json', normalized(baselineSale.body));
    t.writeJson('baseline-period-movements.json', normalized(baselineMovements.body));
    t.writeJson('candidate-sale-result.json', normalized(sale.body));
    t.writeJson('candidate-period-movements.json', normalized(movements.body));
    const dimensions = ['byHour', 'byDay', 'byWeekday', 'byMonth', 'byLocation', 'unitsDistribution', 'pairs', 'selectedGroups'];
    const failures = [];
    for (const key of dimensions) {
      if (!equalJson(sale.body[key], baselineSale.body[key])) failures.push(`sale_result.${key}`);
      if (!equalJson(movements.body[key], baselineMovements.body[key])) failures.push(`period_movements.${key}`);
    }
    t.checks.eq('all dimensions match in both views', failures, []);
    return { observations: { failures } };
  },

  'I1-FIN-04': async (t) => {
    const { readJson, salesPath } = await import('./i1-lib.mjs');
    let body;
    try {
      body = readJson(`${t.dir}/../I1-FIN-01/response.json`);
    } catch {
      const api = await t.api(USERS.owner);
      body = (await api.get(salesPath(IDS.M1, GOLDEN))).body;
    }
    const totals = body.totals;
    t.checks.eq(
      'net = merchandise - refunds',
      totals.netMinorUnits,
      totals.merchandiseMinorUnits - totals.refundsMinorUnits,
    );
    t.checks.eq(
      'average = round(net / tickets)',
      totals.averageTicketMinorUnits,
      Math.round(totals.netMinorUnits / totals.tickets),
    );
    t.checks.eq('units per ticket', totals.unitsPerTicket, totals.units / totals.tickets);
    const money = moneyFields(body);
    t.checks.truthy('all money is integer', money.every((entry) => Number.isInteger(entry.value)));
    t.checks.truthy(
      'all money is below Number.MAX_SAFE_INTEGER',
      money.every((entry) => entry.value <= Number.MAX_SAFE_INTEGER),
    );
    return { observations: { moneyFields: money.length } };
  },

  'I1-FIN-05': async (t) => {
    const api = await t.api(USERS.owner);
    const sale = (await api.get(salesPath(IDS.M1, GOLDEN))).body;
    const movements = (
      await api.get(
        salesPath(IDS.M1, {
          from: '2026-11-03',
          to: '2026-11-03',
          refundView: 'period_movements',
          basketUnit: 'ticket',
        }),
      )
    ).body;
    t.writeJson('sale-result.json', sale);
    t.writeJson('period-movements.json', movements);
    const saleRows = Object.fromEntries(sale.byCategory.map((row) => [row.label, row]));
    t.checks.eq('Café sale_result net', saleRows['Café']?.netMinorUnits, 18000);
    t.checks.eq('Pan sale_result net', saleRows.Pan?.netMinorUnits, 9000);
    const panMovements = movements.byCategory.find((row) => row.label === 'Pan');
    const cafeMovements = movements.byCategory.find((row) => row.label === 'Café');
    t.checks.eq('Pan period_movements net', panMovements?.netMinorUnits, -9000);
    t.checks.truthy('Café period_movements is absent or zero', !cafeMovements || cafeMovements.netMinorUnits === 0);
    let saleSum = 0n;
    for (const row of sale.byCategory) {
      t.checks.eq(
        `${row.label}: net = merchandise - refunds`,
        row.netMinorUnits,
        row.merchandiseMinorUnits - row.refundsMinorUnits,
      );
      saleSum += BigInt(row.netMinorUnits);
    }
    t.checks.eq('BigInt category sum equals total', String(saleSum), String(sale.totals.netMinorUnits));
    let movementSum = 0n;
    for (const row of movements.byCategory) movementSum += BigInt(row.netMinorUnits);
    t.checks.eq(
      'BigInt movement sum equals total',
      String(movementSum),
      String(movements.totals.netMinorUnits),
    );
    return { observations: { saleRows: sale.byCategory, movementRows: movements.byCategory } };
  },

  'I1-FIN-06': async (t) => {
    const api = await t.api(USERS.owner);
    const first = await api.get(
      `${salesPath(IDS.M1, {})}?from=2026-11-02&to=2026-11-04&refundView=sale_result&basketUnit=ticket`,
    );
    const second = await api.get(
      `${salesPath(IDS.M1, {})}?basketUnit=ticket&to=2026-11-04&refundView=sale_result&from=2026-11-02`,
    );
    t.writeJson('response-1.json', normalized(first.body));
    t.writeJson('response-2.json', normalized(second.body));
    t.checks.eq('reversed parameter order returns the same body', normalized(first.body), normalized(second.body));

    const makeKey = (query) => {
      const params = new URLSearchParams(
        Object.entries(query)
          .filter(([, value]) => value != null && value !== '')
          .sort(([a], [b]) => a.localeCompare(b)),
      ).toString();
      return JSON.stringify(['sales-analysis', IDS.M1, '', IDS.U1, '', null, params]);
    };
    const keys = [
      makeKey({ from: '2026-11-02', to: '2026-11-04', refundView: 'sale_result', basketUnit: 'ticket' }),
      makeKey({ from: '2026-11-02', to: '2026-11-04', refundView: 'sale_result', basketUnit: 'ticket', locationId: '' }),
      makeKey({ basketUnit: 'ticket', refundView: 'sale_result', to: '2026-11-04', from: '2026-11-02' }),
    ];
    t.writeJson('cache-keys.json', keys);
    t.checks.truthy('three cache keys are equal', keys[0] === keys[1] && keys[1] === keys[2]);

    const boundaryOk = await api.get(
      `${salesPath(IDS.M1, {})}?from=2024-11-09&to=2026-11-09&refundView=sale_result&basketUnit=ticket`,
      { allowError: true },
    );
    const boundaryBad = await api.get(
      `${salesPath(IDS.M1, {})}?from=2024-11-08&to=2026-11-09&refundView=sale_result&basketUnit=ticket`,
      { allowError: true },
    );
    t.writeJson('boundary.json', { ok: boundaryOk.status, bad: boundaryBad.status, badBody: boundaryBad.body });
    t.checks.eq('731-day boundary returns 200', boundaryOk.status, 200);
    t.checks.eq('732-day boundary returns 400', boundaryBad.status, 400);
    t.checks.eq('732-day code', boundaryBad.body?.error?.code, 'VALIDATION_FAILED');
    return { observations: { boundary: { ok: boundaryOk.status, bad: boundaryBad.status } } };
  },
};
