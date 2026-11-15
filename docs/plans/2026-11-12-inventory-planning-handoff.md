# Inventarios: implementación, propuestas y guía de revisión

## Alcance del PR

Continúa la entrega `umi-inventarios-entrega-completa-2026-11-10`. Añade días de compra, pronóstico de unidades vendidas, necesidades de ingredientes y preparaciones, sugerencias de reposición, avisos opcionales, renovación de políticas de inventario y recuperación de guardados de recetas después de recargar el navegador.

Base actualizada: `b6208f61`, rama `staging`, que ya incorpora el PR #268 de compras manuales/foto/XML. Ese trabajo no se vuelve a introducir en este PR. El usuario autorizó implementar propuestas y revisarlas al final; las decisiones siguientes son revisables, no reglas comerciales previamente acordadas.

La lógica nueva queda en la API y el dashboard existentes. Se usan sus módulos de inventario y ajustes; no hay una aplicación ni un servicio predictivo adicional. Contratos generados y migraciones permanecen en las carpetas canónicas del monorepo. No se copió la entrega completa ni sus archivos históricos.

## Dónde está cada cambio

| Área          | Archivos principales                                                                                                 | Responsabilidad                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Planificación | `apps/umi-api/src/modules/inventory-costing/inventory-planning*.ts`                                                  | Lecturas, calendario operativo, pronóstico, necesidades, avisos y pruebas.              |
| Ajustes       | `apps/umi-api/src/modules/merchants/`                                                                                | Persistir días y preferencia de correo, con validación de entrada.                      |
| Política      | `apps/umi-api/src/modules/pos-inventory/pos-inventory.repository.ts`                                                 | Crear o renovar la política al consultar inventario mediante un flujo autorizado.       |
| Interfaz      | `apps/umi-dashboard/src/screens/inventory-planning.*`, `settings-purchase-days.jsx`, `settings-inventory-alerts.jsx` | Plan y preferencias; reutilizan navegación, estilos y autenticación.                    |
| Recuperación  | `recipe-workspace.jsx`, `recipe-recovery.js`, `data.jsx`                                                             | Conservar solicitud, identidad y ámbito del guardado de recetas.                        |
| Contrato      | `packages/contract/src/inventory-costing.ts`, `route-table.ts`, `routes.ts`                                          | `GET /api/merchants/:merchantId/inventory-costing/plan`, esquemas y clientes generados. |
| Base de datos | `db/migrations/066_inventory_purchase_days.sql`, `067_inventory_planning_alerts.sql`                                 | Días, preferencia de correo y registro de intentos con aislamiento por negocio.         |

## Propuestas implementadas para revisar

