# Dashboard: estado de la implementación de paridad

Fecha: 2 de noviembre de 2026. Alcance: prototipo local `umipos-redesign`.

El repositorio `umi` se consultó en modo de lectura. Sus pantallas actuales y `origin/staging` son referencias de comportamiento. Esta comparación no establece qué versión está desplegada en producción.

La instrucción visual más reciente exige mantener el dashboard casi igual al actual. Se conservan sus destinos y formularios. Los cambios visuales del shell se revisan por separado.

## Evidencia verificada

- `npm run typecheck`: terminó con código 0.
- `npm run build`: terminó con código 0. ExcelJS se carga en un archivo diferido.
- `node scripts/dashboard-parity-model-test.mjs`: pasó las aserciones de filtros, PIN, rutas, permisos ilustrativos, cambios locales, recepción parcial y códigos de regalo.
- `node scripts/dashboard-import-model-test.mjs`: pasó CSV, XLSX, fórmulas, duplicados, límites y distinción entre costo cero y desconocido.
- `node scripts/dashboard-parity-qa.mjs`: 25 comprobaciones, código 0 y cero errores de página.
- `node scripts/device-qa.mjs --dashboard`: 140 comprobaciones, código 0 y cero errores de página.
- `node scripts/device-qa.mjs --dashboard-mobile`: 151 comprobaciones, código 0 y cero errores de página.
- `node scripts/device-qa.mjs --dashboard-regression`: 22 comprobaciones, código 0 y cero errores de página.
- Evidencia: `shots/dashboard-parity-qa.json`, `shots/dashboard-qa.json`, `shots/dashboard-mobile-qa.json` y `shots/dashboard-regression-qa.json`.
- La primera lectura CSV provocó una recarga de preoptimización de Vite. El responsable añadió las dependencias a `optimizeDeps.include`. La repetición completa pasó sin cambios de UI durante la prueba.

Una prueba de modelo no acredita el flujo en el navegador. Una simulación no acredita API, hardware, permisos del servidor ni operación real del proveedor.

## Cambios implementados

