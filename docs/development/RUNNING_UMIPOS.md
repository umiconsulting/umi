# Running UmiPOS

UmiPOS uses Flutter 3.44.6, Dart 3.12.2, Node 22, and pnpm 10.29.3. Linux, macOS, Windows,
Android, iOS (from macOS), and Flutter Web are supported when their platform SDK is installed.

## Bootstrap

1. Install the repository-supported Node, pnpm, Flutter, and target platform toolchains.
2. Run `pnpm install` at the workspace root.
3. Generate contracts with `pnpm --filter @umi/contract generate`.
4. In `apps/umi-pos`, run `flutter pub get` and `flutter gen-l10n`.

Use paths that work on each development machine. UmiPOS accepts only client credentials.

## Configuration

Pass compile-time values with `--dart-define`:

- `UMI_ENVIRONMENT=development|staging|production`
- `UMI_API_BASE_URL=https://...`
- `UMI_TELEMETRY_ENABLED=true|false`
- `UMI_DEVELOPMENT_DIAGNOSTICS=true|false`
- `UMI_FEATURE_BOOTSTRAP_MODE=localSafeDefaults|disabled`

Production configuration fails closed. Use a local API URL for development, an approved staging
endpoint for staging, and the approved TLS production endpoint for production.

Start the backend with its documented UMI API command before running authenticated flows.

## Device enrollment

Apply migrations through `20260729000200_pos_pin_authentication.sql`.

Use this development flow:

1. Sign in to the UMI Dashboard as an owner or administrator.
2. Open **Devices**.
3. Select the tenant and branch.
4. Select **Register UmiPOS**.
5. Enter the device name, type, and platform.
6. Create the eight-character setup code.
7. Open UmiPOS.
8. Enter the setup code.
9. Return to the Dashboard.
10. Approve the matching installation reference.
11. Wait for UmiPOS to store and acknowledge its device credential.
12. Enter the personal operator PIN.

The setup code expires after five minutes. The code works once.

UmiPOS stores the pairing session and polling credential in secure storage.

Native targets use the platform credential store. Web storage has browser-origin limits.

Run these focused checks:

- Pairing API tests: `pnpm umi-pos:pairing-api-tests`.
- Pairing Flutter tests: `pnpm umi-pos:pairing-tests`.
- Pairing database check: `pnpm umi-pos:pairing-db-check`.

Do not use the old challenge ID flow. The public direct-activation route is disabled.

## Personal operator PIN

Each operator enters only a personal PIN after device enrollment. UMI derives the tenant and
branch from the trusted device. The API loads the operator identity, role, permissions, and
entitlement.

For the disposable local database, the cashier PIN is `2468`. The seed prints every approved development PIN.

Seed the POS entitlement only in the disposable local database:

`UMI_POS_DEV_SEED_CONFIRM=disposable pnpm umi-pos:local-access-seed`

Run the focused PIN checks:

`pnpm umi-pos:pin-tests`

Do not use the disposable seed against a shared, staging, or production database.

## Local role and catalog demo

Seed the disposable local database with seven café profiles, one suspended platform profile, and 12 products:

`UMI_POS_DEV_SEED_CONFIRM=disposable pnpm umi-pos:demo-seed`

Alternative command without `pnpm`:

`UMI_POS_DEV_SEED_CONFIRM=disposable bash scripts/umi-pos-demo-seed.sh`

The seed does not print or store the API JWT secret. It reads the secret from the local
environment or the active Linux API process.

Read `docs/development/UMIPOS_ROLE_TEST_GUIDE.md` for the PIN list and each role test.

## Pilot RBAC

Gate 3D.1 uses one permission inventory, one grant matrix, and one approval matrix.

Run these commands from the workspace root:

```sh
pnpm umi-pos:check-pilot-rbac
pnpm umi-pos:print-role-matrix
UMI_POS_DEV_SEED_CONFIRM=disposable pnpm umi-pos:seed-pilot-roles
```

The seed prints the development PIN for Owner, Admin, Manager, Supervisor, Cashier, Staff, and Viewer. It hashes every PIN before the database write.

