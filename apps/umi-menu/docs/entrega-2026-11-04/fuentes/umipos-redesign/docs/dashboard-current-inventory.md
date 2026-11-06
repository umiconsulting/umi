# Inventario del dashboard actual

Fecha: 2026-11-01. Alcance: todas las pantallas del dashboard, incluidos sus subflujos.

## Evidencia y herramientas

- **Hecho documentado:** el código local de `main` está en `dea2dfc7`. La referencia local `origin/staging` está en `b3e5bf88`.
- Se usaron Git 2.50.1 y ripgrep 15.2.0. Ambos están instalados y permiten consultas sin interacción.
- Fuente primaria: código del repositorio `/Users/moon/Documents/umi`, especialmente `apps/umi-dashboard/src/`.
- Se compararon las referencias con `git diff` y `git show`. El inventario fue de lectura; el agente principal actualizó antes las referencias con `git fetch origin staging main`.
- No se instaló una herramienta nueva. No se creó un extractor permanente.
- La búsqueda de texto y la lectura del código bastan para este inventario. La inspección visual requiere un navegador.
- Esta auditoría **no verifica** la aplicación en ejecución, sus permisos efectivos ni sus servicios externos.
- `AGENTS.md` exige `product-feature-review`. Esa skill no aparece en las ubicaciones y referencias revisadas por el agente principal.
- Se aplicaron las reglas explícitas de `AGENTS.md`, `REPO_CONTEXT.md` y la skill `research`. No se inventó una skill sustituta.
- La doctrina de herramientas recomienda estas consultas al código: `docs/agents/tool-and-research-doctrine.md`.

El inventario siguiente describe hechos del código. Las propuestas visuales al final son inferencias.

## Navegación vigente

La fuente canónica es `src/lib/module-registry.js`. Las rutas se montan en `src/app.jsx`.
Hay 18 entradas principales. Algunas abren varias rutas o pestañas.

| Grupo | Entrada | Rutas o vistas | Funciones que debe conservar el rediseño |
| --- | --- | --- | --- |
| Inicio | Resumen | `/` | Resumen por sucursal, estado de estaciones, centro de acción y enlaces a los módulos. |
| Operación | Pedidos | `/orders` | Filtros por estado y canal, actualización, lista, importe neto, detalle del pedido y su cronología. |
| Operación | Reportes | `/reportes`, `/reportes/reembolsos` | Ventas y reembolsos en destinos separados. Ventas incluye resumen, tabla dinámica y recibos. |
| Operación | Caja y turnos | `/cash-shifts`, `/cash-shifts/registros` | Turnos, diferencias, arqueos, libro de caja, trazabilidad, registros y reglas del cobro. |
| Operación | Cocina | `/kitchen` | Configuración de estaciones, rutas y avisos. Esta pantalla administra el KDS; no sustituye su vista operativa. |
| Clientes | Clientes | `/customers/*` | Lista, búsqueda, filtros y ficha con seis pestañas. Acciones de lealtad y saldo según el acceso efectivo. |
| Clientes | Atención | `/triage` | Conversaciones pendientes por antigüedad. Cada fila abre la ficha del cliente. Requiere ConversaFlow. |
| Clientes | Lealtad y valor | `/loyalty-value` | Lealtad, Recompensas, Tarjetas de regalo y Monedero. Requiere Umi Cash. |
| Negocio | Productos | `/products`, `/products/categorias` | Catálogo, variantes, modificadores, disponibilidad y categorías con su color del POS. |
| Negocio | Inventario | `/inventory/:tab?` | Artículos, Recetas, Preparación, Costos y márgenes, Compras. Incluye los estados nuevos de staging. |
| Negocio | Plano de mesas | `/floor-plan` | Editor del espacio, áreas, mesas, elementos, estado del salón y publicación con bloqueos. |
| Negocio | Dispositivos | `/devices` | POS, KDS, periféricos, solicitudes de registro, códigos de configuración y Mercado Pago. |
| Negocio | Equipo y accesos | `/staff` | Personas, roles, permisos, acceso al POS, altas, desactivación y restauración. |
| Configuración | Horarios | `/hours` | Horario semanal, corte de pedidos, pausa global, difusión, aviso especial y teléfonos exentos. Requiere ConversaFlow. |
| Configuración | Ajustes | `/settings` | Negocio, sucursales, segmentos, asistente, Wallet, sellos, cumpleaños, promoción y autorregistro. |
| Configuración | Productos y facturación | `/products-billing` | Consulta de productos contratados y su estado. Requiere acceso de plataforma. |
| Configuración | Diagnóstico | `/diagnostics` | Recuperación, Auditoría y Diagnóstico. Cada pestaña conserva su permiso. |
| Plataforma | Cafés | `/cafes` | Lista de negocios, selección y alta de un café con dueño, plan, marca y primera sucursal. |

