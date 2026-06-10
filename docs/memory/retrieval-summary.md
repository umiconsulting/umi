# Memory Retrieval Summary

## Current workspace pattern

- Root docs act as durable workspace memory.
- Repo `AGENTS.md` files act as local operating memory.
- Reports act as historical episodic memory.
- Traces act as operational evidence memory.
- Runtime memory implementation lives primarily in ConversaFlow.

## Default agent behavior

1. Use root and repo contracts for current rules.
2. Use reports for evidence, not automatic truth.
3. Use traces for concrete runtime behavior.
4. Use memory implementation files only when changing runtime memory.

## Risk

The main memory risk is treating contextual memory, stale reports, or adapter instructions as source-of-truth operational state. The retrieval map and authority hierarchy exist to prevent that.
