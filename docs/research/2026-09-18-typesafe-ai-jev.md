# TypeSafe AI "Jev": research finding

Date: 2026-09-18. Scope: a third-party decision model for the Umi workspace.

Labels: **documented fact**, **source-backed tradeoff**, **inference**, **UNVERIFIED**.

## Method

- Tool: `curl` 8.5.0 and `python3` 3.12.3, through the workspace research ladder.
- No package installation. This file is the only file change.
- Step 0 answer: a hosted service already does this job. The fallback is a small LLM with structured output, or a classical classifier. Section 9 compares them.

## 1. What Jev is

- **documented fact** Jev is a "System One" decision model. It answers typed questions about a `state`. It returns structured answers. It does not generate text. Source: https://docs.typesafe.ai/concepts/system-one.md
- **documented fact** The endpoint is `POST https://api.typesafe.ai/v1/systemone`. Source: https://docs.typesafe.ai/models.md
- **documented fact** Three question types exist:
  - **Choice**: one option from a list. The list takes up to 255 options. Source: https://docs.typesafe.ai/primitives/choice.md
  - **Score**: a position on ordered levels. The list takes at least 2 levels and at most 10. Source: https://docs.typesafe.ai/primitives/score.md
  - **Noul**: a yes/no judgment. The answer is a probability from 0 to 1. Source: https://docs.typesafe.ai/primitives/noul.md
- **documented fact** One request holds many questions. The model evaluates every question against the same `state`, in parallel. Source: https://docs.typesafe.ai/patterns/fan-out.md
- **documented fact** The number of questions has no fixed limit. The token budget limits it. Source: https://docs.typesafe.ai/primitives.md
- **documented fact** Choice and Score answers carry a `probabilities` map and a `confidence` value. A `confidence` value is a number from 0 to 1. Noul answers carry no `confidence` value. Source: https://docs.typesafe.ai/confidence.md

## 2. Model facts and limits

| Item | Value | Source |
| --- | --- | --- |
| Version | Jev 1.13, id `jev-1.13.0` | https://docs.typesafe.ai/models.md |
| Aliases | `jev-latest` and `jev-preview`, both point to `jev-1.13.0` | https://docs.typesafe.ai/models.md |
| Price | $42 per Btok, or $0.042 per Mtok, input only. Output tokens are free. | https://docs.typesafe.ai/models.md |
| Rate limit | 250,000 tokens per second, and 1,200 requests per minute | https://docs.typesafe.ai/models.md |
| Context | 64k tokens per request, and 32k for `state` plus the longest question | https://docs.typesafe.ai/models.md |
| Input | Text only. A string, a JSON object, or an array of text values. | https://docs.typesafe.ai/models.md |
| Language | English is primary. Other languages have lower accuracy. | https://docs.typesafe.ai/models.md |
| Listing | `GET /v1/models` lists the model names. | https://docs.typesafe.ai/models.md |

- **documented fact** TypeSafe warns that the rate limits "can change without notice" while it adds users. Source: https://docs.typesafe.ai/models.md
- **source-backed tradeoff** The alias `jev-latest` moves when a new release ships. The answers can change with no change on your side. Pin `jev-1.13.0` if a threshold depends on one version. Source: https://docs.typesafe.ai/models.md
- **documented fact** Jev is "not fine-tuned or LoRA-adapted with customer data". The same weights serve every account. Source: https://docs.typesafe.ai/models.md

## 3. Pattern summary

