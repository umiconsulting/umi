# Conversation Routing Config

Backend-readable tenant config for the natural-conversation routing pipeline.

## `businesses.config.conversation_routing`

```json
{
  "mode": "shadow | authoritative"
}
```

- `shadow`: compatibility label during rollout; runtime still follows the deterministic planner path
- `authoritative`: deterministic intent -> planner -> tool execution -> tool-less voice narration

If the field is absent, runtime defaults to `authoritative`.

## `businesses.config.voice`

```json
{
  "assistant_name": "string",
  "locale": "string",
  "tone": "string",
  "style_notes": ["string"]
}
```

- `assistant_name`, `locale`, and `tone` are required when `conversation_routing.mode = "authoritative"`
- `style_notes` is optional
- authoritative mode must fail loudly when this block is missing or incomplete
