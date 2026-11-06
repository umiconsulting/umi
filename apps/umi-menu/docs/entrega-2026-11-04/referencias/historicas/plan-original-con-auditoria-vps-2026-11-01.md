# Borrador del menú digital de Umi

El menú permitirá consultar productos y enviar pedidos a UmiPOS desde un QR de mesa o un enlace para recoger. Cada negocio y sucursal tendrá su configuración. El pago se realizará en el negocio.

Este borrador reúne los acuerdos de la conversación y la revisión del VPS del 1 de noviembre de 2026. Define el alcance y una división propuesta en PRs. Cada PR de implementación requiere su plan técnico sobre la revisión vigente de `staging`.

La especificación canónica y las tareas pertenecen a Azure Boards, según [la regla del repositorio](../agents/issue-tracker.md). Este documento prepara su revisión. No sustituye un elemento de trabajo. El conector Azure DevOps no estuvo disponible en esta sesión; no se consultó ni creó ningún elemento.

## Regla de entrega

Todos los cambios de este trabajo deben pasar por PRs atómicos con base `staging`. La regla incluye código, documentación, contratos, migraciones y configuración versionada.

- Cada PR resuelve un objetivo y contiene su documentación y sus comprobaciones.
- Cada PR identifica sus dependencias y parte de sus cambios ya integrados en `staging`.
- Mantener juntos los cambios acoplados que necesita un mismo comportamiento. No dividir un contrato incompatible entre PRs.
- Excluir las correcciones ajenas al objetivo del PR.
- Documentar cómo desactivar o revertir el cambio sin perder pedidos existentes.
- Conservar la compatibilidad entre los despliegues del backend, Dashboard y POS.
- Mantener las funciones nuevas desactivadas hasta completar sus dependencias y su validación.
- No realizar cambios directos en `staging`, producción o el VPS como sustituto del PR.

Este primer PR contiene únicamente el borrador y su secuencia de entrega. Crear el PR no autoriza su integración ni el despliegue.

## Alcance inicial

- Menú público adaptable a celular y escritorio.
- Pedidos desde un QR de mesa y pedidos para recoger.
- Recogida inmediata y programada, incluso para otros días cuando los productos lo permitan.
- Configuración en Umi Dashboard; atención y cobro en UmiPOS; preparación en los KDS correspondientes.
- Correo como canal inicial de avisos y seguimiento en la página del pedido.
- Compra sin cuenta y sin códigos de verificación por SMS.

Quedan fuera de esta primera versión el pago en línea, el reparto a domicilio y la conexión automática de WhatsApp de cada negocio. WhatsApp podrá añadirse como canal de avisos cuando su conexión de producción esté disponible.

## Diseño público

Conservar el diseño de la maqueta con fotografías grandes, tarjetas, colores y tipografías de Umi. El texto debe describir productos y acciones concretas.

La referencia revisada es la maqueta local `umi-menu-preview`, archivo `menu-v5.html`. Esa maqueta no forma parte de este repositorio. Conserva las fotografías grandes y las tarjetas de la versión anterior. Incluye textos directos y elimina “Bruma · Centro” sobre “Desayunos y café”. Bruma, sus fotografías, precios y horarios son datos de ejemplo.

La implementación usará los tokens de `packages/tokens`: azul principal `#223979`, azul secundario `#7692CB` y fondo `#EEF1F8`. Usará Inter Tight para títulos y Source Sans 3 para texto. El PR visual incluirá capturas propias de escritorio y celular para que la revisión no dependa de la maqueta local.

El recorrido comprende menú, detalle del producto, carrito, confirmación y seguimiento. La maqueta funciona en memoria y todavía no captura el correo ni envía pedidos reales.

El encabezado identifica al negocio y la sucursal. Un QR de mesa identifica también la mesa. Un enlace general permite consultar el menú y pedir para recoger en la sucursal correspondiente.

## Identificación y contacto

| Modalidad    | Datos del cliente                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Mesa con QR  | La credencial del QR identifica la mesa. No exigir cuenta, teléfono ni correo para enviar el pedido. |
| Para recoger | Solicitar nombre, teléfono y correo. No exigir cuenta ni código SMS.                                 |

