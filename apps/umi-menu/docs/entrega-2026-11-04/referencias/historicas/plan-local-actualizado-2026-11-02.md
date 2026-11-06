# Borrador del menú digital de Umi

El menú permitirá consultar productos y enviar pedidos a UmiPOS desde un QR de mesa o un enlace para recoger. Cada negocio y sucursal tendrá su configuración. El pago se realizará en el negocio.

Este borrador reúne los acuerdos de la conversación. Describe el producto y el orden de implementación. El plan técnico con contratos, migraciones y tareas ejecutables requiere contrastar la copia local con la versión del VPS.

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

La versión de referencia es `../.superpowers/brainstorm/18629-1793487079/content/menu-v6.html`, junto con `menu-redesign.css`. `menu-v5.html` se conserva como versión anterior. El diseño vigente procede del prototipo local `umipos-redesign`. Incluye la corrección de textos y la eliminación de “Bruma · Centro” sobre “Desayunos y café”. Bruma, sus fotografías, precios y horarios son datos de ejemplo.

El recorrido comprende menú, detalle del producto, carrito, confirmación y seguimiento. La maqueta funciona en memoria y todavía no captura el correo ni envía pedidos reales.

El encabezado identifica al negocio y la sucursal. Un QR de mesa identifica también la mesa. Un enlace general permite consultar el menú y pedir para recoger en la sucursal correspondiente.

## Identificación y contacto

| Modalidad | Datos del cliente |
| --- | --- |
| Mesa con QR | La credencial del QR identifica la mesa. No exigir cuenta, teléfono ni correo para enviar el pedido. |
| Para recoger | Solicitar nombre, teléfono y correo. No exigir cuenta ni código SMS. |

El teléfono permite que el personal contacte al cliente. El correo recibe avisos y el enlace privado de seguimiento. Mostrar los datos antes de enviar para permitir su corrección.

Capturar un teléfono o correo no verifica la identidad de la persona. No vincular automáticamente el pedido con una cuenta, historial o saldo de otro cliente solo porque coincida un dato escrito.

El enlace de seguimiento permite consultar únicamente ese pedido. No debe permitir enumerar pedidos ni consultar otros negocios.

## Operación por modalidad

### Mesa

1. Resolver negocio, sucursal y mesa a partir del QR válido.
2. Validar que la mesa admite pedidos según su estado operativo.
3. Validar productos, opciones, cantidades y precios en el servidor.
4. Registrar el pedido y enviarlo a las estaciones correspondientes del KDS.
5. Mostrar el pedido en UmiPOS, asociado a la mesa y con origen digital.
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

| Condición | Uso |
| --- | --- |
| Anticipación mínima para pedir | Determina con cuánto tiempo debe encargarse el producto. |
| Tiempo de preparación | Determina cuándo debe liberarse un pedido aceptado al KDS. |
| Límite de cancelación | Determina hasta cuándo puede cancelarlo directamente el cliente después de aceptado. |

Cada pedido tiene una sola fecha y hora de recogida. Si mezcla productos, ofrecer únicamente horarios compatibles con todos. Aplicar el plazo mínimo más exigente y el horizonte permitido más corto.

El límite de cancelación directa debe terminar como máximo al liberar el pedido a preparación. Mostrar al cliente una fecha y hora concretas antes de confirmar.

Usar la zona horaria de la sucursal. Respetar los horarios de recogida, cierres y excepciones del calendario.

Se propone que el negocio pueda permitir pedidos programados fuera del horario de atención. Esta opción requiere confirmación antes de implementarla. En ese caso, mostrar cuándo vuelve a atender. El plazo de aceptación empieza en la siguiente apertura válida. No ofrecer una recogida que deje al negocio sin tiempo para revisar y preparar el pedido.

Los minutos y días usados en la maqueta son ejemplos, no valores globales aprobados.

## Cancelaciones

