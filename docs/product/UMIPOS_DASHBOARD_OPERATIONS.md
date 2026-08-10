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

| Dominio                 | Superficie                    | Estado             | Operación disponible                           |
| ----------------------- | ----------------------------- | ------------------ | ---------------------------------------------- |
| Organización / Merchant | Settings y Centro operativo   | Operativo          | Consulta y edición de settings                 |
| Locations               | Settings y Centro operativo   | Operativo          | Consulta y edición de perfiles                 |
| Usuarios / Membresías   | Staff & Access                | Operativo          | Alta, cambio y revocación                      |
| Dispositivos            | Devices                       | Operativo          | Enrollment, aprobación, rechazo y revocación   |
| Registros               | Centro operativo              | Consulta operativa | Estado y referencia segura                     |
| Hardware                | Centro operativo              | Consulta operativa | Registro, cola y fallos seguros                |
| Catálogo                | Centro operativo              | Consulta operativa | Productos, estado, precio y preparación        |
| Inventario              | Centro operativo              | Consulta operativa | Items y estado de autoridad                    |
| Ventas                  | Centro operativo              | Consulta operativa | Venta comprometida y recibo                    |
| Recibos                 | Centro operativo              | Consulta operativa | Recibo autoritativo e importe histórico        |
| Refunds / Voids         | Centro operativo              | Consulta operativa | Excepciones y referencias de recuperación      |
| Cash Shifts             | Centro operativo              | Consulta operativa | Turno, register, estado y fecha comercial      |
| Customers               | Customers                     | Operativo          | Búsqueda, perfil, historial e identidad        |
| Loyalty                 | Loyalty y Customers           | Operativo          | Cuenta, saldo e historial                      |
| Rewards                 | Loyalty                       | Operativo          | Política y estado                              |
| Wallet                  | Centro operativo y Customers  | Consulta operativa | Referencia, estado y saldo proyectado          |
| Gift Cards              | Gift Cards y Centro operativo | Operativo          | Consulta segura y emisión autorizada existente |
| Kitchen / KDS           | Orders y Centro operativo     | Operativo          | Orden, station, routing y diagnóstico          |
| Recovery                | Centro operativo              | Consulta operativa | Comandos no terminales y referencias seguras   |
| Audit                   | Centro operativo              | Operativo          | Eventos seguros, scope y correlación           |
| Diagnostics             | Centro operativo              | Consulta operativa | Estado de hardware y correlación               |

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

## Límites actuales

Las mutaciones con una sesión de operador y un dispositivo POS mantienen ese requisito. El Dashboard no omite esta prueba.

Estas acciones todavía no tienen un flujo administrativo completo en el Dashboard:

- comandos de inventario;
- preview y commit de refund o void;
- comandos de cash shift;
- comandos físicos de hardware;
- acciones de wallet y gift card que requieren una sesión POS;
- acciones de recuperación específicas del dominio.

Este límite mantiene Gate 5A en estado `INCOMPLETE`. Gate 6A no está autorizado.

## Límite entre clientes

- El Dashboard administra y consulta.
- UmiPOS ejecuta una venta y una acción que exige un dispositivo POS.
- El KDS ejecuta una transición de cocina.
- La UMI API valida y compromete cada mutación.

El Dashboard no sustituye UmiPOS o el KDS.