| Decisión                    | Regla implementada                                                                                                                                                                                                                                                                            | Qué deben revisar los responsables del producto                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 · Horizonte             | Desde hoy hasta el día anterior a la próxima compra. Si hoy es día de compra, busca el siguiente. Usa zona horaria y corte operativo del negocio. Hoy cuenta completo.                                                                                                                        | Confirmar si las compras se reciben al iniciar el día y si conviene descontar las ventas ya realizadas hoy en otra versión.                                       |
| D02 · Pronóstico            | Media del mismo día de semana de los últimos 56 días completos; mínimo cuatro observaciones desde la primera venta del producto/variante. Sin historial suficiente se muestra ausencia de estimación.                                                                                         | Aprobar ventana, mínimo y tratamiento de cierres. No son parámetros estadísticamente óptimos demostrados.                                                         |
| D03 · Ventas netas          | Ventas confirmadas menos cantidades compensadas por devoluciones/anulaciones confirmadas, atribuidas al día original y sin valores negativos. Variantes separadas, con asignación general como respaldo.                                                                                      | Confirmar si demanda comercial debe usar ventas brutas en vez de netas.                                                                                           |
| D04 · Consumo               | Recetas vigentes, rendimientos y conversiones. Disponibilidad canónica descontando reservas, daño y cuarentena. Compras no recibidas no cuentan.                                                                                                                                              | Revisar productos nuevos, ingredientes inactivos, modificadores y recetas incompletas.                                                                            |
| D05 · Reposición            | `max(0, consumo previsto + mínimo − disponible)`. Sin mínimo se usa cero como reserva, conservando “Sin configurar” en pantalla. Saldo negativo aumenta la necesidad.                                                                                                                         | Aprobar el mínimo como reserva al final del periodo. No hay porcentaje oculto ni compra automática.                                                               |
| D06 · Preparaciones y costo | Se acumula la demanda de todos los productos antes de descontar una preparación compartida. Solo la cantidad que falta preparar genera demanda de ingredientes. Cada fila distingue “Preparar” de “Comprar”. Fracciones exactas y redondeo hacia arriba en la unidad mínima de cada artículo. | No se redondea por caja ni por lote productivo. El costo de compra usa la base canónica del negocio; las preparaciones no reciben un costo de compra inventado.   |
| D07 · Canal                 | Aviso dentro del plan, con preferencia por navegador/negocio. Correo opcional al dueño activo y no limitado a una sucursal, con permiso vigente `merchant.manage` y dashboard activo.                                                                                                         | No se incorporaron WhatsApp ni push. El correo se habilita por negocio, no por destinatario individual.                                                           |
| D08 · Frecuencia            | Comprobación cada 15 minutos, después de las 09:00 locales. Como máximo un intento por negocio, dueño y fecha operativa, solo con plan completo y faltantes.                                                                                                                                  | Aprobar horario y resumen diario. Un faltante persistente puede aparecer al día siguiente, pero no por cada consulta.                                             |
| D09 · Política              | Alta conservadora si falta; renovación por un día si venció. Conserva restricciones y cambia versión/huella. Se serializa por sucursal y registra auditoría.                                                                                                                                  | La renovación sucede al consultar inventario, no mediante un proceso que cambie políticas de todas las sucursales. Un cliente con huella anterior debe refrescar. |

### Límites que deben permanecer explícitos

- Los días sin ventas registradas, después de la primera venta, se consideran cero. No hay un calendario de cierres ni detección automática de interrupciones de captura. La pantalla explica este sesgo.
- Se reserva un bloque de siete días para comparar MAE con la referencia de la semana anterior. No es una evaluación de producción ni una validación con múltiples cortes. La consulta limita las compensaciones de entrenamiento por fecha operativa y momento de confirmación; las ventas confirmadas después del corte no aportan unidades de entrenamiento.
- La consulta aplica recetas actuales a unidades previstas. No proyecta promociones futuras ni preferencias de modificadores: los componentes específicos de modificadores no forman parte de esta estimación base.
- Si falta historial o asignación resoluble de algún producto considerado, se ocultan las cantidades de reposición del plan completo. Es una regla conservadora, no una estimación parcial presentada como completa.
- “Todas las sucursales” suma existencias y ventas; no propone traslados. Revisar una sucursal concreta para tomar decisiones locales. Los costos siguen la base canónica del negocio.
- El plan no crea compras, reservas, preparaciones ni movimientos. Para reflejar una recepción o ajuste se puede pulsar **Actualizar**; también se recalcula al volver a enfocar la ventana o entrar de nuevo.
- El correo no acredita entrega en bandeja: `sent` significa aceptación por el adaptador SMTP. `sending` o `unknown` requiere revisión y nunca se reenvía automáticamente. No se promete entrega exactamente una vez.
- El seguimiento existente de lotes por artículo/periodo no demuestra que una venta concreta salió de un lote determinado.

El fundamento y las alternativas están en [la investigación de propuestas](../research/2026-11-11-inventory-planning-proposals.md). Las reglas de esta sección describen la implementación final y prevalecen sobre opciones exploratorias de esa investigación.

## Recorridos de revisión manual

Usar datos de prueba y cuentas propias. No pegar credenciales en el PR.