| Situación | Acción del cliente |
| --- | --- |
| Recogida pendiente de aceptación | Cancelación directa. |
| Recogida inmediata aceptada | Solicitar cancelación al personal. |
| Programado aceptado, antes del límite y sin liberar a preparación | Cancelación directa. |
| Programado fuera del límite o liberado a preparación | Solicitar cancelación al personal. |
| Mesa enviada a preparación | Solicitar cancelación al personal. |

Una solicitud no equivale a un pedido cancelado. Mostrar “Esperando respuesta del negocio” hasta que el personal resuelva.

La aceptación y la cancelación simultáneas deben tener un único resultado válido. La misma regla aplica a cancelar mientras el sistema libera un pedido programado.

Cuando el personal autorice una cancelación, el cambio debe llegar al POS y a las estaciones afectadas. Los efectos sobre inventario y preparación deben seguir las reglas existentes de Umi, que se contrastarán antes de implementar.

No aplicar cargos automáticos por cancelación. El pago ocurre en el negocio.

## Umi Dashboard

Agregar “Menú digital” junto a Productos. Mantener visibles el negocio y la sucursal seleccionados.

| Área | Contenido |
| --- | --- |
| General | Publicación, modalidades habilitadas, vista previa y pausa de nuevos pedidos. |
| Contenido | Selección de productos, orden de categorías y destacados. Accesos a la edición del catálogo existente. |
| Pedidos y programación | Plazo de aceptación, programación, cancelaciones y acceso a horarios de la sucursal. |
| Enlaces y QR | Enlace público, QR general y QR de las mesas existentes. |

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

| Evento | Contenido del aviso |
| --- | --- |
| Pedido enviado para recoger | Número del pedido, resumen y aclaración de que espera aceptación. |
| Pedido aceptado | Confirmación y hora de recogida. |
| Pedido listo | Sucursal y número para recoger. |
| Rechazo, cancelación o vencimiento | Resultado y motivo correspondiente. |

Cada correo identifica al negocio y contiene el enlace de seguimiento. Para un pedido fuera de horario, el aviso inicial indica cuándo empezará la atención.

El seguimiento web debe funcionar aunque falle el correo. Registrar fallos de envío y permitir su atención sin crear otro pedido ni revertir una aceptación.

El proveedor que acepta un correo no garantiza que este llegue a la bandeja de entrada o sea leído. No presentar un correo como entregado basándose únicamente en que el adaptador devolvió un identificador de envío.

Reutilizar el adaptador de correo existente si la revisión de producción confirma que es adecuado. Validar remitente, dominio, respuesta al negocio y tratamiento de errores antes del piloto. Los correos de pedido no autorizan campañas promocionales.

## Excepciones operativas

| Caso | Comportamiento |
| --- | --- |
| Producto agotado antes de aceptar | Rechazar con un motivo visible para el cliente. |
| Problema después de aceptar | Contactar al cliente y acordar un cambio o una cancelación. |
| Reintento del cliente | Recuperar el resultado del envío anterior sin duplicar el pedido. |
| Sin respuesta del negocio | Aplicar el vencimiento según el horario de atención. |
| Sin dispositivos disponibles durante la atención | Alertar y pausar los nuevos pedidos que requieran atención inmediata. Mantener visibles el menú y el seguimiento. |
| Pedido futuro permitido fuera de horario | Aplicar su regla de espera hasta la apertura. No confundir el cierre previsto con una pérdida de conexión. |
| Pérdida de conexión después de aceptar | Conservar el pedido. Mostrar la incidencia operativa y recuperar el envío pendiente sin duplicarlo. |
| Aviso por correo fallido | Conservar el estado del pedido y registrar el fallo. |
| Cliente que no recoge | El personal marca “No recogido”. No considerarlo una venta cobrada. |

Limitar envíos repetidos para proteger la recepción de pedidos y el servicio de correo. No considerar los datos de contacto escritos como una identidad verificada.

## Base técnica local revisada

La copia local revisada está en `/Users/moon/Documents/umi`, revisión `3d792bdd`. Esta revisión no acredita la versión desplegada.

