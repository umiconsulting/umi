# Cuentas abiertas sin mesa — iMin

Fecha: 2026-10-12. Compilación final: Flutter nativa 0.1.0 build 32, paquete `co.umiconsulting.umi_pos.estacion`.
Se conservó ADB inalámbrico `192.168.1.10:5555`, el enrollment y los datos de la aplicación.
La API local usa `:4001` y PostgreSQL `umi_local`. Los cambios de la otra sesión permanecen en el workspace.

## Comportamiento

La cuenta puede existir sin mesa ni plano. El nombre es opcional.
Guardar conserva productos pendientes sin enviarlos ni cobrar.
El listado muestra nombre o folio, fecha y hora local, creador, pendientes, enviados y saldo.
La cuenta conserva su folio al guardar, recuperar, renombrar y cambiar de operador.
Una cuenta nombrada sin productos aparece en el listado.
Una cuenta vacía sin nombre ni mesa no aparece, pero permanece recuperable por ID.

El mesero puede iniciar y crear otra cuenta mediante `cart.write`.
La ruta ya no exige `sale.lifecycle`. El botón Cobrar permanece deshabilitado sin `checkout.commit`.
Nueva cuenta conserva primero la cuenta actual. El servidor mantiene los bloqueos de pago.

Asignar mesa usa una mesa del plano publicado y conserva la cuenta, orden y productos.
Una mesa libre inicia una visita. Una mesa ocupada sin otra cuenta conserva su visita.
Una mesa con otra cuenta rechaza la asignación y conserva ambos pedidos.
El mensaje indica que el operador debe elegir otra mesa.
El éxito elimina el aviso anterior. La comanda y el listado conservan visibles nombre y folio.
Este cambio permite asignar una cuenta sin mesa; no transfiere cuentas entre mesas ya asignadas.

## Contrato y datos

El nombre usa `pos_cart.display_label`. Un guardado automático sin `accountName` conserva el nombre.
Un null explícito elimina el nombre. La suspensión del ciclo de venta también conserva el nombre cuando recibe null.
El folio deriva de `account_number`, una identidad global con posibles saltos. Es una referencia operativa, no fiscal.
`Cart.createdAt` usa UTC. `Cart.operatorName` identifica al creador original, incluso después de cambiar de operador.

`POST cart/accounts/:cartId/details` cambia el nombre.
`POST cart/accounts/:cartId/table` asigna la mesa.
Ambos exigen `cart.write`, propietario activo y versión vigente.
Los pagos pendientes, ambiguos o confirmados bloquean estos cambios.
La mesa con otra cuenta devuelve `CART_TABLE_ACCOUNT_EXISTS`; una cuenta ya asignada devuelve `CART_ALREADY_ASSIGNED`.

El contrato publica los ocho errores de cuentas, propiedad, versión, pagos, mesas y preparación.
El filtro HTTP conserva sus códigos; la interfaz recibe el motivo específico en lugar de `CONFLICT`.
Versión: `2.29.0`. SHA-256 generado: `68723bdc24761c334a7241844a8b50d2bc5d3c962186f2e2e76beb26ca876b1c`.

El contexto de la orden conserva campos ajenos mediante una mezcla JSON.
El ticket existente recibe folio, nombre, mesa, visita y tipo de servicio.
Su referencia conserva el folio y admite hasta 160 caracteres.
Un contexto distinto incrementa la versión, agrega `order_updated` y emite `pg_notify` después del commit.
Un contexto idéntico conserva la versión.
Enviar, cobrar, renombrar, asignar y guardar con nombre usan el mismo helper.

La migración 021 es aditiva y admite reaplicación. Se aplicó en `umi_local` tras validarla en un clon poblado.
El archivo base 80 incluye sus prerrequisitos y reutiliza las migraciones como fuente única.
El runner incluye 80 antes de 99. El indicador de compatibilidad conserva `build-v3-79`.

## Recorrido físico

Se añadió Mesa vínculo al plano local de verificación de ONCA, con versión esperada y copia previa.
Mesa prueba y su cuenta anterior permanecen intactas.

