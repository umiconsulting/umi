# Anthropic-style skill architecture

## Why this structure
Anthropic's current guidance is to keep the simplest working system, use skills as small folders of reusable procedural knowledge, and use agents only when tasks need dynamic judgment or delegation. This scaffold applies that directly.

## Layout
- `CLAUDE.md`: durable repo facts and engineering rules.
- `.claude/skills/`: reusable task procedures.
- `.claude/agents/`: open-ended specialist roles.
- `docs/`: concise design notes that should not bloat skills.

## Design choices
- `task-router` exists because picking the right mechanism is itself a recurring task.
- `create-skill` exists to keep future skills small, consistent, and non-duplicative, but it should run only after promotion evidence exists.
- `swiftui-kds-standards` captures local iPad KDS rules without mixing them into every future skill.
- `ios-architect` is a subagent because architecture is mostly judgment, not procedure.
- `skill-curator` is a subagent because skill taxonomy degrades unless one role owns it.
- `routing-ledger`, `promotion-criteria`, and `node-resolver` keep the system self-evolving without letting raw requests mutate the architecture directly.

## Skill vs agent rule
- Use a skill when the path is known.
- Use an agent when the path must be discovered.
- Use direct implementation when neither adds value.
- Promote successful repeated traces into explicit versioned artifacts instead of treating every gap as a new skill.

## Sources
- Anthropic: Building Effective AI Agents.
- Anthropic: Equipping agents for the real world with Agent Skills.
- Claude Code Docs: Extend Claude with skills.
- Claude Code Docs: Create custom subagents.

## Next steps
1. Add real routing-ledger entries as new tasks are completed.
2. Keep `CLAUDE.md` factual and short.
3. Do not create a new skill until the promotion criteria pass.
4. Review the registry whenever two skills start to overlap or confidence is low.
