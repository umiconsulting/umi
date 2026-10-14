# Correcciones de la jornada en tres terminales

Estado: correcciones implementadas y pruebas completas verdes. La instalación final corresponde al build 90.

Origen: [jornada de operación](2026-10-13-jornada-operacion-tres-terminales.md).
Método: [herramientas investigadas](../research/2026-10-13-jornada-correcciones-herramientas.md).

## Registro de aceptación

| Problema                      | Estado                | Verificación requerida                                                              |
| ----------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| Impuestos del recibo          | Corregido             | Snapshot, pantalla nativa y prueba del renderizador; impresión física no verificada |
| Hora del recibo               | Corregido             | Zona del negocio y medianoche en pruebas; recibo anterior en iMin                   |
| Mover mesas                   | Corregido             | Mesa 3 a Mesa 6, misma cuenta y línea; rechazos y reintento en Postgres             |
| Dividir mesas                 | Corregido             | Confirmación nativa, reparto cuatro/dos; conservación de cuenta en Postgres         |
| Efectivo insuficiente         | Corregido             | Bloqueo nativo de efectivo y mixto; reglas de pago en pruebas                       |
| Cancelación preparada         | Corregido             | Rechazo y aprobación en A11; motivo y estado independiente de Cocina                |
| Altura de autorización        | Corregido             | Acción nativa visible; geometría y texto al 200 % en pruebas widget                 |
| Devolución con PIN incorrecto | Corregido             | Rechazo nativo conserva revisión; vencimiento y renovación con la misma nota        |
| Estado local de cocina        | Corregido             | Barra y Cocina independientes en A9 y base                                          |
| Recuperación de cocina        | Corregido             | Recuperar nativo; fallos y conservación de marcas en pruebas                        |
| Cuenta de otra terminal       | Corregido             | Aviso nativo en Cuentas identifica Mesero 2 y terminal; cuenta protegida            |
| Borradores vacíos             | Corregido             | Dos ciclos de sesión: 86 cuentas, mismo folio 154; historial y auditoría en pruebas |
| Política de conteo            | Diagnóstico corregido | Base y política efectiva coinciden; etiqueta del dashboard expresa la acción        |
| Configuración de pagos        | Corregido             | Clics reales, PATCH 200, lectura de base y prueba nativa de pago mixto              |
| Comer aquí sin mesa           | Corregido             | Permitido con regla activa; selector de mesa con regla restaurada                   |
| Pendientes antiguos de cocina | Corregido             | Anteriores muestra 070/071 en A9; conserva su preparación                           |
| Permisos del dashboard        | Corregido             | Etiquetas, explicación y captura del navegador real                                 |
| Aviso de listo al mesero      | Corregido             | Hoja abierta y reproducción Android en A11; rol sin cocina en pruebas widget        |
| Umbral automático             | Corregido             | A9 cruza cinco minutos sin Actualizar; una reproducción de vencimiento              |

## Diagnóstico confirmado

La base conserva los impuestos de los recibos 0002, 0003, 0005 y 0006: 690, 828, 828 y 3862 centavos.
El recibo en pantalla y el renderizador térmico reemplazan estos impuestos por cero.
Las pruebas existentes también exigían cero. Se actualiza esta premisa para conservar el valor autoritativo.

La sucursal ONCA no tiene zona propia. El negocio usa `America/Mazatlan`.
Los snapshots conservan `issuedAt` en UTC. El encabezado elimina `Z` y muestra esa hora sin conversión.

## Correcciones y pruebas de código

- Recibo: muestra `taxTotal`. El renderizador térmico usa `taxMinorUnits` del snapshot.
- Hora: la API entrega el mismo instante con el desplazamiento de la zona del negocio. Los recibos UTC anteriores se localizan al leerlos.
- Mesas: Mover cambia la cuenta y su contexto de cocina antes de liberar la mesa original. Los pagos pendientes impiden el movimiento.
- Dividir: pide confirmación y reparte los lugares entre las capacidades reales. La cuenta conserva su mesa.
- Cobro: el botón queda deshabilitado cuando el efectivo no cubre su parte del pago.
- Cancelación: la migración 030 permite cancelar un ítem de cocina terminado con autorización. Una venta comercial cerrada conserva su protección.
- Autorización: el cuerpo del diálogo permite desplazamiento. El encabezado y la acción quedan fuera del cuerpo.
- Devolución: un rechazo conserva la revisión. Una revisión vencida exige Actualizar revisión y conserva motivo, nota y cantidades.
- Cocina: los estados y acciones se calculan con los ítems de la estación. Terminar Barra no termina Cocina.
- Cocina: los comandos conservan estaciones, contadores y fecha comercial durante un fallo o reintento.
- Cocina: Hoy, Anteriores y Todos permiten revisar el atraso sin mezclar jornadas por defecto. La fecha procede de la API.
- Cuenta ocupada: el rechazo identifica al operador y su terminal. Guardar la cuenta anterior no conserva una referencia local ya cerrada.
- Cuentas: el aviso de rechazo permanece visible en la lista. Antes solo se presentaba al volver a Comanda.
- Historial: oculta exclusivamente los borradores automáticos vacíos. Conserva cancelaciones comerciales y datos de auditoría.
- Dashboard: Caja y turnos guarda tarjeta manual, pagos mixtos y Comer aquí sin mesa en la política de la sucursal.
- Dashboard: las 146 claves actuales tienen etiquetas de presentación. Un control bloqueado explica su causa.
- Mesero: la Comanda permite consultar cocina sin permiso de cocina. El sondeo existente muestra el estado y la cantidad de ítems listos.
- Comanda angosta: la hoja abierta escucha los cambios de cuenta y de cocina. No requiere cerrar y abrir para actualizar.
- Conexión de cocina: la espera HTTP queda en ocho segundos, por debajo del cierre de conexión de diez segundos del servidor.