| Page | What the page says |
| --- | --- |
| Use case map | Lists decision shapes: classification, detection, scoring, routing, search, ranking, verification, and extraction. Claims 150 ms speed and 100x cost for two cards. Source: https://docs.typesafe.ai/concepts/use-case-map.md |
| Intent routing | Classifies intent and complexity in one call with `type`, `instructions`, and `criteria`. Routes to a human below `confidence < 0.5`. Source: https://docs.typesafe.ai/patterns/intent-routing.md |
| Confidence routing | Uses a different threshold for each action. A balance check needs 0.6. A transfer needs 0.85. Source: https://docs.typesafe.ai/patterns/confidence-routing.md |
| Speculative fan-out | Sends many questions, including speculative ones, in one call. More questions usually add no latency. Source: https://docs.typesafe.ai/patterns/fan-out.md |
| Composite scoring | Breaks one judgment into atomic Score questions. Code applies the weights. Example: four dimensions, each normalized to 0-1. Source: https://docs.typesafe.ai/patterns/composite-scoring.md |
| Confidence | Defines high, medium, and low ranges. The page advises conservative thresholds at the start. Source: https://docs.typesafe.ai/confidence.md |
| State | Defines `state` as the content under evaluation. All questions see the same state. Source: https://docs.typesafe.ai/concepts/state.md |
| Models | Holds the model ids, the price, and the limits. Source: https://docs.typesafe.ai/models.md |

## 4. Accuracy caveats

The jaggedness page applies to `jev-1.13` and was last reviewed 2026-09-17.
Source for this section: https://docs.typesafe.ai/model-jaggedness/jev-1.13.md

- **documented fact** "It may struggle with tasks that require additional levels of indirection. It can be quite literal in its understanding. It struggles with tasks that require numeric precision."
- **documented fact** "Jev is not a calculator." "`jev-1.13` does not count reliably." "`jev-1.13` reads dates as text, not as ordered quantities."
- **documented fact** "State is data, and `jev-1.13` does not treat it as hostile by default." Injected instructions can move the answer.
- **documented fact** "Jev suffers from context rot, so unrelated material in the `state` costs you accuracy."
- **documented fact** "`jev-1.13` is not trained to generate text."
- **documented fact** The model does not promise structural invariants. One Noul and its negation can sum to 1.19. A Choice threshold does not carry over to a Noul.
- **source-backed tradeoff** The vendor blog says Jev "can't hallucinate". The Master Customer Agreement says the opposite: "THE SERVICES MAY PRODUCE INACCURATE OR ERRONEOUS OUTPUT". Sources: https://typesafe.ai/blog/introducing-system-one-models-and-jev , https://typesafe.ai/legal/mca

## 5. Privacy and data use

**Verdict: Umi may send customer text under the current terms, but not with a zero-retention guarantee on the self-serve plan.**

- **documented fact** Privacy Policy, last updated 2025-11-19: "We will not train or fine tune any artificial intelligence or machine learning models on your prompts or other Input."
- **documented fact** The same policy adds: "We (1) will not train or fine tune any artificial intelligence or machine learning models on Input, and (2) will not disclose any Input to a third party other than our service providers."
- **documented fact** Retention is open: "We retain personal data about you for as long as reasonably necessary to provide you with the Services." The DPA repeats this shape: "as long as necessary taking into account the purpose of the Processing."
- **documented fact** The services are hosted in the United States.
- **documented fact** The DPA makes the customer the controller and TypeSafe the processor. TypeSafe must report a security incident within 72 hours. Subprocessors are public.
- **documented fact** Zero data retention (ZDR) is an enterprise option only: "We also offer zero data retention (ZDR) for enterprise customers."
- **source-backed tradeoff** The Master Customer Agreement lets TypeSafe process "Telemetry" without restriction. Telemetry includes "summary statistics and classifications". The training ban covers model weights only. This is a real limit, but not a training risk.
- **source-backed tradeoff** The liability cap is the greater of 12 months of fees or $50 USD. TypeSafe may delete Customer Data at any time. Source: https://typesafe.ai/legal/mca

Sources: https://typesafe.ai/legal/privacy-policy , https://typesafe.ai/legal/data-processing , https://typesafe.ai/legal , https://typesafe.ai/legal/mca

## 6. Availability

**Verdict: early access, not general availability. Self-serve sign in looks open. Key issuance after login is UNVERIFIED.**