The seed assigns every café user to `Sucursal Local`. It creates one POS entitlement and one development register. It keeps the platform `super_admin` account suspended.

Test the profiles in this order:

1. Use Cashier for a normal sale and shift.
2. Request a sensitive approval from Cashier.
3. Use Supervisor for a checkout approval within the pilot policy.
4. Use Manager for cash, variance, refund, and exceptional reconciliation approvals.
5. Use Owner and Admin for business administration.
6. Use Viewer for read-only access.
7. Use Staff to verify Cashier compatibility.

Test these denials:

1. Use Cashier to approve the same Cashier action.
2. Use Supervisor outside the assigned location.
3. Remove a location assignment and retry the mutation.
4. Disable the POS entitlement and retry login.
5. Revoke the device and retry a command.
6. Suspend the staff record and retry PIN login.
7. Change a command after approval and retry the approval.

Run focused validation:

```sh
pnpm umi-pos:rbac-api-tests
pnpm umi-pos:rbac-db-check
cd apps/umi-pos && flutter test test/operator_permissions_test.dart
```

Use `pnpm umi-pos:print-role-matrix` to inspect grants. The command does not print secrets.

To reset the disposable pilot data, remove the disposable database container or run the existing disposable database check. Do not point a reset command at shared data.

The Dashboard does not include a pilot role editor in Gate 3D.1. Use the canonical seed for pilot role assignment.

The matrix permits Owner and Admin to assign only reviewed business roles. It excludes `owner` and `super_admin` assignment.

## One-command targets

- Linux: `pnpm umi-pos:linux`
- macOS: `pnpm umi-pos:mac` (`pnpm umi-pos:macos` remains an alias)
- Windows: `pnpm umi-pos:windows`
- Android: `pnpm umi-pos:android`
- iPhone/iPad (macOS and Xcode required): `pnpm umi-pos:ios`
- Web (Chrome required): `pnpm umi-pos:web`

Flutter reports a clear failure when the requested SDK or device is unavailable; do not install
or bypass platform prerequisites from repository scripts.

## Online checkout development

Gate 2E checkout requires the UMI API plus the canonical migrations through
`20260728000400_gate_2e_online_checkout.sql`. Cash is the supported end-to-end development
method. The external-terminal option deliberately returns a query-only unknown outcome until an
approved provider adapter exists; never treat it as a simulated success or submit a new payment.

## Offline journal and replay

Apply migrations through `20260728000600_gate_2f_offline_closeout.sql`. Native journal payloads are
AES-256-GCM encrypted; the key lives in platform secure storage and ciphertext lives separately.
Native storage always uses encryption. Web remains online-compatible. Policy disables sensitive
offline journaling on Web.

- Run focused offline scenarios: `pnpm umi-pos:replay-check`.
- Run all focused offline client checks: `pnpm umi-pos:offline-tests`.
- Run focused replay API checks: `pnpm umi-pos:replay-api-tests`.
- Validate the clean migration chain and RLS metadata in disposable PostgreSQL:
  `pnpm umi-pos:offline-db-check`.
- Exercise recovery scenarios: `pnpm umi-pos:recovery-demo`.
- Run the development connectivity demonstration: `pnpm umi-pos:offline-demo`.
- Simulate network loss with OS/development proxy controls; never alter TLS or encryption.
- Restore connectivity, reauthenticate if required, and allow ordered replay only after device,
  tenant, branch, and operator authority are valid.
- Inspect only queue counts, schema/contract versions, safe error categories, replay time, and
  opaque context references. Never export payloads or encryption material.
- Disposable development journal data may be removed only through the platform app-data controls;
  never use that recovery step on a real pending queue.
- To test crash recovery, terminate before or after durable insertion, replay result, mapping, or
  archive; restart, verify the encrypted queue count, then query/replay from the last acknowledged
  cursor. Repeating checkout for the same persisted cart/version/totals identity recovers the
  existing provisional sale rather than creating another command.

