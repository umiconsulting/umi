# Cuentas con menos pasos — iMin

Fecha: 2026-10-12. Compilación: Flutter nativa 0.1.0 build 34.
Paquete: `co.umiconsulting.umi_pos.estacion`. API local: `:4001`. Contrato: `2.29.0`.

## Decisión

El usuario pidió aplicar las mejores prácticas de la investigación y reducir la fricción.
La [investigación visual](../research/2026-10-12-tableless-visual-flow.md) conserva las fuentes, capturas y diferencias entre proveedores.

Umi usa un acceso **Cuentas**, con las vistas **Mesas** y **Sin mesa**.
Tocar una mesa abre su cuenta. El botón **Nueva cuenta sin mesa** abre la comanda directamente.
**Guardar y salir** conserva la cuenta y vuelve a la vista correspondiente. El nombre es opcional y se edita por separado.

La lista muestra el nombre, la referencia de mesa, el estado de envío, la hora y el total.
El folio y el operador permanecen disponibles en la ayuda del control.
**Enviar a cocina** expresa el destino. **Enviado · Cuenta abierta** explica que el envío conserva la cuenta.
**Vaciar cuenta** pasó al menú de opciones. **Cobrar** aparece cuando el rol tiene permiso para cobrar.
El acceso a la gestión de mesas requiere el permiso de ciclo de venta.

Estas decisiones son inferencias de Umi. Las pantallas de los proveedores sirven como evidencia del comportamiento documentado.
No constituyen una prueba de rapidez ni una recomendación universal.

## Comprobaciones del cliente

- 57 pruebas aprobadas de cuentas, comanda y mesas.
- 75 pruebas aprobadas de catálogo, ciclo de venta y permisos por rol.
- 15 pruebas aprobadas tras el ajuste final del encabezado y la gestión de mesas.
- Análisis estático de los cuatro componentes modificados: sin incidencias.
- APK ARM64 en modo profile: compilación aprobada.

Las últimas 15 pruebas repiten casos del primer grupo. No se suman como casos nuevos.
Herramientas: Flutter 3.47.5, Dart 3.13.4 y ADB 37.0.1.
Se conserva la conexión inalámbrica `192.168.1.10:5555`, el registro del equipo y los datos locales.

## Verificación física

La primera instalación detectó `CART_ACTOR_BUSY` después de ingresar nuevamente el PIN.
Dos sesiones de operador del mismo usuario y equipo permanecían activas; la anterior conservaba una cuenta vacía.
La [captura del rechazo](evidence/2026-10-12-simple-accounts/03-direct-table-account.png) conserva la evidencia inicial.

La recuperación conserva el identificador del operador que posee la cuenta activa del mismo usuario y equipo.
Revoca sus credenciales anteriores y cierra los duplicados que no poseen otra cuenta activa.
Una transacción coordina los bloqueos de credenciales y operadores.
La recuperación rechaza credenciales anteriores, permisos revocados y dos propietarios históricos con cuentas activas.
Las cuentas, las mesas y los pagos conservan sus datos.

El recorrido físico final aprobó:

1. Ingresar después de actualizar y recuperar la cuenta 115, sin el rechazo inicial.
2. Tocar Mesa vínculo y abrir su cuenta 109 directamente, sin un panel intermedio.
3. Guardar esa cuenta con un toque y volver al mapa, sin solicitar otro nombre.
4. Crear la cuenta 117 sin mesa, añadir un Americano y asignar el nombre opcional **Flujo QA**.
5. Guardar, buscar **Flujo** y continuar la misma cuenta con el mismo producto y total.
6. Ingresar como Mesero 1. Su pantalla conserva **Enviar a cocina** y oculta **Cobrar**.
7. Enviar el Americano y guardar la cuenta. La lista muestra **Enviada** y **MXN 50.00**.
8. Confirmar que Mesero 1 no tiene el acceso **Gestionar mesas**.
9. Reiniciar la aplicación con la cuenta enviada activa. Recupera automáticamente la misma cuenta.

En una primera prueba de reinicio, el equipo recuperó la sesión antes de los toques previstos para el PIN.
Estos toques añadieron dos productos pendientes. Su limpieza detectó un fallo adicional de segunda ronda.
El carrito aceptaba nuevos productos después del envío, pero rechazaba editar o eliminar los pendientes.
La corrección permite cambiar cantidad, reemplazar y eliminar únicamente líneas sin enviar del mismo carrito y comercio.
La línea enviada conserva su protección y la edición conserva las guardas de pago, operador y versión.
Los dos productos pendientes se retiraron mediante la interfaz, sin modificar el Americano enviado.

La prueba de reinicio se repitió sin toques adicionales.
Los datos [anteriores](evidence/2026-10-12-simple-accounts/physical-clean-before-restart.txt) y
[posteriores](evidence/2026-10-12-simple-accounts/physical-clean-after-restart.txt) son idénticos.
Conservan el carrito `6186d969-e28c-492f-b937-10e73890f3c5`, el operador y la línea enviada.
La [comprobación final](evidence/2026-10-12-simple-accounts/physical-final.txt) confirma cero cobros, intentos de pago y medios de pago para la cuenta 117.
La cuenta 100 conserva su versión 16 y sus cuatro líneas. La cuenta 108 conserva su versión 6.
La cuenta 109 conserva su mesa y envío; abrir y guardar cambia su versión de 16 a 18.

Capturas finales:

- [Mapa de cuentas](evidence/2026-10-12-simple-accounts/06-final-accounts-map.png).
- [Cuenta abierta al tocar la mesa](evidence/2026-10-12-simple-accounts/07-direct-table-open.png).
- [Búsqueda de cuenta sin mesa](evidence/2026-10-12-simple-accounts/11-account-search.png).
- [Mesero con envío y sin cobro](evidence/2026-10-12-simple-accounts/13-waiter-no-charge.png).
- [Cuenta enviada después de reiniciar](evidence/2026-10-12-simple-accounts/18-restarted-sent-account.png).
- [Lista final de cuentas abiertas](evidence/2026-10-12-simple-accounts/19-final-open-accounts.png).

## Comprobaciones del backend

- 11 pruebas de integración de recuperación, con PostgreSQL y roles reales de API y worker.
- 4 pruebas de integración de segunda ronda: edición, protección del envío, alcance y pago desconocido.
- 15 pruebas unitarias del acceso de operador.
- 17 pruebas unitarias de carrito.
- ESLint de los archivos modificados: sin incidencias.

Las integraciones usaron la copia aislada `umi_account_metadata_verify_20261012`.
La base `umi_local` recibió solamente las acciones normales del POS durante la comprobación física.
Vitest 2.1.9 ejecutó las pruebas. Los registros están en el [directorio de evidencia](evidence/2026-10-12-simple-accounts/).

El análisis TypeScript completo conserva dos errores previos en `pos-hardware.repository.spec.ts`, líneas 70 y 95.
Ambos asignan `null` a un valor que admite `string | undefined`.
El [registro](evidence/2026-10-12-simple-accounts/backend-typecheck.log) identifica esos errores; no aparecen errores en los archivos de este cambio.

La aplicación quedó en **Cuentas → Sin mesa**, con Mesero 1 y la cuenta **Flujo QA** guardada y abierta.
La comprobación cubre estos recorridos. No mide la rapidez de un operador ni certifica todas las pantallas.
