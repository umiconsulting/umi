# Alcance y paridad de la maqueta

Actualizado: 2 de noviembre de 2026. El rediseño está en `/Users/moon/Documents/umipos-redesign`; las aplicaciones reales siguen en `/Users/moon/Documents/umi`.

| Área | Representación en Stageshow | Pendiente antes de integrar en staging |
| --- | --- | --- |
| POS: acceso, navegación y catálogo | PIN de ejemplo, roles separados, búsqueda, categorías, fotos, modificadores y cuenta local. | Mantener el acceso, permisos efectivos, políticas y datos de los controladores Flutter. |
| Pedidos | Tres recorridos: menú digital, comer aquí y para llevar. Nuevas rondas, repetición de productos enviados, notas y tiempo de servicio del Latte. Las líneas enviadas conservan su cantidad; cancelar pide motivo y PIN de ejemplo si empezó la preparación. | Webhooks, concurrencia, reconexión, idempotencia y autorizaciones reales. Editor general de variantes/opciones de todos los productos. |
| Mesas y cuentas del POS | Apertura con personas/capacidad, cuentas independientes y reanudación, nuevo pedido para llevar, traslado con cuenta y tiempo conservados, agrupación de mesas libres, separación con reparto de personas, estados de servicio y limpieza. | Mesas temporales por política; asignación general de mesa a una cuenta existente; plano y ocupación reales; conflictos entre terminales y permisos del servidor. Unir mesas no fusiona sus cuentas. |
| KDS | Recepción y preparación por Barra/Cocina, por cuenta y ronda. Cada estación recibe sus productos; las nuevas rondas no vuelven a enviar las líneas previas. | Rutas configuradas, sincronización LAN/servidor y actualización entre dispositivos reales. |
| Cobro | Efectivo insuficiente y cambio; pagos parciales/mixtos; transferencia con folio y confirmación; terminal externa; propina por importe o porcentaje sobre la base sin IVA. Finalización explícita de parciales al cubrir el saldo exacto. Terminal integrada simulada con espera, rechazo, resultado desconocido y consulta del mismo intento. | Políticas y métodos efectivos del servidor, adquisición real de pagos, conciliación y recuperación de una escritura parcial incierta. Descuentos, reembolsos y anulaciones del centro de excepciones siguen sin UI equivalente. |
| Caja | Entradas, salidas, retiro, autorizaciones de ejemplo, suspensión, entrega, conteo ciego/visible y cierre. Los abonos en efectivo se registran una vez, incluyendo propina y excluyendo cambio; cambiar de cuenta/rol o abrir otro turno no vuelve a registrarlos. | Permisos y conciliación del servidor, atribución real a turnos, libro real y políticas actuales completas. |
| Hardware | Formularios y pruebas simuladas para impresora, cajón y terminal. | Impresión y apertura físicas; desconexión, reimpresión y fallos de transporte. |
| Dashboard | 18 módulos de navegación y perfil, 47 vistas, propietario/plataforma, búsquedas, exportación y formularios. Identidad visual recuperada del original. | Portar la presentación sobre los hooks, rutas y permisos existentes; no sustituirlos por este estado local. |
| Acceso del dashboard | Imagen original del pescado a fondo completo; correo/contraseña, recordar correo, recuperación, cambio de clave, MFA de ejemplo e idioma del acceso. | Autenticación real, expiración, proveedor MFA y correo. |
| Listas y formularios | Altas/ediciones de ejemplo persisten al confirmar mientras la aplicación está montada; volver o cambiar de módulo las conserva. | Validación de dominio y guardado real. Las operaciones de negocio secundarias muestran un resultado de simulación y no alteran saldos ni dispositivos. |
| Reportes | Tabla, resumen y CSV comparten el período del ejemplo. | Consultas y cálculos reales del periodo, sucursal, canal y permisos. Los periodos distintos de Hoy usan una escala ilustrativa del mismo conjunto de datos. |
| Inventario | Artículos, recetas, preparación, costos, compras, conteo con decimales y motivo de diferencia. | Consumo real de ingredientes, costos calculados y libros. La revisión CSV/XML es ilustrativa y no analiza archivos. |
| Plano del dashboard | Áreas y dimensiones; mesa cuadrada/redonda/rectangular, muro, barra, puerta, texto; nombre/capacidad/posición/tamaño/rotación; selección, arrastre, ajuste a cuadrícula, duplicar/eliminar, historial, zoom y borrador persistente local. | Persistencia real, sincronización, cuentas del backend y control de concurrencia. |
| Publicación del plano | Vista publicada/borrador, detección de mesas ocupadas afectadas, espera, cancelar, liberación simulada y confirmación explícita. | Usar los bloqueos, permisos y eventos del producto real; liberar una mesa de ejemplo no cierra una cuenta real. |
| Dispositivos | Marcos Windows, macOS, iPhone, Android, iPad y Galaxy; tablets en ambas orientaciones. | Ejecutar en los sistemas operativos reales. Un marco no es un emulador. |

## Persistencia de la demostración

Los formularios y registros del dashboard permanecen durante la sesión montada. Recargar reinicia sus ejemplos. El borrador y publicación del plano usan almacenamiento local del navegador; también puede conservarse el correo elegido en el acceso. No se guarda una sesión ni una contraseña real. Los PIN y credenciales que muestra el visor son públicos y exclusivos del prototipo.

Las cuentas, rondas, pagos y turno del POS se conservan al navegar y cambiar de rol dentro del recorrido. Cambiar de recorrido o recargar reinicia esos ejemplos. El PIN gerencial de cancelación de un producto preparado es `4826`; es una autorización local de demostración.

## Verificación de las operaciones añadidas

`node scripts/pos-model-qa.mjs` comprueba rondas, cancelación, saldos, finalización, restricciones tras pagos, recuperación de terminal, movimiento y separación de mesas y ausencia de doble registro de efectivo al abrir otro turno. El modelo y el chequeo de TypeScript pasaron. `scripts/pos-parity-qa.mjs` contiene los recorridos de escritorio y móvil; su ejecución completa y la revisión responsive están pendientes de la congelación final de fuentes. Una medición preliminar detectó desborde en el cobro; el pie de cambio/confirmación se separó del contenido desplazable y requiere nueva comprobación de navegador.

La cobertura local sigue incompleta: centros de ventas e historial, reembolsos/anulaciones, clientes/lealtad, inventario del POS y recuperación general todavía requieren sus flujos equivalentes. Esta implementación no acredita paridad de todo el producto.

## Regla de integración

El inventario de funciones del producto es la referencia de aceptación: [dashboard](dashboard-current-inventory.md) y [POS](current-pos-options.md). Que una función aún no esté simulada no autoriza a retirarla del producto. Las pruebas de esta maqueta validan presentación e interacción local; no prueban la aplicación nativa, API o periféricos.

El plan de PR, comprobaciones nativas, activación y retorno está en [staging-integration-audit.md](staging-integration-audit.md). No se ha creado un PR ni desplegado esta propuesta.
