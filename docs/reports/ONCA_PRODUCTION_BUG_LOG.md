# Bitácora de errores de ONCA en producción

Esta bitácora registra los incidentes que afectan ventas reales. Cada entrada separa los hechos comprobados de las hipótesis. El cierre exige comprobar la venta, el dinero y el estado de los dispositivos.

| Número | Fecha local | Incidente | Estado |
| --- | --- | --- | --- |
| [001](./2026-10-24-onca-production-bug-001.md) | 24 de octubre de 2026 | Cuenta 004: terminal cobró MXN 225, POS no creó la venta; se detectaron también las cuentas 005 y 006 | Ventas 004, 005 y 006 conciliadas; defectos preventivos abiertos |
| [002](./2026-10-24-onca-production-bug-002.md) | 24 de octubre de 2026 | Barra: una comanda completada en otra terminal puede permanecer en la caché local | Corregido en la compilación POS 329; falta actualizar la tablet de Barra. La venta de prueba 0031 requiere corrección de soporte |
| [003](./2026-10-24-onca-production-bug-003.md) | 24 de octubre de 2026 | Caja principal: la salida de efectivo responde «No se completó la operación» | Corregido y verificado en producción con una salida y su reversa de MXN 1.00 |

## Cambios de catálogo del 24 de octubre

Los productos siguientes se crearon y verificaron en el catálogo de producción:

| Producto | Categoría | Precio | Estado |
| --- | --- | ---: | --- |
| Corico individual | Pan | MXN 7.00 | Activo |
| Base de pizza | Pan | MXN 50.00 | Activo |

La categoría se comprobó contra el producto existente **Coricos pack**. La
evidencia visual está en
[`products-after.png`](./evidence/2026-10-24-onca-production-catalog/products-after.png).

## Conectividad de soporte remoto

| Dispositivo | IP de Tailscale | Estado al 24 de octubre, 16:51 |
| --- | --- | --- |
| Caja principal | `100.64.178.95` | En línea; ADB fijo en el puerto `5555` |
| Barra | `100.90.102.41` | Fuera de línea |
| Cocina | `100.125.137.36` | Fuera de línea |
| Mesero | `100.125.102.97` | Fuera de línea |
| A11 de pruebas | `100.107.181.80` | Fuera de línea después de reiniciar |

Las claves de Tailscale no estaban caducadas. La prueba de reinicio de la A11
confirmó que Tailscale volvió a conectarse, pero el puerto fijo `5555` de ADB no
sobrevivió. Los `192.168.0.x` que muestran las tablets son direcciones privadas
de la red de ONCA y no son alcanzables desde esta computadora. Para soporte
remoto se debe usar la IP `100.x` de Tailscale de cada tablet.
