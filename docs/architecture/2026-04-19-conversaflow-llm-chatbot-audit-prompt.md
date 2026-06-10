# ConversaFlow LLM Chatbot Audit Prompt

> Date: 2026-04-19 Scope: `apps/umi-conversaflow`
> Purpose: source-backed audit prompt for system-wide architecture review and
> implementation planning

## Why this exists

ConversaFlow currently mixes:

- LLM interpretation
- deterministic routing
- backend commit guardrails
- retrieval/memory
- conversational UX

The highest-risk question is not whether determinism is useful. It is **where**
determinism belongs.

This document packages the current research basis plus a reusable audit prompt
so another model can inspect the system and produce a credible implementation
plan instead of generic agent advice.

## Research Basis

### 1. Tool selection should be model-driven, while execution stays guarded

Documented fact:

- Anthropic’s tool docs say to use detailed tool definitions, shape responses to
  high-signal fields, and control tool availability with `tool_choice` rather
  than brittle prompt-only orchestration.
- Anthropic also documents that tool use works best when tool descriptions
  explain what the tool does, when it should be used, and when it should not.
- OpenAI’s current agent guidance says to standardize tools, start with a single
  agent, and only split further when prompt logic or tool overlap makes one
  agent unreliable.

Source-backed tradeoff:

- Deterministic orchestration is still valuable at commit points and for risk
  gating.
- Hardcoding conversational normalization or long routing trees in front of the
  model reduces adaptability to ambiguity, slang, multilingual variation, and
  context carry-over.

Umi-specific inference:

- In ConversaFlow, the planner should not be the primary conversational
  decision-maker for natural chat turns. Its useful role is pre-execution
  validation, tool gating, and fallback.

### 2. Hardcoded normalization does not scale across language, dialect, or slang

Documented fact:

- Anthropic’s multilingual guidance states that Claude has strong cross-lingual
  performance and specifically recommends prompting for idiomatic native-speaker
  behavior when fluency matters.
- The same guidance shows strong relative multilingual performance for Spanish
  and other languages, which supports using the model to interpret colloquial
  user language instead of relying on finite phrase lists.

Source-backed tradeoff:

- Rules can patch a known failure quickly.
- But hardcoded phrase normalization has unbounded maintenance cost and weak
  recall in multilingual or dialect-heavy settings.

Umi-specific inference:

- Mexican-Spanish WhatsApp ordering language is too variable for whitelist
  confirmation handling to remain correct over time.

### 3. Retrieval and memory should ground the model, not be isolated from planning

Documented fact:

- Anthropic’s consistency guidance recommends retrieval to ground chatbot
  responses in a fixed information set.
- Current agent-evaluation literature treats planning, tool use,
  self-reflection, and memory as core agent capabilities that must be evaluated
  together rather than in isolation.
- Recent agent-memory research points out that multi-turn failures often come
  from linear, unstructured context that causes hallucinations, repeated
  actions, and misread revisions.

Source-backed tradeoff:

- More memory and retrieval can improve contextual continuity.
- But irrelevant or weakly-scored retrieval adds noise, so memory should be
  bounded, observable, and evaluated with real multi-turn traces.

Umi-specific inference:

- In ConversaFlow, conversation summary, recent messages, semantic recall, draft
  cart, and pending order-change context should influence the same planning
  surface, not separate extractor/voice silos.

### 4. UX quality depends on structured clarification and coherent turn repair

Documented fact:

- Google’s recent conversational UX research found that proactive clarifying
  questions can make interactions more helpful, relevant, and tailored than
  one-shot answers, but only when those questions are well-targeted and clearly
  surfaced.
- The same research reports that engagement drops when clarifying questions are
  poorly formulated, irrelevant, or buried inside long answers.

Source-backed tradeoff:

- Asking questions is good when the system truly needs missing information.
- Asking clarification as a generic fallback is harmful when the user intent is
  already recoverable from context.

Umi-specific inference:

- ConversaFlow should distinguish between:
  - true missing operational data
  - user revisions
  - browse intent
  - contextual confirmation
  - recoverable reference resolution

### 5. Evaluation must be multi-turn, customer-oriented, and failure-driven

Documented fact:

- Current evaluation research for tool-augmented conversational agents shows
  that models can do well on single interactions while still failing complete
  conversations.
- The ALMITA-style evaluation approach emphasizes grounded multi-turn tests with
  broad coverage of realistic conversation paths.
- Agent-evaluation survey work highlights remaining gaps in cost-efficiency,
  safety, robustness, and fine-grained evaluation.

Source-backed tradeoff:

- Single-turn intent accuracy is easy to measure.
- But customer harm in commerce systems usually appears in multi-turn failures:
  dropped modifications, incoherent confirmations, state drift, and repeated
  clarification loops.

Umi-specific inference:

- ConversaFlow’s audit should prioritize turn-sequence outcomes over isolated
  classifier accuracy.

### 6. Guardrails should be layered and risk-weighted, not conversationally overfitted

Documented fact:

- OpenAI’s current agent safety guidance recommends layered guardrails, explicit
  policy examples, and tool safeguards based on tool risk such as reversibility,
  write access, and financial impact.
- It also recommends constraining which tools are available in a given context
  rather than relying only on prompt wording.

Source-backed tradeoff:

- Strong safety controls are necessary for order confirmation, cancellation,
  payments, and external side effects.
- But over-constraining low-risk conversational planning with rigid workflow
  branches can degrade UX and hide model competence.

Umi-specific inference:

- ConversaFlow should keep strict deterministic controls on write paths and
  external side effects, while relaxing deterministic control over
  conversational interpretation.

## Audit Dimensions

Any credible audit of this backend should inspect and score at least these
dimensions:

1. Conversational planning architecture
2. Tool surface design and tool descriptions
3. Deterministic guardrails vs conversational flexibility
4. Memory and retrieval integration
5. Multilingual, slang, and dialect handling
6. Clarification and repair UX
7. State management and revision handling
8. Customer-harm failure modes in multi-turn flows
9. Observability, tracing, and eval readiness
10. Migration design, rollout safety, and rollback

## Required Local Context

An auditor should inspect at minimum:

- root [AGENTS.md](/Users/juanlopez1/Documents/Repositories/Umi/AGENTS.md:1)
- [docs/architecture/agent-operating-system.md](/Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/agent-operating-system.md:1)
- local
  [apps/umi-conversaflow/AGENTS.md](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/AGENTS.md:1)
- [apps/umi-conversaflow/supabase/functions/job-worker/processors/turn-process.ts](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/job-worker/processors/turn-process.ts:1)
- [apps/umi-conversaflow/supabase/functions/job-worker/processors/planner.ts](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/job-worker/processors/planner.ts:1)
- [apps/umi-conversaflow/supabase/functions/job-worker/processors/harness.ts](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/job-worker/processors/harness.ts:1)
- [apps/umi-conversaflow/supabase/functions/whatsapp-handler/intent-extractor.ts](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/whatsapp-handler/intent-extractor.ts:1)
- [apps/umi-conversaflow/supabase/functions/whatsapp-handler/prompts.ts](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/whatsapp-handler/prompts.ts:1)
- [apps/umi-conversaflow/supabase/functions/whatsapp-handler/tools.ts](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/whatsapp-handler/tools.ts:1)
- [apps/umi-conversaflow/supabase/functions/_shared/memory.ts](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/_shared/memory.ts:1)
- [apps/umi-conversaflow/supabase/functions/_shared/business-config.ts](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/_shared/business-config.ts:1)
- [apps/umi-conversaflow/supabase/functions/_shared/logger.ts](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/_shared/logger.ts:1)

If database access is available, the audit should also inspect recent rows from:

- `conversaflow.conversation_turns`
- `conversaflow.messages`
- `conversaflow.ai_turn_logs`
- `conversaflow.pipeline_traces`
- `conversaflow.conversations`
- `conversaflow.products`
- `public.businesses`