| Dominio | Referencia | Implementación local | Verificación pendiente |
| --- | --- | --- | --- |
| Contexto | Shell y contexto de comercio actuales | Selector de sucursal arriba y negocio al pie. Registros locales separados por contexto. | El cambio a Malecón mostró el vacío; volver a Centro recuperó sus filas. Falta validar conservación de borradores al cambiar contexto. |
| Navegación | Shell actual | Disclosures de fila completa en Reportes, Caja, Productos, Inventario y Diagnóstico. Se conservan los blancos del recorrido. | Navegación real por todos los módulos y secciones: pasó. El responsable verifica el recorrido animado por separado. |
| Filtros | Orders, customers, staff, inventory | Estado y canal de Pedidos; clientes; rol y estado del equipo; estado de recibos; área/vista de inventario; versiones de recetas. Actualizar conserva cambios locales. | Estado + canal de Pedidos, actualización, búsqueda y vacío: pasaron. Faltan todas las combinaciones de los demás módulos. |
| Productos | operations-workspace.jsx | Agregar/quitar variantes, ajuste de precio, actividad; grupos con mínimo, máximo, obligatoriedad y opciones con ajuste. Disponibilidad por sucursal. Archivo confirmado. | Edición de precio de variante y opción, confirmación, salida del módulo y reapertura: pasaron. |
| Categorías | categories-workspace.jsx | Nombre y valor de color editable sin limitarlo a cinco opciones. | Falta el selector visual libre de color del original. |
| Equipo | staff.jsx | PIN de 4–8 dígitos con confirmación; quitar PIN; desactivar; restaurar. El PIN se excluye del estado guardado. | Alta, PIN de seis dígitos, confirmación distinta, revisión oculta, ausencia en almacenamiento, quitar PIN y restaurar: pasaron. |
| Roles | staff.jsx y permission-labels.js | Catálogo completo de etiquetas de permisos; buscar por dominio; reasignar personas; archivo con bloqueo. Owner protegido. | El conteo se deriva del roster. Bloqueo de archivo, reasignación, cambio de persona y archivo: pasaron. |
| Clientes | customers.jsx | Las acciones de sellos, visita, recompensa y saldo cambian el ejemplo. Error y resultado desconocido permiten reintentar la misma operación. Se conservan seis pestañas. | Agregar sellos, habilitar recompensa y actualizar Lealtad: pasaron. Falta comprobar todos los resultados de operaciones de saldo. |
| Atención | conversations.jsx | La fila abre la ficha completa del cliente. No se añade un editor de conversación. | Atención abrió la ficha con Datos y Recargar saldo. Los tamaños móviles de la pantalla pasaron. |
| Datos y notas | customers.jsx | Identidades, verificación, candidatos de fusión y calidad como consulta. Se retiró la acción inventada de agregar una nota manual. | Comparar todos los estados del panel de identidades con datos reales. |
| Regalos | gift-cards.jsx | Emisión con código mostrado una vez; canje por código/contacto y estado local. Los códigos completos no se guardan en la fila. | Ocultar el código y canjearlo después de recargar la página: pasaron. El reconocimiento guarda un hash, nunca el código completo. |
| Cocina | cocina.jsx y kitchen-routing-model.js | Consulta de destino efectivo: producto, categoría, predeterminada; prioridad; rutas inactivas; Sin destino. Guardar/desactivar rutas. | La regresión conserva tipo Producto, estación y objetivo de 12 minutos al editar una ruta. Faltan casos con varias rutas equivalentes y todas las estaciones. |
| Inventario | inventory-workspace/editor/panel/count | Archivo, ajuste, merma, daño; selección y bloqueo de stock negativo. Conteo ciego por áreas, borrador, vacíos sin convertirlos a cero y revisión de diferencias. | Conteo ciego, artículo omitido, diferencia y stock actualizado: pasaron en iPhone y Android. Faltan controles completos de conversiones/alérgenos y autorización por operación. |
| Recetas | recipe-workspace.jsx | Colección de ingredientes; costos completos/desconocidos; versiones anteriores; retiro y filtro de retiradas. | Reintentos, rendimiento y conversiones con todas las unidades. |
| Importación | origin/staging, inventory-import | Parser y validaciones existentes copiados al prototipo. CSV/XLSX; plantilla, guía, referencias, ejemplo; corrección por fila; progreso, detener, reintentar y descargar informe. | CSV con fila inválida, corrección, resultado incierto y reintento: pasó. El nuevo artículo mantuvo stock cero y costo cero. XLSX está probado en el modelo; falta repetirlo en navegador. |
| Compras | invoice-inbox.jsx | Lectura local de conceptos CFDI; vínculo por línea, SKU, pedido, cantidad recibida y recepción parcial. La segunda recepción usa la diferencia. | Recepción parcial y segunda recepción con solo la diferencia: pasaron. Faltan más casos CFDI, cambios de artículo entre recepciones y costo efectivo. |
| Preparación | staging inventory-production | Alta de lote local y descarga de etiquetas. | El consumo previo aún usa un ejemplo; falta calcularlo desde la receta seleccionada y su rendimiento. |
| Equipos | devices.jsx | Código de configuración con caducidad; estados de registro, aprobación/denegación y revocación. No transforma la creación local en una conexión. | Código/caducidad, estado sin conexión falsa y revocación: pasaron. La regresión conserva producto KDS, Android y estación Barra al renombrar. Faltan expiración y solicitudes inválidas. |
| Mercado Pago | devices.jsx | Conectar, reconectar, desconectar y crear tienda como solicitudes simuladas. Asignación de terminal/registro/modo conserva Sin verificar. | Completar selección de tiendas nuevas y estados del proveedor. |
| Ventas | ventas-report.jsx | Periodos y tabla agrupada por producto, categoría, operador, hora, canal y método. CSV usa los registros visibles. | Comparar tablas dinámicas, series y filtros con el original. |
| Caja y recibos | cash-shifts.jsx y recibos.jsx | Detalles de composición del efectivo, arqueos y trazabilidad. Copia simulada conserva resultado físico desconocido. | Recibos ya incluye impuestos, subtotal, descuento, reembolso y desglose de pago. Falta completar denominaciones por intento en caja. |
| Horarios | hours.jsx | Guardar un día, copiar a días hábiles/todos y pausa/reanudación global confirmada. | Validación de corte y horas; difusión y teléfonos exentos. |

## Brechas que no son solo integración

Quedan controles y reglas de UI pendientes. No se declara paridad completa:

- El selector de idioma del dashboard real aún no se representa dentro del shell.
- Ajustes de marca: carga y vista previa de logo. Wallet: vista previa que responda a colores y contraste.
- Costos y márgenes: periodo, resumen, desglose por platillo e insumos bajos completos.
- Preparación: consumo por receta/rendimiento; resultados y etiquetas equivalentes al flujo de staging.
- Regalos y clientes: probar que saldos y sellos permanecen coherentes entre los destinos relacionados.
- Permisos: los escenarios de navegación son representativos. No reproducen aún cada combinación de permisos por pestaña y acción.
- Los datos de ejemplo no cubren todos los errores, estados vacíos o resultados inciertos del producto.
- Las pruebas de navegador cubren los casos documentados arriba. No cubren todas las combinaciones, validaciones ni estados de error de cada dominio.

## Integraciones que permanecen fuera del prototipo

Todos los guardados son locales. Los servicios reales conservan autorización, concurrencia, idempotencia y persistencia. El prototipo no comprueba impresión física, KDS, registro de hardware, OAuth, Mercado Pago, CFDI en el servidor, Wallet, mensajes ni operaciones monetarias.

## Fuentes y bibliotecas

Se reutilizó el código de formato y revisión de `origin/staging` para no sustituir sus reglas por otro parser. ExcelJS `4.4.0`, PapaParse `5.7.0` y read-excel-file `9.3.14` coinciden con ese árbol. La fuente está en `src/dashboard/import-source/`. Las adaptaciones solo corrigen rutas de importación y añaden tipos para el prototipo.

Los componentes son BoardUI ya instalados: Button, Input, Select, Checkbox, Table, Tabs y FileUpload. No se añadió otra biblioteca de interfaz.
