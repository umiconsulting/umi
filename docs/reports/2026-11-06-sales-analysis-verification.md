# Verificación del análisis de compras

Fecha: 6 de noviembre de 2026.
Rama: `feat/sales-analysis-20261106`. Base: `e68ed51e63043397fb25a0936f8c601d01071435`, de `origin/staging`.
La [especificación](../plans/2026-11-06-sales-analysis-spec.md) define el comportamiento aceptado.

## Resultado local

- API: 2,161 pruebas aprobadas. Hay 29 pruebas omitidas por la configuración existente.
- Dashboard: 633 pruebas aprobadas.
- Contrato: 113 pruebas aprobadas. Incluyen fechas válidas, límites y versiones de grupos.
- Dart: constructores y serialización del contrato generado aprobados. El POS conserva la versión del paquete en su archivo de dependencias.
- PostgreSQL: siete pruebas de integración aprobadas con los roles reales `api` y `worker`.
- TypeScript de API y compilaciones de API y Dashboard: aprobados.
- ESLint de API: aprobado, sin advertencias.
- ESLint de Dashboard: sin errores. Conserva sus 68 advertencias existentes; la regla de referencia pasa.
- Las traducciones de español e inglés compilan en modo estricto.
- Las migraciones de grupos e índices admiten una segunda aplicación en PostgreSQL.
- Una base nueva aplica las 64 migraciones. Una segunda ejecución omite las 64 mediante sus sumas de verificación.

El navegador usa Chromium con ventana real por CDP, Playwright y la API completa de NestJS.
La sesión de prueba firma un JWT local. Los guards reales resuelven usuario, negocio y permisos.
La base y los datos son sintéticos. No se consultaron datos reales de ONCA.

El recorrido comprueba:

1. Frecuencias conjuntas y condicionales con sus conteos.
2. Comparación del negocio completo y una sucursal.
3. Creación, recarga, edición y eliminación de un grupo persistido.
4. Un periodo con devolución y sin tickets de venta.
5. Un fallo de red en el reporte y su reintento con los mismos filtros.
6. Un fallo de red al actualizar grupos y su reintento con los mismos filtros.
7. Pantalla móvil de 390 píxeles, sin desbordamiento horizontal de la página.

La única interrupción de red es deliberada para probar recuperación. Los importes y las respuestas financieras vienen de la API real.
La prueba de base de datos cubre un pedido a las 03:30 y su cobro a las 04:30, con corte a las 04:00.
La venta conserva la fecha del recibo y la hora comercial del pedido.
Otra prueba ejecuta dos ediciones simultáneas: una se confirma y la otra recibe un conflicto.
La prueba de aislamiento consulta bajo RLS e intenta vincular un producto ajeno mediante una clave externa compuesta.

## Revisión de código

La skill `code-review` ejecutó dos ejes independientes.

### Standards

La revisión encontró la pérdida de filtros durante reintentos y un argumento booleano para guardar o eliminar grupos.
La corrección conserva el estado del reporte y las últimas opciones válidas. Usa acciones explícitas para guardar y eliminar.
El revisor confirmó ambas correcciones y la prueba de recuperación de opciones.
No quedan hallazgos concretos de este eje.

### Spec

La revisión encontró una fecha de pedido que sustituía la fecha contable y un denominador condicional ausente en la interfaz.
La corrección conserva `receipt_snapshot.business_date` y muestra ambos conteos junto al porcentaje.
El revisor confirmó ambas correcciones.
No quedan hallazgos concretos de este eje.

## Repetir la comprobación

Standards: dos hallazgos resueltos. Spec: dos hallazgos resueltos. Los revisores confirmaron las correcciones.

Usa una base local construida con `db/00_run.sh` y `db/migrate.sh`.
Aplica `apps/umi-api/test/integration/harness-roles.sql` para los roles de prueba.
Las variables `DATABASE_URL_APP` y `DATABASE_URL_WORKER` deben apuntar a esa base aislada.
La suite requiere una base con el esquema actual y las migraciones 063 y 064.

```sh
pnpm --filter @umi/contract test
pnpm --filter @umi/api typecheck
pnpm --filter @umi/api test
pnpm --filter @umi/api exec vitest run --config vitest.integration.config.ts src/modules/dashboard-operations/sales-analysis.integration.ts
pnpm --filter @umi/dashboard test
pnpm --filter @umi/api lint
pnpm --filter @umi/dashboard lint
pnpm check:lint-warnings
```

Para repetir los clics, inicia API y Dashboard contra la base local `umi_sales_analysis`.
El puerto de API usado fue 4016. El puerto de Dashboard fue 4015, con proxy a la API.
El script de sesión exige una base local con ese nombre. `JWT_SECRET` debe coincidir con la API local.
Node 24.21 ejecutó la utilidad de datos; pnpm 10.29.3 ejecutó las suites.

```sh
node tools/ux-sweep/seed-sales-analysis.mjs /ruta/local/session.json
UX_CDP_PORT=9233 UX_CHROME_PROFILE=/ruta/local/chromium bash scripts/ux-browser.sh
SALES_ANALYSIS_SESSION=/ruta/local/session.json UX_BASE=http://127.0.0.1:4015 UX_CDP=http://127.0.0.1:9233 node tools/ux-sweep/sales-analysis.mjs
UX_CDP_PORT=9233 bash scripts/ux-browser.sh --stop
```

El script conserva las capturas en `.sales-analysis-browser/` o en `UX_OUT`.
La sesión local contiene un token de prueba y debe quedar fuera del control de versiones.
La verificación local no reemplaza la revisión de datos históricos de ONCA en el entorno autorizado.
Este trabajo no despliega cambios a producción.
