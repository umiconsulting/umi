# Opciones actuales de UMI POS

Auditoría de código del 1 de noviembre de 2026. Alcance: Caja, hardware y preferencias de pantalla.

El rediseño puede conservar los flujos actuales de Caja y agrupar hardware y preferencias en Ajustes. Esa agrupación es una propuesta.

## Método y límites

- **Hecho documentado:** fuente primaria local: `/Users/moon/Documents/umi`, commit `dea2dfc7`.
- Herramienta: ripgrep 15.2.0, con lecturas acotadas mediante `sed` y `nl`. No se añadió una dependencia.
- Se aplicó el procedimiento de investigación del repositorio. Se revisaron las superficies Flutter, traducciones y controladores relacionados.
- **UNVERIFIED:** este informe no verifica el comportamiento en una terminal nativa ni una impresora o un cajón físicos.
- **UNVERIFIED:** los permisos y las políticas de la sucursal actual no se consultaron al servidor.
- Las recomendaciones de maqueta se marcan como **inferencia**. No implican una función nueva del POS.
- La skill `product-feature-review` requerida por `AGENTS.md` no se encontró durante la revisión previa; el agente principal conoce esta limitación.

## Caja: controles que debe conservar la maqueta

**Hechos documentados.** Los controles dependen del estado y de los permisos. La tabla describe sus condiciones principales.

P0 significa esencial para representar el flujo completo. P1 significa una operación secundaria o de recuperación. La prioridad es una **inferencia**.

| Prioridad | Etiqueta actual | Condición principal | Datos o acción |
| --- | --- | --- | --- |
| P0 | Abrir turno de caja | `open_shift` y `cash.shift.open` | Caja asignada, Fondo inicial por denominación y total. |
| P0 | Entrada de efectivo | `movement` y `cash.movement.paid_in` | Importe del movimiento y Motivo del movimiento. |
| P0 | Salida de efectivo | `movement` y `cash.movement.paid_out` | Los mismos campos. Reduce el efectivo esperado. |
| P0 | Retiro a caja fuerte | `movement` y `cash.movement.safe_drop` | Los mismos campos. Reduce el efectivo esperado. |
| P0 | Solicitar apertura de cajón | `no_sale` y `cash.drawer.no_sale` | PIN gerencial. Motivo interno fijo: `operator_request`. |
| P0 | Iniciar conteo ciego / Contar el cajón | `count` y `cash.count.submit` | Denominaciones o total, según política. |
| P0 | Motivo de la diferencia | Conteo existente, `resolve_variance`, sin resolución y `cash.reconcile` | Motivo y PIN si la diferencia requiere aprobación. |
| P0 | Conciliar turno | `reconcile`, `cash.reconcile`, diferencia resuelta o cero | Compara esperado y contado. |
| P0 | Cerrar turno | Conciliación existente, `close` y `cash.shift.close` | Confirmación final; PIN si la conciliación lo exige. |
| P1 | Suspender turno | `suspend` y `cash.shift.suspend` | Suspende el turno. |
| P1 | Reanudar turno | `resume` y `cash.shift.resume` | Reanuda el turno. |
| P1 | Entregar turno | `handoff` y `cash.shift.handoff` | PIN del operador entrante. |
| P1 | Iniciar reconteo | Conteo existente, `count` y `cash.count.recount` | Nuevo conteo según política. |
| P1 | Cancelar conteo y volver a abierto | `cancel_count` y `cash.count.submit` | Confirma; conserva el conteo en el historial. |
| P1 | Traer el turno a esta terminal | `adopt_shift` y `cash.shift.resume` | Recupera un turno adoptable. También sustituye la etiqueta de reanudación para `operator_mismatch`. |
| P1 | Liberar la caja | Caja recuperable y `cash.shift.open` | Recupera la caja que identifica el servidor. |

Fuentes: [apertura y recuperación](../../umi/apps/umi-pos/lib/features/cash/cash_surface.dart:981), [acciones y permisos](../../umi/apps/umi-pos/lib/features/cash/cash_surface.dart:1480), [diálogos](../../umi/apps/umi-pos/lib/features/cash/cash_surface.dart:2443), [etiquetas](../../umi/apps/umi-pos/lib/core/localization/app_es.arb:327).

### Apertura

**Hechos documentados:**

1. El operador selecciona la Caja asignada.
2. Cuenta el Fondo inicial por denominación.
3. El sistema presenta el total contado.
4. El botón «Abrir turno de caja» espera una caja, permiso y acción permitida.
5. La política puede exigir un fondo mayor que cero y definir un fondo máximo.

