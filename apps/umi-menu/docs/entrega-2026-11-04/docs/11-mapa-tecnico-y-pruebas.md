# Mapa técnico para las tareas y sus pruebas

Revisión local del 4 de noviembre de 2026. HEAD: `dea2dfc718e4c10772a1a950c796e82a08fa5e55`. Referencia local origin/staging: `91aad9489ad440759e92342e6401c86092bf0e2e`.

No se hizo fetch durante la descomposición. Actualiza staging y vuelve a comprobar las rutas antes de implementar. Las rutas siguientes pertenecen al repositorio real de Umi.

Este mapa identifica puntos de entrada existentes. Las tareas detallan resultados; no inventan nombres de endpoints, firmas, columnas o migraciones futuras.

## Áreas de implementación

Las rutas abreviadas bajo `src/` parten de `apps/umi-api/`.

| Área del backlog | Fuentes existentes | Pruebas o evidencia pertinente |
| --- | --- | --- |
| `configuracion` | `src/modules/merchants/merchants.controller.ts`, `merchants.service.ts`, `merchants.repository.ts`, `dto/update-settings.dto.ts` | `merchants.service.spec.ts`, `locations.integration.ts`. |
| `permisos` | `src/modules/auth/merchant-access.guard.ts`, `roles.guard.ts`, `location-authority.ts` | `guards.spec.ts`, `location-authority.spec.ts`. |
| `horarios` | `src/modules/business-hours/business-hours.service.ts`, `business-hours.repository.ts`, `ordering-settings.repository.ts`, `open-hours.ts` | `business-hours.service.spec.ts`, `open-hours.spec.ts`. |
| `table_order` | `src/modules/table-order/table-order.controller.ts`, `table-order.service.ts`, `table-order-rate-limit.guard.ts` | `table-order.integration.ts`: HTTP, alcance, precios, opciones, límite e idempotencia. |
| `catalogo` | `src/modules/pos-catalog/pos-catalog.repository.ts` y las lecturas de mesa | Integración de mesa y pruebas del catálogo afectado. |
| `contratos` | `packages/contract/src/table-order.ts`, `packages/contract/src/` y generador existente | `generate:check`, `typecheck`, pruebas de contrato. |
| `ordenes` | `src/shared/orders/order-writer.ts`, `src/modules/orders/orders.service.ts`, `orders.repository.ts`, `src/modules/integrity/integrity.repository.ts` | `order-writer.spec.ts`, `orders.service.spec.ts`, `integrity.repository.spec.ts`. |
| `kds` | `src/modules/kds/kitchen-projector.ts`, `kitchen-domain.ts`, `kds.repository.ts`, `kds.service.ts` | `kitchen-projector.spec.ts`, `kitchen-domain.spec.ts`, `kds.repository.integration.spec.ts`. |
| `cancelacion` | `src/shared/orders/cancel-sent-order-line.ts`, `void-after-preparation-fingerprint.ts`, `src/modules/pos-cart/pos-cart.repository.ts` | `void-after-preparation-fingerprint.spec.ts`, `pos-cart.repository.spec.ts`, `test/integration/cancel-sent-cart-line.sql`. |
| `checkout` | `src/modules/pos-cart/pos-cart.service.ts`, `src/modules/pos-checkout/pos-checkout.repository.ts` | `pos-cart.service.spec.ts`, `pos-checkout.repository.spec.ts`, `checkout-order-kitchen.integration.ts`. |
| `inventario` | `src/modules/pos-inventory/` e integración de inventario del checkout | Scripts `umi-pos:inventory-api-tests`, `umi-pos:inventory-tests` y sus pruebas de integración pertinentes. Cerrar MD-A02 primero. |
| `jobs` | `src/jobs/queue.repository.ts`, `outbox-relay.service.ts`, `outbox-routes.ts`, `enqueue.service.ts`, `dead-letter.service.ts`, `job-options.ts` | Suites homónimas `.spec.ts`; ejemplos de scheduler en `customer-value-expiry.scheduler.ts`. |
| `correo` | `src/shared/adapters/email.adapter.ts` | `email.adapter.spec.ts` y receptor local. La entrega real necesita evidencia del proveedor y receptor. |
| `dispositivos` | `src/modules/devices/devices.repository.ts`, `devices.service.ts`, `devices.controller.ts` | `devices.service.spec.ts`, `devices.controller.spec.ts`, `device-credential.integration.ts`. |
| `dashboard` | `apps/umi-dashboard/src/screens/products-hub.jsx`, `hours.jsx`, `orders.jsx`; navegación y loaders vigentes | Navegador real; leer `apps/umi-dashboard/AGENTS.md`. |
| `reportes` | `src/modules/dashboard-operations/dashboard-operations.repository.ts`, `dashboard-operations.service.ts`; `packages/contract/src/reports.ts`; `apps/umi-dashboard/src/screens/orders.jsx`, `ventas-report.jsx`, `src/data.jsx` | `dashboard-operations.repository.spec.ts`, `orders.repository.spec.ts`; conciliación con ventas cobradas y recorrido de Dashboard. |
| `pos` | `apps/umi-pos/lib/features/cart/incoming_orders_surface.dart` y superficies nativas de cuenta/cobro | `apps/umi-pos/test/incoming_orders_test.dart`, `incoming_orders_surface_test.dart`; recorridos nativos. |
| `frontend_menu` | Fuente visual en `fuentes/umi-menu-preview/.../content/menu-v6.html` y `menu-redesign.css` de la entrega | Comparación visual y recorridos reales del frontend que se integre según MD-A10. |
| `despliegue` | `.github/workflows/umi-api-deploy-staging.yml`, `deploy-dashboard.yml`, `umi-api-deploy.yml`, `deploy/staging/` | CI y revisión desplegada; no basta que exista un workflow. |
| `operacion` | Playbook local, configuración del entorno y procedimientos del equipo | Evidencia de staging, responsables y ensayos de recuperación. |

