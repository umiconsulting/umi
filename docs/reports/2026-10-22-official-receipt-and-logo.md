# Recibo oficial y logo en la impresora — 22 October 2026

## Resultado

La pantalla de cobro muestra el recibo oficial con su diseño normal. El ticket
incluye el logo de ONCA, el folio, el operador, los productos y los totales.

La venta de prueba fue la Cuenta 035 por MXN 80.00. El servidor emitió el
Ticket 0015. La vista previa y la impresión usaron la misma instantánea
oficial.

## Causa del recibo roto

La pantalla anterior no mostraba el recibo oficial. El cliente creaba un
recibo local llamado provisional. Ese recibo tenía dos defectos:

1. La suma de descuentos tenía una forma distinta de la que usa la vista.
2. La instantánea no incluía el logo ni el folio oficial.

El primer defecto detuvo el dibujo de los totales. El segundo dejó el ticket
sin logo. La simulación de rollo y el diseño del papel no eran la causa.

## Solución

- El cliente ya no crea ni muestra un recibo provisional.
- Una venta local muestra la pantalla normal de totales pagados.
- Una venta local no ofrece `Ver comprobante` y no imprime papel.
- La venta local permanece en Ventas como pendiente.
- Una venta con conexión usa el recibo emitido por el servidor.
- Sólo el recibo oficial permite ver o imprimir el ticket.
- La ruta local sólo abre el cajón para una venta en efectivo.

## Verificación del logo

La Epson TM-T20IIIL tiene las capacidades `printer.receipt` y
`printer.image`. El logo público respondió `200 image/png`.

La traza del build diagnóstico mostró:

```text
logo.disk_hit id=b9dfbd30
printer.logo_raster present=true widthDots=192 heightDots=192
printer.document_logo present=true
printer.document_done documentMs=13 commands=22
printer.encode_done encodeMs=2 bytes=14493
printer.usb_write_done writeMs=177 outcome=sent failure=null
```

La imagen del logo llegó al documento ESC/POS y la impresora aceptó la
escritura por USB.

## Evidencia

- [Pago antes de abrir el recibo](evidence/2026-10-22-official-receipt-logo/00-paid-before-opening-receipt.png)
- [Recibo oficial con logo y totales](evidence/2026-10-22-official-receipt-logo/01-official-receipt-logo-and-totals.png)

## Verificación

| Check                              | Result       |
| ---------------------------------- | ------------ |
| Vista previa del recibo oficial    | pass         |
| Logo en la vista previa            | pass         |
| Totales y folio en la vista previa | pass         |
| Comando de imagen ESC/POS          | present      |
| Escritura USB a la Epson           | sent         |
| Pruebas Flutter                    | 1,144 passed |
| Análisis estático                  | no issues    |

## Estado de dispositivos

- iMin D3: build 324.
- Galaxy Tab A9: build 324.
- Galaxy Tab A11: build 324.

APK SHA-256:

```text
fd841d82a085307deaaee37ce217c28b55b00a17c6dc2e25258c97c2fa41c166
```

## Límite de la evidencia

La escritura USB fue aceptada y la traza confirma que el comando de imagen
estaba en el documento. No hay una cámara conectada para comprobar el color
del punto en el papel. La prueba visual del logotipo se hizo en la pantalla
oficial de la iMin.
