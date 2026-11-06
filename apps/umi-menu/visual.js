/* Extensiones visuales solicitadas: promociones y detalle individual. */
const promos = [
  {id:'combo-breakfast',name:'Desayuno sin prisa',price:189,previous:210,category:'breakfast',image:'toast',description:'French toast de la casa y latte con leche entera. Combo de ejemplo.',headline:'French toast + latte',caption:'French toast + latte',tone:'rose'},
  {id:'combo-coffee',name:'La pausa perfecta',price:109,previous:120,category:'coffee',image:'croissant',description:'Un croissant de mantequilla y latte con leche entera. Combo de ejemplo.',headline:'Croissant + latte',caption:'Croissant + latte',tone:'sand'},
  {id:'combo-dessert',name:'Algo dulce para cerrar',price:145,previous:160,category:'dessert',image:'cake',description:'Una rebanada de cheesecake de frutos rojos y latte con leche entera. Combo de ejemplo.',headline:'Cheesecake + latte',caption:'Cheesecake + latte',tone:'blue'}
];
promos.forEach(p=>products.push({...p,favorite:false,future:false,extras:[],stations:['Cocina','Barra']}));
const promotions=document.createElement('section');
promotions.className='promotions';promotions.setAttribute('aria-label','Promociones de ejemplo');
promotions.innerHTML=`<div class="promo-heading"><div><h2>Promociones</h2></div><div class="promo-navigation"><span class="small muted" id="promo-position" aria-live="off">01 / 03</span><button class="icon-btn" id="promo-prev" aria-label="Promoción anterior">←</button><button class="icon-btn" id="promo-next" aria-label="Siguiente promoción">→</button></div></div><div class="promo-track" tabindex="0" aria-label="Desliza para ver promociones">${promos.map((p,i)=>`<article class="promo-slide ${p.tone}" aria-label="Promoción ${i+1} de 3"><div class="promo-copy"><h3>${p.headline}</h3><div class="promo-bottom"><span class="promo-price">${money(p.price)} <del>${money(p.previous)}</del></span><button class="promo-cta" data-promo="${p.id}">Ver combo <span aria-hidden="true">↗</span></button></div></div><button class="promo-image" data-promo="${p.id}" aria-label="Ver ${p.name}"><img src="./files/${p.image}.jpg" alt="${p.caption}" loading="${i===0?'eager':'lazy'}"></button></article>`).join('')}</div><div class="promo-dots" role="group" aria-label="Elegir promoción">${promos.map((p,i)=>`<button aria-label="Ver promoción ${i+1}" aria-pressed="${i===0}" data-slide="${i}"></button>`).join('')}</div>`;
$('.welcome').after(promotions);
const track=$('.promo-track');let promoIndex=0;
function goPromo(i){promoIndex=Math.max(0,Math.min(promos.length-1,i));track.scrollTo({left:promoIndex*(track.clientWidth+16),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
$('#promo-prev').onclick=()=>goPromo(promoIndex-1);$('#promo-next').onclick=()=>goPromo(promoIndex+1);
track.addEventListener('scroll',()=>{promoIndex=Math.round(track.scrollLeft/(track.clientWidth+16));$('#promo-position').textContent=`0${promoIndex+1} / 03`;document.querySelectorAll('[data-slide]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.slide)===promoIndex)));$('#promo-prev').disabled=promoIndex===0;$('#promo-next').disabled=promoIndex===2;},{passive:true});
track.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();goPromo(promoIndex+(e.key==='ArrowRight'?1:-1));}});
$('#promo-prev').disabled=true;
document.querySelectorAll('[data-slide]').forEach(b=>b.onclick=()=>goPromo(Number(b.dataset.slide)));
document.querySelectorAll('[data-promo]').forEach(b=>b.onclick=()=>openProduct(b.dataset.promo));
// Autoavance con pausa por interacción, pestaña oculta o diálogo abierto.
const promoMotion = matchMedia('(prefers-reduced-motion: reduce)');
let promoPaused = promoMotion.matches;
let promoHovered = false;
let promoTouching = false;
let promoTimer;
function schedulePromo() {
  clearTimeout(promoTimer);
  if (promoPaused || document.hidden) return;
  promoTimer = setTimeout(() => {
    if (!promoHovered && !promoTouching && !promotions.contains(document.activeElement) && !document.querySelector('dialog[open]')) {
      goPromo((promoIndex + 1) % promos.length);
    }
    schedulePromo();
  }, 5000);
}
promotions.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') promoHovered = true; });
promotions.addEventListener('pointerleave', () => { promoHovered = false; schedulePromo(); });
promotions.addEventListener('pointerdown', () => { promoTouching = true; clearTimeout(promoTimer); });
window.addEventListener('pointerup', () => { if (promoTouching) { promoTouching = false; schedulePromo(); } });
window.addEventListener('pointercancel', () => { promoTouching = false; schedulePromo(); });
promotions.addEventListener('focusin', () => clearTimeout(promoTimer));
promotions.addEventListener('focusout', schedulePromo);
track.addEventListener('scroll', schedulePromo, {passive:true});
document.addEventListener('visibilitychange', schedulePromo);
promoMotion.addEventListener('change', () => { promoPaused = promoMotion.matches; schedulePromo(); });
schedulePromo();
const photoDialog=document.createElement('dialog');photoDialog.id='photo-dialog';photoDialog.className='photo-viewer';photoDialog.setAttribute('aria-labelledby','photo-title');document.body.append(photoDialog);
const baseOpenProduct=openProduct;
openProduct=function(id){baseOpenProduct(id);const p=selectedProduct;const photo=$('#product-dialog .modal-photo');const img=$('img',photo);const enlarge=document.createElement('button');enlarge.className='photo-enlarge';enlarge.type='button';enlarge.setAttribute('aria-label','Ampliar foto de '+p.name);img.replaceWith(enlarge);enlarge.append(img);const hint=document.createElement('span');hint.className='photo-hint';hint.textContent='Ver foto ↗';enlarge.append(hint);enlarge.onclick=()=>{photoDialog.innerHTML=`<div class="photo-viewer-top"><h2 id="photo-title">${escapeHTML(p.name)}</h2><button class="icon-btn" id="close-photo" aria-label="Cerrar foto ampliada">${icon('x')}</button></div><img src="./files/${p.image}.jpg" alt="${escapeHTML(p.name)}"><p>Fotografía ilustrativa · ${escapeHTML(p.name)}</p>`;$('#close-photo').onclick=()=>photoDialog.close();photoDialog.showModal();};};
photoDialog.addEventListener('click',e=>{if(e.target===photoDialog){const r=photoDialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)photoDialog.close();}});
const baseAddToCart=addToCart;
addToCart=function(){baseAddToCart();const b=$('#mobile-cart-button');b.classList.remove('added');void b.offsetWidth;b.classList.add('added');};
renderCategories();renderProducts();
