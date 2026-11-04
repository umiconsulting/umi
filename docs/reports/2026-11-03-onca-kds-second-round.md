# ONCA: la comanda reaparece al terminar una segunda ronda

Fecha del reporte: 3 de noviembre de 2026. El incidente ocurrió el 2 de noviembre.

## Resultado

El historial y una prueba con PostgreSQL reproducen el mismo rechazo de la API.
La corrección permite terminar la ronda nueva aunque la comanda incluya productos de una ronda terminada.
El despliegue y la prueba en las tablets quedan pendientes de aprobación.

## Síntoma reportado

Barra termina una bebida y la comanda desaparece.
La misma mesa pide otra bebida. Barra termina la ronda nueva, pero la comanda reaparece.
El operador usa Recuperar y Terminar para quitarla.
El propietario no conserva el número de cuenta ni la hora del caso reportado.

## Evidencia de producción

Las consultas usaron `BEGIN READ ONLY` y el rol `worker_login`.
La ventana corresponde al 2 de noviembre en America/Mazatlan: desde `2026-11-02T07:00:00Z` hasta `2026-11-03T07:00:00Z`.

El historial contiene 173 auditorías relacionadas con KDS.
Entre las cuentas con varios cierres, hubo 30 rechazos `KITCHEN_INVALID_TRANSITION` en seis cuentas.
Ese conjunto incluye intentos posteriores a una recuperación. No se atribuye cada rechazo a la misma causa.

La cuenta 053, mesa Pared, muestra una secuencia que coincide con el reporte en la estación Barra:

| Hora local del 2 de noviembre | Operación                          | Resultado                                        |
| ----------------------------- | ---------------------------------- | ------------------------------------------------ |
| 15:58:26                      | Terminar primera ronda             | `completed`, versión 4                           |
| 18:45:36                      | Agregar otra ronda                 | `queued`, versión 5                              |
| 18:46:04                      | Marcar el producto nuevo listo     | `ready`, versión 6                               |
| 18:46:07                      | Terminar segunda ronda             | `KITCHEN_INVALID_TRANSITION`, versión esperada 6 |
| 18:47:15                      | Recuperar                          | `in_preparation`, versión 7                      |
| 18:55:27                      | Terminar tras marcar los productos | `completed`, versión 10                          |

Comanda: `edeba8eb-cb3b-4a39-a9ed-fa40f4e05181`.
Correlación del rechazo: consultar `history-summary.json`.
La cuenta 053 confirma el patrón de forma independiente. No se afirma que sea la cuenta recordada por el propietario.

La API consultada usaba `sha-f4c868676d11941fabd318a00849e0fff9c7113d`.
La inspección del código compilado confirmó la misma validación defectuosa que existe en el código fuente.

## Causa comprobada

El tablero conserva los productos de las rondas anteriores como contexto.
UmiPOS envía todos los productos no cancelados cuando el operador pulsa Terminar.

La primera ronda tiene `station_completed_at`. La segunda todavía tiene ese campo vacío.
La API contaba sólo los productos listos con ese campo vacío.
Después comparaba ese número con todos los identificadores que recibió.
Un producto anterior y uno nuevo daban un conteo de uno frente a dos identificadores.
La API devolvía `KITCHEN_INVALID_TRANSITION`, aunque el producto nuevo ya estaba listo.

La interfaz oculta la tarjeta mientras envía el comando.
Cuando llega el rechazo, restaura la tarjeta. Esto explica la desaparición temporal y el regreso.
Recuperar limpia la confirmación anterior y por eso permitía terminar después de marcar otra vez los productos.

## Corrección acotada

`KdsRepository.executeKitchenCommand` valida todos los productos listos de la selección dentro del alcance permitido.
La operación requiere al menos un producto pendiente de confirmar.
El UPDATE conserva su condición `station_completed_at IS NULL`.
Por eso no reescribe la fecha, la versión ni el historial del producto anterior.

Se conservan los rechazos por productos no listos, otra estación y selección exclusiva de productos ya terminados.
Se conserva la comprobación de versión y la respuesta idempotente.
No cambia el contrato ni el esquema. La corrección de la API admite el cliente 335.
La regresión entra en `test:integration:schema` para que CI la ejecute.

## Validación

Las pruebas usan una base desechable en Juan-PC, con PostgreSQL 17 y pgvector 0.8.5.
La base escucha sólo en `127.0.0.1:56434`. Los casos crean datos aislados y ejecutan ROLLBACK.

