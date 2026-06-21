# Slack Admin Plan

> **Superseded (2026-04):** The `slack-actions` Supabase Edge Function was removed from the codebase. Operational admin and kitchen flows use the native KDS app (`apps/umi-kds`) connected to the ConversaFlow backend. The remainder of this document is historical unless revised.

## Goal

Use the existing Slack app as the operational admin surface for business settings, so non-developers can update live business information without code changes or redeploys.

Slack is the control panel.
Supabase remains the source of truth.
The WhatsApp runtime reads settings live from Supabase.

## Why This Exists

Recent conversation analysis showed that the assistant needs reliable operational data for:

- hours and WhatsApp order cutoff
- address and location details
- payment methods
- temporary operational notices
- enabling or pausing WhatsApp ordering

These settings should not depend on developer-managed prompt text or hardcoded values.

## Prior Analysis Summary

### Customer demand from recent conversations

The highest-value customer jobs are:

1. quick reorder
2. create and edit order
3. ask operational questions
4. browse menu
5. cancel or recover from a partially completed flow

Operational questions are frequent enough that business config must be authoritative and easy to update.

### Current system state

Good:

- existing Slack app already posts and updates order messages
- interactive kitchen and admin flows use the native KDS app (`apps/umi-kds`) against the backend (the former `slack-actions` Edge Function was removed)
- `businesses.config` already stores real business data like `hours`, `address`, `payment_methods`, `whatsapp`
- WhatsApp handler now reads business config for hours/info instead of relying only on prompt text

Gaps:

- no Slack admin flow for business settings
- operational changes still require developer/manual DB intervention
- no lightweight admin UI for address, hours, payment methods, WhatsApp ordering availability, temporary notices
- no explicit audit trail for config changes

## Recommended Product Shape

Do not build a separate dashboard first.

Build a Slack-first admin workflow on top of the existing Slack app:

1. Slack shortcut or App Home entrypoint opens a business settings modal
2. Modal reads current values from `public.businesses.config`
3. Modal submission writes back to Supabase
4. WhatsApp handler uses updated config immediately

This solves the real ops problem with the smallest surface area.

## Scope for V1

Manage these fields from Slack:

- `config.address`
- `config.whatsapp`
- `config.payment_methods`
- `config.hours`
- `config.accepts_whatsapp_orders`
- `config.special_notice`

### Runtime behavior required

- if `accepts_whatsapp_orders = false`, the bot must refuse order creation and explain that WhatsApp orders are temporarily paused
- if `special_notice` exists, it should be included in business info/hours responses where appropriate
- hours and cutoff logic must always come from `config.hours`

## Architecture

### Source of truth

- Supabase table: `public.businesses`
- column: `config JSONB`

### Admin surface

- existing Slack app
- KDS (`apps/umi-kds`) and backend APIs for interactive flows (no `slack-actions` Edge Function)

### Runtime readers

- `supabase/functions/whatsapp-handler/business-hours.ts`
- `supabase/functions/whatsapp-handler/index.ts`
- `supabase/functions/whatsapp-handler/tools.ts`

## Recommended UX

### V1 entrypoint

Use a global Slack shortcut:

- name: `Edit Business Settings`
- callback: `open_business_settings`

Reason:

- fastest to ship
- reuses current Slack interactivity model
- no App Home event plumbing needed for the first version

### V1 modal fields

- address
- WhatsApp number
- payment methods as comma-separated input
- one input per day for hours using `HH:MM-HH:MM` or `closed`
- checkbox: accept WhatsApp orders
- multiline temporary notice

### Future improvements

- App Home summary view
- richer day-by-day hour inputs
- multiple locations/branches
- per-channel settings
- early close / temporary closure presets

## Implementation Plan

### Phase 1 — Slack Settings Modal

Files:

- `supabase/functions/_shared/slack.ts`
- `apps/umi-kds` (KDS) for operator UI and actions against the backend
- `config/slack/slack-app-manifest.json`

Tasks:

1. Add a modal builder for business settings in `_shared/slack.ts` (or equivalent UI in KDS)
2. Wire interactive flows from KDS to the backend (no `slack-actions` handler)
3. On shortcut open, fetch `businesses.config` and prefill the modal
4. On modal submission, parse and validate values
5. Update `public.businesses.config`

Success criteria:

- Slack shortcut opens modal
- modal saves config successfully
- no developer intervention needed for normal ops edits

### Phase 2 — Runtime Adoption

Files:

- `supabase/functions/whatsapp-handler/business-hours.ts`
- `supabase/functions/whatsapp-handler/index.ts`
- `supabase/functions/whatsapp-handler/tools.ts`

Tasks:

1. Read `accepts_whatsapp_orders` from config
2. Block order creation when disabled
3. Read `special_notice` from config
4. Inject `special_notice` into business info/hours responses where useful
5. Ensure all hour/cutoff logic uses `config.hours`

Success criteria:

- Slack changes affect live runtime behavior
- no stale hardcoded hours remain in behavior paths

### Phase 3 — Permissions and Audit

Files:

- `apps/umi-kds` (KDS) and backend authorization for operator actions
- new migration or audit mechanism as needed

Tasks:

1. Restrict settings modal to approved Slack user IDs
2. Add audit logging for config changes
3. Store who changed what and when

Recommended shape:

- env var: `SLACK_ADMIN_USER_IDS`
- table: `business_config_changes`

Success criteria:

- only authorized operators can modify settings
- all config changes are traceable

### Phase 4 — App Home Mini-Dashboard

Optional after V1 works.

Use Slack App Home as a read-only summary page with:

- current WhatsApp ordering status
- today’s hours and cutoff
- current address
- payment methods
- special notice
- shortcut/button to edit settings

## Validation Rules

### Hours input

Accepted:

- `07:00-19:00`
- `08:00-14:00`
- `closed`

Reject:

- malformed time strings
- close earlier than open
- blank weekday entries unless explicitly intended

### Payment methods

Normalize to lowercase array:

- `cash`
- `card`
- `transfer`

### WhatsApp ordering enabled

Boolean only.
Must affect runtime order acceptance.

## Risks

### Risk 1 — Config JSON becomes too crowded

Mitigation:

- keep V1 in `config`
- if admin surface expands, move to structured settings tables later

### Risk 2 — Unauthorized Slack updates

Mitigation:

- add Slack user allowlist before production rollout

### Risk 3 — Slack modal validation too weak

Mitigation:

- strict parser for hours
- reject invalid submissions early

### Risk 4 — Runtime mismatch

Mitigation:

- keep one shared reader for business config
- never duplicate hours/business info in prompt text

## Recommended Execution Order

1. finish Slack modal + submission handling
2. update manifest with shortcut and interactivity
3. wire runtime to `accepts_whatsapp_orders` and `special_notice`
4. test by changing hours/address/payments from Slack
5. add permissions and audit
6. optionally add App Home mini-dashboard

## Concrete Deliverables

V1 done means:

- Slack shortcut opens a settings modal
- settings save to `public.businesses.config`
- WhatsApp handler reflects updated settings live
- no developer needs to manually edit business info for routine changes

## Notes for MCP Agent

The other agent should inspect these files first:

- `/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-kds`
- `/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/_shared/slack.ts`
- `/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/whatsapp-handler/business-hours.ts`
- `/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/whatsapp-handler/index.ts`
- `/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/whatsapp-handler/tools.ts`
- `/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/config/slack/slack-app-manifest.json`

The agent should treat `public.businesses.config` as the current canonical storage layer for V1.
