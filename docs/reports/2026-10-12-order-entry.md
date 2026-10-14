# Inicio de pedidos y primeras mesas — 2026-10-12

El POS portátil pide el tipo de pedido al iniciar una cuenta.
«Comer aquí» pide una mesa antes de elegir productos. «Para llevar» continúa sin mesa.
Si la sucursal tiene cero mesas, el operador crea las primeras mesas con casillas y después selecciona una.
El POS fijo exige mesa para «Comer aquí» antes de abrir el cobro.

## Comportamiento

La señal de portátil es `DeviceSummary.mobility == mobile`. El tamaño de pantalla no determina el equipo.
La creación inicial publica las mesas con identificadores reales y una distribución inicial.
La cuadrícula y el plano consultan las mismas mesas y cuentas.
La creación inicial requiere `cart.write`; la edición posterior conserva los permisos de administración.

El servidor limita esta ruta a una sucursal sin mesas y protege los borradores pendientes.
La ruta usa control de versión, bloqueo de sucursal e idempotencia.
Un reintento tras una respuesta perdida conserva su clave. Un conflicto recarga el plano antes del siguiente intento.

Las cuentas existentes conservan productos, envío y recuperación de pagos pendientes.
La condición de mesa se aplica en el cliente antes del cobro; este pase conserva la compatibilidad de las cuentas históricas del servidor.

## Verificación física

Se usó el iMin D3 como POS fijo y la Galaxy Tab A11 `SM-X133`, serie `R8YL41106HT`, como portátil.
La tablet usa depuración inalámbrica por un servidor ADB separado. La sesión ADB del iMin continúa activa.
Se instaló `co.umiconsulting.umi_pos.estacion` en la tablet junto al paquete existente, que conserva sus datos.

Se usó una copia local de la base para probar sucursales con cero mesas.
La API de pruebas usa el puerto 4011 y Redis separado. Los equipos conservaron sus credenciales durante las actualizaciones.
Se corrigió el registro elegido por la preparación de pruebas: el iMin activo era «Caja ONCA», no el registro histórico.

| Equipo          | Recorrido                                                                    | Evidencia                                                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iMin fijo       | Producto → Cobrar → crear tres mesas → elegir Mesa 3 → abrir cobro sin pagar | [Cobro](evidence/2026-10-12-order-entry/22-fixed-checkout-with-mesa3.png)                                                                                                                                                     |
| iMin fijo       | Misma cuenta, producto y total después de cerrar el cobro                    | [Mesa 3](evidence/2026-10-12-order-entry/25-fixed-assigned-account.png)                                                                                                                                                       |
| iMin fijo       | Guardar cuenta → cuadrícula con mesa ocupada → plano                         | [Cuadrícula](evidence/2026-10-12-order-entry/26-fixed-accounts-grid.png), [plano](evidence/2026-10-12-order-entry/28-fixed-floor-plan.png)                                                                                    |
| Tablet portátil | Nuevo pedido → tipo → Comer aquí → crear tres mesas → elegir Mesa 2          | [Tipo](evidence/2026-10-12-order-entry/33-tablet-new-order.png), [creación](evidence/2026-10-12-order-entry/35-tablet-zero-table-grid.png), [selección](evidence/2026-10-12-order-entry/37-tablet-persisted-table-picker.png) |
| Tablet portátil | Agregar Americano → guardar → recuperar cuenta desde Mesa 2                  | [Cuenta](evidence/2026-10-12-order-entry/41-tablet-mesa2-open-account.png), [mesas](evidence/2026-10-12-order-entry/42-tablet-saved-grid.png)                                                                                 |
| iMin fijo       | Restaurar API original y Cuenta 123 vacía                                    | [Restauración](evidence/2026-10-12-order-entry/57-fixed-final-original.png)                                                                                                                                                   |

La prueba encontró un primer inicio móvil sin cuenta local, que omitía la pregunta automática.
Se añadió una recuperación única antes de pedir el tipo. El estado residual se reproduce en dos pruebas adicionales.
La evidencia física confirmó además un callback sin frame: tocar una categoría hizo aparecer la pregunta pendiente.
Se añadió `ensureVisualUpdate()`; una prueba comprueba que el final de la carga solicita un frame sin interacción.
La tablet mostró el selector por sí sola con la compilación 37, también en ONCA con el operador Mesero.
La causa del estado vacío inicial no queda demostrada por las pruebas de recuperación.

## Estado final de los equipos

Ambos equipos tienen la compilación 37 y usan la API habitual en el puerto 4001.
El iMin conserva su registro fijo y sus tres enlaces de hardware.
La restauración recuperó la Cuenta 123 vacía; la captura documenta ese momento.
El trabajo concurrente posterior dejó la Cuenta 123 suspendida y creó otras dos cuentas vacías en el iMin.
Las cuentas 117 y 123 conservan sus datos. Este pase no revierte los cambios de la otra sesión.
La tablet conserva el paquete original y tiene un nuevo registro móvil para el paquete Estación.
Solo se restablecieron los datos temporales del nuevo paquete de pruebas antes de vincularlo a ONCA.

La tablet entró como Mesero. El [selector de tipo](evidence/2026-10-12-order-entry/63-tablet-waiter-auto-type.png) apareció sin tocar el menú.
«Comer aquí» abrió el [selector de mesas de ONCA](evidence/2026-10-12-order-entry/64-tablet-original-table-picker.png).

Admin conserva una cuenta activa en el iMin. Usar el mismo Admin en la tablet devolvió `CART_ACTOR_BUSY`.
Esta protección impidió tomar la cuenta del iMin. El mensaje visible fue genérico; su texto necesita una mejora posterior.

Las pruebas de cero mesas usaron la copia de la base. Sus sucursales tienen cero órdenes, pagos y ventas cobradas.
La base habitual terminó con 53 cuentas: tres nuevas cuentas vacías frente a las 50 del inicio.
Una pertenece a la tablet y dos al trabajo posterior en el iMin.
Los 27 pedidos, 22 pagos y 22 ventas anteriores conservaron sus cantidades.
La API de pruebas quedó detenida. Las dos conexiones inalámbricas continúan activas.

## Comprobaciones

La compilación nativa de perfil 37 pasó. Las 46 pruebas Flutter finales pasaron.
El contrato es 2.30.0. Las 84 pruebas del contrato y ocho casos de integración del servidor pasaron.
Las pruebas cubren permisos, sucursal, duplicación, concurrencia y reintentos.
El análisis de los componentes Flutter modificados y el lint del servidor pasaron.
TypeScript conserva dos errores anteriores en `pos-hardware.repository.spec.ts`, líneas 70 y 95.

Herramientas: Flutter 3.47.5, Dart 3.13.4 y Android SDK ADB 37.0.1.
Se usaron `uiautomator dump`, `input tap` y `screencap` según el [procedimiento local](../development/LOCAL_VERIFICATION_PLAYBOOK.md).
El auxiliar local captura los dos equipos y sus árboles de accesibilidad en la carpeta de evidencia.
Los seis renders de widgets son pruebas de diseño; las capturas de equipos anteriores son evidencia física.

La [investigación de primer uso](../research/2026-10-12-first-use-no-tables.md) separa hechos de proveedores y decisiones de Umi.
