# Folio de cuenta que reinicia cada día operativo

Fecha: 14 de octubre de 2026. Entorno: desarrollo local, una API y `umi_local`, APK Android `0.1.0+122`.

## Resultado

Las cuentas nuevas reciben un número visible por comercio, sucursal y día operativo. El número global y los UUID permanecen para historia y relaciones. Las cuentas anteriores conservan su folio; las de días anteriores muestran además la fecha en la lista y en el KDS. El recibo de cobro mantiene su numeración propia. Hoy ONCA tenía como máximo `208`, así que la primera cuenta nueva de esta misma jornada sería `209`; la primera de la próxima jornada será `001`.

Se añadió [la migración 038](../migration/build-v3/migrations/038_daily_pos_account_number.sql) y [su prueba SQL](../migration/build-v3/tests/038_daily_pos_account_number.sql). Los lectores de cuenta, comanda, mapa, push y recibo usan el nuevo folio con respaldo al antiguo. En el POS se añadió fecha a las cuentas y comandas de días anteriores. Se actualizaron las premisas de `open_accounts_test.dart` y `accounts_workspace_test.dart`, y se añadieron comprobaciones en `open_accounts_list_test.dart` y `kitchen_board_test.dart` para la fecha contextual. La [decisión técnica](../architecture/2026-10-14-folio-cuenta-diario-adr.md) explica el alcance y las alternativas.

## Herramientas y fuente

Se investigó antes de implementar: [la doctrina de herramientas](../agents/tool-and-research-doctrine.md) recomienda `rg` para explorar el repositorio; el [playbook local](../development/LOCAL_VERIFICATION_PLAYBOOK.md) indica `psql`, Flutter y ADB con captura real. Se usaron ripgrep 15.2.0, PostgreSQL 17.10 en el contenedor (`psql` cliente 18.6), Flutter 3.47.5, Vitest 2.1.9, ADB y Prettier 3.9.4. [PostgreSQL documenta el orden de triggers por nombre](https://www.postgresql.org/docs/current/sql-createtrigger.html) y la asignación atómica con [`ON CONFLICT`](https://www.postgresql.org/docs/current/sql-insert.html). No se necesitó una solución manual para concurrencia: se usaron esas primitivas de PostgreSQL. La UI se verificó con capturas ADB, como exige el playbook; las pruebas de widget usan la herramienta de Flutter.

Comando aplicado dos veces en local, la segunda para confirmar que se puede reejecutar:

```sh
docker exec -i umi-bv3-pg psql -U postgres -d umi_local -v ON_ERROR_STOP=1 --single-transaction -f - < docs/migration/build-v3/migrations/038_daily_pos_account_number.sql
```

La prueba de SQL se ejecutó dentro de `BEGIN`/`ROLLBACK`, sin dejar cuentas artificiales:

```sh
docker exec -i umi-bv3-pg psql -U postgres -d umi_local -v ON_ERROR_STOP=1 -f - < docs/migration/build-v3/tests/038_daily_pos_account_number.sql
```

## Verificación

- Prueba SQL: `PASS: 001/002, location scope, 04:00 boundary, next day 001, 999/1000`. Una inserción adicional con rol `api` y contexto de comercio/sucursal asignó `209` en la jornada actual y `1` en la siguiente; ambas se revirtieron.
- Base local: `merchant.pos_account_counter` contiene cuatro ámbitos; ONCA/ubicación actual/`2026-10-14` tiene `last_number=208` ([filas capturadas](evidence/2026-10-14-folio-cuenta-diario/database-counters.txt)). Se conservaron 127 cuentas históricas. La ejecución inicial de la migración en esta base había rellenado sus `daily_account_number` con el global; la versión final del archivo deja `NULL` para historia y el lector usa `coalesce`. Ambos estados muestran el mismo folio histórico.
- API: el [log capturado](evidence/2026-10-14-folio-cuenta-diario/api-requests-200.jsonl) registró `GET /cart/open-accounts` con estado 200 a las 17:18:40 UTC y solicitudes KDS con estado 200 a las 17:21:50 UTC. Pruebas focalizadas de repositorio de carrito, identidad de recibo y push: 34 aprobadas. ESLint focalizado limpio.
- POS: `flutter analyze` sin hallazgos; suite completa, **973 pruebas aprobadas**. APK `0.1.0+122` construido una sola vez e instalado en iMin, A9 y A11; `dumpsys package` confirmó `versionCode=122` en las tres.
- En la iMin, la lista de cuentas cargó con los folios actuales y el KDS de días anteriores mostró `Cuenta 118 · Mesa 1 · 2026-10-13` en [la captura real](evidence/2026-10-14-folio-cuenta-diario/imin-build122-kds-anteriores.png). Hay también [captura de lista](evidence/2026-10-14-folio-cuenta-diario/imin-build122-lista.png). La A11 llegó a [PIN de operador](evidence/2026-10-14-folio-cuenta-diario/a11-build122-retry.png) después de reintentar el inicio.

La suite completa de la API terminó con **1957 aprobadas, 5 fallidas, 29 omitidas**. Las cinco fallas están fuera de este cambio: una en `pos-cash.repository.regression.spec.ts`, tres de forma de las migraciones preexistentes 029/033/035 y una de publicación de códigos de error. El chequeo de tipos de API sigue fallando en la spec preexistente `pos-hardware.repository.spec.ts` (líneas 70 y 95). La migración 038 sí pasa los chequeos de forma. `99_verify.sql` y `security_gate.sql` conservan fallos preexistentes de esquema/fixtures; la revisión focalizada confirmó la nueva columna y los controles RLS del contador.

**No verificado:** no se creó una cuenta real de mañana en la app ni se observó el folio `001` en Android; el corte y la concurrencia están cubiertos por SQL. La A9 fue instalada y su log llegó a `readyForAuthentication`, pero la captura permaneció en la pantalla de preparación, por lo que no se atribuye una validación visual del KDS A9 a este ciclo. En la lista de cuentas no había cuentas abiertas de días anteriores para ver allí el sufijo de fecha; se comprobó con widget y con KDS real. El error transitorio `apiUnavailable` apareció en A9 y A11 al primer inicio; A11 recuperó hasta el PIN tras reintentar.
