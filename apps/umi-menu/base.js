'use strict';
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const money = (value) =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(value);
const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const $ = (selector, root = document) => root.querySelector(selector);
const categories = [
  { id: 'favorites', label: 'Destacados', title: 'Destacados', icon: 'star' },
  { id: 'breakfast', label: 'Desayunos', title: 'Desayunos', icon: 'sun' },
  { id: 'coffee', label: 'Café y bebidas', title: 'Café y bebidas', icon: 'coffee' },
  { id: 'bakery', label: 'Panadería', title: 'Panadería', icon: 'pastry' },
  { id: 'dessert', label: 'Postres', title: 'Postres', icon: 'cake' },
];
const products = [
  {
    id: 'toast',
    name: 'French toast de la casa',
    price: 145,
    category: 'breakfast',
    image: 'toast',
    favorite: true,
    description: 'Pan brioche con plátano, arándanos y miel de maple.',
    tag: 'Destacado',
    future: false,
    extras: [
      ['Extra de arándanos', 25],
      ['Helado de vainilla', 30],
    ],
  },
  {
    id: 'latte',
    name: 'Latte de la casa',
    price: 65,
    category: 'coffee',
    image: 'coffee',
    favorite: true,
    description: 'Doble espresso con leche.',
    future: false,
    milk: true,
    extras: [
      ['Shot extra de espresso', 20],
      ['Vainilla', 15],
    ],
  },
  {
    id: 'croissant',
    name: 'Croissant de mantequilla',
    price: 55,
    category: 'bakery',
    image: 'croissant',
    favorite: true,
    description: 'Una pieza de masa hojaldrada con mantequilla.',
    tag: 'Puedes programarlo',
    future: true,
    extras: [['Mermelada de frutos rojos', 15]],
  },
  {
    id: 'sandwich',
    name: 'Sándwich de tres quesos',
    price: 125,
    category: 'breakfast',
    image: 'sandwich',
    favorite: false,
    description: 'Pan a la plancha con mezcla de tres quesos.',
    future: false,
    extras: [['Extra de queso', 25]],
  },
  {
    id: 'cheesecake',
    name: 'Cheesecake de frutos rojos',
    price: 95,
    category: 'dessert',
    image: 'cake',
    favorite: true,
    description: 'Rebanada de cheesecake con frutos rojos.',
    future: false,
    extras: [],
  },
  {
    id: 'box',
    name: 'Caja de 6 croissants',
    price: 290,
    category: 'bakery',
    image: 'croissant',
    favorite: false,
    description: 'Seis croissants de mantequilla.',
    tag: 'Puedes programarlo',
    future: true,
    extras: [],
  },
];
let mode = 'pickup',
  category = 'favorites',
  search = '',
  cart = [],
  selectedProduct = null,
  selectedQty = 1,
  order = null,
  toastTimer;
const total = () => cart.reduce((s, l) => s + l.price * l.qty, 0),
  quantity = () => cart.reduce((s, l) => s + l.qty, 0);
