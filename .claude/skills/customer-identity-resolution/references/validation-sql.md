# Customer Identity Validation SQL

Use these as starting points. Confirm table and column names in the current schema before running.

## Identity Coverage

```sql
select
  count(*) as contacts,
  count(*) filter (where phone is not null and phone <> '') as contacts_with_phone
from platform.contacts;

select
  identity_type,
  verification_status,
  count(*) as rows
from platform.contact_identities
group by identity_type, verification_status
order by identity_type, verification_status;
```

## Duplicate Identity Candidates

```sql
select
  tenant_id,
  identity_type,
  normalized_value,
  count(distinct contact_id) as contact_count
from platform.contact_identities
where identity_type in ('phone', 'whatsapp')
  and normalized_value is not null
group by tenant_id, identity_type, normalized_value
having count(distinct contact_id) > 1
order by contact_count desc, tenant_id, normalized_value;
```

## Product Overlap By Phone

```sql
with phones as (
  select
    c.tenant_id,
    ci.normalized_value,
    bool_or(ci.identity_type = 'whatsapp') as has_whatsapp,
    bool_or(cash_account.id is not null) as has_cash
  from platform.contacts c
  join platform.contact_identities ci on ci.contact_id = c.id
  left join cash.loyalty_accounts cash_account on cash_account.contact_id = c.id
  where ci.identity_type in ('phone', 'whatsapp')
    and ci.normalized_value is not null
  group by c.tenant_id, ci.normalized_value
)
select
  count(*) filter (where has_whatsapp and has_cash) as whatsapp_and_cash,
  count(*) filter (where has_whatsapp and not has_cash) as whatsapp_only,
  count(*) filter (where has_cash and not has_whatsapp) as cash_only
from phones;
```

## Conversation Linkage

```sql
select
  count(*) as conversations,
  count(*) filter (where contact_id is not null) as linked_to_contact,
  count(*) filter (where contact_id is null) as missing_contact
from conversaflow.conversations;
```

## Review Rule

Any query that returns duplicate verified identities, shared normalized phones, or conflicting product-local records should feed `platform.contact_merge_candidates` or `observability.data_quality_findings`; do not convert it directly into destructive merges.
