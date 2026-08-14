# UmiPOS — Relevo técnico de desarrollo

Actualizado: 2026-07-29

Este documento prepara el relevo temporal de UmiPOS. Resume el estado real del producto,
las reglas de arquitectura, las funciones terminadas y el trabajo pendiente.

No reemplaza la memoria canónica. Si existe una diferencia, usa primero las fuentes de la
sección siguiente.

## 1. Instrucción obligatoria para el siguiente agente

Antes de modificar código:

1. Lee el `AGENTS.md` de la raíz.
2. Lee un `AGENTS.md` más específico si existe en el directorio que vas a modificar.
3. Lee este documento completo.
4. Lee las fuentes canónicas de la sección 2.
5. Ejecuta `git status --short --branch`.
6. Ejecuta `git log --oneline --decorate -15`.
7. Usa el HEAD real. No uses un HEAD copiado de un prompt anterior.
8. Conserva los cambios locales que no te pertenezcan.
9. Define un solo Gate antes de cambiar código.
10. Define un solo objetivo para ese Gate.
11. Obtén aprobación del alcance antes de iniciar el siguiente Gate comercial.

Usa estas reglas durante el trabajo:

- Mantén Flutter como cliente delgado.
- Usa `apps/umi-api` para la autoridad de negocio.
- Usa `packages/contract` como única fuente editable de contratos.
- Usa `supabase/migrations` como única fuente editable de migraciones.
- Usa los SDK generados.
- No conectes Flutter directamente con Supabase.
- No pongas una clave de servicio en un cliente.
- No crees una segunda arquitectura de recuperación o conexión sin conexión.
- No cambies un hecho financiero confirmado.
- Usa comandos idempotentes para cada mutación financiera.
- Ejecuta pruebas enfocadas antes de publicar.
- Usa la skill `pr-gates` para publicar un PR.
- No hagas merge sin autorización.
- No hagas squash sin autorización.
- No hagas force-push sin autorización.

## 2. Fuentes de autoridad y apoyo

Lee primero estas fuentes canónicas:

1. `docs/architecture-transition/PROJECT_CANONICAL_STATE.md`
2. `docs/architecture-transition/CURRENT_PLATFORM_STATE.json`
3. `docs/architecture-transition/PHASE_INDEX.json`
4. `docs/product/OWNER_REVIEW.md`
5. `docs/development/RUNNING_UMIPOS.md`
6. `docs/product/UMIPOS_PRODUCT_ROADMAP.md`
7. `docs/product/umipos-product-roadmap.json`
8. `docs/product/UMIPOS_OFFLINE_COMMAND_POLICY.md`

Lee después esta guía de apoyo:

- `docs/development/UMIPOS_ROLE_TEST_GUIDE.md`

La guía de roles no es una fuente canónica. La sección 8 identifica un dato desactualizado.

Usa este documento para el relevo. Usa las fuentes canónicas para una decisión de autoridad.

## 3. Estado de Git y publicación

Estado al crear este documento:

- Workspace: `/home/hceja/Documents/umi`
- Aplicación: `/home/hceja/Documents/umi/apps/umi-pos`
- Rama: `architectureUMIposIntegration`
- HEAD publicado: `83cc0c07ef66da75661543165e8ddd7d232169a8`
- Último commit: `feat(umi-pos): implement cash shift operations`
- Rama remota: `origin/architectureUMIposIntegration`
- PR: `#72`
- URL: `https://github.com/umiconsulting/umi/pull/72`
- Rama base: `build-v3`
- Estado del PR: abierto
- Verificaciones publicadas: aprobadas
- Estado de merge: conflicto con la rama base

El árbol estaba limpio antes de crear este archivo. Este archivo queda como el único cambio
local hasta que el responsable decida su commit.

Verifica otra vez el estado remoto. El estado del PR puede cambiar:

```sh
gh pr view 72 --json number,title,url,baseRefName,headRefName,state,mergeStateStatus
gh pr checks 72
git ls-remote origin refs/heads/architectureUMIposIntegration
```

No resuelvas el conflicto del PR por selección automática. Usa la skill de conflictos si el
responsable aprueba esa tarea.

## 4. Resumen ejecutivo

La plataforma y los Gates 1A a 3C están completos según la memoria canónica.

UmiPOS ya permite este flujo:

```text
Registro de dispositivo
→ aprobación de UMI
→ PIN del operador
→ selección de tenant y sucursal autorizados
→ turno de caja
→ catálogo
→ carrito
→ ciclo de venta
→ checkout
→ pago
→ recibo
→ nueva venta automática
→ conteo y cierre de turno
```