El teléfono permite que el personal contacte al cliente. El correo recibe avisos y el enlace privado de seguimiento. Mostrar los datos antes de enviar para permitir su corrección.

Capturar un teléfono o correo no verifica la identidad de la persona. No vincular automáticamente el pedido con una cuenta, historial o saldo de otro cliente solo porque coincida un dato escrito.

El enlace de seguimiento permite consultar únicamente ese pedido. No debe permitir enumerar pedidos ni consultar otros negocios.

## Operación por modalidad

### Mesa

1. Resolver negocio, sucursal y mesa a partir del QR válido.
2. Validar que la mesa admite pedidos según su estado operativo.
3. Validar productos, opciones, cantidades y precios en el servidor.
4. Registrar el pedido y enviarlo a las estaciones correspondientes del KDS, sin aceptación previa del personal.
5. Avisar al personal y mostrar el pedido en UmiPOS, asociado a la mesa y con origen digital.
6. Realizar el cobro sobre el mismo pedido o su cuenta de mesa, según el flujo existente de UmiPOS.

La cancelación después del envío a preparación requiere intervención del personal.

### Recogida inmediata

1. Validar la disponibilidad de la sucursal y del carrito.
2. Registrar el pedido como pendiente de aceptación y mostrar su seguimiento.
3. Avisar al personal en UmiPOS.
4. Al aceptar, habilitar el envío al KDS.
5. Al rechazar, registrar el motivo y mostrarlo al cliente.
6. Al vencer el plazo sin aceptación, cerrar el pedido como vencido. No enviarlo a preparación.
7. Mostrar “Listo” cuando terminen todas las estaciones involucradas.
8. Cobrar y registrar la entrega sobre el mismo pedido.

### Recogida programada

La aceptación reserva el pedido y su horario. No implica enviarlo de inmediato al KDS.

Separar tres condiciones configurables:

| Condición                      | Uso                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| Anticipación mínima para pedir | Determina con cuánto tiempo debe encargarse el producto.                             |
| Tiempo de preparación          | Determina cuándo debe liberarse un pedido aceptado al KDS.                           |
| Límite de cancelación          | Determina hasta cuándo puede cancelarlo directamente el cliente después de aceptado. |

Cada pedido tiene una sola fecha y hora de recogida. Si mezcla productos, ofrecer únicamente horarios compatibles con todos. Aplicar el plazo mínimo más exigente y el horizonte permitido más corto.

El límite de cancelación directa debe terminar como máximo al liberar el pedido a preparación. Mostrar al cliente una fecha y hora concretas antes de confirmar.

Usar la zona horaria de la sucursal. Respetar los horarios de recogida, cierres y excepciones del calendario.

Se propone permitir pedidos programados fuera del horario de atención mediante una opción del negocio. Esta opción requiere confirmación antes de implementarla. Si se habilita, mostrar la siguiente apertura válida e iniciar allí el plazo de aceptación. No ofrecer una recogida que deje al negocio sin tiempo para revisar y preparar el pedido.

Los minutos y días usados en la maqueta son ejemplos, no valores globales aprobados.

## Cancelaciones

| Situación                                                         | Acción del cliente                 |
| ----------------------------------------------------------------- | ---------------------------------- |
| Recogida pendiente de aceptación                                  | Cancelación directa.               |
| Recogida inmediata aceptada                                       | Solicitar cancelación al personal. |
| Programado aceptado, antes del límite y sin liberar a preparación | Cancelación directa.               |
| Programado fuera del límite o liberado a preparación              | Solicitar cancelación al personal. |
| Mesa enviada a preparación                                        | Solicitar cancelación al personal. |

Una solicitud no equivale a un pedido cancelado. Mostrar “Esperando respuesta del negocio” hasta que el personal resuelva.

La aceptación y la cancelación simultáneas deben tener un único resultado válido. La misma regla aplica a cancelar mientras el sistema libera un pedido programado.