Pruebas registradas antes de la verificación nativa:

- POS: 897 pruebas verdes; `flutter analyze` sin hallazgos. Incluye hoja móvil, mesa movida y aviso de rechazo visible en Cuentas.
- Cocina: 76 pruebas verdes, incluidos filtros de jornada y conservación del estado durante un comando fallido.
- Devoluciones: 20 pruebas verdes, incluido el vencimiento y la renovación de la revisión.
- API: 41 pruebas de integración contra Postgres para mesas y cocina. No usan otra base.
- API: 42 pruebas verdes de política de cobro, permisos, repositorio y servicio de checkout.
- Dashboard: 365 pruebas verdes. Lingui compila los dos idiomas con `--strict`.
- API: `nest build` termina sin errores. El typecheck de specs tiene dos errores anteriores en `pos-hardware.repository.spec.ts`.
- ESLint de las piezas del dashboard: cero errores; 55 avisos existentes en `data.jsx`.
- API: 63 pruebas verdes del servicio KDS y del aviso realtime, incluida la espera inferior al timeout del socket.

## Verificación nativa del build 88

El build 88 se instaló en las tres terminales. El usuario precisó su uso: iMin caja, A9 KDS y A11 POS móvil.
Se cambiaron las sesiones mediante los controles reales. Se conservó la cuenta 146 previa y el turno del administrador.

- iMin: el recibo 0006 muestra impuestos $38.62 y hora local 12:11:41. Captura `imin-recibo-128.png`.
- iMin: efectivo $1 para una cuenta de $60 muestra faltante $59 y deshabilita Cobrar. Captura `imin-efectivo-insuficiente.png`.
- iMin: pago mixto $30 efectivo y $30 terminal manual conserva el bloqueo si falta efectivo. Captura `imin-mixto-insuficiente.png`.
- A9: Capuccino pasa de cola gris a preparación azul y listo verde. Cocina conserva Margarita pendiente. Capturas `a9-barra-preparando131.png`, `a9-barra-lista-global-parcial131.png` y `a9-cocina-cola-global-parcial131.png`.
- Base: Capuccino tiene finalización de estación; Margarita no. Evidencia `cocina-estaciones131.txt`.
- A11: un PIN sin permiso rechaza la cancelación. Conserva Error de captura y la acción visible. Captura `a11-autorizacion-rechazada131.png`.
- A11: autorización del administrador cancela aquel Capuccino terminado. Margarita conserva preparación. Captura `a11-cancelacion-aprobada131.png` y filas `cocina-cancelacion131.txt`.
- A11: Comanda muestra Parcialmente listo y Listo con la cantidad. Android inicia el sonido de listo. Evidencia `a11-aviso-listo.log`.
- A9: Recuperar con No quedó bien devuelve Margarita a preparación. Una segunda marca de listo actualiza el aviso del mesero.

La prueba nativa encontró una hoja móvil que no se actualizaba mientras permanecía abierta.
La corrección posterior tiene prueba widget y suite completa. Se incorporó al build 89.

## Verificación del build 89

El mismo APK `0.1.0+89` se instaló con `install -r` en iMin, A9 y A11. Se conservaron los datos.
`build89-instalado.txt` registra las versiones y el SHA-256 del APK. `build89.log` conserva la compilación.