La aplicación también tiene operación nativa sin conexión para el efectivo permitido por una
política del servidor.

El producto todavía no está listo como POS comercial completo. Faltan módulos de inventario,
reembolsos, KDS, hardware, adquirencia real, CRM, lealtad, reportes y preparación de producción.

## 5. Autoridad y arquitectura actual

### 5.1 Autoridad de negocio

- `apps/umi-api` es la única frontera de escritura de negocio.
- PostgreSQL es la autoridad de datos.
- RLS aplica aislamiento por tenant y sucursal.
- La API verifica el alcance del dispositivo y del operador.
- Flutter presenta estados y envía comandos tipados.
- Flutter no calcula hechos financieros finales.

### 5.2 Contratos

- Fuente editable: `packages/contract`
- Versión actual: `2.1.0`
- Hash actual: `7a2f560b1542e868d78869bc712e0f46385bda5f4b7dbc378681d548524d5c88`
- Salidas: JSON neutral, SDK TypeScript y SDK Dart

No agregues modelos HTTP manuales que dupliquen el contrato.

### 5.3 Migraciones

- Fuente editable: `supabase/migrations`
- Última migración de UmiPOS: `20260729000500_gate_3c_cash_shift.sql`
- Las pruebas desechables validan la cadena completa.

No agregues lógica de producto al esquema `public`.

### 5.4 Identidad y permisos

- `umi.user` mantiene la identidad.
- `tenant.staff` mantiene el empleo.
- `runtime.session` mantiene la sesión durable.
- `runtime.operator_session` mantiene la presencia del operador en el POS.
- `tenant.device` mantiene la autoridad del dispositivo.
- La API verifica permisos. Un nombre de rol no concede autoridad por sí solo.

### 5.5 Integridad financiera

- `tenant.business_command` mantiene idempotencia y resultados.
- El fingerprint detecta un comando cambiado.
- `tenant.audit_event` mantiene la auditoría de negocio.
- `tenant.financial_event` mantiene hechos financieros append-only.
- Una corrección crea un nuevo hecho compensatorio.
- Ningún cliente puede modificar un hecho confirmado.

## 6. Gates terminados

### 6.1 Gates de plataforma

#### Gate 1A — Autoridad, migraciones y RLS

Terminado:

- Una autoridad de migraciones.
- Una autoridad de API.
- RLS.
- Aislamiento por tenant y sucursal.
- Rol de API sin bypass de RLS.

#### Gate 1B — Contratos canónicos

Terminado:

- Una fuente editable de contratos.
- Generación neutral de JSON.
- SDK TypeScript.
- SDK Dart.
- Validación de drift determinista.

#### Gate 1C — Identidad y acceso

Terminado:

- Identidad durable.
- Personal.
- Sesiones.
- Roles.
- Permisos.
- Entitlements.
- Elevación temporal.

#### Gate 1D — Integridad transaccional

Terminado:

- Comandos idempotentes.
- Fingerprint de comando.
- Concurrencia optimista.
- Auditoría append-only.
- Eventos financieros append-only.
- Correlación.
- Compensación explícita.

#### Gate 1E — Operación y resiliencia

Terminado:

- Telemetría acotada.
- Redacción de datos sensibles.
- Diagnóstico seguro.
- Límites de aplicación.
- Timeouts.
- Circuit breakers.
- Backpressure.
- Profundidad de cola acotada.

Pendiente de producción:

- WAF.
- Mitigación DDoS del proveedor.
- Limitador distribuido antes de escalar horizontalmente.
- Alertas y retención operativa de producción.

#### Gate 1F — Certificación de entrada

Terminado:

- Certificación de `build-v3`.
- Autorización para crear `apps/umi-pos`.
- Registro de observaciones operativas no bloqueantes.

### 6.2 Gates de UmiPOS

#### Gate 2A — Base Flutter

Terminado:

- Aplicación Flutter en `apps/umi-pos`.
- Flutter 3.44.6.
- Dart 3.12.2.
- `ChangeNotifier` con una raíz de composición.
- Guardia central de rutas.
- Configuración fail-closed.
- Cliente HTTP acotado.
- Almacenamiento seguro.
- Telemetría redactada.
- Inglés y español.
- Adaptadores de hardware explícitamente no disponibles.

#### Gate 2B — Dispositivo y operador

Terminado:

- Registro con un código de ocho caracteres.
- Solicitud de aprobación en UMI.
- Polling seguro.
- Credencial vinculada a la instalación.
- Almacenamiento seguro de la credencial.
- Revocación y rotación.
- PIN personal después de registrar el dispositivo.
- Resolución de operador, rol y permisos en el servidor.
- Sesión del operador.
- Mensaje visible para un código de registro incorrecto.
- Borde de error en el campo de registro.
- Mensaje visible para un PIN incorrecto.

