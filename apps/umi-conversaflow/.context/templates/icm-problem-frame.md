# Interpretable Context Methodology

This template converts a messy issue discussion into a compact, explicit problem frame for downstream agents.

Use it before design or implementation work.

## How To Use

1. Fill this from evidence, not intuition.
2. Prefer one concrete scenario over broad summaries.
3. Mark unknowns clearly.
4. Keep the root problem independent from the proposed solution.
5. Pass this document, not the full chat history, to downstream agents.

---

# Problem Frame

## Observed Context

- Product or workflow:
- User or operator type:
- Entry channel:
- Relevant subsystem:
- Current behavior:
- Expected behavior:

## Scenario Timeline

Describe the sequence that exposes the issue.

Example format:

```text
t=0   user sends first message
t=1   user sends follow-up fragment
t=2   webhook enqueues processing job
t=3   newer message arrives
t=4   stale job still executes
```

## Symptoms

- User-visible symptom:
- Internal symptom:
- Frequency or pattern:
- Trigger conditions:

## Evidence

- Observed fact:
- Observed fact:
- Unknown:
- Unknown:

## Hypotheses

- Hypothesis A:
- Hypothesis B:
- Hypothesis C:

## Rejected Hypotheses

- Rejected hypothesis:
  Reason:
- Rejected hypothesis:
  Reason:

## Root Problem

State the primary structural problem in one short paragraph.

Rules:

- describe the broken system behavior
- avoid naming the fix
- identify the layer where the problem actually lives

## System Boundary

- In scope:
- Out of scope:
- Closest owning module or layer:

## Required Invariants

- Invariant:
- Invariant:
- Invariant:

## Non-Goals

- This work is not trying to:
- This work is not trying to:

## Handoff Context

### For Software Designer

- Decision surface:
- Main tradeoffs:
- Constraints to respect:

### For Architect Or Critic

- Risks to review:
- Coupling or data concerns:
- Concurrency or consistency concerns:

### For Developer

- Behaviors to preserve:
- Behaviors to change:
- Acceptance signals:
