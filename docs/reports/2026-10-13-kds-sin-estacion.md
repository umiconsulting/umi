# KDS: productos históricos sin estación

Fecha: 2026-10-13. Entregado en **0.1.0+94**, instalado en iMin, A9 KDS y A11 móvil.

## Problema y decisión

Antes del cambio, la cuenta 004 conservaba dos productos sin estación. La cuenta 013 estaba cancelada y conservaba productos sin estación.
El tablero de estaciones excluye esas filas porque no tienen una estación que dibujar.
Cambiar las rutas del catálogo no modifica automáticamente una proyección histórica.

La bandeja «Sin estación» muestra ese trabajo sin limitarlo al día actual.
Las comandas activas muestran el destino que producirían las rutas actuales.
Un operador con `kitchen.station.manage` confirma antes de aplicar esas rutas.
La operación conserva los productos que ya tienen estación y los que todavía no encuentran ruta.
Las comandas comercialmente canceladas sólo ofrecen «Descartar», con `kitchen.cancel_ack`.
Una cancelación nunca vuelve a preparación al resolver rutas.

El servidor verifica versión y huella de los destinos mostrados. Un cambio concurrente exige revisar otra vez la propuesta.
Se reutilizan la idempotencia, auditoría y notificación del tablero existentes.
La consulta y las escrituras conservan el alcance de comercio, sucursal, sesión y dispositivo.

Esta bandeja no convierte el pago en una señal de preparación terminada.
Tampoco elimina trabajo al cambiar de fecha. Se conserva la política comercial Manual de ONCA.

## Herramientas y fundamento

La [investigación de cierre y comandas](../research/2026-10-13-kds-cierre-cuentas-comandas/README.md) separa cierre comercial y trabajo de cocina.
La [investigación de rutas](../research/2026-10-13-kds-ruteo-tiempos-sonidos/README.md) documenta precedencia y configuración.

