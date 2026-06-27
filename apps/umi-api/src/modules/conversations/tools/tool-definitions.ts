import type { ToolDefinitions } from '../turn.types';

/**
 * The frozen agent tool schemas advertised to Claude. Verbatim port of
 * `tools.ts` TOOL_DEFINITIONS (Spanish descriptions preserved — they steer the
 * model's tool selection).
 */
export const TOOL_DEFINITIONS: ToolDefinitions = [
  {
    name: 'get_business_info',
    description:
      'Obtiene dirección, métodos de pago y datos operativos del negocio. Úsala para ubicación, pagos o información general del café. No la uses para horarios ni para responder preguntas de menú.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_business_hours',
    description:
      'Obtiene el horario real del negocio y si todavía se reciben pedidos hoy. Úsala solo para horario, apertura/cierre o si aún aceptan pedidos. No la uses para menú, carrito ni dirección.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_menu',
    description:
      'Busca productos o categorías del menú y devuelve resultados estructurados para responder al cliente. Úsala para búsquedas exactas, vagas, browse por categoría o cuando necesites alternativas cercanas. No la uses para modificar o confirmar pedidos.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Término de búsqueda o "menu".' },
        size: { type: 'string' },
        temp: { type: 'string' },
        milk: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_to_cart',
    description:
      'Busca un producto, resuelve la variante y actualiza el carrito borrador de la conversación. Úsala cuando el cliente quiere agregar algo o ajustar una bebida/comida específica. No la uses para confirmar, cancelar ni para consultas informativas sin intención de pedido.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        quantity: { type: 'number' },
        size: { type: 'string' },
        temp: { type: 'string' },
        milk: { type: 'string' },
        replace_cart: {
          type: 'boolean',
          description:
            'True only when the client explicitly wants to replace/reset the current draft cart with this product.',
        },
        customer_note: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'edit_cart',
    description:
      "Edita el carrito borrador actual: quita productos, deja sólo un producto ya presente, limpia el carrito o cambia opciones de una línea existente. Úsala para frases como 'quita el latte', 'elimina X', 'deja sólo Y', 'olvida eso', 'no era coco, era avena'. No confirma la orden.",
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['remove', 'keep_only', 'clear', 'update_options'],
          description:
            'Tipo de edición. Usa update_options para cambiar leche, tamaño o temperatura de un producto ya presente.',
        },
        remove_query: { type: 'string', description: 'Producto o línea que se debe quitar del carrito.' },
        keep_query: {
          type: 'string',
          description: 'Producto que el cliente quiere conservar como único item, si ya está en carrito.',
        },
        target_query: {
          type: 'string',
          description: 'Producto ya presente cuyas opciones se deben cambiar, por ejemplo Latte Regular.',
        },
        size: { type: 'string' },
        temp: { type: 'string' },
        milk: { type: 'string' },
      },
    },
  },
  {
    name: 'confirm_order',
    description:
      'Confirma la orden usando el carrito borrador actual de la conversación. Úsala solo después de una confirmación explícita del cliente sobre el resumen vigente. No la uses para interpretar confirmaciones ambiguas o para crear pedidos sin carrito.',
    input_schema: {
      type: 'object',
      properties: {
        pickup_person: { type: 'string' },
        personal_message: { type: 'string' },
        customer_note: { type: 'string' },
      },
    },
  },
  {
    name: 'confirm_order_changes',
    description:
      'Confirma los cambios de una cancelación parcial activa para que el pedido actualizado siga en cocina. Úsala solo cuando existe una cancelación parcial pendiente y el cliente acepta esos cambios. No la uses para confirmaciones normales.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'cancel_order',
    description:
      'Cancela el pedido más reciente del cliente si todavía está pendiente. Úsala solo cuando el cliente quiere cancelar y ya tienes el motivo. No la uses para rechazos de una aclaración o cambios menores de carrito.',
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
  },
  {
    name: 'get_recent_customer_orders',
    description:
      'Obtiene pedidos recientes del cliente para poder repetirlos o consultarlos. Úsala cuando el cliente menciona pedidos anteriores o "lo mismo de siempre". No la uses para crear la orden final por sí sola.',
    input_schema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'reorder_last_order',
    description:
      'Crea una nueva orden copiando la última orden válida del cliente. Úsala solo después de confirmar explícitamente que quiere repetir la última orden. No la uses si el cliente solo está preguntando qué pidió antes.',
    input_schema: { type: 'object', properties: { customer_note: { type: 'string' } } },
  },
];