La pantalla advierte si la caja pertenece a una terminal que ya no existe. El aviso precede a la apertura.

Fuente: [formulario de apertura](../../umi/apps/umi-pos/lib/features/cash/cash_surface.dart:1247).

**Inferencia para la maqueta:** mostrar una apertura corta, con caja y conteo en la misma vista. Mantener visible el total junto al botón.

### Movimientos y cajón

**Hechos documentados:**

- Los movimientos piden importe válido y motivo obligatorio, con un máximo de 80 caracteres.
- «Confirmar movimiento de caja» envía la operación.
- El umbral de aprobación es inclusivo: se solicita PIN cuando el importe alcanza o supera el umbral.
- Si falta el umbral, el controlador requiere aprobación.
- El aviso presenta el umbral antes de pedir el PIN.
- La aprobación presenta operación, importe, motivo, caja y efectivo esperado antes y después, cuando esos datos existen.
- Si el servidor rechaza el movimiento, el diálogo conserva el importe y el motivo.
- «Entregar turno» pide el PIN entrante. El texto dice: «El turno pasa al operador entrante. El cajón no se mueve.»

Fuentes: [movimiento y entrega](../../umi/apps/umi-pos/lib/features/cash/cash_surface.dart:2472), [umbral](../../umi/apps/umi-pos/lib/features/cash/cash_controller.dart:667), [textos](../../umi/apps/umi-pos/lib/core/localization/app_es.arb:930).

**Hecho documentado: la solicitud de apertura sí tiene una ruta de hardware.**

1. «Solicitar apertura de cajón» pide aprobación gerencial.
2. El controlador registra la operación autorizada.
3. Después del registro, ejecuta una acción de hardware asociada al movimiento.
4. El servicio busca un cajón habilitado y asignado a la terminal y caja correspondientes.
5. Si encuentra el cajón adecuado, envía `open_drawer`.
6. La falta de respuesta puede mostrar: «El cajón no respondió. La operación quedó registrada; ábrelo a mano y avisa al encargado.»

El callback admite una lista vacía de resultados. La ausencia del aviso no demuestra que un cajón físico abrió.

La traducción «La solicitud se registró. No se verificó una operación de hardware.» existe, pero no tiene uso visible en este flujo.

Fuentes: [PIN y solicitud](../../umi/apps/umi-pos/lib/features/cash/cash_surface.dart:2443), [registro y callback](../../umi/apps/umi-pos/lib/features/cash/cash_controller.dart:1069), [composición](../../umi/apps/umi-pos/lib/bootstrap/composition_root.dart:336), [selección del cajón](../../umi/apps/umi-pos/lib/features/hardware/hardware_service.dart:1423), [aviso](../../umi/apps/umi-pos/lib/features/cash/cash_controller.dart:1359).

**Inferencia para la maqueta:** representar «Operación registrada» y «Cajón sin respuesta» como resultados distintos. Una simulación no debe afirmar apertura física verificada.

### Cierre

**Hecho documentado:** la interfaz actual ya usa una secuencia con un solo siguiente paso principal.

`Conteo → Motivo de la diferencia, si existe → Conciliar turno → Cerrar turno`

- El conteo ciego oculta el esperado hasta enviar el conteo.
- `countMethod == total_only` pide un total; el resto usa denominaciones.
- La política determina el conteo ciego. No es una elección del cajero durante el cierre.
- El botón de envío actual requiere un total mayor que cero.
- Los motivos son «Sin diferencia», «Error de conteo», «Error de cambio», «Error de manejo de efectivo» y «Diferencia operativa».
- La resolución puede pedir PIN gerencial.
- La confirmación final muestra esperado, contado y diferencia.
- «¿Cerrar este turno de caja?» advierte que el cierre es definitivo.
- El estado «Listo para cerrar» sustituye «Se requiere conciliación» cuando ya existe conciliación.
- El turno cerrado conserva el resumen y deja de ofrecer acciones del cierre.

Fuentes: [secuencia y siguiente acción](../../umi/apps/umi-pos/lib/features/cash/cash_surface.dart:1539), [conteo](../../umi/apps/umi-pos/lib/features/cash/cash_surface.dart:2696), [resolución y cierre](../../umi/apps/umi-pos/lib/features/cash/cash_surface.dart:2855), [estado](../../umi/apps/umi-pos/lib/features/cash/cash_surface.dart:317).

