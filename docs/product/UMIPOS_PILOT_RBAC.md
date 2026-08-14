# UmiPOS — RBAC del piloto

## 1. Propósito

Este documento define los perfiles operativos del piloto de café. La API usa permisos efectivos. El nombre del rol no concede autoridad.

Las fuentes canónicas son:

- `config/umipos-permission-inventory.json` para el catálogo de permisos.
- `config/umipos-pilot-role-grants.json` para los grants de cada perfil.
- `config/umipos-pilot-approval-boundaries.json` para la separación de actores.
- `docs/migration/build-v3/35_pos_pilot_rbac.sql` para el seed generado.

No edite el SQL generado. Ejecute `pnpm umi-pos:generate-pilot-rbac` después de cambiar la matriz.

## 2. Regla de autorización

La API autoriza una operación cuando se cumplen todas estas condiciones:

1. El usuario tiene una membresía activa.
2. El staff está activo.
3. La location está asignada.
4. El merchant tiene el entitlement `pos` activo.
5. El dispositivo está autorizado.
6. La versión de la credencial está vigente.
7. La sesión de operador está activa.
8. El permiso efectivo contiene el permiso requerido.
9. La política permite el estado y el importe.
10. La aprobación existe cuando la operación la requiere.

Una denegación explícita prevalece sobre un grant. Un permiso de otro merchant no participa en la resolución.

## 3. Perfiles canónicos

| Perfil      | Scope principal | Grants POS | Aprobación | Uso principal                                      |
| ----------- | --------------- | ---------: | ---------- | -------------------------------------------------- |
| Owner       | Merchant        |        130 | Sí         | Autoridad de negocio para un merchant.             |
| Admin       | Merchant        |        129 | Sí         | Administración del negocio y operación autorizada. |
| Manager     | Location        |        120 | Sí         | Gestión de caja, recovery y excepciones.           |
| Supervisor  | Location        |         85 | Sí         | Supervisión de checkout en una location.           |
| Cashier     | Location        |         48 | No         | Jornada normal de venta y caja propia.             |
| Staff       | Location        |         48 | No         | Perfil compatible con Cashier.                     |
| Viewer      | Location        |          9 | No         | Lectura explícita sin mutaciones.                  |
| super_admin | Platform        |          0 | N/A        | Administración de plataforma fuera del café.       |

No existe un rol de negocio `Auditor`. Owner y Admin pueden leer auditoría. El perfil técnico `developer` conserva lectura limitada.

### Normalización de permisos

El inventario no añadió claves duplicadas. Conserva las claves que los controladores ya usan.

- `device.enroll` controla la creación, aprobación, lectura, rotación y revocación del dispositivo.
- `sale.lifecycle` controla la venta propia. `sale.resume.any` amplía la recuperación a otro operador.
- `checkout.commit` controla el checkout. Los descuentos, terminal y recovery tienen permisos separados.
- Los permisos de caja separan la acción de la aprobación.
- Los permisos de refund separan la acción de la aprobación.
- `sale.refund.other_location` permanece como foundation. Solo Owner lo recibe y la API todavía exige scope explícito.

Las claves que parecen eventos, como `sale.committed`, no son permisos. El inventario las excluye.

## 4. Diferencias entre los perfiles

### Cashier y Staff

Cashier y Staff tienen los mismos grants durante el piloto. Staff conserva la compatibilidad de usuarios existentes.

Los dos perfiles pueden:

- operar su venta y su checkout;
- abrir y cerrar su turno dentro de la política;
- registrar movimientos de caja permitidos;
- enviar un conteo ciego;
- iniciar un refund parcial de bajo riesgo;
- solicitar una aprobación.

Los dos perfiles no pueden aprobar su propia operación. Tampoco pueden administrar usuarios, dispositivos o locations.

### Supervisor y Manager

Supervisor opera una location. Puede recuperar operaciones ajenas y aprobar descuentos o terminal según la política.

Manager puede aprobar movimientos de caja, cierre, varianza y refund. Manager también tiene `offline.recovery.review`.

Supervisor solicita a Manager las aprobaciones de caja, varianza y refund. El servidor evalúa los umbrales.

### Admin y Owner

Admin puede administrar un merchant. Owner es la autoridad de negocio más alta del merchant.

Solo Owner recibe `sale.refund.other_location`. Esta capacidad también requiere un scope permitido por la API.

Admin y Owner reciben `device.enroll`, `merchant.manage` y `audit.read`. Ninguno recibe autoridad de plataforma.

### Viewer

Viewer recibe solo estos permisos:

- `catalog.read`;
- `insights.read`;