### Rutas auxiliares

| Ruta | Función |
| --- | --- |
| `/profile` | Perfil de la sesión, permisos en el café, negocios disponibles y cierre de sesión. |
| `/login` | Correo y contraseña, recordar sesión, código de verificación y solicitud de recuperación. |
| `/reset-password` | Verificación del enlace, nueva contraseña, confirmación y resultado. |
| `/operations` | Puente antiguo de dominios. Está fuera del menú principal. No usar sus acciones como política universal del rediseño. |
| `/members`, `/gift-cards` | Redirecciones a Lealtad y valor. |
| `/catalog-inventory`, `/inventory-costing` | Redirecciones a Productos e Inventario. |
| `/reportes/recibos` | Redirección a Ventas. Los recibos se abren dentro de Ventas. |
| `/insights`, `/conversations/*` | Compatibilidad con las rutas de Clientes. |

## Subflujos que necesitan diseño propio

### Pedidos y reportes

- **Pedidos:** Activos, Nuevos, En preparación, Listos, Completados, Cancelados y Todos.
- El canal tiene filtros Todos, POS y WhatsApp. La presentación también reconoce Web y Consola.
- El detalle conserva cliente, modalidad, productos, descuento, reembolso, importe neto y cronología.
- La pantalla de Pedidos consulta el estado comercial. No agrega acciones de cobrar ni preparar.
- **Ventas:** periodos Hoy, Ayer, 7 días y 30 días.
- Resumen del periodo, venta por hora o día, canal y método de pago.
- Tabla dinámica por producto, categoría, operador u hora.
- **Recibos:** búsqueda, estados, detalle de venta, conceptos, impuestos, pago y copia controlada.
- La reimpresión conserva el resultado físico y los errores. Un resultado desconocido no equivale a éxito.
- **Reembolsos:** resumen, filtros, operador, monto, motivo, recibo original y aprobador.
- Reembolsos y anulaciones se ejecutan en el POS. La pantalla vigente de Reportes los consulta.

Fuentes: `src/screens/orders.jsx`, `ventas-report.jsx`, `recibos.jsx`, `reembolsos.jsx`.

### Caja y turnos

- Lista de turnos con búsqueda por caja u operador y filtros de estado.
- Diferencia neta por día, cajas abiertas y turnos que requieren atención.
- Detalle: fondo, ventas, entradas, salidas, caja fuerte, reembolsos, esperado, contado y diferencia.
- Conserva denominaciones de apertura y arqueo, intentos, operadores y trazabilidad.
- **Registros:** estado de cajas, movimientos y aperturas de cajón sin venta.
- **Regla del conteo:** conteo ciego.
- **Reglas del cobro:** terminal manual, pagos mixtos y Comer aquí sin mesa.
- Atribución de propinas: mesero de la cuenta o cajero que procesa cada cobro.
- Transferencia bancaria: habilitación, titular, banco, CLABE y número de cuenta.
- El dashboard gobierna reglas y consulta movimientos. Abrir, contar y mover dinero sigue en el POS.

Fuentes: `src/screens/cash-shifts.jsx`, `caja-turnos.jsx`, `registros.jsx`, `bank-transfer-policy.js`.

### Cocina

- Crear y editar estaciones.
- Configurar umbral de demora, sonidos de llegada, vencimiento y artículo listo.
- Ruta predeterminada, rutas por categoría y excepciones por producto.
- Cada ruta conserva estación, prioridad y tiempo objetivo.
- Buscar producto, consultar su destino efectivo, guardar o desactivar su ruta.
- Conservar el estado «Sin destino». No esconder un producto sin ruta detrás de un estado de éxito.

