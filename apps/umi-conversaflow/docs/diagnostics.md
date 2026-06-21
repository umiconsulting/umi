# ConversaFlow Diagnostics

Diagnostics are operational tools, not canonical runtime code.

## Locations

- `scripts/diagnostics/`
- `scripts/inspect_trace.ts`
- `sql/`
- `reports/`

## Safety classes

- Read-only trace/query scripts: generally safe with proper env handling.
- Service-role scripts: require care and should not print secrets.
- Repair or mutation scripts: require human approval before live execution.

## Promotion

Repeated diagnostics should be documented here, linked to a report, and promoted to a workflow or skill only after they prove reusable.