function notify(message) {
  const t = $('#toast');
  t.innerHTML = icon('check') + escapeHTML(message);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2300);
}
function showDialog(id) {
  const d = $(id);
  if (!d.open) d.showModal();
}
function closeDialogs() {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
}
document.querySelectorAll('dialog').forEach((d) => {
  d.addEventListener('click', (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        d.close();
    }
    if (e.target.closest('[data-close]')) d.close();
  });
});
function setMode(next) {
  if (next === mode) return;
  mode = next;
  document
    .querySelectorAll('[data-mode]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  renderContext();
  renderCart();
  notify(mode === 'table' ? 'Vista de ejemplo: mesa 12' : 'Vista de ejemplo: para recoger');
}
document
  .querySelectorAll('[data-mode]')
  .forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
function renderContext() {
  const table = mode === 'table';
  $('#fulfillment').innerHTML =
    `<div class="row"><span class="context-icon">${icon(table ? 'table' : 'bag')}</span><div><div class="context-title">${table ? 'Estás en la mesa 12' : 'Para recoger'}</div><div class="context-sub">Bruma · Sucursal Centro</div></div></div><div class="fulfillment-caption">${icon(table ? 'coffee' : 'clock')}${table ? 'El personal llevará el pedido a tu mesa.' : 'Listo en 20–30 min · O elige una hora'}</div>`;
  $('#mobile-context').innerHTML =
    `<span class="row">${icon(table ? 'table' : 'bag')}<strong>${table ? 'Mesa 12' : 'Para recoger'}</strong><span>· Centro</span></span><span class="row"><span class="open-dot"></span>${table ? 'Servicio a la mesa' : '20–30 min'}</span>`;
}
function renderCategories() {
  const nav = $('.categories');
  nav.innerHTML = categories
    .map((c) => {
      const count = products.filter((p) =>
        c.id === 'favorites' ? p.favorite : p.category === c.id,
      ).length;
      return `<button class="category" type="button" role="tab" aria-selected="${c.id === category}" data-category="${c.id}"><span>${c.label}</span><small aria-label="${count} productos">${count}</small></button>`;
    })
    .join('');
  nav.querySelectorAll('button').forEach(
    (b) =>
      (b.onclick = () => {
        category = b.dataset.category;
        search = '';
        $('#search').value = '';
        $('#clear-search').hidden = true;
        renderCategories();
        renderProducts();
        nav.querySelector(`[data-category="${category}"]`).focus({ preventScroll: true });
      }),
  );
}
function renderProducts() {
  const term = search
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const list = products.filter((p) =>
    term
      ? (p.name + ' ' + p.description)
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .includes(term)
      : category === 'favorites'
        ? p.favorite
        : p.category === category,
  );
  $('#category-title').textContent = term
    ? 'Resultados de búsqueda'
    : categories.find((c) => c.id === category).title;
  $('#result-count').textContent = list.length + ' productos';
  $('#products').innerHTML = list.length
    ? `<div class="product-grid">${list
        .map(
          (p) => `
    <button type="button" class="menu-product" data-product="${p.id}" data-category="${p.category}" aria-label="Ver ${p.name}, ${money(p.price)}">
      <img src="./files/${p.image}.jpg" alt="" loading="${p.id === 'toast' ? 'eager' : 'lazy'}">
      ${term || category === 'favorites' ? `<span class="menu-product-category">${categories.find((c) => c.id === p.category).label}</span>` : ''}
      <span class="menu-product-name">${p.name}</span>
      <span class="menu-product-price">${money(p.price)}</span>
      ${p.future ? `<span class="menu-product-schedule" title="Disponible para días posteriores">${icon('calendar')}<span class="sr">Disponible para días posteriores</span></span>` : ''}
    </button>`,
        )
        .join('')}</div>`
    : `<div class="empty-results">${icon('search')}<h3>Sin resultados</h3><p class="muted small">Prueba con “café”, “pan” o “croissant”.</p><button class="text-btn" id="reset-search">Ver destacados ${icon('arrow')}</button></div>`;
  $('#products')
    .querySelectorAll('[data-product]')
    .forEach((b) => (b.onclick = () => openProduct(b.dataset.product)));
  if ($('#reset-search'))
    $('#reset-search').onclick = () => {
      $('#search').value = '';
      search = '';
      category = 'favorites';
      $('#clear-search').hidden = true;
      renderCategories();
      renderProducts();
    };
}
$('#search').addEventListener('input', (e) => {
  search = e.target.value;
  $('#clear-search').hidden = !search;
  renderProducts();
});
$('#clear-search').onclick = () => {
  $('#search').value = '';
  search = '';
  $('#clear-search').hidden = true;
  renderProducts();
  $('#search').focus();
};
function openProduct(id) {
  selectedProduct = products.find((p) => p.id === id);
  selectedQty = 1;
  const p = selectedProduct;
  $('#product-dialog').innerHTML =
    `<div class="modal-photo"><img src="./files/${p.image}.jpg" alt="${p.name}"><button class="icon-btn" data-close aria-label="Cerrar producto">${icon('x')}</button></div><div class="modal-body"><div class="between"><h2 id="product-dialog-title">${p.name}</h2></div><p class="description">${p.description}</p>${p.future ? `<span class="tag" style="margin-top:13px">${icon('calendar')}Disponible para programar otros días</span>` : ''}${
      p.milk
        ? `<fieldset class="option-group"><legend>Elige tu leche <span class="optional">Elige una</span></legend>${[
            ['Leche entera', 0],
            ['Deslactosada', 0],
            ['Avena', 15],
          ]
            .map(
              ([n, v], i) =>
                `<label class="option-row"><input type="radio" name="milk" value="${v}" data-option="${n}" ${i === 0 ? 'checked' : ''}><span>${n}</span><span>${v ? '+' + money(v) : 'Incluida'}</span></label>`,
            )
            .join('')}</fieldset>`
        : ''
    }${p.extras.length ? `<fieldset class="option-group"><legend>Extras <span class="optional">Opcional</span></legend>${p.extras.map(([n, v]) => `<label class="option-row"><input type="checkbox" name="extra" value="${v}" data-option="${n}"><span>${n}</span><span>+${money(v)}</span></label>`).join('')}</fieldset>` : ''}<div class="note-field"><label class="field-label" for="product-note">Indicaciones <span class="optional">Opcional</span></label><textarea class="field" id="product-note" maxlength="180" placeholder="Por ejemplo: miel aparte."></textarea></div></div><div class="modal-actions"><div class="stepper"><button type="button" id="product-minus" aria-label="Reducir cantidad">${icon('minus')}</button><span id="product-quantity">1</span><button type="button" id="product-plus" aria-label="Aumentar cantidad">${icon('plus')}</button></div><button class="primary" id="add-to-cart"><span>Agregar al pedido</span><span id="product-total"></span></button></div>`;
  $('#product-minus').onclick = () => {
    selectedQty = Math.max(1, selectedQty - 1);
    updateProductTotal();
  };
  $('#product-plus').onclick = () => {
    selectedQty = Math.min(20, selectedQty + 1);
    updateProductTotal();
  };
  $('#product-dialog')
    .querySelectorAll('input')
    .forEach((i) => (i.onchange = updateProductTotal));
  $('#add-to-cart').onclick = addToCart;
  updateProductTotal();
  showDialog('#product-dialog');
  $('#product-dialog').scrollTop = 0;
}
function selection() {
  const checked = [...$('#product-dialog').querySelectorAll('input:checked')];
  return {
    price: selectedProduct.price + checked.reduce((s, e) => s + Number(e.value), 0),
    options: checked.map((e) => e.dataset.option),
  };
}
function updateProductTotal() {
  $('#product-quantity').textContent = selectedQty;
  $('#product-minus').disabled = selectedQty === 1;
  $('#product-plus').disabled = selectedQty === 20;
  $('#product-total').textContent = money(selection().price * selectedQty);
}
function addToCart() {
  const s = selection(),
    note = $('#product-note').value.trim();
  const key = JSON.stringify([selectedProduct.id, s.options, note]);
  const found = cart.find((l) => l.key === key);
  if (found) found.qty += selectedQty;
  else
    cart.push({
      key,
      product: selectedProduct,
      qty: selectedQty,
      price: s.price,
      options: s.options,
      note,
    });
  $('#product-dialog').close();
  renderCart();
  notify(selectedQty === 1 ? 'Agregado a tu pedido' : `${selectedQty} productos agregados`);
}
function cartLines() {
  return cart
    .map(
      (l, i) =>
        `<div class="cart-line"><img src="./files/${l.product.image}.jpg" alt=""><div><div class="line-title">${l.product.name}</div>${l.options.length ? `<div class="line-options">${escapeHTML(l.options.join(' · '))}</div>` : ''}${l.note ? `<div class="line-options">${escapeHTML(l.note)}</div>` : ''}<div class="line-bottom"><div class="stepper"><button data-qty="${i}" data-delta="-1" aria-label="Quitar una unidad de ${l.product.name}">${icon('minus')}</button><span>${l.qty}</span><button data-qty="${i}" data-delta="1" aria-label="Añadir una unidad de ${l.product.name}">${icon('plus')}</button></div><span class="line-price">${money(l.qty * l.price)}</span></div></div></div>`,
    )
    .join('');
}
function cartMarkup() {
  return cart.length
    ? `${cartLines()}<div class="subtotal"><span>Total</span><strong>${money(total())}</strong></div><button class="primary" data-checkout>Continuar con mi pedido ${icon('arrow')}</button><p class="cart-footnote">${icon('card')}Pagas en el negocio</p>`
    : `<div class="cart-empty"><div class="bag-drawing">${icon('bag')}</div><h3>Tu pedido está vacío</h3><p>Elige productos del menú.<br>Podrás revisarlos antes de enviar.</p></div><button class="primary" disabled>Agrega productos ${icon('arrow')}</button><p class="cart-footnote">${icon('card')}Pagas en el negocio</p>`;
}
function bindCart(root) {
  root.querySelectorAll('[data-qty]').forEach(
    (b) =>
      (b.onclick = () => {
        const line = cart[Number(b.dataset.qty)];
        line.qty += Number(b.dataset.delta);
        cart = cart.filter((l) => l.qty > 0);
        renderCart();
      }),
  );
  root.querySelectorAll('[data-checkout]').forEach((b) => (b.onclick = openCheckout));
  root.querySelectorAll('[data-view-order]').forEach(
    (b) =>
      (b.onclick = () => {
        closeDialogs();
        renderOrder();
        showDialog('#status-dialog');
      }),
  );
}
function renderCart() {
  const last = order
    ? `<button class="secondary order-link" data-view-order>${icon('clock')}Ver pedido ${order.number}</button>`
    : '';
  $('#cart-count').textContent = quantity();
  $('#cart-content').innerHTML = cartMarkup() + last;
  bindCart($('#cart-content'));
  $('#mobile-count').textContent = quantity();
  $('#mobile-label').textContent = quantity()
    ? 'Ver mi pedido'
    : order
      ? 'Ver mi pedido enviado'
      : 'Ver mi pedido';
  $('#mobile-total').textContent = money(total());
  if ($('#cart-dialog').open) renderCartDialog();
}
function renderCartDialog() {
  $('#cart-dialog').innerHTML =
    `<div class="dialog-top"><h2 id="cart-dialog-title">Tu pedido <span class="small muted">(${quantity()})</span></h2><button class="icon-btn" data-close aria-label="Cerrar pedido">${icon('x')}</button></div><div class="modal-body">${cartMarkup()}${order ? `<button class="secondary order-link" data-view-order>Ver pedido ${order.number}</button>` : ''}</div>`;
  bindCart($('#cart-dialog'));
}
$('#mobile-cart-button').onclick = () => {
  if (order && !cart.length) {
    renderOrder();
    showDialog('#status-dialog');
  } else {
    renderCartDialog();
    showDialog('#cart-dialog');
  }
};
function localDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}
function dateLabel(offset) {
  if (offset === 0) return 'Hoy';
  if (offset === 1) return 'Mañana';
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return new Intl.DateTimeFormat('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(d);
}
function openCheckout() {
  if (!cart.length) return;
  closeDialogs();
  const future = cart.every((l) => l.product.future),
    table = mode === 'table';
  $('#checkout-dialog').innerHTML =
    `<div class="dialog-top"><h2 id="checkout-dialog-title">Confirmar pedido</h2><button class="icon-btn" data-close aria-label="Cerrar confirmación">${icon('x')}</button></div><form id="checkout-form" class="modal-body"><div class="checkout-summary"><div class="row">${icon(table ? 'table' : 'bag')}<strong>${table ? 'Tu pedido para la mesa 12' : 'Recoge en Bruma · Centro'}</strong></div><p>${table ? 'Lo llevaremos a tu mesa cuando esté listo.' : 'Centro, Mazatlán · Paga al recoger.'}</p></div><div class="checkout-fields">${table ? '' : `<div><label class="field-label" for="customer-name">¿A nombre de quién?</label><input class="field" id="customer-name" name="name" required maxlength="60" autocomplete="given-name" placeholder="Tu nombre"></div><div><label class="field-label" for="customer-phone">Tu número de celular</label><input class="field" id="customer-phone" name="phone" type="tel" inputmode="tel" required pattern="[0-9+ ()-]{10,18}" maxlength="18" placeholder="10 dígitos" autocomplete="tel"><p class="small muted" style="margin-top:5px">Para contactarte si hay algún detalle con tu pedido.</p></div><div><label class="field-label" for="customer-email">Tu correo electrónico</label><input class="field" id="customer-email" name="email" type="email" required maxlength="120" autocomplete="email" placeholder="ana@example.com"><p class="small muted">Usa datos de ejemplo. Esta demo no envía correos.</p></div><fieldset class="option-group" style="margin:0"><legend>¿Cuándo pasas por él?</legend><div class="choice-cards"><label class="choice"><input type="radio" name="timing" value="asap" checked><span><strong>Lo antes posible</strong><small>En 20–30 minutos</small></span></label><label class="choice"><input type="radio" name="timing" value="scheduled"><span><strong>Elegir una hora</strong><small>Programa tu pedido</small></span></label></div><div class="schedule-fields" id="schedule-fields" hidden><div class="fields-row"><div><label class="field-label" for="pickup-day">Día</label><select class="field" id="pickup-day">${[0, 1, 2, 3, 4, 5, 6, 7].map((o) => `<option value="${localDate(o)}" ${o > 0 && !future ? 'disabled' : ''}>${dateLabel(o)}</option>`).join('')}</select></div><div><label class="field-label" for="pickup-time">Hora</label><select class="field" id="pickup-time"></select></div></div><p>${future ? 'Estos productos se pueden programar hasta 7 días después.' : 'Este pedido puede programarse para hoy. Para probar otros días, elige solo productos de panadería.'}</p><p id="slot-hint"></p></div></fieldset>`}</div><div class="info-note">${icon('info')}<div><strong>${table ? 'Se enviará directamente a preparación' : 'El negocio debe aceptar tu pedido'}</strong>${table ? 'Si necesitas cancelar, solicita ayuda al personal.' : 'Podrás cancelar mientras esté pendiente de aceptación. Para pedidos programados, verás la hora límite al confirmar.'}</div></div><div class="confirm-total"><span>Total</span><strong>${money(total())}</strong></div><button class="primary" type="submit" id="confirm-order">Confirmar pedido ${icon('arrow')}</button><p class="demo-hint">Demostración local: usa datos de ejemplo. No se enviarán pedidos ni mensajes.</p></form>`;
  if (!table) {
    $('#checkout-form')
      .querySelectorAll('[name=timing]')
      .forEach(
        (r) =>
          (r.onchange = () => {
            const scheduled = $('[name=timing]:checked').value === 'scheduled';
            $('#schedule-fields').hidden = !scheduled;
            updateSlots();
          }),
      );
    $('#pickup-day').onchange = updateSlots;
    updateSlots();
  }
  $('#checkout-form').onsubmit = (e) => {
    e.preventDefault();
    submitOrder();
  };
  showDialog('#checkout-dialog');
  $('#checkout-dialog').scrollTop = 0;
}
function updateSlots() {
  const scheduled = $('[name=timing]:checked').value === 'scheduled',
    today = $('#pickup-day').value === localDate(0);
  const now = new Date();
  const minimum = today ? now.getHours() * 60 + now.getMinutes() + 30 : 8 * 60;
  const times = [];
  for (let t = 8 * 60; t <= 19 * 60 + 30; t += 30) {
    if (t >= minimum)
      times.push(
        String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'),
      );
  }
  $('#pickup-time').innerHTML = times.length
    ? times.map((t) => `<option value="${t}">${t}</option>`).join('')
    : '<option value="">Sin horarios disponibles</option>';
  $('#confirm-order').disabled = scheduled && !times.length;
  $('#slot-hint').textContent = times.length
    ? ''
    : 'No quedan horarios de ejemplo para este día. Puedes elegir otro día si todos los productos lo permiten.';
}
function submitOrder() {
  const scheduled = mode === 'pickup' && $('[name=timing]:checked').value === 'scheduled';
  if (mode === 'pickup') {
    const digits = $('#customer-phone').value.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) {
      $('#customer-phone').setCustomValidity('Escribe un número de teléfono válido.');
      $('#customer-phone').reportValidity();
      $('#customer-phone').oninput = () => $('#customer-phone').setCustomValidity('');
      return;
    }
  }
  const day = scheduled ? $('#pickup-day').value : null,
    time = scheduled ? $('#pickup-time').value : null;
  if (scheduled && !time) return;
  const date = scheduled ? new Date(day + 'T' + time) : null;
  const cutoff = date ? new Date(date.getTime() - 30 * 60000) : null;
  order = {
    number: 'B-' + String(Math.floor(1000 + Math.random() * 9000)),
    mode,
    lines: cart.map((l) => ({ ...l })),
    total: total(),
    name: mode === 'pickup' ? $('#customer-name').value.trim() : 'Mesa 12',
    scheduled,
    date,
    cutoff,
    status: mode === 'table' ? 'preparing' : 'pending',
    request: false,
  };
  cart = [];
  closeDialogs();
  renderCart();
  renderOrder();
  showDialog('#status-dialog');
}
const displayDate = (date) =>
  new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