El registro del dispositivo y el PIN son controles separados.

#### Gate 2C — Catálogo

Terminado:

- Catálogo de solo lectura.
- Partición por tenant, sucursal e idioma.
- Paginación por cursor.
- Búsqueda por nombre, descripción, SKU y código de barras.
- Categorías.
- Disponibilidad.
- Imágenes.
- Variantes.
- Modificadores.
- Caché acotada.

El POS no administra productos. Esa función pertenece a una superficie autorizada de UMI.

#### Gate 2D — Carrito

Terminado:

- Carrito autoritativo.
- Una partición por tenant, sucursal y operador.
- Aumento y reducción de cantidad.
- Eliminación de línea.
- Limpieza del carrito.
- Edición de variantes.
- Edición de modificadores.
- Edición de notas.
- Unión determinista de líneas.
- Concurrencia optimista.
- Vista previa de impuestos y totales.

El carrito no crea una venta confirmada.

#### Gate 2E — Checkout en línea

Terminado:

- Reprecio inmediato.
- Confirmación explícita de totales.
- Pago en efectivo.
- Efectivo recibido.
- Cambio calculado por el servidor.
- Recibo inmutable.
- ID oficial del servidor.
- Fecha de negocio.
- Auditoría.
- Resultado idempotente.
- Recuperación por consulta.
- Terminal externa con resultado desconocido y sin reintento ciego.

La reserva de inventario es temporal. Todavía no existe una mutación final de inventario.

#### Gate 2F — Diario cifrado, replay y recuperación

Terminado:

- Diario nativo AES-256-GCM.
- Clave en el almacén seguro de la plataforma.
- Ciphertext separado.
- Ningún fallback a texto plano.
- Esquema local versión 1.
- Un solo escritor serializado.
- Secuencia por dispositivo.
- Política de efectivo emitida por el servidor.
- Política default-deny.
- Límites de monto, conteo, cola y frescura.
- Checkout nativo provisional.
- Recibo provisional.
- Replay ordenado.
- Recuperación de respuesta perdida.
- Deduplicación después de reinicio.
- Mapeo inmutable de provisional a oficial.
- Conflictos persistentes.
- Acciones de recuperación tipadas.
- Reconciliación.
- Recovery Center.
- Inglés, español y semántica accesible.

Límites deliberados:

- Web no guarda comandos financieros sensibles sin conexión.
- Un recibo local no usa un folio oficial.
- Una venta sin conexión queda provisional hasta la aceptación del servidor.

#### Gate 3A — Ciclo de venta

Terminado:

- Una venta editable por tenant, sucursal y operador.
- Nueva venta.
- Suspensión.
- Nombre de venta suspendida.
- Búsqueda y orden de ventas suspendidas.
- Reanudación.
- Cancelación con razón.
- Recuperación después de reinicio.
- Cliente anónimo.
- Adjuntar y quitar cliente.
- Historial de ventas recientes.
- Navegación a recibo oficial o provisional.
- Nueva venta automática después del checkout.
- Conservación del operador y del dispositivo.

Límites:

- El cliente adjunto no es un CRM.
- No existen puntos, wallet, gift cards o marketing.
- Una venta cancelada no es un reembolso.

#### Gate 3B — Checkout y tender avanzado

Terminado:

- Una máquina de estados de checkout.
- Efectivo exacto.
- Efectivo con cambio.
- Atajos de denominación.
- Terminal manual.
- Resultado fallido de terminal.
- Resultado desconocido de terminal.
- Tender mixto de efectivo y terminal manual.
- Saldo parcial.
- Bloqueo de sobreasignación.
- Propina fija y porcentual según política.
- Descuento fijo y porcentual según política.
- Razón de descuento.
- Aprobación de gerente.
- Aprobación de un uso.
- Aprobación vinculada al fingerprint.
- Destino de recibo.
- Recuperación después de reinicio.
- Commit atómico de venta, tender y recibo.
- Nueva venta automática.

Límites:

- La terminal manual es una declaración del operador.
- No existe prueba de un proveedor de adquirencia.
- Un resultado desconocido solo permite consulta.
- El destino digital guarda una intención. No envía email o SMS.
- Gift card, wallet y loyalty no están implementados.

#### Gate 3C — Registro físico y turno de caja

Terminado:

- Registro físico autoritativo.
- Un turno no resuelto por registro.
- Turno vinculado a tenant, sucursal, dispositivo y operador.
- Fecha de negocio derivada por el servidor.
- Apertura atómica e idempotente.
- Fondo inicial.
- Fondo inicial por denominación.
- Ledger físico append-only.
- Registro atómico de la parte en efectivo de una venta.
- Paid In.
- Paid Out.
- Safe Drop.
- Solicitud no-sale sin éxito falso de hardware.
- Suspensión y reanudación.
- Handoff con PIN.
- Conteo ciego.
- Conteo por denominación.
- Recuento.
- Diferencia positiva y negativa.
- Tolerancia de política.
- Razón de diferencia.
- Aprobación de gerente.
- Reconciliación por secuencia fija.
- Cierre atómico.
- Resumen inmutable.
- Recuperación después de reinicio o respuesta perdida.
- Cash Center en Flutter.

Límites:

- Abrir turno, movimientos, conteo, conciliación y cierre requieren conexión.
- El software no prueba la custodia física del efectivo.
- No existe integración real con cajón o impresora.

## 7. Flujos que se pueden probar hoy

### 7.1 Entrada

1. Crea un código de registro desde UMI.
2. Ingresa el código de ocho caracteres.
3. Aprueba la solicitud en UMI.
4. Espera que UmiPOS guarde la credencial.
5. Ingresa el PIN del operador.

No existe un código fijo de registro. Cada código es temporal y funciona una vez.

### 7.2 Catálogo y carrito

1. Busca por nombre, SKU o código de barras.
2. Filtra por categoría.
3. Abre un producto.
4. Selecciona variante y modificadores.
5. Agrega una nota.
6. Agrega el producto.
7. Cambia la cantidad.
8. Edita o elimina una línea.
9. Revisa los totales del servidor.

### 7.3 Venta

1. Inicia una venta.
2. Suspende la venta.
3. Nombra la venta suspendida.
4. Reanuda la venta.
5. Adjunta un cliente.
6. Quita el cliente.
7. Cancela una venta separada.
8. Completa otra venta.
9. Abre el recibo.
10. Confirma que aparece una venta nueva.

### 7.4 Pago

1. Prueba efectivo exacto.
2. Prueba efectivo con cambio.
3. Prueba efectivo más terminal manual.
4. Prueba una terminal fallida.
5. Prueba una terminal desconocida.
6. Consulta la terminal desconocida.
7. Aplica propina.
8. Aplica descuento.
9. Usa otro PIN para una aprobación.
10. Selecciona el destino del recibo.

### 7.5 Turno de caja

1. Selecciona el registro.
2. Abre un turno.
3. Declara el fondo inicial.
4. Completa una venta en efectivo.
5. Registra Paid In.
6. Registra Paid Out.
7. Registra Safe Drop.
8. Suspende y reanuda.
9. Ejecuta un handoff.
10. Inicia el cierre.
11. Ejecuta el conteo ciego.
12. Prueba un recuento.
13. Explica una diferencia.
14. Solicita aprobación cuando corresponda.
15. Reconcilia.
16. Cierra.
17. Abre el resumen.

### 7.6 Operación nativa sin conexión

1. Carga una política válida en línea.
2. Verifica que los snapshots estén vigentes.
3. Desconecta la red.
4. Completa una venta en efectivo permitida.
5. Revisa el recibo provisional.
6. Abre el Recovery Center.
7. Reconecta la red.
8. Observa el replay.
9. Revisa el mapeo al recibo oficial.

Esta prueba requiere una aplicación nativa. Web queda en línea para operaciones financieras.

## 8. Datos de demostración

Usa datos desechables:

```sh
UMI_POS_DEV_SEED_CONFIRM=disposable pnpm umi-pos:demo-seed
```

PIN de demostración:

| Rol           | PIN    | Alcance actual                                   |
| ------------- | ------ | ------------------------------------------------ |
| Propietario   | `1111` | Funciones operativas y permisos amplios          |
| Administrador | `2222` | Funciones operativas y administración autorizada |
| Gerente       | `3333` | Operación, recuperación y aprobaciones           |
| Cajero        | `2468` | Catálogo, venta, checkout y caja permitida       |
| Consulta      | `5555` | Catálogo de solo lectura                         |

No uses estos PIN en staging o producción.

La guía `UMIPOS_ROLE_TEST_GUIDE.md` tiene una lista antigua que marca el corte de caja como
pendiente. Gate 3C ya implementó ese flujo. Actualiza esa sección antes del siguiente demo formal.

## 9. Mapa del código

### 9.1 Flutter