Viewer no abre el Centro de ventas combinado. Esta pantalla requiere `sale.lifecycle`.

Una ruta de mutación siempre rechaza a Viewer. La visibilidad de Flutter no sustituye este control.

## 5. Límite de super_admin

`super_admin` es un perfil de plataforma. No forma parte de la matriz del café.

El seed de desarrollo crea una cuenta claramente marcada. La cuenta queda suspendida y no tiene PIN de café.

No use `super_admin` para:

- iniciar una jornada de Cashier;
- abrir o cerrar una caja normal;
- aprobar un refund normal;
- sustituir un grant que falta;
- asignar acceso desde la administración del merchant.

## 6. Matriz de separación de aprobación

Todas las aprobaciones siguientes duran 300 segundos. Son de un solo uso. Están ligadas al fingerprint del comando.

| Acción sensible                 | Permiso actor                 | Permiso aprobador                 | Scope    | Autoaprobación |
| ------------------------------- | ----------------------------- | --------------------------------- | -------- | -------------- |
| Descuento alto                  | `checkout.discount.apply`     | `checkout.discount.approve`       | Location | No             |
| Descuento personalizado         | `checkout.discount.apply`     | `checkout.discount.approve`       | Location | No             |
| Cancelación excepcional         | `checkout.commit`             | `checkout.recover.any`            | Location | No             |
| Confirmación terminal sensible  | `checkout.terminal.confirm`   | `checkout.terminal.approve`       | Location | No             |
| Paid In sobre umbral            | `cash.movement.paid_in`       | `cash.movement.paid_in.approve`   | Location | No             |
| Paid Out sobre umbral           | `cash.movement.paid_out`      | `cash.movement.paid_out.approve`  | Location | No             |
| Safe Drop sobre umbral          | `cash.movement.safe_drop`     | `cash.movement.safe_drop.approve` | Location | No             |
| Cierre sobre umbral             | `cash.shift.close`            | `cash.shift.close.approve`        | Location | No             |
| Varianza fuera de tolerancia    | `cash.reconcile`              | `cash.variance.approve`           | Location | No             |
| Recuento escalado               | `cash.count.submit`           | `cash.count.recount`              | Location | No             |
| Refund total                    | `sale.refund.full`            | `sale.refund.approve`             | Location | No             |
| Refund parcial sobre umbral     | `sale.refund.partial`         | `sale.refund.approve`             | Location | No             |
| Void                            | `sale.void.create`            | `sale.refund.approve`             | Location | No             |
| Refund en efectivo sobre umbral | `sale.refund.cash`            | `sale.refund.approve`             | Location | No             |
| Refund por terminal manual      | `sale.refund.manual_terminal` | `sale.refund.approve`             | Location | No             |
| Venta de otro operador          | `sale.refund.other_operator`  | `sale.refund.approve`             | Location | No             |
| Refund fuera de ventana         | `sale.refund.partial`         | `sale.refund.approve`             | Merchant | No             |

La matriz JSON conserva el nombre exacto de la política para cada fila.

El handoff usa el PIN del operador entrante. La política actual no usa una aprobación genérica de Manager.

## 7. Valores del piloto

Los valores son datos desechables del seed. La moneda es MXN. Todos los importes usan unidades menores.

- El fondo inicial máximo es `100000`.
- El umbral de aprobación para movimientos es `5000`.
- La tolerancia de varianza es `100`.
- El umbral de aprobación de cierre es `500`.
- El conteo es por denominaciones y es ciego.
- El handoff está activo.
- La caja no permite operaciones avanzadas offline.
- La asignación de registro no es obligatoria en el piloto desechable.

Estos valores no son decisiones de producción. Cambie la política del servidor después de una revisión del Owner.

## 8. Seed y prueba segura

Ejecute estos comandos desde la raíz:

```sh
pnpm umi-pos:check-pilot-rbac
pnpm umi-pos:print-role-matrix
pnpm umi-pos:seed-pilot-roles
```

El último comando imprime los PIN de desarrollo. No copie esos PIN a un entorno de producción.

El seed crea un usuario para cada perfil de negocio. Cada usuario pertenece al merchant del piloto y a una sola location.

El seed también crea:

- el entitlement `pos`;
- un registro físico de desarrollo;
- una política de checkout;
- una política de caja;
- una política de excepciones;
- productos de prueba.

El Dashboard todavía no asigna los perfiles del piloto. Use el seed canónico en datos desechables.

La matriz permite estas asignaciones:

- Owner puede asignar Admin, Manager, Supervisor, Cashier, Staff y Viewer.
- Admin puede asignar Manager, Supervisor, Cashier, Staff y Viewer.
- Ningún perfil de negocio puede asignar Owner o `super_admin`.

