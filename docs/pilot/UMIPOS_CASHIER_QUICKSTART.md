# Guía rápida para caja

## Inicio

1. Inicia sesión con tu PIN personal.
2. Confirma la ubicación, la caja y el turno.
3. Ejecuta la lista de apertura.

## Venta

1. Inicia una venta nueva.
2. Escanea el código o busca el producto.
3. Selecciona las variantes y los modificadores.
4. Agrega al cliente solo si acepta.
5. Aplica una recompensa autorizada cuando esté disponible.
6. Selecciona efectivo, terminal externa, pago mixto, wallet o gift card.
7. Confirma el importe antes de cobrar.
8. Entrega el cambio que indica UmiPOS.
9. Entrega el recibo.
10. Inicia la venta siguiente.

La terminal externa registra un resultado externo. UmiPOS no controla al proveedor de pago durante el piloto.

## Sin conexión

La terminal sigue vendiendo cuando se cae el internet. No esperes a que vuelva y
no cierres la aplicación.

1. El aviso del encabezado cambia a `Sin conexión` y aparece `N sin sincronizar`.
   Ese número son ventas guardadas **en esta terminal**: no es un error y no
   impide cobrar.
2. Cobra normal. El recibo sale marcado `Venta pendiente de sincronización` y
   trae un folio provisional. Ese folio es lo que le das al cliente si pregunta.
3. Cuando vuelve la conexión, la terminal envía las ventas sola. El recibo
   cambia a `Venta sincronizada` y muestra el folio oficial.
4. No repitas un cobro, no cierres la sesión y no reinicies la terminal para
   "arreglarlo": la venta ya está guardada y repetirla puede cobrar dos veces.

Si una venta no se puede enviar, el encabezado deja de bajar el contador. Abre
`⋮` → **Centro de recuperación**: cada fila dice qué pasó y el botón dice qué
hacer. Por ejemplo, si dice *La mesa ya está ocupada*, elige otra mesa; no
vuelvas a intentar la misma.

Una terminal que se **bloqueó** necesita el enlace para volver a abrir sesión
con tu PIN. Si ya está abierta, sigue vendiendo aunque no haya internet.

## Excepciones

- Usa `Suspender` para conservar una venta sin cobrar.
- Usa `Reanudar` para recuperar una venta suspendida.
- Cancela una venta antes del cobro cuando el cliente desista.
- Solicita al Manager un reembolso o una aprobación.
- Usa `COPY` para una copia controlada. No repitas el cobro.
- Si la impresora falla, conserva la referencia y revisa el estado.
- Si el resultado es desconocido, consulta la operación. No repitas el comando.
- En modo offline, acepta solo las operaciones que UmiPOS permite.
- Cierra la sesión antes de entregar la caja.

No compartas tu PIN. No uses el PIN de otra persona.
