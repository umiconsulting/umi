# Bitácora de errores de ONCA en producción

Esta bitácora registra los incidentes que afectan ventas reales. Cada entrada separa los hechos comprobados de las hipótesis. El cierre exige comprobar la venta, el dinero y el estado de los dispositivos.

| Número                                         | Fecha local           | Incidente                                                                                                                              | Estado                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [001](./2026-10-24-onca-production-bug-001.md) | 24 de octubre de 2026 | Cuenta 004: terminal cobró MXN 225, POS no creó la venta; se detectaron también las cuentas 005 y 006                                  | Ventas 004, 005 y 006 conciliadas; defectos preventivos abiertos                                                                                                                                                                                                                                 |
| [002](./2026-10-24-onca-production-bug-002.md) | 24 de octubre de 2026 | Barra: una comanda completada en otra terminal puede permanecer en la caché local                                                      | Causa doble corregida en POS 330/API `2f5ea8e6`: caché local y reapertura del ticket durante el cobro. Recibos 0005 y 0024 reparados con auditoría. La venta de prueba 0031 requiere corrección de soporte                                                                                       |
| [003](./2026-10-24-onca-production-bug-003.md) | 24 de octubre de 2026 | Caja principal: la salida de efectivo responde «No se completó la operación»                                                           | Corregido y verificado en producción con una salida y su reversa de MXN 1.00; incluido en POS 330                                                                                                                                                                                                |
| [004](./2026-10-24-onca-production-bug-004.md) | 24 de octubre de 2026 | Caja principal: un cobro en efectivo mostró el mensaje genérico «No fue posible completar el cobro de forma segura»                    | No reproducido después de instalar POS 329; una venta posterior por MXN 180.00 terminó con recibo 0032. POS 330 muestra el motivo real y registra el código técnico                                                                                                                              |
| [005](./2026-10-26-onca-production-bug-005.md) | 26 de octubre de 2026 | Cobro de MXN 545 en terminal sin venta; KDS incompleto; mesas que no se liberan; envío a cocina bloqueado; capturas de errores en caja | API `onca-445bedac` y el código POS corrigen las causas comprobadas. El APK 331 falló al iniciar; el incidente 006 corrige el artefacto. Ocho cuentas del 26 quedaron conciliadas por MXN 2,405; incluye el pago existente de MXN 545. La 011 se canceló y la 037 quedó intacta                  |
| [006](./2026-10-26-onca-production-bug-006.md) | 26 de octubre de 2026 | Las cuatro tabletas detienen UmiPOS en un error de configuración                                                                       | El APK 331 era una build `profile` y no tenía identidad de release. El APK 332 inicia en las cuatro tabletas. Cocina necesita registro; Cajero necesita cerrar una sesión anterior                                                                                                               |
| [007](./2026-10-27-onca-production-bug-007.md) | 27 de octubre de 2026 | Terminales con modos incorrectos, sesión huérfana y firma de producción insegura                                                       | Las cuatro terminales usan el APK 333 y la llave de release nueva. Caja, Barra, Cocina y Mesero tienen el modo correcto. ADB de las cuatro terminales está conectado. Los reinicios iniciales necesitaron permiso local. Umi Support 1.0.1 recuperó ADB automáticamente en el reinicio posterior |
| [008](./2026-10-27-onca-production-bug-008.md) | 27 de octubre de 2026 | Cuenta 016: Caja omite Enviar a cocina y la comanda no llega a Barra                                                                   | Recuperación operativa completada: sesión del Cajero actualizada con el permiso ya autorizado. Una comanda completada en Barra. A las 19:26Z, la 016 seguía abierta y sin pago por MXN 250                                                                                                       |
| [009](./2026-10-27-onca-production-bug-009.md) | 27 de octubre de 2026 | Cuenta 017 para llevar: error transitorio al cobrar seis panes de muerto y dos conchas                                                 | El operador cobró MXN 360 por transferencia, recibo 0015. Un solo pago y una venta. Aviso al confirmar transferencia: causa sin confirmar tras revisar API y comandos; faltan registros del cliente                                                                                              |

| [010](./2026-10-27-onca-production-bug-010.md) | 27 de octubre de 2026 | Cuenta 020: el cobro cambia de MXN 100 a MXN 60 y muestra un rechazo local | Cuenta recuperada y cobrada una sola vez por MXN 100 en efectivo, recibo 0019, saldo cero. Se confirmaron defectos del estado local y la caché. Sync corregido e instalado en las cuatro tablets con build 334; 181 pruebas y CI aprobados; doctor 334 con código 0 |