## 9. Cambio de permisos

Siga este proceso:

1. Cambie la matriz JSON canónica.
2. Explique la justificación del grant.
3. Ejecute `pnpm umi-pos:generate-pilot-rbac`.
4. Ejecute `pnpm umi-pos:check-pilot-rbac`.
5. Ejecute las pruebas enfocadas de RBAC.
6. Ejecute la validación PostgreSQL desechable.
7. Revise la separación de actores.
8. Publique mediante `pr-gates`.

El trigger de RBAC termina las sesiones activas después de un cambio importante. El siguiente acceso resuelve permisos nuevos.

## 10. Supuestos y decisiones pendientes

- El Owner debe aprobar los umbrales de producción.
- El Owner debe decidir si Supervisor puede aprobar cada tipo de refund.
- El Owner debe decidir si Staff seguirá como alias de Cashier después del piloto.
- El Owner debe decidir si necesita un rol Auditor de negocio.
- El Dashboard no ofrece un editor libre de permisos en este Gate.

## 11. Permisos de inventario de Gate 3E

Gate 3E añade permisos de inventario a la misma matriz canónica. No usa nombres de rol como
autoridad.

| Perfil      | Autoridad de inventario                                                        |
| ----------- | ------------------------------------------------------------------------------ |
| Cashier     | Lee la disponibilidad de la location asignada.                                 |
| Staff       | Conserva el mismo acceso de lectura que Cashier.                               |
| Supervisor  | Lee el historial, registra merma y daño, inicia conteos y entra en cuarentena. |
| Manager     | Ajusta, aprueba, reconcilia, resuelve restock y libera cuarentena.             |
| Admin       | Administra la política y conserva las operaciones autorizadas del negocio.     |
| Owner       | Administra la política y conserva la autoridad del merchant.                   |
| Viewer      | Lee saldos e historial. No cambia hechos.                                      |
| super_admin | Permanece fuera del viaje operativo del café.                                  |

Todos los grants de inventario requieren el entitlement `pos`. Las operaciones también requieren un
dispositivo vigente y una sesión de operador activa.

La location limita los saldos, las reservas, los conteos y los comandos. Un grant de merchant no
permite una mutación sin un contexto de location.

## 12. Separación de aprobación para inventario

La matriz canónica incluye estas acciones sensibles:

- aumento o reducción por encima del umbral;
- merma por encima del umbral;
- disposición de daño;
- liberación de cuarentena;
- reconciliación fuera de tolerancia;
- excepción de existencia negativa en ajuste, checkout o reconciliación;
- resolución manual del restock.

La aprobación usa un permiso específico. También usa una huella del comando, la location, una
vigencia corta y un solo uso.

La autoaprobación está bloqueada por defecto. `super_admin` no actúa como un aprobador de respaldo.
La excepción de existencia negativa es la frontera más restrictiva. Esta aprobación sustituye la aprobación de umbral para el mismo comando.

## 13. Valores de inventario del piloto

- La política bloquea la existencia negativa.
- La política exige una reserva para los artículos configurados.
- El conteo es ciego.
- La tolerancia de conteo es cero en los datos desechables.
- Los umbrales de ajuste y merma son cero.
- Una operación sobre el umbral requiere otro operador autorizado.
- Las mutaciones directas de inventario son online-only.

Estos valores prueban el límite más conservador. El Owner debe definir los valores de producción.

El flujo documentado de seed y API es la autoridad del piloto. Gate 3F está completo.

## 14. Permisos de clientes y valor de Gate 3F

| Perfil          | Autoridad de clientes y valor                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| Cashier y Staff | Buscan una vista limitada, crean un cliente mínimo, adjuntan, consultan puntos y usan un valor autorizado. |
| Supervisor      | Añade historial de la location y refunds de wallet o gift card.                                            |
| Manager         | Aprueba rewards exactos, emite gift cards y lee hechos globales aprobados.                                 |
| Admin y Owner   | Leen el historial global. Admin y Owner aprueban rewards con separación de actores.                        |
| Viewer          | Lee proyecciones explícitas. No ve contactos completos y no cambia datos.                                  |
| super_admin     | Permanece fuera del viaje operativo del café.                                                              |

La matriz no concede `customer.contact.read` mediante un permiso de ventas. La emisión de wallet o gift card requiere un permiso específico.

## 15. Aprobaciones de clientes y valor

La matriz separa estas acciones:

- combinación de clientes;
- ajuste manual de puntos;
- activación de gift card sobre el umbral;
- emisión de gift card o ajuste de wallet;
- resolución de un conflicto de valor.
- uso de un reward protegido.

