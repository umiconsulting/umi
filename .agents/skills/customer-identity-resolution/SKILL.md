---
name: customer-identity-resolution
description: "Resolve Umi customer identities across products using tenant-scoped phone and WhatsApp matching. Use when working on customer unification, phone normalization, Customer 360, contact identity, merge candidates, Cash/WhatsApp matching, platform.contacts, platform.contact_identities, or customer identity data-quality checks."
---

# Customer Identity Resolution

## Overview

Use this skill to plan or implement safe customer identity resolution across Umi products. It keeps canonical customer identity in `platform.contacts` and `platform.contact_identities`, while product repos keep their own write models.

## Workflow

1. Inspect the current product sources before designing a join:
   - Dashboard consumption: `apps/umi-dashboard`
   - ConversaFlow customers, WhatsApp conversations, messages, memory, and runtime normalization: `apps/umi-conversaflow`
   - Cash loyalty, wallet, passes, and Cash-local customer behavior: `apps/umi-cash`
   - Root migration or local PostgreSQL target docs: root `docs/migration`
2. Identify the write owner and read owner:
   - Put runtime phone normalization and WhatsApp/customer matching near ConversaFlow when it affects WhatsApp ingestion, memory, conversations, orders, or backend jobs.
   - Put loyalty-only behavior in Cash.
   - Put cross-product canonical identity in `platform.contacts` and `platform.contact_identities`.
   - Put Dashboard adapters in `apps/umi-dashboard`; do not let Dashboard become the identity write model.
3. Normalize phone values explicitly:
   - Strip separators and formatting noise.
   - Preserve country code when present.
   - Store one `normalized_value` for matching and an owner-readable display value for UI.
   - Treat WhatsApp IDs as an identity type, not a separate customer source.
4. Classify matches:
   - Exact: same `tenant_id`, identity type in `phone` or `whatsapp`, same normalized value, no conflicting verified contact.
   - Missing: no usable phone or WhatsApp identity; create a data-quality finding or fallback-only record.
   - Ambiguous: shared phone, conflicting verified identities, malformed numbers that collapse together, or multiple product-local records with the same normalized value.
5. Never silently merge ambiguous identities. Create or plan `platform.contact_merge_candidates` rows with evidence, confidence, source records, and owner/admin review status.
6. Produce validation SQL before claiming success. Start from `references/validation-sql.md`, then adapt table and column names to the current repo/schema.
7. Record assumptions as:
   - documented fact from current schema/code
   - source-backed tradeoff from the migration plan or official docs
   - Umi-specific inference

## Output Checklist

- State the canonical owner for each field being added or matched.
- State the matching rule, normalization rule, and ambiguity rule.
- Include overlap counts: Cash-only, WhatsApp-only, both, missing phone, duplicate candidates.
- Include rollback or no-op behavior for environments without `platform.contacts`.
- Keep sensitive runtime details and service-role diagnostics out of Dashboard-facing responses.

## References

- Read `references/validation-sql.md` when producing identity overlap reports, duplicate checks, or cutover validation queries.