Fuente: `src/screens/cocina.jsx`.

### Clientes, atención y lealtad

- Lista de clientes con búsqueda por nombre, teléfono o correo y carga incremental.
- Filtros Todos, WhatsApp, Lealtad, Notas y Revisión.
- Ficha: Resumen, WhatsApp, Pedidos, Lealtad, Notas y Datos.
- El resumen del cliente generado por IA conserva su atribución; no convertirlo en un hecho confirmado.
- Lealtad en ficha: agregar sellos, registrar visita, canjear recompensa y registrar el recibo correspondiente.
- La ficha también contiene recarga de saldo. El servidor debe conservar la autorización correspondiente.
- Conservar estados pendientes, errores y «Reintentar la misma operación». No emitir una segunda operación por incertidumbre.
- Atención abre la ficha del cliente. No inventar un editor de conversación sin revisar su capacidad real.
- **Lealtad:** registrar miembro, buscar, filtrar, paginar y abrir el detalle de la tarjeta.
- **Recompensas:** consulta del dominio autorizado.
- **Tarjetas de regalo:** emitir, mostrar el código una sola vez, canjear y consultar estados.
- **Monedero:** el dominio del hub es de consulta. Esto no elimina la recarga existente en la ficha del cliente.

Fuentes: `src/screens/customers.jsx`, `conversations.jsx`, `members.jsx`, `gift-cards.jsx`, `loyalty-value.jsx`.

### Productos e inventario

- **Productos:** lista, búsqueda y edición o alta de producto.
- Conservar categoría, precio, variantes, grupos de opciones, modificadores y vínculo con inventario.
- Conservar disponibilidad por ubicación y archivo con confirmación.
- **Categorías:** crear y editar nombre y color que usa el POS. Mostrar la cantidad de productos.
- **Artículos:** vistas, búsqueda, filtros, selección, alta, edición, archivo y detalle.
- El detalle conserva existencias, movimientos y las acciones permitidas de ajuste, conteo, merma o daño.
- El editor conserva referencia, tipo, unidad, decimales, control de existencia, mínimo y vida útil.
- También conserva cantidad objetivo de preparación, conversiones y alérgenos.
- **Conteo:** elegir áreas, contar cada artículo, revisar diferencias y terminar según la autorización.
- **Recetas:** producto o artículo objetivo, variante, rendimiento, unidad, vida útil, ingredientes y costo.
- Conservar versiones, recetas retiradas, confirmación del cambio y reintento de guardado.
- **Preparación:** cantidad objetivo, existencia, uso previsto, cantidad a preparar y etiquetas.
- **Costos y márgenes:** periodo, resumen, detalle por platillo, insumos bajos y origen del costo.
- Mantener la distinción entre costo cero y costo desconocido. No publicar un margen incompleto como dato definitivo.
- **Compras:** cargar CFDI XML, revisar factura, casar líneas con artículos y SKU del proveedor.
- Vincular el pedido de compra, revisar cantidad recibida y registrar la entrada.

Fuentes: `src/screens/products-hub.jsx`, `operations-workspace.jsx`, `categories-workspace.jsx`, `inventory-hub.jsx`.
Detalle: `inventory-workspace.jsx`, `inventory-item-editor.jsx`, `inventory-item-panel.jsx`, `inventory-count.jsx`, `inventory-adjust.jsx`.
Recetas y compras: `recipe-workspace.jsx`, `prep-list.jsx`, `inventory-costing.jsx`, `invoice-inbox.jsx`.

### Funciones adicionales de staging

El menú coincide con `main`. El alcance funcional de Inventario ya es mayor en `origin/staging`.