Cuando el personal autorice una cancelación, el cambio debe llegar al POS y a las estaciones afectadas. Los efectos sobre inventario y preparación deben seguir las reglas existentes de Umi. Esa revisión sigue pendiente y debe cerrarse antes del PR que cambie el ciclo del pedido.

No aplicar cargos automáticos por cancelación. El pago ocurre en el negocio.

## Umi Dashboard

Agregar “Menú digital” junto a Productos. Mantener visibles el negocio y la sucursal seleccionados.

| Área                   | Contenido                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| General                | Publicación, modalidades habilitadas, vista previa y pausa de nuevos pedidos.                          |
| Contenido              | Selección de productos, orden de categorías y destacados. Accesos a la edición del catálogo existente. |
| Pedidos y programación | Plazo de aceptación, programación, cancelaciones y acceso a horarios de la sucursal.                   |
| Enlaces y QR           | Enlace público, QR general y QR de las mesas existentes.                                               |

Publicar el menú y recibir pedidos son controles independientes. Pausar pedidos mantiene el catálogo visible y conserva los pedidos ya registrados.

Los cambios deben indicar si afectan al negocio completo o a una sucursal. No copiar automáticamente configuraciones a otros negocios.

### Productos

Extender la edición existente con estos controles:

- Mostrar el producto en el menú digital.
- Permitirlo en mesa, para recoger o en ambas modalidades.
- Permitir recogida programada.
- Permitir fechas posteriores.
- Anticipación mínima y horizonte de programación.
- Límite de cancelación para pedidos programados.

Reutilizar productos, categorías, precios, variantes y modificadores del catálogo canónico. El servidor calcula el total y valida las opciones obligatorias. Un precio o disponibilidad que cambie antes de enviar debe comunicarse al cliente para que revise el pedido.

### Horarios y conexiones

Extender “Horario y disponibilidad” con las condiciones necesarias para el menú. Distinguir las pausas de cada canal y sucursal. La pantalla local actual presenta su pausa como una función de ConversaFlow y WhatsApp.

Las conexiones de correo y futuros canales pertenecen a Ajustes. “Menú digital” muestra su estado y los avisos habilitados.

## UmiPOS y KDS

La bandeja de pedidos digitales tendrá vistas de pendientes, programados, en preparación y listos. Debe mostrar productos, modificaciones, total, origen, modalidad, cliente o mesa y horario de recogida.

El personal puede aceptar, rechazar con motivo y resolver solicitudes de cancelación. Una alerta sonora y un contador señalan nuevos pedidos pendientes.

Conservar los indicadores “Comer aquí” y “Para llevar”. Registrar el origen para el POS, el detalle y los reportes. No añadir una insignia permanente de origen al KDS.

El backend conserva el estado comercial del pedido. El KDS refleja su preparación y dirige los productos a cocina, barra u otras estaciones configuradas.

Un pedido no está completamente listo mientras falte una estación. Su cobro no debe crear una segunda orden comercial.

## Correo y seguimiento

| Evento                             | Contenido del aviso                                               |
| ---------------------------------- | ----------------------------------------------------------------- |
| Pedido enviado para recoger        | Número del pedido, resumen y aclaración de que espera aceptación. |
| Pedido aceptado                    | Confirmación y hora de recogida.                                  |
| Pedido listo                       | Sucursal y número para recoger.                                   |
| Rechazo, cancelación o vencimiento | Resultado y motivo correspondiente.                               |

Cada correo identifica al negocio y contiene el enlace de seguimiento. Para un pedido fuera de horario, el aviso inicial indica cuándo empezará la atención.

El seguimiento web debe funcionar aunque falle el correo. Registrar fallos de envío y permitir su atención sin crear otro pedido ni revertir una aceptación.

El proveedor que acepta un correo no garantiza que este llegue a la bandeja de entrada o sea leído. No presentar un correo como entregado basándose únicamente en que el adaptador devolvió un identificador de envío.

La revisión del VPS confirmó un adaptador SMTP configurado con Brevo. Se propone reutilizarlo. La entrega real no se probó. Validar remitente, dominio, respuesta al negocio y tratamiento de errores antes del piloto. Los correos de pedido no autorizan campañas promocionales.