| Herramienta    | Versión         | Uso y fuente                                                                                              |
| -------------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| Flutter / Dart | 3.47.5 / 3.13.4 | Cliente existente y pruebas; [documentación](https://docs.flutter.dev/testing/overview).                  |
| PostgreSQL     | 17.10           | RLS, transacciones y bloqueos; [documentación](https://www.postgresql.org/docs/17/explicit-locking.html). |
| node-postgres  | 8.22.0          | Integraciones con `ROLLBACK`; [transacciones](https://node-postgres.com/features/transactions).           |
| Vitest         | 2.1.9           | Ejecutor de pruebas existente del monorepo.                                                               |
| ADB            | 37.0.0          | Instalación, capturas y toques reales; [documentación](https://developer.android.com/tools/adb).          |
| Prettier       | 3.9.4           | Formato de Markdown.                                                                                      |

Se reutiliza `loadKitchenProjection` y su resolver. No se crea otro algoritmo de precedencia ni otro transporte de eventos.
La UI necesita una bandeja específica porque una fila sin estación no puede pertenecer a una columna del tablero.

## Migración local

La migración nueva `033_kitchen_unassigned_routes.sql` concede permisos de columnas al rol `api`.
Permite actualizar `station_id`, `status`, `route_reason`, `target_seconds`, `version` y `updated_at` en `kitchen_order_item`.
También concede UPDATE de `kitchen_route.version`, necesario para bloquear esas filas con `FOR SHARE`.
El comando no modifica esa versión. Se mantienen las políticas RLS existentes; no se usa el rol worker para resolver comandas.
La migración es reejecutable y no añade tablas, columnas ni estados.

Comando aplicado en la única base local:

```sh
docker exec -i umi-bv3-pg psql -U postgres -d umi_local -v ON_ERROR_STOP=1 < docs/migration/build-v3/migrations/033_kitchen_unassigned_routes.sql
```

[Registro de aplicación](evidence/2026-10-13-kds-sin-estacion/migration033.log).

## Pruebas

API: 18 integraciones PostgreSQL aprobadas; doce de Sin estación y seis de operaciones por estación.
Incluyen lectura, resolución y descarte bajo rol `api` con RLS, además de idempotencia y aislamiento.
Los fixtures terminan con `ROLLBACK` en `umi_local`; no acreditan recepción real de NOTIFY antes del recorrido nativo.
API dirigida: 155 aprobadas y 29 omitidas por falta del fixture antiguo. Contrato: 86 aprobadas.
ESLint y build API correctos. El typecheck global conserva dos errores previos en la spec de hardware.

POS: 96 pruebas dirigidas de KDS/estado, incluidas once nuevas para Sin estación.
Cubren actualización sin escritura automática, confirmación, permisos, cancelaciones, idempotencia, conflicto y texto al 200% a 360 px.
`flutter analyze` no reporta hallazgos. La suite completa aprobó **933 pruebas**.

Registros: [pruebas dirigidas](evidence/2026-10-13-kds-sin-estacion/pos-focused.log),
[análisis](evidence/2026-10-13-kds-sin-estacion/pos-analyze.log),
[suite completa](evidence/2026-10-13-kds-sin-estacion/pos-suite.log).

## Verificación nativa y base

Se operó la iMin como Admin, la A9 primero como Cocinero 2 y después como Barista 2.
La bandeja encontró tres comandas históricas: 004 activa comercialmente cobrada, 002 cancelada y 013 cancelada.

| Acción                                   | Resultado y evidencia                                                                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Abrir Sin estación como Admin            | [004 con destinos propuestos a Barra](evidence/2026-10-13-kds-sin-estacion/imin-bandeja-antes.png).                                                                                      |
| Abrirla como Cocinero 2                  | [Sin acción para aplicar rutas](evidence/2026-10-13-kds-sin-estacion/a9-sin-gestion-rutas.png); las canceladas ofrecen Descartar.                                                        |
| Aplicar rutas actuales de 004 desde iMin | [Confirmación explícita](evidence/2026-10-13-kds-sin-estacion/imin-confirmacion004.png); dos productos enviados a Barra, cero pendientes.                                                |
| Observar A9 sin tocar Actualizar         | [004 sale de Sin estación](evidence/2026-10-13-kds-sin-estacion/a9-004-actualizada-sola.png), mediante el watch existente.                                                               |
| Descartar 013 desde A9                   | [013 sale de la bandeja](evidence/2026-10-13-kds-sin-estacion/a9-013-descartada.png); sus dos productos siguen cancelados.                                                               |
| Observar iMin sin Actualizar             | [Descarte reflejado automáticamente](evidence/2026-10-13-kds-sin-estacion/imin-013-actualizada-sola.png).                                                                                |
| Preparar 004 como Barista 2              | [Empezar disponible](evidence/2026-10-13-kds-sin-estacion/a9-004-antes-preparar.png); ambos productos pasan a preparación.                                                               |
| Marcar ambos productos Listo             | [Aeropress listo](evidence/2026-10-13-kds-sin-estacion/a9-004-aeropress-listo.png), después [ambos listos y Terminar disponible](evidence/2026-10-13-kds-sin-estacion/a9-004-lista.png). |
| Terminar desde A9                        | [004 sale del tablero](evidence/2026-10-13-kds-sin-estacion/a9-004-terminada.png); Anteriores baja de cinco a cuatro.                                                                    |

Las [filas finales](evidence/2026-10-13-kds-sin-estacion/db-after94.txt) muestran 004 con `kitchen_status=completed`, versión 11.
Aeropress y Amanecer tienen estación Barra, estado `ready` y fecha de terminación de estación.
El Capuccino conserva su terminación anterior en Cocina. El estado comercial de 004 sigue `committed`.
013 conserva `cancelled`, versión 3; ambos productos tienen fecha de descarte y no se enviaron a preparar.
Comparación: [antes](evidence/2026-10-13-kds-sin-estacion/db-before94.txt),
[tras aplicar rutas](evidence/2026-10-13-kds-sin-estacion/db-routed004.txt),
[consulta](evidence/2026-10-13-kds-sin-estacion/verification.sql).

El [log de API](evidence/2026-10-13-kds-sin-estacion/api-requests.jsonl) registra seis POST correctos con 201.
Los [eventos y la auditoría](evidence/2026-10-13-kds-sin-estacion/events.txt) identifican a Admin, Cocinero 2 y Barista 2.
Las secuencias 317–322 acreditan resolución, descarte, preparación, dos productos listos y terminación.
La [consulta de eventos](evidence/2026-10-13-kds-sin-estacion/events.sql) es de sólo lectura.

Cuenta 002 queda cancelada en Sin estación, con Descartar disponible.
019, 033, 060 y 071 quedan canceladas en Anteriores de Barra, con Descartar disponible.
Son reconocimientos pendientes del operador. No se borró el historial ni se certificó la preparación de otras comandas.

Durante el recorrido se interrumpió el proceso local de API: el puerto 4001 dejó de escuchar.
La [pantalla](evidence/2026-10-13-kds-sin-estacion/a9-api-interrumpida.png) informó Sin conexión y conservó el primer producto listo.
Se inició de nuevo `node dist/main.js` desde `apps/umi-api`, con salida a `/tmp/umi-api-4001.log`.
Actualizar y repetir el segundo producto completó el flujo. No se atribuye la interrupción a un bloqueo de permisos.
No se determinó la causa de terminación del proceso de desarrollo.

## APK único del cierre 94

Comando ejecutado desde `apps/umi-pos`:

```sh
flutter build apk --profile --target-platform android-arm64 --build-name 0.1.0 --build-number 94 -PumiposApplicationId=co.umiconsulting.umi_pos.estacion --dart-define=UMIPOS_ENVIRONMENT=development --dart-define=UMIPOS_API_BASE_URL=http://127.0.0.1:4001 --dart-define=UMIPOS_DEVICE_KEY= --dart-define=UMIPOS_CONTRACT_VERSION=2.34.0 --dart-define=UMIPOS_RELEASE_VERSION=0.1.0 --dart-define=UMIPOS_CONFIG_SCHEMA_VERSION=1 --dart-define=UMIPOS_DEVELOPMENT_DIAGNOSTICS=true --dart-define=UMIPOS_FEATURE_BOOTSTRAP=disabled --dart-define=UMIPOS_HARDWARE_SIMULATOR_ENABLED=false
```

Se instaló `build/app/outputs/flutter-apk/app-profile.apk` con `adb -s <serial> install -r` en las tres terminales.
Los seriales actuales están en el [registro de instalación](evidence/2026-10-13-kds-sin-estacion/installed-builds.json).
Se verificó el SHA256 del APK instalado en cada dispositivo:

```text
d9ef49320ea8be3621fd74829c0296580ec557fab3c544143d33f5bcd7280763
```

[Log de compilación](evidence/2026-10-13-kds-sin-estacion/apk-build.log). El APK pesa 33.3 MB.
La conexión usa `adb reverse tcp:4001 tcp:4001` en cada terminal y requiere que el host y ADB sigan activos.
El número 94 incorpora las ampliaciones posteriores; no se bajó al build 75 solicitado al inicio del ciclo.

## Límites explícitos

El [estado de salud](evidence/2026-10-13-kds-sin-estacion/api-health.json) confirma DB y Redis disponibles.
`/health` conserva el 503 por versión de esquema actual `null`; ese límite estaba documentado en la entrega original.
No se certifica readiness global ni toda la suite API. El typecheck global mantiene los dos errores previos de hardware.
No se modificó la spec protegida de caja.

No se repitió el recorrido del dashboard en este build: no cambió en esta ampliación; su evidencia está en el reporte original.
No se comprobó audición física de tonos, espera nativa de quince minutos en Cocina, cambio real de fecha ni acceso LAN directo.
Las 29 pruebas API omitidas por su fixture antiguo no se cuentan entre las 18 integraciones reales ejecutadas.
La política de cierre diario sigue Manual. El pago y el trabajo de cocina conservan estados independientes.
