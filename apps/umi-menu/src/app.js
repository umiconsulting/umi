'use strict';
function cartMarkup() {
  if (loading || !menu)
    return '<div class="cart-empty"><h3>Consulta el menú</h3><p>Los productos se cargan desde el restaurante.</p></div>';
  if (context.kind !== 'table')
    return (
      '<div class="cart-empty"><div class="bag-drawing">' +
      icon('table') +
      '</div><h3>Consulta el menú</h3><p>Para pedir, escanea el QR de tu mesa. El personal puede ayudarte.</p></div>'
    );
  let valid = true,
    sum = 0;
  const lines = cart
    .map((line, index) => {
      const item = items().find((item) => item.productId === line.productId);
      let linePrice = '';
      try {
        const amount = MenuState.priceLine(items(), line);
        sum += amount;
        linePrice = money(amount);
      } catch {
        valid = false;
        linePrice = 'Revisar producto';
      }
      const names =
        item?.optionGroups
          .flatMap((group) => group.modifiers)
          .filter((modifier) =>
            line.modifiers?.some((selection) => selection.modifierId === modifier.id),
          )
          .map((modifier) => modifier.name) ?? [];
      return `<div class="cart-line">${item ? productPhoto(item) : ''}<div><div class="line-title">${escapeHTML(item?.name ?? 'Producto no disponible')}</div><div class="line-options">${escapeHTML(names.join(' · '))}</div>${line.note ? `<div class="line-options">${escapeHTML(line.note)}</div>` : ''}<div class="line-bottom"><div class="stepper"><button data-qty="${index}" data-delta="-1" aria-label="Quitar una unidad de ${escapeHTML(item?.name ?? 'producto')}" ${pending || sending ? 'disabled' : ''}>${icon('minus')}</button><span>${escapeHTML(line.quantity)}</span><button data-qty="${index}" data-delta="1" aria-label="Añadir una unidad de ${escapeHTML(item?.name ?? 'producto')}" ${pending || sending || line.quantity >= 50 ? 'disabled' : ''}>${icon('plus')}</button></div><span class="line-price">${escapeHTML(linePrice)}</span></div></div></div>`;
    })
    .join('');
  return (
    (cart.length
      ? lines +
        `<div class="subtotal"><span>Total estimado</span><strong>${valid ? money(sum) : 'Por revisar'}</strong></div>`
      : '<div class="cart-empty"><div class="bag-drawing">' +
        icon('bag') +
        '</div><h3>Tu pedido está vacío</h3><p>Elige productos del menú. Podrás revisarlos antes de enviar.</p></div>') +
    (pending
      ? '<p class="pending-notice" role="status">Hay un envío pendiente de comprobar. Reintenta el mismo pedido antes de cambiar productos.</p>'
      : '') +
    `<button class="primary" data-checkout ${sending || (!pending && (!cart.length || !valid)) ? 'disabled' : ''}>${sending ? 'Comprobando envío…' : pending ? 'Comprobar envío pendiente' : 'Revisar mi pedido'} ${icon('arrow')}</button><p class="cart-footnote">${icon('card')}Pagas en caja. El restaurante calcula el importe final.</p>`
  );
}
function bindCart(root) {
  root.querySelectorAll('[data-qty]').forEach((button) => {
    button.onclick = () => {
      if (pending || sending) return;
      const index = Number(button.dataset.qty),
        line = cart[index];
      line.quantity += Number(button.dataset.delta);
      cart = cart.filter((line) => line.quantity > 0);
      saveState();
      renderCart();
    };
  });
  root.querySelectorAll('[data-checkout]').forEach((button) => {
    button.onclick = openCheckout;
  });
  root.querySelectorAll('[data-view-order]').forEach((button) => {
    button.onclick = () => {
      renderReceipt();
      showDialog('#status-dialog');
    };
  });
}
function renderCart() {
  const last =
    receipt && menu
      ? '<button class="secondary order-link" data-view-order>Ver último pedido recibido</button>'
      : '';
  $('#cart-content').innerHTML = cartMarkup() + last;
  $('#cart-count').textContent = quantity();
  bindCart($('#cart-content'));
  $('#mobile-count').textContent = quantity();
  $('#mobile-label').textContent =
    context?.kind === 'table' ? 'Ver mi pedido' : 'Información del menú';
  let sum = 0;
  try {
    sum = cart.reduce((total, line) => total + MenuState.priceLine(items(), line), 0);
  } catch {
    sum = null;
  }
  $('#mobile-total').textContent = canOrder() && sum !== null ? money(sum) : '';
  if ($('#cart-dialog').open) renderCartDialog();
}
function renderCartDialog() {
  $('#cart-dialog').innerHTML =
    `<div class="dialog-top"><h2 id="cart-dialog-title">Tu pedido</h2><button class="icon-btn" data-close aria-label="Cerrar pedido">${icon('x')}</button></div><div class="modal-body">${cartMarkup()}${receipt ? '<button class="secondary order-link" data-view-order>Ver último pedido recibido</button>' : ''}</div>`;
  bindCart($('#cart-dialog'));
}
function openCheckout() {
  if (!canOrder() || sending || !cart.length) return;
  try {
    if (!pending) cart.forEach((line) => MenuState.validateLine(items(), line));
  } catch (error) {
    notify(error.message);
    return;
  }
  $('#checkout-dialog').innerHTML =
    `<div class="dialog-top"><h2 id="checkout-dialog-title">${pending ? 'Comprobar envío pendiente' : 'Confirmar pedido'}</h2><button class="icon-btn" data-close aria-label="Cerrar confirmación">${icon('x')}</button></div><div class="modal-body"><p>${escapeHTML(menu.merchantName)} · ${escapeHTML(menu.locationName)} · ${escapeHTML(menu.tableLabel)}</p><p>${pending ? 'Se enviará exactamente la misma solicitud, con la misma clave de envío. El restaurante devuelve la confirmación si ya recibió el pedido.' : 'El importe del carrito es una estimación. El restaurante verifica disponibilidad, opciones y precios al recibir el pedido. Pagas en caja.'}</p><p id="checkout-error" role="alert"></p><button class="primary" id="place-order">${pending ? 'Comprobar el mismo envío' : 'Enviar pedido a mi mesa'}</button></div>`;
  $('#place-order').onclick = submitOrder;
  showDialog('#checkout-dialog');
}
async function submitOrder() {
  if (!navigator.locks) {
    notify('Abre el menú en un navegador actualizado con conexión segura para enviar el pedido.');
    return;
  }
  await navigator.locks.request(storageKey, { ifAvailable: true }, async (lock) => {
    if (!lock) {
      notify('El pedido se comprueba en otra pestaña. Espera la confirmación.');
      return;
    }
    readState();
    if (!cart.length) {
      closeDialogs();
      renderCart();
      return;
    }
    await sendPendingOrder();
  });
}
async function sendPendingOrder() {
  if (!canOrder() || sending) return;
  sending = true;
  $('#place-order').disabled = true;
  $('#place-order').textContent = 'Comprobando envío…';
  $('#checkout-error').textContent = '';
  try {
    if (!pending) {
      cart.forEach((line) => MenuState.validateLine(items(), line));
      pending = { body: MenuState.pendingRequest(cart, crypto.randomUUID()) };
    }
    saveState(true);
    renderCart();
    const result = await UmiMenuAPI.placeOrder(context, pending.body);
    receipt = result;
    pending = null;
    cart = [];
    saveState();
    closeDialogs();
    renderReceipt();
    showDialog('#status-dialog');
  } catch (error) {
    if (error instanceof UmiMenuAPI.MenuApiError && !error.uncertain && !pending?.uncertain)
      pending = null;
    else if (pending) pending.uncertain = true;
    saveState();
    $('#checkout-error').textContent = error.message;
    $('#place-order').textContent = pending ? 'Comprobar el mismo envío' : 'Volver a enviar';
  } finally {
    sending = false;
    $('#place-order') && ($('#place-order').disabled = false);
    renderCart();
  }
}
function renderReceipt() {
  if (!receipt || !menu) return;
  $('#status-dialog').innerHTML =
    `<div class="dialog-top"><h2 id="status-dialog-title">Pedido recibido</h2><button class="icon-btn" data-close aria-label="Cerrar pedido recibido">${icon('x')}</button></div><div class="modal-body"><p class="order-number">${escapeHTML(receipt.reference)}</p><p>${escapeHTML(menu.merchantName)} · ${escapeHTML(menu.locationName)} · ${escapeHTML(menu.tableLabel)}</p><p>${receipt.unitCount} ${receipt.unitCount === 1 ? 'unidad' : 'unidades'} · ${escapeHTML(new Intl.NumberFormat('es-MX', { style: 'currency', currency: receipt.total.currency }).format(receipt.total.minorUnits / 100))}</p><p>El restaurante confirmó la recepción de este pedido. Pagas en caja.</p><p class="small muted">Para conocer el avance, pedir la cuenta o hacer un cambio, consulta al personal.</p></div>`;
}
function renderInfo() {
  $('#info-dialog .modal-body').innerHTML =
    `<div class="info-item">${icon('pin')}<div><strong>${escapeHTML(menu?.merchantName ?? 'Menú digital')}</strong><p>${escapeHTML(menu?.locationName ?? 'Consulta el enlace del restaurante.')}</p></div></div><div class="info-item">${icon('card')}<div><strong>${context?.kind === 'table' ? 'Paga en caja' : 'Consulta del menú'}</strong><p>${context?.kind === 'table' ? 'El restaurante calcula el importe final de tu pedido.' : 'Escanea el QR de tu mesa para hacer un pedido.'}</p></div></div>`;
  $('#info-title').textContent = menu
    ? `Información de ${menu.merchantName}`
    : 'Información del menú';
  showDialog('#info-dialog');
}
function showLoadError(message) {
  $('#menu-status').innerHTML =
    `<p role="alert">${escapeHTML(message)}</p><button class="secondary" id="retry-menu">Volver a cargar el menú</button>`;
  $('#retry-menu').onclick = loadCurrentMenu;
}
async function loadCurrentMenu() {
  if (sending || (loading && context)) return;
  loading = true;
  closeDialogs();
  menu = null;
  $('#products').innerHTML = '';
  $('.categories').innerHTML = '';
  $('#menu-status').innerHTML = '<p role="status">Cargando el menú del restaurante…</p>';
  renderCart();
  try {
    if (!context) context = UmiMenuAPI.resolveContext(new URL(location.href));
    if (!storageKey) {
      storageKey = await UmiMenuAPI.contextKey(context);
      readState();
    }
    menu = await UmiMenuAPI.loadMenu(context);
    loading = false;
    $('#menu-status').innerHTML = '';
    renderContext();
    renderCategories();
    if (context.kind === 'browse' && !menu.locationId) {
      $('#products').innerHTML = menu.locations.length
        ? `<div class="empty-results"><h3>Elige una sucursal</h3><p>Consulta sus productos y precios.</p><div class="location-choices">${menu.locations.map((branch) => `<button class="secondary" data-location="${branch.id}">${escapeHTML(branch.name)}</button>`).join('')}</div></div>`
        : '<div class="empty-results"><h3>Sin sucursales disponibles</h3><p>Consulta al restaurante.</p></div>';
      $('#products')
        .querySelectorAll('[data-location]')
        .forEach((button) => {
          button.onclick = () => {
            const url = new URL(location.href);
            url.searchParams.set('locationId', button.dataset.location);
            location.assign(url.pathname + url.search);
          };
        });
    } else renderProducts();
    renderCart();
  } catch (error) {
    loading = false;
    menu = null;
    renderContext();
    renderCart();
    showLoadError(error.message);
  }
}
$('#search').oninput = (event) => {
  search = event.target.value;
  $('#clear-search').hidden = !search;
  if (menu && (context.kind === 'table' || menu.locationId)) renderProducts();
};
$('#clear-search').onclick = clearMenuSearch;
$('#info-button').onclick = renderInfo;
$('#mobile-cart-button').onclick = () => {
  if (context?.kind !== 'table') renderInfo();
  else {
    renderCartDialog();
    showDialog('#cart-dialog');
  }
};
$('#refresh-menu').onclick = loadCurrentMenu;
loadCurrentMenu();

window.addEventListener('storage', (event) => {
  if (event.key !== storageKey || sending) return;
  readState();
  closeDialogs();
  renderCart();
});
