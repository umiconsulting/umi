# Operaciones del Dashboard de UmiPOS

## Propósito

El Dashboard es un cliente administrativo. La UMI API mantiene la autoridad de cada dominio.

El Centro operativo muestra 21 dominios con una consulta acotada. La consulta usa el merchant y la location autorizados.

El Dashboard no calcula dinero, inventario, permisos ni estados de cocina. El Dashboard no escribe tablas de autoridad.

## Contexto

El selector muestra uno de estos alcances:

- merchant;
- location seleccionada;
- location asignada al usuario.

Una membresía asignada a una location no recibe otras locations. Un cambio de contexto invalida la consulta anterior.

## Matriz de cobertura P0

| Dominio                 | Superficie                    | Estado             | Operación disponible                               |
| ----------------------- | ----------------------------- | ------------------ | -------------------------------------------------- |
| Organización / Merchant | Settings y Centro operativo   | Operativo          | Consulta y edición de settings                     |
| Locations               | Settings y Centro operativo   | Operativo          | Consulta y edición de perfiles                     |
| Usuarios / Membresías   | Staff & Access                | Operativo          | Alta, cambio y revocación                          |
| Dispositivos            | Devices                       | Operativo          | Enrollment, aprobación, rechazo y revocación       |
| Registros               | Centro operativo              | Operativo          | Configuración, estado y asignación POS             |
| Hardware                | Centro operativo              | Operativo          | Asignación, diagnóstico, prueba y reprint          |
| Catálogo                | Centro operativo              | Operativo          | Alta, edición, barcode, inventario y preparación   |
| Inventario              | Centro operativo              | Operativo          | Ajuste, merma, daño, cuarentena y conteo           |
| Ventas                  | Centro operativo              | Consulta operativa | Venta comprometida y recibo                        |
| Recibos                 | Centro operativo              | Operativo          | Recibo autoritativo y reprint `COPY`               |
| Refunds / Voids         | Centro operativo              | Operativo          | Preview, aprobación, commit y recuperación         |
| Cash Shifts             | Centro operativo              | POS por política   | Consulta; el movimiento físico se completa en POS  |
| Customers               | Customers                     | Operativo          | Búsqueda, perfil, historial e identidad            |
| Loyalty                 | Loyalty y Customers           | Operativo          | Cuenta, historial y ajuste aprobado                |
| Rewards                 | Loyalty                       | Operativo          | Política y estado                                  |
| Wallet                  | Centro operativo y Customers  | Solo consulta      | La política no permite financiación administrativa |
| Gift Cards              | Gift Cards y Centro operativo | Operativo          | Consulta, emisión promocional y entrega única      |
| Kitchen / KDS           | Orders y Centro operativo     | Operativo          | Orden, station, routing y diagnóstico              |
| Recovery                | Centro operativo              | Operativo          | Consulta, inventario, refund y valor del cliente   |
| Audit                   | Centro operativo              | Operativo          | Eventos seguros, scope y correlación               |
| Diagnostics             | Centro operativo              | Consulta operativa | Estado de hardware y correlación                   |

## Autoridad y permisos

La navegación usa permisos efectivos. El nombre del rol no concede acceso.

La API valida el merchant antes de la consulta. La API valida la location asignada antes de una consulta con location.

Un deep link sin permiso devuelve `PERMISSION_DENIED`. Una location fuera del scope devuelve `LOCATION_SCOPE_VIOLATION`.

## Paginación

Cada dominio usa un máximo de 50 filas. La vista usa 20 filas por página.

La API mantiene el orden estable. El cliente usa un offset acotado para esta vista administrativa.

## Datos seguros

La vista muestra solamente estos datos:

- referencia pública;
- título seguro;
- estado;
- location;
- fecha;
- importe histórico cuando aplica;
- versión;
- correlation ID.

La vista no muestra contactos completos, PIN, tokens, credenciales, hashes ni códigos de gift card.

## Recuperación

El Centro operativo muestra comandos fallidos o reintentables. El operador copia una referencia segura para soporte.

No existe una acción genérica de reintento. El dominio decide si una acción es segura.

## Contexto de comando

La API separa `dashboard_administrative` de `pos_device`.
La sesión administrativa vive en `runtime.dashboard_session`.
La API valida la sesión en cada solicitud.
La API también valida el token CSRF de cada mutación con cookies.
Cada refresh token tiene una identidad única para impedir una repetición durante la rotación.

El registro `merchant.administrative_command` guarda la identidad estable, el fingerprint y el estado de recuperación.
La política permite solo operaciones administrativas explícitas.
La política rechaza checkout y preparación de cocina desde el Dashboard.

Los comandos de refund, inventario, loyalty y gift card usan la misma autoridad que UmiPOS.
La API conserva los permisos, las aprobaciones, el fingerprint y la idempotencia del dominio.

Los comandos físicos usan un relay tipado. La API guarda el comando y lo entrega al POS asignado.
El navegador y el servidor del Dashboard no abren un socket del dispositivo.

La aprobación usa el PIN personal de otro actor autorizado. El grant dura cinco minutos y usa un fingerprint exacto.
La sesión bloquea los intentos de aprobación después de cinco fallos durante 15 minutos.
La política marca una aprobación condicional cuando el dominio decide el umbral.
El endpoint de aprobación ejecuta el step-up. El comando de dominio consume el grant cuando lo exige.

El cliente conserva el `commandId` y el `idempotencyKey` después de una pérdida de respuesta.
Un resultado físico desconocido exige verificación. El sistema no repite una impresión de forma automática.
La prueba de recorrido ejecuta el catálogo, el registro, el hardware, el inventario, el refund y el valor del cliente.
La misma prueba ejecuta la administración de cocina y la consulta de recuperación.

### Base de la decisión

- Hecho documentado: `administrative-command.policy.ts` define cada contexto y permiso permitido.
- Hecho documentado: `csrf.guard.ts` valida el token CSRF para una mutación con cookies.
- Fuente oficial: [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) recomienda un token junto con `SameSite`.
- Fuente oficial: [NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final) define la validación de acceso en un punto de política.
- Tradeoff: el relay agrega latencia, pero mantiene el acceso físico dentro del POS inscrito.
- Inferencia de Umi: un solo comando de dominio reduce las diferencias entre el Dashboard y UmiPOS.

Gate 5A está `INCOMPLETE` por una falta de prueba de extremo a extremo.
Las pruebas unitarias validan el cableado y los 24 rechazos de autoridad.
Estas pruebas sustituyen los servicios de dominio con dobles de prueba.
El recorrido P0 también usa dobles de prueba para los servicios de dominio.
Falta una prueba con Dashboard autenticado, API, servicios canónicos y PostgreSQL.
Gate 6A no está autorizado.

## Límites de producto

- Checkout y venta en efectivo son operaciones de UmiPOS.
- Preparar, ready y complete son operaciones del KDS.
- Un movimiento físico de efectivo se completa en el POS asignado.
- `VerifyPrint` y `HardwareReconnect` se completan en el POS asignado.
- `KitchenReconcile` se completa en el KDS con un snapshot de la API.
- Wallet no tiene una operación administrativa de financiación.
- El Dashboard no sustituye UmiPOS o el KDS.

## Límite entre clientes

- El Dashboard administra y consulta con comandos permitidos.
- UmiPOS ejecuta una venta y una acción que exige un dispositivo POS.
- El KDS ejecuta una transición de cocina.
- La UMI API valida y compromete cada mutación.

El Dashboard no sustituye UmiPOS o el KDS.