**Inferencia para la maqueta:** conservar la secuencia y un botón principal. Mostrar reconteo y cancelación como acciones secundarias.

### Datos y estados

**Hechos documentados.** La pantalla dispone de:

- Caja, fecha operativa, hora de apertura y última lectura.
- «La cuenta del cajón», «Libro del turno», «Arqueo del cajón» y resumen del turno anterior.
- «Política de la caja»: conteo, tolerancia, fondo máximo, umbrales de PIN y disponibilidad del efectivo sin conexión.
- «Turno abierto», «Turno suspendido», «Conteo de efectivo en curso», «Se requiere conciliación», «Listo para cerrar» y «Turno cerrado».
- Aviso por turno abierto de un día anterior.
- «Solo consulta» cuando no existen acciones disponibles para el operador.
- «La política de caja venció», que bloquea las operaciones de caja hasta disponer de una política vigente.
- «No se pudo leer el cajón», con reintento.
- Recuperación de turno en otra terminal o caja retenida por una terminal ausente.

El efectivo sin conexión se presenta como «Requiere conexión» o «No disponible aún». No debe representarse como una operación disponible.

Fuentes: [estados y selección de pantalla](../../umi/apps/umi-pos/lib/features/cash/cash_surface.dart:110), [resumen y libro](../../umi/apps/umi-pos/lib/features/cash/cash_surface.dart:1595), [consulta](../../umi/apps/umi-pos/lib/features/cash/cash_surface.dart:1758), [política](../../umi/apps/umi-pos/lib/features/cash/cash_equation.dart:449), [textos](../../umi/apps/umi-pos/lib/core/localization/app_es.arb:893).

**Inferencia para la maqueta:** priorizar cuenta, movimientos y libro. Mantener cierre y custodia en un área separada. Mostrar la política como información consultable.

## Hardware

### Controles visibles

**Hechos documentados:** el «Centro de hardware» tiene «Dispositivos asignados», «Cola de impresión» y actualización manual.

| Prioridad sugerida | Control actual | Permiso o condición | Resultado implementado |
| --- | --- | --- | --- |
| P0 | Buscar impresora USB | `hardware.manage` | Detecta una impresora, la registra o reutiliza y la asigna como principal. |
| P0 | Buscar cajón de la terminal | `hardware.manage` | Comprueba el puerto antes de registrarlo y asignarlo. |
| P0 | Ejecutar prueba | Permiso de prueba del tipo de dispositivo | Envía un diagnóstico y muestra el resultado recibido. |
| P0 | Ajustes de impresora | `hardware.manage`, impresora | Abre preferencias del recibo. |
| P1 | Conexión | `hardware.manage`, impresora con transporte de red | Modifica Host y Puerto. |
| P1 | Configurar | `hardware.manage`, otros dispositivos | Sólo abre configuración para `network_tcp` o `printer_attached`. |
| P1 | Usar como principal | `hardware.assign`, impresora sin esa asignación | Asigna la impresora a esta terminal y caja. |
| P1 | Asignar aquí | `hardware.assign`, otro dispositivo sin esa asignación | Asigna el dispositivo. |
| P1 | Activar / Desactivar | `hardware.manage` | Cambia su estado habilitado. |
| P1 | Registrar dispositivo | `hardware.manage` | Registro manual. |

Los permisos de prueba son `hardware.printer.test`, `hardware.drawer.test`, `hardware.scanner.test` y `hardware.customer_display.test`.

Fuentes: [acciones generales](../../umi/apps/umi-pos/lib/features/hardware/hardware_surface.dart:209), [tarjetas y permisos](../../umi/apps/umi-pos/lib/features/hardware/hardware_surface.dart:309), [configuración](../../umi/apps/umi-pos/lib/features/hardware/hardware_surface.dart:733).

### Impresora de recibos

**Hechos documentados:**

- La búsqueda USB prefiere una Epson entre las detectadas; si no existe, selecciona la primera.
- El registro USB crea una impresora con capacidades de recibo, imagen, QR, corte y página de prueba.
- Si no detecta una impresora, solicita revisar el cable y volver a intentar.
- La búsqueda USB no pide Host, Puerto ni tipo de transporte.
- «Ajustes de impresora» sólo presenta «Imprimir el recibo al cobrar» y «Copias por recibo» con valores 1, 2 y 3.
- Esos ajustes actualizan una política de hardware. No constituyen preferencias independientes por cada impresora.
- Los campos de apertura automática del cajón, apertura sin venta, escáner y pantalla del cliente se conservan, pero permanecen ocultos.
- El ancho de recibo, codificación y tiempos existen en la configuración, pero este diálogo no ofrece controles para editarlos.

