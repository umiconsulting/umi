import { msg } from '@lingui/core/macro';
import { ITEM_ERROR_COPY } from '@/screens/inventory-copy.js';

const ERRORS = {
  ...ITEM_ERROR_COPY,
  INVENTORY_RECIPE_CYCLE: msg`La receta se usaría a sí misma. Quita el artículo que forma el ciclo.`,
  INVENTORY_RECIPE_TOO_DEEP: msg`La receta pasa de 12 niveles. Acorta la cadena de sub-recetas.`,
  INVENTORY_RECIPE_NOT_FOUND: msg`La receta ya no existe. Actualiza la lista.`,
  LOCATION_SCOPE_VIOLATION: msg`Tu acceso no permite guardar en la sucursal original. Revisa tus permisos antes de reintentar.`,
  REQUIRED: msg`Completa el campo obligatorio.`,
  INVALID_CODE: msg`Usa un código válido y conserva los ceros iniciales.`,
  INVALID_NAME: msg`Escribe un nombre válido para el artículo.`,
  INVALID_ENUM: msg`Usa uno de los códigos de la guía.`,
  INVALID_SCALE: msg`Usa de 0 a 6 decimales.`,
  INVALID_SHELF_LIFE: msg`Usa un número entero de días.`,
  IMMUTABLE_FIELD: msg`El tipo, la unidad y los decimales de un artículo existente no se pueden cambiar.`,
  ARCHIVED_ITEM: msg`El código pertenece a un artículo archivado. Usa otro código o restaura el artículo.`,
  DUPLICATE_CODE: msg`El código se repite. Deja una sola fila por código.`,
  DUPLICATE_TARGET: msg`Hay más de un registro con esta referencia. Revisa los registros existentes.`,
  INVALID_NUMBER: msg`Usa un número con punto decimal, sin separadores de miles.`,
  PRECISION_OVERFLOW: msg`La cantidad tiene más decimales de los permitidos. Corrígela sin redondear.`,
  UNSAFE_QUANTITY: msg`La cantidad supera el límite permitido. Usa una cantidad menor.`,
  UNGROUPED_RECIPE_ROW: msg`Completa el producto en todas las filas. Después revisa el archivo de nuevo.`,
  MISSING_TARGET: msg`Copia un producto activo del archivo de referencias.`,
  WRONG_VARIANT: msg`La variante no pertenece al producto. Revisa las referencias.`,
  TOO_MANY_COMPONENTS: msg`La receta admite hasta 200 ingredientes.`,
  INCONSISTENT_YIELD: msg`Usa el mismo rendimiento y unidad en todas las filas de la receta.`,
  MISSING_INGREDIENT: msg`El ingrediente no existe o está archivado. Revisa su código.`,
  DUPLICATE_INGREDIENT: msg`El ingrediente se repite en la receta. Deja una sola fila.`,
  UNSUPPORTED_UNIT: msg`Usa la unidad base del ingrediente o registra una conversión exacta.`,
  INEXACT_COMPONENT: msg`La cantidad por rendimiento no es exacta. Revisa la cantidad y el rendimiento.`,
  FORMULA_CELL: msg`Cambia la fórmula por un valor de texto.`,
  UNSAFE_NUMBER: msg`Escribe el valor como texto para conservar todos sus dígitos.`,
  DATE_CELL: msg`Cambia la fecha por un valor de texto.`,
  UNSUPPORTED_CELL: msg`Usa una celda de texto con un valor válido.`,
  FILE_TOO_LARGE: msg`El archivo debe pesar como máximo 2 MiB.`,
  TOO_MANY_ROWS: msg`El archivo admite hasta 500 filas de datos.`,
  TOO_MANY_RECIPES: msg`El archivo admite hasta 100 recetas.`,
  UNSUPPORTED_FORMAT: msg`Elige un archivo CSV UTF-8 o Excel .xlsx.`,
  INVALID_ENCODING: msg`Guarda el archivo CSV con codificación UTF-8.`,
  INVALID_CSV: msg`Revisa los separadores y las comillas del archivo CSV.`,
  INVALID_XLSX: msg`No se pudo abrir el archivo Excel. Guárdalo como .xlsx y vuelve a intentar.`,
  MISSING_DATA_SHEET: msg`Conserva el nombre de la hoja de datos de la plantilla.`,
  MISSING_HEADER: msg`Faltan columnas obligatorias. Usa los encabezados de la plantilla.`,
  INVALID_HEADER: msg`Usa los encabezados de texto de la plantilla.`,
  DUPLICATE_HEADER: msg`Una columna se repite. Conserva una sola copia.`,
  UNKNOWN_HEADER: msg`Una columna no corresponde a la plantilla. Revisa los encabezados.`,
  COLUMN_COUNT: msg`La fila tiene más celdas que los encabezados. Revisa los separadores.`,
  REPEATED_HEADER: msg`Quita el encabezado repetido de esta fila.`,
  WORKER_TIMEOUT: msg`La lectura tardó demasiado. Cierra otras tareas o usa un archivo menor.`,
  WORKER_FAILED: msg`No se pudo procesar el archivo. Vuelve a elegirlo.`,
  ABORTED: msg`La tarea se detuvo.`,
  INVALID_BATCH: msg`El informe guardado no se puede leer. Conserva los datos del navegador y pide ayuda.`,
  STORAGE_READ_FAILED: msg`No se pudo leer el informe guardado. Revisa el almacenamiento del navegador.`,
  STORAGE_WRITE_FAILED: msg`No se pudo guardar el avance en este navegador. Libera espacio y vuelve a intentar.`,
  UNRESOLVED_BATCH: msg`Primero resuelve los resultados pendientes. Los registros guardados se conservan.`,
  BATCH_RUNNING: msg`Espera a que termine la operación actual.`,
  STALE_BATCH: msg`El informe cambió en otra ventana. Cierra y vuelve a abrir la importación.`,
  BATCH_EXISTS: msg`Revisa el informe guardado antes de iniciar otra importación.`,
  UNKNOWN_OUTCOME: msg`Falta confirmar el resultado. Reintenta con este mismo informe para evitar duplicados.`,
  INVENTORY_RECIPE_MAPPING_CONFLICT: msg`Otra receta usa este producto. Revisa su receta antes de volver a importar.`,
  TARGET_VERSION_CONFLICT: msg`El registro cambió. Revisa su versión antes de crear otra importación.`,
  PERMISSION_DENIED: msg`Revisa tu permiso para administrar el negocio antes de reintentar.`,
  UNAUTHORIZED: msg`Inicia sesión de nuevo antes de reintentar.`,
  RATE_LIMITED: msg`Espera un momento antes de reintentar.`,
};
const STATUSES = {
  new: msg`Nuevo`,
  update: msg`Actualizar`,
  unchanged: msg`Sin cambios`,
  duplicate: msg`Duplicado`,
  error: msg`Error`,
  pending: msg`Pendiente`,
  sending: msg`Guardando`,
  ambiguous: msg`Por confirmar`,
  success: msg`Guardado`,
  retryable: msg`Reintentar`,
  skipped: msg`Omitido`,
};
export function importErrorText(i18n, code) {
  return i18n._(
    Object.hasOwn(ERRORS, code)
      ? ERRORS[code]
      : msg`No se pudo completar la operación. Revisa el archivo o vuelve a intentar.`,
  );
}
export function importStatusText(i18n, status) {
  return i18n._(Object.hasOwn(STATUSES, status) ? STATUSES[status] : msg`Por revisar`);
}
export function localizeImportResultRows(i18n, rows) {
  return rows.map((row) => ({
    ...row,
    status: importStatusText(i18n, row.status),
    message: row.message
      ? row.message
          .split(', ')
          .map((code) => importErrorText(i18n, code))
          .join(' ')
      : '',
  }));
}