| Función | Flujo que debe aparecer | Fuente en `origin/staging` |
| --- | --- | --- |
| Importar artículos | Elegir archivo, revisar, corregir errores, confirmar, detener pendientes y reintentar pendientes. | `src/screens/inventory-import-dialog.jsx`, `inventory-workspace.jsx` |
| Importar recetas | Revisar productos, variantes e ingredientes antes de confirmar. | `src/screens/inventory-import-dialog.jsx`, `recipe-workspace.jsx` |
| Nueva preparación | Artículo, almacén y cantidad; revisar ingredientes; confirmar; consultar lote y resultado. | `src/screens/inventory-production.jsx`, `prep-list.jsx` |
| Costo inicial | Editar costo inicial por unidad. Las compras registradas tienen prioridad sobre ese valor. | `src/screens/inventory-item-editor.jsx`, `inventory-item-panel.jsx` |
| Stock negativo | Conservar la política elegida y la acción masiva de bloqueo. | `src/screens/inventory-item-editor.jsx`, `inventory-workspace.jsx` |

La importación no registra una entrada de inventario. El diálogo dirige esas entradas a Compras o Ajustar existencia.
Los límites visibles son 2 MiB, 500 filas, 100 recetas y 200 ingredientes por receta.
Son hechos del código revisado; no son resultados de una prueba del importador.

### Plano de mesas

- Áreas y cambio de área.
- Mesas redondas, cuadradas y rectangulares; muros, barra, puerta y texto.
- Posición, nombre, capacidad, forma, duplicación y eliminación.
- Deshacer, rehacer, cuadrícula y zoom.
- Estado vivo del salón, grupos y personas.
- Publicar con cuentas bloqueantes: esperar, volver a editar o resolver el bloqueo mediante la acción permitida.
- Conservar el plano durante errores de lectura del estado del salón.

Fuentes: `src/screens/floor-plan.jsx`, `floor-plan-model.js`, `floor-plan-publish-queue.js`, `floor-plan.css`.

### Dispositivos y equipo

- **Dispositivos:** lista de POS/KDS, estado, última conexión, modo, plataforma y sucursal.
- Añadir equipo: elegir sucursal y producto, definir nombre/plataforma/modalidad, crear código con caducidad.
- Solicitudes de registro POS y pareo KDS: aprobar o denegar.
- Editar nombre, modo o estación; revocar con confirmación.
- Estaciones: crear, renombrar y archivar.
- **Hardware registrado:** impresoras y periféricos. Esta sección existe en el código actual.
- **Mercado Pago:** conectar/reconectar/desconectar cuenta; consultar o crear tienda; asignar terminal al registro y modo.
- Conservar resultados fallidos o desconocidos del proveedor. No mostrar «Conectado» por una acción local de la maqueta.
- **Personas:** añadir, filtrar por rol, administrar acceso POS, asignar PIN, quitar PIN, desactivar y restaurar.
- El dashboard nunca muestra un PIN guardado.
- **Roles:** crear, editar nombre/descripcion/permisos y archivar después de reasignar al equipo.
- El rol Owner está protegido.

Fuentes: `src/screens/devices.jsx`, `staff.jsx`, `staff-roster.js`, `permission-labels.js`.
Los documentos de diseño de septiembre que eliminaban Hardware ya no describen todo el código actual.

### Ajustes, horarios y cuenta

- **Negocio:** nombre, ciudad, inicio del día operativo y política de cuentas abiertas al cierre.
- **Segmentos:** gasto/visitas VIP, visitas frecuentes y ventanas de actividad/inactividad.
- **Marca:** logo, dirección pública y prefijo de tarjeta.
- **Sucursales:** alta, nombre, estado, dirección, ubicación, apodos y descripción.
- **Asistente:** tono, nombre, tono personalizado y notas de estilo.
- **Wallet:** colores, contraste y vista previa del pase.
- **Recompensas:** nombre del premio, visitas, costo, sellos máximos y premio de cumpleaños.
- **Promoción:** mensaje, fechas y días de la semana.
- **Autorregistro:** configuración existente del registro de clientes.
- **Horarios:** horario por día, corte antes del cierre, pausa/reanudación global, aviso y teléfonos exentos.
- La pausa requiere confirmación y conserva su alcance global.
- **Perfil:** datos de sesión, acceso al café, permisos, negocios y cierre de sesión.
- **Acceso:** contraseña, verificación adicional, recuperación y cambio de contraseña.

Fuentes: `src/screens/settings.jsx`, `hours.jsx`, `profile.jsx`, `login.jsx`, `reset-password.jsx`.

## Permisos y límites

