# Cash Visit Source Comparison - 2026-05-15

## Scope

Compared latest `Visit` metadata available without exposing customer/staff data or secrets.

The separate `umi-cash` Supabase project was queried through the production Vercel environment after authenticating the Vercel CLI. No database passwords, URLs, customer identifiers, card identifiers, staff identifiers, or notes are recorded here.

## Sources Checked

### Umi Platform live database

Connection source:

- `apps/umi-conversaflow/.env`
- project ref `xbudknbimkgjjgohnjgp`
- schema `umi_cash`

Query:

```sql
select count(*) as visits, max("scannedAt") as latest_visit
from umi_cash."Visit";
```

Result:

```txt
visits: 31
latest_visit: 2026-04-16 01:42:52.204+00
```

Latest 5 visit timestamps:

```txt
2026-04-16 01:42:52.204+00
2026-04-15 18:35:13.355+00
2026-04-15 18:28:16.197+00
2026-04-15 02:32:13.588+00
2026-04-15 02:31:57.942+00
```

### Desktop dump restored locally

Database:

- `umi_platform_and_cash_full_local`
- schema `umi_cash`

Result:

```txt
visits: 31
latest_visit: 2026-04-15 18:42:52.204-07
```

This is the same instant as `2026-04-16 01:42:52.204+00`, displayed in local timezone.

Latest 5 visit timestamps:

```txt
2026-04-15 18:42:52.204-07
2026-04-15 11:35:13.355-07
2026-04-15 11:28:16.197-07
2026-04-14 19:32:13.588-07
2026-04-14 19:31:57.942-07
```

## Current Cash Repo Env

The local Cash repo files:

- `apps/umi-cash/.env`
- `apps/umi-cash/.env.local`

both point to:

```txt
project_ref: xbudknbimkgjjgohnjgp
database: postgres
schema: umi_cash
```

This means local Cash configuration points at Umi Platform, not the separate `umi-cash` project.

## Separate umi-cash Project

Supabase project list confirms the separate project exists:

```txt
umi-cash: rrkzhisnadfrgnhntkiz
Umi Platform: xbudknbimkgjjgohnjgp
```

Attempting to connect to `rrkzhisnadfrgnhntkiz` with the Umi Platform DB password failed with password authentication failure, as expected.

### Production Vercel environment

Connection source:

- Vercel team `umiconsulting-dev's projects`
- Vercel project `umi-cash`
- production env pulled to `/tmp/umi-cash-vercel-production.env`

Safe database URL metadata:

```txt
DATABASE_URL project_ref: rrkzhisnadfrgnhntkiz
DATABASE_URL host: aws-0-us-west-2.pooler.supabase.com
DATABASE_URL database: postgres
DATABASE_URL schema query parameter: none
```

The production database has `public."Visit"`:

```sql
select count(*) as visits,
       max("scannedAt") as latest_visit,
       min("scannedAt") as earliest_visit
from public."Visit";
```

Result:

```txt
visits: 174
earliest_visit: 2026-03-13 22:50:14.812
latest_visit: 2026-05-15 17:08:55.422
```

## Conclusion

The Desktop dump and live Umi Platform `umi_cash` schema contain the same latest Cash visit horizon:

```txt
latest visit: 2026-04-16 01:42:52.204 UTC
visit count: 31
```

The active production `umi-cash` database has a later and larger visit stream:

```txt
latest visit: 2026-05-15 17:08:55.422
visit count: 174
```

Therefore the Desktop dump does not contain the active production Cash database. It contains the Umi Platform project's copied `umi_cash` schema only.

## Operational Note

The local `apps/umi-cash/.env.local` file and `.vercel/` link directory are gitignored. They may contain local Vercel development values and should not be committed or used as migration evidence. Production comparison evidence should come from the `/tmp` env pull or Vercel project settings.