| Archivo o área | Hecho observado y efecto en el plan |
| --- | --- |
| `apps/umi-api/src/modules/table-order/table-order.controller.ts` | Ya existen rutas públicas para leer el menú de una mesa y crear pedidos con un token. |
| `apps/umi-api/src/modules/table-order/table-order.service.ts` | Reutiliza precios y modificadores; rechaza productos con variantes; envía pedidos mediante el escritor canónico. Hay que cubrir variantes para el menú. |
| `apps/umi-api/src/shared/orders/order-writer.ts` | La creación actual llama al proyector de cocina. La aceptación y programación requieren controlar ese envío desde el backend. |
| `apps/umi-api/src/modules/kds/kitchen-projector.ts` | Es el punto existente de proyección hacia cocina. Evitar crear una segunda fuente de pedidos. |
| `apps/umi-pos/lib/features/cart/incoming_orders_surface.dart` | La acción existente toma un pedido para vincularlo al carrito. No demuestra un flujo de aceptación previa al KDS. |
| `apps/umi-dashboard/src/screens/products-hub.jsx` | Agrupa Productos y Categorías. Mantener ahí la edición del catálogo. |
| `apps/umi-dashboard/src/screens/hours.jsx` | Incluye horarios, zona horaria y una pausa presentada como WhatsApp. Revisar alcance por canal y sucursal. |
| `apps/umi-dashboard/src/screens/orders.jsx` | Muestra estados comerciales y origen. La vista y el contrato deben representar aceptación y programación sin confundirlas con preparación. |
| `apps/umi-api/src/shared/adapters/email.adapter.ts` | Existe envío SMTP con remitente y dirección de respuesta configurables. El proveedor de producción no se confirmó en esta revisión. |
| `packages/contract` | Mantiene los contratos compartidos. Los cambios del backend, Dashboard y POS deben partir de contratos compatibles. |

## Secuencia de implementación propuesta

Cada etapa tendrá su plan técnico y comprobaciones antes de modificar el código correspondiente.

| Etapa | Entrega | Comprobación principal |
| --- | --- | --- |
| 0. Contraste con el VPS | Revisión y esquema vigentes; diferencias respecto a la copia local; estado del correo. | Lectura sin modificar servicios ni enviar correos reales. |
| 1. Configuración y catálogo público | Configuración por negocio y sucursal; catálogo publicado; precios, variantes y modificadores. | Aislamiento entre negocios y validación de opciones y totales. |
| 2. Ciclo de pedidos | Registro, aceptación, rechazo, vencimiento, cancelación y enlace de seguimiento. | Reintentos y acciones simultáneas producen un solo resultado. |
| 3. Programación y preparación | Horarios válidos, liberación diferida y proyección a KDS. | Un programado no llega antes de tiempo; una cancelación evita su liberación posterior. |
| 4. Dashboard y UmiPOS | Controles administrativos y bandeja operativa conectados. | Recorridos reales en navegador y POS nativo, con permisos y sucursal correctos. |
| 5. Menú y correo | Maqueta conectada, captura de correo y avisos por eventos. | El pedido sigue disponible cuando el proveedor de correo falla. |
| 6. Piloto | Publicación en Cloudflare, enlace y QR de una sucursal seleccionada. | Pedido completo desde mesa y recogida, cobrado una sola vez en el negocio. |

## Decisiones que deben cerrarse antes de activar el piloto

1. Elegir el negocio y la sucursal del piloto.
2. Cargar sus valores de aceptación, horarios, anticipación y cancelación. No usar los valores ficticios de Bruma.
3. Definir cómo se calcula la duración de preparación para cantidades y carritos mixtos. El criterio debe permitir al personal comprobar que puede cumplir la hora antes de aceptar.
4. Confirmar cuándo se reserva o descuenta inventario y cómo se registran cancelaciones después de preparar, según las reglas vigentes de Umi.
5. Validar el remitente y la conexión de correo de producción, así como el tratamiento de respuestas y rebotes.
6. Confirmar dominio y ruta pública en Cloudflare. Conservar los enlaces y QR al actualizar el sitio.

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

Existe una maqueta local y esta especificación funcional. La integración, los contratos nuevos y la publicación del menú todavía no están implementados. La revisión del VPS se solicitará antes de cerrar las tareas técnicas.