## Excepciones operativas

| Caso                                             | Comportamiento                                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Producto agotado antes de aceptar                | Rechazar con un motivo visible para el cliente.                                                                   |
| Problema después de aceptar                      | Contactar al cliente y acordar un cambio o una cancelación.                                                       |
| Reintento del cliente                            | Recuperar el resultado del envío anterior sin duplicar el pedido.                                                 |
| Sin respuesta del negocio                        | Aplicar el vencimiento según el horario de atención.                                                              |
| Sin dispositivos disponibles durante la atención | Alertar y pausar los nuevos pedidos que requieran atención inmediata. Mantener visibles el menú y el seguimiento. |
| Pedido futuro permitido fuera de horario         | Aplicar su regla de espera hasta la apertura. No confundir el cierre previsto con una pérdida de conexión.        |
| Pérdida de conexión después de aceptar           | Conservar el pedido. Mostrar la incidencia operativa y recuperar el envío pendiente sin duplicarlo.               |
| Aviso por correo fallido                         | Conservar el estado del pedido y registrar el fallo.                                                              |
| Cliente que no recoge                            | El personal marca “No recogido”. No considerarlo una venta cobrada.                                               |

Limitar envíos repetidos para proteger la recepción de pedidos y el servicio de correo. No considerar los datos de contacto escritos como una identidad verificada.

## Evidencia técnica y sus límites

La revisión inicial usó la copia local `3d792bdd`. La revisión posterior consultó Git, el contenedor de producción y los metadatos del esquema en el VPS. Las consultas SQL se ejecutaron en una transacción de solo lectura. No se modificaron servicios ni datos, y no se enviaron correos.

### Revisiones observadas el 1 de noviembre de 2026

| Fuente                                | Resultado observado                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Checkout de producción                | Rama `main`, commit `75680bb252fbe3079b98338a5ca737cca19f04e7`.                                                                                              |
| Contenedor y su imagen de producción  | Ambos declaran la revisión `75680bb252fbe3079b98338a5ca737cca19f04e7`.                                                                                       |
| Checkout denominado staging en el VPS | Rama local `build-v3`, commit `a4246f69a87c964d4c78eb9e47571af7464b5127`. Esto no acredita la revisión de un contenedor de staging.                          |
| Base de este borrador                 | `origin/staging`, commit `a4246f69a87c964d4c78eb9e47571af7464b5127`. La base de los PRs será `staging`, aunque el checkout remoto tenga otro nombre de rama. |

Las observaciones corresponden a ese momento. Actualizar la evidencia relevante antes de cada PR que cambie contratos o datos.

### Archivos que orientan la implementación

Estas rutas existen en la base del borrador. Las observaciones iniciales corresponden a `3d792bdd`; los puntos de variantes y proyección se contrastaron también con `staging` y producción.