La activación, la emisión, el ajuste de puntos y el merge consumen una aprobación vinculada cuando aplica el umbral.

`loyalty.reward.approve` vincula la vista del reward y la huella de tenders. `customer.history.global` permite hechos globales aprobados.

`customer.history.admin` limita los hechos administrativos a Admin y Owner. Una location nula no concede acceso.

## 16. Permisos de hardware de Gate 3G-A

Gate 3G-A añade permisos específicos a la misma matriz. Ninguna decisión usa el nombre del rol.

| Perfil          | Autoridad de hardware                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Cashier y Staff | Lee asignaciones, imprime recibos, usa el scanner, actualiza el display y abre el cajón permitido. |
| Supervisor      | Añade diagnósticos seleccionados, pruebas y reimpresión controlada.                                |
| Manager         | Añade diagnósticos completos del piloto y la prueba del cajón.                                     |
| Admin y Owner   | Registra, asigna, activa, desactiva y diagnostica hardware.                                        |
| Viewer          | No recibe acceso al hardware por defecto.                                                          |
| super_admin     | Permanece fuera del viaje operativo del café.                                                      |

Los permisos canónicos son:

- `hardware.read`;
- `hardware.command.execute`;
- `hardware.manage`;
- `hardware.assign`;
- `hardware.diagnostics`;
- `hardware.printer.print`, `hardware.printer.reprint` y `hardware.printer.test`;
- `hardware.drawer.open` y `hardware.drawer.test`;
- `hardware.scanner.use` y `hardware.scanner.test`;
- `hardware.customer_display.use` y `hardware.customer_display.test`.

Cada comando valida el entitlement POS, el dispositivo, la credencial, la sesión, el merchant y la location.
El permiso `hardware.drawer.open` no permite una apertura arbitraria. La política de efectivo valida la razón.
Un comando `NoSale` requiere `cash.drawer.no_sale.approve` de otro operador. La autoaprobación permanece bloqueada.

## 17. Permisos KDS de Gate 4A

Gate 4A añade permisos para la operación de cocina.
La API no usa el nombre del rol para autorizar un comando.

| Perfil          | Autoridad KDS                                                         |
| --------------- | --------------------------------------------------------------------- |
| Cashier y Staff | Lee el estado seguro de cocina.                                       |
| Supervisor      | Prepara, marca listo, completa, ejecuta recall y cambia la prioridad. |
| Manager         | Añade configuración de estaciones y diagnósticos en su location.      |
| Admin y Owner   | Administra las locations del merchant con `kitchen.merchant.read`.    |
| Viewer          | Lee una proyección segura cuando existe un grant explícito.           |

Los permisos canónicos son:

- `kitchen.read`;
- `kitchen.prepare`;
- `kitchen.ready`;
- `kitchen.complete`;
- `kitchen.recall`;
- `kitchen.cancel_ack`;
- `kitchen.priority`;
- `kitchen.station.read` y `kitchen.station.manage`;
- `kitchen.diagnostics`;
- `kitchen.merchant.read`.

Un usuario con scope de location debe enviar su location asignada.
Solo `kitchen.merchant.read` permite omitir el scope de location.
El dispositivo KDS también debe tener una asignación activa a la estación.

## Gate 5A — Navegación del Dashboard

El Dashboard crea la navegación con los permisos efectivos de la membresía.
El Dashboard no usa el nombre del rol como autoridad.
La API también comprueba el permiso de cada enlace directo.

Una membresía con una location asignada solo recibe datos de esa location.
Los productos y las políticas de rewards conservan su scope de merchant.
Los hechos de customer value no usan un `location_id` nulo como acceso global.

La API separa el contexto `dashboard_administrative` del contexto `pos_device`.
La API deriva el usuario, la membresía y el scope de la sesión activa.
La API rechaza una membresía sintetizada para una mutación administrativa.
La API comprueba el permiso actual en cada comando.

El Dashboard ejecuta solamente las operaciones de la lista administrativa.
La API usa el mismo comando de refund, inventario, loyalty, gift card, hardware, cocina o catálogo.
El Dashboard no fabrica un dispositivo o una sesión de operador.

`catalog.manage` permite la administración de productos.
`register.manage` permite la configuración segura de un register.
Owner, Admin y Manager reciben estos permisos en el perfil piloto.

Una aprobación exige un actor diferente con el permiso exacto.
La API enlaza la aprobación con el fingerprint del comando.
Cinco PIN incorrectos bloquean la aprobación web durante 15 minutos.

Checkout, movimiento físico de efectivo y preparación de cocina permanecen fuera del Dashboard.
