'use strict';
const photoDialog = document.createElement('dialog');
photoDialog.id = 'photo-dialog';
photoDialog.className = 'photo-viewer';
photoDialog.setAttribute('aria-labelledby', 'photo-title');
document.body.append(photoDialog);
function enableProductPhoto(item) {
  if (!photo(item)) return;
  const image = $('#product-dialog .modal-photo img');
  const button = document.createElement('button');
  button.className = 'photo-enlarge';
  button.type = 'button';
  button.setAttribute('aria-label', `Ampliar foto de ${item.name}`);
  image.replaceWith(button);
  button.append(image);
  button.onclick = () => {
    setDialogContent(
      photoDialog,
      `<div class="photo-viewer-top"><h2 id="photo-title">${escapeHTML(item.name)}</h2><button class="icon-btn" data-close aria-label="Cerrar foto ampliada">${icon('x')}</button></div>${productPhoto(item, true)}`,
    );
    photoDialog.showModal();
  };
}
