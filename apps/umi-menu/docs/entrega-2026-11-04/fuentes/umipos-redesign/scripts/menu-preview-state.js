// State bridge for the device viewer. Everything stays in this browser tab.
(() => {
  const capture = () => ({
    mode, category, search, cart, order, selectedQty,
    product: selectedProduct?.id,
    dialog: document.querySelector('dialog[open]')?.id,
    fields: [...document.querySelectorAll('dialog[open] input,dialog[open] textarea,dialog[open] select')].map(field => ({
      id: field.id, name: field.name, type: field.type, value: field.value, checked: field.checked,
    })),
  });
  window.__umiMenuPreview = {
    capture,
    restore(state) {
      if (!state) return;
      mode=state.mode;category=state.category;search=state.search;cart=state.cart;order=state.order;
      renderContext();renderCategories();renderProducts();renderCart();
      $('#search').value=search;$('#clear-search').hidden=!search;
      document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
      if(state.dialog==='product-dialog'&&state.product)openProduct(state.product);
      if(state.dialog==='cart-dialog'){renderCartDialog();showDialog('#cart-dialog');}
      if(state.dialog==='checkout-dialog')openCheckout();
      if(state.dialog==='status-dialog'&&order){renderOrder();showDialog('#status-dialog');}
      if(state.dialog==='info-dialog')showDialog('#info-dialog');
      for(const field of state.fields){
        const input=field.id?document.getElementById(field.id):[...document.querySelectorAll('dialog[open] input')].find(el=>el.name===field.name&&el.value===field.value);
        if(!input)continue;
        if(field.type==='checkbox'||field.type==='radio')input.checked=field.checked;
        else input.value=field.value;
        input.dispatchEvent(new Event('change',{bubbles:true}));
      }
      if(state.dialog==='product-dialog'){
        selectedQty=state.selectedQty;
        updateProductTotal();
      }
    },
  };
  const publish=()=>queueMicrotask(()=>parent.postMessage({type:'umi-menu:preview-state',state:capture()},location.origin));
  for(const event of ['click','input','change'])document.addEventListener(event,publish);
})();
