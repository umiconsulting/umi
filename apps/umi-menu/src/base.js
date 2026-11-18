'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
let menu = null,
  context = null,
  storageKey = null,
  cart = [],
  pending = null,
  receipt = null;
let category = 'all',
  search = '',
  selectedProduct = null,
  selectedQty = 1,
  sending = false,
  loading = true;
let toastTimer;
const money = (minorUnits) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: menu?.currency ?? 'MXN' }).format(
    minorUnits / 100,
  );
const items = () => menu?.items ?? [];
const quantity = () => cart.reduce((sum, line) => sum + line.quantity, 0);
const canOrder = () => !loading && Boolean(menu) && context?.kind === 'table';
const photo = (item) => {
  try {
    return item.imageUrl && new URL(item.imageUrl).protocol === 'https:' ? item.imageUrl : null;
  } catch {
    return null;
  }
};
const photoPlaceholder = () =>
  `<span class="menu-photo-placeholder" aria-hidden="true">${icon('coffee')}</span>`;
const productPhoto = (item, large = false, eager = false) =>
  photo(item)
    ? `<img src="${escapeHTML(photo(item))}" alt="${large ? escapeHTML(item.name) : ''}" width="800" height="600" loading="${large || eager ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer">`
    : photoPlaceholder();
document.addEventListener(
  'error',
  (event) => {
    const image = event.target;
    if (
      !(image instanceof HTMLImageElement) ||
      !image.closest('.menu-product,.cart-line,.modal-photo,.photo-viewer')
    )
      return;
    const placeholder = document.createElement('span');
    placeholder.innerHTML = photoPlaceholder();
    const button = image.closest('.photo-enlarge');
    (button ?? image).replaceWith(placeholder.firstElementChild);
  },
  true,
);
function notify(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 5000);
}
function showDialog(id) {
  if (!$(id).open) $(id).showModal();
}
function closeDialogs() {
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
}
document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close]');
  if (close) close.closest('dialog')?.close();
  if (event.target instanceof HTMLDialogElement) {
    const r = event.target.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      event.target.close();
  }
});
function saveState(required = false) {
  try {
    if (!storageKey) throw new Error();
    localStorage.setItem(storageKey, JSON.stringify({ cart, pending, receipt }));
    return true;
  } catch {
    if (required)
      throw new Error(
        'Permite guardar datos en este navegador antes de enviar. Esto permite recuperar un envío sin duplicarlo.',
      );
    notify('El navegador no pudo guardar el borrador. Conserva esta pestaña abierta.');
    return false;
  }
}
function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    cart = saved?.cart?.length ? UmiMenuAPI.parseCart(saved.cart) : [];
    pending = saved?.pending
      ? {
          body: UmiMenuAPI.parsePending(saved.pending.body),
          uncertain: saved.pending.uncertain === true,
        }
      : null;
    receipt = UmiMenuAPI.parseReceipt(saved?.receipt);
    if (pending) cart = JSON.parse(JSON.stringify(pending.body.lines));
  } catch {
    cart = [];
    pending = null;
    receipt = null;
  }
}
function renderContext() {
  const label = context?.kind === 'table' && menu ? menu.tableLabel : 'Consulta del menú';
  const description =
    context?.kind === 'table'
      ? 'Pagas en caja. El restaurante confirma tu pedido al enviarlo.'
      : 'Para pedir desde la mesa, escanea su QR. Puedes consultar el menú sin hacer un pedido.';
  const name = menu
    ? `${menu.merchantName} · ${menu.locationName ?? 'Elige una sucursal'}`
    : 'Menú digital';
  $('#fulfillment').innerHTML =
    `<div class="row"><span class="context-icon">${icon('table')}</span><div><div class="context-title">${escapeHTML(label)}</div><div class="context-sub">${escapeHTML(name)}</div></div></div><p class="small muted">${escapeHTML(description)}</p>`;
  $('#mobile-context').textContent = `${label} · ${menu?.locationName ?? 'Menú digital'}`;
  $('.brand-name').textContent = menu?.merchantName ?? 'umi';
  $('.brand-tag').textContent = menu?.locationName ?? 'Menú digital';
  $('.location-short').textContent = menu?.locationName ?? '';
  document.title = menu ? `${menu.merchantName} · Menú con Umi` : 'Menú con Umi';
  $('#navigation-table').textContent = label;
  $('#navigation-table').hidden = false;
  $('#menu-currency').textContent =
    `Precios en ${menu?.currency ?? 'la moneda del restaurante'}. Si tienes una alergia, consulta al personal.`;
  $('#restaurant-footer').textContent = name;
}
function categories() {
  const groups = new Map([['all', 'Todo el menú']]);
  for (const item of items())
    if (item.category?.id) groups.set(item.category.id, item.category.name);
  return [...groups].map(([id, name]) => ({ id, name }));
}
function renderCategories() {
  const groups = categories();
  if (!groups.some((group) => group.id === category)) category = 'all';
  $('.categories').innerHTML = groups
    .map(
      (group) =>
        `<button class="category" role="tab" aria-selected="${group.id === category}" type="button" data-category="${escapeHTML(group.id)}">${escapeHTML(group.name)}</button>`,
    )
    .join('');
  $('.categories')
    .querySelectorAll('button')
    .forEach((button) => {
      button.onclick = () => {
        category = button.dataset.category;
        renderCategories();
        renderProducts();
        $(`[data-category="${category}"]`).focus();
      };
    });
}
function normalized(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
function availabilityLabel(item) {
  if (item.hasVariants) return 'Opciones disponibles con el personal';
  return (
    {
      enabled: '',
      disabled: 'No disponible',
      temporarily_unavailable: 'Agotado por ahora',
      out_of_assortment: 'No disponible en esta sucursal',
      future_availability: 'Disponible más adelante',
    }[item.availability] ?? 'No disponible'
  );
}
function clearMenuSearch() {
  search = '';
  $('#search').value = '';
  $('#clear-search').hidden = true;
  renderProducts();
  $('#search').focus();
}
function renderProducts() {
  if (context?.kind === 'browse' && !menu?.locationId) return;
  const list = items().filter(
    (item) =>
      (category === 'all' || item.category?.id === category) &&
      normalized(`${item.name} ${item.description ?? ''}`).includes(normalized(search)),
  );
  $('#category-title').textContent = search
    ? 'Resultados de búsqueda'
    : (categories().find((group) => group.id === category)?.name ?? 'Menú');
  $('#result-count').textContent = `${list.length} ${list.length === 1 ? 'producto' : 'productos'}`;
  $('#products').innerHTML = list.length
    ? `<div class="product-grid">${list.map((item, index) => `<button type="button" class="menu-product" data-product="${escapeHTML(item.productId)}" aria-label="Ver ${escapeHTML(item.name)}, ${escapeHTML(money(item.price.minorUnits))}">${productPhoto(item, false, index < 2)}<span class="menu-product-name">${escapeHTML(item.name)}</span><span class="menu-product-price">${escapeHTML(money(item.price.minorUnits))}</span>${availabilityLabel(item) ? `<span class="small muted">${escapeHTML(availabilityLabel(item))}</span>` : ''}</button>`).join('')}</div>`
    : search.trim()
      ? `<div class="empty-results"><h3>No encontramos «${escapeHTML(search.trim())}»</h3><p>Prueba otro nombre o borra la búsqueda para ver los productos de esta categoría.</p><button class="secondary" id="reset-search">Borrar búsqueda</button></div>`
      : '<div class="empty-results"><h3>Sin productos disponibles</h3><p>Revisa otra categoría o consulta al personal.</p></div>';
  $('#reset-search')?.addEventListener('click', clearMenuSearch);
  $('#products')
    .querySelectorAll('[data-product]')
    .forEach((button) => {
      button.onclick = () => openProduct(button.dataset.product);
    });
}
function selectedLine() {
  return {
    productId: selectedProduct.productId,
    quantity: selectedQty,
    modifiers: [...$('#product-dialog').querySelectorAll('input[data-modifier]:checked')].map(
      (input) => ({ modifierId: input.dataset.modifier, quantity: 1 }),
    ),
    note: $('#product-note')?.value.trim() || null,
  };
}
function openProduct(id) {
  selectedProduct = items().find((item) => item.productId === id);
  if (!selectedProduct) return;
  selectedQty = 1;
  const item = selectedProduct;
  const editable =
    canOrder() && !pending && !sending && item.availability === 'enabled' && !item.hasVariants;
  $('#product-dialog').innerHTML =
    `<div class="modal-photo">${productPhoto(item, true)}<button class="icon-btn" data-close aria-label="Cerrar producto">${icon('x')}</button></div><div class="modal-body"><h2 id="product-dialog-title">${escapeHTML(item.name)}</h2><p class="description">${escapeHTML(item.description ?? '')}</p>${item.allergens.length ? `<p class="small">Alérgenos registrados: ${item.allergens.map((a) => escapeHTML(a.label ?? a.name ?? a.code)).join(', ')}. Consulta al personal.</p>` : '<p class="small muted">Consulta al personal si tienes una alergia.</p>'}${availabilityLabel(item) ? `<p>${escapeHTML(availabilityLabel(item))}</p>` : ''}${item.optionGroups.map((group) => `<fieldset class="option-group" ${editable ? '' : 'disabled'}><legend>${escapeHTML(group.name)} <span class="optional">${group.minSelect ? `Mínimo ${group.minSelect}` : 'Opcional'}${group.maxSelect ? ` · Máximo ${group.maxSelect}` : ''}</span></legend>${group.minSelect === 0 && group.maxSelect === 1 ? `<label class="option-row"><input type="radio" name="group-${group.id}" checked><span>Sin extra</span></label>` : ''}${group.modifiers.map((modifier) => `<label class="option-row"><input type="${group.maxSelect === 1 ? 'radio' : 'checkbox'}" name="group-${group.id}" data-modifier="${modifier.id}"><span>${escapeHTML(modifier.name)}</span><span>${modifier.priceDelta.minorUnits ? `+${escapeHTML(money(modifier.priceDelta.minorUnits))}` : 'Incluida'}</span></label>`).join('')}</fieldset>`).join('')}${editable ? '<div class="note-field"><label class="field-label" for="product-note">Indicaciones <span class="optional">Opcional</span></label><textarea class="field" id="product-note" maxlength="500" placeholder="Por ejemplo: sin azúcar."></textarea></div>' : ''}<p class="small" id="product-error" role="status"></p></div><div class="modal-actions">${editable ? `<div class="stepper"><button type="button" id="product-minus" aria-label="Reducir cantidad">${icon('minus')}</button><span id="product-quantity">1</span><button type="button" id="product-plus" aria-label="Aumentar cantidad">${icon('plus')}</button></div><button class="primary" id="add-to-cart"><span>Agregar al pedido</span><span id="product-total"></span></button>` : `<p class="small">${pending ? 'Comprueba primero el envío pendiente.' : context?.kind === 'table' ? 'Consulta al personal para pedir este producto.' : 'Escanea el QR de tu mesa para hacer un pedido.'}</p>`}</div>`;
  if (editable) {
    $('#product-minus').onclick = () => {
      selectedQty = Math.max(1, selectedQty - 1);
      updateProductTotal();
    };
    $('#product-plus').onclick = () => {
      selectedQty = Math.min(50, selectedQty + 1);
      updateProductTotal();
    };
    $('#product-dialog')
      .querySelectorAll('input,textarea')
      .forEach((input) => {
        input.oninput = updateProductTotal;
      });
    $('#add-to-cart').onclick = () => {
      try {
        const line = selectedLine();
        MenuState.validateLine(items(), line);
        cart = MenuState.addLine(cart, line);
        saveState();
        $('#product-dialog').close();
        renderCart();
        notify('Agregado a tu pedido.');
      } catch (error) {
        $('#product-error').textContent = error.message;
      }
    };
    updateProductTotal();
  }
  showDialog('#product-dialog');
  if (typeof enableProductPhoto === 'function') enableProductPhoto(item);
}
function updateProductTotal() {
  $('#product-dialog')
    .querySelectorAll('fieldset.option-group')
    .forEach((fieldset, index) => {
      const group = selectedProduct.optionGroups[index];
      if (group.maxSelect === 1 || group.maxSelect === null) return;
      const count = fieldset.querySelectorAll('input:checked').length;
      fieldset.querySelectorAll('input:not(:checked)').forEach((input) => {
        input.disabled = count >= group.maxSelect;
      });
    });
  $('#product-quantity').textContent = selectedQty;
  $('#product-minus').disabled = selectedQty === 1;
  $('#product-plus').disabled = selectedQty === 50;
  try {
    $('#product-total').textContent = money(MenuState.priceLine(items(), selectedLine()));
    $('#product-error').textContent = '';
    $('#add-to-cart').disabled = false;
  } catch (error) {
    $('#product-total').textContent = '';
    $('#product-error').textContent = error.message;
    $('#add-to-cart').disabled = true;
  }
}
