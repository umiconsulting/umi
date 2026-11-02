import { msg } from '@lingui/core/macro';

export const COLUMN_DEFINITIONS = {
  codigo: msg`Código único del artículo. Conserva los ceros iniciales.`,
  nombre: msg`Nombre del artículo.`,
  tipo: msg`Tipo del artículo. Usa uno de los códigos indicados.`,
  unidad: msg`Unidad del artículo o del ingrediente. Usa uno de los códigos indicados.`,
  decimales: msg`Cantidad de decimales para las existencias, de 0 a 6.`,
  costo_unitario: msg`Costo de una unidad base en pesos, con hasta dos decimales.`,
  existencia_minima: msg`Existencia mínima en la unidad base del artículo.`,
  cantidad_preparacion: msg`Cantidad que se obtiene al preparar el artículo.`,
  vida_util_dias: msg`Vida útil en días enteros.`,
  producto_id: msg`ID del producto. Cópialo del archivo de referencias.`,
  variante_id: msg`ID de la variante. Déjalo vacío para la receta del producto.`,
  rendimiento: msg`Cantidad que produce la receta. Debe ser mayor que cero.`,
  unidad_rendimiento: msg`Unidad del rendimiento. Usa uno de los códigos indicados.`,
  ingrediente_codigo: msg`Código del ingrediente. Cópialo del archivo de referencias.`,
  cantidad: msg`Cantidad del ingrediente. Usa la precisión del artículo y una conversión exacta.`,
};
export const GUIDE_COPY = {
  field: msg`Campo`,
  required: msg`Obligatorio`,
  description: msg`Descripción`,
  example: msg`Ejemplo`,
  requiredValue: msg`Sí`,
  optional: msg`No`,
  instructions: msg`Usa punto decimal y celdas de texto. No uses fórmulas ni notación científica.`,
};
