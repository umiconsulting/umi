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
function placeholderKind(item) {
  const category = normalized(item?.category?.name ?? '');
  const name = normalized(item?.name ?? '');
  const classify = (text) => {
    if (
      /\b(postres?|pasteles?|cake|brownie|galletas?|cookies?|cheesecake|flan|tartas?|dulces?|panaderia|pan dulce|croissant|concha|coricos?|coyota|chocolatin|berlinesa|danesa|donas?|medialuna|oreja|peinado|rol|roll|trenza)\b/.test(
        text,
      )
    )
      return 'dessert';
    if (
      /\b(bebidas?|cafes?|coffee|espresso|americano|capuccino|cappuccino|latte|flatwhite|moca|mocha|matcha|chai|te|tisana|limonada|kombucha|kombu|cold brew|carajillo|aeropress|v60|origami|prensa|chocorico|jamai k|topochico|margarita|jugos?|smoothies?)\b/.test(
        text,
      )
    )
      return 'drink';
    if (
      /\b(comidas?|alimentos?|desayunos?|sandwich|sandwiches|panini|pizza|pepperoni|ensaladas?|hamburguesas?|burgir|bagel|huevos?|chilaquiles|omelette|tocino|sopas?|pasta|hogaza|brioche)\b/.test(
        text,
      )
    )
      return 'food';
    return null;
  };
  return classify(category) ?? classify(name) ?? 'neutral';
}
const photoPlaceholder = (kind = 'neutral') => {
  const icons = { food: 'pastry', drink: 'coffee', dessert: 'cake', neutral: 'bag' };
  const type = Object.hasOwn(icons, kind) ? kind : 'neutral';
  return `<span class="menu-photo-placeholder placeholder-${type}" aria-hidden="true">${icon(icons[type])}</span>`;
};
const productPhoto = (item, large = false, eager = false) =>
  photo(item)
    ? `<img data-fallback-kind="${placeholderKind(item)}" src="${escapeHTML(photo(item))}" alt="${large ? escapeHTML(item.name) : ''}" width="800" height="600" loading="${large || eager ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer">`
    : photoPlaceholder(placeholderKind(item));
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
    placeholder.innerHTML = photoPlaceholder(image.dataset.fallbackKind);
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
  $('#fulfillment').innerHTML =
    `<div class="row"><span class="context-icon">${icon('table')}</span><div><div class="context-title">${escapeHTML(label)}</div></div></div><p class="small muted">${escapeHTML(description)}</p>`;
  $('#mobile-context').textContent = label;
  $('.brand-name').textContent = menu?.merchantName ?? 'umi';
  document.title = menu ? `${menu.merchantName} · Menú con Umi` : 'Menú con Umi';
  $('#navigation-table').textContent = label;
  $('#navigation-table').hidden = false;
  $('#menu-currency').textContent =
    `Precios en ${menu?.currency ?? 'la moneda del restaurante'}. Si tienes una alergia, consulta al personal.`;
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
  if (item.hasVariants && item.availability === 'enabled') return 'Elige una presentación';
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
function canAddProduct(item) {
  return canOrder() && !pending && !sending && item.availability === 'enabled';
}
function productAddButton(item) {
  return `<button class="product-add icon-btn" type="button" data-add-product="${item.productId}" aria-label="Agregar ${escapeHTML(item.name)} al carrito" ${canAddProduct(item) ? '' : 'disabled'}>${icon('plus')}</button>`;
}
function productCard(item, index) {
  const name = escapeHTML(item.name);
  const availability = availabilityLabel(item);
  const groups = item.optionGroups
    .map(
      (group) =>
        `<div class="card-option-summary"><strong>${escapeHTML(group.name)}</strong><p class="small muted">${group.minSelect ? `Mínimo ${group.minSelect}` : 'Opcional'}${group.maxSelect ? ` · Máximo ${group.maxSelect}` : ''}</p><ul>${group.modifiers.map((modifier) => `<li>${escapeHTML(modifier.name)}${modifier.priceDelta.minorUnits ? ` · ${escapeHTML(money(modifier.priceDelta.minorUnits))}` : ''}</li>`).join('')}</ul></div>`,
    )
    .join('');
  const allergy = item.allergens.length
    ? `Alérgenos registrados: ${item.allergens.map((a) => escapeHTML(a.label ?? a.name ?? a.code)).join(', ')}. Consulta al personal.`
    : 'Consulta al personal si tienes una alergia.';
  return `<article class="menu-product product-card" data-product="${item.productId}" aria-label="${name}"><div class="product-card-inner"><div class="product-card-front"><button class="product-card-open" type="button" data-flip-product aria-expanded="false" aria-controls="details-${item.productId}" aria-label="Ver detalles de ${name}">${productPhoto(item, false, index < 2)}<span class="menu-product-name">${name}</span>${availability ? `<span class="small muted card-availability">${escapeHTML(availability)}</span>` : ''}</button><div class="product-card-footer"><span class="menu-product-price">${escapeHTML(money(item.price.minorUnits))}</span>${productAddButton(item)}</div></div><div class="product-card-back" id="details-${item.productId}" aria-hidden="true" role="group" tabindex="0" aria-label="Detalles de ${name}. Pulsa Enter o Escape para volver." inert><div class="product-card-details" tabindex="0" role="region" aria-label="Detalles de ${name}"><h3>${name}</h3><p class="menu-product-price">${escapeHTML(money(item.price.minorUnits))}</p>${item.category ? `<p class="small muted">${escapeHTML(item.category.name)}</p>` : ''}<p>${escapeHTML(item.description || 'Este producto no tiene una descripción registrada.')}</p>${availability ? `<p class="small">${escapeHTML(availability)}</p>` : ''}${groups}<p class="small muted">${allergy}</p></div><div class="product-card-footer">${item.availability === 'enabled' && context?.kind === 'table' ? `<button class="card-customize secondary" type="button" data-customize-product="${item.productId}" ${canAddProduct(item) ? '' : 'disabled'}>${item.hasVariants || item.optionGroups.length ? 'Elegir opciones' : 'Personalizar'}</button>` : `<span class="small muted">${context?.kind === 'table' ? '' : 'Escanea el QR para pedir.'}</span>`}${productAddButton(item)}</div></div></div></article>`;
}
function flipProductCard(card, flipped) {
  card.classList.toggle('is-flipped', flipped);
  const front = card.querySelector('.product-card-front');
  const back = card.querySelector('.product-card-back');
  const opener = card.querySelector('[data-flip-product]');
  front.inert = flipped;
  back.inert = !flipped;
  front.setAttribute('aria-hidden', String(flipped));
  back.setAttribute('aria-hidden', String(!flipped));
  opener.setAttribute('aria-expanded', String(flipped));
  (flipped ? back : opener).focus({ preventScroll: true });
}
function syncProductAddButtons() {
  document.querySelectorAll('[data-add-product],[data-customize-product]').forEach((button) => {
    const id = button.dataset.addProduct ?? button.dataset.customizeProduct;
    const item = items().find((item) => item.productId === id);
    button.disabled = !item || !canAddProduct(item);
  });
}
function addProductFromCard(id) {
  const item = items().find((item) => item.productId === id);
  if (!item || !canAddProduct(item)) return;
  if (item.hasVariants || item.optionGroups.length) {
    openProduct(id);
    return;
  }
  try {
    const line = { productId: id, quantity: 1, modifiers: [], note: null };
    MenuState.validateLine(items(), line);
    cart = MenuState.addLine(cart, line);
    saveState();
    renderCart();
    notify('Agregado a tu pedido.');
  } catch (error) {
    notify(error.message);
  }
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
    ? `<div class="product-grid">${list.map(productCard).join('')}</div>`
    : search.trim()
      ? `<div class="empty-results"><h3>No encontramos «${escapeHTML(search.trim())}»</h3><p>Prueba otro nombre o borra la búsqueda para ver los productos de esta categoría.</p><button class="secondary" id="reset-search">Borrar búsqueda</button></div>`
      : '<div class="empty-results"><h3>Sin productos disponibles</h3><p>Revisa otra categoría o consulta al personal.</p></div>';
  $('#reset-search')?.addEventListener('click', clearMenuSearch);
  $('#products')
    .querySelectorAll('[data-product]')
    .forEach((card) => {
      card.querySelector('[data-flip-product]').onclick = () => flipProductCard(card, true);
      card.querySelector('.product-card-back').onclick = (event) => {
        if (!event.target.closest('button,input,textarea,select,a,label'))
          flipProductCard(card, false);
      };
      card.querySelectorAll('[data-add-product]').forEach((button) => {
        button.onclick = () => addProductFromCard(button.dataset.addProduct);
      });
      card
        .querySelector('[data-customize-product]')
        ?.addEventListener('click', (event) =>
          openProduct(event.currentTarget.dataset.customizeProduct),
        );
      card.addEventListener('keydown', (event) => {
        if (
          (event.key === 'Escape' ||
            (event.key === 'Enter' && event.target === card.querySelector('.product-card-back'))) &&
          card.classList.contains('is-flipped')
        ) {
          event.preventDefault();
          flipProductCard(card, false);
        }
      });
    });
}
function selectedLine() {
  return {
    productId: selectedProduct.productId,
    quantity: selectedQty,
    ...($('#product-dialog input[data-variant]:checked')
      ? { variantId: $('#product-dialog input[data-variant]:checked').dataset.variant }
      : {}),
    modifiers: [...$('#product-dialog').querySelectorAll('input[data-modifier]:checked')].map(
      (input) => ({ modifierId: input.dataset.modifier, quantity: 1 }),
    ),
    note: $('#product-note')?.value.trim() || null,
  };
}
function variantChoices(item, editable) {
  const choices = item.variants ?? [];
  return `<fieldset class="option-group" ${editable ? '' : 'disabled'}><legend>Presentación <span class="optional">Obligatoria</span></legend>${choices.length ? choices.map((variant) => `<label class="option-row"><input type="radio" name="product-variant" data-variant="${variant.id}" ${variant.availability === 'enabled' ? '' : 'disabled'}><span>${escapeHTML(variant.name)}${variant.availability === 'enabled' ? '' : ' · No disponible'}</span><span>${escapeHTML(money(item.price.minorUnits + variant.priceDelta.minorUnits))}</span></label>`).join('') : '<p class="small" role="status">No pudimos cargar las presentaciones. Actualiza el menú antes de agregar este producto.</p>'}</fieldset>`;
}
function openProduct(id) {
  selectedProduct = items().find((item) => item.productId === id);
  if (!selectedProduct) return;
  selectedQty = 1;
  const item = selectedProduct;
  const editable = canOrder() && !pending && !sending && item.availability === 'enabled';
  $('#product-dialog').innerHTML =
    `<div class="modal-photo">${productPhoto(item, true)}<button class="icon-btn" data-close aria-label="Cerrar producto">${icon('x')}</button></div><div class="modal-body"><h2 id="product-dialog-title">${escapeHTML(item.name)}</h2><p class="description">${escapeHTML(item.description ?? '')}</p>${item.allergens.length ? `<p class="small">Alérgenos registrados: ${item.allergens.map((a) => escapeHTML(a.label ?? a.name ?? a.code)).join(', ')}. Consulta al personal.</p>` : '<p class="small muted">Consulta al personal si tienes una alergia.</p>'}${availabilityLabel(item) ? `<p>${escapeHTML(availabilityLabel(item))}</p>` : ''}${item.hasVariants ? variantChoices(item, editable) : ''}${item.optionGroups.map((group) => `<fieldset class="option-group" data-option-group="${group.id}" ${editable ? '' : 'disabled'}><legend>${escapeHTML(group.name)} <span class="optional">${group.minSelect ? `Mínimo ${group.minSelect}` : 'Opcional'}${group.maxSelect ? ` · Máximo ${group.maxSelect}` : ''}</span></legend>${group.minSelect === 0 && group.maxSelect === 1 ? `<label class="option-row"><input type="radio" name="group-${group.id}" checked><span>Sin extra</span></label>` : ''}${group.modifiers.map((modifier) => `<label class="option-row"><input type="${group.maxSelect === 1 ? 'radio' : 'checkbox'}" name="group-${group.id}" data-modifier="${modifier.id}"><span>${escapeHTML(modifier.name)}</span><span>${modifier.priceDelta.minorUnits ? `+${escapeHTML(money(modifier.priceDelta.minorUnits))}` : 'Incluida'}</span></label>`).join('')}</fieldset>`).join('')}${editable ? '<div class="note-field"><label class="field-label" for="product-note">Indicaciones <span class="optional">Opcional</span></label><textarea class="field" id="product-note" maxlength="500" placeholder="Por ejemplo: sin azúcar."></textarea></div>' : ''}<p class="small" id="product-error" role="status"></p></div><div class="modal-actions">${editable ? `<div class="stepper"><button type="button" id="product-minus" aria-label="Reducir cantidad">${icon('minus')}</button><span id="product-quantity">1</span><button type="button" id="product-plus" aria-label="Aumentar cantidad">${icon('plus')}</button></div><button class="primary" id="add-to-cart"><span>Agregar al pedido</span><span id="product-total"></span></button>` : `<p class="small">${pending ? 'Comprueba primero el envío pendiente.' : context?.kind === 'table' ? 'Consulta al personal para pedir este producto.' : 'Escanea el QR de tu mesa para hacer un pedido.'}</p>`}</div>`;
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
    .querySelectorAll('fieldset[data-option-group]')
    .forEach((fieldset) => {
      const group = selectedProduct.optionGroups.find(
        (group) => group.id === fieldset.dataset.optionGroup,
      );
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
