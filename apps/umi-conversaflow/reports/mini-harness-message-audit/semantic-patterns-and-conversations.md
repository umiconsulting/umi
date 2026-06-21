# Mini-Harness Semantic Message Audit

Date: 2026-05-12  
Source: Supabase `conversaflow` runtime tables  
Scope: broad message retrieval across all conversations, embeddings, traces, AI logs, jobs, outbox

## Evidence Summary

- Retrieved `2,462` messages across `454` conversations.
- User messages: `1,246`.
- Assistant messages: `1,216`.
- Conversation size distribution:
  - p50: `2` messages
  - p75: `2` messages
  - p90: `8` messages
  - max: `536` messages
- Exported local samples:
  - `reports/mini-harness-message-audit/messages.tsv`
  - `reports/mini-harness-message-audit/ai_tool_chains.tsv`

## Embedding And Memory Coverage

- Embedded messages: `2,430 / 2,462`.
- Missing embeddings: `32`.
- User embedding coverage: `1,215 / 1,246` (`97.51%`).
- Assistant embedding coverage: `1,215 / 1,216` (`99.92%`).
- Active embedding model: `voyage-4-lite`.
- Embedding dimensions: `1024`.
- User messages with embedded vector and null model: `2`; likely legacy writes before `embedding_model` was populated.
- Missing user embeddings are mostly short fragments or older test messages: examples include `hola`, `cual dato`, `????`, `frias`, `quiero`, and blank messages.
- `customer_preferences` rows: `8`.
- Rows with facts: `8`.
- Rows with preferences: `7`.
- Rows with typical order: `5`.
- Rows with allergies: `0` populated, though the key exists in facts.

Interpretation:

- Voyage embedding coverage is good enough to support customer-scoped semantic recall.
- The current memory gap is not vector availability; it is behavioral use and safety.
- Customer facts are useful but sparse. The mini-harness must treat them as personalization context, not as cart/order truth.

## Trace And Runtime Issue Patterns

Last 45 days:

- Pipeline traces:
  - `process.started`: `770`
  - `process.completed`: `765`
  - `process.outbox_inserted`: `765`
  - `dispatch.delivered`: `187`
  - `inbound.enqueued`: `177`
  - `integrity.completed`: `171`
- Trace issues:
  - `dispatch.dead`: `7`
    - Error: `Twilio sendWhatsAppMessage returned null — missing config or API error`
  - `integrity.failed`: `3`
    - Error: `no_trailing_user_messages`
  - `integrity.skipped`: `3`
    - Reason: `turn_already_in_progress`
- Job failures: none returned by the audit query.
- Outbox failures:
  - `twilio.reply dead`: `7`
    - Same Twilio missing config/API error.

Interpretation:

- The biggest operational issue in traces is Twilio delivery config/API failure, not LLM/tool logic.
- Integrity failures are rare and expected around race/idempotency edges.
- The new mini-harness should keep current turn integrity and outbox durability, then focus testing on conversational quality and tool choice.

## Observed Message Pattern Counts

Pattern counts from user messages:

- `add_or_order`: `475`
- `variant_detail`: `361`
- `menu_browse`: `191`
- `confirmation`: `132`
- `vague_food_or_mood`: `118`
- `negative_or_revision`: `114`
- `greeting`: `81`
- `repeat_order`: `23`
- `complaint_or_issue`: `20`
- `hours_or_location`: `13`
- `payment`: `1`
- `cancel_order`: `1`

## Historical Tool-Chain Pattern

From `1,090` AI turn logs:

- Response type counts:
  - `product_search`: `787`
  - `menu`: `261`
  - `order_confirm`: `42`
- Historical tool counts:
  - no tool recorded: `556`
  - `add_to_cart`: `314`
  - `search_menu`: `219`
  - `confirm_order`: `8`
  - `reorder_last_order`: `6`
  - `get_business_info`: `6`
  - `get_business_hours`: `1`

Important: these logs are mostly from the previous runtime. They are still useful because they reveal language patterns and tool gaps.

## Expected Tool Mapping And Adequacy