- Base anterior: siete pruebas de estación aprobadas.
- Prueba roja: la segunda ronda devolvió `KITCHEN_INVALID_TRANSITION` con estado `ready`.
- Prueba verde: trece pruebas de estación aprobadas con el rol `worker_login`.
- Integración de KDS: 23 aprobadas y dos omitidas por condiciones de sus pruebas existentes.
- Pruebas unitarias de KDS: 135 aprobadas; 29 quedaron omitidas en la ejecución normal. Un intento con base detectó que faltan las semillas fijas del Gate 4A; no se presenta como aprobado.
- Tipos de API, lint de API y compilación de API: aprobados.
- Formato: aprobado. La revisión no encontró defectos de producción. Se reforzaron dos pruebas según sus observaciones. CI del PR: pendiente de publicación.

La prueba de dos rondas usa `appendKitchenItems`, `boardSnapshot` y `executeKitchenCommand` reales.
También comprueba que un reintento conserva el resultado y que otra estación conserva sus datos.
La prueba no necesita Recuperar ni un segundo Terminar.

Las dependencias iniciales apuntaban al contrato compilado de otro checkout.
Se aisló la referencia y se compiló el contrato 2.49.0 del checkout actual antes de validar tipos y lint.
La base de prueba recibió el DDL y las migraciones existentes. No se aplicó ninguna migración a producción.

## Flota y entrega

El diagnóstico previo del `2026-11-03T23:30:29Z` terminó con código cero.
Caja, Barra, Cocina y Mesero tenían ADB, build 335 de release y KeepADB 1.8.38.

El PR #249 ya está en main, commit `d626bdc44bf56a3c5a5176b52e6e481108729b21`.
Esta rama parte de ese commit y conserva la corrección del replay de efectivo.

El propietario autorizó instalar la build 336 desde Juan-PC.
Se compiló desde ese main con entorno production, contrato 2.49.0 y certificado de producción.
El SHA-256 del APK es `e89421aa54a78c246287b968ce8135fbbd8206e97719a78bc1988bc7f481c07f`.

Se actualizó Caja, Barra, Cocina y Mesero con `adb install --no-incremental -r`.
Las cuatro instalaciones terminaron con Success y `versionCode=336`, sin DEBUGGABLE.
El diagnóstico posterior con `--expected-build 336` terminó con código cero.
La fecha original de instalación se conservó en cada tablet. No se desinstaló la aplicación ni se borraron sus datos.

La actividad explícita `co.umiconsulting.umi_pos.MainActivity` abrió en las cuatro tablets.
El primer comando por intención implícita no resolvió el componente; se corrigió el comando de verificación.
Android 16 informa appId en lugar de userId. El registro inicial no permite comparar ese campo en las Samsung.
Se conserva ese límite en la evidencia; no se interpreta como pérdida de datos.

Caja mostró la pantalla principal con Cajero ONCA.
El propietario confirmó que Barra, Cocina y Mesero muestran UmiPOS tras su intervención.
Las capturas posteriores de esas tres tablets mostraron reposo. La comprobación visual independiente sólo cubre Caja.

El APK incluye el PR #249. El fallo de las rondas requiere también desplegar la API de este PR.
La instalación del APK no despliega esa corrección de API.
La integración del PR y la prueba de dos rondas en producción siguen pendientes de aprobación.
No se modificaron cuentas, pagos, entregas ni comandas reales durante esta investigación.

El APK y su manifiesto quedan en `/home/juan/umi-pos-releases/336/`.
El checkout de compilación queda en `/home/juan/umi-onca-release336-20261103`.
La Mac conserva una copia en `Downloads/UmiPOS-336-production-20261103/`.

## Riesgos, reversión y límites

El cambio acepta una selección que mezcla productos anteriores y nuevos, pero sólo cierra los nuevos pendientes.
La prueba conserva las restricciones de estación, de estado y de versión.
La reversión consiste en desplegar la imagen anterior de la API. No requiere revertir datos ni esquema.

La prueba del flujo en producción queda pendiente tras la aprobación y el despliegue.
No se declara resuelto en las tablets con base únicamente en estas pruebas.
La recuperación LAN sin enlace a la API no fue el fallo reproducido y no recibió cambios en este PR.

## Herramientas y fuentes

- PostgreSQL 17 y pgvector 0.8.5: imagen local `pgvector/pgvector:0.8.5-pg17-bookworm`.
- Vitest 2.1.9, Node 24.21.0 y pnpm 10.29.3.
- Fuentes primarias: historial de KDS de ONCA, código compilado de la API y código del repositorio.
- Método: skill de soporte ONCA y `diagnosing-bugs`; regresión con PostgreSQL real.
- Evidencia depurada: `evidence/2026-11-03-onca-kds-second-round/history-summary.json`.
- Evidencia completa: `/home/juan/.local/state/onca-support-20261103/kds-second-round/`.