1. **Días:** entrar a Ajustes → Días de compra; elegir lunes/jueves, guardar y recargar. Deben persistir. Cambiar y cancelar no debe enviar un PATCH. Desmarcar todos y guardar deja el estado “Sin configurar”. El formulario guarda solo su campo.
2. **Plan:** Inventario → Costos y márgenes → Plan de compra. Debe mostrar negocio/sucursal, zona horaria, fecha de cálculo, historial y horizonte. Un negocio sin ventas muestra “Sin historial suficiente”; no reemplaza cantidades desconocidas por cero.
3. **Datos suficientes:** usar ventas confirmadas durante al menos nueve semanas para disponer también de validación histórica. Comparar la demanda de un producto y su variante con sus recetas activas; cambiar de sucursal y comprobar el ámbito visible.
4. **Preparación compartida:** dos productos usan la misma preparación. Con demanda total de 10 unidades, 6 disponibles y mínimo 1, debe sugerir preparar 5. Si cada unidad usa 1.5 de un ingrediente y hay demanda directa adicional de 0.5, el consumo previsto del ingrediente es 8; con disponible 2 y mínimo 1, su compra sugerida es 7.
5. **Costos y saldos:** revisar saldo negativo, mínimo ausente, costo inicial cero y costo ausente. Recibir una compra o hacer un ajuste autorizado; actualizar el plan. No deben aparecer movimientos creados por la consulta.
6. **Política:** en una base desechable, consultar inventario en una sucursal sin política. Debe aparecer una sola política y, si hace falta, un área de inventario. Una política vencida se renueva sin cambiar sus restricciones; una vigente conserva huella. Una mutación con huella vieja debe rechazarse.
7. **Recuperación:** guardar una receta, simular pérdida de respuesta, recargar y usar “Reintentar guardado”. Debe conservar cuerpo, negocio, sucursal, `commandId` e `idempotencyKey`. Cambiar negocio no debe enviar la solicitud anterior al negocio nuevo. Confirmar reemplazo de asignación constituye un cuerpo nuevo y usa identidades nuevas.
8. **Avisos:** en Ajustes activar correo únicamente contra un buzón local. Deben cumplirse las condiciones del siguiente apartado. Repetir consultas o ejecutar dos procesos no debe duplicar el intento diario. Desactivar la preferencia impide nuevos intentos.
9. **Permisos:** una sesión sin `merchant.manage` no debe consultar el plan; el backend aplica también membresía, producto activo y ámbito de sucursal. Revisar un negocio ajeno con una cuenta sin membresía debe rechazarse.

## Configuración y operación

Aplicar primero las migraciones con el mecanismo habitual: `bash db/migrate.sh <base-o-url>`. Los números 066 y 067 siguen a 065, ya incorporada por #268. Se preservan datos existentes; los días comienzan vacíos y el correo desactivado. Las migraciones quedan registradas por checksum; no editar un archivo ya aplicado.

Para correo hacen falta **ambas** habilitaciones: `INVENTORY_PLANNING_EMAIL_ENABLED=true` en la API y `inventoryPlanningEmailEnabled=true` en los ajustes del negocio. También se necesitan `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM`, `PUBLIC_DASHBOARD_URL` y, si el relay lo exige, las credenciales SMTP habituales. La variable global está documentada en `.env.example` y su valor por defecto es `false`.

No se configuró ni verificó correo de producción. La prueba de transporte utilizó Mailpit local y destinatarios sintéticos. No se enviaron mensajes reales.

### Troubleshooting