| Área                      | Ruta                                            |
| ------------------------- | ----------------------------------------------- |
| Bootstrap y composición   | `apps/umi-pos/lib/bootstrap`                    |
| Entrada y registro        | `apps/umi-pos/lib/features/entry`               |
| Catálogo                  | `apps/umi-pos/lib/features/catalog`             |
| Carrito                   | `apps/umi-pos/lib/features/cart`                |
| Venta                     | `apps/umi-pos/lib/features/sale`                |
| Checkout                  | `apps/umi-pos/lib/features/checkout`            |
| Diario y recuperación     | `apps/umi-pos/lib/features/offline`             |
| Cash Center               | `apps/umi-pos/lib/features/cash`                |
| Seguridad                 | `apps/umi-pos/lib/core/security`                |
| Red y errores             | `apps/umi-pos/lib/core/network` y `core/errors` |
| Localización              | `apps/umi-pos/lib/core/localization`            |
| Adaptadores de plataforma | `apps/umi-pos/lib/core/platform`                |

### 9.2 API

| Área             | Ruta                                    |
| ---------------- | --------------------------------------- |
| Entrada POS      | `apps/umi-api/src/modules/pos-entry`    |
| Catálogo         | `apps/umi-api/src/modules/pos-catalog`  |
| Carrito          | `apps/umi-api/src/modules/pos-cart`     |
| Venta            | `apps/umi-api/src/modules/pos-sale`     |
| Checkout         | `apps/umi-api/src/modules/pos-checkout` |
| Offline y replay | `apps/umi-api/src/modules/pos-offline`  |
| Caja y turnos    | `apps/umi-api/src/modules/pos-cash`     |

### 9.3 Contratos

Los archivos principales están en:

- `packages/contract/src/pos-catalog.ts`
- `packages/contract/src/pos-cart.ts`
- `packages/contract/src/pos-sale.ts`
- `packages/contract/src/pos-checkout.ts`
- `packages/contract/src/pos-offline.ts`
- `packages/contract/src/pos-cash.ts`

La entrada POS usa contratos de identidad, dispositivo y sesión que también consumen otros
clientes de UMI.

## 10. Trabajo pendiente para un POS comercial completo

La secuencia siguiente es una recomendación. No es un roadmap aprobado.

Cada bloque requiere un Gate aprobado, contratos, autoridad de API, migración, RLS, pruebas,
documentación y un solo commit.

### 10.1 Prioridad inmediata — Integración del repositorio

Pendiente:

- Resolver el conflicto del PR `#72` con `build-v3`.
- Ejecutar las revisiones de especificación y estándares después de resolverlo.
- Confirmar las verificaciones de CI.
- Obtener aprobación antes de hacer merge.
- Actualizar los campos de publicación que todavía dicen `PENDING` en la memoria canónica.
- Actualizar la guía de roles porque Gate 3C ya implementó el turno de caja.

No mezcles esta tarea con un nuevo Gate funcional.

### 10.2 Prioridad comercial alta — Inventario autoritativo

Estado actual:

- Existe disponibilidad de catálogo.
- Existe una reserva temporal de checkout.
- No existe una mutación final de inventario por venta.

Falta:

- Ledger de inventario append-only.
- Existencia por sucursal.
- Efecto de venta.
- Recepción.
- Ajuste.
- Merma.
- Transferencia.
- Conteo físico.
- Reconciliación.
- Política para inventario negativo.
- Idempotencia.
- RLS.
- Proyección segura para POS y Dashboard.
- Integración de una venta confirmada con el efecto de inventario.
- Estrategia de replay para una venta provisional.

No agregues la autoridad de inventario a Flutter o KDS.

### 10.3 Prioridad comercial alta — Reembolsos y anulaciones

Estado actual:

- Una venta activa se puede cancelar antes del commit.
- Una venta confirmada y su recibo son inmutables.

Falta:

- Reembolso total.
- Reembolso parcial.
- Selección de líneas y cantidades.
- Límite concurrente para impedir sobre-reembolso.
- Razón.
- Permiso.
- Aprobación.
- Hechos financieros compensatorios.
- Ajuste de tender.
- Recibo de reembolso.
- Efecto de inventario.
- Auditoría.
- Idempotencia.
- Recuperación de respuesta perdida.
- Política de operación sin conexión.

No modifiques una venta o un pago confirmado.

### 10.4 Prioridad comercial alta — KDS

Estado actual:

- UMI conserva la autoridad de pedidos.
- `apps/umi-kds` existe como cliente separado.
- UmiPOS todavía no implementa el flujo completo hacia cocina.

Falta:

- Evento de pedido confirmado.
- Proyección de cocina.
- Deduplación.
- Secuencia.
- ACK.
- Reintento acotado.
- Estados de preparación.
- Estaciones.
- Ruteo por producto.
- Correlación desde venta hasta KDS.
- Manejo de un recibo provisional.
- Pruebas de caída y recuperación.
- Validación en el hardware KDS objetivo.

