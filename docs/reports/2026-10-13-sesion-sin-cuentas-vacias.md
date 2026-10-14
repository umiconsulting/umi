# Cerrar sesión sin acumular cuentas vacías

Fecha: 2026-10-13. Pedido: cerrar y abrir sesión no debe dejar una cuenta vacía nueva cada vez.

## Causa medida

La iMin mostraba Cuenta 112. La base conservaba 108, 109, 110 y 111 sin productos, anuladas con el motivo de salida del operador. La salida anulaba el borrador; la siguiente entrada abría otro.

[Filas anteriores](evidence/2026-10-13-sesion-sin-cuentas-vacias/before-db.txt) y [pantalla anterior](evidence/2026-10-13-sesion-sin-cuentas-vacias/00-before-cuenta112.png).

## Cambio

`SaleLifecycleController.prepareForOperatorExit` reutiliza `accountIsBare`. Si el servidor admite cuentas persistentes y el carrito editable no tiene líneas, mesa, nombre ni pedido enviado, permite salir sin anular ni guardar ese borrador.

Al entrar, el servidor retoma el borrador del mismo operador. La lista de cuentas ya excluye ese borrador sin contenido. Existe un único carrito técnico reutilizable, en vez de una cuenta anulada por sesión.

Cuando existe contenido, se usa el guardado de cuentas persistentes para ambos tipos de permiso. Esto también conserva mesas, nombres y pedidos enviados aunque no haya líneas. El camino heredado sin cuentas persistentes conserva su comportamiento anterior.

Se modificaron únicamente el controlador de ciclo de venta y su prueba. No se modificaron API, contrato ni esquema. No se borraron las cuentas anuladas anteriores ni se alteró su auditoría.

## Herramienta e investigación previa

Se usaron Flutter 3.47.5, Dart 3.13.4 y ADB 37.0.0, ya instalados. El [playbook local](../development/LOCAL_VERIFICATION_PLAYBOOK.md) prescribe pruebas del cliente nativo y capturas reales. No hubo dependencia nueva.

La investigación confirmó PostgreSQL **17.10** local y revisó `PosCartRepository.create`, fuente que ya implementa `INSERT ... ON CONFLICT DO UPDATE` por comercio, sucursal y operador. Esa actualización conserva el id y el folio; también conserva la protección contra otro operador activo.

**Hecho documentado:** [INSERT / ON CONFLICT en PostgreSQL 17](https://www.postgresql.org/docs/17/sql-insert.html) actualiza la fila existente. [Identity](https://www.postgresql.org/docs/17/ddl-identity-columns.html) usa una secuencia implícita.

**Límite documentado:** [las secuencias](https://www.postgresql.org/docs/17/functions-sequence.html) pueden consumir un número antes de resolver el conflicto. No se promete numeración sin saltos. Un salto posterior no prueba que exista una cuenta nueva.

**Decisión para Umi:** reutilizar el propietario y el mecanismo actuales. Una condición en la salida resuelve la causa medida. No hace falta inventar un servicio o borrar registros para resolverla.

## Verificación

- `flutter analyze`: sin hallazgos.
- `flutter test test/sale_lifecycle_test.dart`: **58 pruebas verdes**.
- `flutter test`: **876 pruebas verdes**.
- Diez casos nuevos comprueban salidas repetidas del borrador vacío y conservación de productos, mesa, nombre y pedido enviado. Se prueban ambas opciones de autoridad.
- En la iMin se cerró sesión y se ingresó con el PIN dos veces. Ambas entradas conservaron **Cuenta 112**, id `0e92b820-8778-41fd-a3d8-df07ca889c5f`. No se creó una cuenta nueva para el operador.

[Primera entrada](evidence/2026-10-13-sesion-sin-cuentas-vacias/01-updated-cuenta112.png), [salida al PIN](evidence/2026-10-13-sesion-sin-cuentas-vacias/02-logout-pin.png), [primera reentrada](evidence/2026-10-13-sesion-sin-cuentas-vacias/03-return-cuenta112.png), [segunda reentrada](evidence/2026-10-13-sesion-sin-cuentas-vacias/04-second-return-cuenta112.png), [filas después](evidence/2026-10-13-sesion-sin-cuentas-vacias/after-db.txt).

[Log API](evidence/2026-10-13-sesion-sin-cuentas-vacias/api-requests.json), [análisis](evidence/2026-10-13-sesion-sin-cuentas-vacias/analyze.txt), [prueba enfocada](evidence/2026-10-13-sesion-sin-cuentas-vacias/focused-tests.txt), [suite completa](evidence/2026-10-13-sesion-sin-cuentas-vacias/pos-suite.txt).

## Build e instalación

Se compiló **0.1.0+82**, profile Android arm64, con los defines del entorno anterior. El APK se conservó en `/tmp/umi-empty-login-build82.apk` para protegerlo de builds concurrentes. [Log del build](evidence/2026-10-13-sesion-sin-cuentas-vacias/build82.txt).

Instalado con `adb install -r` en iMin `192.168.1.10:5555` y A9 `192.168.1.14:35559`.

La dirección A11 `192.168.20.100:46821` agotó el tiempo de conexión. La dirección corregida `192.168.1.13:38333` conectó. Otra sesión había instalado allí el 83, por lo que `install -r` rechazó el 82. `install -r -d` instaló el 82 correctamente y conservó los datos.

`dumpsys package` confirmó **0.1.0+82 en las tres terminales**. [Versiones y hash del mismo APK](evidence/2026-10-13-sesion-sin-cuentas-vacias/installed-builds.json). Se lanzó la app en A9 y A11. La captura A9 quedó negra porque su pantalla permaneció apagada; no acredita el arranque visual. La [captura A11](evidence/2026-10-13-sesion-sin-cuentas-vacias/a11-build82-start.png) sí muestra la app.

## Qué no se comprobó

El ciclo real se comprobó en la iMin. Los casos con contenido se comprobaron mediante pruebas automatizadas; no se enviaron ni cobraron productos nuevos durante este recorrido.

La A11 conservó el acceso de Mesero 1. Al intentar abrir su carrito, la API devolvió `CART_ACTOR_BUSY`; la cuenta de ese operador ya estaba ligada a otra sesión. No se cambió esa protección. El mapa de Cuentas sí abrió: [captura A11](evidence/2026-10-13-sesion-sin-cuentas-vacias/a11-build82-map.png). No se certifica el ciclo de sesión de esa tablet.

No se probó la salida sin conexión, la caducidad de sesión ni la entrada simultánea del mismo operador en dos terminales. No se garantiza que una secuencia de identidad carezca de saltos.
