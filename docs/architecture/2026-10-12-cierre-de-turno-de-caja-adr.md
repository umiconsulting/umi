# ADR: el turno de caja se cierra solo al corte del día, y se nota

- Fecha: 2026-10-12
- Estado: **Aceptado**. El aviso de arrastre está implementado y verificado en el
  iMin D3-504; el autocierre y el candado del cierre diario quedan por construir.
- Relación: continúa `2026-10-12-folio-visible-del-recibo-adr.md` (el recibo es un
  documento con número propio) y resuelve la pregunta abierta de cómo se cierra la
  caja, que hasta hoy era «cuando alguien se acuerde».

## El hecho que lo provoca

El till del café tenía un turno abierto de **más de cien horas**. La pantalla lo decía
—«Abierto hace 114 h 25 min»— en la misma tinta que el resto: un número así de grande
se lee como un dato, no como el problema que es. Y el problema es de dinero: mientras
ese turno viva, el efectivo de hoy entra al cajón de anteayer, y el corte del día no se
puede cuadrar contra nada.

## Decisión

1. **El aviso de arrastre es lo primero, y no bloquea nada.** Al abrir el centro de
   caja, si el turno abierto pertenece a un día operativo anterior, la pantalla lo dice
   en voz alta y ofrece cerrarlo. Es la regla barata: no cambia semántica de dinero y
   hace visible lo que hoy es invisible. _(Implementado.)_
2. **El día operativo empieza a las 04:00, y el turno que llega vivo al corte se
   cierra solo, marcado.** Es el mismo corte que ya usa la contabilidad; dos reglas
   distintas para «el día» es cómo se producen los descuadres. El cierre automático
   **no inventa dinero**: congela el efectivo esperado, deja el conteo pendiente y se
   marca con su razón (`carried_over`), para que la diferencia se registre cuando
   alguien cuente — no cuando el reloj decida.
3. **El candado del cierre diario va al final.** Mientras exista un turno de un día
   anterior sin cerrar, no se permite el cierre del día en curso. Es el candado con
   dientes, y por eso va cuando el sistema ya sabe salir del atolladero solo: puesto
   antes, el primer turno huérfano dejaría al negocio sin poder cerrar su día y sin más
   salida que pedir ayuda.

El orden de los puntos **es** la decisión: cada uno protege al siguiente.

## Base de la decisión

| Frente                               | Hallazgo                                                                                                                   | Fuente                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Autocierre por reloj de negocio      | «Auto Close Shift is a store-level setting that forces an end-of-day»                                                      | [NCR Aloha Cloud](https://www.docs.ncr.com/restaurant/aloha-cloud/using/understanding_business_dates)                                |
| Tope de duración con cierre marcado  | «A shift left open too long is closed automatically (there's a 24-hour cap…)»; los cierres forzados quedan **etiquetados** | [POSolid](https://posolid.com/help/work-shifts), [Kuku](https://partner.kukuexpress.com/help/point-of-sale-pos/shift-reconciliation) |
| Aviso sin bloqueo                    | Fudo avisa cuando no hay arqueo abierto y no impide vender                                                                 | [Fudo](https://soporte.fu.do/es/articles/11730855-como-inicio-un-nuevo-turno-de-trabajo)                                             |
| Candado del cierre diario            | «Si hay una computadora con un turno abierto, el sistema no permitirá el cierre diario»                                    | [Soft Restaurant 11](https://www.techblog.mx/blog/2026-01-13-softrestaurant11-cierre-diario)                                         |
| Arrastre visible                     | «If a colleague forgot to close a shift the day before, you'll see it as an Open shift in the cash drawer»                 | [ChannelDock](https://website.channeldock.com/help/en/pos/shifts-cash/opening-and-closing-a-pos-shift/)                              |
| El corte ya existe en nuestro modelo | La fecha operativa del libro es la del cajón, decidida al cobrar                                                           | `docs/architecture` — el turno ya lleva `business_date`                                                                              |

## Consecuencias

- **Una columna nueva** en `merchant.cash_shift` para la razón del cierre
  (`closed_reason`: `operator`, `carried_over`, `administrative`), más el sello de
  tiempo que ya existe (`closed_at`). Una migración, sin reescribir turnos viejos.
- **El conteo ciego se conserva**: un turno autocerrado no gana un conteo que nadie
  hizo. La diferencia sigue apareciendo cuando el operador cuente, y ese conteo
  pertenece al turno cerrado, no al nuevo.
- **Los turnos de más de cien horas no vuelven a existir**: con el corte de las 04:00,
  ese mismo turno se habría vuelto varios turnos cerrados, uno por día, cada uno con su
  esperado congelado.
- **Los turnos que hoy se van a limpiar** se cierran, no se borran: cerrarlos conserva
  a qué cajón pertenece cada venta de esos días. Borrarlos deja ventas sin cajón, que
  en un arqueo es un faltante sin explicación.

## Lo que no se decide aquí

- La hora del corte es 04:00 y ya vive donde debe: `merchant.business_day_start`
  (**aplicado el 2026-10-12** a los dos comercios, con la zona del comercio —
  `America/Mazatlan`, porque el café está en Culiacán, migración `025`— así que
  son las 04:00 locales y no las del aparato). Cambiarla es cambiar esa columna, no el
  código del till.
- El candado puede necesitar una excepción con aprobación de encargado (Toast la pide
  para diferencias arriba del umbral). Se deja para cuando el candado exista.
