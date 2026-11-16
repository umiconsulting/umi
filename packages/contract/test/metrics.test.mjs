// The public shape of the semantic analytics query (gate 1).
//
// The request rules are part of the contract, not of the controller: a caller
// must see the same field error whether the API or a typed client validates the
// body. Every failure below names the FIELD, because that is what the client
// shows next to the input.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT_VERSION,
  MetricsQuery,
  MetricsResponse,
  ROUTE_TABLE,
  route,
} from '../dist/index.js';

const base = {
  metrics: ['net_sales', 'orders', 'average_ticket'],
  dimensions: ['day'],
  range: 'last_7_days',
};

function issues(body) {
  const result = MetricsQuery.safeParse(body);
  assert.equal(result.success, false, `expected a refusal for ${JSON.stringify(body)}`);
  return result.error.issues.map((issue) => issue.path.join('.') || '$');
}

function accepts(body) {
  const result = MetricsQuery.safeParse(body);
  assert.equal(result.success, true, `expected an accept for ${JSON.stringify(body)}`);
  return result.data;
}

test('the contract version advances to 2.57.0', () => {
  assert.equal(CONTRACT_VERSION, '2.57.0');
});

test('the route is registered with the sales policy', () => {
  const definition = route('metrics.query');
  assert.equal(definition.method, 'POST');
  assert.equal(definition.path, '/api/merchants/:merchantId/metrics/query');
  assert.deepEqual(definition.params, ['merchantId']);
  assert.equal(definition.contract.request, 'MetricsQuery');
  assert.equal(definition.contract.response, 'MetricsResponse');
  assert.equal(definition.contract.auth, 'session');
  assert.equal(definition.contract.permission, 'sale.lifecycle');
  assert.equal(definition.contract.merchantContext, true);
  assert.equal(definition.contract.locationContext, true);
  assert.deepEqual(definition.contract.errors, [
    'VALIDATION_FAILED',
    'PERMISSION_DENIED',
    'LOCATION_SCOPE_VIOLATION',
  ]);
});

test('a valid body parses with the documented defaults', () => {
  const parsed = accepts({ metrics: ['net_sales'], dimensions: [], range: 'today' });
  assert.deepEqual(parsed.metrics, ['net_sales']);
  assert.deepEqual(parsed.dimensions, []);
  assert.deepEqual(accepts({ metrics: ['net_sales'], range: 'today' }).dimensions, []);
});

test('metrics refuses an unknown id, a duplicate, and a bad length on the field', () => {
  assert.deepEqual(issues({ ...base, metrics: ['net_sales', 'not_a_metric'] }), ['metrics']);
  assert.deepEqual(issues({ ...base, metrics: ['net_sales', 'net_sales'] }), ['metrics']);
  assert.deepEqual(issues({ ...base, metrics: [] }), ['metrics']);
  assert.deepEqual(
    issues({
      ...base,
      dimensions: [],
      metrics: [
        'net_sales',
        'orders',
        'average_ticket',
        'items_sold',
        'units_per_ticket',
        'discounts',
        'tips',
        'prior_net_sales',
        'refunds',
        'product_mix',
        'channel_mix',
      ],
    }),
    ['metrics'],
  );
});

test('dimensions refuse an unknown id, a duplicate, and a third dimension on the field', () => {
  assert.deepEqual(issues({ ...base, dimensions: ['week'] }), ['dimensions']);
  assert.deepEqual(issues({ ...base, dimensions: ['day', 'day'] }), ['dimensions']);
  assert.deepEqual(issues({ ...base, dimensions: ['day', 'hour', 'channel'] }), ['dimensions']);
});

test('a preset refuses any dimension', () => {
  for (const preset of [
    'payment_mix',
    'channel_mix',
    'product_mix',
    'operator_mix',
    'hour_mix',
    'series',
  ]) {
    assert.deepEqual(
      issues({ ...base, metrics: [preset], dimensions: ['day'] }),
      ['dimensions'],
      preset,
    );
  }
});

test('a metric refuses a dimension its kind does not accept', () => {
  assert.deepEqual(issues({ ...base, metrics: ['net_sales'], dimensions: ['product'] }), [
    'dimensions',
  ]);
  assert.deepEqual(
    issues({ ...base, metrics: ['net_sales', 'items_sold'], dimensions: ['product'] }),
    ['dimensions'],
  );
  assert.deepEqual(issues({ ...base, metrics: ['prior_net_sales'], dimensions: ['day'] }), [
    'dimensions',
  ]);
  assert.deepEqual(issues({ ...base, metrics: ['units_per_ticket'], dimensions: ['category'] }), [
    'dimensions',
  ]);
});