| Síntoma                                  | Comprobación                                                                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No aparecen sugerencias                  | Días configurados, historial suficiente por producto/variante, ingredientes activos y recetas completas. Consultar `warnings` del endpoint.                                                                     |
| Cambió la estimación tras una devolución | La venta histórica se usa neta; revisar cantidades compensadas confirmadas.                                                                                                                                     |
| Parece excesiva la compra                | Revisar mínimo, saldos negativos, reservas, fecha de compra, selección de sucursal y que hoy se cuenta completo. No incluye compras todavía pendientes.                                                         |
| No llega correo                          | Revisar preferencia, bandera global, SMTP/remitente, hora local, rol activo del dueño, permiso, suscripción y que el plan esté completo con faltantes.                                                          |
| Un envío aparece incierto                | Consultar `merchant.inventory_planning_delivery` y el proveedor por negocio/fecha. No borrar el registro ni reenviar sin resolver si el proveedor lo aceptó. El siguiente día operativo tiene identidad propia. |
| Guardado de receta sin confirmar         | Mantener el almacenamiento de la pestaña y reintentar desde la receta recuperada. No fabricar otra identidad para el mismo intento. El cierre completo de la pestaña puede eliminar `sessionStorage`.           |
| Política cambiada                        | Volver a consultar inventario y usar la nueva huella; no ignorar el error ni volver a enviar una mutación con datos obsoletos.                                                                                  |

## Verificación realizada

Entorno aislado: PostgreSQL 17, roles reales `api` y `worker`, Redis local, API y dashboard locales. Se verificó la aplicación de migraciones 066/067 y, después de actualizar staging, 065. No se usaron datos de producción.

| Verificación                                                                                         | Resultado registrado                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API: inventario, planificación, compras, DTO y ajustes                                               | 150 pruebas unitarias aprobadas, 15 archivos.                                                                                                                            |
| Dashboard: recetas, costos, variaciones, preparación, inventario y días                              | 166 pruebas unitarias aprobadas, 7 archivos.                                                                                                                             |
| PostgreSQL: compras, autoría, costos, ventas con recetas, costo inicial, preparación y política/plan | 131 pruebas de integración aprobadas, 7 archivos. Incluyen lotes, etiquetas y alérgenos de las suites existentes.                                                        |
| Navegador visible con respuestas controladas                                                         | 6 recorridos aprobados: dos de días de compra y cuatro de recuperación de recetas, incluida recarga completa.                                                            |
| Navegador visible con API real                                                                       | Guardado y recarga de días, plan HTTP 200, ancho móvil de 390 px, entradas inválidas HTTP 400 y permisos por negocio verificados.                                        |
| SMTP local                                                                                           | Una aceptación y un mensaje en Mailpit tras dos instancias simultáneas y un intento adicional. La condición de faltante fue un dato controlado del ensayo de transporte. |
| Compilación                                                                                          | Contrato, API y dashboard compilados; typecheck de API aprobado. Dashboard mantiene advertencia de tamaño de chunks.                                                     |

Lint, límite de advertencias y formato aprobados localmente. El límite registra 69 advertencias existentes, sin categorías nuevas.

### Corrección del control automático del PR

Se corrigieron las actualizaciones síncronas de estado dentro de efectos. Los controles de reintento y actualización ahora preparan el estado. El cambio de negocio conserva el reinicio por clave del componente.

Se eliminó una importación sin uso y una supresión obsoleta. Las consultas del plan comparten una exportación de datos y conservan el cliente HTTP existente. No se elevó el límite de advertencias ni se desactivaron reglas.

El mock de PostgreSQL declara los parámetros que inspeccionan las aserciones. Esto corrige el fallo de TypeScript del control `build-and-test`. Las capturas de Playwright usan el directorio temporal del sistema, compatible con Linux y macOS.

La regresión comprueba ingredientes inactivos y recuperación de solicitudes. Después de una recarga completa, el reintento conserva el cuerpo y las identidades del reemplazo confirmado.

**Alcance:** las verificaciones corresponden al entorno local y los datos sintéticos. La aceptación integral en staging, las decisiones D01–D09 y la activación real del correo corresponden al equipo.

### Comandos para reproducir en revisión

Desde la raíz, con dependencias instaladas:

```bash
pnpm lint
pnpm check:lint-warnings
pnpm format:check
pnpm --filter @umi/api typecheck
pnpm --filter @umi/contract build
pnpm --filter @umi/contract generate:check
pnpm --filter @umi/api build
VITE_UMI_ENVIRONMENT=test VITE_AUTH_MODE=cookie pnpm --filter @umi/dashboard build
```