KDS no debe ser la autoridad del pedido.

### 10.5 Prioridad comercial alta — Pago con proveedor real

Estado actual:

- Efectivo funciona.
- Terminal manual registra una declaración del operador.
- Resultado desconocido queda en consulta.

Falta:

- Seleccionar un proveedor.
- Crear un adaptador neutral.
- Crear y consultar intentos de pago.
- Webhooks firmados.
- Idempotencia de proveedor.
- Autenticidad del resultado.
- Manejo de timeout y ambigüedad.
- Captura, cancelación y reembolso según contrato.
- Conciliación del proveedor.
- PCI y controles aplicables.
- Rotación de secretos.
- Observabilidad.
- Certificación del hardware o SDK.

No simules una aprobación del proveedor.

### 10.6 Prioridad comercial alta — Hardware POS

Estado actual:

- Los adaptadores existen.
- Todos reportan `unsupported` sin una implementación certificada.
- El evento no-sale no confirma que el cajón abrió.

Falta:

- Impresora de recibos.
- Cajón de efectivo.
- Escáner de códigos.
- Descubrimiento de dispositivo.
- Estado disponible o no disponible.
- Timeout.
- Reintento seguro.
- Cola de impresión.
- Recuperación.
- Prueba de apertura de cajón.
- Compatibilidad por sistema operativo.
- Certificación en hardware piloto.

No afirmes éxito de hardware sin evidencia del adaptador.

### 10.7 Prioridad media — Entrega digital de recibos

Estado actual:

- El checkout guarda la intención.
- El sistema no afirma que el mensaje se entregó.

Falta:

- Proveedor de email o SMS.
- Validación y normalización de destino.
- Consentimiento separado de marketing.
- Cola de entrega.
- Estado de entrega.
- Reintento.
- Rebote.
- Redacción de datos.
- Límite de abuso.
- Consulta de entrega.

### 10.8 Prioridad media — Clientes y CRM

Estado actual:

- Se puede adjuntar o quitar una referencia de cliente.
- Existe cliente anónimo.

Falta:

- Perfil de cliente.
- Búsqueda completa.
- Creación y edición.
- Unificación de identidad.
- Teléfono normalizado.
- Historial de compras.
- Preferencias.
- Consentimientos.
- Privacidad y retención.
- Merge controlado.
- Aislamiento por tenant.

Usa el dueño canónico de identidad de cliente. No crees una tabla paralela en Flutter.

### 10.9 Prioridad media — Lealtad, wallet y gift cards

Estado actual:

- No están implementados en UmiPOS.
- `apps/umi-cash` representa lealtad y valor almacenado.
- No representa el efectivo físico del cajón.

Falta:

- Autoridad canónica unificada.
- Consulta de saldo.
- Earn.
- Redeem.
- Reversión.
- Expiración.
- Gift card.
- Wallet.
- Límites.
- Fraude.
- Idempotencia.
- Recibo.
- Operación sin conexión.

No mezcles el ledger físico de Gate 3C con valor almacenado.

### 10.10 Prioridad media — Reportes operativos

Falta:

- Ventas por periodo.
- Ventas por producto.
- Tender.
- Impuestos.
- Descuentos.
- Propinas.
- Turnos.
- Diferencias de caja.
- Reembolsos.
- Inventario.
- Exportación acotada.
- Read models con `security_invoker`.
- Permisos.
- Paginación.
- Presupuestos de consulta.

No uses tablas de escritura como una API de reporte sin un diseño de lectura.

### 10.11 Prioridad media — Administración operativa

El Dashboard administra dispositivos, personal, roles, permisos y sucursales.

Confirma o completa:

- Registros físicos.
- Políticas de turno.
- Políticas de propina.
- Políticas de descuento.
- Límites de movimientos.
- Denominaciones.
- Tolerancia de diferencia.
- Política de handoff.
- Configuración de impresora y cajón.
- Configuración de proveedor.

La interfaz administrativa debe usar la misma API y las mismas reglas de autoridad.

### 10.12 Prioridad posterior — Proveedores, compras y transferencias

Falta:

- Proveedores.
- Órdenes de compra.
- Recepción.
- Costo.
- Transferencias entre sucursales.
- Devolución a proveedor.
- Auditoría.
- Integración con inventario.

Este bloque depende de la autoridad de inventario.

### 10.13 Prioridad posterior — Fiscal y contabilidad

Falta definir por país:

