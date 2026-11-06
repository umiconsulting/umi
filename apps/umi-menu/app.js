/* MVP local: persistencia y operación simuladas en este navegador. */
const demoId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
const STORE = 'umi-menu-mvp-v1';
let state;
try {
  state = JSON.parse(localStorage.getItem(STORE));
} catch {}
if (!state || state.version !== 1)
  state = {
    version: 1,
    orders: [],
    bills: [],
    settings: { ...MenuDemo.settings },
    offset: 0,
    cart: [],
    mode: 'pickup',
  };
const now = () => Date.now() + state.offset;
const tableParam = new URLSearchParams(location.search).get('mesa');
const tableNumber = ['1', '2', '12'].includes(tableParam) ? tableParam : '12';
const tableLocked = !!tableParam;
let activeId = location.hash.slice(1) || state.activeId;
let storageOK = true;
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
    storageOK = true;
  } catch {
    storageOK = false;
    notify('No se pudo guardar en este navegador. Conserva esta pestaña abierta.');
  }
}
function currentOrder() {
  return state.orders.find((o) => o.id === activeId);
}
function syncOrder() {
  order = currentOrder() || null;
}
function transact(id, action, payload = {}) {
  try {
    const i = state.orders.findIndex((o) => o.id === id);
    if (i < 0) throw new Error('No se encontró el pedido.');
    state.orders[i] = MenuDemo.advance(state.orders[i], action, now(), payload);
    const updated = state.orders[i];
    if (updated.mode === 'table' && !MenuDemo.hasOpenAccount(state.orders, updated.table)) {
      state.bills
        .filter((b) => b.table === updated.table && b.status === 'pending')
        .forEach((b) => {
          b.status = 'closed';
        });
    }
    save();
    refresh();
  } catch (e) {
    notify(e.message);
  }
}
const baseRenderCart = renderCart;
renderCart = function () {
  state.cart = cart;
  state.cartContext = mode === 'table' ? 'table-' + tableNumber : 'pickup';
  state.mode = mode;
  syncOrder();
  baseRenderCart();
  save();
};
const baseSetMode = setMode;
setMode = function (next) {
  if (tableLocked && next !== 'table') return;
  baseSetMode(next);
  renderContext();
};
renderContext = function () {
  const table = mode === 'table';
  const hasAccount = MenuDemo.hasOpenAccount(state.orders, tableNumber);
  const bill = state.bills.find((b) => b.table === tableNumber && b.status === 'pending');
  const content = `<div class="row"><span class="context-icon">${icon(table ? 'table' : 'bag')}</span><div><div class="context-title">${table ? 'Mesa ' + tableNumber : 'Para recoger'}</div><div class="context-sub">Bruma · Sucursal Centro · Ejemplo</div></div></div><div class="fulfillment-caption">${state.settings.paused ? 'Pedidos pausados. Puedes consultar el menú.' : table ? 'El personal recibe el número de tu mesa.' : 'Pago en el negocio · Sujeto a aceptación'}</div>${table ? `<button class="secondary" data-bill ${!hasAccount || bill ? 'disabled' : ''}>${bill ? 'Cuenta solicitada' : 'Pedir la cuenta'}</button>` : ''}`;
  $('#fulfillment').innerHTML = content;
  $('#mobile-context').innerHTML =
    `<div><strong>${table ? 'Mesa ' + tableNumber : 'Para recoger'}</strong><div>${state.settings.paused ? 'Pedidos pausados' : 'Bruma · Centro'}</div></div>${table ? `<button class="text-btn" data-bill ${!hasAccount || bill ? 'disabled' : ''}>${bill ? 'Cuenta solicitada' : 'Pedir la cuenta'}</button>` : ''}`;
  document.querySelectorAll('[data-bill]').forEach(
    (b) =>
      (b.onclick = () => {
        if (mode !== 'table' || !MenuDemo.hasOpenAccount(state.orders, tableNumber)) return;
        if (!state.bills.some((b) => b.table === tableNumber && b.status === 'pending')) {
          state.bills.unshift({ id: demoId(), table: tableNumber, status: 'pending', at: now() });
          save();
          refresh();
          notify('El personal de la demo recibió tu solicitud de cuenta.');
        }
      }),
  );
  $('.hours-pill').innerHTML =
    `<span class="open-dot"></span>${state.settings.paused ? 'Pedidos pausados' : 'Negocio de ejemplo · Horarios simulados'}`;
};
const baseCheckout = openCheckout;
openCheckout = function () {
  if (state.settings.paused) return notify('Los pedidos están pausados. Tu carrito se conserva.');
  baseCheckout();
  if (mode === 'table')
    $('#checkout-dialog').innerHTML = $('#checkout-dialog').innerHTML.replaceAll(
      'mesa 12',
      'mesa ' + tableNumber,
    );
  $('#checkout-form').onsubmit = (e) => {
    e.preventDefault();
    submitOrder();
  };
};
submitOrder = function () {
  if (!cart.length || state.settings.paused)
    return notify('No se puede enviar este pedido. Revisa el carrito y la pausa.');
  if (!$('#checkout-form').reportValidity()) return;
  const scheduled = mode === 'pickup' && $('[name=timing]:checked').value === 'scheduled';
  const contact =
    mode === 'pickup'
      ? {
          name: $('#customer-name').value.trim(),
          phone: $('#customer-phone').value.trim(),
          email: $('#customer-email').value.trim(),
        }
      : { name: 'Mesa ' + tableNumber };
  if (mode === 'pickup' && (!contact.name || !/^\d{10,13}$/.test(contact.phone.replace(/\D/g, ''))))
    return notify('Revisa el nombre y el número de celular.');
  const date = scheduled
    ? new Date($('#pickup-day').value + 'T' + $('#pickup-time').value).getTime()
    : null;
  if (scheduled && (!date || date < Date.now() + 30 * 60000))
    return notify('Elige un horario con al menos 30 minutos de anticipación.');
  const stations = Object.fromEntries(
    cart.flatMap((l) =>
      (l.product.stations || [l.product.category === 'coffee' ? 'Barra' : 'Cocina']).map((s) => [
        s,
        false,
      ]),
    ),
  );
  const o = {
    id: demoId(),
    number: 'D-' + String(state.orders.length + 1).padStart(4, '0'),
    mode,
    table: mode === 'table' ? tableNumber : null,
    lines: structuredClone(cart),
    total: total(),
    ...contact,
    scheduled,
    date,
    cutoff: date ? date - state.settings.cancellationMinutes * 60000 : null,
    releaseAt: date ? date - state.settings.preparationMinutes * 60000 : null,
    createdAt: now(),
    expiresAt: now() + state.settings.acceptanceMinutes * 60000,
    status: mode === 'table' ? 'preparing' : 'pending',
    request: false,
    stations,
    paid: false,
  };
  state.orders.unshift(o);
  activeId = o.id;
  state.activeId = activeId;
  location.hash = activeId;
  cart = [];
  save();
  closeDialogs();
  refresh();
  renderOrder();
  showDialog('#status-dialog');
};
const labels = {
  pending: 'Pendiente de aceptación',
  accepted: 'Horario reservado',
  preparing: 'En preparación',
  ready: 'Todo listo',
  delivered: 'Entregado y cobrado · Simulado',
  cancelled: 'Cancelado',
  rejected: 'Rechazado',
  expired: 'Vencido sin respuesta',
};
const fmt = (t) => displayDate(new Date(t));
function orderLines(o) {
  return o.lines
    .map(
      (l) =>
        `<div class="staff-order"><strong>${l.qty} × ${escapeHTML(l.product.name)}</strong><small>${escapeHTML(l.options.join(' · '))}</small>${l.note ? `<p>${escapeHTML(l.note)}</p>` : ''}<span>${money(l.price * l.qty)}</span></div>`,
    )
    .join('');
}
renderOrder = function () {
  syncOrder();
  if (!order) return;
  const o = order,
    done = MenuDemo.terminal.includes(o.status);
  const descriptions = {
    pending: 'El negocio debe aceptar antes de preparar.',
    accepted: 'Tu horario está reservado. La preparación comenzará a la hora indicada.',
    preparing: 'Cada estación prepara sus productos.',
    ready:
      o.mode === 'table'
        ? 'El personal llevará el pedido a tu mesa.'
        : 'Pasa al negocio. Pagas al recoger.',
    delivered: 'La demo registró la entrega y el cobro sobre el mismo pedido.',
    cancelled: 'Este pedido ya no se prepara.',
    rejected: o.reason,
    expired: 'El negocio no aceptó dentro del plazo de ejemplo.',
  };
  $('#status-dialog').innerHTML =
    `<div class="dialog-top"><span class="eyebrow">Seguimiento · ${escapeHTML(o.number)}</span><button class="icon-btn" data-close aria-label="Cerrar seguimiento">${icon('x')}</button></div><div class="status-hero"><div class="status-icon">${icon(o.status === 'ready' ? 'check' : 'bag')}</div><h2 id="status-dialog-title">${labels[o.status]}</h2><p>${escapeHTML(descriptions[o.status])}</p></div><div class="modal-body"><div class="status-meta"><div><small>${o.mode === 'table' ? 'Mesa' : 'A nombre de'}</small><strong>${escapeHTML(o.name)}</strong></div><div><small>Modalidad</small><strong>${o.mode === 'table' ? 'Comer aquí' : o.scheduled ? 'Para recoger · Programado' : 'Para recoger · Lo antes posible'}</strong></div></div>${o.scheduled ? `<p>Hora para recoger: ${fmt(o.date)}<br>Preparación: ${fmt(o.releaseAt)}<br>Cancelación directa antes de: ${fmt(Math.min(o.cutoff, o.releaseAt))}</p>` : ''}${
      ['preparing', 'ready'].includes(o.status)
        ? `<div class="demo-notice">${Object.entries(o.stations)
            .map(([s, ready]) => `${s}: ${ready ? 'lista' : 'en preparación'}`)
            .join(' · ')}</div>`
        : ''
    }${orderLines(o)}<div class="confirm-total"><span>Total · Pago en el negocio</span><strong>${money(o.total)}</strong></div>${o.request ? '<p class="demo-notice">Cancelación solicitada. El pedido sigue activo hasta que el personal responda.</p>' : ''}<div class="status-actions">${!done && !o.request ? `<button class="secondary" id="cancel-order">${o.mode === 'table' ? 'Pedir ayuda para cancelar' : o.status === 'pending' || (o.status === 'accepted' && now() < o.cutoff) ? 'Cancelar pedido' : 'Solicitar cancelación'}</button>` : ''}<button class="secondary" id="copy-order">Copiar enlace de seguimiento local</button><button class="text-btn" id="open-staff-order">Simular atención del personal</button></div><p class="demo-hint">Solo en este navegador. No se envían correos ni pagos reales.</p></div>`;
  if ($('#cancel-order')) $('#cancel-order').onclick = () => transact(o.id, 'cancel');
  $('#open-staff-order').onclick = openStaff;
  $('#copy-order').onclick = async () => {
    try {
      await navigator.clipboard.writeText(location.href.split('#')[0] + '#' + o.id);
      notify('Enlace copiado. Usa otra pestaña de este navegador.');
    } catch {
      notify('Copia la dirección de esta página para conservar el enlace.');
    }
  };
};
function staffActions(o) {
  const button = (action, label, extra = '') =>
    `<button data-action="${action}" data-id="${o.id}" ${extra}>${label}</button>`;
  let html = '';
  if (o.status === 'pending')
    html +=
      button('accept', 'Aceptar') +
      button('reject', 'Rechazar') +
      button('fastExpire', 'Simular vencimiento');
  if (o.status === 'accepted') html += button('fastRelease', 'Avanzar reloj hasta preparación');
  if (o.status === 'preparing')
    html += Object.entries(o.stations)
      .filter(([, v]) => !v)
      .map(([s]) => button('station', s + ': terminar', `data-station="${s}"`))
      .join('');
  if (o.status === 'ready') html += button('deliver', 'Simular cobro y entrega');
  if (o.request)
    html +=
      button('approveCancel', 'Autorizar cancelación') + button('denyCancel', 'Mantener pedido');
  return html;
}
function openStaff() {
  closeDialogs();
  renderStaff();
  showDialog('#staff-dialog');
}
function renderStaff() {
  $('#staff-dialog').innerHTML =
    `<div class="dialog-top"><h2 id="staff-title">Personal · Demo local</h2><button class="icon-btn" data-close aria-label="Cerrar personal">${icon('x')}</button></div><div class="modal-body"><p class="demo-notice">Simulación de atención. No es UmiPOS ni KDS. El reloj y los plazos son de ejemplo.</p><section class="staff-section"><h3>Recepción de pedidos</h3><label class="option-row"><input id="pause-orders" type="checkbox" ${state.settings.paused ? 'checked' : ''}><span>Pausar pedidos nuevos</span></label><p class="small muted">Aceptación: 5 min · Preparación: 20 min · Cancelación programada: 30 min antes. Hora simulada: ${fmt(now())}.</p></section><section class="staff-section"><h3>Solicitudes de cuenta</h3>${
      state.bills
        .filter((b) => b.status === 'pending')
        .map(
          (b) =>
            `<div class="staff-order"><strong>Mesa ${b.table} · Cuenta solicitada</strong><button data-bill-done="${b.id}">Marcar atendida</button></div>`,
        )
        .join('') || '<p class="muted">No hay solicitudes pendientes.</p>'
    }</section><section class="staff-section"><h3>Pedidos (${state.orders.length})</h3>${state.orders.map((o) => `<article class="staff-order"><div class="between"><strong>${o.number} · ${o.mode === 'table' ? 'Mesa ' + o.table : escapeHTML(o.name)}</strong><span>${money(o.total)}</span></div><p>${labels[o.status]}${o.request ? ' · Solicita cancelación' : ''}</p>${o.scheduled ? `<small>Recogida ${fmt(o.date)} · Preparación ${fmt(o.releaseAt)}</small>` : ''}<ul>${o.lines.map((l) => `<li>${l.qty} × ${escapeHTML(l.product.name)}${l.options.length ? ' · ' + escapeHTML(l.options.join(', ')) : ''}${l.note ? ' — ' + escapeHTML(l.note) : ''}</li>`).join('')}</ul><div class="row">${staffActions(o)}<button data-track="${o.id}">Ver seguimiento</button></div></article>`).join('') || '<p class="muted">Crea un pedido desde el menú para probar la atención.</p>'}</section><section class="staff-section"><h3>Enlaces y QR de mesa</h3><p class="small muted">Cada QR identifica su mesa. Los QR incluidos abren este equipo; para un teléfono, genera los QR con la dirección de red según el README.</p><div class="qr-grid">${['1', '2', '12'].map((t) => `<a href="./index.html?mesa=${t}"><img src="./qr/mesa-${t}.svg" alt="QR de la mesa ${t}">Abrir mesa ${t}</a>`).join('')}</div></section><section class="staff-section"><button id="reset-demo">Borrar datos y reiniciar demo</button></section></div>`;
  $('#pause-orders').onchange = (e) => {
    state.settings.paused = e.target.checked;
    save();
    renderContext();
  };
  document.querySelectorAll('[data-bill-done]').forEach(
    (b) =>
      (b.onclick = () => {
        state.bills.find((x) => x.id === b.dataset.billDone).status = 'served';
        save();
        refresh();
      }),
  );
  document.querySelectorAll('[data-track]').forEach(
    (b) =>
      (b.onclick = () => {
        activeId = b.dataset.track;
        state.activeId = activeId;
        location.hash = activeId;
        save();
        closeDialogs();
        renderOrder();
        showDialog('#status-dialog');
      }),
  );
  document.querySelectorAll('[data-action]').forEach(
    (b) =>
      (b.onclick = () => {
        const o = state.orders.find((x) => x.id === b.dataset.id),
          action = b.dataset.action;
        if (action === 'fastExpire' || action === 'fastRelease') {
          state.offset +=
            Math.max(0, (action === 'fastExpire' ? o.expiresAt : o.releaseAt) - now()) + 1;
          save();
          tick();
          return;
        }
        if (action === 'reject') {
          const reason = prompt('Motivo del rechazo (datos de ejemplo):');
          if (reason === null) return;
          transact(o.id, action, { reason });
        } else transact(o.id, action, { station: b.dataset.station });
      }),
  );
  $('#reset-demo').onclick = () => {
    if (confirm('¿Borrar el carrito, pedidos y solicitudes de esta demo?')) {
      localStorage.removeItem(STORE);
      location.href = './index.html';
    }
  };
}
function refresh() {
  renderContext();
  syncOrder();
  baseRenderCart();
  if ($('#status-dialog').open) renderOrder();
  if ($('#staff-dialog').open) renderStaff();
}
function tick() {
  let changed = false;
  state.orders = state.orders.map((o) => {
    const action =
      o.status === 'pending' && now() >= o.expiresAt
        ? 'expire'
        : o.status === 'accepted' && now() >= o.releaseAt
          ? 'release'
          : null;
    if (!action) return o;
    changed = true;
    return MenuDemo.advance(o, action, now());
  });
  if (changed) {
    save();
    refresh();
  }
}
$('#staff-button').onclick = openStaff;
window.addEventListener('storage', (e) => {
  if (e.key === STORE && e.newValue) {
    try {
      state = JSON.parse(e.newValue);
      refresh();
    } catch {}
  }
});
window.addEventListener('hashchange', () => {
  activeId = location.hash.slice(1);
  syncOrder();
  if (order) {
    closeDialogs();
    renderOrder();
    showDialog('#status-dialog');
  }
});
mode = tableLocked ? 'table' : state.mode || 'pickup';
const cartContext = mode === 'table' ? 'table-' + tableNumber : 'pickup';
cart = state.cartContext === cartContext ? state.cart || [] : [];
if (tableLocked && currentOrder() && currentOrder().table !== tableNumber && !location.hash)
  activeId = null;
if (tableLocked) {
  document.querySelectorAll('[data-mode]').forEach((b) => (b.hidden = true));
} else
  document
    .querySelectorAll('[data-mode]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
if (tableParam && !['1', '2', '12'].includes(tableParam)) {
  state.settings.paused = true;
  notify('Enlace de mesa no válido. Usa los enlaces de la demo.');
}
refresh();
tick();
setInterval(tick, 1000);
if (currentOrder() && location.hash) {
  renderOrder();
  showDialog('#status-dialog');
}