test('a limit without dimensions is refused on the field', () => {
  assert.deepEqual(issues({ metrics: ['net_sales'], dimensions: [], range: 'today', limit: 10 }), [
    'limit',
  ]);
});

test('a limit outside 1..1000 or not an integer is refused on the field', () => {
  assert.deepEqual(issues({ ...base, limit: 0 }), ['limit']);
  assert.deepEqual(issues({ ...base, limit: 1001 }), ['limit']);
  assert.deepEqual(issues({ ...base, limit: 1.5 }), ['limit']);
  assert.deepEqual(issues({ ...base, limit: '10' }), ['limit']);
  assert.deepEqual(issues({ ...base, limit: null }), ['limit']);
});

test('a range outside the four values is refused on the field', () => {
  assert.deepEqual(issues({ ...base, range: 'last_90_days' }), ['range']);
  assert.deepEqual(issues({ ...base, range: undefined }), ['range']);
});

test('a location id that is not a uuid is refused on the field', () => {
  assert.deepEqual(issues({ ...base, locationId: 'centro' }), ['locationId']);
  assert.deepEqual(issues({ ...base, locationId: null }), ['locationId']);
});

test('an unknown body key is refused at the body', () => {
  assert.deepEqual(issues({ ...base, sql: 'select 1' }), ['$']);
});

test('a valid combination with two dimensions and a limit parses', () => {
  const parsed = accepts({
    metrics: ['items_sold'],
    dimensions: ['product', 'category'],
    range: 'last_30_days',
    limit: 500,
  });
  assert.deepEqual(parsed.dimensions, ['product', 'category']);
  assert.equal(parsed.limit, 500);
});

test('a totals response parses and carries the definition context', () => {
  const response = MetricsResponse.parse({
    definitionVersion: '1.0.0',
    scope: {
      merchantId: '55555555-5555-4555-8555-000000000001',
      locationId: null,
      currency: 'MXN',
      timezone: 'America/Mexico_City',
      attribution: { category: 'current' },
    },
    period: {
      range: 'last_7_days',
      start: '2026-11-09',
      end: '2026-11-15',
      bucket: 'day',
      comparison: { start: '2026-11-02', end: '2026-11-08' },
    },
    coverage: {
      sources: ['pos_committed_sale', 'receipt_snapshot'],
      committedOnly: true,
      refundsIncluded: false,
    },
    freshness: { capturedAt: '2026-11-16T01:30:00.000Z' },
    truncated: false,
    totals: { values: { net_sales: 1234500, orders: 84, average_ticket: 14696 } },
  });
  assert.equal(response.totals.values.net_sales, 1234500);
});

test('a rows response with a distribution parses, and both shapes at once do not', () => {
  const rows = {
    definitionVersion: '1.0.0',
    scope: {
      merchantId: '55555555-5555-4555-8555-000000000001',
      locationId: null,
      currency: 'MXN',
      timezone: 'America/Mexico_City',
      attribution: { category: 'current' },
    },
    period: {
      range: 'last_7_days',
      start: '2026-11-09',
      end: '2026-11-15',
      bucket: 'day',
      comparison: { start: '2026-11-02', end: '2026-11-08' },
    },
    coverage: {
      sources: ['pos_committed_sale', 'receipt_snapshot'],
      committedOnly: true,
      refundsIncluded: false,
    },
    freshness: { capturedAt: '2026-11-16T01:30:00.000Z' },
    truncated: false,
    rows: [
      {
        dimensions: { day: '2026-11-09' },
        values: {
          net_sales: 1234500,
          orders: 84,
          average_ticket: 14696,
          payment_mix: {
            items: [{ method: 'cash', amountMinorUnits: 100 }],
            truncated: false,
            limit: 8,
            totalItems: 1,
            total: { amountMinorUnits: 100 },
          },
        },
      },
    ],
  };
  assert.equal(MetricsResponse.safeParse(rows).success, true);
  assert.equal(
    MetricsResponse.safeParse({ ...rows, totals: { values: { net_sales: 1 } } }).success,
    false,
  );
  assert.equal(MetricsResponse.safeParse({ ...rows, rows: undefined }).success, false);
});

test('the route table carries exactly one metrics query', () => {
  const found = ROUTE_TABLE.filter((entry) => entry.id.startsWith('metrics.'));
  assert.deepEqual(
    found.map((entry) => entry.id),
    ['metrics.query'],
  );
});