1. Admin creó Cuenta 109 con un Americano caliente de MXN 50 y la guardó sin nombre.
2. El listado mostró folio, hora, creador y saldo. Se recuperó la misma cuenta y se guardó como Ana QA.
3. Admin recuperó la cuenta, cambió el nombre a Ana terraza y envió su único producto.
4. Mesero 1 creó Cuenta 111 sin mesa, agregó un Americano y guardó Portatil QA sin enviarlo.
5. Nueva cuenta creó Cuenta 112 sin permisos de venta ni cobro. Cuenta 111 permaneció guardada.
6. Mesero recuperó Cuenta 109. Mesa prueba rechazó la asignación porque conserva Cuenta 108 abierta.
7. Mesa vínculo aceptó la asignación. Se conservaron los IDs de cuenta, orden, línea e ítem de cocina.
8. Cocina mostró Cuenta 109 · Mesa vínculo · Ana terraza en el mismo ticket, con un producto en cola.
9. En build 32, Admin recuperó la misma cuenta. La comanda mostró mesa, folio y nombre.
10. La cuenta quedó guardada y recuperable. La cuenta original de MXN 345 conserva sus cuatro enviados y versión 16.

Identidades de Cuenta 109:

- Cuenta: `f9e82051-5b47-48b0-91a1-fd685e57b032`.
- Orden: `c007b146-c5ce-4dcb-9ca9-481eac57fe0f`.
- Línea: `c0ff66de-6300-4844-b27d-83c1ccfbaa3b`.
- Ítem de orden: `0ba57e1d-dfad-40c8-acec-063ee7e1d8cb`.
- Ticket: `12149451-69f7-47ab-aab6-20f650c1e399`.
- Visita: `cb13f441-a329-43fa-967e-cedb9bb86fa1`.

[Captura final de la comanda](evidence/2026-10-12-tableless-accounts/18-build32-assigned-name-folio.png).
[Referencia en cocina](evidence/2026-10-12-tableless-accounts/17-kitchen-assigned-reference.png).
[Listado final](evidence/2026-10-12-tableless-accounts/19-final-saved-accounts.png).
[Conflicto específico](evidence/2026-10-12-tableless-accounts/13-specific-table-conflict.png).
Los archivos `physical-before-assign.txt` y `physical-after-assign.txt` prueban las mismas identidades.

## Validación y límites

- Flutter: 125 pruebas de las suites iniciales; 103 tras corregir el inicio del mesero; 30 en la revalidación final de cuentas y geometría.
- El nombre de 120 caracteres pasó con texto al 200%, geometría iMin y teclado simulado. El análisis focal final pasó.
- API: 27 pruebas de cuentas y 11 del filtro HTTP. Contrato: 83 pruebas y typecheck correcto.
- PostgreSQL real: seis pruebas en clon poblado y seis en base nueva, con rol API y RLS.
- Migración 021 aplicada dos veces en clon; runner completo con 80 y 99 correcto en base nueva.
- Checkout: dos pruebas con reserva y `commit_sale_inventory` reales pasan con el nuevo helper. Usan un clon y rollback.

Las pruebas de checkout desactivan seguimiento de stock en su fixture y sustituyen el cierre de lealtad.
Este recorrido físico no cobró ni usó un proveedor bancario. Se usó un iMin, sin segundo portátil físico.
Cocina mostró conexión inestable; la captura prueba la lectura del contexto actualizado, no una recepción websocket simultánea.
El typecheck global API conserva dos errores previos en `pos-hardware.repository.spec.ts`, líneas 70 y 95.

Evidencia: [carpeta del recorrido](evidence/2026-10-12-tableless-accounts).
Instrumentos: Flutter 3.47.5, ADB 37.0.1 y PgService con roles API/worker.
APK SHA-256: `60ea630adfd31f83e424b128967a566d2cfd9df245467d54073831a1d62fd0dc`.
Base de producto: [investigación de Enviar, Cobrar y portátiles](../research/2026-10-12-send-pay-handheld.md).
La mesa opcional y la asignación posterior son decisiones específicas de Umi sobre esa investigación.
