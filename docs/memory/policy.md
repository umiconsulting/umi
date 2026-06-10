# Memory Policy

Memory is a cognitive substrate, not automatically operational truth.

## Workspace memory

Workspace memory consists of contracts, maps, reports, eval indexes, trace indexes, and repo context files. It guides retrieval and agent behavior.

## Runtime memory

Runtime memory belongs to the repo that executes it. ConversaFlow owns customer/conversation memory implementation, memory shaping, embeddings, summaries, facts, and semantic retrieval for its workflow.

## Rules

- Do not use memory as a substitute for source-of-truth operational state.
- Memory writes must be auditable when they affect future behavior.
- Memory failures should be safe where runtime code can continue without losing operational truth.
- Cross-repo memory policy belongs in root docs; runtime memory implementation remains local.

## Retrieval

Agents should load memory policy before changing memory semantics, then load the owning repo's implementation and tests.
