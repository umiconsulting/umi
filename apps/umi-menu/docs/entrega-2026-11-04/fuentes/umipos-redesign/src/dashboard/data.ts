/** Illustrative ONCA data. No record, balance, status or permission comes from a live service. */
export type Entry = { name: string; detail?: string; cells: string[]; status?: string; values?: Record<string, string> };
export type Field = { label: string; value?: string; options?: string[]; type?: 'number' | 'email' | 'time' | 'password'; required?: boolean };
export type View = { id: string; label: string; description: string; columns: string[]; rows: Entry[]; action?: string; fields?: Field[]; note?: string };
export type Module = { id: string; label: string; group: string; views: View[]; platform?: boolean };

const locations = ['ONCA · Centro', 'ONCA · Malecón'];
const yesNo = ['Sí', 'No'];
const row = (name: string, cells: string[], detail?: string, status?: string): Entry => ({
  name, cells, detail,
  status: !status ? undefined : /Atención|Pendiente|Revisión|Bajo mínimo|Preparar|Sin destino|Nuevo|Sin asignar|Por revisar|Por cobrar|Sin canjear/.test(status)
    ? 'pending' : /En preparación|Ocupada|Parcial/.test(status)
      ? 'working' : /Cancelado|Sin conexión|Denegada|Inactivo/.test(status)
        ? 'neutral' : 'ready',
});

export const productPhoto: Record<string, string> = {
  'Latte': 'latte',
  'Latte Nube': 'latte',
  'Americano': 'americano',
  'Capuccino': 'capuccino',
  'Cappuccino': 'capuccino',
  'Concha': 'concha',
  'Focaccia': 'focaccia',
  'Pizza margarita': 'pizza',
  'Pizza': 'pizza',
};