## Hallazgos que afectan las tareas

- La configuración de recepción actual usa columnas `whatsapp_*`. No reutilizarlas como pausa genérica de todos los canales.
- `table-order` todavía rechaza variantes. MD-H03 debe cubrir el camino completo y su validación de servidor.
- El escritor proyecta a KDS. MD-H07/08 deben cambiar el momento para recogida sin romper mesa/POS existentes.
- Las suites existentes no prueban automáticamente la aceptación nueva, la reserva o los avisos de correo del menú.
- Las rutas outbox revisadas no incluyen correo de pedidos. Hay que definir productor y consumidor en MD-H18.
- La marca del relay como entregado al sistema de colas no prueba entrega de correo al cliente.
- `last_seen_at` se actualiza al autenticar un dispositivo. No demuestra que haya personal disponible.
- No se encontró un liberador de recogidas programadas en `src/jobs`. Sus schedulers son referencias de mecanismo.
- La integración de corrección/cobro desactiva stock y simula lealtad. No usarla como evidencia de inventario de MD-H14.
- Mesa ya escribe `source: 'web'`. El historial tiene metadatos de canal y modalidad, pero sus filtros visibles solo enumeran POS y WhatsApp. El reporte incluye Web y conserva un texto de atribución centrado en WhatsApp. MD-H33 verifica y completa ese recorrido con datos reales.
- `docs/architecture/2026-09-13-pos-channel-attribution-adr.md` describe un antecedente de atribución. Contrasta sus observaciones históricas con el checkout vigente y MD-A03; no implementes duplicación comercial basándote solo en ese documento. El ingreso del reporte debe proceder de ventas cobradas, no del total de pedidos pendientes.

## Comandos de referencia comprobados en los manifiestos

Los comandos siguientes existen en el código revisado. **No se ejecutaron en esta tarea de documentación.** Usa la versión de herramientas del checkout vigente.

El monorepo declara pnpm `10.29.3`. La API requiere Node `>=22`. El prototipo tiene sus propios requisitos; no confundir ambos.

Desde el root de Umi, comprobaciones de contrato y API:

```sh
pnpm --filter @umi/contract generate:check
pnpm --filter @umi/contract typecheck
pnpm --filter @umi/contract test
pnpm --filter @umi/api typecheck
pnpm --filter @umi/api exec vitest run src/shared/orders/order-writer.spec.ts
pnpm --filter @umi/api exec vitest run src/shared/adapters/email.adapter.spec.ts
```

Para el ejemplo de integración pública de mesa, con base de pruebas y variables requeridas ya configuradas:

```sh
pnpm --filter @umi/api exec vitest run --config vitest.integration.config.ts src/modules/table-order/table-order.integration.ts
```

Para la integración de KDS, con sus fixtures y `GATE4A_DATABASE_URL` configurados:

```sh
pnpm --filter @umi/api exec vitest run src/modules/kds/kds.repository.integration.spec.ts
```

Para los gates del PR con base explícita a staging:

```sh
PR_BASE_REF=origin/staging pnpm check:pr
pnpm turbo run build lint test --filter='...[origin/staging]'
```

Selecciona además las pruebas de integración y la UI pertinentes para la historia. Los comandos generales no garantizan que se haya ejecutado una suite con fixtures específicos.

Para las pruebas de entrantes nativos, desde `apps/umi-pos`:

```sh
flutter test test/incoming_orders_test.dart test/incoming_orders_surface_test.dart
```

El test Flutter no reemplaza un recorrido en el cliente nativo. Lee el playbook vigente antes de iniciar la pila y conducir el POS.

## Requisitos y límites de integración

| Instrumento | Requisito | Riesgo de interpretación |
| --- | --- | --- |
| `vitest.integration.config.ts` | Entorno test y suites `src/**/*.integration.ts`; ejecución serializada. | No incluye automáticamente archivos `.integration.spec.ts`. |
| `table-order.integration.ts` | `DATABASE_URL_APP`, `DATABASE_URL_WORKER`, esquema preparado y roles del harness. | Sin fixture correcto no prueba el comportamiento del canal. |
| `kds.repository.integration.spec.ts` | `GATE4A_DATABASE_URL` y fixtures específicos; configuración Vitest normal. | Puede omitirse si falta variable. Una omisión no equivale a pasar. |
| `checkout-order-kitchen.integration.ts` | `CANCEL_VERIFY_DATABASE_URL`; base desechable preparada cuyo nombre contiene `verify`. | No ejecutar contra una base operativa; la prueba no acredita inventario. |
| Familia `test:integration:schema` | Base nueva desde DDL y fixtures propios. | No acredita datos de una migración real. |
| Familia `test:integration:migration` | Copia preparada con datos migrados según el playbook. | No sustituirla por una base vacía ni mezclar familias sin comprobar prerrequisitos. |

No pegar cadenas de conexión ni credenciales en issues o evidencias. El playbook describe la preparación de bases de prueba. No ejecutar reset o reaplicaciones sobre una base de operación.

Al añadir una suite `.integration.ts`, incluye su ejecución en el script usado por CI en el mismo PR. Existir en disco no garantiza que CI la seleccione.

## CI y staging

La revisión de workflows encontró despliegue de API desde `staging` y un despliegue distinto desde `main`. El Dashboard también distingue ambas ramas.

Algunos comentarios y triggers históricos de CI mencionan `build-v3`. No asumir que todo chequeo del commit integrado en staging se ejecuta solo por haber pasado el PR. Verifica qué jobs corrieron y qué revisión se desplegó.

La consulta de workflows fue lectura de código local. No se inspeccionaron ejecuciones recientes ni el runtime de staging en este trabajo.

## Evidencia que adjuntar a cada historia

1. Identificador del issue, PR y revisión comprobada.
2. Versiones pertinentes de API, contrato, POS y esquema.
3. Comandos, resultado, pruebas omitidas y motivo.
4. Escenario de staging de la historia con datos sintéticos.
5. Capturas o recorrido nativo cuando cambia la UI.
6. Resultado de reintento/concurrencia cuando afecta el ciclo comercial.
7. Procedimiento de desactivación o reversión que preserve pedidos.

Los tests nuevos deben probar el resultado comercial y los casos de error concretos del issue. No basta replicar la implementación en un test ni usar una escena simulada como evidencia del producto.