Fuentes: [búsqueda USB](../../umi/apps/umi-pos/lib/features/hardware/hardware_surface.dart:499), [actualización de política](../../umi/apps/umi-pos/lib/features/hardware/hardware_surface.dart:771), [ajustes visibles](../../umi/apps/umi-pos/lib/features/hardware/hardware_surface.dart:1298).

**Inferencia para la maqueta:** una tarjeta de impresora puede mostrar conexión, asignación principal, prueba y acceso a preferencias. Mantener Host y Puerto en configuración avanzada.

### Cajón

**Hechos documentados:**

- «Buscar cajón de la terminal» consulta el puerto nativo iMin.
- Si el puerto no está disponible, muestra «Esta terminal no tiene un puerto de cajón que la app pueda usar.»
- Un registro correcto muestra «Puerto del cajón registrado. Conecta el cajón y verifica que abra.»
- Un puerto disponible puede aparecer como «Puerto de la terminal disponible; cajón físico sin verificar».
- En una prueba sin confirmación física, el mensaje dice: «La terminal aceptó el pulso. Verifica que el cajón haya abierto.»
- El registro manual distingue conexión por Red, USB y «Puerto de la terminal (RJ11 iMin)».
- El cajón por Red usa el transporte `printer_attached`; el puerto nativo usa `platform_channel_foundation`.
- Si existe `drawer_unknown`, permiso de prueba y un cajón registrado, aparece «Emitir segunda apertura autorizada».

Fuentes: [registro del puerto](../../umi/apps/umi-pos/lib/features/hardware/hardware_surface.dart:601), [resultado de prueba](../../umi/apps/umi-pos/lib/features/hardware/hardware_surface.dart:450), [estado del puerto](../../umi/apps/umi-pos/lib/features/hardware/hardware_surface.dart:886), [registro manual](../../umi/apps/umi-pos/lib/features/hardware/hardware_surface.dart:1001), [recuperación](../../umi/apps/umi-pos/lib/features/hardware/hardware_surface.dart:276).

**Inferencia para la maqueta:** distinguir «Cajón conectado a impresora» y «Puerto de la terminal» en la presentación. Conservar un estado sin verificar.

### Cola y registro manual

**Hechos documentados:**

- La cola muestra los trabajos recientes primero.
- Tipos: «Recibo», «Copia de recibo» y «Página de prueba».
- Estados: «En cola», «Imprimiendo», «Impreso», «Reintento disponible», «Se requiere una acción», «Cancelado» y «Verifica el recibo físico».
- «Reintentar» requiere `retryable_failure` y `hardware.printer.print`.
- «Reimpresión controlada» requiere `hardware.printer.reprint` y estado `printed`, `terminal_failure` o `unknown_outcome`.
- Las páginas de prueba no admiten reimpresión controlada. Se ejecuta otra prueba desde el dispositivo.
- El registro manual ofrece Impresora, Cajón de efectivo, Escáner de códigos y Pantalla del cliente.
- Pide Fabricante, Modelo y Referencia pública. Red añade Host de red y Puerto de red; el puerto inicial es 9100.
- También ofrece «Usar simulador». La pantalla del cliente usa transporte de simulador en este formulario.

Fuentes: [cola](../../umi/apps/umi-pos/lib/features/hardware/hardware_surface.dart:260), [acciones de recuperación](../../umi/apps/umi-pos/lib/features/hardware/hardware_surface.dart:414), [estados](../../umi/apps/umi-pos/lib/features/hardware/hardware_surface.dart:908), [registro](../../umi/apps/umi-pos/lib/features/hardware/hardware_surface.dart:975).

**Inferencia para la maqueta:** conservar las diferencias entre prueba, reintento seguro y reimpresión. Un estado desconocido requiere revisión del recibo físico.

## Preferencias de pantalla y sesión

**Hechos documentados:** estas preferencias se guardan en la terminal y se aplican a todos sus operadores.

| Sección | Opciones actuales |
| --- | --- |
| Apariencia | Seguir al sistema, Clara, Oscura, Medianoche. |
| Tamaño del texto | Seguir al sistema, Grande, Muy grande. |
| Idioma | Seguir al sistema, Español, English. |
| Movimiento | Seguir al sistema, Reducido. |
| Sesión del operador | Bloquear operador, Cerrar sesión. |

