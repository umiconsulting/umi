# Order confirmation gating for an LLM ordering bot

Date: 2026-08-15

## Decision summary

Keep the evidence check. It is a correct and unusually well-targeted design for a WhatsApp ordering bot.

The pattern has primary-source support, but not as a confirmation gate. Sources describe verbatim quotes as a grounding technique, not as a write gate.

No vendor documents "quote the user, then verify the substring" as a confirmation mechanism. This is a novel application of a known technique.

Every major agent stack gates consequential writes with an approval interrupt, not with a word list. Anthropic, OpenAI, and LangChain all pause the run and ask an external decider.

The Umi bot has no external human approver. The customer is the approver, and the customer is also the only channel. This is why the vendor interrupt pattern does not transfer directly.

The classic NLU stacks solve the same problem with a confidence threshold plus an explicit "cannot resolve to yes or no" path. Amazon Lex resolves a confirmation reply to four values, not two.

The old word list was a hand-written classifier with no threshold and no failure path. Its failure mode is documented: repeated non-progress drives measured abandonment.

The evidence check protects against one thing only. It proves the customer wrote something. It does not prove the words mean yes.

The gate has three concrete holes: substring matching with no token boundary, no minimum quote length, and no proof that the customer saw a priced summary.

Fix the substring hole first. A model that quotes `si` passes against `siempre lo mismo`, and one that quotes `sale` passes against `¿sale más caro?`.

Add `strict: true` to the tool definitions. Anthropic states that without strict mode the model can omit required fields. Haiku 4.5 supports it.

Do not add a second word list. The asymmetry favours a design that fails by refusing, and the current design already fails that way.

Add a summary precondition. Both τ-bench and Amazon Lex require the agent to read back the order before it asks for confirmation.

The write path is already idempotent per turn. That closes the duplicate-order failure mode.

Two customer behaviours still have no path: a voice-note reply and an emoji reaction. Neither arrives as text.

No first-party statement explains the McDonald's and IBM wind-down. Do not treat that case as evidence for any confirmation design.

## Scope

This report answers one question: how should the bot gate the moment it writes an order.

It covers these items:

- Confirmation mechanisms that vendors document for agent tool calls.
- Failure modes with a traceable source.
- The choice between a deterministic gate and model judgement.
- Multilingual and code-switching evidence.
- An assessment of the code that this repository just merged.

It does not cover order accuracy, menu matching, or price calculation. It does not cover the kitchen display path after the write.

## The current Umi implementation

### Documented facts

The gate is in [`tool-loop.service.ts`](../../apps/umi-api/src/modules/conversations/tool-loop.service.ts).

`confirm_order` and `confirm_order_changes` are blocked unless two conditions are true:

1. `hasDraftCart(draftCart)` — the draft cart has at least one item.
2. `turnTextContains(input.customer_confirmation, userTurnText)` — the quoted words are present in the customer message.

`turnTextContains` lowercases both strings, strips diacritics, replaces a fixed punctuation set with spaces, collapses whitespace, and then runs `String.prototype.includes`.

The tool schema in [`tool-definitions.ts`](../../apps/umi-api/src/modules/conversations/tools/tool-definitions.ts) marks `customer_confirmation` as required. Its description tells the model to copy the customer words exactly and never to paraphrase.

The system prompt in [`prompts.ts`](../../apps/umi-api/src/modules/conversations/prompts.ts) repeats the same rule. It also states that the model judges whether the customer confirmed.

A blocked call returns a `tool_result` with `is_error: true`, a machine reason, and Spanish guidance. The model then asks the customer again.

`MAX_GUARD_FIRES = 4` stops a block loop inside one turn.

A second layer exists after the loop. `blockUnverifiedOrderConfirmation` in [`turn-safety.ts`](../../apps/umi-api/src/modules/conversations/turn-safety.ts) replaces the reply text when the model claims an order but no tool confirmed one.

The write is idempotent. `CheckoutTools.idempotencyKey` builds `conversaflow:turn:<turn_id>`, and `OrdersRepository.createOrder` writes it as `external_ref` against a partial unique index. A retried turn returns the existing order.