## Cambios de catálogo del 24 de octubre

Los productos siguientes se crearon y verificaron en el catálogo de producción:

| Producto          | Categoría |    Precio | Estado |
| ----------------- | --------- | --------: | ------ |
| Corico individual | Pan       |  MXN 7.00 | Activo |
| Base de pizza     | Pan       | MXN 50.00 | Activo |

La categoría se comprobó contra el producto existente **Coricos pack**. La
evidencia visual está en
[`products-after.png`](./evidence/2026-10-24-onca-production-catalog/products-after.png).

## Conectividad de soporte remoto

Estado vigente verificado el 27 de octubre de 2026 después de la prueba de Umi Support 1.0.1:

| Dispositivo    | Endpoint dinámico de Tailscale | Estado                                                                           |
| -------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| Caja principal | `100.64.178.95:35049`          | ADB conectado; recuperación automática por Umi Support comprobada en un reinicio |
| Barra          | `100.90.102.41:44965`          | ADB conectado                                                                    |
| Cocina         | `100.125.137.36:35147`         | ADB conectado                                                                    |
| Mesero         | `100.125.102.97:42845`         | ADB conectado                                                                    |

El diagnóstico final de flota terminó con código 0 y build 334 en los cuatro equipos.
El propietario entró en Caja después del reinicio y se observó la pantalla principal.
Los dos reinicios iniciales requirieron intervención física.
Umi Support 1.0.1 resolvió el diálogo en el reinicio posterior y KeepADB publicó el nuevo puerto.
La prueba completa se documenta al final de esta bitácora.
El detalle y la evidencia están en el [incidente 007](./2026-10-27-onca-production-bug-007.md).

La tabla siguiente conserva el estado histórico del 24 de octubre.
El procedimiento vigente usa puertos dinámicos. No se debe fijar el puerto 5555.

| Dispositivo    | IP de Tailscale  | Estado al 24 de octubre, 17:25                             |
| -------------- | ---------------- | ---------------------------------------------------------- |
| Caja principal | `100.64.178.95`  | Histórico: ADB en el puerto `5555`; sustituido por KeepADB |
| Barra          | `100.90.102.41`  | En línea; ADB automático en el puerto `44917`              |
| Cocina         | `100.125.137.36` | Fuera de línea; configuración pendiente                    |
| Mesero         | `100.125.102.97` | En línea; ADB automático en el puerto `35893`              |
| A11 de pruebas | `100.107.181.80` | Fuera de línea después de reiniciar                        |

Tailscale quedó como VPN siempre activa en Caja, Barra y Mesero. Barra y Mesero
también tienen KeepADB con reconexión automática y un webhook privado por
Tailscale que informa a esta computadora cuando Android cambia el puerto ADB.

Sesión de operador comprobada después de instalar POS 330:

| Terminal       | Perfil activo | Estado      |
| -------------- | ------------- | ----------- |
| Caja principal | Cajero ONCA   | Autenticado |
| Barra          | Barista       | Autenticado |
| Mesero         | Mesero 1      | Autenticado |

El 24 de octubre, la prueba de reinicio de Barra confirmó el flujo completo:
Tailscale regresó, Android abrió el puerto `44917` en lugar de `41827`, KeepADB
lo publicó y ADB se reconectó solo. El 26 de octubre, Barra y Caja ya no
ofrecían un puerto ADB. Mesero seguía accesible en el puerto `42845`. El
procedimiento, estado por dispositivo y operación del receptor están documentados en
[`2026-10-24-onca-remote-support-persistence.md`](./2026-10-24-onca-remote-support-persistence.md).

El inventario vigente de KeepADB y la automatización de preparación están en
[`2026-10-26-onca-keepadb-fleet.md`](./2026-10-26-onca-keepadb-fleet.md).

## Hallazgos históricos del soporte del 27 de octubre, antes de Umi Support 1.0.1

