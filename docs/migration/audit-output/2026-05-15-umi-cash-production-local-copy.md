# Umi Cash Production Local Copy - 2026-05-15

## Scope

Copied the active production `umi-cash` Supabase database into a new local PostgreSQL database without dropping or overwriting any existing local database.

No database URLs, passwords, customer identifiers, card identifiers, staff identifiers, or notes are recorded here.

## Source

- Vercel team: `umiconsulting-dev's projects`
- Vercel project: `umi-cash`
- Supabase project ref: `rrkzhisnadfrgnhntkiz`
- Source schema copied: `public`
- Production env pull location: `/tmp/umi-cash-vercel-production.env`

## Local Target

- Local database: `umi_cash_production_local_20260515`
- Local dump artifact: `/tmp/umi-cash-production-public-20260515.dump`
- Restore mode: additive into a newly created local database
- Existing local databases were not dropped, cleaned, or overwritten.

## Restore Notes

The first restore pass loaded tables, data, constraints, indexes, row security flags, and foreign keys. It reported local compatibility errors for:

- `CREATE SCHEMA public`, because a fresh local PostgreSQL database already has `public`.
- Supabase policies targeting role `postgres`, because the local cluster did not have that role.

Resolution:

- Created local role `postgres` as `NOLOGIN`.
- Replayed only the `POLICY` entries from the dump.
- Final local policy count in schema `public`: `11`.

## Table Count Validation

```txt
table,source_count,local_count,status
ApplePushToken,188,188,ok
BirthdayReward,0,0,ok
GiftCard,1,1,ok
Location,3,3,ok
LoyaltyCard,208,208,ok
OtpVerification,167,167,ok
RewardConfig,15,15,ok
RewardRedemption,6,6,ok
Session,255,255,ok
Tenant,4,4,ok
Transaction,5,5,ok
User,214,214,ok
Visit,174,174,ok
_prisma_migrations,15,15,ok
```

## Visit Freshness Check

```txt
visits: 174
earliest_visit: 2026-03-13 22:50:14.812
latest_visit: 2026-05-15 17:08:55.422
```

## User Role Profile

```txt
role,Cash users,with_phone,with_email
ADMIN,4,0,4
CUSTOMER,208,208,0
STAFF,2,0,2
```

## Contact Overlap Signal

Compared active Cash production customer phones against raw active Umi Platform ConversaFlow customer phones without recording phone values.

Important caveat: the ConversaFlow side is a raw source count. It includes possible test, mini-harness, and v2 synthetic eval contacts. It is not yet a production-clean customer count.

```txt
cash_phone_rows: 208
cash_normalized_unique: 206
conversaflow_phone_rows: 536
conversaflow_normalized_unique: 536
exact_normalized_overlap: 0
last10_overlap: 3
```

Additional ConversaFlow aggregate signals:

```txt
conversaflow_customers_total: 536
customers_with_any_user_twilio_sid: 100
customers_without_user_twilio_sid: 436
customers_with_eval_trace: 7
customers_with_recent_no_twilio_voyage_user_msg: 37
```

Supersession note: the later refreshed local Umi Platform copy used for execution showed `customers_with_recent_no_twilio_voyage_user_msg: 0`, `synthetic_eval: 7`, `production_verified: 93`, and `unknown: 436`. Use `2026-05-15-transition-plan-execution-phase-review.md` for the executed classification.

## Conclusion

The active production Cash database has been copied locally into `umi_cash_production_local_20260515`. This is distinct from:

- `umi_platform_and_cash_full_local`, which contains the older Umi Platform copied `umi_cash` schema.
- `umi_supabase_dump_local`, the earlier restored dump audit database.
