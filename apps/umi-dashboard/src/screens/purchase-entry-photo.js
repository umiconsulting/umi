import { t } from '@lingui/core/macro';
const ABORT_ERROR = 'AbortError';
export const PURCHASE_PHOTO_LIMIT = 700 * 1024;
export function validatePurchasePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error(t`Elige una foto JPEG, PNG o WebP.`);
  if (file.size > 12 * 1024 * 1024 || file.size <= 0)
    throw new Error(t`La foto debe pesar hasta 12 MiB.`);
}
export function validatePurchaseEnvelope(envelope) {
  if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > 1024 * 1024)
    throw new Error(t`La compra ocupa demasiado espacio. Quita la foto o usa una más pequeña.`);
}
function readData(blob, signal) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    signal?.addEventListener('abort', abort, { once: true });
    reader.onload = () => {
      signal?.removeEventListener('abort', abort);
      resolve(reader.result);
    };
    reader.onerror = () => {
      signal?.removeEventListener('abort', abort);
      reject(new Error(t`No se pudo leer la foto. Elige otra foto o quítala.`));
    };
    reader.onabort = () => reject(Object.assign(new Error(), { name: ABORT_ERROR }));
    reader.readAsDataURL(blob);
  });
}
export async function preparePurchasePhoto(file, { signal } = {}) {
  validatePurchasePhoto(file);
  signal?.throwIfAborted();
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      const abort = () => {
        image.src = '';
        reject(Object.assign(new Error(), { name: ABORT_ERROR }));
      };
      signal?.addEventListener('abort', abort, { once: true });
      image.onload = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      image.onerror = () => {
        signal?.removeEventListener('abort', abort);
        reject(new Error(t`No se pudo abrir la foto. Elige otra foto o quítala.`));
      };
      image.src = url;
    });
    signal?.throwIfAborted();
    let blob = file;
    if (file.size > PURCHASE_PHOTO_LIMIT) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      let found = false;
      for (const bound of [2400, 2000, 1600, 1280, 1024]) {
        const ratio = Math.min(1, bound / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.9, 0.8, 0.7]) {
          signal?.throwIfAborted();
          blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
          if (blob && blob.size <= PURCHASE_PHOTO_LIMIT) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) throw new Error(t`La foto sigue muy grande. Elige otra foto o quítala.`);
    }
    signal?.throwIfAborted();
    const preview = await readData(blob, signal);
    signal?.throwIfAborted();
    return {
      artifactBase64: preview.split(',')[1],
      preview,
      size: blob.size,
      contentType: blob.type,
    };
  } finally {
    image.src = '';
    URL.revokeObjectURL(url);
  }
}
