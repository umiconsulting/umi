# Certificación operativa integral de UmiPOS

## Veredicto

**INCOMPLETE** — 13 de agosto de 2026.

La ejecución usó PostgreSQL, Redis, API, worker y Dashboard reales. También usó el simulador canónico de hardware.

## Entorno

- Rama: `architectureUMIposIntegration`.
- Base inicial: `0892199cd2158f5be7fa2f156711d878ed199726`.
- Esquema: `build-v3-47`.
- Entorno: `pilot` desechable.
- RLS y FORCE RLS: activos.

## Evidencia que pasó

- Bootstrap limpio y migraciones canónicas.
- Login con PIN y sesión de operador reales.
- Apertura de caja con fecha local del comercio.
- Venta en efectivo y recuperación del mismo comando.
- Venta de preparación con variante y modificador.
- Proyección de cocina dentro de la transacción de checkout.
- Venta con terminal externa manual.
- Suspensión, recuperación y cancelación antes del commit.
- Dos sesiones lógicas y ventas sin recibos duplicados.
- Persistencia de ventas, recibos, caja, inventario y cocina.
- Worker sin el error de `SELECT DISTINCT` y `ORDER BY`.

El archivo local `artifacts/certification/gate-7a.json` contiene las referencias seguras.

## Defectos corregidos

1. El worker ordenaba una consulta `DISTINCT` con una expresión no seleccionada.
2. El checkout solicitaba un bloqueo no permitido sobre `stock_balance`.
3. Una receta exacta enviaba un valor decimal a una columna `bigint`.
4. El rol API no podía crear la proyección de cocina dentro del checkout.
5. Caja y carrito calculaban fechas comerciales con zonas horarias distintas.
6. El reembolso en efectivo usaba la fecha UTC en vez de la fecha del turno.

## Evidencia pendiente

- Pago con wallet.
- Pago con gift card.
- Pago mixto.
- Venta offline nativa y replay.
- Reembolso completo o void después de la corrección de fecha.
- Cierre integrado del turno y revisión final del Dashboard.
- Conciliación final de dinero, inventario y valor del cliente.

Gate 7B no está autorizado. PR #72 debe permanecer abierto y sin merge.
