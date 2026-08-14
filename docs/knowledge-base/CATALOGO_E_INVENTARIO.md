# Catálogo e inventario

[Índice](README.md) | [Ventas](VENTAS_RECIBOS_Y_REEMBOLSOS.md) | [Diagnóstico](GUIA_DE_DIAGNOSTICO_DEL_OWNER.md)

## Catálogo

Un producto define qué se vende. Una categoría facilita su búsqueda. Una variante representa una versión del producto.

Un modificador añade una elección. Puede cambiar precio, preparación o ambos según la configuración.

El código de barras facilita búsqueda. No cambia precio, autoridad ni disponibilidad.

La disponibilidad puede depender de estado, ubicación, inventario y configuración. Archivar conserva historia y evita uso nuevo.

Un producto con inventario produce efectos de stock según su mapeo. Un producto sin inventario no inventa un movimiento.

## Cómo llega al POS y KDS

Dashboard envía cambios a UMI API. PostgreSQL conserva los hechos y configuraciones.

POS consulta la proyección aplicable a su ubicación. KDS recibe items y modificadores seguros de una venta comprometida.

## Errores comunes de catálogo

- Crear dos productos para resolver una asignación incorrecta.
- Confundir un producto archivado con falta de sincronización.
- Omitir la ubicación aplicable.
- Usar un modificador para alterar autoridad o precio fuera de su regla.
- Suponer que una imagen es necesaria para vender.

## Inventario

El ledger es el registro de hechos de inventario. Una proyección resume esos hechos para consulta rápida.

**El ledger es autoritativo. La proyección no sustituye los hechos.**

## Estados soportados

| Estado     | Significado operativo                                 |
| ---------- | ----------------------------------------------------- |
| On Hand    | Cantidad física registrada en la ubicación            |
| Available  | Cantidad disponible después de compromisos aplicables |
| Reserved   | Cantidad apartada por un flujo vigente                |
| Committed  | Cantidad ya aplicada a un hecho del negocio           |
| In Transit | Cantidad dentro de un traslado en curso               |
| Damaged    | Cantidad separada por daño                            |
| Quarantine | Cantidad separada hasta una decisión autorizada       |

Consulta nombres exactos en `docs/product/UMIPOS_INVENTORY_AUTHORITY.md` y las migraciones activas.

## Efectos

- Una venta usa el mapeo versionado y añade hechos dentro de la transacción.
- Un reembolso añade una intención y un resultado de disposición o restock.
- Un ajuste requiere motivo, permiso y contexto.
- Un conteo compara el estado observado con los hechos permitidos.
- Un traslado conserva estados de origen, tránsito y destino.

## Reconciliación

Reconciliar significa volver a calcular una expectativa desde los hechos y compararla con la proyección.

Drift es una diferencia no explicada. El valor esperado es `0`.

### Investigación de una diferencia

1. Detén ajustes relacionados.
2. Identifica item, ubicación y periodo.
3. Obtén los hechos del ledger.
4. Obtén la proyección actual.
5. Relaciona ventas, reembolsos, conteos y traslados.
6. Ejecuta la reconciliación autoritativa.
7. Escala una diferencia de negocio como P0 o P1.

No edites hechos de producción para ajustar una cifra.

Los costos avanzados no forman parte de v1.
