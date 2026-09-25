# Jev intent classification pilot - the plan

_Plan · umi-api · conversations · 2026-09-18_

Evidence base: [the TypeSafe AI Jev research](../research/2026-09-18-typesafe-ai-jev.md).

## 0. Scope

This plan moves the intent-classification call of the WhatsApp loop from a
language model to TypeSafe AI's Jev. It starts as an offline replay. It does not
change production behavior until the replay passes the gate in section 5.

This plan does NOT cover:

- The tool loop. `tool-loop.service.ts` uses real tool calling and stays on
  Anthropic.
- The text-generation calls. Jev returns typed answers, not text. A caller that
  needs a sentence for a customer keeps its language model.

## 1. The cost today

`apps/umi-api/src/modules/conversations/intent.service.ts` calls
`LLM_COMPLETION.createCompletion` once for every inbound WhatsApp message.
`AdaptersModule` binds that provider from `LLM_PROVIDER`. The default is
`AnthropicAdapter` with model `claude-haiku-4-5-20251001`, `temperature: 0`, and
`maxTokens: 500`.

Measured from the source:

| Item | Value |
| --- | --- |
| `INTENT_SYSTEM_PROMPT` | 4,035 characters, about 1,060 tokens |
| User message | The state, the pending clarification, the cart summary, the customer facts, the conversation summary, the semantic context, and the turn |
| Output ceiling | 500 tokens |

Prices, read 2026-09-18:

| Provider | Input | Output |
| --- | --- | --- |
| Claude Haiku 4.5 | $1.00 per Mtok | $5.00 per Mtok |
| Jev 1.13 | $0.042 per Mtok | Free |

**Inference:** one turn of about 1,300 input tokens and 150 output tokens costs
about $0.0021 on Haiku 4.5 and about $0.000055 on Jev. Jev is about 37 times
cheaper on that turn.

## 2. What maps to Jev, and what does not

The current call returns one JSON object. Jev answers typed questions instead.
Most fields map directly.

| Current field | Jev shape |
| --- | --- |
| `intent_type` (13 values) | Choice |
| `tool_hint` (11 values) | Choice |
| `clarification_target` (6 values) | Choice |
| `confidence` (high, medium, low) | Score, or the native `confidence` value |
| `complete`, `ambiguous`, `is_revision`, `references_prior_state` | One Noul each |
| `entities.size`, `entities.temp`, `entities.milk` | Choice |
| `entities.confirmation` | Noul |

Four fields do **not** map:

| Current field | Why it does not map |
| --- | --- |
| `entities.query` | Free text. Jev returns no free text. |
| `entities.pickup_person` | Free text. |
| `entities.customer_note` | Free text. |
| `entities.cancel_reason` | Free text. |

**Inference:** the classification half of the call is a good fit. The free-text
half is not. Three options exist for the free-text fields:

1. Keep a small language model for the free-text fields only. The prompt then
   shrinks to the extraction rules, and the classification rules leave it.
2. Build a Choice from a retrieval shortlist of the product catalog, then select.
   This works for `query` when the menu bounds the answer.
3. Use the vendor's pre-parsed value extraction cookbook. Code finds the
   candidate spans, and Jev selects the span.

## 3. The pilot shape

Do not run Jev inside the request path first. A shadow call doubles the cost per
turn and adds a second failure mode. Replay stored turns instead.

1. Add a `TypeSafeAdapter` with one method for the `POST /v1/systemone` call. It
   returns the typed answers plus the usage counts. Follow the shape of
   `AnthropicAdapter`.
2. Add config keys: `TYPESAFE_AI_API_KEY` and `TYPESAFE_MODEL`. Pin `jev-1.13.0`.
   Do not use `jev-latest`, because the alias moves and the answers can change.
3. Do **not** bind the adapter to `LLM_COMPLETION`. Jev returns no text, so it
   does not satisfy `LlmCompletionProvider`.
4. Build a replay harness. Read inbound rows from `merchant.message`, rebuild the
   `extractIntent` parameters, and call both providers on the same input. Write
   one report row per turn.
5. Add a selection value `INTENT_PROVIDER` with `anthropic` as the default. Flip
   it only after the gate passes.

## 4. The replay gate

The current Haiku label is not ground truth. Agreement therefore measures change,
not correctness. Two measurements are necessary:

1. **Agreement.** Compare the Jev answer with the stored Haiku answer on
   `intent_type`, `tool_hint`, `clarification_target`, and the four booleans.
2. **Accuracy.** Hand-label at least 200 real turns, in Spanish, and score both
   providers against those labels. Do this before the agreement number is
   believed.

Record latency p50 and p95, the token counts, and the cost per 1,000 turns.

## 5. The risks that decide the pilot

| Risk | Evidence | Consequence |
| --- | --- | --- |
| Spanish accuracy | The vendor page says English is primary and other languages have lower accuracy | Umi's customers write Spanish. Measure this first. |
| Context rot | The vendor's jaggedness page | The semantic context in the user message costs accuracy. Trim it. |
| Prompt injection | The vendor's jaggedness page: state is not treated as hostile by default | Customer text can move the answer. Keep the confirmation override in code. |
| Availability | The vendor calls the model early access | A production dependency on an early-access service needs a fallback. Keep the Anthropic path. |
| Data handling | United States hosting, no zero retention on the self-serve plan, Telemetry is processed without restriction | Umi sends customer text. The owner must accept the terms. |
| Publication | The Master Customer Agreement forbids publishing benchmark results | An internal comparison is permitted. A public write-up is not. |

## 6. Steps

1. Get an API key from `console.typesafe.ai/settings/keys`. Uncertain step: the
   vendor does not document whether it grants the key at once.
2. Add the adapter and the config keys. Add unit tests with a recorded response.
3. Build the replay harness and run it on a stored sample of at least 2,000
   turns.
4. Hand-label 200 turns and score both providers.
5. Run the pilot only if the Spanish accuracy is equal or better, and the owner
   accepts the data terms.
