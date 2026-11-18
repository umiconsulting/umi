const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const filename = path.resolve(__dirname, '../src/api.js');
const compiled = buildSync({
  entryPoints: [filename],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  define: { __UMI_API_ORIGIN__: JSON.stringify('https://api-staging.umiconsulting.co') },
}).outputFiles[0].text;
const apiModule = new Module(filename, module);
apiModule.filename = filename;
apiModule.paths = Module._nodeModulePaths(path.dirname(filename));
apiModule._compile(compiled, filename);
const api = apiModule.exports;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const token = 'test-token-0123456789abcdef';
const table = { kind: 'table', token };
const body = () => ({
  idempotencyKey: id(2),
  lines: [{ productId: id(1), quantity: 2, modifiers: [], note: null }],
  guestName: null,
  guestPhone: null,
  note: null,
});
const receipt = {
  orderId: id(3),
  reference: 'MESA 3 · PRUEBA',
  status: 'placed',
  total: { minorUnits: 9100, currency: 'MXN' },
  unitCount: 2,
  placedAt: '2026-11-17T19:00:00Z',
  created: true,
};
const response = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('POST envía sólo el contrato y conserva la clave y el cuerpo en el reintento', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) throw new TypeError('network lost');
    return response(receipt);
  });
  const pending = body();
  await assert.rejects(
    api.placeOrder(table, pending),
    (error) => error instanceof api.MenuApiError && error.uncertain,
  );
  assert.deepEqual(await api.placeOrder(table, pending), receipt);
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(
    calls[1].url,
    `https://api-staging.umiconsulting.co/api/public/table-order/${token}/orders`,
  );
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.credentials, 'omit');
  assert.equal(calls[1].init.referrerPolicy, 'no-referrer');
  assert.deepEqual(JSON.parse(calls[1].init.body), pending);
  assert.equal(calls.length, 2);
});
