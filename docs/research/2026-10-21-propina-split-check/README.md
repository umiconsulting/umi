# Propinas cuando se divide una cuenta

- Fecha: 2026-10-21
- Pregunta: ¿Cómo calcula y asigna la competencia la propina cuando una cuenta se divide entre varios pagos?
- Informa esta decisión: definir si Umi calcula la propina por tramo y cómo la atribuye al empleado.
- Competidores: seis. Square, Toast, Lightspeed, Clover, Fudo México y Parrot.
- Ventana de evidencia: documentación pública consultada el 2026-10-21.
- Etiquetas: **HD** = hecho documentado; **IV** = testimonio independiente; **HL** = evidencia local; **IN** = inferencia; **NV** = sin verificar.

## Resultado

**IN:** la práctica dominante es una propina por invitado o por cobro, no una sola
propina calculada al final sobre toda la cuenta. Toast, Lightspeed, Fudo y Parrot
permiten que cada pago de una cuenta dividida agregue su propia propina. Square
permite liquidar una propina por cada pago. Clover no documenta esa combinación.

**HL:** Umi ya tiene el modelo financiero correcto. Guarda `tipAmount` en cada
`TenderDraft`, lo suma al total de propinas del libro y descuenta sólo el consumo
del saldo pendiente. La diferencia está en la interfaz y en la atribución al
empleado.

**IN:** Umi debe conservar propina por tramo. Debe agregar sugerencias calculadas
sobre el consumo de ese invitado y separar “quién cobró” de “quién recibe la
propina”.

## Lo que hace Umi hoy

**HL:** el flujo se llama `Cobro dividido` o `Split payment`. Muestra estas cifras:

- Total de la cuenta.
- Pagado.
- Consumo de esta persona.
- Propina de este pago.
- Cobrar ahora.
- Falta.

La captura está en
[`umi-split-payment.png`](assets/umi-split-payment.png).

**HL:** el cliente calcula `cargo = consumo + propina`. El servidor calcula
`abono al consumo = monto entregado − propina`. Después suma las propinas de
todos los tramos confirmados:

- [`partial_checkout_surface.dart`](../../../apps/umi-pos/lib/features/checkout/partial_checkout_surface.dart#L101)
- [`pos-checkout.service.ts`](../../../apps/umi-api/src/modules/pos-checkout/pos-checkout.service.ts#L67)
- [`pos-checkout.ts`](../../../packages/contract/src/pos-checkout.ts#L67)
- [`checkout-partial-payments.spec.ts`](../../../apps/umi-api/src/modules/pos-checkout/checkout-partial-payments.spec.ts#L234)

**HL:** la propina se escribe manualmente en el cobro dividido:

- [`partial_checkout_surface.dart`](../../../apps/umi-pos/lib/features/checkout/partial_checkout_surface.dart#L906)

**HL:** Umi no muestra botones de porcentaje en ese flujo. La calculadora general
sí calcula una propina porcentual sobre el subtotal después de descuentos y antes
de impuestos:

- [`checkout-calculator.ts`](../../../apps/umi-api/src/modules/pos-checkout/checkout-calculator.ts#L118)

**HL:** el contrato guarda el monto y el medio del tramo. No guarda el empleado
que recibe la propina ni una distribución de propinas. Por eso Umi hoy registra
la propina, pero no resuelve el reparto entre empleados.

## Matriz competitiva

| Etapa                     | Square                                                                                                  | Toast                                                                                         | Lightspeed                                                                                        | Clover                                                                                                     | Fudo MX                                                                                    | Parrot                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Forma de dividir          | Cuenta por ítem, asiento o pago por monto. **HD**                                                       | Cuenta por ítem, asiento, partes iguales o pagos sucesivos. **HD**                            | Cuenta por asiento, cubierto o pago parcial. **HD**                                               | Pago parcial por ítems. **HD**                                                                             | Monto, persona o ítems. **HD**                                                             | Partes iguales o artículos. **HD**                                          |
| Momento de la propina     | Cada pago puede liquidarse con su propina. **HD**                                                       | Cada invitado agrega propina en su pago individual. **HD**                                    | Cada invitado elige propina en su pago dividido. **HD**                                           | La entrada es en pantalla o recibo. La asociación exacta con cada tramo no está documentada. **NV**        | Cada cobro parcial admite propina. **HD**                                                  | Cada persona agrega propina antes de su pago. **HD**                        |
| Base sugerida             | Antes o después de impuestos. El tratamiento de descuentos no está documentado en esa página. **HD/NV** | La propina se captura en la pantalla de cada pago. La base exacta no está documentada. **NV** | Antes o después de impuestos, y antes o después de descuentos. **HD**                             | No se documenta una base porcentual. **NV**                                                                | Sugerencia sobre el total, editable; la base fiscal no está documentada. **HD/NV**         | Porcentaje o monto. La base no está documentada. **HD/NV**                  |
| Propina en efectivo       | Se declara o se liquida con el pago. **HD**                                                             | Se declara durante el cierre del turno. **HD**                                                | El efectivo sobrante puede tratarse como propina si el cambio automático está desactivado. **HD** | El dispositivo no solicita propina para efectivo. **HD**                                                   | Puede registrarse como propina y separarse por medio de pago. **HD**                       | Existe un flujo para convertir el cambio en propina. **HD**                 |
| ¿Quién recibe la propina? | El miembro que procesó el pago, salvo pooling. **HD**                                                   | El dueño de la cuenta, salvo transferencia de cuenta. **HD**                                  | Quien procesó el pago o el empleado asignado a la mesa, según configuración. **HD**               | No está documentado para split. Hay testimonios de atribuciones inesperadas en cuentas abiertas. **NV/IV** | Se filtra por camarero, cliente y medio de pago. El reparto no está documentado. **HD/NV** | Se paga desde un reporte por mesero. El pool no está documentado. **HD/NV** |
| Ajuste posterior          | Propina por pagos pendientes de liquidar; después se usa el flujo de ajuste. **HD**                     | Se ajusta el mismo día o hasta 45 días, con límites. **HD**                                   | Mismo día, antes de la captura del lote. **HD**                                                   | Puede ajustarse sólo si se eligió propina en recibo y antes del lote. **HD**                               | Se puede editar la propina al cerrar la venta. **HD**                                      | Se consulta y paga antes del corte. **HD**                                  |

## Detalle por competidor

### Square

**HD:** Square separa “dividir la cuenta” de “dividir el pago”. Al dividir una
cuenta puede mover ítems o asientos a nuevas cuentas. Al dividir un pago, sólo
reparte importes de una cuenta.

Fuente: [Split a check by item or seat](https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants).

**HD:** cada pago de tarjeta puede tener su propia propina cuando se liquida.
Square atribuye la propina al miembro que procesó el pago. También permite
liquidar pagos individuales o en grupo.

Fuente: [Settle payments and manage tips](https://squareup.com/help/us/en/article/8375-settle-payments-and-manage-tips).

**HD:** la propina porcentual puede calcularse antes o después de impuestos.
Square no documenta en esa página si usa el total antes o después de descuentos.

Fuente: [Set up and customize tipping](https://squareup.com/help/us/en/article/8631-set-up-and-customize-tipping).

**HD:** el pool puede dividir cada propina en partes iguales, por horas o por
porcentajes. La atribución inicial sigue siendo por empleado o pago.

Fuente: [Set up tip pooling](https://squareup.com/help/us/en/article/7654-get-started-with-tip-pooling-for-team-management).

### Toast

**HD:** cuando Toast divide una cuenta, cada invitado tiene su propio proceso de
pago y puede agregar propina. En una división aplicada a más de nueve personas,
Toast lo documenta de forma explícita.

**HD:** si la cuenta tiene un cargo por servicio, se divide entre el número de
invitados. Si se divide por ítems antes de enviar la orden, los descuentos por
ítem no pasan automáticamente a las nuevas cuentas.

Fuente: [Split Checks on the POS](https://support.toasttab.com/en/article/Splitting-Checks-by-Item-1492811097734).

**HD:** la propina pertenece al empleado que abrió la cuenta, aunque otro empleado
procese el pago. Cambia de dueño sólo cuando la cuenta se transfiere a otro
empleado que está en turno.

Fuente: [Tip retrieval when multiple employees manage one check](https://support.toasttab.com/en/article/Multiple-Employees-Managing-One-Check-Tip-Retrieval-1492800294511).

**HD:** Toast permite ajustar propinas. Para pagos del mismo día se reabre la
cuenta. Para días anteriores se usa Toast Web. Una reducción de más de un día se
procesa como reembolso parcial.

Fuente: [Adjust tips on a closed check](https://support.toasttab.com/en/article/Adjust-Tips-on-a-Closed-Check2).

**HD:** el pool básico calcula una recomendación por horas trabajadas, pero no
mueve dinero automáticamente. Toast ofrece además una administración más
completa con Tips Manager.

Fuente: [Pool tips and tipping out](https://support.toasttab.com/en/article/Pooling-Tips-and-Tipping-Out).

**IV:** un operador reporta que una propina sugerida usó el total antes del
descuento después de una cortesía de cocina:
[reporte independiente](https://www.reddit.com/r/ToastPOS/comments/1u2juo3/toast_calculating_tips_on_prediscount_totals_for/).
No se pudo verificar que todas las versiones actuales se comporten igual.

### Lightspeed Restaurant K-Series

**HD:** en Pay at Table, cada invitado paga su parte y elige una propina antes de
confirmar. El cobro continúa con `Pay next` hasta que la cuenta queda pagada.

Fuente: [Pay at Table 2.0](https://k-series-support.lightspeedhq.com/hc/en-us/articles/53445038141083-Using-Pay-at-Table-2-0-with-Lightspeed-Payments).

**HD:** si la mesa tiene un mesero asignado, la propina va a ese mesero. Si no,
normalmente va al empleado que procesa el pago.

**HD:** las propinas sugeridas pueden calcularse antes o después de impuestos y
antes o después de descuentos. También pueden ser porcentajes o importes fijos.

Fuente: [Handling tips and gratuities](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4415116773403-Handling-tips-and-gratuities).

**HD:** en efectivo, si `Calculate change` está apagado, la diferencia entre lo
recibido y el total se convierte automáticamente en propina.

**IN:** Umi debe mantener “cambio” y “propina” separados por defecto. La diferencia
no debe convertirse en propina sin una acción explícita.

### Clover

**HD:** Clover permite pagar por ítems seleccionados y después tocar `Next
Payment` o `Pay More Later`. No documenta la propina en ese mismo artículo.

Fuente: [Split by items](https://www.clover.com/en-US/help/split-by-items).

**HD:** el comercio elige si la propina se captura en la pantalla o en el recibo.
Si el cliente paga en efectivo, el dispositivo no solicita propina.

Fuente: [Choose where customers enter a tip](https://www.clover.com/en-US/help/choose-where-customers-enter-tip).

**HD:** la app Tips permite agregar o ajustar propinas a transacciones pagadas.
La propina del recibo sólo puede agregarse antes del lote.

Fuente: [Add tips to a paid transaction](https://www.clover.com/en-US/help/add-tips-to-a-transaction).

**NV:** la documentación pública no muestra si cada pago parcial por ítems pide
una propina separada o si la propina se captura una vez al final.

**IV:** existe un testimonio independiente de propinas atribuidas al empleado que
abrió una cuenta preautorizada en vez del empleado que cerró el cobro:
[reporte independiente](https://www.reddit.com/r/CloverPOS/comments/1ba9y68/pre_auth_confuses_tips_from_open_orders_at_shift/).
Es una señal de riesgo, no una prueba del comportamiento actual.

**HD:** el pool de propinas no aparece como función nativa en las páginas del
producto revisadas. Clover publica una guía que lo relaciona con Homebase.

Fuente: [Clover guide to tip pooling and tip splitting](https://blog.clover.com/tip-pooling-tip-splitting-guide-for-restaurant-owners).

### Fudo México

**HD:** cada cobro parcial de Fudo admite una propina. La cuenta sigue abierta
hasta que el saldo llega a cero. Se pueden combinar monto, persona e ítems.

Fuente: [Cómo dividir la cuenta en la Terminal de Fudo MX](https://soporte.fu.do/es/articles/14627530-terminal-de-fudo-mx-como-dividir-la-cuenta).

**HD:** Fudo puede tener varias propinas asociadas a una venta, con montos y
medios de pago distintos. Esto cubre a invitados que pagan sus propinas por
separado.

**HD:** la propina sugerida se calcula sobre el total de la venta y se puede
editar. El listado se puede filtrar por camarero, cliente y medio de pago.

Fuente: [Propinas en Fudo](https://soporte.fu.do/es/articles/11730866-4-que-son-y-como-funcionan-las-propinas).

**NV:** Fudo no documenta un pool automático por horas o porcentajes en esos
artículos. Registrar varias propinas no prueba que las distribuya entre
empleados.

### Parrot

**HD:** después de dividir por igual o por artículo, Parrot procesa a cada
persona por separado. Cada persona puede agregar una propina antes de pagar.

Fuentes:

- [Dividir una cuenta en partes iguales](https://soporte.parrotsoftware.com.mx/pagos-pay/como-dividir-una-cuenta-en-partes-iguales)
- [Dividir una cuenta por artículos](https://soporte.parrotsoftware.com.mx/pagos-pay/como-dividir-una-cuenta-por-articulos)

**HD:** el efectivo puede registrar el excedente como propina. El sistema
permite convertir el cambio en propina o registrar primero la propina.

Fuente: [Propina en efectivo](https://soporte.parrotsoftware.com.mx/pagos-pos/propina-en-efectivo).

**HD:** el reporte de propina se genera por mesero antes del corte. El personal
usa ese reporte para pagar las propinas acumuladas.

Fuente: [Reporte de propina](https://soporte.parrotsoftware.com.mx/cajas-pos/reporte-de-propina).

**NV:** Parrot no documenta cómo separa los pagos de tarjeta y efectivo dentro
del pool, ni reglas automáticas por horas o porcentaje.

## Patrones y conflictos

**HD:** cuatro competidores muestran propina por cobro o por invitado. No se
encontró una propina única calculada al final como patrón principal.

**HD:** Square atribuye la propina al empleado que procesa el pago. Toast la
atribuye al dueño de la cuenta. Lightspeed usa el mesero asignado a la mesa
cuando existe. No hay una regla universal de atribución.

**HD:** Square y Lightspeed permiten configurar la base fiscal. Lightspeed
permite configurar además si los descuentos entran en la base. Toast calcula el
tip-out por ventas netas.

**IN:** Umi no debe asumir que “quien cobra” es siempre “quien sirvió”. Debe
guardar ambos actores.

## Recomendación

### Modelo principal

1. **HL/IN:** mantener una propina por cada cobro parcial.
2. **IN:** mostrar sugerencias del `0 %`, los porcentajes de la política y un
   importe manual sobre el consumo de ese invitado.
3. **IN:** usar por defecto el consumo después de descuentos y antes de
   impuestos. Mostrar esa base bajo las sugerencias.
4. **IN:** mantener la fórmula `consumo + propina = cobro`. La propina no reduce
   el saldo de consumo.
5. **IN:** mostrar el total acumulado de propinas y el detalle de cada pago.
6. **IN:** impedir propina negativa y validar el máximo de la política en el
   servidor.
7. **IN:** guardar una atribución por propina: empleado que sirvió la cuenta y
   empleado que procesó el pago. La política selecciona la atribución.
8. **IN:** usar como valor predeterminado al mesero o dueño de la cuenta. Toast
   y Lightspeed demuestran este modelo cuando el cobro y el servicio los hacen
   personas distintas.
9. **IN:** dejar el pool como una segunda fase. No debe alterar las propinas
   originales; debe producir una distribución auditable.

### Alternativa finalista

**IN:** una sola propina al cerrar toda la cuenta y luego repartirla
proporcionalmente entre los pagos. Tiene menos capturas por invitado.

**IN:** se rechaza como modelo principal. Impide que quien paga primero elija e
impulse su propina, retrasa el ingreso y complica un pago perdido o reembolsado.
Puede existir como opción cuando un invitado paga toda la propina de la mesa.

## Escenarios de aceptación

1. Tres invitados pagan MXN 100 cada uno y eligen 10 %. El total de propinas es
   MXN 30.
2. El primer invitado elige sin propina; el segundo deja MXN 20. El saldo de
   consumo continúa separado del total de propinas.
3. Un descuento de MXN 10 deja un consumo de MXN 90. El 10 % sugerido es
   MXN 9.00.
4. El invitado cambia de porcentaje a importe fijo. El botón de cobro muestra
   el importe exacto antes de procesar.
5. El terminal devuelve `outcome_unknown`. Umi no suma la propina hasta
   confirmar el cobro.
6. La cuenta se paga con varios medios. El historial muestra la propina dentro
   de cada pago y una suma total.
7. El mesero de la mesa recibe la propina aunque el cajero procese el pago.
8. Una prueba de reembolso reduce el consumo y la propina según la política del
   cobro original, sin retirar propinas de otro tramo.

## Qué no cambió desde investigaciones previas

Se revisaron:

- [`2026-10-14-cobro-dividido-pos-mexico`](../2026-10-14-cobro-dividido-pos-mexico/README.md)
- [`2026-10-18-customer-review-cascade`](../2026-10-18-customer-review-cascade/issues/03-split-check-and-early-departure.md)
- [`2026-10-18-account-split-slice`](../../reports/2026-10-18-account-split-slice.md)

**HL:** sigue vigente una sola cuenta con partes confirmadas. Sigue vigente que
el split financiero no envía otra comanda. Sigue vigente que un resultado
incierto bloquea el siguiente cobro. **HL:** Umi ya conserva propina por tramo.

La investigación anterior no definía el momento de la propina ni la atribución
al empleado. Esta pasada agrega esos dos puntos.

## Evidencia independiente y límites

- **IV:** la investigación previa de reseñas reunió más de 20 observaciones
  independientes sobre split checks. Dos se relacionan directamente con
  propinas: la base pre-descuento de Toast y la atribución de Clover.
- **NV:** no se probaron cuentas reales en los seis productos.
- **NV:** Clover no documenta la propina exacta por pago parcial.
- **NV:** Fudo, Parrot y Clover no documentan un pool nativo completo.
- **NV:** no se evaluaron obligaciones fiscales o laborales de propinas en
  México. Esa decisión necesita una revisión separada.
- **NV:** no se usaron capturas de la app privada que requieren una cuenta.

## Herramientas

- Chromium 153.0.8010.52 con Playwright y `DISPLAY=:0` para buscar y capturar.
- `curl` 8.22.0 y `r.jina.ai` para textos de centros de ayuda con JavaScript.
- `rg` 15.2.0 para leer el código y las investigaciones locales.
- Node.js 24.21.0 para ejecutar `capture.mjs`.

## Rutas fallidas

| Host                   | Ruta                                                                         | Resultado                                                | Alternativa                                   |
| ---------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| `www.clover.com`       | `split-by-items` mediante `r.jina.ai`                                        | Devolvió sólo el contenedor de la aplicación.            | Chromium renderizó la página con HTTP 200.    |
| `support.toasttab.com` | Una lectura inicial de atribución de propina devolvió el diálogo de cookies. | Se repitió y devolvió el artículo completo con HTTP 200. | Chromium también mostró la página.            |
| `soporte.fu.do`        | Tres lecturas paralelas agotaron el primer intervalo de 30 s.                | Las lecturas terminaron en una espera posterior.         | No se usó una captura hasta recibir el texto. |

Los centros de ayuda no publicaron un changelog específico de estas mismas
páginas. La evidencia es la documentación vigente visible en la fecha indicada.

## Archivos

- [`assets/INDEX.md`](assets/INDEX.md): origen, clase, fecha y hash de cada
  captura.
- [`capture.mjs`](capture.mjs): reproduce las capturas.
