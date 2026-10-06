import { msg } from '@lingui/core/macro';

/**
 * The shared inventory copy and the command error text.
 *
 * This module holds no component, and that is why it exists. A file that exports a
 * component AND a plain object breaks React Fast Refresh, and the lint rule that
 * enforces it (`react-refresh/only-export-components`) counted eleven warnings the
 * moment the editor was split out of the workspace. The constants moved here, the
 * components stayed in `inventory-item-editor.jsx`, and both files are quiet.
 *
 * The labels are Lingui message descriptors, not strings: this module runs at
 * import time, before a locale is active, so the text resolves where it renders
 * with `i18n._(...)`.
 */

/** The one gate every read and write on this surface needs. */
export const MANAGE_GATE = { permissions: ['merchant.manage'] };

export const UNIT_LABEL = {
  unit: msg`pza`,
  gram: msg`g`,
  kilogram: msg`kg`,
  milliliter: msg`ml`,
  liter: msg`L`,
  portion: msg`porción`,
  package: msg`paquete`,
  box: msg`caja`,
};
export const ITEM_TYPE_LABEL = {
  physical_product: msg`Producto físico`,
  variant_stock: msg`Existencia por variante`,
  ingredient: msg`Ingrediente`,
  packaging: msg`Empaque`,
  composite_component: msg`Componente compuesto`,
  bundle_component: msg`Componente de paquete`,
  operational_supply: msg`Insumo operativo`,
};
export const TRACKING_LABEL = {
  not_tracked: msg`No se cuenta`,
  tracked: msg`Se cuenta`,
  reservation_required: msg`Requiere reserva`,
};
export const NEGATIVE_LABEL = {
  block: msg`Bloquear`,
  manager_override: msg`Con autorización`,
  allow_and_flag: msg`Permitir y marcar`,
  backorder: msg`Pedido pendiente`,
  not_applicable: msg`No aplica`,
};
export const ROUNDING_LABEL = {
  exact: msg`Exacta`,
  floor: msg`Hacia abajo`,
  ceiling: msg`Hacia arriba`,
  half_up: msg`Al más cercano`,
};

export const UNIT_ORDER = [
  'unit',
  'gram',
  'kilogram',
  'milliliter',
  'liter',
  'portion',
  'package',
  'box',
];
export const ITEM_TYPE_ORDER = [
  'ingredient',
  'physical_product',
  'variant_stock',
  'packaging',
  'composite_component',
  'bundle_component',
  'operational_supply',
];
export const TRACKING_ORDER = ['tracked', 'reservation_required', 'not_tracked'];
export const NEGATIVE_ORDER = [
  'block',
  'manager_override',
  'allow_and_flag',
  'backorder',
  'not_applicable',
];
export const ROUNDING_ORDER = ['exact', 'floor', 'ceiling', 'half_up'];

export const ITEM_ERROR_COPY = {
  INVENTORY_ITEM_REFERENCE_TAKEN: msg`Ya existe un artículo con esa referencia. Escribe otra.`,
  INVENTORY_ITEM_NOT_FOUND: msg`El artículo ya no existe. Actualiza la lista.`,
  OPTIMISTIC_VERSION_CONFLICT: msg`Los datos cambiaron. Cierra el editor y vuelve a abrirlo.`,
  PERMISSION_DENIED: msg`No tienes permiso para administrar el inventario.`,
  VALIDATION_FAILED: msg`Revisa los datos. La API no aceptó la operación.`,
  SERVICE_UNAVAILABLE: msg`El servicio no está disponible. Intenta de nuevo después.`,
};
export const CONVERSION_ERROR_COPY = {
  INVENTORY_UNIT_CONVERSION_INVALID: msg`Las unidades no se dividen exactamente a esta escala. Elige redondear hacia abajo, hacia arriba o al más cercano.`,
  INVENTORY_ITEM_NOT_FOUND: msg`El artículo ya no existe. Actualiza la lista.`,
  OPTIMISTIC_VERSION_CONFLICT: msg`Los datos cambiaron. Cierra el editor y vuelve a abrirlo.`,
  PERMISSION_DENIED: msg`No tienes permiso para administrar el inventario.`,
  SERVICE_UNAVAILABLE: msg`El servicio no está disponible. Intenta de nuevo después.`,
};
export const ALLERGEN_ERROR_COPY = {
  INVENTORY_ALLERGEN_NOT_FOUND: msg`La etiqueta ya no existe. Actualiza la lista.`,
  INVENTORY_ITEM_NOT_FOUND: msg`El artículo ya no existe. Actualiza la lista.`,
  OPTIMISTIC_VERSION_CONFLICT: msg`Los datos cambiaron. Cierra el editor y vuelve a abrirlo.`,
  PERMISSION_DENIED: msg`No tienes permiso para administrar el inventario.`,
  VALIDATION_FAILED: msg`Revisa los datos. La API no aceptó la operación.`,
  SERVICE_UNAVAILABLE: msg`El servicio no está disponible. Intenta de nuevo después.`,
};

export function errorText(i18n, copy, error) {
  if (!error) return null;
  const known = copy[error.code];
  return known ? i18n._(known) : error.message;
}