## Audit Prompt

Use the prompt below as the auditor instruction.

```text
You are conducting a system-wide architecture, UX, and customer-harm audit of the ConversaFlow backend in the Umi workspace.

Your job is not to give generic chatbot advice. Your job is to inspect the actual code and, if available, the actual database traces, then produce a source-backed implementation plan.

You must follow these operating rules:

1. Read workspace instructions first.
   - Read root AGENTS.md
   - Read docs/architecture/agent-operating-system.md
   - Read apps/umi-conversaflow/AGENTS.md

2. Inspect the current implementation before concluding anything.
   At minimum inspect:
   - apps/umi-conversaflow/supabase/functions/job-worker/processors/turn-process.ts
   - apps/umi-conversaflow/supabase/functions/job-worker/processors/planner.ts
   - apps/umi-conversaflow/supabase/functions/job-worker/processors/harness.ts
   - apps/umi-conversaflow/supabase/functions/whatsapp-handler/intent-extractor.ts
   - apps/umi-conversaflow/supabase/functions/whatsapp-handler/prompts.ts
   - apps/umi-conversaflow/supabase/functions/whatsapp-handler/tools.ts
   - apps/umi-conversaflow/supabase/functions/_shared/memory.ts
   - apps/umi-conversaflow/supabase/functions/_shared/business-config.ts
   - apps/umi-conversaflow/supabase/functions/_shared/logger.ts

3. If database access is available, inspect recent production evidence.
   Prefer:
   - recent conversation_turns
   - recent messages
   - ai_turn_logs grouped by exit_reason and failure patterns
   - pipeline_traces
   - conversations with pending_clarification, draft_cart, and state transitions
   - product embedding coverage and business config

4. Use current primary sources, not stale intuition.
   For claims about LLM chatbot architecture, tool use, multilingual behavior, memory, safety, and UX:
   - prefer official Anthropic / OpenAI docs
   - use primary academic or technical research where it materially improves confidence
   - explicitly separate:
     - documented fact
     - source-backed tradeoff
     - Umi-specific inference

5. Audit the system against these questions:
   A. Conversational planning
   - Is the system using the model for conversation understanding, or compressing meaning into brittle deterministic categories first?
   - Is hardcoded normalization being used where the model should handle multilingual, dialect, slang, revision, and contextual reference resolution?
   - Does the current architecture resemble NLU -> dialog manager -> NLG more than a modern tool-using agent?

   B. Tooling and orchestration
   - Are tools defined clearly enough for model-driven selection?
   - Are overlapping tools or weak descriptions causing routing ambiguity?
   - Which decisions should remain deterministic guardrails, and which should move to model-driven tool selection?
   - Should the system stay single-agent, or is there evidence it needs multi-agent decomposition?

   C. Memory and retrieval
   - Is recent history, summary, customer facts, semantic retrieval, draft-cart context, and pending-order-change context available to the same reasoning surface?
   - Is retrieval actually active in production?
   - Are retrieval thresholds, gating, or missing secrets making the design ineffective?
   - Is the system robust to user corrections like “el cappuccino también grande”, “quiero otra cosa”, “hazlo mejor frío”, or “lo mismo de siempre”?

   D. UX and customer experience
   - Are clarifying questions targeted and necessary, or generic fallback behavior?
   - Are questions phrased in a way that matches real conversational UX best practice?
   - Does the system preserve a coherent customer narrative across multi-turn flows?
   - Which current behaviors create customer-visible confusion, dropped intent, repetition, or contradiction?

   E. Safety and control
   - Are high-risk actions such as order confirmation, cancellation, pricing, payment-adjacent actions, and external side effects protected by deterministic validation?
   - Are tool restrictions context-sensitive?
   - Are there state hallucination risks, stale context risks, or prompt-injection paths?

   F. Evaluation and rollout
   - Is the system evaluated at the multi-turn conversation level, not just single-turn intent extraction?
   - What new evals, traces, and success metrics are required?
   - What migration path is lowest-risk?

6. Do not produce a shallow “rewrite everything as an agent” answer.
   You must:
   - identify what should stay exactly as-is
   - identify what should be removed
   - identify what should be simplified
   - identify what should move to config
   - identify what should move to model-driven behavior
   - identify what should move to stronger deterministic guardrails

7. Your output must be structured exactly like this:

   1. Executive conclusion
   2. Evidence of customer harm or customer risk
   3. Current architecture map
   4. What determinism is helping
   5. What determinism is hurting
   6. Memory and retrieval findings
   7. Multilingual / slang / dialect findings
   8. UX findings
   9. Recommended target architecture
   10. Keep / remove / simplify / move-to-config / move-to-model / move-to-guardrail tables
   11. Migration plan by phases
   12. Risks and rollback strategy
   13. Success metrics
   14. Evidence appendix

8. For every major recommendation:
   - include the affected file(s) or DB object(s)
   - classify the recommendation as documented fact, source-backed tradeoff, or Umi-specific inference
   - explain why the recommendation improves customer experience, engineering reliability, or both

9. Your migration plan must be implementation-grade.
   It must specify:
   - immediate fixes
   - shadow-mode steps
   - promotion criteria
   - observability additions
   - rollback path
   - which owner should make each change

10. Optimize for operational reality.
   This is a multi-tenant production backend for WhatsApp ordering, not a toy agent demo.
   Preserve:
   - durability
   - outbox patterns
   - job-worker architecture
   - authoritative write paths
   - KDS verification
   - business-hours enforcement
   - price revalidation
   - state version OCC
   unless you have direct evidence they should change.

Your standard is:
- scientific in evidence
- pragmatic in architecture
- explicit about tradeoffs
- grounded in customer outcomes
- concrete enough to implement
```

