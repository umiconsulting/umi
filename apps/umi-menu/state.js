/* Reglas de la demo. No representan contratos ni configuración de producción. */
(function (root) {
  const terminal = ['cancelled', 'expired', 'rejected', 'delivered'];
  const settings = { paused: false, acceptanceMinutes: 5, preparationMinutes: 20, cancellationMinutes: 30 };
  function advance(order, action, now, payload = {}) {
    const o = JSON.parse(JSON.stringify(order));
    if (terminal.includes(o.status)) throw new Error('Este pedido ya terminó.');
    if (o.status === 'pending' && now >= o.expiresAt && action !== 'expire') {
      throw new Error('El plazo de aceptación terminó. Actualiza el pedido.');
    }
    const requireState = (...states) => { if (!states.includes(o.status)) throw new Error('La acción no corresponde al estado actual.'); };
    if (action === 'accept') { requireState('pending'); o.status = o.scheduled && now < o.releaseAt ? 'accepted' : 'preparing'; }
    else if (action === 'reject') {
      requireState('pending');
      if (!payload.reason?.trim()) throw new Error('Escribe el motivo del rechazo.');
      o.status = 'rejected'; o.reason = payload.reason.trim().slice(0, 180);
    }
    else if (action === 'expire') { requireState('pending'); if (now < o.expiresAt) throw new Error('El plazo aún no termina.'); o.status = 'expired'; }
    else if (action === 'release') { requireState('accepted'); if (now < o.releaseAt) throw new Error('Aún no es hora de preparar.'); o.status = 'preparing'; }
    else if (action === 'station') {
      requireState('preparing');
      if (!(payload.station in o.stations)) throw new Error('Estación desconocida.');
      o.stations[payload.station] = true;
      if (Object.values(o.stations).every(Boolean)) o.status = 'ready';
    }
    else if (action === 'cancel') {
      if (o.request) throw new Error('La solicitud ya está pendiente.');
      if (o.status === 'pending' || (o.status === 'accepted' && now < o.cutoff && now < o.releaseAt)) o.status = 'cancelled';
      else o.request = true;
    }
    else if (action === 'approveCancel' || action === 'denyCancel') {
      if (!o.request) throw new Error('No hay una solicitud de cancelación.');
      o.request = false;
      if (action === 'approveCancel') o.status = 'cancelled';
    }
    else if (action === 'deliver') { requireState('ready'); o.status = 'delivered'; o.paid = true; }
    else throw new Error('Acción desconocida.');
    o.updatedAt = now;
    return o;
  }
  function hasOpenAccount(orders, table) {
    return orders.some(o => o.mode === 'table' && String(o.table) === String(table)
      && !o.paid && !terminal.includes(o.status));
  }
  const api = { advance, settings, terminal, hasOpenAccount };
  root.MenuDemo = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
