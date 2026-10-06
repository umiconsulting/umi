# Cómo explicar UMI POS

[Índice](README.md) | [Producto](PRODUCTO_Y_NEGOCIO.md) | [Alcance](ALCANCE_V1.md)

## Para un comercio

UMI POS conecta venta, catálogo, inventario, personal y cocina. Mantiene una historia verificable de cada transacción.

El comercio puede administrar varias ubicaciones. Cada usuario opera solo dentro de su rol y alcance.

Una interrupción no autoriza una repetición ciega. El sistema permite consultar el resultado y recuperar el flujo.

## Para un Manager

Dashboard muestra ventas, turnos, inventario, dispositivos, clientes y recuperación. POS ejecuta la venta diaria.

KDS coordina preparación. No modifica cobros ni reembolsos.

## Para soporte

Cada incidente debe tener comercio, ubicación, versión, usuario, dispositivo, referencia y hora.

Soporte usa salud, disponibilidad funcional, auditoría, correlación, Recovery Center y conciliación. No necesita leer código como primer paso.

## Valor demostrado

- Hechos financieros e inventario inmutables y conciliables.
- Aislamiento por comercio, ubicación, rol y dispositivo.
- Reintentos idempotentes contra efectos duplicados.
- Operación multiubicación.
- Cocina conectada sin autoridad financiera.
- Soporte con referencias, auditoría y recuperación.

## Lo que no se debe prometer

- No afirmes certificación física antes de Gate 13.
- No afirmes pagos integrados reales.
- No afirmes costos avanzados de inventario.
- No afirmes un artefacto v1 para Android, Windows o macOS.
- No presentes object storage como requisito de RC2.
- No presentes NEXO como plataforma activa.