- **documented fact** The home page description says: "Try our first System One Model, Jev, in early access." Source: https://typesafe.ai/
- **documented fact** The launch post says: "Our first public model is Jev, available today in early access." Source: https://typesafe.ai/blog/introducing-system-one-models-and-jev
- **documented fact** The home page header shows "Join Waitlist". The button links to the careers page at `https://jobs.ashbyhq.com/typesafe-ai`. There is no waitlist form at `https://typesafe.ai/waitlist` (404). Source: https://typesafe.ai/
- **documented fact** The console at `https://console.typesafe.ai/` shows "Welcome to TypeSafe", "Continue with Google", and "Email me a code instead". It shows no card field at that step.
- **documented fact** The quickstart says: "Get your API key" from `https://console.typesafe.ai/settings/keys`. Source: https://docs.typesafe.ai/introduction/quickstart.md
- **documented fact** The models page says TypeSafe is "serving a very large volume of demand" while it "let[s] in more users". Source: https://docs.typesafe.ai/models.md
- **UNVERIFIED** Whether a new account receives an API key at once, or waits for approval. This needs an account.
- **UNVERIFIED** Whether a card is required at first key creation. The Master Customer Agreement describes a credits model with purchased credits and promotional credits, but no card step is visible before login.

## 7. Pricing proof

- **documented fact** TypeSafe charges $42 per billion input tokens, or $0.042 per million input tokens. Output tokens are free. Source: https://docs.typesafe.ai/models.md
- **documented fact** OpenAI, per 1M tokens: `gpt-6-astra` input $10.00, `gpt-5.6-luna` input $0.20, `gpt-5-nano` input $0.05. Source: https://platform.openai.com/docs/pricing
- **documented fact** Anthropic, per MTok: Claude Fable 5.1 input $10, Claude Haiku 4.5 input $1. Source: https://platform.claude.com/docs/en/about-claude/pricing
- **inference** The input-price ratio against each model:
  - `gpt-6-astra`: $10.00 / $0.042 = **238x cheaper**.
  - Claude Fable 5.1: $10.00 / $0.042 = **238x cheaper**.
  - `gpt-5.6-sol`: $4.00 / $0.042 = **95x cheaper**.
  - Claude Haiku 4.5: $1.00 / $0.042 = **24x cheaper**.
  - `gpt-5.6-luna`: $0.20 / $0.042 = **4.8x cheaper**.
  - `gpt-5-nano`: $0.05 / $0.042 = **1.19x cheaper**.
- **inference** The token-saving claim holds against frontier models. Against the cheapest nano models the input price is nearly equal. The comparison is input-only, and it favors Jev further because Jev output tokens are free.
- **documented fact** The home page makes its own claims: "238x Lower input price than Claude Fable 5.1" and "193.6x Faster, 444.6x Cheaper" on workflows. Source: https://typesafe.ai/
- **documented fact** The launch post states the comparison basis: LLM "Input tokens: from $0.20 to $10 / MTok" and output tokens "~5x more expensive than input tokens". Source: https://typesafe.ai/blog/introducing-system-one-models-and-jev

## 8. Independent evidence for the token-saving claim

- **source-backed tradeoff** The strongest independent token measurement does **not** support a token-count reduction. "Hackers in the Loop" measured Qwen 3.8 27B on Cerebras against Jev on 2026-09-17. Qwen used 305,915 input / 5,185 output tokens. Jev used 297,984 input / 43,836 output tokens. Input tokens were about equal. Output tokens were about 8.5x higher. Cost was $0.310581 against $0.011919, or about 26x lower. The cost win comes from the free-output price, not from fewer tokens. Source: https://github.com/iammrduncan/typesafe-ai-benchmark
- **source-backed tradeoff** The repository says it is "an independent benchmark, not a TypeSafe implementation or parity claim". It does not disclose funding or affiliation. Treat the result as independent but not audited.
- **source-backed tradeoff** lindfors.no tested 24 Norwegian documents on 2026-09-18. Cost per 1,000 documents: Jev $0.22, DeepSeek V4.1 Flash $1.31 without reasoning, and $3.08 with reasoning. Agreement on stance and arguments was about equal. The sample is small. The 95 percent interval on the stance number is about 15 points. Jev also got one item wrong. Source: https://lindfors.no/blog/a-first-look-at-typesafes-jev/
- **source-backed tradeoff** groundcover tested 10,000 synthetic traces. Jev cost $0.782 in 17m03s. OpenAI Luna cost $2.717 in 82m12s. Status accuracy was 99.81% against 99.55%. Sentiment accuracy was 91.27% against 99.50%, so Luna was better on one task. Source: https://fatliverfreddy.substack.com/p/a-different-kind-of-model-for-ai
- **source-backed tradeoff** The Hacker News launch thread has 1,885 points. Commenters criticize the missing public benchmarks. Source: https://news.ycombinator.com/item?id=49717558
- **documented fact** The Master Customer Agreement forbids a customer to "publish benchmarks or performance information about the Services". This clause limits independent measurement. Source: https://typesafe.ai/legal/mca
- **documented fact** X is not usable here. `https://x.com/search?q=typesafe.ai` returned the JavaScript shell with no result text. Per-tweet `publish.twitter.com/oembed` calls did return post text.
- **inference** The saving is a price change, not a token change. Size the saving with the input token count, not with a "token reduction".