All append, replay-result, unknown-result, policy, mapping, conflict, and compaction writes share
one serialized encrypted mutation boundary. Secure-storage or integrity failure blocks journaling
without resetting data. Migration downgrade
is unsupported. An owner-assisted recovery path must preserve ciphertext for support analysis.

Load policy while online by opening the authenticated catalog. To exercise the safe cash path,
review authoritative totals online, disconnect, confirm cash checkout, inspect the provisional
receipt and Recovery Center, then reconnect. Replay queries unknown results before reuse of the
same command identity. Simulate response loss only with a development proxy after the server
accepts the request. Simulate revocation, expiry, stale snapshots, and corruption only against
disposable identities and app data. Never delete a production journal.

Linux native builds require CMake, Ninja, Clang, GTK 3 development headers, and the platform
secure-storage dependencies. Web builds confirm online compatibility only; browser storage is
not certified for financial journaling. The completion notification endpoint is exactly
`https://ntfy.sh/nxoumipos`.

## Sale lifecycle

Apply migrations through `20260729000300_gate_3a_sale_lifecycle.sql`.

Use these commands:

- Run focused API tests: `pnpm umi-pos:sale-api-tests`.
- Run focused Flutter tests: `pnpm umi-pos:sale-tests`.
- Run the disposable PostgreSQL check: `pnpm umi-pos:sale-db-check`.

Test this cashier flow:

1. Start an empty sale.
2. Add and edit products.
3. Attach a customer or keep the anonymous customer.
4. Suspend the sale.
5. Resume the sale.
6. Cancel a separate sale with a reason.
7. Complete checkout.
8. Verify that UmiPOS opens one fresh sale and focuses search.
9. Open the latest receipt from the sale center.
10. Restart UmiPOS and verify the active or suspended sale state.

Use the existing offline checkout path for a policy-authorized offline cash sale. Lifecycle
commands require API authority. Gate 3A preserves the Gate 2F journal allowlist.

## Advanced checkout

Apply migrations through `20260729000400_gate_3b_advanced_checkout.sql`.

Use these commands:

- Run focused API tests: `pnpm umi-pos:checkout-api-tests`.
- Run focused Flutter tests: `pnpm umi-pos:checkout-tests`.
- Run the disposable PostgreSQL check: `pnpm umi-pos:checkout-db-check`.

Test the online cashier flow:

1. Enroll a development device and approve it in UMI.
2. Sign in with a cashier PIN.
3. Add products and open checkout.
4. Test exact cash and cash with change.
5. Review totals again after each tender, tip, or discount change.
6. Test cash plus manual terminal.
7. Mark a terminal result as failed. Confirm that the sale remains available.
8. Mark a terminal result as unknown. Query the same result. Do not create another charge.
9. Apply a preset tip and a custom tip.
10. Apply a percentage or fixed order discount with a reason.
11. Use a different manager PIN when approval is required.
12. Select display, print-later, or no-receipt intent.
13. Complete checkout and verify that one new empty sale starts.
14. Restart during tender collection and verify the recovered draft.

The digital receipt option is a contract foundation. Gate 3B does not send email or SMS.
Manual terminal success records an operator assertion. It is not provider proof.
Offline checkout supports one policy-authorized cash tender only. Advanced tender, tip,
discount, and live approval actions require connectivity.

## Cash shift and register operations

Apply migrations through `20260729000500_gate_3c_cash_shift.sql`.

Run these focused commands from the workspace root:

- Generate contracts: `pnpm --filter @umi/contract generate`.
- Run cash API tests: `pnpm umi-pos:cash-api-tests`.
- Run cash Flutter tests: `pnpm umi-pos:cash-tests`.
- Run the disposable database matrix: `pnpm umi-pos:cash-db-check`.
- Analyze Flutter: `cd apps/umi-pos && flutter analyze`.
- Build Linux debug: `cd apps/umi-pos && flutter build linux --debug`.

Create a development register through an authorized database seed or UMI administration flow.
Use the active tenant, branch, device, and currency. Do not copy production identifiers.

Test the operational flow:

1. Start PostgreSQL and the UMI API with the normal local commands.
2. Start UmiPOS with `flutter run -d linux` or `flutter run -d chrome`.
3. Enroll the device and approve it in UMI.
4. Sign in with a cashier PIN.
5. Select the assigned register.
6. Open a shift with a zero or total opening float.
7. Complete an exact cash sale.
8. Verify one `cash_sale` ledger fact for the active shift.
9. Test cash received with change.
10. Test mixed tender and verify that only the cash part changes expected cash.
11. Record Paid In, Paid Out, and Safe Drop with safe reason codes.
12. Suspend and resume the shift.
13. Test handoff with an incoming operator PIN.
14. Sign in again as the incoming operator.
15. Submit a blind count. Confirm that expected cash was hidden before submission.
16. Test recount and variance approval with a different manager PIN.
17. Reconcile the fixed ledger sequence.
18. Confirm the irreversible shift close.
19. Verify that the closed shift rejects a new cash fact.

To test recovery, stop UmiPOS after any command submission. Restart the app. The client queries
the current server state and uses the original idempotent result. Do not create a replacement
command after an unknown response.

When the close threshold applies, enter a different manager PIN in the close dialog. The approval
is short-lived and applies only to the selected count and ledger sequence.

Gate 3G-A sends an approved no-sale request through Hardware Runtime after the server records the event.
Advanced cash operations require connectivity. UmiPOS does not close or reconcile a shift offline.

Use the disposable database script for destructive validation. The script creates and removes its
own container. Do not point this command at a shared or production database.

## Post-sale exceptions

Apply the build-v3 chain through `34_pos_exception.sql`.

Run these focused commands from the workspace root:

- Generate contracts: `pnpm umi-pos:generate`.
- Run exception API tests: `pnpm umi-pos:exception-api-tests`.
- Run exception Flutter tests: `pnpm umi-pos:exception-tests`.
- Run the disposable PostgreSQL matrix: `pnpm umi-pos:exception-db-check`.
- Analyze Flutter: `cd apps/umi-pos && flutter analyze`.
- Build Linux debug: `cd apps/umi-pos && flutter build linux --debug`.
- Build Web compatibility: `cd apps/umi-pos && flutter build web`.

Test the exception flow:

1. Start PostgreSQL, the UMI API, and UmiPOS with the normal local commands.
2. Run `UMI_POS_DEV_SEED_CONFIRM=disposable pnpm umi-pos:demo-seed`.
3. Enroll the device and sign in with an operator PIN.
4. Open an eligible cash shift before a cash refund.
5. Complete a cash, terminal, or mixed-tender sale. This creates the refundable sale.
6. Open Sales and select the post-sale action for the committed sale.
7. Confirm server eligibility before you select an action.
8. Test a full refund and confirm the restock intent.
9. Test a partial refund with one or more remaining line quantities.
10. Test a void only when the server returns void eligibility.
11. Use a different manager PIN when the policy requires approval.
12. Verify that a cash refund reduces the current shift expected cash once.
13. Record terminal success only after the external terminal confirms the refund.
14. Record terminal failure and return to the same refund flow.
15. Record an unknown result and confirm that no replacement refund action appears.
16. Restart before commit and confirm that the client invalidates stale preview data.
17. Simulate response loss after commit and query the original command result.
18. Open the immutable compensation receipt and exception history.

Use development seed data that contains a committed sale and original receipt facts. Do not edit
the committed sale, payment, receipt, or cash facts. Reset only disposable development data.

Post-sale exceptions require connectivity. UmiPOS does not create offline refunds or voids.
Manual terminal results remain operator assertions. Gate 3E consumes the restock intent after a
committed refund.

## Inventario de Gate 3E

Ejecuta los comandos desde la raíz del workspace. Usa Node 22 y pnpm 10.29.3.

```sh
pnpm umi-pos:generate
UMI_POS_DEV_SEED_CONFIRM=disposable pnpm umi-pos:demo-seed
pnpm umi-pos:inventory-api-tests
pnpm umi-pos:inventory-tests
pnpm umi-pos:inventory-db-check
```

El seed crea la ubicación, los artículos, las recetas, los mapeos y el saldo inicial. El comando es
repetible. El seed no crea un segundo saldo inicial.