function canCancel() {
  if (
    !order ||
    order.request ||
    ['cancelled', 'expired', 'preparing', 'ready'].includes(order.status)
  )
    return false;
  return (
    order.status === 'pending' ||
    (order.scheduled && order.status === 'accepted' && new Date() < order.cutoff)
  );
}
function renderOrder() {
  if (!order) return;
  const cancelled = order.status === 'cancelled',
    expired = order.status === 'expired',
    done = cancelled || expired;
  let heading, description, heroIcon;
  if (cancelled) {
    heading = 'Pedido cancelado';
    description = 'Tu pedido de ejemplo se canceló. No hay ningún cobro pendiente.';
    heroIcon = 'check';
  } else if (expired) {
    heading = 'El negocio no confirmó';
    description = 'El pedido venció sin pasar a preparación. Puedes volver a intentarlo.';
    heroIcon = 'clock';
  } else if (order.status === 'pending') {
    heading = 'Pedido recibido';
    description = 'El negocio está revisando tu pedido.';
    heroIcon = 'clock';
  } else if (order.status === 'accepted') {
    heading = order.scheduled ? 'Tu pedido está confirmado' : 'Pedido confirmado';
    description = order.scheduled
      ? 'El negocio reservó tu horario. Tu pedido pasará a preparación cuando corresponda.'
      : 'El negocio confirmó tu pedido.';
    heroIcon = 'calendar';
  } else if (order.status === 'preparing') {
    heading = 'En preparación';
    description =
      order.mode === 'table'
        ? 'El pedido está en cocina y barra. El personal lo llevará a la mesa 12.'
        : 'El negocio está preparando tus productos. Aquí verás cuando estén listos.';
    heroIcon = 'coffee';
  } else {
    heading = order.mode === 'table' ? 'Tu pedido está listo' : 'Todo listo para recoger';
    description =
      order.mode === 'table'
        ? 'Todos los productos están listos. El personal los llevará a tu mesa.'
        : 'Pasa por Bruma · Centro y comparte el número de tu pedido. Pagas al recoger.';
    heroIcon = 'check';
  }
  const steps = [
    ['pending', 'Pedido recibido', 'Esperando confirmación del negocio'],
    [
      'accepted',
      'Pedido confirmado',
      order.scheduled ? 'Horario reservado' : 'El negocio aceptó tu pedido',
    ],
    ['preparing', 'En preparación', 'Cocina y barra preparan tus productos'],
    [
      'ready',
      'Todo listo',
      order.mode === 'table' ? 'Listo para llevar a tu mesa' : 'Puedes pasar a recoger',
    ],
  ];
  const stage = ['pending', 'accepted', 'preparing', 'ready'].indexOf(order.status);
  $('#status-dialog').innerHTML =
    `<div class="dialog-top"><span class="eyebrow">Seguimiento del pedido</span><button class="icon-btn" data-close aria-label="Cerrar seguimiento">${icon('x')}</button></div><div class="status-hero"><div class="status-icon">${icon(heroIcon)}</div><div class="eyebrow">BRUMA · ${order.number}</div><h2 id="status-dialog-title">${heading}</h2><p>${description}</p></div><div class="modal-body" style="padding-top:0"><div class="status-meta"><div><small>${order.mode === 'table' ? 'Tu mesa' : 'A nombre de'}</small><strong>${escapeHTML(order.name)}</strong></div><div><small>${order.scheduled ? 'Para recoger · Programado' : 'Modalidad'}</small><strong>${order.scheduled ? displayDate(order.date) : order.mode === 'table' ? 'Comer aquí · Mesa 12' : 'Para recoger'}</strong></div></div>${
      done
        ? ''
        : `<ol class="timeline">${steps
            .filter(([s]) => order.mode !== 'table' || s !== 'accepted')
            .map(
              ([s, title, sub]) =>
                `<li class="${['pending', 'accepted', 'preparing', 'ready'].indexOf(s) <= stage ? 'active' : ''}"><span class="timeline-dot">${['pending', 'accepted', 'preparing', 'ready'].indexOf(s) < stage ? icon('check') : ''}</span><div><strong>${order.mode === 'table' && s === 'pending' ? 'Pedido enviado' : title}</strong><small>${order.mode === 'table' && s === 'pending' ? 'Enviado desde la mesa 12' : sub}</small></div></li>`,
            )
            .join('')}</ol>`
    }<div class="status-lines">${order.lines.map((l) => `<div><span>${l.qty} × ${l.product.name}</span><strong>${money(l.qty * l.price)}</strong></div>`).join('')}<div style="padding-top:12px"><strong>${done ? 'Total del pedido cancelado' : 'Pago en el negocio'}</strong><strong>${money(order.total)}</strong></div></div>${!done && order.scheduled ? `<p class="small muted" style="margin:15px 0">Cancelación directa hasta ${displayDate(order.cutoff)}, siempre que no haya pasado a preparación. Plazo de ejemplo.</p>` : ''}${!done ? (order.request ? `<div class="info-note">${icon('clock')}<div><strong>Cancelación solicitada</strong>Esperamos la respuesta del personal. Tu pedido todavía no está cancelado.</div></div>` : `<button class="text-btn cancel-button" id="cancel-order">${canCancel() ? 'Cancelar pedido' : 'Solicitar cancelación'}</button>`) : `<button class="primary" id="back-menu">Volver al menú ${icon('arrow')}</button>`}<div class="demo-controls"><div class="eyebrow">Controles de la demo · Simular al personal</div><div class="row">${order.status === 'pending' ? '<button data-status="accept">Aceptar pedido</button><button data-status="expire">Sin respuesta: vencer</button>' : ''}${order.status === 'accepted' ? '<button data-status="prepare">Iniciar preparación</button>' : ''}${order.status === 'preparing' ? '<button data-status="ready">Marcar todo listo</button>' : ''}${order.request ? '<button data-status="cancel">Autorizar cancelación</button><button data-status="keep">Mantener pedido</button>' : ''}${done ? '<span class="small muted">Puedes crear otro pedido desde el menú.</span>' : ''}</div></div></div>`;
  if ($('#cancel-order'))
    $('#cancel-order').onclick = () => {
      if (canCancel()) {
        order.status = 'cancelled';
        notify('Pedido de ejemplo cancelado');
      } else {
        order.request = true;
        notify('Solicitud enviada al personal de ejemplo');
      }
      renderOrder();
      renderCart();
    };
  if ($('#back-menu')) $('#back-menu').onclick = () => $('#status-dialog').close();
  $('#status-dialog')
    .querySelectorAll('[data-status]')
    .forEach(
      (b) =>
        (b.onclick = () => {
          const s = b.dataset.status;
          if (s === 'accept') order.status = order.scheduled ? 'accepted' : 'preparing';
          if (s === 'prepare') order.status = 'preparing';
          if (s === 'ready') order.status = 'ready';
          if (s === 'expire') order.status = 'expired';
          if (s === 'cancel') {
            order.status = 'cancelled';
            order.request = false;
          }
          if (s === 'keep') {
            order.request = false;
            notify('El negocio mantiene el pedido activo');
          }
          renderOrder();
          renderCart();
        }),
    );
  $('#status-dialog').scrollTop = 0;
}
$('#info-button').onclick = () => showDialog('#info-dialog');
renderContext();
renderCategories();
renderProducts();
renderCart();