| Archivo o área                                                   | Hecho observado y efecto en el plan                                                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/umi-api/src/modules/table-order/table-order.controller.ts` | Ya existen rutas públicas para leer el menú de una mesa y crear pedidos con un token.                                                                        |
| `apps/umi-api/src/modules/table-order/table-order.service.ts`    | Reutiliza precios y modificadores; rechaza productos con variantes; envía pedidos mediante el escritor canónico. Hay que cubrir variantes para el menú.      |
| `apps/umi-api/src/shared/orders/order-writer.ts`                 | La creación actual llama al proyector de cocina. La aceptación y programación requieren controlar ese envío desde el backend.                                |
| `apps/umi-api/src/modules/kds/kitchen-projector.ts`              | Es el punto existente de proyección hacia cocina. Evitar crear una segunda fuente de pedidos.                                                                |
| `apps/umi-pos/lib/features/cart/incoming_orders_surface.dart`    | La acción existente toma un pedido para vincularlo al carrito. No demuestra un flujo de aceptación previa al KDS.                                            |
| `apps/umi-dashboard/src/screens/products-hub.jsx`                | Agrupa Productos y Categorías. Mantener ahí la edición del catálogo.                                                                                         |
| `apps/umi-dashboard/src/screens/hours.jsx`                       | Incluye horarios, zona horaria y una pausa presentada como WhatsApp. Revisar alcance por canal y sucursal.                                                   |
| `apps/umi-dashboard/src/screens/orders.jsx`                      | Muestra estados comerciales y origen. La vista y el contrato deben representar aceptación y programación sin confundirlas con preparación.                   |
| `apps/umi-api/src/shared/adapters/email.adapter.ts`              | Existe envío SMTP con remitente y dirección de respuesta configurables. El VPS tiene Brevo configurado; falta validar la entrega y la operación por negocio. |
| `packages/contract`                                              | Mantiene los contratos compartidos. Los cambios del backend, Dashboard y POS deben partir de contratos compatibles.                                          |

### Runtime y esquema de producción

| Fuente                                            | Hecho observado                                                                                                                                             | Consecuencia para el plan                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `dist/modules/table-order/table-order.service.js` | Conserva el rechazo `VARIANT_NOT_AVAILABLE`.                                                                                                                | El menú requiere soporte de variantes con validación del servidor.                                                                     |
| `dist/shared/orders/order-writer.js`              | Registra el evento `placed` y llama a `projectKitchenOrder` sin una condición de aceptación.                                                                | Crear un pedido pendiente requiere controlar la proyección en el backend. Una etiqueta en el POS no retrasa el KDS.                    |
| `merchant.customer_order`                         | Tiene `source`, `fulfillment_type`, `status`, `version`, `pickup_person` y `source_context`, entre otras columnas.                                          | Revisar los contratos existentes antes de elegir campos nuevos.                                                                        |
| Restricciones de `customer_order`                 | Origen: `whatsapp`, `pos`, `web`, `dashboard`. Modalidad: `pickup`, `dine_in`, `delivery`. Estado: `placed`, `preparing`, `ready`, `completed`, `canceled`. | Los estados funcionales del borrador todavía no tienen una correspondencia técnica aprobada.                                           |
| Columnas de `customer_order`                      | No hay una columna dedicada al correo ni un estado dedicado a aceptación o programación en la lista anterior.                                               | Esto no prueba que falte almacenamiento relacionado en otras tablas. Inspeccionar las relaciones antes de diseñar una migración.       |
| Tablas relacionadas                               | Existe `runtime.outbox_event`.                                                                                                                              | Revisar su productor, consumidor y política de reintentos antes de diseñar avisos por eventos. Su existencia no prueba entrega fiable. |
| Configuración de correo                           | Brevo por SMTP, puerto 587; credenciales y remitente presentes. Dominio del remitente: `umiconsulting.co`.                                                  | Reutilización propuesta; entrega, respuestas y rebotes todavía sin validar. No se registran credenciales en este documento.            |

Los hechos anteriores provienen de código y metadatos observados. La reutilización del escritor, el proyector y el adaptador es una inferencia para Umi. Cada implementación debe comprobar su compatibilidad.

## Secuencia de PRs atómicos propuesta

Los identificadores de esta tabla son referencias del plan, no números de GitHub. Las dependencias son mínimas y transitivas. Cada PR tendrá una descripción propia, su plan técnico y comprobaciones del comportamiento que entrega.

| ID  | Objetivo único del PR                                                                | Depende de              | Comprobación de aceptación                                                                                                                   |
| --- | ------------------------------------------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P00 | Documentar alcance, evidencia, pendientes y división de entregas.                    | —                       | Solo documentación; referencias válidas y reglas coherentes.                                                                                 |
| P01 | Persistir publicación y recepción de pedidos por negocio y sucursal mediante la API. | P00                     | Permisos y aislamiento; pausar pedidos conserva el menú y los pedidos existentes. Incluye contrato y migración si se necesitan.              |
| P02 | Persistir visibilidad y modalidades permitidas de cada producto.                     | P01                     | Una regla de un negocio no altera otro; el servidor rechaza productos excluidos.                                                             |
| P03 | Admitir variantes en el pedido público existente de mesa.                            | P00                     | Precio, modificadores y combinación de variante válidos; reintentos sin duplicados; mesa y sucursal correctas.                               |
| P04 | Exponer el catálogo público de una sucursal con sus reglas de publicación.           | P02, P03                | Solo datos públicos; precios y opciones canónicos; sin acceso cruzado a negocios.                                                            |
| P05 | Administrar publicación y contenido desde Menú digital en Dashboard.                 | P01, P02, P04           | Recorrido real en navegador; alcance de cada ajuste visible; uso del catálogo existente.                                                     |
| P06 | Registrar y resolver la aceptación de una recogida inmediata en la API.              | P01, P02, P03           | Pendiente sin KDS; aceptar envía una vez; rechazar o vencer impide el envío. Incluye contactos, origen, contratos y persistencia necesarios. |
| P07 | Consultar un pedido mediante su enlace privado.                                      | P06                     | Acceso limitado a ese pedido; estados coherentes; sin enumeración ni exposición del historial del cliente.                                   |
| P08 | Resolver cancelaciones directas y solicitudes de cancelación en la API.              | P06, P07                | Aceptar y cancelar simultáneamente produce un resultado válido; una solicitud pendiente no cambia el pedido a cancelado.                     |
| P09 | Atender y cobrar recogidas inmediatas desde UmiPOS.                                  | P06, P08                | Recorrido nativo de aceptación, rechazo, cancelación y cobro; alerta de pendientes; mismo pedido comercial.                                  |
| P10 | Mostrar el catálogo público con el diseño de Umi.                                    | P04                     | Navegación real en celular y escritorio, variantes y estados de disponibilidad; capturas revisables.                                         |
| P11 | Enviar un carrito desde el QR de mesa.                                               | P03, P10                | Mesa correcta, total validado, aviso al personal y reparto a estaciones; reintento sin duplicados.                                           |
| P12 | Enviar y seguir una recogida inmediata desde el menú.                                | P07, P08, P09, P10      | Nombre, teléfono y correo sin OTP; recepción pendiente explícita; seguimiento y cancelación según estado.                                    |
| P13 | Emitir avisos por correo sobre los eventos del pedido.                               | P06, P08                | Identidad del negocio, destinatario y enlace correctos; reintentos controlados; un fallo no altera el pedido.                                |
| P14 | Reservar y liberar pedidos programados desde el backend.                             | P06, P08, P13           | Una hora válida para todo el carrito; aceptación sin KDS anticipado; cancelación y liberación concurrentes sin duplicados.                   |
| P15 | Configurar reglas de programación desde Dashboard.                                   | P05, P14                | Horarios, anticipación, horizonte y cancelación por sucursal y producto; errores visibles en navegador real.                                 |
| P16 | Atender pedidos programados desde UmiPOS.                                            | P09, P14                | Aceptación con hora visible; separación entre reservado y en preparación; recuperación tras desconexión.                                     |
| P17 | Elegir y seguir una recogida programada desde el menú.                               | P12, P14, P15, P16      | Carritos mixtos, cierres y zona horaria correctos; fecha y límite de cancelación claros.                                                     |
| P18 | Administrar los enlaces y QR desde Dashboard.                                        | P05, P11                | Cada QR apunta al negocio, sucursal y mesa correctos; se conserva el control existente de las credenciales.                                  |
| P19 | Preparar la configuración versionada de publicación del menú en Cloudflare.          | P11, P12, P13, P17, P18 | Vista previa con rutas estables; configuración de entorno y procedimiento de reversión revisables.                                           |

P06 incluye las transiciones y la condición que permite enviar a cocina porque juntas definen la aceptación. P14 extiende ese mismo ciclo para la programación. Ambos PRs deben conservar los flujos actuales de mesa y POS. No cambiar globalmente la proyección de todos los canales.

P14 incluye los contratos y la persistencia de las reglas de programación. P15 y P16 consumen esos contratos sin introducir estados incompatibles. P14 adapta los avisos de P13 y prueba la hora de los pedidos programados. P17 comprueba esos avisos durante el recorrido completo del cliente.

Antes de P06 y P08, cerrar los efectos sobre inventario y la relación con el cobro existente. Antes de P14, cerrar el cálculo de preparación y la opción fuera de horario. Estas decisiones no se aplazan hasta el piloto.

La activación pública requiere todas las dependencias de su modalidad. Cada PR conserva desactivado el acceso a los recorridos incompletos. El despliegue y la activación del piloto requieren una decisión posterior; P19 solo prepara el cambio revisable.

### Comprobaciones y reversión de cada entrega

- API y contratos: probar permisos, aislamiento, reintentos y compatibilidad con los consumidores actuales.
- Migraciones: probar una base nueva y una base con datos sintéticos existentes. Comprobar la definición de las restricciones.
- Pedidos: probar PostgreSQL real y las acciones simultáneas de aceptación, cancelación y liberación.
- Interfaces: comprobar los recorridos en navegador real y UmiPOS nativo, según [el playbook local](../development/LOCAL_VERIFICATION_PLAYBOOK.md).
- Correo: usar un receptor local de pruebas. Validar después la entrega con destinatarios autorizados antes del piloto.
- Reversión: detener entradas nuevas sin borrar pedidos; preservar las cancelaciones, cobros y tareas pendientes.
- Compatibilidad: registrar qué versiones pueden leer los datos nuevos antes de proponer una vuelta a la versión anterior.

El plan técnico de cada PR concretará los comandos y las pruebas existentes que necesita. Este borrador no inventa firmas de métodos, nombres de migraciones ni valores de configuración.

## Decisiones pendientes y momento de cierre

1. Elegir el negocio y la sucursal del piloto.
2. Cargar sus valores de aceptación, horarios, anticipación y cancelación. No usar los valores ficticios de Bruma.
3. Antes de P14, definir la duración de preparación para cantidades y carritos mixtos. El personal debe poder comprobar si cumple la hora antes de aceptar.
4. Antes de P06 y P08, confirmar cuándo se reserva o descuenta inventario y cómo se registran cancelaciones después de preparar.
5. Antes de activar avisos, validar la entrega del correo, el remitente por negocio y el tratamiento de respuestas y rebotes. Brevo configurado no equivale a entrega comprobada.
6. Confirmar dominio y ruta pública en Cloudflare. Conservar los enlaces y QR al actualizar el sitio.
7. Antes de P14, confirmar si se permitirá programar fuera del horario de atención y cómo se configura esa opción.
8. Antes de habilitar pedidos inmediatos, definir cómo se detecta que no hay personal o dispositivos disponibles. La detección y la pausa deben tener una prueba operativa.

## Casos que debe cubrir la validación

- Un QR de una sucursal no permite pedir en otra mesa, sucursal o negocio.
- Un producto oculto, agotado o no permitido para esa modalidad no puede enviarse modificando el formulario.
- Las variantes y extras cambian correctamente el total y se muestran en POS y KDS.
- Un reintento por pérdida de conexión devuelve el mismo pedido.
- Aceptar y cancelar al mismo tiempo no deja un pedido cancelado en preparación.
- Un programado cancelado no reaparece en el KDS cuando llega la hora prevista.
- Los cierres y la zona horaria producen horarios válidos y comprensibles para el cliente.
- Una pausa no cancela pedidos aceptados ni modifica silenciosamente otros canales.
- “Listo” requiere que terminen todas las estaciones.
- El cobro y la entrega usan el pedido existente.
- Un correo fallido no altera la aceptación, preparación o cancelación.
- Un dato de contacto escrito no permite consultar el historial de otro cliente.

## Límite del trabajo realizado

Existe una maqueta local, una revisión del VPS de solo lectura y este borrador. La integración, los contratos nuevos y la publicación del menú todavía no están implementados. Este PR no contiene cambios de aplicación ni habilita correos, pedidos o despliegues.

La preparación usa Git `2.50.1` para aislar la rama y GitHub CLI `2.92.0` para revisar el PR. La validación documental usa Prettier `3.9.4`, declarado en `package.json`, y `git diff --check`. El procedimiento de GitHub sigue la regla del repositorio sobre [elementos de trabajo y PRs](../agents/issue-tracker.md).
