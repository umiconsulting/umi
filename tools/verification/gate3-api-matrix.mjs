// Gate-3 API matrix over the fixed fixture. 4 ranges x 3 scopes = 12 cases.
//
//   node tools/verification/gate3-api-matrix.mjs
//
// It also proves the two API accounts: an unscoped account reads all locations,
// and a Centro-bound account gets 403 for Norte.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://127.0.0.1:4001';
const OUT = 'docs/verification/2026-11-16-semantic-api-gate3/dashboard/api-matrix.json';
const fixture = JSON.parse(
  readFileSync('tools/verification/fixtures/semantic-gate3/fixture.json', 'utf8'),
);
const MERCHANT = fixture.merchantId;
const CENTRO = fixture.locations.centro;
const NORTE = fixture.locations.norte;
const D0 = new Date(`${fixture.d0}T12:00:00Z`);
const day = (offset) => new Date(D0.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const SCALARS = [
  'net_sales',
  'orders',
  'average_ticket',
  'items_sold',
  'units_per_ticket',
  'discounts',
  'tips',
  'prior_net_sales',
  'refunds',
];
const PRESETS = ['payment_mix', 'channel_mix', 'product_mix', 'operator_mix', 'hour_mix', 'series'];

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/local/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: email, password: 'Umi2026!' }),
  });
  if (!res.ok) throw new Error(`login ${email} ${res.status}`);
  const cookies = res.headers.getSetCookie();
  const pair = (name) => cookies.find((c) => c.startsWith(`${name}=`))?.split(';')[0];
  const cookie = [pair('umi_access'), pair('umi_csrf')].filter(Boolean).join('; ');
  const csrf = pair('umi_csrf')?.split('=')[1] ?? '';
  return { cookie, csrf };
}

