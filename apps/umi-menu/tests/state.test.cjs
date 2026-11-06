const { test } = require('node:test');
const assert = require('node:assert/strict');
const { advance } = require('../src/state.js');
const pending = () => ({
  status: 'pending',
  expiresAt: 300000,
  stations: { Cocina: false, Barra: false },
  request: false,
});
test('recogida no prepara hasta aceptar; conserva el original', () => {
  const o = pending();
  assert.equal(advance(o, 'accept', 100).status, 'preparing');
  assert.equal(o.status, 'pending');
});
test('listo exige terminar cocina y barra', () => {
  let o = advance(pending(), 'accept', 100);
  o = advance(o, 'station', 200, { station: 'Barra' });
  assert.equal(o.status, 'preparing');
  o = advance(o, 'station', 300, { station: 'Cocina' });
  assert.equal(o.status, 'ready');
});
test('rechazo exige motivo y no permite aceptar después', () => {
  assert.throws(() => advance(pending(), 'reject', 100, {}));
  const o = advance(pending(), 'reject', 100, { reason: 'Agotado' });
  assert.equal(o.status, 'rejected');
  assert.throws(() => advance(o, 'accept', 101));
});
test('vencimiento impide aceptación tardía', () => {
  assert.throws(() => advance(pending(), 'accept', 300000));
  assert.throws(() => advance(pending(), 'expire', 100));
  assert.equal(advance(pending(), 'expire', 300000).status, 'expired');
});
test('cancelar pendiente impide preparar', () => {
  const o = advance(pending(), 'cancel', 100);
  assert.equal(o.status, 'cancelled');
  assert.throws(() => advance(o, 'accept', 200));
});
test('cancelar preparación solicita autorización', () => {
  let o = advance(pending(), 'accept', 100);
  o = advance(o, 'cancel', 200);
  assert.equal(o.status, 'preparing');
  assert.equal(o.request, true);
  o = advance(o, 'denyCancel', 300);
  assert.equal(o.request, false);
});
test('personal autoriza cancelación solicitada', () => {
  let o = advance(pending(), 'accept', 100);
  o = advance(o, 'cancel', 200);
  o = advance(o, 'approveCancel', 300);
  assert.equal(o.status, 'cancelled');
  assert.equal(o.request, false);
});
test('programado reserva y solo libera a su hora', () => {
  let o = { ...pending(), scheduled: true, releaseAt: 900000, cutoff: 600000 };
  o = advance(o, 'accept', 100);
  assert.equal(o.status, 'accepted');
  assert.throws(() => advance(o, 'release', 899999));
  assert.equal(advance(o, 'release', 900000).status, 'preparing');
  assert.equal(advance(o, 'cancel', 599999).status, 'cancelled');
  assert.equal(advance(o, 'cancel', 600000).request, true);
});
test('cobro requiere listo y no puede repetirse', () => {
  let o = advance(pending(), 'accept', 100);
  assert.throws(() => advance(o, 'deliver', 200));
  o = advance(o, 'station', 300, { station: 'Cocina' });
  o = advance(o, 'station', 400, { station: 'Barra' });
  o = advance(o, 'deliver', 500);
  assert.equal(o.paid, true);
  assert.equal(o.status, 'delivered');
  assert.throws(() => advance(o, 'deliver', 600));
});

const { hasOpenAccount } = require('../src/state.js');
test('cuenta requiere pedido de mesa enviado, activo y sin cobrar', () => {
  assert.equal(hasOpenAccount([], '12'), false);
  assert.equal(hasOpenAccount([{ mode: 'pickup', table: '12', status: 'preparing' }], '12'), false);
  assert.equal(hasOpenAccount([{ mode: 'table', table: '1', status: 'preparing' }], '12'), false);
  for (const status of ['preparing', 'ready'])
    assert.equal(hasOpenAccount([{ mode: 'table', table: '12', status }], '12'), true);
  for (const status of ['cancelled', 'rejected', 'expired', 'delivered'])
    assert.equal(hasOpenAccount([{ mode: 'table', table: '12', status }], '12'), false);
  assert.equal(
    hasOpenAccount([{ mode: 'table', table: '12', status: 'ready', paid: true }], '12'),
    false,
  );
});
