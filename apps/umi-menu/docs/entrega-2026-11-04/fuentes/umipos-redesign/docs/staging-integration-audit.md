# Integración del rediseño en staging

Auditoría inicial: 1 de noviembre de 2026. Actualización: 2 de noviembre de 2026.

## Implementación posterior a la auditoría

La rama `feat/redesign-parity` ya contiene cambios en las aplicaciones reales sobre `staging` (`b3e5bf88`).
El trabajo usa un checkout aislado. El checkout original del usuario permanece intacto.

- El dashboard conserva sus pantallas, datos y funciones originales. La suite de paridad comprobó 26 escenarios de navegador.
- Los diez escenarios adicionales de inventario se ejecutaron contra la API local y datos sintéticos actualizados.
- El POS conserva sus controladores. Cambiaron catálogo, distribución de la cuenta, cobro completo/parcial y etiquetas de servicio del KDS.
- La suite nativa seleccionada pasó 312 pruebas. El análisis de los ocho archivos Dart modificados no reportó problemas.
- CI ejecuta pruebas de dashboard y POS antes de compilar. Los workflows iOS obtienen la versión del contrato del mismo commit.
- La conexión autenticada al VPS confirmó la versión de staging. Una copia local del 2 de noviembre conserva los mismos conteos agregados.
- Las pruebas de escritura usan otra base, con datos sintéticos. Sus 35 archivos de integración pasaron 362 pruebas.

La compilación macOS, Android e iOS Simulator está comprobada. Android completó vinculación y acceso con PIN mediante entrada nativa.
La comparación visible mostró que la primera integración conserva demasiado del diseño anterior.
El usuario rechazó esa presentación parcial. El alcance se amplió para reproducir Stageshow en todas las pantallas del POS.
La aceptación visual y el recorrido completo permanecen pendientes hasta comprobar la nueva versión nativa.
Las ventanas de iPhone y Android se prepararon para la revisión visible. No equivalen a certificación de periféricos o proveedores.
El PR permanece pendiente de la verificación final. No se realizó merge ni despliegue de producción.

Reportes en la rama de implementación:

- [Dashboard](https://github.com/umiconsulting/umi/blob/feat/redesign-parity/docs/reports/2026-11-02-dashboard-redesign-parity.md).
- [Presentación del POS](https://github.com/umiconsulting/umi/blob/feat/redesign-parity/docs/reports/2026-11-02-pos-redesign-parity.md).
- [Controles de CI](https://github.com/umiconsulting/umi/blob/feat/redesign-parity/docs/reports/2026-11-02-redesign-release-gates.md).
- [Datos de prueba](https://github.com/umiconsulting/umi/blob/feat/redesign-parity/docs/reports/2026-11-02-redesign-test-data.md).

Las secciones siguientes conservan la investigación inicial. Sus pendientes describen el estado del 1 de noviembre.

## Resultado

El rediseño se puede integrar por PR hacia `staging`. El POS requiere una implementación en Flutter sobre sus controladores actuales. El dashboard permite una implementación independiente en React. Stageshow sirve como referencia visual y de interacción; sus pruebas no certifican cobros, permisos, persistencia ni hardware.

Recomendación: PR pequeños, pruebas de paridad y una activación inicial limitada a instalaciones de prueba. Ninguna prueba garantiza ausencia absoluta de fallos. La aceptación debe nombrar los flujos comprobados, el dispositivo, el commit y los límites.

## Evidencia y herramientas

- **Hecho documentado:** `git fetch origin staging main` actualizó las referencias sin modificar el checkout.
- `main` y `origin/main`: `dea2dfc718e4c10772a1a950c796e82a08fa5e55`.
- `origin/staging`: `b3e5bf882372eeb14c3c1b2658a6947df83c5051`, PR #243, importación masiva de inventario.
- El checkout contiene una modificación del esquema de Xcode y documentos ajenos a esta tarea. Deben conservarse.
- `staging` ya incorpora preparación de inventario, costo inicial e importación. El PR debe partir de esa rama actualizada.
- Instrumentos usados: Git 2.50.1, GitHub CLI 2.92.0 y Node 25.9.0. Se usaron Git y lectura del código; no se consultó GitHub mediante `gh`.
- Herramientas del proyecto: pnpm 10.29.3 y Node 22 en CI. `pnpm` no está en el PATH de este shell.
- SDK local comprobado: Flutter 3.47.5, Dart 3.13.4. CI de iOS fija Flutter 3.44.6.
- Fuente de la selección: `AGENTS.md`, `docs/agents/tool-and-research-doctrine.md` y `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md`.
- Se eligieron herramientas instaladas y scripts existentes. No hace falta un nuevo sistema de pruebas ni un servicio adicional.
- Nivel de fuente: código y configuración del propietario. Las recomendaciones se identifican como inferencias.

La skill `product-feature-review` mencionada por `AGENTS.md` no aparece en las ubicaciones revisadas ni en las referencias remotas. Esta revisión usa las reglas explícitas del repositorio. No atribuye instrucciones a esa skill ausente.

## Qué ocurre al abrir o fusionar el PR

| Cambio | Comportamiento declarado por el repositorio |
| --- | --- |
| PR con cambios del dashboard | Cloudflare Pages publica una vista previa de la rama. Las llamadas usan el proxy del mismo origen y `API_ORIGIN` del entorno Preview. |
| Merge del dashboard en `staging` | Publica `staging.umi-dashboard.pages.dev`. |
| PR con cambios del POS | CI compila iOS sin firma y crea un artefacto para simulador contra la API de staging. |
| Merge de UI pura del POS | No instala la aplicación en terminales ni activa el despliegue de la API por sus filtros de rutas. |
| Merge que afecta API, contrato o determinados archivos raíz | Puede activar el despliegue de API y worker en el VPS de staging. |
| TestFlight | Requiere ejecutar su workflow manual. Un merge no publica automáticamente una versión. |

Fuentes: `.github/workflows/deploy-dashboard.yml`, `umi-pos-ios.yml`, `umi-pos-testflight.yml`, `umi-api-deploy-staging.yml` y `apps/umi-dashboard/public/_worker.js`.

Estas son reglas del código. No se verificaron las variables activas de Cloudflare, las reglas de protección ni el estado del VPS.

## Riesgos concretos antes del primer build de prueba

1. **Versión del contrato:** `origin/staging:packages/contract/src/catalog.ts` declara `2.50.0`. Ambos workflows de iOS todavía fijan `UMIPOS_CONTRACT_VERSION=2.23.0`.
   - Es una discrepancia comprobada, no un fallo de arranque reproducido.
   - Derivar el valor del contrato del mismo commit y verificar `/health/release` más el arranque nativo.
   - `tools/ux-sweep/pos-native-launch.sh` ya deriva ese valor y sirve de referencia.
2. **Cobertura de CI:** los workflows revisados compilan iOS, pero no ejecutan `flutter test` ni `flutter analyze` del POS.
   - Los controles de contrato, API, tokens y lint no sustituyen esas pruebas.
3. **Dashboard:** el workflow de despliegue ejecuta build. No ejecuta la suite Vitest ni `test:browser` del dashboard.
4. **Prototipo incompleto respecto al producto:** el botón para dividir el cobro muestra una nota. El producto sí tiene pagos parciales y varias políticas de cobro.
5. **Entorno nativo:** `staging`, `pilot` y `production` rechazan determinadas opciones de diagnóstico y simulación. No copiar flags sin comprobar `AppConfig.validate()`.

## Límites de implementación

**Hechos documentados:** el backend posee las operaciones comerciales; el POS es un cliente nativo. El dashboard debe conservar funciones, rutas y restricciones.

**Inferencia recomendada:** cambiar presentación y distribución primero. Conservar controladores, repositorios, contratos, comandos, persistencia e identificadores de idempotencia.

| Superficie | Propietario actual que debe conservarse |
| --- | --- |
| Acceso, usuario, PIN y bloqueo | `features/entry/entry_surface.dart`, `entry_controller.dart`, `core/security/operator_permissions.dart` |
| Catálogo, fotos, modificadores y cuenta | `features/catalog/catalog_surface.dart`, `catalog_controller.dart`, `features/cart/cart_controller.dart` |
| Pedido del menú digital | `features/cart/incoming_orders_surface.dart`, `incoming_orders_controller.dart` |
| Plano y estado de mesas | `features/tables/floor_plan_surface.dart`, `floor_plan_controller.dart`, `table_state_controller.dart` |
| Barra y cocina | `features/kitchen/kitchen_board_surface.dart`, `kitchen_board_controller.dart`, repositorios LAN y proyección del backend |
| Cobro completo y parcial | `features/checkout/checkout_surface.dart`, `partial_checkout_surface.dart`, `checkout_controller.dart` |
| Caja y conteo | `features/cash/cash_surface.dart`, `cash_controller.dart`, `denomination_counter.dart` |
| Impresora y cajón | `features/hardware/hardware_surface.dart`, `hardware_service.dart`, `hardware_runtime.dart` y transportes existentes |
| Recuperación sin conexión | `features/offline/offline_journal.dart`, `replay_engine.dart`, `offline_checkout_service.dart` |
| Tema y navegación nativos | `core/theme/pos_theme.dart`, `pos_ui.dart`, `core/navigation/app_navigation.dart` |
| Dashboard | `src/shell.jsx`, `src/app.jsx`, `src/data.jsx`, `src/lib/module-registry.js`, `role-landing.js` y las pantallas existentes |

Las rutas de Flutter son relativas a `apps/umi-pos/lib/`. Las rutas del dashboard son relativas a `apps/umi-dashboard/`.

No trasladar el estado de ejemplo ni los PIN de Stageshow al producto. No incorporar el prototipo como una WebView del POS. No sustituir datos reales por ejemplos para cerrar una prueba.

## Secuencia propuesta de PR

1. **Base del rediseño y controles de regresión.** Crear un worktree desde `origin/staging`. Añadir distribución adaptable y estilos nativos. Incorporar CI de Flutter y dashboard. Corregir la versión del contrato usada por los builds de iOS.
2. **Acceso, navegación, catálogo y mesas.** Aplicar la nueva presentación sobre los estados y callbacks actuales. Mantener todas las rutas por permiso. Comprobar vertical, horizontal, fotos fallidas y catálogo largo.
3. **Pedidos, estaciones, cobro y caja.** Portar la presentación completa, incluidos errores, permisos, pagos parciales y recuperación. Mantener ajustes y funciones que la maqueta todavía no representa.
4. **Dashboard.** Adaptar su shell y pantallas sobre los hooks actuales. Conservar selección de comercio/sucursal, filtros, exportaciones, inventario y permisos. Revisar en la preview del PR.

Cada PR debe incluir su alcance, matriz de paridad, capturas y pruebas del mismo commit. Vincular el trabajo de Azure Boards mediante `AB#<id>` cuando exista. Abrir como borrador hasta completar las pruebas nativas.

**Activación propuesta, aún no existente:** un selector de presentación para builds de prueba, desactivado por defecto. Las dos vistas deben usar los mismos controladores. El selector no debe conceder permisos ni cambiar contratos. Una alternativa más simple es distribuir un binario de staging separado. Elegirla si mantener dos vistas duplica demasiado código.

No se encontró un flag específico del rediseño. `FeatureFlags` actual sólo define capacidades generales y diagnóstico. No se debe presentar la activación gradual como una función ya disponible.

## Matriz de aceptación

| Flujo | Evidencia necesaria |
| --- | --- |
| Menú digital | Recibir una orden real de prueba, atenderla una vez y conservar opciones, nota, canal e importe. |
| Comer aquí | Abrir cuenta, asociar mesa, añadir/modificar productos, enviar por estación, servir y cobrar. |
| Para llevar | Identificar pedido, enviar por estación, completar preparación, entregar y cobrar. |
| KDS | Barra sólo recibe sus líneas. Cocina sólo recibe las suyas. Ninguna muestra cobro ni acciones de caja. |
| Concurrencia | Dos clientes actualizan una comanda; el estado converge sin perder líneas ni duplicar acciones. |
| Cobro | Efectivo exacto/insuficiente, cambio, terminal manual, terminal integrada y estados no resueltos. |
| Pagos parciales | Registrar, recargar, continuar saldo y cerrar. Una respuesta perdida no permite cobrar dos veces. |
| Políticas | Respetar métodos permitidos, división permitida/prohibida, propina, descuento y valor del cliente donde corresponda. |
| Caja | Apertura, entrada, salida, retiro, suspensión, relevo, conteo por política, diferencia, aprobación, conciliación y cierre. |
| Permisos | PIN incorrecto, bloqueo, sesión expirada, permiso revocado y acceso directo a rutas restringidas. |
| Sin conexión | Conservar pedido y operaciones permitidas; reconectar y reproducir una sola vez. Recuperar tras cerrar la aplicación. |
| Periféricos | Imprimir un ticket físico, reimprimir, comprobar copias y probar apertura física del cajón. Simular desconexión y recuperar. |
| Dashboard | Cambiar sucursal, filtrar períodos, abrir detalle, exportar y comprobar aislamiento de comercios y restricciones. |
| Adaptación | iPhone/Android; iPad/Galaxy en ambas orientaciones; Windows/macOS. Sin controles tapados por teclado o barras del sistema. |

Las vistas de dispositivos en Stageshow son referencias de distribución. La prueba nativa requiere el sistema operativo o dispositivo correspondiente.

## Comandos de verificación

Ejecutar en el worktree del PR con Node 22, pnpm 10.29.3 y el SDK de Flutter elegido. Registrar resultados previos y posteriores.

```sh
pnpm install --frozen-lockfile
pnpm --filter @umi/contract build
pnpm check:pr
pnpm --filter @umi/dashboard test
pnpm --filter @umi/dashboard build
pnpm --filter @umi/dashboard test:browser
```

`test:browser` usa una aplicación de prueba en el puerto 4011. Complementar con los flujos reales sobre la API de staging o una copia aislada.

Desde `apps/umi-pos`:

```sh
flutter pub get
flutter gen-l10n
flutter analyze
flutter test
```

Para iteraciones focalizadas, el repositorio ya ofrece:

```sh
pnpm umi-pos:sale-tests
pnpm umi-pos:cash-tests
pnpm umi-pos:hardware-tests
pnpm umi-pos:offline-tests
pnpm umi-pos:rbac-api-tests
```

Esas suites focalizadas no incluyen todas las pruebas. Deben cubrirse también `partial_checkout_test.dart`, `checkout_point_tender_test.dart`, `operator_permissions_test.dart`, `incoming_orders_surface_test.dart` y `test/features/kitchen/`.

Para la revisión real del dashboard:

```sh
./scripts/ux-browser.sh
pnpm ux:roles:ui
pnpm ux:flows
pnpm ux:a11y
pnpm ux:visual
./scripts/ux-browser.sh --stop
```

Repetir accesibilidad en los temas que se entreguen. Registrar las dimensiones. Usar una base de prueba con las sucursales y permisos requeridos.

Para el POS, usar Flutter Driver en macOS o el mecanismo nativo disponible. `pnpm ux:pos:native` usa X11; no debe ejecutarse como prueba equivalente en esta Mac sin adaptar el controlador. La prueba web del POS no cuenta como evidencia nativa.

`pnpm check:role-surfaces` necesita su fixture aislada, descrita en el playbook. No preparar esa fixture sobre la base compartida de ONCA. Los scripts `*-db-check` y los datos de prueba también requieren revisar su destino antes de ejecutarlos.

## Retorno a la versión anterior

**Inferencia recomendada:** conservar el binario aprobado y el commit anterior de cada aplicación. Registrar qué base y contrato consume cada versión.

- POS: desactivar la presentación de prueba o instalar el binario anterior. Conservar el diario de operaciones y las credenciales. Comprobar compatibilidad del estado persistido.
- Dashboard: revertir el commit del PR y publicar esa revisión en staging. Comprobar sesión, selección de sucursal y rutas.
- API: un rediseño sólo visual debería evitar cambios de esquema. Si el alcance incorpora backend, preparar su retorno por separado.
- El despliegue actual fija una imagen `sha-<commit>` mediante `UMI_API_TAG`. Su script no realiza un retorno automático al fallar la comprobación de salud.
- No usar una restauración de base como retorno de interfaz: puede perder pedidos de prueba o registros compartidos.

Fuente del despliegue: `apps/umi-api/deploy/deploy.sh` y `.github/workflows/deploy-backend.yml`.

## Estado de esta revisión

Se revisaron código, comandos y workflows. No se ejecutaron las pruebas del producto. No se abrió PR, no se desplegó y no se conectó al VPS. El VPS no es necesario para preparar la implementación visual. Será útil después para comprobar la revisión activa, salud, compatibilidad y logs de staging.