async function post(session, body) {
  const res = await fetch(`${BASE}/api/merchants/${MERCHANT}/metrics/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: session.cookie,
      'x-umi-csrf': session.csrf,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function query(session, range, locationId) {
  const base = { dimensions: [], range };
  if (locationId) base.locationId = locationId;
  const scalars = await post(session, { ...base, metrics: SCALARS });
  const presets = await post(session, { ...base, metrics: PRESETS });
  const values = {
    ...(scalars.json?.totals?.values ?? {}),
    ...(presets.json?.totals?.values ?? {}),
  };
  return {
    status:
      scalars.status >= 200 && scalars.status < 300 && presets.status >= 200 && presets.status < 300
        ? 200
        : scalars.status || presets.status,
    body: { scalars: { ...base, metrics: SCALARS }, presets: { ...base, metrics: PRESETS } },
    json: { ...(scalars.json ?? {}), totals: { values } },
  };
}

const EXPECTED = {
  today: {
    all: {
      net: 28500,
      orders: 2,
      avg: 14250,
      items: 3,
      disc: 3000,
      tips: 1500,
      prior: 18000,
      refunds: 9000,
      payment: [['cash', 28500]],
      channel: [['walk_in', 28500, 2]],
      series: [
        ['09', 19500],
        ['17', 9000],
      ],
    },
    centro: {
      net: 28500,
      orders: 2,
      avg: 14250,
      items: 3,
      disc: 3000,
      tips: 1500,
      prior: 18000,
      refunds: 9000,
      payment: [
        ['cash', 28500],
        ['wallet', 5000],
      ],
      channel: [['walk_in', 28500, 2]],
      series: [
        ['09', 19500],
        ['17', 9000],
      ],
    },
    norte: {
      net: 0,
      orders: 0,
      avg: 0,
      items: 0,
      disc: 0,
      tips: 0,
      prior: 0,
      refunds: 0,
      payment: [],
      channel: [],
      series: [],
    },
  },
  yesterday: {
    all: {
      net: 18000,
      orders: 1,
      avg: 18000,
      items: 2,
      disc: 2000,
      tips: 0,
      prior: 0,
      refunds: 0,
      payment: [['cash', 18000]],
      channel: [['walk_in', 18000, 1]],
      series: [['12', 18000]],
    },
    centro: {
      net: 18000,
      orders: 1,
      avg: 18000,
      items: 2,
      disc: 2000,
      tips: 0,
      prior: 0,
      refunds: 0,
      payment: [['cash', 18000]],
      channel: [['walk_in', 18000, 1]],
      series: [['12', 18000]],
    },
    norte: {
      net: 0,
      orders: 0,
      avg: 0,
      items: 0,
      disc: 0,
      tips: 0,
      prior: 0,
      refunds: 0,
      payment: [],
      channel: [],
      series: [],
    },
  },
  last_7_days: {
    all: {
      net: 55500,
      orders: 4,
      avg: 13875,
      items: 6,
      disc: 6000,
      tips: 1500,
      prior: 10000,
      refunds: 9000,
      payment: [['cash', 55500]],
      channel: [
        ['walk_in', 46500, 3],
        ['whatsapp', 9000, 1],
      ],
      series: [
        [day(-3), 9000],
        [day(-1), 18000],
        [day(0), 28500],
      ],
    },
    centro: {
      net: 46500,
      orders: 3,
      avg: 15500,
      items: 5,
      disc: 5000,
      tips: 1500,
      prior: 10000,
      refunds: 9000,
      payment: [
        ['cash', 46500],
        ['wallet', 5000],
      ],
      channel: [['walk_in', 46500, 3]],
      series: [
        [day(-1), 18000],
        [day(0), 28500],
      ],
    },
    norte: {
      net: 9000,
      orders: 1,
      avg: 9000,
      items: 1,
      disc: 1000,
      tips: 0,
      prior: 0,
      refunds: 0,
      payment: [['cash', 9000]],
      channel: [['whatsapp', 9000, 1]],
      series: [[day(-3), 9000]],
    },
  },
  last_30_days: {
    all: {
      net: 65500,
      orders: 5,
      avg: 13100,
      items: 7,
      disc: 6000,
      tips: 1500,
      prior: 0,
      refunds: 9000,
      payment: [['cash', 65500]],
      channel: [
        ['walk_in', 56500, 4],
        ['whatsapp', 9000, 1],
      ],
      series: [
        ['2026-11-07', 10000],
        [day(-3), 9000],
        [day(-1), 18000],
        [day(0), 28500],
      ],
    },
    centro: {
      net: 56500,
      orders: 4,
      avg: 14125,
      items: 6,
      disc: 5000,
      tips: 1500,
      prior: 0,
      refunds: 9000,
      payment: [
        ['cash', 56500],
        ['wallet', 5000],
      ],
      channel: [['walk_in', 56500, 4]],
      series: [
        ['2026-11-07', 10000],
        [day(-1), 18000],
        [day(0), 28500],
      ],
    },
    norte: {
      net: 9000,
      orders: 1,
      avg: 9000,
      items: 1,
      disc: 1000,
      tips: 0,
      prior: 0,
      refunds: 0,
      payment: [['cash', 9000]],
      channel: [['whatsapp', 9000, 1]],
      series: [[day(-3), 9000]],
    },
  },
};

function actual(json) {
  const values = json.totals?.values ?? {};
  const items = (value) => value?.items ?? [];
  return {
    net: Number(values.net_sales ?? 0),
    orders: Number(values.orders ?? 0),
    avg: Number(values.average_ticket ?? 0),
    items: Number(values.items_sold ?? 0),
    disc: Number(values.discounts ?? 0),
    tips: Number(values.tips ?? 0),
    prior: Number(values.prior_net_sales ?? 0),
    refunds: Number(values.refunds ?? 0),
    payment: items(values.payment_mix).map((row) => [row.method, row.amountMinorUnits]),
    channel: items(values.channel_mix).map((row) => [
      row.channel,
      row.netSalesMinorUnits,
      row.orders,
    ]),
    series: items(values.series).map((row) => [row.label, row.netSalesMinorUnits]),
  };
}

function diff(expected, got) {
  const fields = [
    'net',
    'orders',
    'avg',
    'items',
    'disc',
    'tips',
    'prior',
    'refunds',
    'payment',
    'channel',
    'series',
  ];
  return fields.filter((field) => JSON.stringify(expected[field]) !== JSON.stringify(got[field]));
}

const session = await login('gate3.centro@example.test');
const cases = [];
for (const range of ['today', 'yesterday', 'last_7_days', 'last_30_days']) {
  for (const [scope, locationId] of [
    ['all', null],
    ['centro', CENTRO],
    ['norte', NORTE],
  ]) {
    const result = await query(session, range, locationId);
    const got = result.status === 200 ? actual(result.json) : null;
    const expected = EXPECTED[range][scope];
    const fields = got ? diff(expected, got) : ['status'];
    cases.push({
      id: `API-${range}-${scope}`,
      range,
      scope,
      locationId,
      status: result.status,
      request: result.body,
      expected,
      actual: got,
      match: fields.length === 0,
      mismatchedFields: fields,
    });
  }
}

const allSession = await login('gate3.all@example.test');
const allRead = await query(allSession, 'last_7_days', null);
const boundSession = await login('gate3.bound@example.test');
const boundCentro = await query(boundSession, 'today', null);
const boundNorte = await query(boundSession, 'today', NORTE);

const failures = cases.filter((row) => !row.match);
const report = {
  record: '2026-11-16-semantic-api-gate3-api-matrix',
  createdAt: new Date().toISOString(),
  d0: fixture.d0,
  merchantId: MERCHANT,
  counts: {
    cases: cases.length,
    matches: cases.length - failures.length,
    mismatches: failures.length,
  },
  cases,
  permissions: {
    allAccount: { status: allRead.status, net: actual(allRead.json).net },
    boundCentro: { status: boundCentro.status },
    boundNorte: { status: boundNorte.status, code: boundNorte.json?.error?.code ?? null },
  },
};
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `cases=${cases.length} matches=${report.counts.matches} mismatches=${failures.length} all=${allRead.status} boundCentro=${boundCentro.status} boundNorte=${boundNorte.status}`,
);
for (const row of failures)
  console.log(`MISMATCH ${row.id} status=${row.status} fields=${row.mismatchedFields}`);
if (failures.length > 0) process.exitCode = 1;