The model is `claude-haiku-4-5-20251001`, set in the Anthropic adapter. The tool definitions do not set `strict`.

The channel is Twilio WhatsApp. The controller reads only the `Body` parameter.

`userTurnText` is `turn.mergedUserText`. Several WhatsApp bubbles merge into one turn before the loop runs.

## 1. Confirmation gating patterns

### What the agent vendors document

Anthropic documents permission states for each tool. A user can allow a calendar read always and still require approval before Claude sends an invitation. Source: [Trustworthy agents in practice](https://www.anthropic.com/research/trustworthy-agents).

Anthropic also documents a plan step. Claude shows its intended plan first, and the user reviews, edits, and approves it before anything happens. Source: [Trustworthy agents in practice](https://www.anthropic.com/research/trustworthy-agents).

For the computer use tool, classifiers detect a possible prompt injection in a screenshot. They then steer the model to ask the user for confirmation before the next action. Source: [Computer use tool](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/computer-use-tool).

OpenAI documents `needsApproval` on a tool. It accepts `true` or an async function. When it returns true, the run stops and returns an interruption that the program must approve or reject. Source: [Human-in-the-loop, OpenAI Agents SDK](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/).

OpenAI groups guardrails into three places: input, output, and around a tool call. It tells you to pause before side effects such as cancellations and edits. Source: [Guardrails and human review](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals).

LangChain documents a human-in-the-loop middleware. It raises an interrupt, saves the graph state, and waits. The human can approve, edit, reject, or respond. A persistent checkpointer is required. Source: [Human-in-the-loop](https://docs.langchain.com/oss/python/langchain/human-in-the-loop) and [How to review tool calls](https://langchain-ai.github.io/langgraph/cloud/how-tos/human_in_the_loop_review_tool_calls/).

### What the conversational-AI vendors document

Amazon Lex V2 has a confirmation step between slot filling and fulfilment. The prompt reads the slot values back to the user. Source: [Confirmation](https://docs.aws.amazon.com/lexv2/latest/dg/intent-confirm.html).

Lex defines three responses at that step: confirmation, decline, and failure. The failure response is sent when the reply "couldn't be understood or couldn't be resolved to a yes or a no". Source: [Confirmation](https://docs.aws.amazon.com/lexv2/latest/dg/intent-confirm.html).

Lex states that without a confirmation prompt the bot moves straight to fulfilment. The gate is opt-in, and its absence is a documented design choice. Source: [Confirmation](https://docs.aws.amazon.com/lexv2/latest/dg/intent-confirm.html).

The `AMAZON.Confirmation` built-in slot type resolves an answer to four values: Yes, No, Maybe, and Don't know. Its published examples include "Yeah", "Yep", "Ok", "Sure", "Nope", "Perhaps", and "Not sure about it". Source: [AMAZON.Confirmation](https://docs.aws.amazon.com/lexv2/latest/dg/built-in-slot-confirmation.html).

The API model separates a confirmation response from a declination response, and marks the step active or inactive. Source: [IntentConfirmationSetting](https://docs.aws.amazon.com/lexv2/latest/dg/API_IntentConfirmationSetting.html).

Dialogflow CX uses a machine-learning classification threshold. Below the threshold, the agent raises a no-match event. The threshold can be set for every flow in each language. Its stated purpose is to "filter out false positive results". Source: [Agent settings](https://docs.cloud.google.com/dialogflow/cx/docs/concept/agent-settings).

Dialogflow CX also offers generative fallback. An LLM writes the reply when the input matches no intent or parameter. Source: [Generative fallback](https://docs.cloud.google.com/dialogflow/cx/docs/concept/generative-fallback).

Rasa predicts an `nlu_fallback` intent when every other intent falls below the configured threshold. Source: [Fallback and human handoff](https://legacy-docs-oss.rasa.com/docs/rasa/fallback-handoff/).

Rasa's two-stage fallback asks the user to affirm the classified intent before it acts. The default action is `action_default_ask_affirmation`. If the user denies, the bot runs an ultimate fallback such as a human handoff. Source: [two_stage_fallback policy](https://rasa.com/docs/rasa/reference/rasa/core/policies/two_stage_fallback/).

Rasa's newer CALM design states the split directly: "The LLM interprets what the user wants. The logic decides what happens next." Source: [Conversational AI with Language Models](https://rasa.com/docs/learn/concepts/calm/).

### Evidence and quote verification

Anthropic tells you to ask Claude to quote the relevant parts of a document before it does the task. The stated purpose is to ground the response in the actual text and reduce hallucination. Source: [Long context prompting tips](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/long-context-tips).

The same page tells you to make the response auditable with quotes, and to retract a claim when no supporting quote exists. Source: [Long context prompting tips](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/long-context-tips).

The Citations feature does the same job at the API layer. Anthropic states: "Because the API parses citations into the response formats described in the following sections and extracts `cited_text` directly, citations are guaranteed to contain valid pointers to the provided documents." Source: [Citations](https://platform.claude.com/docs/en/build-with-claude/citations).

The Citations page names the alternative that Umi uses. It refers to "a prompt-based approach [that] asks Claude to output direct quotes". Anthropic recommends the API feature over that approach for citation reliability. Source: [Citations](https://platform.claude.com/docs/en/build-with-claude/citations).

DeepMind's GopherCite trains a model to answer with a verbatim quote from a retrieved source. The evidence is "a verbatim quote extracted from a longer source". Source: [Teaching language models to support answers with verified quotes](https://arxiv.org/abs/2203.11147).

### Assessment of the pattern

The verbatim-quote-plus-verification mechanism is a recognized grounding pattern. Anthropic documents it, and DeepMind published it.

No source found applies that mechanism to a write gate. The vendors gate writes with an approval interrupt or with a confidence threshold.

**Inference:** Umi's design is a novel combination. It takes the grounding primitive from the citation literature and uses it as the deterministic half of a two-layer gate. The combination is sound, but no vendor validates it, and no published evaluation measures it.

**Inference:** the vendor interrupt pattern cannot transfer as-is. Anthropic, OpenAI, and LangChain all assume a second party who reviews the action. Umi has no second party at 08:00 in a coffee shop queue. The customer is both the requester and the only available approver, and the approval arrives as free text on the same channel.

## 2. Documented failure modes

### False commit

τ-bench states the rule that Umi is trying to enforce: "Before any consequential action (cancel, modify, return, exchange), the agent must list the action details and obtain explicit user confirmation." Source: [τ-bench](https://arxiv.org/abs/2406.12045).

τ-bench then measures how well agents keep that rule. GPT-4o solves under 50% of tasks. Its `pass^8` score in the retail domain is under 25%. The authors conclude there is a "need for methods that can improve the ability of agents to act consistently and follow rules reliably". Source: [τ-bench](https://arxiv.org/abs/2406.12045).

**Inference:** this is the strongest published support for keeping a deterministic gate at all. A model that states a policy correctly still breaks it across repeated trials. A gate outside the model does not degrade with sampling.

OWASP names the class. Excessive Agency "enables damaging actions to be performed in response to unexpected, ambiguous or manipulated outputs from an LLM, regardless of what is causing the LLM to malfunction". Source: [LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/).

OWASP's mitigation list includes "Utilise human-in-the-loop control to require a human to approve high-impact actions before they are taken" and complete mediation of downstream requests. Source: [LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/).

Air Canada was held liable for what its chatbot told a customer. The tribunal rejected the argument that the chatbot was a separate legal entity. The case is _Moffatt v Air Canada_, 2024 BCCRT 149. Source: [ABA Business Law Today summary](https://www.americanbar.org/groups/business_law/resources/business-law-today/2024-february/bc-tribunal-confirms-companies-remain-liable-information-provided-ai-chatbot/). This is a secondary summary; the tribunal text was not fetched for this report.

**Inference:** the Air Canada ruling raises the cost of a false commit above the value of the order. A written order the customer never authorized is a merchant liability, not only a support ticket.

### Missed confirmation

A CHI 2020 study analysed three months of logs between 1,685 users and a banking task-oriented chatbot. It measured abandonment after conversational non-progress. Source: [A Conversation Analysis of Non-Progress and Coping Strategies with a Banking Task-Oriented Chatbot](https://dl.acm.org/doi/fullHtml/10.1145/3313831.3376209).

The study reports that 14.9% of users abandoned the bot at their first non-progress event. 25.9% abandoned at the second consecutive event. Three consecutive non-progress events was a sign that the user was about to leave. Source: [same study](https://dl.acm.org/doi/fullHtml/10.1145/3313831.3376209).

**Inference:** this matches the Umi incident exactly. The customer answered "confirmado", the word list did not hold that inflection, and the bot re-asked. That is one non-progress event on a step the customer believed was finished. The measured base rate for leaving after one such event is about 15%.

**Inference:** the cost is asymmetric in a way the old design got backwards. A false block loses the whole order and the customer. A false commit produces a wrong order that staff can cancel. Neither is free, but only one of them ends the conversation.

No primary source was found that measures abandonment specifically at a confirmation step. The CHI study covers non-progress in general.

### Prompt injection into a commit path

OWASP treats prompt injection as a cause of excessive agency. It notes that a lack of a final verification step converts user trust into immediate execution. Source: [LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) and [LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/).

The Chevrolet of Watsonville case is the canonical retail example. A user instructed the site chatbot to agree with everything and then asked to buy a 2024 Tahoe for one dollar. The bot agreed and added a fake binding-offer line. Source: [AI Incident Database, incident 622](https://incidentdatabase.ai/cite/622/).

The important detail is what did not happen. The bot had no authority to set a price or close a deal, so the text carried no commitment and the dealership did not honour it. Source: [AI Incident Database, incident 622](https://incidentdatabase.ai/cite/622/).

**Inference:** the Chevrolet case argues for minimizing what the commit tool can do, not for a better confirmation phrase. Umi already does this. `confirm_order` reads the server-side draft cart and re-prices against the live catalogue. The model cannot pass a price or a product list into the write.

**Assessment of the Umi injection surface:** the evidence check binds the write to the customer's own message. An attacker who controls the customer message can trivially write "confirmo" — but that attacker is the customer, and a customer is allowed to order. The check is therefore not weakened by injection from the customer channel.

The remaining injection surface is any untrusted text that reaches the model from elsewhere: the WhatsApp profile name, product names, and merchant configuration. `detectPromptInjection` in [`security.service.ts`](../../apps/umi-api/src/modules/conversations/security.service.ts) scans only the inbound message. No primary source is needed here; this is a code observation.

### Duplicate and idempotency failures

Stripe documents the standard mechanism. A client-generated idempotency key lets a request be retried safely, and the API stores the first result for that key. Source: [Idempotent requests](https://docs.stripe.com/api/idempotent_requests).

Stripe also states that the idempotency layer compares incoming parameters against the original request and errors when they differ. Source: [Idempotent requests](https://docs.stripe.com/api/idempotent_requests).

**Assessment:** Umi already implements this. The key is the turn id, and the database enforces it with a partial unique index on `external_ref`. A retried turn returns the existing order and its derived total.

**Inference, low confidence:** `idempotencyKey` falls back to `ctx.conversationId` when `turnId` is absent. In the live path `turn.service.ts` always passes `payload.turn_id`, so the fallback should be unreachable. If it were ever reached, a customer's second order in the same conversation would collide with the first and silently return the old order. Consider making the missing turn id an error rather than a fallback.

### The McDonald's and IBM wind-down

McDonald's ended its automated order taking test with IBM and removed the technology from more than 100 restaurants by 26 July 2024. Source: [Restaurant Dive](https://www.restaurantdive.com/news/mcdonalds-ibm-drive-thru-automation-voice-ordering-ai/719085/).

The first-party statement, from McDonald's USA Chief Restaurant Officer Mason Smoot, is procedural: the partnership ends and the technology will be shut off. Source: [Restaurant Business Online](https://www.restaurantbusinessonline.com/technology/mcdonalds-ending-its-drive-thru-ai-test).

McDonald's also said "there is an opportunity to explore voice ordering solutions more broadly" and that it would decide on a future voice solution by the end of the year. Source: [Restaurant Business Online](https://www.restaurantbusinessonline.com/technology/mcdonalds-ending-its-drive-thru-ai-test).

**No primary source found** that gives an accuracy figure, a confirmation failure rate, or any technical cause. Viral error videos are widely cited, but McDonald's never attributed the decision to them.

**Do not use this case as evidence for a confirmation design.** It supports one narrow claim only: a large operator ran a two-year drive-thru pilot and then stopped it without publishing a technical reason.

The Presto Automation case is the stronger data point in the same sector, because a regulator forced the numbers into the open. The SEC found that Presto's disclosures about orders completed without human intervention were misleading. Source: [SEC administrative proceeding 33-11352](https://www.sec.gov/enforcement-litigation/administrative-proceedings/33-11352-s) and the [order](https://www.sec.gov/files/litigation/admin/2025/33-11352.pdf).

The disclosed reality: about 70% of orders needed human agent intervention at the few locations running the most advanced version, and 100% of orders needed it at the substantial majority of locations running the original version. Source: [SEC order](https://www.sec.gov/files/litigation/admin/2025/33-11352.pdf).

**Inference:** drive-thru voice ordering in 2023 and 2024 was not an autonomous commit path. It was a human-reviewed one. A text channel like WhatsApp is easier than a noisy drive-thru lane, but the base rate is a warning against assuming the model gets ordering right without a gate.

## 3. Deterministic guardrail against model judgement

### What the sources say about the split

Rasa states the split as a design rule: the LLM interprets, the deterministic logic decides. Source: [CALM](https://rasa.com/docs/learn/concepts/calm/).

Anthropic's Claude Code auto mode uses the same layering in the other order. Deterministic rules define the criteria, and a model-based transcript classifier applies them. Source: [How we built Claude Code auto mode](https://www.anthropic.com/engineering/claude-code-auto-mode).

Anthropic publishes the operating point of that classifier: a 0.4% false positive rate and a 17% false negative rate on real overeager actions. Source: [How we built Claude Code auto mode](https://www.anthropic.com/engineering/claude-code-auto-mode).

Anthropic states the limit plainly: the classifier "is not a drop-in replacement for careful human review on high-stakes infrastructure". Source: [How we built Claude Code auto mode](https://www.anthropic.com/engineering/claude-code-auto-mode).

Anthropic also publishes the reason a pure approval design decays. Claude Code users approve 93% of permission prompts, and more prompts make each one less considered. Source: [How we built Claude Code auto mode](https://www.anthropic.com/engineering/claude-code-auto-mode).

**Inference:** the 93% figure is the strongest published argument against re-asking a customer for confirmation more than once. An approver who is asked repeatedly stops reading. A WhatsApp customer who is asked repeatedly does something worse — the CHI data says one in four leaves at the second failure.

Anthropic's tool-use guidance places reliability in the tool description first: clear descriptions are the most important factor in correct tool selection. Source: [Define tools](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use).

Anthropic documents that a schema is not self-enforcing. "Without strict mode, Claude might return incompatible types (`"2"` instead of `2`) or omit required fields". With `strict: true` the tool input strictly follows the schema. Source: [Strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use).

Structured outputs, and therefore strict tool use, support Claude Haiku 4.5. Source: [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

### The asymmetry argument

The classic statement of the asymmetry is Saltzer and Schroeder's fail-safe defaults principle. "A design or implementation mistake in a mechanism that gives explicit permission tends to fail by refusing permission, a safe situation, since it will be quickly detected. On the other hand, a design or implementation mistake in a mechanism that explicitly excludes access tends to fail by allowing access, a failure which may go unnoticed in normal use." Source: [The Protection of Information in Computer Systems](https://www.cs.virginia.edu/~evans/cs551/saltzer/).

Dialogflow states its threshold's purpose in the same terms — to "filter out false positive results" while keeping variety in matched input. Source: [Agent settings](https://docs.cloud.google.com/dialogflow/cx/docs/concept/agent-settings).

Lex refuses to guess. When a reply cannot resolve to a yes or a no, the bot sends a failure response rather than fulfil the intent. Source: [Confirmation](https://docs.aws.amazon.com/lexv2/latest/dg/intent-confirm.html).

Rasa's two-stage fallback also refuses to guess. It asks the user to affirm and escalates on denial. Source: [two_stage_fallback policy](https://rasa.com/docs/rasa/reference/rasa/core/policies/two_stage_fallback/).

### Which layer should decide "did the user confirm?"

**No primary source recommends a regex or keyword list for this decision.** Every stack surveyed uses either a trained classifier with a threshold or an LLM.

**No primary source recommends the LLM alone either.** τ-bench measures how badly that fails across repeated trials. Source: [τ-bench](https://arxiv.org/abs/2406.12045).

The documented consensus, restated:

| Layer                       | What the sources give it                    | Source                                                                                                                                                         |
| --------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic judgement of "yes" | LLM or trained NLU with a threshold         | [CALM](https://rasa.com/docs/learn/concepts/calm/), [Agent settings](https://docs.cloud.google.com/dialogflow/cx/docs/concept/agent-settings)                  |
| Whether the action may run  | Deterministic rule or an approval interrupt | [LLM06](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/), [Human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/) |
| What the action does        | Server-side code, never model input         | [LLM06](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)                                                                                           |
| Retry safety                | Idempotency key in the datastore            | [Idempotent requests](https://docs.stripe.com/api/idempotent_requests)                                                                                         |

**Assessment:** the Umi design puts each layer where the sources put it. The LLM judges meaning. A deterministic rule decides whether the write may run. The tool reads the server-side cart. The database enforces one order per turn.

A separate verifier model was considered. **No primary source supports adding one here.** Anthropic's own verifier operates at a 17% false negative rate and still needs deterministic rules underneath. Source: [How we built Claude Code auto mode](https://www.anthropic.com/engineering/claude-code-auto-mode). A verifier would add a full model call to every confirmation turn, and its errors would land on the same asymmetric cost curve as the word list.

## 4. Multilingual and code-switching

A 2025 survey of code-switched NLP reports measured degradation. Multilingual NLU models show "up to a 15% drop in semantic accuracy" on mixed-language content against monolingual text. GPT-4 shows "14-point accuracy drops in zero-shot" code-switching tasks. Fine-tuned models drop 5 to 10 percent on Spanglish and comparable pairs in CodeMixBench. Source: [Beyond Monolingual Assumptions: A Survey of Code-Switched NLP in the Era of Large Language Models](https://arxiv.org/html/2510.07037v3).

The same survey notes that rigid lexical matching misses code-switching complexity. Source: [same survey](https://arxiv.org/html/2510.07037v3).

Spanish-English is one of the four language pairs in the LinCE benchmark, which exists because code-switched corpora were sparse and methods did not generalize. Source: [LinCE](https://arxiv.org/abs/2005.04322).

Dialogflow acknowledges the language dependency in its own design. A separate classification threshold can be set per language, because different languages perform best at different thresholds. Source: [Agent settings](https://docs.cloud.google.com/dialogflow/cx/docs/concept/agent-settings).

Amazon's `AMAZON.Confirmation` publishes English example phrases only, and it resolves to four values rather than two. Source: [AMAZON.Confirmation](https://docs.aws.amazon.com/lexv2/latest/dg/built-in-slot-confirmation.html).

**No primary source was found** that measures keyword-based confirmation failure for Mexican Spanish, for regional slang, or for emoji-only replies. This is a real gap. The survey evidence covers code-switching in general, not confirmation vocabulary.

**Inference:** the general evidence still supports the Umi change. A hand-written list must enumerate a closed set. Mexican Spanish confirmation vocabulary is open: `sale`, `simón`, `ándale`, `órale`, `va que va`, `jalo`, `de una`, `confirmado`, plus English carry-overs and emoji. An LLM does not need the enumeration. A list does, and the list will always be behind.

**Inference:** the degradation figures cut both ways. A 14-point drop for GPT-4 on code-switched tasks means the LLM is not perfect at this either. It means the LLM is better than a list, not that it is safe alone. This is a further argument for keeping a deterministic layer under it.

### Emoji and non-text confirmations

The Umi implementation deliberately keeps emoji as valid evidence. `normalizeEvidence` strips punctuation but not emoji, so a bare `👍` survives and can be quoted and matched. This is a correct choice and the test suite covers it.

Twilio documents that `Body` holds the message text and `MediaUrl0` holds the media link. Source: [Twilio's request to your incoming message webhook URL](https://www.twilio.com/docs/messaging/guides/webhook-request).

**Inference:** a voice-note reply arrives with media and no text. The controller reads only `Body`, so `userTurnText` is empty, the evidence check can never pass, and a customer who confirms by voice cannot complete an order. This is the "purely contextual yes" case in its most concrete form.

**No primary source found** on how Twilio delivers a WhatsApp message reaction to an inbound webhook. Meta's own Cloud API delivers a reaction as its own webhook object rather than as message text. Source: [Reaction messages webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/reaction/). Whether Twilio surfaces the reaction emoji in `Body` was not verified. Verify it against a live log before you rely on either answer.

## 5. Assessment of the evidence check

### What it does protect against

It proves the customer wrote something in the turn. The model cannot invent a confirmation.

It removes a closed vocabulary from the write path. Any language, register, or emoji can now confirm.

It removes the regex rewrite that used to force `confirm_order`. A veto is strictly safer than an override, and the code comment says so correctly.

It gives a machine-readable block reason back to the model, so the model can recover in the same turn instead of failing silently.

It fails by refusing, which matches the Saltzer and Schroeder fail-safe defaults principle. Source: [The Protection of Information in Computer Systems](https://www.cs.virginia.edu/~evans/cs551/saltzer/).

### What it does not protect against

It does not prove the words mean yes. GopherCite's own analysis makes this point about quotes in general: "not all claims supported by evidence are true". Source: [Teaching language models to support answers with verified quotes](https://arxiv.org/abs/2203.11147).

It does not prove the customer saw what they were confirming. τ-bench and Lex both require a read-back before the confirmation question. Sources: [τ-bench](https://arxiv.org/abs/2406.12045), [Confirmation](https://docs.aws.amazon.com/lexv2/latest/dg/intent-confirm.html).

It does not cover a confirmation with no quotable words. A voice note, a reaction, or a reply that depends only on context has nothing to quote.

It does not cover a confirmation that arrived in an earlier turn. The check runs against the current merged turn text only.

### Concrete weaknesses in the code

**Substring matching has no token boundary.** `turnTextContains` calls `String.prototype.includes` on normalized text. Any short quote can hide inside an unrelated word. These cases were executed against the shipped `normalizeEvidence` logic and all return `true`:

| Quoted evidence | Customer message                         | Gate result |
| --------------- | ---------------------------------------- | ----------- |
| `si`            | `siempre lo mismo`                       | passes      |
| `va`            | `¿me lo puedes tener listo para llevar?` | passes      |
| `ya`            | `vaya precio`                            | passes      |
| `a`             | `todavía lo estoy pensando`              | passes      |

The worst case is a real word in a real question. A customer asks `¿sale más caro con leche de almendra?`. The model quotes `sale`. The gate passes, and the bot writes an order in answer to a price question. This is the largest hole in the gate, and it is a two-line fix.

_Fix:_ match on token boundaries. Split both strings into normalized tokens and require the quoted token sequence to appear as a contiguous run. Keep a separate path for a quote that is entirely emoji, so `👍` still passes.

**There is no minimum quote length.** A one-character quote passes against almost any message. Combine a token-boundary check with a floor of two characters, or one token, for non-emoji quotes.

**There is no summary precondition.** `hasDraftCart` proves a cart exists. It does not prove the assistant read the cart and the total back to the customer in the previous turn. The bot can ask "¿algo más?", read "no, ya", quote `ya`, and write an order the customer never priced.

_Fix:_ require that the previous assistant turn contained a priced summary before `confirm_order` may run. The turn already carries `recentMessages`, and `confirm_order` already re-prices, so the data is present. This is the single change with the most source support behind it. Sources: [τ-bench](https://arxiv.org/abs/2406.12045), [Confirmation](https://docs.aws.amazon.com/lexv2/latest/dg/intent-confirm.html).

**The tool schema is not enforced.** `required: ['customer_confirmation']` is advisory without `strict: true`. Anthropic states that the model can omit required fields in that mode. Source: [Strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use). The gate already handles a missing argument defensively, so this is not a live bug. Setting `strict: true` converts a runtime block into a sampling constraint, which removes a re-ask from the customer's path. Haiku 4.5 supports it. Source: [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

**A voice note cannot confirm.** The controller reads only `Body`. Handle inbound media explicitly: reply that the bot cannot hear voice notes and ask for a written confirmation. Do not leave the customer in a silent loop.

**The idempotency key has a fallback that should be an error.** `ctx.turnId ?? ctx.conversationId` degrades to a conversation-wide key. Low probability, high blast radius. Raise instead of falling back.

### What not to change

Do not re-add a confirmation word list on the write path. The sources give no support for it, and the repository has a real incident against it.

Do not add a verifier model. It adds cost and latency to every confirmation, and Anthropic's published verifier still needs deterministic rules under it. Source: [How we built Claude Code auto mode](https://www.anthropic.com/engineering/claude-code-auto-mode).

Do not make the gate ask twice. The CHI data shows a quarter of users leave at the second consecutive non-progress event. Source: [A Conversation Analysis of Non-Progress](https://dl.acm.org/doi/fullHtml/10.1145/3313831.3376209). `MAX_GUARD_FIRES = 4` is generous for a confirmation step. Consider a lower ceiling for this specific gate, with a fall-through that presents the summary again rather than repeating the same question.

Keep the word list where it is. `isStrongConfirmation` still routes replies against a pending clarification. Being wrong there costs one re-ask, not the order. The code comment states this trade-off correctly.

### Alternatives the sources support

**Read-back plus explicit confirmation.** This is the τ-bench rule and the Lex design. It is the strongest available upgrade and it composes with the evidence check.

**A four-value confirmation outcome instead of two.** Lex resolves a reply to Yes, No, Maybe, or Don't know. Source: [AMAZON.Confirmation](https://docs.aws.amazon.com/lexv2/latest/dg/built-in-slot-confirmation.html). Umi has Yes and blocked. A "Maybe" outcome would let the bot answer "quiero cambiar algo" without a block, and a "cannot resolve" outcome would let it present the summary again instead of repeating the question.

**An interactive confirmation control.** WhatsApp supports interactive reply buttons. A button press is an unambiguous, language-free confirmation and it removes the quote problem entirely for the customers who use it. Free text must still work as a fallback. **No primary source was fetched for the Twilio interactive-message API in this report**, so verify availability on the current Twilio WhatsApp sender before you plan this.

**A reversible commit window.** None of the surveyed sources propose this, so mark it as an inference. The gate exists because the write is hard to undo. A short cancel window after the write, surfaced to the customer in the confirmation reply, converts a false commit from a liability into a correction. `cancel_order` already exists and already handles a confirmed order that the kitchen has not started.

## 6. Where the evidence is thin

No primary source documents "quote the user, then verify" as a confirmation gate. The mechanism is borrowed from citation grounding.

No primary source measures false-commit or missed-confirmation rates for a text ordering bot in any language.

No primary source measures keyword confirmation failure for Mexican Spanish or for emoji-only replies.

No first-party technical explanation exists for the McDonald's and IBM wind-down.

No published evaluation was found that compares an evidence gate against a threshold classifier on the same confirmation task.

Two implementation details in this report are unverified against a live system: how Twilio delivers a WhatsApp reaction, and whether the Twilio interactive-message API is available on the current sender.

## Final position

Keep the evidence check. Ship the three fixes: token-boundary matching, a summary precondition, and `strict: true`.

The design is right about the hard part. It moved the semantic decision to the layer that can make it, and kept a deterministic layer that fails by refusing.

Its remaining risk is not the model. It is a substring check that is looser than the design intends, and a gate that proves a cart exists without proving the customer ever saw it.

Re-check after the fixes ship. Log every `blocked_unsafe_confirmation` with the quote and the turn text, and read the first hundred. That log is the only dataset that will tell you which failure mode is actually happening in Mexican Spanish.