- iMin: Mover Mesa 3 a Mesa 6 conserva cuatro personas y la hora de atención. Abrir cuenta conserva Capuccino por $60.
- Base: la cuenta 152 conserva una línea y su visita corresponde a Mesa 6. Evidencia `mesa-movida-cuenta.txt`.
- iMin: Dividir seis personas reparte cuatro en Mesa 4 y dos en Mesa 5. Las capturas muestran ambos paneles.
- A11: la hoja permanece abierta durante Enviar a cocina y cambia a Enviada. Luego muestra Preparando con cero productos listos.
- A9: la cuenta 153 llega a Barra sin Actualizar. Android registra `sound=arrival playback=started` a las 13:40:40.
- A9: pasa de preparación azul a Tiempo vencido rojo a los cinco minutos, sin Actualizar. Registra un tono de vencimiento a las 13:45:41.
- A11: la misma hoja muestra Listo con un producto. Android registra el tono de listo a las 13:46:29, incluso con Android bloqueado.
- A9: Terminar retira la cuenta 153. Anteriores conserva las cuentas 070 y 071; no se modifica su preparación.
- iMin: el PIN sin permiso rechaza el reembolso 0006 con explicación. Conserva revisión, impuestos $38.62 y dos decisiones No reponer.
- Dashboard: se restauran mediante clics las tres reglas temporales de cobro. La base vuelve a conservar los tres valores en `false`.
- iMin: con la regla restaurada, Cobrar la cuenta 150 para Comer aquí abre Elige una mesa. Se cancela sin asignación ficticia.
- iMin: un PIN inválido también conserva revisión, importe y decisiones de reposición. Captura `imin-reembolso-pin-invalido.png`.
- iMin: una revisión vencida explica la renovación. Actualizar revisión conserva `customer_changed_mind` y `SIM_revision_sin_devolver` en la base.
- A11: salir e ingresar dos veces conserva 86 cuentas y el mismo último folio 154, vacío. No se envía una orden vacía.
- Base: abrir 153 desde iMin devuelve `CART_ACCOUNT_BUSY`. La cuenta permanece con Mesero 2 en Samsung portátil QA nativa.

La A11 estaba bloqueada al iniciar el APK. Se desbloqueó con el dato autorizado y se reinició la aplicación sin borrar datos.

## Diagnósticos corregidos

El rechazo real de devolución fue `STALE_PREVIEW`, antes filtrado como `CONFLICT`. El log confirma que la revisión venció antes del PIN.
La prueba adicional de PIN incorrecto confirma la conservación del formulario; no atribuye aquel rechazo a un PIN incorrecto.

La captura 23 muestra Conteo ciego desmarcado y el estado Visible · total. La base conserva `false` y `total_only`.
La política efectiva era coherente. La etiqueta ahora dice Activar conteo ciego para expresar la acción del control.

El proceso original de la API ejecutaba `dist/main.js`; su log real era `/tmp/a11-api-running.log`.
Se compiló y reinició una sola API. El proceso nuevo escribe `/tmp/umi-api-4001.log` y escucha en el puerto 4001.

## Migraciones aplicadas

Las migraciones 030, 031 y 032 se aplicaron en `umi_local`. Las tres admiten otra ejecución.
031 conserva la finalización por estación en `kitchen_order_item.station_completed_at`.
032 agrega `pos_checkout_policy.allow_dine_in_without_table`, con valor inicial `false`.
El contrato incorpora un campo opcional. Los clientes anteriores lo pueden omitir. Se regeneraron los modelos con el generador del monorepo.

```sh
docker exec -i umi-bv3-pg psql -U postgres -d umi_local -v ON_ERROR_STOP=1 < docs/migration/build-v3/migrations/030_void_completed_kitchen_item.sql
docker exec -i umi-bv3-pg psql -U postgres -d umi_local -v ON_ERROR_STOP=1 < docs/migration/build-v3/migrations/031_kitchen_station_completion.sql
docker exec -i umi-bv3-pg psql -U postgres -d umi_local -v ON_ERROR_STOP=1 < docs/migration/build-v3/migrations/032_checkout_service_policy.sql
```

## Límites de verificación nativa

Los builds 88 y 89 fueron etapas de comprobación. El build 90 incorpora el aviso de rechazo en la lista de Cuentas.
La prueba nativa de división comprobó personas y paneles. La conservación de una cuenta durante la división tiene prueba contra Postgres.
La sesión real del mesero tiene permiso de lectura de cocina. La consulta sin ese permiso se verificó con pruebas widget.
Android registra el inicio de los tres tonos. No se comprobó su audición a distancia ni el volumen físico.
No se verificaron impresión física, apertura física del cajón, cargos bancarios, reposición real de inventario ni una jornada de ocho horas.
No se completó otra devolución real durante esta corrección: se verificaron rechazo, vencimiento y renovación sin alterar el recibo 0006.
El typecheck completo de la API conserva dos errores anteriores en la spec de hardware. La spec protegida de caja ya tenía fallos ajenos.
La API anterior cerró su pool durante la comprobación. Se reinició un único proceso; no se confirmó la causa de aquel cierre.

## Instalación final: build 90