## Estado para PRs hacia staging · revisión del 2 de noviembre de 2026

Esta sección actualiza la preparación de entrega. No es un plan técnico ejecutable ni autoriza un merge.

### Hechos comprobados

- El prototipo v6 y el recorrido del redesign están publicados en https://umi-stageshow.pages.dev/?app=menu&menuView=tour. Las 70 comprobaciones públicas corresponden al prototipo.
- Git fetch confirmó `origin/staging` en `b3e5bf882372eeb14c3c1b2658a6947df83c5051`. La consulta de GitHub no devolvió PRs abiertos con base staging.
- La revisión ampliada del 1 de noviembre existe en `/private/tmp/umi-menu-plan-20261101/docs/plans/2026-11-01-menu-digital-design.md`. Incluye evidencia de solo lectura del VPS, Brevo configurado y una propuesta P00–P19.
- Esa propuesta todavía cita el menú v5 y las fuentes anteriores. La referencia visual vigente es v6 y el redesign local.
- El usuario descartó el PR dedicado únicamente al plan. La documentación acompañará a cada PR funcional; P00 deja de ser una entrega y una dependencia.
- Existe trabajo local separado del redesign en `/private/tmp/umi-redesign-parity-20261102`. No se modificó ni se consideró integrado en staging.
- No se consultó nuevamente el VPS en esta revisión. La revisión anterior no acredita su estado actual.

### Recomendación para el primer PR

Objetivo único: persistir y consultar la configuración del menú por negocio y sucursal en la API.

Incluir publicación y recepción de pedidos como opciones independientes, permisos y validación del alcance. Incluir contratos, persistencia y migración solamente cuando el comportamiento lo requiera. Probar aislamiento entre negocios y sucursales, valores iniciales y conservación de pedidos al pausar. Mantener compatibles las operaciones actuales y conservar desactivadas las entradas nuevas aún incompletas.

Preparar el cambio en un worktree desde staging actualizado. Completar la implementación y sus pruebas antes de abrir el PR. La documentación y el procedimiento de reversión deben describir ese mismo cambio. Vincular el elemento de Azure Boards cuando esté disponible; el conector no está habilitado en esta sesión.

La interfaz pública, la configuración del Dashboard y la atención del POS se entregan después, en cambios que consuman contratos disponibles. El alcance exacto de cada PR se confirma al revisar su implementación.

### Pendientes por momento de cierre

- Antes del primer PR: actualizar la referencia visual; concretar el dueño de la configuración, los contratos, permisos y la compatibilidad sobre staging. Esta preparación es trabajo técnico local.
- Antes de pedidos y cancelaciones: confirmar efectos sobre inventario, asociación con la cuenta existente y detección de personal o dispositivos disponibles. Comprobar reintentos y acciones simultáneas sobre PostgreSQL real.
- Antes de programación: definir el cálculo de preparación para cantidades y carritos mixtos; confirmar la opción fuera de horario. Los valores se configuran por negocio o sucursal según su alcance.
- Antes del piloto: elegir negocio/sucursal, valores operativos, dominio/rutas y remitente. Comprobar entrega, respuestas y rebotes del correo. Bruma no aporta valores de producción.
- Antes de activar cada modalidad: verificar el pedido completo desde el menú hasta POS, KDS, cobro único, seguimiento y correo. La aceptación mantiene la recogida fuera del KDS hasta que corresponde.

### Fuentes y herramientas

Fuentes: especificación local, revisión documentada del VPS, referencias Git y API de GitHub. Git 2.50.1 y GitHub CLI 2.92.0 ya están instalados y permiten consultas sin interacción. Se usaron por ser las herramientas existentes del repositorio; no requirieron una dependencia nueva. El estado de despliegue y la entrega de correo actuales siguen sin verificar.

La skill research guía la revisión de fuentes. La skill product-feature-review citada por AGENTS.md no se encontró en las ubicaciones locales consultadas; no se le atribuyeron instrucciones. Esta revisión responde sobre preparación y pendientes, sin certificar la implementación del producto.