Pruebas unitarias de API, ejecutadas desde `apps/umi-api` para expandir los patrones:

```bash
pnpm test src/modules/inventory-costing/*.spec.ts src/modules/pos-inventory/*.spec.ts src/modules/inventory-authoring/*.spec.ts src/modules/procurement/*.spec.ts src/modules/merchants/dto/update-settings.dto.spec.ts src/modules/merchants/merchants.service.spec.ts
```

Desde la raíz:

```bash
pnpm --filter @umi/dashboard test src/data.purchase-days.spec.jsx src/screens/recipe-recovery.spec.js src/screens/recipe-model.spec.js src/screens/costing-model.spec.js src/screens/variance-model.spec.js src/screens/inventory-production-model.spec.js src/screens/inventory-model.spec.js
pnpm --filter @umi/dashboard exec playwright test e2e/purchase-days.pw.js e2e/recipe-sales-recovery.pw.js --headed
```

Con `DATABASE_URL_APP` y `DATABASE_URL_WORKER` de una base **desechable** preparada con el esquema y sus migraciones, desde `apps/umi-api`:

```bash
pnpm exec vitest run --config vitest.integration.config.ts src/modules/inventory-costing/inventory-planning.integration.ts src/modules/inventory-costing/inventory-costing.integration.ts src/modules/inventory-authoring/inventory-authoring.integration.ts src/modules/inventory-authoring/inventory-initial-cost.integration.ts src/modules/inventory-authoring/inventory-recipe-sales.integration.ts src/modules/pos-inventory/inventory-preparation.integration.ts src/modules/procurement/procurement.integration.ts
```

La nueva suite de política/plan también está incluida en `test:integration:schema` para CI. Los tests crean datos propios; nunca apuntarlos a producción.

## Estado de la entrega y siguientes responsables

| Historias | Estado de este PR                                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H01–H10   | Funciones previas; no se reconstruyen. Compras de #268 ya están en staging. Se ejecutaron regresiones relacionadas.                                               |
| H11–H14   | Días, ventas previstas, necesidades y reposición implementados con las reglas propuestas arriba.                                                                  |
| H15–H16   | Canal SMTP comprobado localmente y avisos implementados; activación real y comprobación de producción pendientes.                                                 |
| H17–H18   | Política automática comprobada con PostgreSQL. Recuperación tras recarga y reintento exacto comprobados en navegador.                                             |
| H19       | Validación integral en staging pendiente de revisión e integración de este PR.                                                                                    |
| H20       | Promoción a producción pendiente; no se realiza desde este trabajo.                                                                                               |
| H21       | Opciones adicionales como PDF/OCR ampliado no incorporadas; no eran parte aprobada de estas propuestas.                                                           |
| H22       | Suites existentes de costos, diferencias, preparaciones y autoría ejecutadas. La aceptación operativa en staging y sus límites de trazabilidad siguen pendientes. |

Para continuar con Codex: leer este documento y la investigación enlazada, comprobar la rama/base actuales, ejecutar solo las verificaciones pendientes o afectadas, revisar D01–D09 con el equipo y registrar la validación de staging. No asumir que el correo está activado ni que este PR ya fue fusionado o desplegado.

### Permisos comprobados con API real

- Dueño y operador con `merchant.manage`: plan HTTP 200.
- Usuario con solo `inventory.read`: plan HTTP 403.
- Negocio ajeno al operador: HTTP 404, sin exponer su existencia.
- Días nulos, repetidos o fuera del rango: HTTP 400.
- El dueño del ensayo pertenece a ambos negocios; su acceso a ambos es válido.

### Cierre del control de migraciones

El control completo de API detectó que la migración 067 carecía de `DROP POLICY IF EXISTS` antes de crear su política. Se agregó la guarda exigida por el repositorio. La política conserva su aislamiento por negocio. La suite `migration-shape.spec.ts` verifica esta convención.
