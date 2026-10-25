# ONCA producción · error 004 · cobro en efectivo con mensaje genérico

Fecha local: 24 de octubre de 2026

## Reporte recibido

El personal informó que un intento de venta en efectivo terminó con el mensaje:

> No fue posible completar el cobro de forma segura.

El reporte no incluyó la hora exacta, el operador, el total ni el recibo. La
captura disponible fue tomada a las 16:51 y muestra una pantalla de cobro por
MXN 160.00, efectivo recibido MXN 200.00 y cambio MXN 40.00; no muestra el
diálogo final ni prueba que esa pantalla sea el intento fallido.

## Investigación

- La tablet de Caja ya tenía UmiPOS build `329` desde las 16:19:27.
- A las 16:31:39 se completó una venta real en efectivo por MXN 180.00. La API
  creó la venta `bfc795ab-2701-4745-9ade-073cabb344cf` y el recibo `0032`.
- El intento de pago `b8f93b9c-88f2-4afa-8f80-fa3aed910ce1` quedó enlazado a
  esa venta y el cajón se abrió con el motivo `cash_sale`.
- La auditoría de todo el día encontró cinco `pos.checkout` rechazados, todos
  por `OPTIMISTIC_VERSION_CONFLICT` entre las 09:36 y las 11:19 locales. Esa
  causa ya fue corregida con identidad estable de líneas, recarga del carrito y
  límites de la cola por cuenta.
- Después de las 16:19, hora de instalación de POS 329, las 65 solicitudes
  `pos.checkout` registradas hasta las 17:31 terminaron correctamente.
- La revisión por cuenta encontró **cero** intentos de pago exitosos sin una
  venta enlazada. Los intentos que parecían sueltos pertenecen a ventas con pago
  dividido y comparten el mismo carrito y recibo.
- La revisión de borradores abiertos encontró **cero** cobros sin resolver.
- No aparece un `pos.checkout` rechazado cerca de las 16:51 ni otro intento de
  efectivo exitoso sin venta en el periodo revisado.
- Los fallos `OPTIMISTIC_VERSION_CONFLICT` de la mañana no explican por sí solos
  este reporte posterior; corresponden a otra ventana y ocurrieron antes de la
  instalación de la build 329.
- El mensaje es el fallback del cliente para una falla no clasificada. Sin el
  código de excepción, la hora precisa o el identificador de la operación no es
  posible atribuirlo a la API, al carrito, a la cola local o a un control del
  cliente.

## Estado

No reproducido después de actualizar Caja a la build 329. La venta en efectivo
posterior a la actualización terminó correctamente y quedó conciliada. No se
creó ni modificó ningún movimiento financiero durante esta revisión.

Si vuelve a ocurrir, se necesita registrar de inmediato:

1. hora local y tablet;
2. operador y total mostrado;
3. captura del diálogo completo antes de cerrarlo;
4. si el botón fue «Cobrar» o correspondía a otro estado del cobro;
5. correlación del comando o recibo, si aparece en recuperación.

Con esos datos se puede buscar el fallo exacto en lugar de tratar el texto
genérico como una causa.
