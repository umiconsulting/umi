# Verificación de inventarios, fase 1

Base: `da664d42`, rama `fix/inventory-phase1`.
Las verificaciones usan datos sintéticos locales.

## Resultado funcional

- El ajuste conserva decimales, signo, cero y versión del saldo. Muestra Guardar ajuste y Cancelar.
- El editor de recetas conserva escala, unidad y factor de conversión.
- Cada ajuste ejecuta una sola llamada al registro de movimientos.
- Compras y recepciones normalizan cantidades a la escala del artículo y rechazan conversiones no exactas.
- Un conteo obsoleto se puede cancelar con autorización, versión y auditoría.
- Un conteo ocupado devuelve un aviso para reintentar. No sobrescribe movimientos posteriores.
- El POS separa el permiso de consulta del permiso de historial y descarta respuestas anteriores.
- El POS actualiza el conteo cuando otro operador lo modifica o cancela. Limpia las cantidades y aprobaciones obsoletas.
- El formulario de artículos usa términos sencillos y cantidades en su unidad. Conserva la diferencia entre un campo vacío y cero.
- Los controles mantienen su altura y no se superponen en escritorio ni en móvil. La acción de consulta se llama «Ver costos».

## Evidencia

| Verificación                                                | Resultado                                                                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm check:pr`                                             | Pasa, incluido el control de advertencias existentes                                    |
| Build, lint y tests afectados, con concurrencia 1           | 8 tareas correctas                                                                      |
| API                                                         | 2115 pruebas correctas, 29 omitidas                                                     |
| Dashboard                                                   | 419 pruebas correctas                                                                   |
| Contrato                                                    | 99 pruebas correctas                                                                    |
| Tipos de API, contrato y clientes generados TypeScript/Dart | Correctos                                                                               |
| Integración de esquema, PostgreSQL 17 y UTF-8               | 315 correctas; 2 verificaciones opcionales de migración de recompensas omitidas         |
| POS                                                         | 50 pruebas correctas; análisis de los archivos afectados sin problemas                  |
| Chromium contra API local                                   | Ajustes, recetas, cancelación y reintento del conteo correctos; cero errores JavaScript |
| macOS nativo                                                | 40 pruebas correctas en la aplicación nativa                                            |

El dashboard conserva 68 advertencias de lint existentes. El control de advertencias confirma que no hay una categoría nueva.
La compilación muestra avisos existentes de Vite y tamaño de fragmentos.
El formulario se verificó a 1440, 1280, 390 y 320 píxeles de ancho. No hubo solapamientos ni desbordamiento horizontal.
Los tests nativos usan un repositorio simulado. No prueban una operación completa del POS contra la API.
La prueba nativa usó ajustes temporales de CocoaPods y firma local; los archivos originales se restauraron al terminar.
Una prueba necesitó volver a enfocar el campo antes de corregir el texto, como hace un operador. No se cambió código del producto para ese caso.

## Decisiones

- La cancelación usa `inventory.count.create` y exige versión e intento actuales. Un cambio de criterio requiere ajustar ese permiso.
- La corrección de ajustes también cubre las llamadas equivalentes de devolución y producción. Todas conservan el registro canónico de movimientos.
- El conteo obtiene bloqueos sin esperar. Si un movimiento ocupa el artículo, el operador debe reintentar.

## Entrega y alcance posterior

Aplicar `supabase/migrations/20261030000000_inventory_count_recovery.sql` antes de activar esta versión del backend.
La migración es aditiva y admite una segunda ejecución.
La entrega incluye un PR. No incluye fusionar la rama ni desplegarla.

La captura directa de compras y la acción «Preparar» en el dashboard quedan para las siguientes fases.
Las plantillas e importación de artículos y recetas, las fotos de comprobantes y el vínculo entre receta y consumo van en PRs posteriores.
El pronóstico, el calendario de compras y los avisos al dueño siguen en el plan de fases posteriores.

Herramientas: Node 22.23.3, pnpm 10.29.3, PostgreSQL 17, Flutter 3.47.5 y Chromium controlado mediante Playwright/CDP.
Se usan los scripts del repositorio y `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md`.

## Revisiones

Cada tarea recibió revisión de requisitos y código. La revisión final también cubrió las correcciones posteriores y el formulario simplificado.
Los hallazgos sobre permisos, bloqueo de conteos y actualización de datos del POS se corrigieron y se revisaron de nuevo.

## Repetición de las comprobaciones

Usar una base local PostgreSQL 17 con UTF-8 y los roles del harness del repositorio.
Aplicar build-v3, las migraciones posteriores y la migración de recuperación de conteos.

```sh
pnpm check:pr
VITE_UMI_ENVIRONMENT=test VITE_AUTH_MODE=cookie VITE_API_BASE= pnpm turbo run build lint test --filter="...[origin/main]" --concurrency=1
pnpm --filter @umi/api typecheck
pnpm --filter @umi/contract typecheck
pnpm --filter @umi/api test:integration:schema
```

La integración requiere las variables DATABASE_URL_APP, DATABASE_URL_WORKER y DATABASE_URL_ADMIN de esa base local.
Ejecutar las pruebas Flutter de inventory, inventory_quantity, inventory_production y gate8a_operator_experience desde apps/umi-pos.
