const navigationToggle = document.querySelector('#navigation-toggle');
const navigationPanel = document.querySelector('#navigation-panel');
function closeNavigation(returnFocus = false) {
  navigationPanel.hidden = true;
  navigationToggle.setAttribute('aria-expanded', 'false');
  navigationToggle.setAttribute('aria-label', 'Abrir menú');
  if (returnFocus) navigationToggle.focus();
}
navigationToggle.addEventListener('click', () => {
  const opening = navigationPanel.hidden;
  navigationPanel.hidden = !opening;
  navigationToggle.setAttribute('aria-expanded', String(opening));
  navigationToggle.setAttribute('aria-label', opening ? 'Cerrar menú' : 'Abrir menú');
  if (opening) navigationPanel.querySelector('button:not([hidden])').focus();
});
navigationPanel.addEventListener('click', e => {
  if (e.target.closest('button')) closeNavigation(!!e.target.closest('[data-mode]'));
});
document.addEventListener('click', e => {
  if (!e.target.closest('.header-menu')) closeNavigation();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !navigationPanel.hidden) { e.preventDefault(); closeNavigation(true); }
});
document.addEventListener('focusin', e => {
  if (!e.target.closest('.header-menu')) closeNavigation();
});
if (tableLocked) {
  const context = document.querySelector('#navigation-table');
  context.hidden = false;
  context.textContent = 'Mesa ' + tableNumber + ' · Identificada por QR';
}