## How to Use It

Use this prompt when you want an LLM to produce a serious architecture audit
rather than a brainstorm.

Recommended workflow:

1. Give the model repository access.
2. Give it database read access if possible.
3. Ask it to browse official docs for current tool-use, safety, memory, and
   multilingual guidance.
4. Require the exact output structure above.
5. Compare its recommendations against current owner boundaries in Umi before
   implementation.

## Expected Good Output

A good output should:

- identify where deterministic logic is genuinely valuable
- identify where deterministic conversational routing is harming UX
- distinguish quick patches from architectural corrections
- propose a migration path that preserves backend truth and operational
  guardrails
- treat multilingual and slang handling as a model/context/tooling problem, not
  a phrase-list problem
- propose multi-turn evaluation, not just intent accuracy

## Expected Bad Output

Reject the audit if it:

- recommends “use an agent” without inspecting current code
- ignores tool descriptions and tool-surface quality
- ignores retrieval activation and observability
- fails to distinguish customer-facing planning from backend commit validation
- proposes a new repo or service without explicit justification
- confuses prompt style with architecture

## Sources

- Anthropic, Define tools:
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
- Anthropic, Multilingual support:
  https://platform.claude.com/docs/en/build-with-claude/multilingual-support
- Anthropic, Increase output consistency:
  https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/increase-consistency
- OpenAI, Using GPT-5.4 / tools guidance:
  https://developers.openai.com/api/docs/guides/latest-model
- OpenAI, Safety in building agents:
  https://developers.openai.com/api/docs/guides/agent-builder-safety
- OpenAI, A practical guide to building AI agents:
  https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- Arcadinho et al., Automated test generation to evaluate tool-augmented LLMs as
  conversational AI agents: https://arxiv.org/abs/2409.15934
- Yehudai et al., Survey on Evaluation of LLM-based Agents:
  https://arxiv.org/abs/2503.16416
- Ye, Task Memory Engine: Spatial Memory for Robust Multi-Step LLM Agents:
  https://arxiv.org/abs/2505.19436
- Google Research, Towards better health conversations:
  https://research.google/blog/towards-better-health-conversations-research-insights-on-a-wayfinding-ai-agent-based-on-gemini/