La superficie presenta «Guardando preferencias…» y errores de lectura o escritura. Deshabilita las selecciones durante el guardado.

El código actual abre Hardware desde el menú de acciones. Ajustes usa una superficie propia con estas preferencias.

Fuentes: [preferencias](../../umi/apps/umi-pos/lib/features/settings/display_settings_surface.dart:30), [etiquetas](../../umi/apps/umi-pos/lib/core/localization/app_es.arb:1139), [texto](../../umi/apps/umi-pos/lib/core/localization/app_es.arb:1190), [sesión](../../umi/apps/umi-pos/lib/core/localization/app_es.arb:67), [entrada a Hardware](../../umi/apps/umi-pos/lib/features/catalog/catalog_surface.dart:2288), [entrada a Ajustes](../../umi/apps/umi-pos/lib/features/catalog/catalog_surface.dart:2556).

**Inferencia para la maqueta:** reunir «Pantalla», «Impresora», «Cajón» y «Sesión» dentro de Ajustes puede facilitar su acceso. Es una reorganización propuesta.

## Límites de fidelidad para el prototipo

**Inferencias derivadas de la auditoría:**

- Simular los estados y las transiciones de Caja con datos locales identificados como ejemplo.
- Conservar los permisos, los motivos, los umbrales y la secuencia de cierre en los escenarios de prueba.
- Mantener la cuenta y el libro visibles cuando el operador sólo puede consultar.
- Representar la cola de impresión y su recuperación sin afirmar una impresión física.
- Mostrar sólo los dos ajustes de recibo que la superficie actual permite editar.
- Marcar cualquier agrupación, etiqueta nueva o capacidad adicional como propuesta.
- Mantener los controles financieros en Caja. Barra y Cocina conservan sus tareas de preparación conforme al alcance indicado por el usuario.

**UNVERIFIED:** una maqueta web no prueba el runtime nativo, las políticas del servidor ni el hardware. Este informe no cambia el POS nativo.


## Corrección del conteo en la maqueta

El pase de móvil reemplaza el importe total fijo por la política de ejemplo ciega y por denominaciones. Incluye los once valores MXN de `denomination_counter.dart`, cantidades de hasta tres dígitos, pasos +/−, subtotales y total acumulado. La moneda menor es $0.50. El esperado se oculta hasta enviar el conteo. El preset visible conserva la alternativa `total_only`; la maqueta no afirma conocer la política vigente de una caja real. El cierre conserva reconteo, resolución de diferencia, conciliación y confirmación. Volver al turno no cancela silenciosamente un conteo ya enviado; cancelar requiere una acción explícita y deja constancia local.

Fuentes: [política y diálogo de conteo](../../umi/apps/umi-pos/lib/features/cash/cash_surface.dart:2715), [denominaciones MXN](../../umi/apps/umi-pos/lib/features/cash/denomination_counter.dart:13), [cantidades y controles](../../umi/apps/umi-pos/lib/features/cash/denomination_counter.dart:292).

## Operaciones reproducidas localmente el 2 de noviembre

Esta adenda amplía la revisión de Caja, hardware y preferencias con las operaciones del catálogo, las mesas y el cobro. Describe código del prototipo local; no confirma API, terminal nativa, políticas vigentes ni hardware.

