# Índice de capturas

Fecha de captura: 2026-10-21

Las cinco capturas de proveedores se hicieron con Chromium 153.0.8010.52, Playwright,
`headless:false`, `DISPLAY=:0` y una ventana de 1440 × 1000. La captura de Umi salió
del dispositivo por ADB.

| Archivo                            | Origen                                                                                                                                                                      | Clase                                       | Qué demuestra                                                                                                                   | SHA-256                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `square-cash-drawer.png`           | [Square: Start and end a cash drawer session](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session)                                             | Página de ayuda, escritorio                 | El fin automático ocurre después de 30 días abiertos y 7 días inactivos. También muestra el fin manual desde la app o el panel. | `3b6ce9647d78330809e73368ec2686aa166df9c698bceb06cab43a1fbee07469` |
| `toast-cash-drawers.png`           | [Toast: Use Cash Drawers](https://support.toasttab.com/en/article/Use-Cash-Drawers-New-Experience)                                                                          | Página de ayuda, escritorio                 | Toast cierra el cajón al final del día o del corte operativo. El aviso dice que el cajón no debe cruzar días.                   | `f8bb0b57437e9020e53a1e1fd755049865f4d328123e951082d8f256690fa420` |
| `lightspeed-sales-period.png`      | [Lightspeed: Opening and closing a sales period](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051071413-Opening-and-closing-a-sales-period)               | Página de ayuda, escritorio                 | Un encargado cierra el periodo. El cierre exige cerrar pedidos, hacer salida al personal y contar y cerrar cada cajón.          | `a9bc309de064bcba3a36ec1c04659a339dc849658afcebd120e6b3cbd6a22162` |
| `shopify-pos-register-session.png` | [Shopify: Manage register sessions in Shopify POS](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/register-sessions-in-shopify-pos) | Página de ayuda, escritorio                 | Shopify exige cerrar sesiones con regularidad. Un turno largo puede dañar los informes de efectivo esperado y diferencias.      | `b12b981aecf97fd9ff5d6946ea248678e15d12a6ae512484f5e6ff48a7c61b10` |
| `fudo-cash-count.png`              | [Fudo: 3. Arqueos de caja](https://soporte.fu.do/es/articles/11730865-3-arqueos-de-caja)                                                                                    | Página de ayuda, escritorio                 | Fudo pide abrir el arqueo al iniciar la jornada y cerrarlo al terminar. La página está fechada el 2025-12-12.                   | `fe626efd0604cb7e8560c77392b5eead92e2c6c01c8cc3b87b576eac2f5891c4` |
| `umi-imin-shift.png`               | iMin D3-504 mediante ADB, paquete `co.umiconsulting.umi_pos.clean`                                                                                                          | Captura de dispositivo Android, 1920 × 1080 | Umi muestra un turno abierto durante 47 h 22 min y el aviso de turno de un día anterior.                                        | `4bed7b4536c0b4748f61e8cb38e0052fd6e2ca9e15c42edf40db0ebf7696faf0` |

Fechas visibles en las páginas:

- Toast muestra “Last updated: Sep 16, 2026”.
- Fudo muestra “12 de diciembre de 2025”.
- Square no mostró una fecha en la captura. El HTML declara una modificación del
  2026-04-23.
- Lightspeed y Shopify no mostraron una fecha de publicación o modificación. **NV**