- Requisitos fiscales.
- Folio fiscal.
- Facturación.
- Anulación fiscal.
- Impuestos regulatorios.
- Exportaciones contables.
- Cierre contable.
- Retención documental.

No implementes una regla fiscal sin la jurisdicción y el proveedor aprobados.

### 10.14 Prioridad posterior — Customer display

Falta:

- Pantalla del cliente.
- Sincronización de carrito.
- Totales.
- Propina cuando corresponda.
- Estado de pago.
- Privacidad.
- Recuperación.

La pantalla debe ser una proyección. No debe ser autoridad.

### 10.15 Prioridad posterior — Assistant

Estado actual:

- Assistant está deshabilitado.

Falta:

- Read models seguros.
- Herramientas tipadas.
- Permisos.
- Presupuestos por usuario y tenant.
- Auditoría.
- Confirmación para acciones consecuentes.
- Protección contra prompt injection.
- Redacción.
- Límites de costo.

Assistant no debe recibir SQL, service role o autoridad de pago.

## 11. Límites deliberados que no son defectos

- Web no guarda un diario financiero sensible.
- Las operaciones avanzadas de turno requieren conexión.
- Una terminal manual no prueba una autorización.
- Un destino digital no prueba entrega.
- Un evento no-sale no prueba apertura física.
- Una reserva de inventario no cambia la existencia final.
- Un cliente adjunto no crea un CRM.
- Una cancelación previa al commit no es un reembolso.
- Un conteo de efectivo no prueba custodia física.
- No existe certificación visual final del propietario.

No elimines un límite deliberado para obtener paridad aparente.

## 12. Preparación para piloto y producción

Aunque los Gates de código están completos, faltan tareas operativas.

### 12.1 Infraestructura

- Entorno staging aprobado.
- Promoción de migraciones.
- Secretos administrados.
- TLS.
- CDN.
- WAF.
- Mitigación DDoS.
- Limitador distribuido.
- Alertas.
- Retención de logs.
- Backup fuera del proveedor.
- Prueba de restauración.
- Runbook de incidente.

### 12.2 Aplicación

- Firma de builds.
- Distribución.
- Actualización controlada.
- Gestión de dispositivos.
- Política de versiones.
- Compatibilidad de contratos.
- Telemetría de producción.
- Política de soporte.

### 12.3 Validación

- Prueba en hardware piloto.
- Prueba de carga enfocada.
- Prueba de red inestable.
- Prueba de corte de energía.
- Prueba de turno completo.
- Prueba de cientos de ventas consecutivas.
- Prueba de backup y restauración.
- Revisión de seguridad.
- Revisión de privacidad.
- Certificación fiscal cuando corresponda.
- Aprobación visual del propietario.
- Capacitación de operador.

## 13. Comandos de desarrollo

Ejecuta desde la raíz:

```sh
pnpm install
pnpm umi-pos:get
pnpm umi-pos:generate
```

Ejecuta el POS:

```sh
pnpm umi-pos:linux
pnpm umi-pos:mac
pnpm umi-pos:windows
pnpm umi-pos:android
pnpm umi-pos:ios
pnpm umi-pos:web
```

Usa solo el target disponible en la máquina.

### 13.1 Pruebas de entrada

```sh
pnpm umi-pos:pairing-api-tests
pnpm umi-pos:pairing-tests
pnpm umi-pos:pairing-db-check
pnpm umi-pos:pin-tests
```

### 13.2 Pruebas offline

```sh
pnpm umi-pos:offline-tests
pnpm umi-pos:replay-api-tests
pnpm umi-pos:offline-db-check
```

### 13.3 Pruebas de venta

```sh
pnpm umi-pos:sale-api-tests
pnpm umi-pos:sale-tests
pnpm umi-pos:sale-db-check
```

### 13.4 Pruebas de checkout

```sh
pnpm umi-pos:checkout-api-tests
pnpm umi-pos:checkout-tests
pnpm umi-pos:checkout-db-check
```

### 13.5 Pruebas de caja

```sh
pnpm umi-pos:cash-api-tests
pnpm umi-pos:cash-tests
pnpm umi-pos:cash-db-check
```

### 13.6 Validación Flutter

```sh
cd apps/umi-pos
flutter gen-l10n
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter build linux --debug
flutter build web --debug
```

No ejecutes todas las suites si el Gate requiere pruebas enfocadas.

## 14. Regla para el siguiente Gate

El roadmap no tiene un número aprobado después de Gate 3C.

Antes de iniciar:

1. Selecciona un solo bloque de la sección 10.
2. Obtén aprobación del propietario.
3. Escribe el objetivo.
4. Define lo permitido y lo prohibido.
5. Define criterios de aceptación.
6. Define contratos.
7. Define migraciones y RLS cuando corresponda.
8. Define pruebas enfocadas.
9. Define la actualización canónica.
10. Define un solo commit.

