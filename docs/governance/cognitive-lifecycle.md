# Cognitive Lifecycle

This lifecycle keeps experiments, diagnostics, reports, workflows, skills, and governed infrastructure distinct.

## States

- Experiment: exploratory code, notes, or prompts with no authority.
- Diagnostic: repeatable inspection with documented inputs, outputs, and side-effect level.
- Report: dated finding with evidence, status, and links back to code or docs.
- Workflow: repeatable procedure with prerequisites, commands, expected result, and failure handling.
- Skill: a reusable workflow packaged for agent discovery and narrow invocation.
- Governed infrastructure: shared, indexed, owned, maintained, and safe for broad reuse.
- Historical: retained for audit or context, excluded from default retrieval.

## Promotion path

```text
experiment -> diagnostic -> report -> workflow -> skill -> governed infrastructure
```

## Promotion criteria

- Repeated at least twice or expected to recur.
- Has a clear owner and bounded scope.
- Has a validation command, report, or observable success condition.
- Has explicit safety level.
- Has a retrieval entrypoint.
- Is more useful as a shared artifact than as local repo context.

## Retention

- Current artifacts should have an index or latest pointer.
- Historical artifacts should remain discoverable but not default-loaded.
- Superseded artifacts should name the replacement when known.
