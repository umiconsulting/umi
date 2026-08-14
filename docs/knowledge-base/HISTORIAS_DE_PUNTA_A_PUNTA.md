# Historias de punta a punta

[Índice](README.md) | [Arquitectura](ARQUITECTURA.md) | [Ventas](VENTAS_RECIBOS_Y_REEMBOLSOS.md)

## Venta en una cafetería

Ana inicia sesión en un POS inscrito. El servidor confirma su rol Cashier, ubicación y caja.

Ana selecciona café, tamaño y leche. El catálogo aporta precio y configuración. El carrito calcula el total visible.

Ana cobra en Cash. UMI API valida el comando y escribe venta, pago, recibo e inventario en una transacción.

KDS recibe una tarjeta una sola vez. Cocina ve cantidad y modificador. Dashboard muestra la venta y su recibo.

Auditoría relaciona operador, ubicación, dispositivo y comando. Una impresión posterior usa COPY y no cambia la venta.

## Refund

Un Manager abre la venta original. El sistema muestra contenido elegible y reembolsos anteriores.

El Manager selecciona cantidad y motivo. UMI API valida permiso, aprobación e importe máximo.

La confirmación final añade el reembolso, su recibo de compensación y sus efectos. La venta original permanece intacta.

La conciliación muestra bruto, reembolsos y neto con diferencia `0`.

## Cierre de turno

El Cashier abre el turno con fondo. Durante el día, cada movimiento de efectivo crea un hecho.

Al cerrar, registra el conteo ciego. El servidor calcula expected y variance después del conteo.

La política solicita aprobación cuando corresponde. El cierre conserva todos los hechos y actores.

## Inscripción de dispositivo

El nuevo POS solicita un código. Un Owner o Admin revisa y aprueba el dispositivo.

Después asigna ubicación y caja. El dispositivo recibe una identidad segura y el operador usa PIN.

Una revocación impide operaciones futuras. La reinscripción exige una nueva autorización.

## Interrupción de red

Ana pulsa Pay y pierde la respuesta. No pulsa otra vez.

Después de reconectar, consulta el command ID original. El servidor devuelve el resultado ya comprometido.

POS muestra éxito. No existe una segunda venta.