Prueba el flujo de venta con seguimiento:

1. Inicia PostgreSQL con el procedimiento de Bootstrap.
2. Inicia UMI API con el procedimiento de Bootstrap.
3. Inicia UmiPOS y enrola el dispositivo.
4. Ejecuta el seed desechable.
5. Abre el catálogo para la location asignada.
6. Verifica los estados disponible, bajo y no disponible.
7. Agrega un producto con mapeo directo.
8. Agrega un producto con receta.
9. Abre el checkout para crear la reserva.
10. Confirma la venta.
11. Abre Operaciones de inventario.
12. Verifica las entradas `sale_committed` y los saldos nuevos.

Prueba las consecuencias de un refund:

1. Crea una venta con seguimiento.
2. Confirma un refund con `Restock`.
3. Verifica el hecho `refund_restocked`.
4. Repite con `DoNotRestock`.
5. Verifica que la existencia disponible no aumenta.
6. Repite con `InspectionRequired`.
7. Verifica que la cantidad queda en cuarentena.
8. Usa la resolución de inventario para una receta.
9. No devuelvas ingredientes preparados sin una decisión explícita.

Prueba las operaciones controladas:

1. Inicia sesión con Manager u Owner.
2. Abre Operaciones de inventario.
3. Registra un ajuste, una merma y un daño.
4. Usa un PIN diferente cuando la política pida aprobación.
5. Libera una cantidad válida de cuarentena.
6. Verifica un rechazo por cantidad superior al saldo.
7. Verifica un rechazo por location incorrecta.

Prueba un conteo:

1. Selecciona `Iniciar conteo ciego`.
2. Captura todas las cantidades sin consultar el saldo esperado.
3. Envía el conteo.
4. Revisa la varianza calculada por el servidor.
5. Selecciona un motivo para cada diferencia.
6. Solicita una aprobación independiente.
7. Confirma la reconciliación.
8. Verifica las entradas `count_correction`.

Prueba la existencia negativa y la recuperación:

1. Intenta reservar una cantidad mayor que la disponible.
2. Verifica el código `NEGATIVE_STOCK_BLOCKED` o `INVENTORY_UNAVAILABLE`.
3. Conserva el carrito y corrige la cantidad.
4. Simula una pérdida de respuesta después de un comando.
5. Consulta el comando original antes de repetirlo.
6. Verifica que el ledger no tiene una entrada duplicada.

Las operaciones de ajuste, merma, daño, cuarentena, conteo y restock son online-only. Una venta cash
offline usa el journal existente. El replay crea el efecto oficial solo después de la aceptación del
servidor.

Usa `pnpm umi-pos:inventory-db-check` para la base desechable. El script crea y elimina su contenedor.
No apuntes el script a una base compartida o de producción.

Para un reinicio desechable, elimina solo el contenedor que creó el script. Conserva cualquier stash
local. No uses el reset con datos de producción.

## Clientes, lealtad y valor almacenado

Usa Node 22 para todos los comandos de Gate 3F. Conserva cualquier stash local.

Ejecuta la migración y la matriz RLS en una base desechable:

```sh
pnpm umi-pos:customer-value-db-check
```

Ejecuta las pruebas API enfocadas:

```sh
pnpm umi-pos:customer-value-api-tests
```

Ejecuta las pruebas Flutter enfocadas:

```sh
cd apps/umi-pos
flutter test test/customer_value_test.dart test/checkout_test.dart
```

Prueba el cliente:

1. Inicia la base, la API y UmiPOS con los comandos anteriores de este documento.
2. Ejecuta el seed del piloto en datos desechables.
3. Abre el Centro de clientes.
4. Busca un cliente reciente.
5. Crea un cliente sin correo y sin teléfono.
6. Confirma que marketing no está seleccionado.
7. Adjunta el cliente a una venta.
8. Quita el cliente y completa una venta anónima.

Prueba lealtad y rewards:

1. Crea una cuenta de puntos en la base desechable.
2. Configura una política y un reward del piloto.
3. Solicita la vista de valor para una venta editable.
4. Autoriza el reward.
5. Libera la autorización y confirma el saldo.
6. Autoriza otra vez y confirma el checkout.
7. Verifica `merchant.loyalty_points_ledger` y su proyección.
8. Cambia la política y confirma que el commit rechaza la vista previa anterior.
9. Ejecuta el procesador de expiración en desarrollo:

```sql
select merchant.expire_customer_value_authorizations('<merchant_uuid>'::uuid, 100);
```

Prueba un ajuste manual:

1. Abre un cliente con una cuenta de lealtad.
2. Selecciona **Ajustar puntos**.
3. Captura una dirección, un importe entero y un motivo.
4. Revisa el saldo proyectado.
5. Usa el PIN del responsable cuando la política lo solicite.
6. Confirma un solo hecho `manual_points_adjustment`.

Prueba wallet y gift card:

1. Crea una wallet de desarrollo para el cliente.
2. Agrega un hecho `loaded` con una referencia de seed.
3. Selecciona **Emitir tarjeta** con `gift_card.issue`.
4. Confirma el importe y la aprobación vinculada.
5. Entrega el código de una sola lectura. No copies el código a un log.
6. Para una promoción, confirma que la tarjeta se activa en el comando de emisión.
7. Añade una línea de gift card a una venta online.
8. Crea la tarjeta inactiva con la asignación de esa línea.
9. Confirma un pago completo y verifica la activación atómica.
10. Autoriza un importe de wallet y otro de gift card.
11. Confirma la vista con cash o terminal cuando quede un saldo.
12. Verifica los débitos, la asignación y la referencia oculta del recibo.

Prueba un reward con aprobación:

1. Selecciona un reward que requiera `loyalty.reward.approve`.
2. Usa un manager distinto del operador solicitante.
3. Introduce el PIN por la ruta de aprobación actual.
4. Confirma la misma vista y la misma huella de tenders.
5. Cambia un tender y verifica que la aprobación falle.

Prueba el límite de consulta:

1. Usa una base desechable.
2. Ejecuta nueve consultas inválidas con el mismo device y operator.
3. Confirma `temporarily_locked` sin una señal de existencia.
4. Ejecuta `pnpm umi-pos:customer-value-db-check` para validar el límite distribuido.

Prueba el historial compuesto:

1. Abre un cliente con ventas, refunds, puntos y valor.
2. Cambia el filtro de categoría.
3. Selecciona **Cargar más**.
4. Confirma que el cursor no repite eventos.
5. Confirma que otro customer o merchant no puede usar el cursor.
6. Confirma que una location nula no funciona como wildcard.
7. Quita un permiso global y confirma que el cursor anterior falla.

Ejecuta la matriz real de concurrencia:

```sh
pnpm umi-pos:customer-value-concurrency-check
```

El comando crea una base desechable. Ejecuta 26 carreras con dos sesiones PostgreSQL y elimina la base.

Una pérdida de respuesta requiere consultar el comando original. No repitas un débito sin esa consulta.

Las operaciones de customers, rewards, wallet y gift card son online-only. El replay cash puede conservar una referencia limitada del cliente.

El script crea y elimina su base desechable. No lo apuntes a una base compartida. No borres datos de producción.

## Hardware piloto de Gate 3G-B

Genera y verifica los contratos de hardware:

```sh
pnpm --filter @umi/contract generate
pnpm --filter @umi/contract generate:check
```

Ejecuta las pruebas específicas de la API y Flutter:

```sh
pnpm umi-pos:hardware-api-tests
pnpm umi-pos:hardware-tests
```

Ejecuta la matriz desechable de PostgreSQL y RLS:

```sh
pnpm umi-pos:hardware-db-check
```

El comando crea y elimina una base desechable. No uses una base compartida.

Usa el laboratorio de simuladores para el desarrollo local. Registra el simulador con la API de hardware.
Asígnalo a la ubicación y al dispositivo POS inscritos. El Centro de hardware resuelve el adaptador.