export const modules: Module[] = [
  {
    id: 'overview', label: 'Resumen', group: 'Operación', views: [{
      id: 'overview', label: 'Resumen', description: 'Una mirada al día de ONCA Centro.',
      columns: ['Estación', 'Pedidos', 'Tiempo promedio', 'Estado'],
      rows: [
        row('Barra', ['5', '4 min', 'En tiempo'], 'Bebidas calientes y frías', 'En tiempo'),
        row('Cocina', ['3', '11 min', '1 con demora'], 'Desayunos y alimentos', 'Atención'),
        row('Horno', ['2', '8 min', 'En tiempo'], 'Pan y pizzas', 'En tiempo'),
        row('Entrega', ['4', '2 min', 'Por recoger'], 'Pedidos para llevar', 'Pendiente'),
      ],
      note: 'Datos ilustrativos del 1 de noviembre. El resumen cambia por sucursal y enlaza a pedidos, caja, inventario y estaciones. No recibe pagos ni opera el KDS.',
    }],
  },
  {
    id: 'orders', label: 'Pedidos', group: 'Operación', views: [{
      id: 'orders', label: 'Pedidos', description: 'Consulta cada pedido, desde su origen hasta el cierre.',
      columns: ['Pedido', 'Cliente y modalidad', 'Canal', 'Importe neto', 'Estado'],
      rows: [
        row('043', ['Lucía Hernández · Para llevar', 'Menú digital', '$135.00', 'Por revisar'], '14:50 · Latte Nube deslactosada y concha · Retiro 15:10', 'Por revisar'),
        row('042', ['Mesa 03 · Comer aquí', 'POS', '$135.00', 'En preparación'], '14:44 · Latte Nube y concha · Ana López', 'En preparación'),
        row('041', ['Mesa 05 · Comer aquí', 'POS', '$180.00', 'Por cobrar'], '14:38 · 2 lattes Nube · Ana López', 'Por cobrar'),
        row('040', ['Diego Luna · Para llevar', 'POS', '$90.00', 'Completado'], '14:29 · Latte Nube · Pagado', 'Completado'),
        row('039', ['Elena Díaz · Para llevar', 'WhatsApp', '$135.00', 'Completado'], '14:24 · Focaccia y americano · Pagado', 'Completado'),
        row('038', ['Pedro Valdez · Para llevar', 'Consola', '$0.00', 'Cancelado'], '14:18 · Cancelación registrada en POS', 'Cancelado'),
      ],
      note: 'Filtros: Activos, Nuevos, En preparación, Listos, Completados, Cancelados y Todos; canales Todos, POS y WhatsApp. El detalle conserva productos, descuentos, reembolsos, importe neto y cronología. Cobrar y preparar pertenece al POS y al KDS.',
    }],
  },
  {
    id: 'reports', label: 'Reportes', group: 'Operación', views: [
      {
        id: 'sales', label: 'Ventas', description: 'Ventas, ticket promedio y mezcla de productos del periodo.',
        columns: ['Producto', 'Unidades', 'Venta neta', 'Participación'],
        rows: [
          row('Latte', ['24', '$2,070.00', '30.3%'], '9 a $80 · 15 Nube a $90'),
          row('Americano', ['16', '$800.00', '11.7%'], 'Bebidas · $50 por unidad'),
          row('Capuccino', ['12', '$720.00', '10.5%'], 'Bebidas · $60 por unidad'),
          row('Concha', ['20', '$900.00', '13.2%'], 'Pan · $45 por unidad'),
          row('Focaccia', ['12', '$1,020.00', '14.9%'], 'Pan · $85 por unidad'),
          row('Pizza margarita', ['7', '$1,330.00', '19.4%'], 'Pizzas · $190 por unidad'),
        ],
        note: 'Hoy: 48 pedidos pagados, 91 unidades y $6,840.00; ticket promedio $142.50. El resumen del periodo usa estos datos de ejemplo; el dashboard actual obtiene su texto del servicio de análisis de ventas. Los folios de cuenta no son un conteo de pedidos pagados. Periodos Hoy, Ayer, 7 días y 30 días; consulta por hora, día, canal, pago, producto, categoría y operador. Recibos conserva su detalle dentro de Reportes.',
      },
      {
        id: 'refunds', label: 'Reembolsos', description: 'Consulta reembolsos y su relación con la venta original.',
        columns: ['Reembolso', 'Operador', 'Motivo', 'Monto', 'Estado'],
        rows: [
          row('RE-0084', ['Ana López', 'Producto agotado', '$85.00', 'Completado'], 'Recibo ONC-1031 · Aprobó Sofía Martínez', 'Completado'),
          row('RE-0083', ['Sofía Martínez', 'Pedido duplicado', '$170.00', 'Completado'], 'Recibo ONC-1014 · Aprobó Sofía Martínez', 'Completado'),
          row('RE-0082', ['Ana López', 'Cambio de producto', '$35.00', 'Completado'], 'Recibo ONC-0998 · Aprobó Sofía Martínez', 'Completado'),
          row('RE-0081', ['Sofía Martínez', 'Cancelación del cliente', '$200.00', 'Pendiente'], 'Recibo ONC-0982 · Respuesta del proveedor pendiente', 'Pendiente'),
        ],
        note: 'Solo consulta. Reembolsos y anulaciones se ejecutan en el POS con su autorización. Un resultado pendiente o desconocido no se presenta como un reembolso completado.',
      },
      {
        id: 'receipts', label: 'Recibos', description: 'Encuentra una venta y consulta sus conceptos, impuestos y pago.',
        columns: ['Recibo', 'Fecha y hora', 'Método', 'Total', 'Estado'],
        rows: [
          row('ONC-0048', ['1 nov · 14:29', 'Tarjeta', '$90.00', 'Pagado'], 'Cuenta 040 · Diego Luna · Latte Nube', 'Pagado'),
          row('ONC-0047', ['1 nov · 14:24', 'Efectivo', '$135.00', 'Pagado'], 'Cuenta 039 · Elena Díaz · Focaccia y americano', 'Pagado'),
          row('ONC-0046', ['1 nov · 14:12', 'Mixto', '$250.00', 'Pagado'], 'Pizza margarita y capuccino', 'Pagado'),
          row('ONC-1031', ['31 oct · 10:42', 'Tarjeta', '$85.00', 'Reembolsado'], 'Reembolso RE-0084 · Focaccia', 'Reembolsado'),
          row('ONC-0045', ['1 nov · 13:58', 'Transferencia', '$190.00', 'Pagado'], 'Pizza margarita · Para llevar', 'Pagado'),
        ],
        note: 'Búsqueda, filtro por estado y copia controlada desde el detalle. La reimpresión registra impresora, resultado físico y errores. «Resultado desconocido» requiere revisión; no equivale a una impresión correcta.',
      },
    ],
  },
  {
    id: 'cash', label: 'Caja y turnos', group: 'Operación', views: [
      {
        id: 'shifts', label: 'Turnos', description: 'Sigue el efectivo, los arqueos y las diferencias por turno.',
        columns: ['Turno', 'Operador', 'Esperado', 'Diferencia', 'Estado'],
        rows: [
          row('1 nov · Caja principal', ['Ana López', '$1,860.00', 'Por contar', 'Abierto'], '08:00 · Fondo $500 + ventas $1,860 − retiro $500', 'Abierto'),
          row('31 oct · Turno tarde', ['Sofía Martínez', '$2,450.00', '$0.00', 'Cerrado'], '14:00–21:15 · Caja principal', 'Cerrado'),
          row('31 oct · Turno mañana', ['Ana López', '$1,610.00', '−$50.00', 'Con diferencia'], '08:00–14:00 · Caja principal · Por revisar', 'Atención'),
          row('30 oct · Turno tarde', ['Sofía Martínez', '$2,730.00', '$0.00', 'Cerrado'], '14:00–21:10 · Caja principal', 'Cerrado'),
        ],
        note: 'Consulta fondo, ventas, entradas, salidas, caja fuerte, reembolsos, esperado, contado, denominaciones, intentos y operadores. Abrir turno, contar y mover dinero se realiza en el POS. La diferencia de un turno abierto todavía no está determinada.',
      },
      {
        id: 'registers', label: 'Registros y reglas', description: 'Estado de cajas, trazabilidad y reglas para el cobro.',
        columns: ['Registro', 'Sucursal', 'Turno', 'Último movimiento', 'Estado'],
        rows: [
          row('Caja principal', ['Centro', 'Ana López', 'Retiro · 12:20', 'Abierta'], 'Fondo $500 · Ventas $1,860 · Retiro $500', 'Abierta'),
          row('Caja de apoyo', ['Centro', 'Sin turno', 'Cierre · 31 oct', 'Cerrada'], 'Disponible para contingencia', 'Cerrada'),
          row('Retiro a caja fuerte', ['Centro · Caja principal', 'Ana López', '12:20 · $500.00', 'Registrado'], 'Resguardo de efectivo', 'Registrado'),
          row('Apertura sin venta', ['Centro · Caja principal', 'Ana López', 'Cambio de billete · 10:05', 'Registrada'], 'Evento de cajón · Motivo conservado', 'Registrada'),
        ],
        action: 'Configurar cobro',
        fields: [
          { label: 'Conteo ciego', value: 'Sí', options: yesNo },
          { label: 'Terminal manual', value: 'Sí', options: yesNo },
          { label: 'Pagos mixtos', value: 'Sí', options: yesNo },
          { label: 'Comer aquí sin mesa', value: 'No', options: yesNo },
          { label: 'Atribución de propinas', value: 'Mesero de la cuenta', options: ['Mesero de la cuenta', 'Cajero que procesa cada cobro'] },
          { label: 'Transferencia bancaria', value: 'No', options: yesNo },
          { label: 'Titular de la cuenta', value: '' },
          { label: 'Banco', value: '' },
          { label: 'CLABE', value: '' },
          { label: 'Número de cuenta', value: '' },
        ],
        note: 'La configuración gobierna el POS; los movimientos y aperturas de cajón son de consulta. Al habilitar transferencia deben completarse los datos bancarios. Esta maqueta no contiene una cuenta bancaria real.',
      },
    ],
  },
  {
    id: 'kitchen', label: 'Cocina', group: 'Operación', views: [
      {
        id: 'stations', label: 'Estaciones', description: 'Organiza las estaciones que reciben comandas en el KDS.',
        columns: ['Estación', 'Dispositivo', 'Umbral de demora', 'Estado'],
        rows: [
          row('Barra', ['KDS Barra', '6 min', 'Activa'], 'Bebidas calientes y frías', 'Activa'),
          row('Cocina', ['KDS Cocina', '15 min', 'Activa'], 'Desayunos, focaccias y platos', 'Activa'),
          row('Horno', ['KDS Horno', '12 min', 'Activa'], 'Pan y pizza', 'Activa'),
          row('Entrega', ['Sin dispositivo', '4 min', 'Sin asignar'], 'Concentración de pedidos terminados', 'Atención'),
        ],
        action: 'Nueva estación', fields: [
          { label: 'Nombre de la estación', value: '', required: true },
          { label: 'Umbral de demora (minutos)', value: '10', type: 'number', required: true },
          { label: 'Estación activa', value: 'Sí', options: yesNo },
        ],
        note: 'Crear, renombrar y desactivar estaciones conserva su relación con rutas y dispositivos. Esta pantalla configura el KDS; no recibe, prepara ni completa pedidos.',
      },
      {
        id: 'routes', label: 'Rutas', description: 'Define dónde se prepara cada categoría y sus excepciones.',
        columns: ['Regla', 'Estación', 'Prioridad', 'Tiempo objetivo', 'Estado'],
        rows: [
          row('Ruta predeterminada', ['Cocina', '0', '15 min', 'Activa'], 'Productos sin una regla específica', 'Activa'),
          row('Bebidas', ['Barra', '10', '6 min', 'Activa'], 'Ruta por categoría', 'Activa'),
          row('Pan', ['Horno', '10', '8 min', 'Activa'], 'Ruta por categoría', 'Activa'),
          row('Pizza margarita', ['Horno', '20', '12 min', 'Activa'], 'Excepción por producto', 'Activa'),
          row('Pack de café', ['Sin destino', '—', '—', 'Sin destino'], 'Revisar destino efectivo antes de activar', 'Sin destino'),
        ],
        action: 'Configurar ruta', fields: [
          { label: 'Tipo de ruta', value: 'Categoría', options: ['Predeterminada', 'Categoría', 'Producto'] },
          { label: 'Categoría o producto', value: 'Bebidas', required: true },
          { label: 'Estación de destino', value: 'Barra', options: ['Sin destino', 'Barra', 'Cocina', 'Horno', 'Entrega'] },
          { label: 'Prioridad', value: '10', type: 'number' },
          { label: 'Tiempo objetivo (minutos)', value: '6', type: 'number' },
        ],
        note: 'El destino efectivo considera la excepción por producto, la categoría y la regla predeterminada. Buscar producto permite revisar el destino, guardar o desactivar la excepción. «Sin destino» se conserva como estado visible.',
      },
      {
        id: 'sounds', label: 'Avisos', description: 'Elige los avisos de llegada, demora y artículo listo.',
        columns: ['Estación', 'Al llegar', 'Al vencer', 'Artículo listo'],
        rows: [
          row('Barra', ['Llegada', 'Vencimiento', 'Listo']),
          row('Cocina', ['Llegada', 'Vencimiento', 'Listo']),
          row('Horno', ['Llegada', 'Vencimiento', 'Listo']),
          row('Entrega', ['Llegada', 'Vencimiento', 'Listo']),
        ],
        action: 'Configurar avisos', fields: [
          { label: 'Estación', value: 'Barra', options: ['Barra', 'Cocina', 'Horno', 'Entrega'] },
          { label: 'Al llegar', value: 'Llegada', options: ['Llegada', 'Vencimiento', 'Listo'] },
          { label: 'Al vencer', value: 'Vencimiento', options: ['Llegada', 'Vencimiento', 'Listo'] },
          { label: 'Artículo listo para el mesero', value: 'Listo', options: ['Llegada', 'Vencimiento', 'Listo'] },
        ],
        note: 'Los sonidos se guardan por estación. La maqueta representa la configuración; la reproducción y entrega del aviso dependen del KDS.',
      },
    ],
  },
  {
    id: 'customers', label: 'Clientes', group: 'Negocio', views: [{
      id: 'customers', label: 'Clientes', description: 'Historial, preferencias y relación con cada cliente.',
      columns: ['Cliente', 'Última visita', 'Visitas', 'Gasto acumulado', 'Segmento'],
      rows: [
        row('Lucía Hernández', ['Hoy · 14:50', '18', '$2,640.00', 'VIP'], 'lucia.hernandez@example.com · Pedido digital 043', 'VIP'),
        row('Luis Ramos', ['Hoy · 11:38', '7', '$945.00', 'Frecuente'], 'luis.ramos@example.com · WhatsApp', 'Frecuente'),
        row('María López', ['Hoy · 11:35', '24', '$3,280.00', 'VIP'], 'maria.lopez@example.com · Lealtad', 'VIP'),
        row('Diego Luna', ['Hoy · 14:29', '2', '$170.00', 'Nuevo'], 'diego.luna@example.com · Cuenta 040', 'Nuevo'),
        row('Elena Díaz', ['Hoy · 14:24', '11', '$1,840.00', 'VIP'], 'elena.diaz@example.com · Cuenta 039', 'VIP'),
        row('Carlos Vega', ['12 ago', '6', '$780.00', 'Inactivo'], 'carlos.vega@example.com · Lealtad', 'Inactivo'),
      ],
      fields: [
        { label: 'Nombre', value: 'Lucía Hernández', required: true },
        { label: 'Correo', value: 'lucia.hernandez@example.com', type: 'email' },
        { label: 'Teléfono', value: '' },
        { label: 'Nota del cliente', value: 'Prefiere leche deslactosada y café sin azúcar.' },
      ],
      note: 'Filtros Todos, WhatsApp, Lealtad, Notas y Revisión. La ficha conserva Resumen, WhatsApp, Pedidos, Lealtad, Notas y Datos. Los resúmenes de IA llevan atribución. Agregar sellos, visita, canje y recarga requieren permiso y recibo; ante incertidumbre se reintenta la misma operación.',
    }],
  },
  {
    id: 'inbox', label: 'Atención', group: 'Negocio', views: [{
      id: 'inbox', label: 'Atención', description: 'Conversaciones pendientes, empezando por quien lleva más tiempo esperando.',
      columns: ['Cliente', 'Último mensaje', 'Espera', 'Estado'],
      rows: [
        row('Elena Díaz', ['¿Pueden revisar los sellos de mi visita?', '28 min', 'Pendiente'], 'WhatsApp · Consulta de lealtad', 'Pendiente'),
        row('Luis Ramos', ['¿Tienen café en grano?', '12 min', 'Pendiente'], 'WhatsApp · Consulta de producto', 'Pendiente'),
        row('Lucía Hernández', ['El café sin azúcar, por favor.', '2 min', 'Revisión'], 'Pedido digital 043 · Nota del cliente', 'Revisión'),
        row('Carlos Vega', ['¿A qué hora cierran hoy?', '1 min', 'Pendiente'], 'WhatsApp · Horarios', 'Pendiente'),
      ],
      note: 'Requiere ConversaFlow y acceso a Clientes. Cada fila abre la ficha del cliente y su historial de WhatsApp. La vista de atención no añade un editor de conversación ni confirma el envío de mensajes.',
    }],
  },
  {
    id: 'loyalty', label: 'Lealtad y valor', group: 'Negocio', views: [
      {
        id: 'loyalty', label: 'Lealtad', description: 'Miembros y avance de sus tarjetas de sellos.',
        columns: ['Miembro', 'Tarjeta', 'Sellos', 'Última visita', 'Estado'],
        rows: [
          row('Lucía Hernández', ['ONC-0028', '5 de 8', 'Hoy', 'Activa'], 'Miembro desde marzo', 'Activa'),
          row('María López', ['ONC-0013', '8 de 8', 'Hoy', 'Premio disponible'], 'Miembro desde enero', 'Premio disponible'),
          row('Luis Ramos', ['ONC-0084', '4 de 8', 'Hoy', 'Activa'], 'Miembro desde julio', 'Activa'),
          row('Elena Díaz', ['ONC-0042', '7 de 8', 'Hoy', 'Activa'], 'Miembro desde abril', 'Activa'),
          row('Carlos Vega', ['ONC-0061', '3 de 8', '12 ago', 'Activa'], 'Sin visitas recientes', 'Activa'),
        ],
        action: 'Registrar miembro', fields: [
          { label: 'Nombre del miembro', value: '', required: true },
          { label: 'Código de país', value: '+52', options: ['+52', '+1', '+34', '+57'], required: true },
          { label: 'Teléfono', value: '', required: true },
          { label: 'Fecha de nacimiento', value: '', required: true },
        ],
        note: 'Requiere Umi Cash y permiso de lealtad. Búsqueda, filtros, paginación y detalle de tarjeta. Los movimientos autorizados de sellos, visitas y canjes se revisan en la ficha del cliente.',
      },
      {
        id: 'rewards', label: 'Recompensas', description: 'Consulta las recompensas del dominio autorizado.',
        columns: ['Recompensa', 'Miembro', 'Origen', 'Fecha', 'Estado'],
        rows: [
          row('Bebida de la casa', ['María López', '8 visitas', '1 nov', 'Disponible'], 'Tarjeta ONC-0013', 'Disponible'),
          row('Bebida de cumpleaños', ['Elena Díaz', 'Cumpleaños', '1 nov', 'Disponible'], 'Tarjeta ONC-0042', 'Disponible'),
          row('Bebida de la casa', ['Lucía Hernández', '8 visitas', '24 oct', 'Canjeada'], 'Recibo ONC-0928', 'Canjeada'),
          row('Bebida de la casa', ['Elena Díaz', '8 visitas', '19 oct', 'Canjeada'], 'Recibo ONC-0874', 'Canjeada'),
        ],
        note: 'Solo consulta en este destino. El nombre, número de visitas y costo de la recompensa se administran en Ajustes. El canje permitido se conserva en la ficha del cliente con su recibo.',
      },
      {
        id: 'giftcards', label: 'Tarjetas de regalo', description: 'Emisión y canje de tarjetas de regalo al monedero del cliente.',
        columns: ['Tarjeta', 'Destinatario', 'Monto', 'Fecha', 'Estado'],
        rows: [
          row('Regalo · 0281', ['Lucía Hernández', '$500.00', '30 oct', 'Sin canjear'], 'Código oculto', 'Sin canjear'),
          row('Regalo · 0280', ['Luis Ramos', '$300.00', '29 oct', 'Sin canjear'], 'Código oculto', 'Sin canjear'),
          row('Regalo · 0279', ['María López', '$500.00', '26 oct', 'Canjeada'], 'Abonada al monedero del cliente', 'Canjeada'),
          row('Regalo · 0278', ['Elena Díaz', '$250.00', '24 oct', 'Canjeada'], 'Abonada al monedero del cliente', 'Canjeada'),
        ],
        action: 'Emitir tarjeta', fields: [
          { label: 'Destinatario', value: '' },
          { label: 'Monto inicial', value: '500', type: 'number', required: true },
          { label: 'Canal de contacto', value: 'Correo', options: ['Correo', 'Teléfono'], required: true },
          { label: 'Contacto del destinatario', value: '', required: true },
          { label: 'De parte de', value: '' },
          { label: 'Mensaje', value: '' },
        ],
        note: 'Requiere Umi Cash y el permiso efectivo. Tras la emisión, el código completo se muestra una sola vez. Canjear requiere código y teléfono o correo del cliente; abona el monto al monedero. La consulta posterior mantiene el código oculto y conserva pendientes o errores.',
      },
      {
        id: 'wallet', label: 'Monedero', description: 'Consulta saldos y movimientos del monedero de clientes.',
        columns: ['Cliente', 'Saldo', 'Último movimiento', 'Tipo', 'Estado'],
        rows: [
          row('Lucía Hernández', ['$365.00', '30 oct · $500.00', 'Recarga', 'Registrado'], 'Monedero ONC-0028', 'Registrado'),
          row('María López', ['$120.00', '29 oct · −$85.00', 'Consumo', 'Registrado'], 'Monedero ONC-0013', 'Registrado'),
          row('Elena Díaz', ['$80.00', '28 oct · −$120.00', 'Consumo', 'Registrado'], 'Monedero ONC-0042', 'Registrado'),
          row('Luis Ramos', ['$0.00', '27 oct · −$50.00', 'Consumo', 'Registrado'], 'Monedero ONC-0084', 'Registrado'),
        ],
        note: 'El hub de Monedero es de consulta. La recarga existente en la ficha del cliente conserva autorización, monto y recibo. Una respuesta incierta requiere consultar o reintentar la misma operación, sin duplicar la recarga.',
      },
    ],
  },
  {
    id: 'products', label: 'Productos', group: 'Negocio', views: [
      {
        id: 'products', label: 'Catálogo', description: 'La carta, sus opciones y disponibilidad por sucursal.',
        columns: ['Producto', 'Categoría', 'Precio', 'Inventario', 'Estado'],
        rows: [
          row('Latte', ['Bebidas', '$80.00', 'Receta vinculada', 'Disponible'], 'Clásico $80 · Nube $90 · Elige leche', 'Disponible'),
          row('Americano', ['Bebidas', '$50.00', 'Receta vinculada', 'Disponible'], '12 oz · Doble espresso', 'Disponible'),
          row('Capuccino', ['Bebidas', '$60.00', 'Receta vinculada', 'Disponible'], 'Espuma de leche', 'Disponible'),
          row('Concha', ['Pan', '$45.00', 'Artículo vinculado', 'Disponible'], 'Vainilla o chocolate', 'Disponible'),
          row('Focaccia', ['Pan', '$85.00', 'Receta vinculada', 'Disponible'], 'Romero y aceite de oliva', 'Disponible'),
          row('Pizza margarita', ['Pizzas', '$190.00', 'Receta vinculada', 'Disponible'], 'Salsa y mozzarella', 'Disponible'),
        ],
        action: 'Nuevo producto', fields: [
          { label: 'Nombre del producto', value: '', required: true },
          { label: 'Categoría', value: 'Bebidas', options: ['Bebidas', 'Pan', 'Pizzas'], required: true },
          { label: 'Precio', value: '80', type: 'number', required: true },
          { label: 'Variante', value: 'Clásico', options: ['Clásico', 'Nube'] },
          { label: 'Grupo de opciones', value: 'Tipo de leche' },
          { label: 'Opciones y modificadores', value: 'Entera · Deslactosada · Avena' },
          { label: 'Vínculo de inventario', value: 'Receta', options: ['Sin vínculo', 'Artículo', 'Receta'] },
          { label: 'Sucursal', value: 'ONCA · Centro', options: locations },
          { label: 'Disponibilidad', value: 'Disponible', options: ['Disponible', 'Agotado', 'No disponible'] },
        ],
        note: 'La edición conserva variantes, grupos de opciones y modificadores. La disponibilidad se define por ubicación. Archivar requiere confirmación; no elimina el historial de ventas ni las recetas vinculadas.',
      },
      {
        id: 'categories', label: 'Categorías', description: 'Agrupa la carta y conserva el color que usa el POS.',
        columns: ['Categoría', 'Productos', 'Color del POS', 'Estado'],
        rows: [
          row('Bebidas', ['7', 'Café', 'Activa'], 'Café y agua mineral', 'Activa'),
          row('Pan', ['4', 'Arena', 'Activa'], 'Concha, focaccia, barra y Burgir pack', 'Activa'),
          row('Pizzas', ['1', 'Terracota', 'Activa'], 'Pizza margarita', 'Activa'),
        ],
        action: 'Nueva categoría', fields: [
          { label: 'Nombre de la categoría', value: '', required: true },
          { label: 'Color del POS', value: 'Café', required: true },
        ],
        note: 'El nombre y el color se comparten con el POS. La cantidad de productos ayuda a revisar el impacto de una edición.',
      },
    ],
  },
  {
    id: 'inventory', label: 'Inventario', group: 'Negocio', views: [
      {
        id: 'items', label: 'Artículos', description: 'Existencias, mínimos y políticas de cada insumo.',
        columns: ['Artículo', 'Existencia', 'Mínimo', 'Costo unitario', 'Estado'],
        rows: [
          row('Café de la casa', ['8.40 kg', '4 kg', '$380.00 / kg', 'Disponible'], 'CAF-001 · Materia prima · Almacén seco', 'Disponible'),
          row('Leche deslactosada', ['3 L', '4 L', '$28.00 / L', 'Bajo mínimo'], 'LAC-001 · Ingrediente · Refrigeración', 'Bajo mínimo'),
          row('Harina de fuerza', ['18 kg', '10 kg', '$24.00 / kg', 'Disponible'], 'HAR-001 · Materia prima · Almacén seco', 'Disponible'),
          row('Masa para pizza', ['6 pzas', '12 pzas', '$12.40 / pza', 'Preparar'], 'PRE-003 · Preparación · Refrigeración', 'Preparar'),
          row('Leche de avena', ['5 L', '6 L', 'Desconocido', 'Revisar costo'], 'LAC-004 · Sin compra ni costo inicial', 'Atención'),
          row('Concha', ['16 pzas', '10 pzas', '$11.80 / pza', 'Disponible'], 'PAN-002 · Producto terminado · Vitrina', 'Disponible'),
        ],
        action: 'Nuevo artículo', fields: [
          { label: 'Nombre del artículo', value: '', required: true },
          { label: 'Referencia', value: '', required: true },
          { label: 'Tipo', value: 'Ingrediente', options: ['Ingrediente', 'Producto físico', 'Existencia por variante', 'Empaque', 'Componente compuesto', 'Componente de paquete', 'Insumo operativo'] },
          { label: 'Unidad', value: 'kg', options: ['kg', 'g', 'L', 'mL', 'pza'] },
          { label: 'Decimales', value: '3', type: 'number' },
          { label: 'Control de existencia', value: 'Se cuenta', options: ['Se cuenta', 'Requiere reserva', 'No se cuenta'] },
          { label: 'Existencia mínima', value: '0', type: 'number' },
          { label: 'Vida útil (días)', value: '', type: 'number' },
          { label: 'Objetivo de preparación', value: '', type: 'number' },
          { label: 'Conversión de compra', value: '1 kg = 1000 g' },
          { label: 'Alérgenos', value: 'Sin declarar' },
          { label: 'Costo inicial por unidad', value: '', type: 'number' },
          { label: 'Política de stock negativo', value: 'Bloquear', options: ['Bloquear', 'Con autorización', 'Permitir y marcar', 'Pedido pendiente', 'No aplica'] },
        ],
        note: 'Detalle: existencias y movimientos; ajustar, contar, merma o daño según permiso. Conteo: elegir áreas, contar, revisar diferencias y terminar. Importación: archivo, revisión, correcciones, confirmación, detener o reintentar pendientes; máximo 2 MiB y 500 filas, sin entrada de inventario. Compras registradas prevalecen sobre costo inicial. Se conserva archivo con confirmación y bloqueo masivo de stock negativo.',
      },
      {
        id: 'recipes', label: 'Recetas', description: 'Ingredientes, rendimiento y versiones de cada preparación.',
        columns: ['Receta', 'Rendimiento', 'Ingredientes', 'Costo', 'Versión'],
        rows: [
          row('Latte', ['1 bebida · 12 oz', '3', '$22.40', 'v3 · Vigente'], 'Producto · Café, leche y agua', 'Vigente'),
          row('Capuccino', ['1 bebida · 8 oz', '3', '$19.20', 'v2 · Vigente'], 'Producto · Café, leche y agua', 'Vigente'),
          row('Focaccia', ['1 porción', '6', '$24.60', 'v4 · Vigente'], 'Producto · Harina, romero y aceite de oliva', 'Vigente'),
          row('Masa para pizza', ['12 pzas', '5', '$148.80', 'v2 · Vigente'], 'Artículo · Lote de fermentación de 24 h', 'Vigente'),
          row('Latte con avena', ['1 bebida · 12 oz', '3', 'Incompleto', 'v1 · Vigente'], 'Falta el costo de leche de avena', 'Atención'),
        ],
        action: 'Nueva receta', fields: [
          { label: 'Tipo de destino', value: 'Producto', options: ['Producto', 'Artículo'] },
          { label: 'Producto o artículo', value: '', required: true },
          { label: 'Variante', value: '12 oz' },
          { label: 'Rendimiento', value: '1', type: 'number', required: true },
          { label: 'Unidad de rendimiento', value: 'pza', options: ['pza', 'kg', 'L'] },
          { label: 'Vida útil (días)', value: '1', type: 'number' },
          { label: 'Ingrediente', value: 'Café de la casa', required: true },
          { label: 'Cantidad del ingrediente', value: '18', type: 'number', required: true },
          { label: 'Unidad del ingrediente', value: 'g', options: ['g', 'kg', 'mL', 'L', 'pza'] },
        ],
        note: 'Editar conserva ingredientes, versiones y recetas retiradas; confirmar el cambio y reintentar el guardado sin duplicar. Importar revisa productos, variantes e ingredientes antes de confirmar: máximo 2 MiB, 100 recetas y 200 ingredientes por receta. Un costo incompleto no se presenta como cero.',
      },
      {
        id: 'preparation', label: 'Preparación', description: 'Lo que hace falta preparar y los lotes del día.',
        columns: ['Preparación', 'Existencia', 'Objetivo', 'A preparar', 'Estado'],
        rows: [
          row('Masa para pizza', ['6 pzas', '24 pzas', '18 pzas', 'Pendiente'], 'Uso previsto: 18 pzas · Refrigeración', 'Pendiente'),
          row('Focaccia', ['8 pzas', '20 pzas', '12 pzas', 'Pendiente'], 'Uso previsto: 16 pzas · Horno', 'Pendiente'),
          row('Salsa de tomate', ['2 L', '5 L', '3 L', 'Pendiente'], 'Uso previsto: 4 L · Refrigeración', 'Pendiente'),
          row('Jarabe de vainilla', ['1.5 L', '2 L', '0.5 L', 'Pendiente'], 'Uso previsto: 1 L · Barra', 'Pendiente'),
          row('Concha', ['16 pzas', '16 pzas', '0 pzas', 'Objetivo cubierto'], 'Lote PRE-0118 · 1 nov · Etiquetas disponibles', 'Objetivo cubierto'),
        ],
        action: 'Nueva preparación', fields: [
          { label: 'Artículo a preparar', value: 'Masa para pizza', options: ['Masa para pizza', 'Focaccia', 'Salsa de tomate', 'Jarabe de vainilla', 'Concha'], required: true },
          { label: 'Almacén', value: 'Refrigeración', options: ['Refrigeración', 'Almacén seco', 'Barra', 'Vitrina'], required: true },
          { label: 'Cantidad a preparar', value: '18', type: 'number', required: true },
        ],
        note: 'Flujo de staging: artículo, almacén y cantidad; revisar consumo de ingredientes; confirmar; consultar lote, resultado y etiquetas. Se conserva la cantidad objetivo, existencia y uso previsto. Preparar inventario es distinto de completar una comanda del KDS.',
      },
      {
        id: 'costs', label: 'Costos y márgenes', description: 'Costo por platillo, origen del valor y márgenes completos.',
        columns: ['Producto', 'Precio', 'Costo', 'Margen bruto', 'Origen'],
        rows: [
          row('Latte', ['$80.00', '$22.40', '72.0%', 'Compra registrada'], 'Clásico · Receta completa · 3 ingredientes'),
          row('Americano', ['$50.00', '$7.20', '85.6%', 'Compra registrada'], 'Receta completa · 2 ingredientes'),
          row('Capuccino', ['$60.00', '$19.20', '68.0%', 'Compra registrada'], 'Receta completa · 3 ingredientes'),
          row('Focaccia', ['$85.00', '$24.60', '71.1%', 'Compra + costo inicial'], 'Receta completa · 6 ingredientes'),
          row('Latte con avena', ['$80.00', 'Desconocido', 'No disponible', 'Falta costo de avena'], 'Clásico · No hay costo para 1 ingrediente', 'Atención'),
          row('Agua de cortesía', ['$0.00', '$0.00', 'No aplica', 'Costo registrado en cero'], 'Cero confirmado · No es un costo desconocido'),
        ],
        note: 'Consulta por periodo y detalle por platillo, con aviso de insumos bajos. Una compra registrada tiene prioridad sobre el costo inicial. El costo desconocido y el costo cero son estados distintos; un margen incompleto no se calcula como definitivo.',
      },
      {
        id: 'purchases', label: 'Compras', description: 'Revisa facturas, vincula artículos y registra lo recibido.',
        columns: ['Factura', 'Proveedor', 'Fecha', 'Total', 'Estado'],
        rows: [
          row('FAC-4821', ['Tostadores del Pacífico', '1 nov', '$3,800.00', 'Por revisar'], 'CFDI XML · 10 kg de café', 'Por revisar'),
          row('FAC-2194', ['Lácteos del Puerto', '1 nov', '$1,344.00', '2 líneas sin vincular'], 'CFDI XML · Leche entera y avena', 'Atención'),
          row('FAC-1087', ['Molino del Noroeste', '31 oct', '$1,920.00', 'Recibida'], 'OC-0142 · 80 kg de harina', 'Recibida'),
          row('FAC-0382', ['Huerta La Noria', '31 oct', '$860.00', 'Recepción parcial'], 'OC-0141 · Tomate y albahaca', 'Parcial'),
          row('FAC-2188', ['Lácteos del Puerto', '30 oct', '$2,100.00', 'Recibida'], 'OC-0139 · Mozzarella', 'Recibida'),
        ],
        action: 'Cargar CFDI', fields: [
          { label: 'Archivo CFDI XML', value: '', required: true },
          { label: 'Pedido de compra', value: 'Sin vincular', options: ['Sin vincular', 'OC-0143 · Café', 'OC-0144 · Lácteos'] },
          { label: 'Almacén receptor', value: 'Almacén seco', options: ['Almacén seco', 'Refrigeración', 'Barra'] },
          { label: 'Artículo para la línea', value: 'Café de la casa' },
          { label: 'SKU del proveedor', value: '' },
          { label: 'Cantidad recibida', value: '', type: 'number' },
        ],
        note: 'Cargar XML, revisar factura, casar cada línea con artículo y SKU de proveedor, vincular pedido, revisar cantidad recibida y registrar entrada. El archivo por sí solo no registra existencias. Recepciones parciales y líneas pendientes siguen visibles.',
      },
    ],
  },
  {
    id: 'floor', label: 'Plano de mesas', group: 'Negocio', views: [{
      id: 'floor', label: 'Plano de mesas', description: 'Distribución del espacio y estado del salón por área.',
      columns: ['Mesa', 'Área', 'Capacidad', 'Cuenta', 'Estado'],
      rows: [
        row('Mesa 01', ['Salón principal', '4 personas', '037 · $190.00', 'Ocupada'], 'Redonda · Junto a la ventana', 'Ocupada'),
        row('Mesa 02', ['Salón principal', '4 personas', '—', 'Libre'], 'Cuadrada', 'Libre'),
        row('Mesa 03', ['Salón principal', '4 personas', '042 · $135.00', 'Ocupada'], 'Cuadrada · En preparación', 'Ocupada'),
        row('Mesa 04', ['Salón principal', '4 personas', '—', 'Libre'], 'Cuadrada', 'Libre'),
        row('Mesa 05', ['Salón principal', '4 personas', '041 · $180.00', 'Ocupada'], 'Redonda · Por cobrar', 'Ocupada'),
        row('Mesa 06', ['Salón principal', '6 personas', '—', 'Libre'], 'Rectangular', 'Libre'),
      ],
      action: 'Editar plano', fields: [
        { label: 'Área', value: 'Salón principal', options: ['Salón principal'], required: true },
        { label: 'Elemento', value: 'Mesa', options: ['Mesa', 'Muro', 'Barra', 'Puerta', 'Texto'] },
        { label: 'Nombre', value: 'Mesa 01', required: true },
        { label: 'Capacidad', value: '4', type: 'number' },
        { label: 'Forma', value: 'Redonda', options: ['Redonda', 'Cuadrada', 'Rectangular'] },
        { label: 'Posición horizontal', value: '120', type: 'number' },
        { label: 'Posición vertical', value: '100', type: 'number' },
      ],
      note: 'Editor espacial con áreas, duplicar, eliminar, deshacer, rehacer, cuadrícula y zoom. Publicar revisa cuentas que bloquean el cambio: esperar, volver a editar o resolver con una acción autorizada. Un error al consultar el salón no borra el plano. Estados del salón ilustrativos.',
    }],
  },
  {
    id: 'devices', label: 'Dispositivos', group: 'Administración', views: [
      {
        id: 'devices', label: 'Equipos', description: 'POS, KDS y códigos de configuración por sucursal.',
        columns: ['Dispositivo', 'Sucursal', 'Modo', 'Última conexión', 'Estado'],
        rows: [
          row('POS Principal', ['Centro', 'Caja · Android', 'Hace 1 min', 'En línea'], 'Caja principal · Equipo de demostración', 'En línea'),
          row('POS Apoyo', ['Centro', 'Caja · iPadOS', 'Hace 2 min', 'En línea'], 'Caja de apoyo · Equipo de demostración', 'En línea'),
          row('KDS Barra', ['Centro', 'Cocina · Android', 'Hace 1 min', 'En línea'], 'Estación Barra', 'En línea'),
          row('KDS Cocina', ['Centro', 'Cocina · Android', 'Hace 1 min', 'En línea'], 'Estación Cocina', 'En línea'),
          row('POS Reserva', ['Centro', 'Caja · Android', 'Ayer · 20:10', 'Sin conexión'], 'Revisar durante el próximo turno', 'Sin conexión'),
        ],
        action: 'Añadir equipo', fields: [
          { label: 'Sucursal', value: 'ONCA · Centro', options: locations, required: true },
          { label: 'Producto', value: 'POS', options: ['POS', 'KDS'], required: true },
          { label: 'Nombre del equipo', value: '', required: true },
          { label: 'Plataforma', value: 'Android', options: ['Android', 'iOS', 'Windows', 'macOS', 'Linux', 'Web'] },
          { label: 'Modalidad', value: 'Fijo', options: ['Fijo', 'Móvil'] },
          { label: 'Estación', value: 'Sin asignar', options: ['Sin asignar', 'Barra', 'Cocina', 'Horno', 'Entrega'] },
        ],
        note: 'Crear un código muestra su caducidad; no representa un equipo conectado. La edición conserva nombre, modo y estación. Revocar requiere confirmación. Cada acción conserva el permiso del servidor.',
      },
      {
        id: 'requests', label: 'Solicitudes', description: 'Revisa solicitudes de registro POS y pareo KDS.',
        columns: ['Solicitud', 'Sucursal', 'Tipo', 'Recibida', 'Estado'],
        rows: [
          row('Galaxy Tab A11', ['Centro', 'Pareo KDS', 'Hoy · 14:35', 'Pendiente'], 'Android · Cocina · Revisar identidad del equipo', 'Pendiente'),
          row('POS Apoyo', ['Centro', 'Registro POS', '31 oct · 10:45', 'Aprobada'], 'iOS · Revisó Sofía Martínez', 'Aprobada'),
          row('POS Reserva', ['Centro', 'Registro POS', '31 oct · 08:04', 'Aprobada'], 'Revisó Sofía Martínez', 'Aprobada'),
          row('Equipo sin nombre', ['Centro', 'Registro POS', '30 oct · 19:12', 'Denegada'], 'No se reconoció el equipo', 'Denegada'),
        ],
        fields: [
          { label: 'Nombre del equipo', value: 'Galaxy Tab A11', required: true },
          { label: 'Sucursal', value: 'ONCA · Centro', options: locations },
          { label: 'Decisión', value: 'Aprobar', options: ['Aprobar', 'Denegar'], required: true },
        ],
        note: 'La aprobación o denegación se realiza desde el detalle de una solicitud pendiente, después de revisar equipo, sucursal y producto. Una solicitud aprobada no confirma por sí sola que el dispositivo está en línea.',
      },
      {
        id: 'hardware', label: 'Hardware', description: 'Impresoras y periféricos registrados en los equipos.',
        columns: ['Hardware', 'Equipo', 'Tipo', 'Conexión', 'Estado'],
        rows: [
          row('Impresora de caja', ['POS Principal', 'Térmica 80 mm', 'USB', 'Registrada'], 'Recibos · Centro', 'Registrada'),
          row('Impresora de barra', ['POS Principal', 'Térmica 80 mm', 'Red local', 'Registrada'], 'Comandas · Centro', 'Registrada'),
          row('Cajón principal', ['POS Principal', 'Cajón', 'Impresora', 'Registrado'], 'Aperturas con trazabilidad', 'Registrado'),
          row('Impresora de reserva', ['POS Reserva', 'Térmica 80 mm', 'USB', 'Sin lectura reciente'], 'Último reporte: 31 oct', 'Atención'),
        ],
        note: 'El hardware registrado forma parte del alcance actual. La presencia en la lista no prueba impresión física ni conexión vigente. Resultados fallidos o desconocidos se consultan en Diagnóstico.',
      },
      {
        id: 'terminals', label: 'Mercado Pago', description: 'Cuenta del proveedor, tiendas y asignación de terminales.',
        columns: ['Terminal', 'Tienda', 'Registro', 'Modo', 'Estado'],
        rows: [
          row('Point · 01', ['ONCA Centro', 'Caja principal', 'Integrada', 'Vinculada'], 'Estado ilustrativo · Verificación del proveedor requerida', 'Vinculada'),
          row('Point · 02', ['ONCA Centro', 'Sin asignar', 'Manual', 'Por asignar'], 'Terminal disponible para revisar', 'Pendiente'),
          row('Point · Reserva', ['ONCA Centro', 'Caja principal', 'Integrada', 'Sin verificar'], 'No hay una lectura reciente del proveedor', 'Atención'),
        ],
        action: 'Configurar terminal', fields: [
          { label: 'Tienda', value: 'ONCA Centro', options: ['ONCA Centro'], required: true },
          { label: 'Terminal', value: 'Point · 01', options: ['Point · 01', 'Point · 02', 'Point · Reserva'], required: true },
          { label: 'Registro', value: 'Caja principal', options: ['Sin asignar', 'Caja principal', 'Caja de apoyo'] },
          { label: 'Modo', value: 'Integrada', options: ['Integrada', 'Manual'] },
        ],
        note: 'Conservar conectar, reconectar y desconectar cuenta; consultar o crear tienda y asignar terminal. La maqueta no inicia OAuth ni prueba al proveedor. Nunca mostrar «Conectado» como resultado de un cambio local; conservar errores y resultados desconocidos.',
      },
    ],
  },
  {
    id: 'team', label: 'Equipo y accesos', group: 'Administración', views: [
      {
        id: 'team', label: 'Personas', description: 'Personas, roles y acceso al POS de ONCA.',
        columns: ['Persona', 'Rol', 'Sucursal', 'Acceso POS', 'Estado'],
        rows: [
          row('Sofía Martínez', ['Owner', 'Todas', 'Habilitado', 'Activa'], 'sofia@example.com · Rol protegido', 'Activa'),
          row('Ana López', ['Cajero', 'Centro', 'Habilitado', 'Activa'], 'ana@example.com · Caja principal', 'Activa'),
          row('Luis Romero', ['Barra', 'Centro', 'Habilitado', 'Activo'], 'luis@example.com · KDS Barra', 'Activo'),
          row('Marta Díaz', ['Cocina', 'Centro', 'Habilitado', 'Activa'], 'marta@example.com · KDS Cocina', 'Activa'),
          row('Andrés León', ['Mesero', 'Centro', 'Deshabilitado', 'Inactivo'], 'andres@example.com · Puede restaurarse con autorización', 'Inactivo'),
        ],
        action: 'Añadir persona', fields: [
          { label: 'Nombre completo', value: '', required: true },
          { label: 'Correo', value: '', type: 'email', required: true },
          { label: 'Rol', value: 'Cajero', options: ['Encargada', 'Cajero', 'Mesero', 'Barra', 'Cocina'], required: true },
          { label: 'Sucursal', value: 'ONCA · Centro', options: locations },
          { label: 'Acceso al POS', value: 'Sí', options: yesNo },
          { label: 'Asignar nuevo PIN', value: '', type: 'password' },
          { label: 'Confirmar el PIN', value: '', type: 'password' },
        ],
        note: 'Filtrar por rol, asignar o quitar PIN, desactivar y restaurar con confirmación. El PIN existente nunca se muestra. Un rol del café no otorga acceso de plataforma ni activa productos no contratados.',
      },
      {
        id: 'permissions', label: 'Roles y permisos', description: 'Define responsabilidades y consulta el alcance de cada rol.',
        columns: ['Rol', 'Personas', 'Alcance', 'Estado'],
        rows: [
          row('Owner', ['1', 'Administración del café', 'Protegido'], 'No se puede archivar ni modificar desde este flujo', 'Protegido'),
          row('Encargada', ['0', 'Turnos, catálogo y equipo', 'Activo'], 'Disponible para asignar', 'Activo'),
          row('Cajero', ['1', 'Ventas y caja en POS', 'Activo'], 'Cobro según permisos efectivos', 'Activo'),
          row('Mesero', ['1', 'Cuentas y atención de mesas', 'Activo'], 'Sin administración del café', 'Activo'),
          row('Barra', ['1', 'Bebidas', 'Activo'], 'Luis · KDS Barra', 'Activo'),
          row('Cocina', ['1', 'Alimentos y pan', 'Activo'], 'Marta · KDS Cocina', 'Activo'),
        ],
        action: 'Crear rol', fields: [
          { label: 'Nombre del rol', value: '', required: true },
          { label: 'Descripción', value: '' },
          { label: 'Consultar pedidos y cocina', value: 'Sí', options: yesNo },
          { label: 'Consultar turnos', value: 'No', options: yesNo },
          { label: 'Consultar catálogo', value: 'Sí', options: yesNo },
          { label: 'Consultar inventario', value: 'No', options: yesNo },
          { label: 'Administrar comercio', value: 'No', options: yesNo },
        ],
        note: 'La matriz completa conserva los permisos del servidor, producto activo y alcance del comercio. Archivar un rol requiere reasignar primero a sus personas. Owner está protegido. Plataforma es un acceso independiente.',
      },
    ],
  },
  {
    id: 'hours', label: 'Horarios', group: 'Administración', views: [{
      id: 'hours', label: 'Horarios', description: 'Horario semanal y disponibilidad global de pedidos.',
      columns: ['Día', 'Apertura', 'Cierre', 'Último pedido', 'Estado'],
      rows: [
        row('Lunes', ['07:00', '21:00', '20:30', 'Abierto'], 'Horario semanal', 'Abierto'),
        row('Martes', ['07:00', '21:00', '20:30', 'Abierto'], 'Horario semanal', 'Abierto'),
        row('Miércoles', ['07:00', '21:00', '20:30', 'Abierto'], 'Horario semanal', 'Abierto'),
        row('Jueves', ['07:00', '21:00', '20:30', 'Abierto'], 'Horario semanal', 'Abierto'),
        row('Viernes', ['07:00', '22:00', '21:30', 'Abierto'], 'Horario semanal', 'Abierto'),
        row('Sábado', ['08:00', '22:00', '21:30', 'Abierto'], 'Horario semanal', 'Abierto'),
        row('Domingo', ['08:00', '18:00', '17:30', 'Abierto'], 'Horario semanal', 'Abierto'),
      ],
      action: 'Editar horario', fields: [
        { label: 'Zona horaria', value: 'America/Mexico_City', options: ['America/Mexico_City', 'America/Monterrey', 'America/Tijuana', 'America/Cancun'] },
        { label: 'Día', value: 'Lunes', options: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] },
        { label: 'Día abierto', value: 'Sí', options: yesNo },
        { label: 'Apertura', value: '07:00', type: 'time', required: true },
        { label: 'Cierre', value: '21:00', type: 'time', required: true },
        { label: 'Corte antes del cierre (minutos)', value: '30', type: 'number' },
        { label: 'Aviso especial', value: 'Este domingo cerramos a las 18:00.' },
        { label: 'Teléfonos exentos', value: '' },
      ],
      note: 'Requiere ConversaFlow y administración del comercio. Copiar el horario a otros días, difundir el aviso y gestionar teléfonos exentos conserva sus flujos. Pausar o reanudar pedidos tiene alcance global y requiere confirmación; no es una pausa de la sucursal seleccionada.',
    }],
  },
  {
    id: 'settings', label: 'Ajustes', group: 'Administración', views: [
      {
        id: 'business', label: 'Negocio', description: 'Identidad del negocio y reglas del día operativo.',
        columns: ['Configuración', 'Valor', 'Alcance'],
        rows: [
          row('Nombre del negocio', ['ONCA Café', 'Todo el negocio']),
          row('Ciudad', ['Mazatlán', 'Todo el negocio']),
          row('Inicio del día operativo', ['04:00', 'Reportes y turnos']),
          row('Cuentas abiertas al cierre', ['Resolver a mano', 'POS']),
        ],
        action: 'Editar negocio', fields: [
          { label: 'Nombre del negocio', value: 'ONCA Café', required: true },
          { label: 'Ciudad', value: 'Mazatlán', required: true },
          { label: 'Inicio del día operativo', value: '04:00', type: 'time', required: true },
          { label: 'Cuentas abiertas al cierre', value: 'Resolver a mano', options: ['Resolver a mano', 'Anular las cuentas sin cobrar al corte'] },
        ],
        note: 'Los ajustes pertenecen al comercio y requieren merchant.manage. El inicio del día operativo determina los límites de reportes; no cambia el horario de atención.',
      },
      {
        id: 'locations', label: 'Sucursales', description: 'Direcciones, ubicación y nombres que reconoce el asistente.',
        columns: ['Sucursal', 'Dirección', 'Apodos', 'Estado'],
        rows: [
          row('ONCA · Centro', ['Centro histórico, Mazatlán', 'Centro · La del centro', 'Activa'], 'Ubicación ilustrativa · Cafetería del centro', 'Activa'),
        ],
        action: 'Nueva sucursal', fields: [
          { label: 'Nombre de la sucursal', value: '', required: true },
          { label: 'Estado', value: 'Abierta', options: ['Abierta', 'Cerrada'] },
          { label: 'Dirección', value: '', required: true },
          { label: 'Latitud', value: '', type: 'number' },
          { label: 'Longitud', value: '', type: 'number' },
          { label: 'Apodos', value: '' },
          { label: 'Descripción', value: '' },
        ],
        note: 'La ubicación y los apodos ayudan a identificar la sucursal. Guardar conserva nombre, dirección, estado y descripción sin alterar la sucursal activa de la sesión.',
      },
      {
        id: 'segments', label: 'Segmentos', description: 'Criterios de gasto, visitas y actividad de los clientes.',
        columns: ['Criterio', 'Valor', 'Uso'],
        rows: [
          row('Gasto mínimo VIP', ['$1,000.00', 'Segmento VIP']),
          row('Visitas mínimas VIP', ['8 visitas', 'Segmento VIP']),
          row('Visitas de cliente frecuente', ['3 visitas', 'Segmento frecuente']),
          row('Ventana de actividad', ['45 días', 'Cliente activo']),
          row('Umbral de inactividad', ['180 días', 'Cliente inactivo']),
        ],
        action: 'Editar segmentos', fields: [
          { label: 'Gasto mínimo VIP (MXN)', value: '1000', type: 'number', required: true },
          { label: 'Visitas mínimas VIP', value: '8', type: 'number', required: true },
          { label: 'Visitas de cliente frecuente', value: '3', type: 'number', required: true },
          { label: 'Ventana de actividad (días)', value: '45', type: 'number', required: true },
          { label: 'Umbral de inactividad (días)', value: '180', type: 'number', required: true },
        ],
        note: 'Los umbrales configuran los segmentos de Clientes. Los valores de las listas son ilustrativos y no representan una recalculación del servidor.',
      },
      {
        id: 'brand', label: 'Marca', description: 'Logo, dirección pública y prefijo de las tarjetas.',
        columns: ['Elemento', 'Valor', 'Dónde se usa'],
        rows: [
          row('Logo', ['ONCA', 'Tickets y pases de Wallet']),
          row('Dirección pública', ['onca-cafe', 'Identificador del negocio']),
          row('Prefijo de tarjeta', ['ONC', 'Tarjetas de lealtad']),
        ],
        action: 'Editar marca', fields: [
          { label: 'Archivo del logo', value: '' },
          { label: 'Dirección pública', value: 'onca-cafe', required: true },
          { label: 'Prefijo de tarjeta', value: 'ONC', required: true },
        ],
        note: 'En el producto actual, subir el logo tiene su propio estado de carga, error y resultado, independiente del guardado de los demás ajustes. No simular una carga al servidor al seleccionar un archivo local.',
      },
      {
        id: 'voice', label: 'Asistente', description: 'Nombre, tono y estilo del asistente del negocio.',
        columns: ['Configuración', 'Valor', 'Alcance'],
        rows: [
          row('Nombre', ['ONCA', 'Asistente de WhatsApp']),
          row('Tono', ['Amigable', 'Respuestas del asistente']),
          row('Tono personalizado', ['Claro, breve y amable', 'Cuando aplica']),
          row('Notas de estilo', ['Usar nombres de la carta y confirmar la sucursal', 'Guía de respuesta']),
        ],
        action: 'Editar asistente', fields: [
          { label: 'Nombre del asistente', value: 'ONCA' },
          { label: 'Tono', value: 'Amigable', options: ['Casual', 'Amigable', 'Formal'] },
          { label: 'Tono personalizado', value: 'Claro, breve y amable' },
          { label: 'Notas de estilo', value: 'Usar los nombres de la carta y confirmar la sucursal cuando sea necesario.' },
        ],
        note: 'Requiere el producto y acceso correspondientes. La vista previa es ilustrativa; guardar localmente no envía mensajes ni verifica respuestas del asistente.',
      },
      {
        id: 'walletdesign', label: 'Diseño Wallet', description: 'Colores, contraste y vista previa del pase de lealtad.',
        columns: ['Elemento', 'Valor', 'Vista previa'],
        rows: [
          row('Color principal', ['Azul ONCA', 'Fondo del pase']),
          row('Color secundario', ['Crema', 'Detalles y sellos']),
          row('Contraste', ['Texto claro sobre fondo oscuro', 'Revisar legibilidad']),
          row('Tarjeta de ejemplo', ['5 de 8 sellos', 'No modifica una tarjeta real']),
        ],
        action: 'Editar diseño', fields: [
          { label: 'Color principal', value: 'Azul ONCA', options: ['Azul ONCA', 'Café', 'Verde oscuro', 'Terracota'] },
          { label: 'Color secundario', value: 'Crema', options: ['Crema', 'Blanco', 'Arena'] },
        ],
        note: 'La vista previa debe conservar contraste y legibilidad del pase. El diseño no confirma la actualización de Apple Wallet o Google Wallet desde la maqueta.',
      },
      {
        id: 'stamps', label: 'Sellos y premio', description: 'Configura la meta de visitas y la recompensa de lealtad.',
        columns: ['Configuración', 'Valor', 'Alcance'],
        rows: [
          row('Nombre del premio', ['Bebida de la casa', 'Tarjeta de lealtad']),
          row('Visitas para premio', ['8', 'Meta de la tarjeta']),
          row('Costo de recompensa', ['$22.40', 'Costo interno']),
          row('Sellos máximos', ['8', 'Vista de la tarjeta']),
        ],
        action: 'Editar recompensa', fields: [
          { label: 'Nombre del premio', value: 'Bebida de la casa', required: true },
          { label: 'Visitas y sellos máximos', value: '8', type: 'number', required: true },
          { label: 'Costo de recompensa (MXN)', value: '22.40', type: 'number' },
        ],
        note: 'Requiere Umi Cash. La meta de visitas define los sellos máximos del pase; no son dos reglas independientes. Esta configuración no canjea recompensas ni agrega sellos a un cliente.',
      },
      {
        id: 'birthday', label: 'Cumpleaños', description: 'Activa y nombra el regalo de cumpleaños.',
        columns: ['Configuración', 'Valor', 'Estado'],
        rows: [row('Regalo de cumpleaños', ['Bebida de cumpleaños', 'Habilitado'], 'Configuración del comercio', 'Habilitado')],
        action: 'Editar cumpleaños', fields: [
          { label: 'Regalo de cumpleaños habilitado', value: 'Sí', options: yesNo },
          { label: 'Nombre del regalo', value: 'Bebida de cumpleaños', required: true },
        ],
        note: 'El nombre del regalo aparece en la configuración y en el pase cuando corresponde. Los canjes conservan las reglas del dominio de lealtad.',
      },
      {
        id: 'promotion', label: 'Promoción', description: 'Mensaje, vigencia y días de la promoción del negocio.',
        columns: ['Promoción', 'Vigencia', 'Días', 'Estado'],
        rows: [row('Tardes de café', ['1–30 nov 2026', 'Martes, miércoles y jueves', 'Configurada'], 'Pregunta por nuestra bebida de temporada.', 'Configurada')],
        action: 'Editar promoción', fields: [
          { label: 'Mensaje', value: 'Pregunta por nuestra bebida de temporada.', required: true },
          { label: 'Inicio de vigencia', value: '2026-11-01', required: true },
          { label: 'Fin de vigencia', value: '2026-11-30', required: true },
          { label: 'Días de la semana', value: 'Martes, miércoles y jueves' },
        ],
        note: 'Configurar un mensaje promocional no crea un descuento ni modifica los precios del POS. La vigencia y los días conservan su alcance actual.',
      },
      {
        id: 'selfregister', label: 'Autorregistro', description: 'Permite que los clientes se registren por su cuenta.',
        columns: ['Configuración', 'Valor', 'Alcance'],
        rows: [row('Autorregistro de clientes', ['Habilitado', 'Comercio'], 'Configuración existente del registro de clientes')],
        action: 'Configurar autorregistro', fields: [
          { label: 'Autorregistro habilitado', value: 'Sí', options: yesNo },
        ],
        note: 'Conserva la configuración existente de autorregistro. No agrega reglas de consentimiento, formularios personalizados o campañas que no estén en el producto actual.',
      },
    ],
  },
  {
    id: 'diagnostics', label: 'Diagnóstico', group: 'Administración', views: [
      {
        id: 'recovery', label: 'Recuperación', description: 'Operaciones que requieren revisar su resultado antes de continuar.',
        columns: ['Operación', 'Origen', 'Último intento', 'Estado'],
        rows: [
          row('Reimpresión ONC-1038', ['POS Principal', 'Hoy · 11:05', 'Resultado desconocido'], 'Confirmar salida física antes de repetir', 'Atención'),
          row('Sincronización de venta', ['POS Reserva', '31 oct · 20:10', 'Pendiente'], 'Conservar la identidad de la operación', 'Pendiente'),
          row('Recarga de monedero', ['Ficha del cliente', '31 oct · 18:42', 'En revisión'], 'Consultar resultado; no crear otra recarga', 'Atención'),
          row('Envío de recibo', ['POS Principal', '31 oct · 17:20', 'Resuelta'], 'Resultado registrado en auditoría', 'Resuelta'),
        ],
        note: 'Requiere audit.read. Consultar la evidencia de cada operación y conservar los estados pendientes o desconocidos. El reintento usa la misma identidad cuando el dominio lo permite; no garantiza que una operación externa se haya completado.',
      },
      {
        id: 'audit', label: 'Auditoría', description: 'Quién hizo cada cambio, dónde y con qué resultado.',
        columns: ['Evento', 'Persona', 'Origen', 'Fecha y hora', 'Resultado'],
        rows: [
          row('Cambio de disponibilidad', ['Sofía Martínez', 'Dashboard', '1 nov · 11:20', 'Registrado'], 'Pizza margarita · Disponible en Centro', 'Registrado'),
          row('Apertura de cajón sin venta', ['Ana López', 'POS Principal', '1 nov · 10:05', 'Registrado'], 'Motivo: cambio de billete', 'Registrado'),
          row('Registro de preparación', ['Marta Díaz', 'Dashboard', '1 nov · 08:40', 'Registrado'], 'Lote PRE-0118 · Conchas', 'Registrado'),
          row('Inicio de turno', ['Ana López', 'POS Principal', '1 nov · 08:00', 'Registrado'], 'Caja principal · Fondo $500.00', 'Registrado'),
          row('Cambio de rol', ['Sofía Martínez', 'Dashboard', '31 oct · 16:10', 'Registrado'], 'Equipo · Asignación autorizada', 'Registrado'),
        ],
        note: 'Requiere audit.read. La auditoría es de consulta y conserva persona, operación, dispositivo, fecha y resultado. Los eventos de este prototipo son ejemplos.',
      },
      {
        id: 'diagnostics', label: 'Diagnóstico', description: 'Evidencia técnica de dispositivos y periféricos registrados.',
        columns: ['Componente', 'Equipo', 'Última lectura', 'Resultado'],
        rows: [
          row('Impresora de caja', ['POS Principal', 'Hoy · 11:29', 'Sin incidencias reportadas'], 'Lectura ilustrativa; no es una prueba física', 'Registrado'),
          row('Impresora de barra', ['POS Principal', 'Hoy · 11:05', 'Resultado desconocido'], 'Trabajo de impresión por revisar', 'Atención'),
          row('Conexión KDS', ['KDS Cocina', 'Hoy · 11:42', 'Lectura disponible'], 'Último reporte del equipo de ejemplo', 'Registrado'),
          row('Conexión POS', ['POS Reserva', '31 oct · 20:10', 'Sin lectura reciente'], 'Sin evidencia nueva de conexión', 'Atención'),
        ],
        note: 'Requiere hardware.diagnostics, independiente de audit.read. La última lectura no equivale a una prueba física actual. No ocultar errores, ausencia de evidencia o resultados desconocidos.',
      },
    ],
  },
  {
    id: 'cafes', label: 'Cafés', group: 'Plataforma', platform: true, views: [{
      id: 'cafes', label: 'Cafés', description: 'Negocios disponibles para la administración de plataforma.',
      columns: ['Negocio', 'Propietario', 'Plan', 'Sucursales', 'Estado'],
      rows: [
        row('ONCA Café', ['Sofía Martínez', 'Pro', '1', 'Activo'], 'Mazatlán · Negocio seleccionado', 'Activo'),
        row('Bruma Café', ['Daniela Paz', 'Growth', '1', 'Activo'], 'Culiacán · Negocio de ejemplo', 'Activo'),
        row('Casa del Grano', ['Rafael Ortiz', 'Starter', '1', 'Activo'], 'Los Mochis · Negocio de ejemplo', 'Activo'),
        row('Patio Norte', ['Isabel Cruz', 'Pro', '1', 'En configuración'], 'Mazatlán · Negocio de ejemplo', 'Pendiente'),
      ],
      action: 'Nuevo café', fields: [
        { label: 'Nombre del café', value: '', required: true },
        { label: 'Ciudad', value: '' },
        { label: 'Zona horaria', value: 'America/Mexico_City' },
        { label: 'Nombre del propietario', value: '' },
        { label: 'Correo del propietario', value: '', type: 'email', required: true },
        { label: 'Contraseña inicial del propietario', value: '', type: 'password', required: true },
        { label: 'Plan', value: 'Growth', options: ['Starter', 'Growth', 'Pro'], required: true },
        { label: 'Prefijo de tarjeta', value: '', required: true },
        { label: 'Color de marca', value: 'Azul', options: ['Azul', 'Café', 'Verde', 'Terracota'] },
        { label: 'Primera sucursal', value: '' },
      ],
      note: 'Solo super_admin de plataforma. Un rol Owner del café no concede este acceso. La lista no depende del producto contratado por el negocio seleccionado. El alta conserva propietario, plan, marca y primera sucursal; todo resultado aquí es local e ilustrativo.',
    }],
  },
  {
    id: 'billing', label: 'Productos y facturación', group: 'Plataforma', platform: true, views: [{
      id: 'billing', label: 'Productos y facturación', description: 'Consulta los productos habilitados y su estado para ONCA.',
      columns: ['Producto', 'Alcance', 'Estado', 'Observación'],
      rows: [
        row('Dashboard', ['Administración del negocio', 'Activo', 'Incluido en el plan'], 'Estado ilustrativo del contrato', 'Activo'),
        row('Umi POS', ['Ventas y caja', 'Activo', '1 sucursal'], 'Estado ilustrativo del contrato', 'Activo'),
        row('Umi KDS', ['Estaciones de cocina', 'Activo', 'Centro'], 'Estado ilustrativo del contrato', 'Activo'),
        row('Umi Cash', ['Lealtad, tarjetas y monedero', 'Activo', 'Comercio'], 'Estado ilustrativo del contrato', 'Activo'),
        row('ConversaFlow', ['Atención y horarios', 'Activo', 'Comercio'], 'Estado ilustrativo del contrato', 'Activo'),
      ],
      note: 'Consulta exclusiva de super_admin con producto dashboard. El código revisado no incluye contratación, compra, formulario de pago ni cambio de plan. Esta vista no ofrece esas acciones.',
    }],
  },
  {
    id: 'profile', label: 'Mi perfil', group: 'Cuenta', views: [{
      id: 'profile', label: 'Mi perfil', description: 'Tu sesión y el acceso disponible en cada negocio.',
      columns: ['Acceso', 'Valor', 'Alcance'],
      rows: [
        row('Sofía Martínez', ['sofia@example.com', 'Sesión ilustrativa'], 'Propietaria de ONCA'),
        row('ONCA Café', ['Owner', '1 sucursal'], 'Negocio seleccionado'),
        row('Permisos del comercio', ['Administración, catálogo y operación', 'Según producto y servidor']),
        row('Acceso de plataforma', ['Independiente del rol del café', 'Solo en modo plataforma de la maqueta']),
      ],
      note: 'Consultar datos de sesión, rol, permisos y negocios disponibles; seleccionar negocio y cerrar sesión. El acceso conserva correo y contraseña, recordar sesión, verificación adicional, recuperación y cambio de contraseña con verificación del enlace. No se muestran credenciales guardadas.',
    }],
  },
];

export const allViews = modules.flatMap(m => m.views);

export function findView(id: string): View {
  return allViews.find(view => view.id === id) ?? allViews[0];
}