Se instaló el mismo APK `0.1.0+90` en las tres terminales con `install -r`. Las tres reportan `versionCode=90`.
La iMin conserva Admin ONCA. La A9 conserva Cocinero 2 y queda en Cocina. La A11 conserva Mesero 2 y la cuenta 153.
La captura `imin-cuenta-ocupada-build90.png` comprueba el rechazo desde Cuentas, con el nombre del operador y su terminal.
`a9-kds-build90.png` y `a11-pos-movil-build90.png` comprueban el arranque de ambas tablets.
La hoja de la A11 muestra Terminado y un producto listo tras el arranque. Se conserva el consumo de $60.

SHA-256: `2eedfc5a953d61362c6c3382f3643c99a793853002cc4f2fd44106820d4b76af`.
`build90.log` y `build90-instalado.txt` registran la compilación y las versiones instaladas.
Los builds anteriores fueron etapas de diagnóstico. El último cambio exigió otra compilación para incluir el aviso visible en Cuentas.

```sh
cd apps/umi-pos
flutter build apk --profile --target-platform android-arm64 --build-name 0.1.0 --build-number 90 -PumiposApplicationId=co.umiconsulting.umi_pos.estacion --dart-define=UMIPOS_ENVIRONMENT=development --dart-define=UMIPOS_API_BASE_URL=http://127.0.0.1:4001 --dart-define=UMIPOS_DEVICE_KEY= --dart-define=UMIPOS_CONTRACT_VERSION=2.34.0 --dart-define=UMIPOS_RELEASE_VERSION=0.1.0 --dart-define=UMIPOS_CONFIG_SCHEMA_VERSION=1 --dart-define=UMIPOS_DEVELOPMENT_DIAGNOSTICS=true --dart-define=UMIPOS_FEATURE_BOOTSTRAP=disabled --dart-define=UMIPOS_HARDWARE_SIMULATOR_ENABLED=false
adb -s 192.168.1.10:5555 install -r build/app/outputs/flutter-apk/app-profile.apk
adb -s 192.168.1.14:35559 install -r build/app/outputs/flutter-apk/app-profile.apk
adb -s 192.168.1.13:38333 install -r build/app/outputs/flutter-apk/app-profile.apk
```

Se conserva la dirección localhost usada por los builds anteriores. Cada terminal tiene `adb reverse tcp:4001 tcp:4001`.
Esta conexión depende de ADB. No se verificó acceso directo a la API por la red inalámbrica con este APK.

## Premisas de pruebas actualizadas

- `receipt_document_test.dart` y las pruebas térmicas conservan el impuesto del snapshot. La expectativa anterior de cero era incorrecta.
- `open_accounts_test.dart` exige refrescar una cuenta cuya mesa cambió antes de decidir guardarla. Evita usar una versión anterior al movimiento.
- `cart_layout_test.dart` comprueba que una hoja móvil abierta recibe los cambios del controlador. Incluye texto y geometría de la A11.
- `sale_exception_test.dart` conserva la revisión después del rechazo y permite renovarla al vencer. No descarta motivo ni cantidades.
- Las pruebas de cocina distinguen los ítems de la estación de los ítems globales. Cubren filtros y fallos sin pérdida de marcas.
- `accounts_workspace_test.dart` mantiene la lista y muestra el responsable cuando se rechaza una apertura.
- Las pruebas de mesas contra Postgres conservan cuenta, capacidad y contexto de cocina durante movimiento y división.

La última prueba dirigida ejecutó 25 casos. La suite completa posterior ejecutó 897 casos, todos verdes.

## Evidencia reproducible

Los archivos están en [evidencia de correcciones](evidence/2026-10-13-jornada-correcciones/).
`pos-suite.log`, `pos-analyze.log`, `postgres-integracion.log` y `dashboard-suite.log` conservan las salidas de pruebas.
`api-corregida.jsonl` conserva método, URL, estado y duración sin credenciales.
El extracto hasta las 21:01 UTC registra 1645 peticiones y cero respuestas 500 desde el reinicio de las 20:28:35 UTC.
Incluye 236 esperas del tablero, todas con estado 200; la duración máxima es 8007 ms.
`cuentas-antes-sesion.txt`, `cuentas-despues-sesion1.txt` y `cuentas-despues-sesion2.txt` fijan el conteo durante las sesiones.
`revisiones-renovadas.txt` conserva los dos vencimientos, motivo y nota. `cuentas-proteccion.txt` conserva los responsables.
Las tres reglas temporales quedaron restauradas mediante el dashboard. `politica-restaurada-base.txt` confirma sus valores.

La herramienta y su versión se documentan en la investigación enlazada al inicio. Se reutilizan Flutter Test, Vitest, ADB y Playwright.
No se agregó una librería de audio para estas correcciones. Se conserva `audioplayers` 6.8.1 y los recursos locales.
La elección y sus alternativas están en [el reporte de los cuatro frentes](2026-10-13-cuentas-lista-mapa-cocina-sonidos.md).