| Flujo del producto actual | Simulación incorporada | Fuente primaria |
| --- | --- | --- |
| Rondas de comanda | Agregar y repetir después del envío crea líneas nuevas. Cada envío incluye sólo las pendientes; las cantidades enviadas no se editan. El Latte conserva nota, cantidad y tiempo de servicio. | [Líneas nuevas tras enviar](../../umi/apps/umi-pos/lib/features/catalog/catalog_surface.dart:5454), [repetir línea](../../umi/apps/umi-pos/lib/features/catalog/catalog_surface.dart:5583). |
| Cancelar un producto enviado | Motivos de cambio del cliente, error de captura, duplicado u otro. Si su estación empezó a preparar, requiere PIN gerencial de ejemplo `4826`. El motivo queda visible y el producto deja de contribuir al consumo. | [Cancelación y autorización](../../umi/apps/umi-pos/lib/features/catalog/catalog_surface.dart:5102). |
| Abrir y retomar cuentas | Las seis mesas de ejemplo admiten apertura con número de personas; las cuentas conservan productos y pagos al retomarse. Un nuevo pedido para llevar conserva la cuenta anterior. | [Apertura con personas](../../umi/apps/umi-pos/lib/features/tables/floor_plan_surface.dart:1156), [conservar cuenta anterior](../../umi/apps/umi-pos/lib/features/catalog/catalog_surface.dart:1648). |
| Mover, unir y separar mesas | Mover exige capacidad y destino libre, conserva tiempo/cuenta y deja el origen por limpiar. Unir agrupa mesas libres y personas; separar reparte personas según capacidad y conserva cada cuenta en su mesa. Unir no combina saldos. | [Movimiento y agrupación](../../umi/apps/umi-pos/lib/features/tables/floor_plan_surface.dart:1084), [reparto al separar](../../umi/apps/umi-api/src/modules/table-map/table-map.repository.ts:466). |
| Servicio y limpieza | Tomando pedido, pedido enviado, servida, por cobrar y por limpiar. Retirar un grupo no cobra su cuenta. Una mesa por limpiar ofrece primero marcarla limpia; mover o unir admite el destino por limpiar conforme al contrato actual. | [Acciones por estado](../../umi/apps/umi-pos/lib/features/tables/floor_plan_surface.dart:1312), [estados libres](../../umi/apps/umi-pos/lib/features/tables/table_state_controller.dart:34). |
| Parciales, mezcla y propina | Importe libre o reparto del saldo en 2/3/4 partes; efectivo, terminal externa y transferencia. Propina por importe o porcentaje de la porción sin IVA. Los pagos quedan en un libro local y sólo se finaliza con consumo exactamente cubierto. La transferencia exige folio y confirmación del importe; cambiar el importe invalida esa confirmación. | [Importes, política y saldo](../../umi/apps/umi-pos/lib/features/checkout/partial_checkout_surface.dart:110), [confirmación externa](../../umi/apps/umi-pos/lib/features/checkout/partial_checkout_surface.dart:461). |
| Terminal integrada | Espera, aprobación, rechazo, resultado desconocido y consulta del mismo intento mediante controles explícitos de simulación. Dejar de esperar no cancela el intento ni habilita otro cobro; un rechazo conserva el saldo. La ruta parcial usa terminal externa, como la superficie actual. | [Estado de terminal](../../umi/apps/umi-pos/lib/features/checkout/checkout_surface.dart:1992), [dejar de esperar](../../umi/apps/umi-pos/lib/features/checkout/checkout_surface.dart:3992). |
| Bloqueos financieros | Un pago recibido bloquea cambios de productos. Un cobro incierto bloquea nuevos pagos. Mover una cuenta con pagos parciales o terminal pendiente se rechaza. | [Mutaciones financieras](../../umi/apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts:488), [traslado con pagos](../../umi/apps/umi-api/src/modules/table-map/table-map.repository.ts:350). |
| Registro en Caja | Cada abono en efectivo suma consumo y propina, descontando el cambio entregado. Tarjeta y transferencia no aumentan el efectivo. Los identificadores consumidos se conservan entre cambios de cuenta, rol y turno para impedir registros duplicados. | [Modelo del prototipo](../src/order.ts), [conexión con Caja](../src/main.tsx). |

La política del cobro es un ejemplo local: admite mezcla, propina y los métodos mostrados. `?tenderPolicy=single` representa una sucursal sin mezcla; la cuenta conserva su primer método. El estado local del turno determina la disponibilidad del efectivo. Ninguno de esos valores se obtuvo de una sucursal real.

**Verificación realizada:** `node scripts/pos-model-qa.mjs` y `npm run typecheck` pasaron. Las regresiones incluyen parcial de $50 seguido de intento de quitar un Latte de $90, parcial de $130 seguido de intento de bajar la presentación del Latte a $80, finalización inconsistente y reaplicación de efectivo del turno anterior. Los escenarios de navegador están escritos en `scripts/pos-parity-qa.mjs`; la ejecución final de éstos y la revisión del pie fijo de cobro siguen pendientes.

**Brechas de UI que permanecen:** editor general de variantes/opciones, asignación general de mesa a una cuenta existente, mesas temporales por política, descuentos, recuperación con evidencia de una escritura parcial incierta, centro de ventas/historial, centro de excepciones y reembolsos/anulaciones, clientes/lealtad, inventario del POS y recuperación general. Estas ausencias no autorizan retirar funciones del producto actual. Los controladores, permisos, idempotencia, sincronización, impresión y terminales reales siguen pendientes de integración.
