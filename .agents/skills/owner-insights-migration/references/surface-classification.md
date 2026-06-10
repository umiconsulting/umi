# Logs To Dashboard Surface Classification

Use this inventory format when moving or reviewing Logs surfaces.

```md
| Logs surface | Target | Classification | Owner-safe data | Hidden/internal data | Action |
| --- | --- | --- | --- | --- | --- |
| Customers list | Dashboard Customers | owner-facing | name, phone, last touch, product badges, attention state | raw trace IDs | move/adapt |
```

## Classification Rules

- Owner-facing: helps a merchant understand customer state, sales/support work, integration health, memory quality, or an action to take.
- Admin-gated: useful for a tenant admin but sensitive enough to require role checks or configuration context.
- Internal-only: requires raw traces, service-role access, prompt/tool internals, provider payloads, security forensics, or synthetic eval details.

## Default Mapping

| Logs source | Dashboard destination | Default classification |
| --- | --- | --- |
| Customers list | Customers list | owner-facing |
| Customer detail | Customer profile | owner-facing with Data tab constraints |
| Conversation detail | WhatsApp tab or conversation route | owner-facing, diagnostics collapsed |
| Memory Health | Insights > Memory Health | owner-facing summary, admin details gated |
| Voyage health | Insights or Settings > Integrations | owner-facing health, raw payloads internal |
| WhatsApp integration health | Insights or Settings > Integrations | owner-facing health, reconnect actions |
| Edge trace browser | Logs only | internal-only |
| AI turn internals | Logs only | internal-only |
| Security/prompt-injection views | Logs only | internal-only |

## Acceptance Checks

- No Dashboard browser route requires service-role secrets.
- Every owner metric links to rows or an action.
- Logs retains raw debugging capability after the owner-safe view is moved.
- Labels describe owner impact, not backend implementation.
