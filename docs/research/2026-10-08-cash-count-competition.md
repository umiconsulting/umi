# The drawer count: how the competition does it

Date: 2026-10-08. Scope: does a competitor show the expected drawer amount at the count, or
hide it? Who configures that choice, what gets hidden, and who approves a variance?
The incumbent at the site, **Parrot**, is included.

Labels: **documented fact**, **source-backed tradeoff**, **inference**, **UNVERIFIED**.

## Method

| Question                              | Answer                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| Does a proven tool do this?           | First-party vendor help centres own this answer. No new tool is necessary.               |
| Is it installed here?                 | `curl` 8.22.0, `python3` 3.14.7, `rg` 15.2.0.                                            |
| Can an agent drive it with no prompt? | Yes. Every read is a `curl`.                                                             |
| What is the fallback?                 | The Jina reader proxy, `https://r.jina.ai/<url>`, for pages that render with JavaScript. |

Ladder rungs: **rung 1** (vendor documentation), **rung 5** (community pages, for the search
only).

Channels that failed: `bing.com/search?format=rss` returned navigational results only;
`mojeek.com` returned no results; direct `duckduckgo.com/html` returned an anomaly page.
The channel that worked: the Jina reader proxy in front of a DuckDuckGo result page, and the
same proxy in front of each vendor article.

## 1. The question

Umi hides the drawer total before a count while the same screen shows the six terms of the
account. This document asks what the competition does with the same problem.

## 2. Parrot, the incumbent at this site

**documented fact — Parrot ships both modes.** Parrot's support centre holds one article per
mode, and both steps are the same until the numbers appear.

| Article                                    | What it says                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Corte de caja" (updated 2025-05-27)       | "Con este proceso puedes cerrar una caja de turno y verificar que el dinero recibido cuadra con lo esperado." Step 4 reads: "Asegúrate de que la cantidad ingresada coincida con lo que se esperaba."                                                                                                                                |
| "Corte de caja ciego" (updated 2025-05-27) | "Te permite cerrar caja sin ver los montos esperados, ideal para fomentar transparencia en tu equipo." When: "Si quieres que tus colaboradores registren los montos sin saber cuánto 'deberían' tener, por ejemplo, al cambiar de turno." Step 4 reads: "Recuerda: no verás los montos esperados, así que deben contar con cuidado." |

**documented fact — Parrot declares per payment method.** Both articles ask for "los montos
recibidos en cada forma de pago" — cash, card, transfer, and the rest. The blind mode hides
the expected amount of each one.

**documented fact — Parrot's own definitions.** "Configuraciones de caja" defines the terms:
a **corte de caja** is the operation where the cashier compares the money in the drawer
"contra el monto que debería tener de acuerdo con el registro de ventas desde el momento de
apertura de la caja"; the **monto declarado** is what the cashier counts; the **Reporte X**
prints at every cut, and the **Reporte Z** prints at the day close.

**inference** Parrot, which is the system this till came with, treats the blind cut as a
setting and sells it as transparency. It does not treat the expected amount as a secret the
system must protect by force.

## 3. The vendors side by side

| Vendor                       | Expected at the count                                                                                                                                                   | Configured                                                                                         | What is hidden                                                                       | Variance gate                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **Parrot**                   | Both. The site runs one mode or the other.                                                                                                                              | Not stated in these articles. The two articles describe the same flow with a different visibility. | The expected amount of every payment method.                                         | Not stated in these articles.                                                                                             |
| **Fudo**                     | Blind is optional.                                                                                                                                                      | Per **role** ("Roles de Usuario").                                                                 | The whole "Según sistema" block, "ya sea en arqueos de caja abiertos o cerrados".    | Not stated in this article.                                                                                               |
| **Square**                   | Visible. "Use cash drawer sessions to view starting cash amount, cash sales, cash refunds, cash paid in/out and the expected cash amount in your cash drawer."          | n/a.                                                                                               | Nothing. Closing records "the actual amount"; ending and closing are different acts. | Reports and permissions live in the Dashboard.                                                                            |
| **Toast**                    | The count closes against "the expected balance". The article does not say whether the screen hides it.                                                                  | Thresholds in Toast Web.                                                                           | **UNVERIFIED.**                                                                      | "Closeout over/Short max": above it, "a manager to approve the closing of the cash drawer". A separate warning threshold. |
| **PoloTab**                  | Visible. The arqueo exists to "confirmar que coincidan con lo que el sistema indica que debería haber", and the help page works the expected amount out in the example. | n/a.                                                                                               | Nothing. The module "Muestra automáticamente si existe un faltante o sobrante".      | Not stated.                                                                                                               |
| **SoftRestaurant**           | **UNVERIFIED.** A tutorial video named "Arqueos y corte ciego SoftRestaurant" exists, and its channel is not the vendor's. No first-party page was found.               | —                                                                                                  | —                                                                                    | —                                                                                                                         |
| **Clover, Lightspeed, Odoo** | No blind variant is documented.                                                                                                                                         | —                                                                                                  | —                                                                                    | Odoo keeps money details in the count window's "Notes".                                                                   |

**source-backed tradeoff** The market splits. Square and PoloTab show the expected amount and
trust the count. Fudo hides it for chosen roles, and hides it in closed counts too. Parrot
offers both and lets the merchant decide.

## 4. What none of them does

**inference** No vendor in this set documents Umi's current combination: hide the total while
showing every term that composes it. Fudo hides the section that holds the expected. Parrot
hides the expected amounts. PoloTab prints the whole equation. The half-measure is Umi's
alone, and it is the part that made the count blind in name only.

## 5. What this means for Umi

1. **documented fact** The policy switch already exists. `blind_count_required` sits in
   `merchant.cash_shift_policy`, and the till already prints its value on the policy card as
   "Conteo ciego" or "Conteo visible".
2. **inference** Parrot's precedent supports keeping that switch and letting the owner
   choose. A café that came from Parrot has already made this decision once.
3. **inference** If Umi wants the blind mode to be honest, it must hide the terms as well as
   the total, in the way Fudo hides "Según sistema". Hiding the total alone is the one shape
   that no vendor in this set uses.
4. **source-backed tradeoff** If Umi wants the count to be trustworthy without hiding
   anything, Square's model is the reference: show the expected, record the actual, and put
   the reconciliation and the variance threshold in front of the owner.

## Sources

| Source                                                                                    | Rung |
| ----------------------------------------------------------------------------------------- | ---- |
| `https://soporte.parrotsoftware.com.mx/cajas-pos/corte-de-caja`                           | 1    |
| `https://soporte.parrotsoftware.com.mx/cajas-pos/corte-de-caja-ciego`                     | 1    |
| `https://parrotsoftware.zendesk.com/hc/es/articles/4414007822995-Configuraciones-de-caja` | 1    |
| `https://soporte.fu.do/es/articles/11730856-como-configurar-un-arqueo-de-caja-ciego`      | 1    |
| `https://soporte.fu.do/es/articles/11730865-3-arqueos-de-caja`                            | 1    |
| `https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session`        | 1    |
| `https://doc.toasttab.com/doc/platformguide/adminCashDrawerToastWebOperations.html`       | 1    |
| `https://www.polotab.com/soporte/que-es-el-arqueo-de-caja`                                | 1    |
| `https://www.youtube.com/watch?v=GQ_bWLBGwXo` (third-party channel, SoftRestaurant)       | 5    |