- Las cuentas 017, 018, 020, 024, 031, 033, 036 y 038 quedaron conciliadas por MXN 2,405.00.
- La cuenta 018 reutilizó su pago confirmado. Los otros medios y la entrega se registraron con confirmación del propietario.
- Los MXN 295.00 de la 017 ya estaban en el cierre del 26. La recuperación no creó movimientos de efectivo.
- La cuenta 011 estaba vacía. Se canceló por instrucción posterior y T1 quedó liberada. La cuenta 037 conserva su estado anterior.
- La API devolvió cero cuentas abiertas y la pantalla real de UmiPOS confirmó ese estado.
- Las cuatro tablets tienen el APK final 333. El archivo instalado coincide con el APK canónico por SHA-256, firma y versión.
- El diagnóstico de flota terminó con código 0 después de recuperar Caja. El operador entró y se observó la pantalla principal.
- La desconexión del transporte ADB se recuperó sola en 10.04 segundos.
- El primer reinicio de Caja omitió la recuperación por `persisted_intent_off`. La activación desde KeepADB corrigió esa orden.
- El segundo reinicio inició KeepADB, pero Android solicitó otra vez el permiso de red. Las dos pruebas agotaron 210 segundos.
- Android registró `Expected keyStore, but got tag=null`. El almacén serializado contenía la red, pero el arranque volvió a pedir autorización.
- La D3 usa Android 11, firmware `1.0.3.4.23_230926`, dispositivo `rk3566_rgo` y parche `2022-03-05`.
- Tiene `com.neostra.update` 5.28 y `android.rockchip.update.service` 1.8.9. No se inició una actualización.
- No se encontró una corrección oficial confirmada para esa compilación en las fuentes consultadas.
- La opción Transmission Mode no aparece en esta D3. No se aplicó un ajuste desconocido.
- Caja quedó en `100.64.178.95:43761` con ADB activo. Su recuperación automática después de reiniciar sigue pendiente.

El acceso SSH a juan-PC conserva la huella y el machine-id esperados.
Las consultas de producción usaron el VPS `juan@2.24.204.15`, host `srv1774344`,
y el contenedor `umi-api-umi-api-1`.
La configuración local del repositorio apunta a `umi_local` y no representa producción.
La API de producción conserva `onca-445bedac` y el contrato 2.45.0.

Detalles y pruebas:
[conciliación](./2026-10-26-onca-production-bug-005.md),
[flota y reinicios](./2026-10-27-onca-production-bug-007.md),
[inventario KeepADB](./2026-10-26-onca-keepadb-fleet.md) y
[fuentes del diagnóstico](../research/2026-10-27-onca-keepadb-boot-recovery.md).

## Nueva evidencia de firmware y alternativa local

El actualizador ofrece `1.0.6.4.23_241120`, publicado el 22 de noviembre de 2024.
Sus notas sólo indican «Optimization system» y «Minor bug fixes».
No se confirmó que ese paquete ni otra versión del fabricante incluya la corrección de ADB.

Se identificó el parche oficial AOSP `c113a129072f`, bug `236299256`.
El parche corrige la lectura del archivo que conserva las redes Wi-Fi autorizadas.
Su descripción coincide con el fallo observado. La inclusión en la OTA sigue sin verificar.

También se evaluó una alternativa sin actualizar Android.
Un ayudante local de Accesibilidad podría confirmar sólo el diálogo ADB de `UmiPOS`
y del BSSID conocido después de arrancar.
Requiere una activación inicial del servicio en la tablet.
En esa fase, la propuesta aún no estaba construida ni probada.
El resultado posterior de Umi Support 1.0.1 se documenta al final de esta bitácora.

En la investigación inicial no se instaló firmware ni se activó Accesibilidad.
La activación y prueba posteriores de Umi Support se registran al final de esta bitácora.
Detalles y fuentes: [investigación de KeepADB y Android](../research/2026-10-27-onca-keepadb-boot-recovery.md).
Evidencia: [revisión OTA](./evidence/2026-10-27-onca-support/ota-review.json).

## Estado operativo posterior de las cuentas 016 y 017

Verificación: 2026-10-27T19:26:18.987Z.

La cuenta 016 de hoy sigue abierta en Cardón por MXN 250.00, sin pagos.
Su comanda está completada en Barra.
La cuenta 017 para llevar quedó cobrada por MXN 360.00 mediante transferencia, recibo 0015.
La creación y el cobro de la 017 conservaron la 016 pendiente.
Los incidentes 008 y 009 contienen la evidencia y los límites del diagnóstico.

## Investigación posterior del error de transferencia de la 017

El propietario ubicó el aviso al confirmar la transferencia.
La lectura histórica encontró dos rechazos al guardar cuentas y otro al reimprimir.
Ninguno demuestra la causa del aviso de transferencia.
Los dos comandos de checkout de la 017 terminaron correctamente.
El pago sigue documentado una sola vez por MXN 360.00, con recibo 0015.