| User semantic pattern | Examples from DB, paraphrased or shortened | Expected function/tool | Adequacy |
|---|---|---|---|
| Greeting only | `hola`, `que rollo` | no tool unless combined with intent | Adequate |
| Menu browse | `que tienes`, `cuales opciones`, `q variantes tienes` | `search_menu` | Adequate; mini-harness should call it more freely |
| Product availability | `tienes X`, `manejan X`, `hay X` | `search_menu` | Adequate |
| Vague craving | `algo dulce`, `bebidas frias`, `algo monchoso` | `search_menu` | Adequate if tool handles category/mood search |
| Direct add | `quiero X`, `dame X`, `ponme X` | `add_to_cart` | Adequate |
| Variant fragment | `chico`, `gde`, `deslactosada`, `rocas` | resume prior `add_to_cart` or clarify | Adequate if pending clarification is active |
| Cart revision | `quita el latte`, `solo quiero la galleta`, `ya quitaste X?` | `edit_cart` | Underrepresented historically; needs strong tests |
| New order reset | `olvida eso`, `empezamos de nuevo`, `otra orden` | likely `edit_cart`/clear cart if cart exists; otherwise conversational reset | Partially adequate; no explicit clear-cart tool beyond `edit_cart` semantics |
| Confirmation | `si`, `simon`, `seria todo`, `listo` | `confirm_order` only if draft cart exists and summary was presented | Adequate but must be guarded |
| Repeat order | `lo mismo`, `lo de siempre`, `repetir mi pedido` | `get_recent_customer_orders`, then `reorder_last_order` after explicit confirmation | Adequate but must be two-step unless wording explicitly confirms |
| Cancel order | `cancela mi orden` | `cancel_order`, ask reason if missing | Adequate |
| Hours | `a que hora cierran`, `esta abierto` | `get_business_hours` | Adequate |
| Location/contact/payment | `ubicacion`, `numero`, `transferencia` | `get_business_info` | Adequate |
| Complaint/frustration | `no me contestas`, `me perdiste`, wants supervisor | conversational apology; `get_business_info` only if asking contact | Missing escalation tool; current tool is not enough for handoff |
| Out-of-domain | politics, jobs/vacancies, insults without task | no tool; brief boundary response | Adequate through prompt, not tool |

Historical no-tool misses, inferred from user wording:

- `172` add/order-like messages had no tool in old logs.
- `66` confirmation-like messages had no tool in old logs.
- `24` search/menu-like messages had no tool in old logs.
- `14` repeat-order-like messages had no tool in old logs.
- `5` edit-cart-like messages had no tool in old logs.
- `5` info/hours-like messages had no tool in old logs.

Mini-harness implication:

- The LLM should be trusted to call tools directly, but tests must enforce that operational claims only happen after tool success.
- The highest-value test coverage is not simple add-to-cart; it is continuation, revision, repeat order, frustration, and vague browse.

## Conversation Suite 1: Vague Browse, Cart Build, Revision, Confirmation

Goal: exercise `search_menu`, `add_to_cart`, `edit_cart`, `confirm_order`, pending clarification, and final safety.

1. User: Hola, que tienes frio pero dulce?
2. Assistant: Uses `search_menu({ query: "bebida fria dulce" })`; replies with 2-3 grounded options and asks what sounds good.
3. User: Algo con cafe pero no tan pesado.
4. Assistant: Uses `search_menu({ query: "cafe frio ligero" })`; suggests iced latte/caramel/americano-style options based on real results.
5. User: Va, dame un latte regular chico en las rocas con leche de coco.
6. Assistant: Uses `add_to_cart({ query: "latte regular", size: "chico", temp: "rocas", milk: "coco" })`; summarizes cart and asks if quiere algo mas.
7. User: Tambien una galleta de leonor de chocochip.
8. Assistant: Uses `add_to_cart({ query: "galleta de leonor chocochip" })`; if ambiguous, asks exact clarification from tool.
9. User: La chocolatechip.
10. Assistant: Resumes `add_to_cart` with prior query plus variant detail; updates cart summary.
11. User: Mejor quita el latte, solo quiero la galleta.
12. Assistant: Uses `edit_cart({ remove_query: "latte", keep_query: "galleta" })`; confirms updated cart without inventing total.
13. User: Y agregame un americano chico frio.
14. Assistant: Uses `add_to_cart({ query: "americano", size: "chico", temp: "frio" })`; summarizes cart.
15. User: Ese sin leche, porfa.
16. Assistant: Uses `add_to_cart` or `edit_cart` depending current cart representation; should not ask repeated product question if americano is active.
17. User: Seria todo.
18. Assistant: Presents cart summary if not already final; asks explicit confirmation if needed. Does not call `confirm_order` unless wording is enough and summary is current.
19. User: Si, confirmo.
20. Assistant: Uses `confirm_order`; only then says order is confirmed with backend-provided reply.