## 9. Two alternatives for the same job

- **Small LLM with structured output.** The OpenAI API accepts a JSON schema and returns a validated object. The `gpt-5-nano` input price is $0.05 per Mtok and the output price is $0.40 per Mtok. **Source-backed tradeoff**: this path is flexible and can also write text. It charges for output tokens, it needs one call per question or one long instruction, and its probabilities are not calibrated by design. Source: https://platform.openai.com/docs/guides/structured-outputs , https://platform.openai.com/docs/pricing
- **Classical classifier.** A logistic regression or a gradient-boosted model gives a label and a probability. Scikit-learn supplies probability calibration methods. **Source-backed tradeoff**: this path is cheap, fast, deterministic, and auditable. It needs labeled training data and feature work, and it cannot judge free text without a model. Source: https://scikit-learn.org/stable/modules/calibration.html
- **inference** For Umi, a small LLM with structured output is the closest fallback for open-ended text. A classical classifier is the stronger choice for a stable, high-volume label with labeled data.

## 10. Not verified

- **UNVERIFIED** The API key grant step and the card requirement for a new account.
- **UNVERIFIED** A public independent benchmark that reproduces a token-count reduction.
- **UNVERIFIED** The exact response of the SDK packages to a production load.
- **documented fact** The Python package `typesafe-ai` on PyPI is a different project. The project states: "This package is not affiliated with TypeSafe AI." Install `typesafe-sdk` instead. Source: https://pypi.org/pypi/typesafe-ai/json
- **documented fact** npm has two TypeSafe packages. `@typesafe-ai/sdk` 0.6.0 is the client SDK (MIT). `@ai-sdk/typesafe-ai` 3.0.3 is the Vercel AI SDK provider (Apache-2.0). Source: https://registry.npmjs.org/@typesafe-ai/sdk , https://registry.npmjs.org/@ai-sdk/typesafe-ai

## 11. Sources

- Docs index: https://docs.typesafe.ai/llms.txt
- Models: https://docs.typesafe.ai/models.md
- Quickstart: https://docs.typesafe.ai/introduction/quickstart.md
- Primitives: https://docs.typesafe.ai/primitives.md
- Jaggedness: https://docs.typesafe.ai/model-jaggedness/jev-1.13.md
- Legal index: https://docs.typesafe.ai/legal.md
- Privacy Policy: https://typesafe.ai/legal/privacy-policy
- Data Processing Addendum: https://typesafe.ai/legal/data-processing
- Master Customer Agreement: https://typesafe.ai/legal/mca
- Launch post: https://typesafe.ai/blog/introducing-system-one-models-and-jev
- OpenAI pricing: https://platform.openai.com/docs/pricing
- Anthropic pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Independent benchmark: https://github.com/iammrduncan/typesafe-ai-benchmark
- Independent test: https://lindfors.no/blog/a-first-look-at-typesafes-jev/
- Independent test: https://fatliverfreddy.substack.com/p/a-different-kind-of-model-for-ai
- Press: https://www.theregister.com/ai-and-ml/2026/09/16/typesafe-ai-debuts-model-for-machines-that-plays-doom/5296711/
