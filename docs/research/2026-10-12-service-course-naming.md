# The name of a service course in competing POS systems

- **Date:** 2026-10-12
- **Question:** What do competing restaurant systems call the group of dishes that go out together
  (a "course"), what word do they show the operator, and what do they call the action that starts a
  later course? We need the answer for English and for Spanish in Mexico.
- **Why it matters:** one label on the till causes this research. The cart-line editor shows
  **"Tiempo de servicio"** (English: "Course"). The owner read the label and asked what it means.
  A second person can read it as a duration. The label must be the word that an operator of a
  Mexican café already knows.
- **Scope:** Toast, Square (Restaurants and KDS), Lightspeed Restaurant (K-Series and L-Series),
  Clover, Shopify POS, Revel, TouchBistro, and Spanish-speaking systems for Mexico and Latin
  America.
- **Method and source labels:**
  - `PRIMARY` — vendor help center or product update.
  - `PRIMARY-SPEC` — vendor developer documentation.
  - `USER-PRIMARY` — the words that a Mexican product uses in its own Spanish interface.
  - `INFERENCE` — my synthesis across sources.

---

## Summary

- The three large vendors use **"course"** in English and show **courses** to the operator.
  `PRIMARY`
- Two of them show the **verbs** on the kitchen screen. Toast prints **FIRE** and **HOLD**.
  Square uses a **fire icon** and a **hold icon**. `PRIMARY`
- The Spanish word for the same object in Mexico is **"tiempo"**. Provecho writes
  **"el segundo tiempo"**. Hiopos México writes **"tiempos"**. `USER-PRIMARY`
- The word **"tiempo"** also means _duration_ in Spanish POS documentation. Punto (Latin America)
  uses "tiempo de proceso" for a duration. `USER-PRIMARY` `INFERENCE`
- **Decision:** keep **"Tiempo de servicio"** in Spanish, and keep **"Course"** in English. Add one
  help line under the label. The line removes the reading of a duration. This change is already in
  the code: "1 se sirve con todo · 2 se prepara después".

---

## Comparison

| System                           | Name of the object             | What the operator sees                    | Word for a later course                                                                | Source                                                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toast                            | course                         | courses on the POS order screen, per item | Fire and Hold. The KDS ticket shows FIRE for the first course and HOLD for the others. | [Course Firing Options](https://support.toasttab.com/en/article/Course-Firing-Options), [Automated and Expediter Course Firing](https://support.toasttab.com/en/article/Automated-and-Expediter-Course-Firing)                                                    |
| Square                           | coursing, course               | "Coursing" on the POS app, per item       | Fire icon and hold icon on the course. A held course goes from the POS.                | [Coursing with Square KDS](https://squareup.com/help/us/en/article/7748-coursing-with-square-kds)                                                                                                                                                                 |
| Lightspeed Restaurant (K-Series) | course                         | courses on the order, per item            | **"Fire course"** button. The KDS shows the courses as separate tickets.               | [Editing and reviewing orders](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050328554-Editing-and-reviewing-orders), [KDS 2.0](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0) |
| Lightspeed Restaurant (L-Series) | course                         | course in the restaurant app              | "Firing a course". The app asks to fire skipped courses.                               | [Firing a course](https://resto-support.lightspeedhq.com/hc/en-us/articles/360020992054-Firing-a-course)                                                                                                                                                          |
| Provecho (Mexico)                | tiempo                         | "Tiempos" for the meal stages             | "el segundo tiempo sale cuando se limpia la línea, no antes"                           | [Provecho](https://www.provechoapp.com/mx)                                                                                                                                                                                                                        |
| Hiopos México                    | tiempo                         | "tiempos" on the kitchen screen           | The screen "avisa exactamente cuándo servir"                                           | [HioScreen](https://hiopos.mx/soluciones/hioscreen)                                                                                                                                                                                                               |
| Punto (Latin America)            | tiempo de proceso (a duration) | "tiempo de proceso" per item              | not a course. The word means a duration here.                                          | [Órdenes, comandas y cocina](https://docs.punto.la/ordenes-comandas-y-cocina)                                                                                                                                                                                     |

## Per-system detail

### Toast

Toast configures the courses in Toast Web. The support article "Manage Course Firing Options"
describes the setup. Toast calls the setting "course firing". A "drinks" course is necessary for
the next courses to fire. Without it, the KDS shows **Hold** for the starters. `PRIMARY`

Toast fires the courses in three ways: manually, by the expediter, or automatically. The article
"Automated and Expediter Course Firing" describes the three options. An item that is marked "hold"
on the POS does not fire. `PRIMARY`

The kitchen ticket carries the verbs. When the first course fires, the first course prints with the
label **FIRE** and the other courses print with the label **HOLD**. Toast Web can change the words
in Kitchen > Printers, tickets, and KDS devices. `PRIMARY` —
[Toast product updates](https://updates.toasttab.com/announcements/kitchen-tickets-now-print-for-subsequent-courses-when-using-course-pacing-and-item-routing-rules)

Toast also lets the kitchen start a course. The KDS can fire one item, or the whole course.
`PRIMARY-SPEC` — [KDS overview](https://dev.toasttab.com/doc/platformguide/platformKDSOverview.html)

### Square

Square calls the feature **"coursing"**. The help article gives the purpose: group the items, and
"let the kitchen know when to hold or start firing dishes". `PRIMARY`

The operator works the courses in the Square Restaurants POS app. The operator taps a **fire icon**
or a **hold icon** on the course. A held course goes to the kitchen from the POS, but the Square KDS
shows the ticket only at the fire time. `PRIMARY`

### Lightspeed Restaurant

The K-Series has a **"Fire course"** button. The help article says: tap "Fire course" to send the
next course, so the prep station knows that the guests are ready. `PRIMARY`

The KDS receives one ticket for each course. The POS user taps "Fire course" for the second course.
`PRIMARY`

A configuration setting shows or hides the button: "Show 'Fire course' on register screen".
`PRIMARY` —
[POS configurations](https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804606610-Managing-and-understanding-POS-configurations)

The L-Series article "Firing a course" adds one rule: when the server skips a course, the app asks
if the server wants to fire the skipped courses too. `PRIMARY`

### Mexican and Latin American systems

**Provecho** shows the word in its own Spanish text: "Tiempos: el segundo tiempo sale cuando se
limpia la línea, no antes". The product uses **"tiempo"** for the course, and "segundo tiempo" for
the second course. `USER-PRIMARY`

**Hiopos México** describes its kitchen screen: it organizes the orders "por estaciones y tiempos",
and it says when to serve. The product uses **"tiempos"** for the courses. `USER-PRIMARY`

**Punto** uses the same word for a different object. Its "tiempo de proceso" is a duration: the time
that the slowest item needs. This use is the trap for our label. `USER-PRIMARY` `INFERENCE`

La Comanda, ALTYRA, WinCaja, and Nerion POS publish kitchen features, but their public pages do not
name the course object.

## What is consistent

- One word for the object: **course** in English, **tiempo** in Spanish.
- The object belongs to the **item**, not to the order.
- One verb starts a later course: **fire**. The opposite state is **hold**.
- The kitchen screen shows the state. The operator does not calculate a time.

## Where the vendors disagree

- Toast and Square use the words **fire** and **hold** as labels. Lightspeed uses the longer
  "Fire course".
- Toast configures the words in the back office. Square uses icons.
- Square, Lightspeed, and Toast group the KDS ticket by course. A community question from 2021 says
  that the Square KDS does not group by course or seat. This report cannot verify the current
  behavior of the Square KDS from a primary source.

## Recommendation

1. **Keep "Tiempo de servicio" in Spanish.** The market in Mexico uses "tiempo" for this object.
   A rename to "Curso" or "Ronda" moves the product away from the operator's word. `USER-PRIMARY`
   `INFERENCE`
2. **Keep "Course" in English.** All three large vendors use this word. `PRIMARY`
3. **Add one help line under the label.** The word "tiempo" also means a duration. The line
   "1 se sirve con todo · 2 se prepara después" states the meaning and stops the reading of a
   duration. `INFERENCE`
4. **Keep the value as a number.** The value is an ordinal, not a clock. The screen reader already
   says "Tiempo 2". `INFERENCE`
5. **Keep the words "fire" and "hold" on the kitchen screen.** Toast and Square use them, and our
   KDS already fires one course at a time. `PRIMARY`

The code contains items 1, 3, and 4. See `apps/umi-pos/lib/features/cart/course_control.dart` and
the key `cartCourseHint` in `apps/umi-pos/lib/core/localization/app_es.arb`.

## What I could not verify

- **Clover, Shopify POS, Revel, and TouchBistro.** I did not find a primary source that names the
  course object for these products. Shopify POS and Revel use **seats** in some flows. A seat is a
  different object: it names a person, not a stage of the meal. I did not find a primary source for
  a course feature in these four products.
- **A Spanish label from a large vendor.** Toast, Square, and Lightspeed publish their help in
  English. I did not find their Spanish interface text for this control.
- **The current Square KDS group behavior.** The primary help article does not state if the KDS
  groups the tickets by course. One community answer from 2021 says that it does not.