Expected pass criteria:

- No hallucinated order confirmation before step 20.
- `edit_cart` is called at step 12.
- Variant follow-up in step 9 resumes the cookie context.
- Memory is not needed.

## Conversation Suite 2: Memory, Preferences, Repeat Order, Safe Confirmation

Goal: exercise customer memory, `get_recent_customer_orders`, `reorder_last_order`, preference personalization, and memory-as-context guard.

1. User: Hola, soy el de siempre.
2. Assistant: Uses memory context if present, but does not create a cart from memory. Asks whether quiere revisar/repetir su pedido reciente.
3. User: Si, que fue lo ultimo que pedi?
4. Assistant: Uses `get_recent_customer_orders({ limit: 3 })`; summarizes recent orders.
5. User: El ultimo, pero con leche de avena como me gusta.
6. Assistant: If tool supports direct reorder note, asks confirmation before `reorder_last_order`; otherwise explains it can repetir and notes preference but must confirm.
7. User: Antes dime si tienen algo dulce sin cafe.
8. Assistant: Uses `search_menu({ query: "dulce sin cafe" })`; suggests grounded options.
9. User: Mmm agregame una galleta de chispas tambien.
10. Assistant: Uses `add_to_cart({ query: "galleta chispas" })`; updates draft cart. Does not silently mutate repeated order.
11. User: Entonces seria lo de siempre mas la galleta?
12. Assistant: Summarizes current cart/order intent; if previous order has not been re-created in cart, says it still needs confirmation to repeat it.
13. User: Si repite el ultimo y agrega la galleta.
14. Assistant: Uses `reorder_last_order` only if explicit repeat is safe; otherwise uses `get_recent_customer_orders` again if context expired. Then handles galleta add if separate cart flow allows it.
15. User: Ah pero no le pongas leche regular, me cae mal.
16. Assistant: Treats as current-order constraint. If order already confirmed, explains cannot silently change without a tool/path; if still draft, uses relevant cart update/clarification.
17. User: Mejor no repitas, solo quiero un chai con avena.
18. Assistant: Uses `add_to_cart({ query: "chai", milk: "avena" })`; should reset/avoid prior repeat intent.
19. User: Va confirmalo.
20. Assistant: Uses `confirm_order` only if cart summary is current; otherwise summarizes and asks one explicit confirmation.

Expected pass criteria:

- Memory/facts personalize but do not create hidden cart lines.
- Repeat flow is two-step unless the user explicitly confirms.
- Changed preference is treated as current user instruction, not only memory.
- Prior repeat intent is abandoned at step 17.

## Conversation Suite 3: Frustration, Out-of-Domain, Human Contact, Cancellation

Goal: exercise frustration handling, business info boundaries, cancellation reason, and no-tool behavior for non-operational abuse/out-of-domain content.

1. User: Por que no me contestas?
2. Assistant: No tool unless needed; apologizes briefly and asks how to help.
3. User: Me perdiste, quiero hablar con alguien.
4. Assistant: Uses `get_business_info` only if contact/admin info is available; otherwise gives a concise handoff-style response without inventing.
5. User: Cual es el numero?
6. Assistant: Uses `get_business_info`; provides verified number/contact if configured.
7. User: Bueno, cancela mi orden.
8. Assistant: Uses `cancel_order` only if reason is present; because missing, asks for reason.
9. User: Porque ya se tardaron mucho.
10. Assistant: Uses `cancel_order({ reason: "ya se tardaron mucho" })`; replies with backend result.
11. User: Y donde estan ubicados?
12. Assistant: Uses `get_business_info`; gives verified address.
13. User: A que hora cierran hoy?
14. Assistant: Uses `get_business_hours`; gives verified status/hours.
15. User: Tienen vacantes?
16. Assistant: No ordering tool. If business info includes contact, says to contact the cafe; otherwise brief boundary.
17. User: Ok entonces mejor quiero hacer otra orden.
18. Assistant: No stale cancelled order reuse; asks what wants or uses `search_menu` if vague.
19. User: Algo salado, monchoso.
20. Assistant: Uses `search_menu({ query: "salado monchoso" })`; suggests grounded savory options.