El código revisado descarta la telemetría del cliente mediante `NoopTelemetryExporter`.
La captura anterior de logcat no conserva el aviso inicial.
La causa sigue sin confirmar; el incidente 009 conserva códigos, correlaciones y límites.
No se repitió un cobro ni se cambió la API o el APK durante esta investigación.

## Umi Support 1.0.1: instalado y recuperación comprobada en Caja

El propietario autorizó instalar y probar Umi Support.
La versión 1.0.0 sobrevivió al reinicio, pero rechazó el botón «PERMITIR».
La etiqueta del recurso era «Permitir» y Android Material la transformó a mayúsculas.
La primera prueba terminó sin ADB después de cuatro minutos y requirió aceptación manual del permiso.

La versión 1.0.1, código 2, corrige esa comparación de presentación.
La red UmiPOS y el BSSID permitido conservan su comparación literal.
Las 48 pruebas, Lint y la verificación de firma pasaron.
La actualización conservó Accesibilidad y la autorización del propietario.

La prueba corregida pasó de boot_count 7 a 8.
Umi Support aceptó el permiso y KeepADB publicó el puerto 35049.
Juan-PC recuperó ADB automáticamente sin introducir un endpoint ni ejecutar adb connect.
El monitor midió 75.1 segundos; el total desde la solicitud de reinicio fue 86.7 segundos.
La captura posterior mostró «Permiso solicitado para la red autorizada».
UmiPOS quedó al frente al terminar.

La recuperación funciona en segundo plano; no requiere dejar abierta la pantalla de Umi Support.
Juan-PC debe permanecer encendido y conectado a Tailscale.
KeepADB debe conservar Mantener siempre activo y el webhook configurado.
Umi Support queda habilitado en Accesibilidad para UmiPOS y BSSID bc:07:1d:ca:ae:61.
La activación inicial del propietario se realizó una vez; la actualización y el reinicio la conservaron.
APK instalado: 1.0.1, código 2, SHA-256 32e7bf83ed3d189f19c943acb613f0709070c8b2839170d6c3caf0b47a98a77d.

El doctor final terminó con código 0 en las cuatro tablets, todas con build 333.
No se modificaron pagos, API, UmiPOS ni firmware.
La prueba cubre el reinicio y la red actuales; no incluye corte eléctrico ni otra red.

Detalle, evidencia y hash: [Umi Support instalado y probado](./2026-10-27-umi-support-android.md).

## Cuenta 020 del 27: pago en efectivo confirmado

La recuperación del proceso conservó el diario y volvió a leer la cuenta desde la API.
El POS registró una sola venta y un solo pago por MXN 100.00, con recibo 0019.
La pantalla mostró Pagado y después No hay cuentas abiertas.
El cobro se completó en la build 333; el hotfix del sync quedó instalado en la build 334.
Detalle, límites y evidencia: [incidente 010](./2026-10-27-onca-production-bug-010.md).

## Build 334 y sync: entrega final

El PR 228 se integró en la rama de soporte de ONCA.
Caja, Barra, Cocina y Mesero tienen la misma build 334, firma de producción y SHA-256 verificado.
Las 181 pruebas y los checks aplicables de CI pasaron.
El doctor de la flota terminó con código 0.
Caja quedó autenticada como Cajero ONCA.
Barra y Cocina cargaron sus KDS; Mesero conservó Mesero 1.

El sync real consultó la API y mantuvo servidor 86, aceptadas 53, conflictos 0 y cola 0.
La lista local mostró No hay cuentas abiertas.
La 020 conserva una venta y un pago de MXN 100.00, recibo 0019.
El pago se registró previamente mediante un clic real en POS 333 y no se repitió.

Código, APK, ZIP de Umi Support, bitácora y evidencia permanecen en juan-PC.
El [resumen final](./2026-10-27-onca-support-handoff.md) contiene rutas, hashes, acceso verificado y límites.

## Mejora del 29 de octubre: tipo de pedido en KDS

El propietario pidió que Barra y Cocina distingan las comandas para comer aquí y
para llevar. Aprobó etiquetas azul y violeta con iconos de mesa y bolsa.

El cambio añade el dato al contrato y a las lecturas del API y LAN. La revisión
también corrigió la modalidad local después de iniciar preparación y protegió
el dato oficial frente a carritos antiguos. Pasaron 99 pruebas del contrato,
135 del API y 142 de Flutter.

El cambio se entrega por PR. La instalación y la prueba real quedan pendientes;
Juan-PC está desconectada. El informe y el procedimiento de validación están en
[`2026-10-29-onca-kds-fulfillment.md`](./2026-10-29-onca-kds-fulfillment.md).
