# ONCA: CI de staging y migración de mesas pagadas

## Causa

La base `91aad9489ad440759e92342e6401c86092bf0e2e` de staging ya falla en `build-and-test`.
El fallo aparece tras integrar el PR #246, después de la reorganización de PostgreSQL en `db/`.
El workflow ejecuta la migración de mesas pagadas desde `supabase/migrations`.
La prueba `inventory-initial-cost-migration.spec.ts` exige que el workflow use el mecanismo `db/migrate.sh`.
La contradicción falla antes de los cambios de efectivo y capacidad del journal.

El [CI de la base](https://github.com/umiconsulting/umi/actions/runs/41583683583) confirma la misma aserción fallida.
Los PR #255 y #256 conservan intactos el workflow y esa prueba respecto de staging.

## Corrección aislada

Se incorpora el DDL existente a `db/migrations/062_table_paid_visit.sql`.
El archivo histórico de `supabase/migrations` permanece intacto.
El runner ejecuta la migración 062 con `--single-transaction`.
La migración nueva permite que el runner controle la transacción del DDL.
El runner registra el checksum en una llamada posterior.
El DDL admite una reejecución si ocurre una interrupción entre ambas llamadas.
El workflow usa sus dos ejecuciones existentes de `db/migrate.sh` y elimina las tres ejecuciones manuales del archivo histórico.
La prueba conserva todas sus aserciones.

Este cambio sólo corrige la entrega de la migración existente.
Los cambios de cobro y capacidad permanecen en sus propios PR.

## Verificación en Juan-PC

- La prueba original falló antes del cambio con la misma aserción del CI.
- Las 194 pruebas de migraciones y estructura aprobaron después del cambio.
- Las 2,148 pruebas unitarias de API aprobaron; 29 pruebas conservaron su omisión declarada.
- La compilación y la revisión de tipos aprobaron.
- Las 363 pruebas de integración del esquema aprobaron; dos pruebas conservaron su omisión declarada.
- Una base nueva registró la migración 062 con su checksum SHA-256.
- La segunda ejecución aplicó cero migraciones y omitió las 62 existentes.
- Una copia temporal con un fallo SQL al final verificó la reversión de toda la migración 062.
- Una base con la migración histórica y una mesa pagada conservó exactamente todos los campos de esa mesa.
- La aplicación directa repetida del DDL nuevo conservó los datos de la mesa.

La evidencia está en `/home/juan/.local/state/onca-support-20261104/checkout-state/`.
Los archivos principales son `staging-ci-migration-red.log`, `staging-ci-api-tests.log`,
`staging-ci-schema-integration.log` y `staging-ci-migration-verification.json`.
Las pruebas usan bases y contenedores desechables, sin datos de producción.
Se usaron pnpm 10.29.3, Node 24.21.0, Vitest 2.1.9 y PostgreSQL 17 con pgvector.
El CI usa Node 22 y aporta su verificación separada.

## Entrega

El PR apunta sólo a staging y requiere aprobación antes del merge.
Los PR #255 y #256 mantienen el fallo de la base hasta integrar esta corrección y actualizar sus ramas.
No se genera ni instala otro APK con este cambio de CI.
La reversión del código conserva la columna y el estado de las mesas.
El despliegue y cualquier reversión de esquema requieren su procedimiento aprobado.
