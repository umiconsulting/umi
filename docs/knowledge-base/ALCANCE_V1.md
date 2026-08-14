# Alcance de v1

[Índice](README.md) | [Producto](PRODUCTO_Y_NEGOCIO.md) | [Gate 13](../certification/UMIPOS_DEFERRED_HARDWARE_VALIDATION.md)

## Incluido

- UMI API, PostgreSQL, Redis y el proceso worker de tareas.
- Dashboard administrativo y operativo.
- Flutter POS Linux.
- KDS software.
- Identidad, roles, ubicación, dispositivo, caja y turno.
- Catálogo, variantes, modificadores, códigos de barras y disponibilidad.
- Inventario por hechos, proyecciones y reconciliación.
- Ventas, Cash, manual terminal, Wallet, Gift Card y Mixed Tender.
- Ventas suspendidas, cancelación, recibos y reembolsos.
- Clientes, lealtad y valor almacenado.
- Recuperación, auditoría, diagnóstico, respaldo y gestión de versiones.

## Opcional por política

- KDS.
- Lealtad.
- Wallet.
- Gift cards.
- Hardware mediante los contratos existentes.

## Excluido de v1

- Artefactos Android, Windows y macOS.
- Costos avanzados de inventario.
- Pagos integrados con un proveedor real.
- Object storage para los flujos primarios de RC2.
- Reportes empresariales avanzados fuera de Dashboard actual.
- Un backend, base de datos, proceso worker, Dashboard o identidad NEXO independiente.

## Diferido a Gate 13

- Instalación, signing y uso físico de iOS.
- Dispositivo físico KDS.
- Printer, cash drawer, scanner y customer display.
- Red y sitio reales.
- Proveedor de pagos si se habilita.
- Proveedor de object storage si se habilita.

`SOFTWARE COMPLETE != PHYSICALLY CERTIFIED`.

Una función excluida no está rota. Una función diferida tiene software, pero aún necesita evidencia física o externa.