Registra una impresora TCP genérica con el transporte `network_tcp`. Configura el host y el puerto `9100`.
Usa `cp850` para los caracteres en español. Usa `utf8` solamente cuando la impresora lo admite.

Registra un cajón conectado a la impresora con el transporte `printer_attached`.
Usa el mismo host de la impresora. Configura el pin y la duración del pulso.

Registra un escáner de teclado con el transporte `keyboard_wedge`.
Configura `enter` o `tab` como terminador. Configura una ventana entre 20 y 500 milisegundos.

Prueba la recuperación de la impresora con estos estados deterministas:

- `success` guarda un artefacto de impresión seguro.
- `offline`, `busy` y `paper_out` devuelven fallas tipadas.
- `timeout` y `unknown_outcome` no imprimen otro recibo automáticamente.
- Una reimpresión controlada crea un trabajo nuevo con la referencia original.

Prueba el cajón con una acción de efectivo confirmada y permitida. Repite la solicitud con el mismo comando.
Confirma que el runtime devuelve el comando original y no emite otro pulso.

Prueba el escáner con código de barras, QR, ráfaga duplicada y desconexión. Activa la protección del PIN.
Confirma que el adaptador de teclado no captura el PIN.

Prueba la pantalla con los estados de venta, pago, finalización y desconexión. Confirma que no hay datos privados.

Compila los destinos de compatibilidad:

```sh
cd apps/umi-pos
flutter build linux --debug
flutter build web --debug
```

La prueba `simulated cashier journey keeps financial and physical facts separate` ejecuta el recorrido completo.

El runner actual no tiene hardware piloto. No afirmes una certificación física con este resultado.
Gate 3G-B no requiere un SDK de fabricante o un proveedor de pagos.

## KDS operativo de Gate 4A

Ejecuta la API y el KDS existente:

```sh
pnpm --filter @umi/api dev
open apps/umi-kds/375.xcodeproj
```

Configura `KDSBackendURL` con la URL HTTPS de la UMI API.
Usa `KDSLocalBaseURL` solamente para el desarrollo local.

Crea una estación y una ruta con los endpoints protegidos del Dashboard:

```text
POST /api/merchants/{merchantId}/kds/stations?locationId={locationId}
POST /api/merchants/{merchantId}/kds/routes?locationId={locationId}
```

La ruta acepta un `productId`, un `categoryId` o un default de location.
No envíes un `productId` y un `categoryId` juntos.

Ejecuta las pruebas enfocadas de la API:

```sh
pnpm --filter @umi/api exec vitest run \
  src/modules/kds \
  src/shared/database/gate-4a-kds-migration.spec.ts \
  src/shared/orders/order-writer.spec.ts
```

Ejecuta las 10 carreras reales de PostgreSQL:

```sh
pnpm umi-pos:kds-concurrency-check
```

El comando usa dos sesiones independientes.
El comando crea y elimina una base desechable.

Ejecuta la prueba de estado en UmiPOS:

```sh
cd apps/umi-pos
flutter test test/kitchen_status_test.dart
```

Simula una desconexión al detener la API durante el polling.
Confirma que el KDS conserva la vista y bloquea las mutaciones.
Inicia la API y confirma que el KDS obtiene un snapshot antes de otra mutación.

No uses una base compartida para la matriz de concurrencia.
No ejecutes una mutación KDS durante el estado desconectado.

## Canonical PR check

Use Node 22 and pnpm 10.29.3. Run this command before each commit and push:

```sh
pnpm check:pr
```

Set `PR_BASE_REF` when the PR does not target `main`. PR #72 uses:

```sh
PR_BASE_REF=origin/build-v3 pnpm check:pr
```

Run `pnpm format` before the check when you changed Markdown, JSON, TypeScript, or generated files.
Review all formatting changes. Run `pnpm check:pr` a second time. The second run must change no files.

The command checks contract drift, root lint, the approved warning baseline, root format,
canonical JSON, the contract checksum, the UmiPOS use-case document, and the full PR Git range.
Run affected tests and builds separately.

See `docs/development/LINT_AND_PR_CHECKS.md` for the failure diagnosis and troubleshooting steps.
