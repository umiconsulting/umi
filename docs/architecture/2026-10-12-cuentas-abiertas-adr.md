# ADR: una cuenta abierta no pasa la noche viva (config de Toast)

- Fecha: 2026-10-12
- Estado: **Aceptado**. La visibilidad y el agrupado por día operativo están
  implementados; la resolución al corte y el candado del cierre diario quedan por
  construir, en ese orden.
- Relación: usa el mismo corte de las 04:00 **locales del comercio** que
  `2026-10-12-cierre-de-turno-de-caja-adr.md`, y la misma fecha operativa que ya
  llevan `merchant.pos_cart.business_date` y el folio del recibo.
- Aplica la configuración de Toast (`Auto-close orders` + `Close Out Day`) al modelo
  de UMI, por decisión del dueño: «Toast tiene la mejor config, cópiala».

## La configuración de Toast, tal cual

| Pieza de Toast                                                     | Qué hace Toast                                                                                                                                                                                                              | Qué hace UMI hoy                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Business day cutoff** (por defecto 4:00 a.m., hora local)        | Cierra el día de negocio a esa hora; el cambio de hora lo hace el soporte de Toast, no la UI                                                                                                                                | `merchant.business_day_start` = **04:00** en la zona del comercio (**`America/Mazatlan`**, Culiacán — migración `025`), aplicado el 2026-10-12. Es configuración por comercio, no una constante del cliente                                                                                                                           |
| **Close Out Day**                                                  | «The End day button is unavailable until all open checks are resolved»: los checks abiertos **bloquean** el cierre del día hasta que se cobran o se anulan; y bloquean el shift review del mesero que los tiene             | **Pendiente**: la cuenta se ve y se resuelve (cobrar o anular) desde la lista, pero el candado del cierre del día llega con el cierre diario, que aún no existe                                                                                                                                                                       |
| **Auto-close orders** (Finance > Related > Settings; permiso 3.31) | Opción **apagada de fábrica**. Encendida: al corte, los checks sin cobrar del día que termina se **Auto-close** (saldo a un tipo de pago marcador «Auto-Close») o se **Auto-void** (ni ingreso, ni impuesto, ni inventario) | `merchant.pos_day_close_policy`: **`manual`** (igual que Toast de fábrica) o **`auto_void`**. El interruptor vive en **Ajustes del panel** («Cierre del día y cuentas abiertas», junto a «Inicio del día operativo»), y también en el API (`PATCH /merchants/:id/settings`). Implementado y verificado contra el API y la base reales |
| Alcance temporal del autocierre                                    | «Auto-close does not close orders from previous days. It only closes unpaid checks from the current business day»                                                                                                           | El barrido anula **todas** las cuentas que quedaron atrás (`business_date <` día en curso), no solo las del último corte. Es más estricto que Toast y se explica abajo                                                                                                                                                                |
| **Unpaid Orders report**                                           | Reporte de checks con saldo pendiente en un rango de fechas                                                                                                                                                                 | La lista de cuentas: agrupada por día, con la antigüedad de cada una («hace 15 h») y el aviso con el conteo                                                                                                                                                                                                                           |
| Auto-void en un check de un día anterior                           | «Unpaid checks from earlier days must be resolved by payment or manually voided»                                                                                                                                            | Igual: con `auto_void` encendido el barrido las anula también; con `manual` quedan listadas y esperando a una persona                                                                                                                                                                                                                 |

## El hecho que lo provoca

El till mostró **cuentas abiertas de más de doce horas**. No era un dato raro de la
base: `openAccountIds` no filtra por antigüedad, así que una cuenta de anteayer sigue
apareciendo en la lista de hoy con la misma voz que las de la mesa 3. El problema no es
que esté en la base —una cuenta abierta es dinero apartado, no un registro huérfano—
sino que el sistema la trata como si fuera de hoy.

## Qué hace la competencia (verificado, con liga)

Tres familias, ninguna de las cuales deja la cuenta simplemente abierta:

| Familia                          | Quién                                                | Qué hace exactamente                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resolución forzada al cierre** | Toast (por defecto), Soft Restaurant, Parrot, SpotOn | El cierre del día o del turno no avanza hasta procesar las abiertas: «The End day button is unavailable until all open checks are resolved» ([Toast](https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture)); «No se puede cerrar el turno porque existen cuentas abiertas» ([Soft Restaurant](https://softrestaurant.zohodesk.com/portal/es/kb/articles/no-se-puede-cerrar-el-turno-porque-existen-cuentas-abiertas)); «el sistema no permite hacer cierre de día con órdenes abiertas» ([Parrot](https://soporte.parrotsoftware.com.mx/es_MX/configuracion-portal/configuracion-de-cajas)); «Review each open order, then either complete payment or void and close the order» ([SpotOn](https://spotonteam.atlassian.net/wiki/spaces/SK/pages/2664661350/Managing%2BOpen%2BOrders%2Bin%2Bthe%2BEnd%2Bof%2BDay%2BCloseout%2BProcess)). |
| **Autocierre/autovoid opcional** | Toast (configuración), PAR, Revel                    | «Unpaid checks automatically void at your business day cutoff time» ([Toast](https://support.toasttab.com/en/article/Enable-Auto-Close-or-Auto-Void-for-Check-Reconciliation)); PAR ofrece «Delete, Void, & Pay Abandoned Orders at EoD» ([PAR](https://product-docs.partech.com/docs/par-pos/user-guides/settings-editor/options/system)); Revel trae «Reconcile Open Orders» con Void / Close to Cash / Carry to Next Day ([Revel](https://postraining.info/wp-content/uploads/2023/07/End-of-Day-Procedures-BR.pdf)).                                                                                                                                                                                                                                                                                                                                       |
| **Arrastre con reporte visible** | Square, Clover, Lightspeed, Fudo                     | «If an open account is not closed before the end of a shift, it will carry over to the next day until the account is closed» ([Lightspeed](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4403197621531-Open-orders-report)); «Close any open tabs before manually closing the current batch» ([Clover](https://www.la.clover.com/en-GB/help/start-a-manual-batch-closeout)); Square liquida solo a las 36 h o «End of working day» ([Square](https://squareup.com/help/us/en/article/8164-reopen-a-check-with-square-for-restaurants)).                                                                                                                                                                                                                                                                                                          |

Dos hechos que acotan la decisión:

- **Nadie usa «N horas de antigüedad» como regla principal.** La referencia es el
  _corte del día de negocio_ (Toast: 4 a.m. por defecto, y su autocierre «does not
  close orders from previous days», solo el día en curso). La antigüedad en horas es
  la forma en que el operador lee el problema, no la forma en que el sistema lo decide.
- **El autocierre nunca inventa dinero.** Toast cierra con un tipo de pago
  «Auto-Close» y Revel exige elegir destino (efectivo, crédito, arrastre); ninguna
  variante borra la cuenta en silencio.

## Decisión

1. **La cuenta vive dentro de un día operativo, y quién decide el corte es el
   servidor.** El corte no es una constante del till: es
   `merchant.business_day_start` (**04:00** para este comercio) en la zona local del
   comercio, y ya está aplicado en
   `merchant.pos_cart.business_date`. La lista de cuentas compara la fecha de cada
   cuenta contra la fecha operativa que el servidor le dio al carrito en curso; solo
   cuando esa fecha no está disponible cae al 04:00 del reloj del dispositivo, que es
   una aproximación, no la autoridad. _(Implementado: agrupado bajo «De un día
   anterior», antigüedad —«hace 14 h»— y aviso con el conteo.)_
2. **Resolver es una acción de la persona, con dos salidas y ninguna tercera.**
   Cobrar o anular. La anulación ya existe con motivo y deja rastro
   (`pos_cart.status = abandoned`); no hace falta una operación nueva.
   2.bis **El comercio puede pedir que el corte no deje cuentas vivas.** Con
   `pos_day_close_policy = 'auto_void'`, la primera lectura de cuentas después del
   corte anula —solo— las cuentas **sin cobrar**, **sin guardar** y **de un día
   anterior**, les devuelve la mesa al piso (`dirty`, sin comensal) y lo deja escrito
   en la cuenta (`cancelled_at` + motivo). Con `manual` (lo de fábrica en Toast y aquí)
   no se toca nada: eso es exactamente lo que copia la opción apagada.
3. **El candado del corte del día va al final.** Cuando existan cuentas del día
   anterior sin resolver, el cierre diario no avanza: es la regla de Soft Restaurant y
   de Toast, y va después de la visibilidad porque un candado sin pantalla de salida
   deja al negocio sin poder cerrar y sin más recurso que pedir ayuda.

## Consecuencias

- **No hace falta esquema nuevo para el punto 1**: `merchant.tg_business_date` ya
  deriva `pos_cart.business_date` con el `business_day_start` del comercio, así que la
  fecha operativa de cada cuenta ya existe y es autoridad del servidor. El till la lee
  del carrito en curso; el 04:00 del dispositivo queda solo como respaldo cuando no hay
  carrito todavía.
- **Hallazgo de configuración (2026-10-12):** el comercio piloto tiene
  `business_day_start = '00:00'` en la base, mientras
  `2026-10-12-cierre-de-turno-de-caja-adr.md` decidió un corte de **04:00**. Son dos
  fuentes distintas para la misma frontera y hay que alinearlas: si el día del café
  empieza a las 04:00, el valor va en `merchant.business_day_start`, porque de ahí
  derivan _todas_ las fechas operativas (venta, cuenta, recibo, arqueo y reporte). El
  till no debe ser el que lo decida.
- **Nada se borra ni se oculta.** Una cuenta de ayer sigue en la lista, cobrable y
  anulable; lo que cambia es que ya no se disfraza de cuenta de hoy.
- **El conteo del cierre no se contamina**: mientras la cuenta viva, su dinero no
  entra al arqueo; al cobrarla, entra al turno en que se cobra, no al del día en que
  se abrió.
- **El barrido del corte corre en la lectura, no en un cron.** Toast lo corre en su
  servidor a la hora del corte; aquí corre la primera vez que alguien mira las cuentas
  después del corte —el momento en que el asunto importa— y por eso no necesita un
  registro de «ya corrí»: una cuenta anulada deja de estar abierta y no vuelve.
  Diferencia declarada: un barrido perezoso que solo tomara «el día que acaba de
  terminar» (literal de Toast) dejaría vivas las cuentas de días saltados en los que
  nadie abrió la pantalla; este barre todas las que quedaron atrás. Nunca es más
  permisivo que Toast: ninguna cuenta que Toast anularía sobrevive.
- **Las cuentas guardadas (`suspended`) quedan fuera del barrido**, y no por comodidad:
  el guardián del esquema (`merchant.pos_cart_lifecycle_guard`) solo permite salir de
  `suspended` hacia `recovered`, así que anularlas de un golpe es una transición que la
  base rechaza (comprobado: `invalid sale lifecycle transition`, y con ello se caía el
  barrido completo). Desguardar una cuenta es trabajo de quien la guardó, y su botón ya
  existe.
- **`auto_close` (cobrar el saldo a un tipo de pago marcador) no se implementa aquí**:
  necesita un tipo de pago de sistema y el camino de cobro completo, y un valor de
  configuración que el código no ejecuta es una mentira en la base. Queda como la
  siguiente mitad de la opción de Toast.
- **El `business_day_start` sigue siendo configuración por comercio**, no una
  constante; el 4 del till es la aproximación del cliente, no la autoridad.

## Lo que no se decide aquí

- Si el cierre diario bloquea o solo avisa (Toast permite apagar el autocierre; Square
  y Clover no bloquean el batch). Se decide al construir el candado, con el mismo
  criterio que el cierre de caja.
- La resolución en lote desde el centro de caja (cerrar cinco cuentas de ayer de una
  pasada) queda para cuando el corte del día tenga pantalla propia.

## Comprobado (2026-10-12)

Con el comercio en `auto_void` y llamando al API real (`open-accounts`) sobre la base
local:

| Caso                                   | Resultado                                                                                                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cuenta viva del día anterior, con mesa | `abandoned`/`cancelled`, motivo «Anulada por el cierre del día (auto-void)», y la mesa vuelve al piso (`dirty`, sin comensal)                                                                        |
| Cuenta guardada del día anterior       | Intacta (`suspended`) y **listada** como de un día anterior: la resuelve una persona                                                                                                                 |
| Cuentas del día en curso               | Intactas, con el comercio encendido                                                                                                                                                                  |
| Con `manual`                           | Ninguna escritura: solo lectura del valor de configuración                                                                                                                                           |
| El API caído o la anulación rechazada  | La lista de cuentas sigue contestando (el barrido no puede tumbar la lectura)                                                                                                                        |
| El interruptor (Ajustes del panel)     | `PATCH /merchants/:id/settings` con `posDayClosePolicy: auto_void` → `GET` lo devuelve encendido, y de vuelta a `manual`                                                                             |
| La zona del comercio                   | Con `America/Mazatlan` y corte 04:00, las 03:30 locales son del día anterior y las 05:00 del día nuevo; con la zona vieja (`America/Mexico_City`) las 03:30 de Culiacán ya caían en el día siguiente |

**Hora local, no del aparato.** El corte es 04:00 en la zona del **comercio**
(`America/Mazatlan`, Culiacán). El comercio estaba dado de alta en
`America/Mexico_City` —el valor por defecto con el que lo creó el onboarding— y la fila se
quedó ahí mientras su propia ficha revisada (`config/umipos-pilot-business-profile.json`)
ya decía `America/Mazatlan`. La corrección es la migración `025`, y no es cosmética: entre
las 04:00 y las 05:00 de la Ciudad de México las dos zonas caen en lados distintos del
corte, así que el día operativo se contaba mal esa hora.

El reloj del iMin está en `America/Hermosillo`, que hoy tiene **el mismo desfase** que
Culiacán (UTC−7 los dos, sin horario de verano desde 2022), así que la hora que muestra
el aparato es la del comercio. Si algún día se quiere que la etiqueta coincida —o si las
reglas de horario de verano cambiaran—, se pone `America/Mazatlan` en la configuración
del aparato; hoy no hay nada que corregir.

**Y por eso la zona la resuelve el servidor y no el aparato.** Se probó poner
`America/Mazatlan` en el iMin (Android 11) y el reloj se adelantó **una hora**: la base de
zonas del aparato es anterior a 2022 y todavía cree que Sinaloa tiene horario de verano,
así que resuelve Culiacán como MDT (UTC−6) en vez de UTC−7. `America/Hermosillo` no tiene
ese problema —Sonora nunca tuvo horario de verano— y por eso el aparato se quedó así, con
el desfase correcto y la etiqueta equivocada. Un cliente con la base de zonas vieja no
puede ser el que decide qué día es.