Expected pass criteria:

- No tool for pure frustration unless contact info is requested.
- `cancel_order` asks for a reason before side effect.
- No stale order state leaks after cancellation.
- Out-of-domain request does not derail the ordering flow.

## Conversation Suite 4: Hours, Payment, Complex Multi-Item Cart, Corrections

Goal: exercise `get_business_hours`, `get_business_info`, multiple `add_to_cart`, correction fragments, and final confirmation.

1. User: Esta abierto ahorita?
2. Assistant: Uses `get_business_hours`; answers if orders are accepted.
3. User: Puedo pagar por transferencia?
4. Assistant: Uses `get_business_info`; answers from verified payment methods.
5. User: Perfecto, quiero un pumpkin matcha latte chico a las rocas con deslactosada.
6. Assistant: Uses `add_to_cart({ query: "pumpkin matcha latte", size: "chico", temp: "rocas", milk: "deslactosada" })`; handles ambiguity if tool asks.
7. User: Y un brownie matcha caliente.
8. Assistant: Uses `add_to_cart({ query: "brownie matcha", temp: "caliente" })`; updates cart.
9. User: No, mejor el brownie no.
10. Assistant: Uses `edit_cart({ remove_query: "brownie matcha" })`; confirms cart.
11. User: Agrega una limonada o algo sin cafe mejor.
12. Assistant: Uses `search_menu({ query: "limonada sin cafe" })`; suggests options, does not add unspecified item.
13. User: La limonada mineral.
14. Assistant: Uses `add_to_cart({ query: "limonada mineral" })`; updates cart.
15. User: Grande si hay.
16. Assistant: Resumes/adds variant detail for limonada; if no size variant, explains verified option.
17. User: Para recoger a nombre de Mariana.
18. Assistant: Stores pickup detail only when confirming; summarizes cart and asks confirmation.
19. User: Confirmo.
20. Assistant: Uses `confirm_order({ pickup_person: "Mariana" })`; replies with backend order confirmation.

Expected pass criteria:

- Hours and payment use verified tools.
- Search is used before adding vague "algo sin cafe".
- Corrections call `edit_cart`.
- Pickup name is carried into `confirm_order`.

## Conversation Suite 5: Ambiguous Product, Category/Product Confusion, Typo Recovery

Goal: exercise category search, variant clarification, typo tolerance, and no repeated question loop.

1. User: Quiero una galleta de la mesa de leonor.
2. Assistant: Uses `search_menu({ query: "galleta la mesa de leonor" })` or `add_to_cart`; if category/product ambiguous, asks with concrete options.
3. User: Cuales tienes?
4. Assistant: Uses recent context plus `search_menu({ query: "La Mesa de Leonor" })`; lists variants/products, not raw internal categories.
5. User: La de chocholatechip.
6. Assistant: Uses `add_to_cart({ query: "chocolatechip" })`; typo should resolve.
7. User: Y tambien un late regular.
8. Assistant: Uses `add_to_cart({ query: "latte regular" })`; typo should resolve.
9. User: Chico.
10. Assistant: Resumes latte pending size; does not ask "que producto".
11. User: En rocas con coco.
12. Assistant: Applies temp/milk to active latte line; if needed calls `add_to_cart` with carried query.
13. User: No era coco, era avena.
14. Assistant: Uses cart update path; should not add a duplicate latte.
15. User: Ya quedo?
16. Assistant: Summarizes verified cart. No order confirmation claim.
17. User: Si.
18. Assistant: If current cart summary is enough, uses `confirm_order`; otherwise asks explicit confirmation with summary.
19. User: Me equivoque, todavia no.
20. Assistant: If order already confirmed, says changes may require contacting cafe/cancel flow; if not confirmed, keeps cart open. Does not silently cancel.

Expected pass criteria:

- Product/category ambiguity resolves with concrete options.
- Typos do not break search.
- Variant fragments attach to active item.
- Late reversal after confirmation is handled safely.

