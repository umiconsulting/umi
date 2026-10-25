# Bitácora de errores de ONCA en producción

Esta bitácora registra los incidentes que afectan ventas reales. Cada entrada separa los hechos comprobados de las hipótesis. El cierre exige comprobar la venta, el dinero y el estado de los dispositivos.

| Número | Fecha local | Incidente | Estado |
| --- | --- | --- | --- |
| [001](./2026-10-24-onca-production-bug-001.md) | 24 de octubre de 2026 | Cuenta 004: terminal cobró MXN 225, POS no creó la venta; se detectaron también las cuentas 005 y 006 | Ventas 004, 005 y 006 conciliadas; defectos preventivos abiertos |
| [002](./2026-10-24-onca-production-bug-002.md) | 24 de octubre de 2026 | Barra: una comanda completada en otra terminal puede permanecer en la caché local | Corregido e instalado como POS 329 en Caja, Barra, Mesero y la A11 de pruebas. La venta de prueba 0031 requiere corrección de soporte |
| [003](./2026-10-24-onca-production-bug-003.md) | 24 de octubre de 2026 | Caja principal: la salida de efectivo responde «No se completó la operación» | Corregido y verificado en producción con una salida y su reversa de MXN 1.00 |
| [004](./2026-10-24-onca-production-bug-004.md) | 24 de octubre de 2026 | Caja principal: un cobro en efectivo mostró el mensaje genérico «No fue posible completar el cobro de forma segura» | No reproducido después de instalar POS 329; una venta posterior por MXN 180.00 terminó con recibo 0032. Vigilar una nueva ocurrencia |

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

| Dispositivo | IP de Tailscale | Estado al 24 de octubre, 17:25 |
| --- | --- | --- |
| Caja principal | `100.64.178.95` | En línea; ADB fijo en el puerto `5555` |
| Barra | `100.90.102.41` | En línea; ADB automático en el puerto `44917` |
| Cocina | `100.125.137.36` | Fuera de línea; configuración pendiente |
| Mesero | `100.125.102.97` | En línea; ADB automático en el puerto `35893` |
| A11 de pruebas | `100.107.181.80` | Fuera de línea después de reiniciar |

Tailscale quedó como VPN siempre activa en Caja, Barra y Mesero. Barra y Mesero
también tienen KeepADB con reconexión automática y un webhook privado por
Tailscale que informa a esta computadora cuando Android cambia el puerto ADB.

La prueba de reinicio de Barra confirmó el flujo completo: Tailscale regresó,
Android abrió el puerto `44917` en lugar de `41827`, KeepADB lo publicó y ADB se
reconectó solo. El procedimiento, estado por dispositivo y operación del receptor
están documentados en
[`2026-10-24-onca-remote-support-persistence.md`](./2026-10-24-onca-remote-support-persistence.md).
