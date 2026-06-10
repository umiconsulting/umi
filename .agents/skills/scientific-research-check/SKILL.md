---
name: scientific-research-check
description: Validate architecture, schema, backend, realtime, performance, and scaling decisions against official documentation and, when relevant, academic or primary technical research.
---

# Scientific Research Check

Use this skill before locking in a structural technical recommendation.

## Use when
- choosing between app logic and backend logic
- deciding schema design or ownership
- evaluating realtime or eventing approaches
- making performance or scalability claims
- considering a new repo, service, or infrastructure boundary
- documenting a “best” technical approach

## Rules
- Prefer official product or platform documentation first.
- Prefer primary technical sources over blogs or generic summaries.
- If the issue is performance-sensitive or architectural, add academic or primary technical research when it materially strengthens the decision.
- Separate three layers explicitly:
  - documented fact
  - source-backed tradeoff
  - Umi-specific inference
- Reject popularity as a reason by itself.
- If the evidence is weak or mixed, say so and narrow the claim.

## Output
Return:
- question being decided
- primary sources checked
- facts established by sources
- relevant tradeoffs
- Umi-specific conclusion
- criteria that would invalidate the conclusion later