La disponibilidad combina tres ejes: producto activo, permisos del comercio y acceso de plataforma.
Un rol del café no concede acceso de plataforma. Un permiso no activa un producto ausente.

| Destino | Puerta principal del registro |
| --- | --- |
| Resumen | Producto `dashboard`. |
| Pedidos y Cocina | `kitchen.read`, además del producto. |
| Reportes | `sale.lifecycle` o `sale.exception.read`. |
| Caja y turnos | `cash.shift.read`. |
| Clientes y Atención | `customer.read`; Atención también exige `conversaflow`. |
| Lealtad y valor | Producto `cash`; `loyalty.read`, `gift_card.read` o `wallet.read`. |
| Productos | `catalog.read`. |
| Inventario | `inventory.read`; sus pantallas administrativas también verifican `merchant.manage`. |
| Plano, Equipo, Horarios y Ajustes | `merchant.manage`; Horarios exige `conversaflow`. |
| Dispositivos | `device.enroll`; las acciones tienen reglas adicionales. |
| Diagnóstico | `audit.read` o `hardware.diagnostics`; cada pestaña conserva su puerta. |
| Productos y facturación | `platformRole === 'super_admin'` y producto dashboard. |
| Cafés | `platformRole === 'super_admin'`; no depende del producto contratado por el café seleccionado. |

Fuente: `src/lib/module-registry.js`, `src/app.jsx`, `src/screens/diagnostics.jsx` e `inventory-hub.jsx`.
La tabla describe la puerta de navegación. Cada operación debe conservar la autorización del servidor.

Productos y facturación es una consulta de estados; el código revisado no muestra un proceso de compra o cambio de plan.
No convertirlo en un formulario de pago inventado.

## Consecuencias para el rediseño

Estas son **inferencias de diseño**, pendientes de comprobar en navegador:

1. Conservar todas las secciones mediante navegación agrupada y colapsable. Mantener el logo visible.
2. Separar la navegación del comercio y la de plataforma. El selector de maqueta puede mostrar ambos roles.
3. Conservar los destinos de Ventas/Reembolsos y Turnos/Registros. Evitar una pestaña global que mezcle ambos trabajos.
4. Usar listas con detalle para pedidos, clientes, turnos, recibos y artículos. En móvil, mostrar un panel por vez.
5. Usar formularios con secciones para Ajustes, Cocina y Equipo. No presentar cada campo como una tarjeta independiente.
6. Mantener el mapa espacial en el editor. La versión vertical cambia los paneles; no cambia las coordenadas de las mesas.
7. Mostrar confirmación, error, vacío, carga y reintento en los flujos de escritura. El rediseño necesita más que pantallas pobladas.
8. Señalar los datos de ejemplo en el visor. No presentar mutaciones locales como escrituras al API.

## Observaciones del CSS

**Hechos del código, no fallos visuales confirmados:**

- `styles.css` supera 5.000 líneas y combina reglas generales, estilos por pantalla y varias correcciones responsivas.
- Hay cambios de composición en 640, 720, 820, 840, 900, 1.023, 1.080 y 1.180 píxeles.
- Las pantallas monetarias usan algunas columnas inline; las reglas responsivas necesitan `!important` para apilarlas.
- El detalle de inventario pasa a pantalla fija por debajo de 1.024 píxeles.
- Clientes ya cambia a un solo panel por debajo de 900 píxeles. Debe conservar su regreso a la lista.
- El menú pasa a cajón por debajo de 1.080 píxeles. Hay correcciones anteriores para impedir que sus elementos se vuelvan horizontales.

**Inferencia:** una nueva capa visual debe usar reglas por contenedor y componentes compartidos.
No basta con copiar los estilos del Stageshow al archivo global.
La aplicación real requiere una revisión en navegador con acciones reales en cada tamaño.

## Verificación que falta

No se inició el dashboard ni se consultó el VPS en esta auditoría.
No hay evidencia nueva de la aplicación real en ejecución.
El prototipo debe marcar qué flujos representa y cuáles siguen pendientes.
Antes del PR, ejecutar el plan de pruebas del repositorio y comprobar cada función con su rol y sucursal.
Consultar `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md` para las pruebas reales y su alcance.
