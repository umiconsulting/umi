'use strict';
const navigationToggle = $('#navigation-toggle');
const navigationPanel = $('#navigation-panel');
function closeNavigation(returnFocus = false) {
  navigationPanel.hidden = true;
  navigationToggle.setAttribute('aria-expanded', 'false');
  navigationToggle.setAttribute('aria-label', 'Abrir menú');
  if (returnFocus) navigationToggle.focus();
}
navigationToggle.onclick = () => {
  const opening = navigationPanel.hidden;
  navigationPanel.hidden = !opening;
  navigationToggle.setAttribute('aria-expanded', String(opening));
  navigationToggle.setAttribute('aria-label', opening ? 'Cerrar menú' : 'Abrir menú');
  if (opening) navigationPanel.querySelector('button').focus();
};
navigationPanel.addEventListener('click', (event) => {
  if (event.target.closest('button')) closeNavigation();
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.header-menu')) closeNavigation();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !navigationPanel.hidden) {
    event.preventDefault();
    closeNavigation(true);
  }
});
document.addEventListener('focusin', (event) => {
  if (!event.target.closest('.header-menu')) closeNavigation();
});