No combines inventario, reembolsos, KDS, hardware y proveedores en un solo Gate.

Orden técnico recomendado:

1. Resuelve el conflicto de Gate 3C.
2. Cierra la publicación de Gate 3C.
3. Aprueba el siguiente Gate.
4. Implementa inventario autoritativo o reembolsos.
5. Define el evento de pedido confirmado.
6. Implementa KDS después de definir ese evento.
7. Integra hardware con proveedores seleccionados.
8. Integra adquirencia con un proveedor seleccionado.
9. Agrega clientes sobre autoridades estables.
10. Agrega lealtad sobre autoridades estables.
11. Agrega reportes sobre autoridades estables.
12. Prepara staging y producción de forma continua.

## 15. Checklist antes de entregar trabajo

Antes de crear un commit:

- [ ] El cambio pertenece al Gate aprobado.
- [ ] El árbol no contiene archivos temporales.
- [ ] Los contratos se generaron.
- [ ] El drift es cero.
- [ ] TypeScript compila.
- [ ] Dart analiza.
- [ ] La API pasa typecheck y lint.
- [ ] Las pruebas enfocadas pasan.
- [ ] PostgreSQL desechable pasa cuando cambia persistencia.
- [ ] Flutter analiza.
- [ ] Inglés y español están completos.
- [ ] La accesibilidad está validada.
- [ ] `git diff --check` pasa.
- [ ] No existe acceso directo de Flutter a Supabase.
- [ ] No existe un cliente HTTP manual duplicado.
- [ ] No existen secretos o datos sensibles.
- [ ] La memoria canónica está actualizada.
- [ ] `OWNER_REVIEW.md` registra observaciones sin inventar aprobación.
- [ ] `RUNNING_UMIPOS.md` usa comandos reales.

Antes de publicar:

- [ ] Existe exactamente un commit del Gate.
- [ ] El árbol está limpio.
- [ ] La revisión de especificación pasa.
- [ ] La revisión de estándares pasa.
- [ ] La skill `pr-gates` se ejecuta.
- [ ] La rama base sigue siendo `build-v3`.
- [ ] El PR existente se actualiza.
- [ ] No existe un PR duplicado.
- [ ] No se hizo merge sin autorización.

## 16. Plantilla breve para continuar con Codex

Usa esta instrucción al iniciar una sesión nueva:

```text
Trabaja en la raíz del workspace clonado.
Lee primero el AGENTS.md de la raíz.
Lee docs/development/UMIPOS_DEVELOPMENT_HANDOFF.md completo.
Lee después las fuentes canónicas que indica ese documento.
Verifica la rama, el HEAD, el árbol y el PR antes de modificar código.
No uses el HEAD de un prompt anterior.
No inicies un Gate sin un alcance aprobado.
Conserva la autoridad de apps/umi-api, packages/contract y supabase/migrations.
Usa pruebas enfocadas y la skill pr-gates para publicar.
No hagas merge.
No hagas squash.
No hagas force-push.
```

## 17. Riesgos que el siguiente responsable debe vigilar

- Conflicto actual del PR con `build-v3`.
- Drift entre la memoria canónica y el estado externo de publicación.
- Guía de roles desactualizada para Gate 3C.
- Operación de Web sin diario financiero sensible.
- Dependencia de almacenamiento seguro nativo.
- Dependencia humana de la terminal manual.
- Dependencia humana del conteo físico.
- Falta de inventario autoritativo final.
- Falta de reembolsos.
- Falta de hardware certificado.
- Falta de proveedor real.
- Falta de validación de producción.

## 18. Definición actual de “POS completamente funcional”

Para considerar el producto completo para operación comercial, deben existir y validarse:

- Entrada segura.
- Catálogo.
- Carrito.
- Ciclo de venta.
- Checkout.
- Pago.
- Recibo.
- Operación sin conexión definida.
- Turno de caja.
- Inventario.
- Reembolsos.
- KDS cuando el negocio prepara productos.
- Hardware requerido.
- Adquirencia real cuando se acepten tarjetas.
- Clientes y lealtad cuando el negocio los habilite.
- Reportes operativos.
- Configuración administrativa.
- Cumplimiento fiscal.
- Staging.
- Producción.
- Seguridad operativa.
- Backups y restauración.
- Soporte.
- Capacitación.
- Aprobación del propietario.

Los Gates 1A–3C cubren la plataforma, la venta, el pago neutral y el turno de caja.
Los bloques restantes convierten esa base en un producto comercial completo.
