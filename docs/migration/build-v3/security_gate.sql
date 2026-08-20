-- ============================================================================
-- build-v3 · security_gate.sql — RUNNABLE prod gate (2026-07-12)
-- Asserts the locally-verifiable half of SECURITY_GATE.md against a built DB.
-- Fails loudly (nonzero exit) on any regression so CI/cutover can BLOCK on it.
--   usage:  PGPORT=5233 psql -v ON_ERROR_STOP=1 -d umi_backfill_v3 -f security_gate.sql
-- Deployment-only gates (TLS verify-full, SCRAM login verifiers, pg_hba, FDW
-- remnants, secret rotation, pooler SET-LOCAL) live in SECURITY_GATE.md.
-- ============================================================================
\set ON_ERROR_STOP on

create temp table gate(label text, status text);

-- ----------------------------------------------------------------------------
-- THE REQUEST-PATH LOGIN ROLES. Three D10 checks read this set. It was written
-- out three times, and the name list is the part most likely to drift.
--
-- A NOLOGIN group role connects to nothing, so it logs nothing.
--
-- ⚠️ READ THIS LIMIT BEFORE YOU TRUST A D10 PASS. A SQL gate cannot see which
-- role a pool actually connects as. It can only judge names. Production's worker
-- pool connects as `postgres`, which is a superuser and is in no list here, so
-- these three checks would report PASS and never measure it.
--
-- `poolLoggingProblem` in `apps/umi-api/src/shared/database/pg.service.ts` is
-- the check that closes this gap. It runs at boot, on the role the pool really
-- connected as, and it aborts. Treat that one as authoritative and these three
-- as the schema-side companion.
--
-- A superuser named here is NOT skipped. D1 says the request path is never a
-- superuser, so its presence is a defect, and a skipped role reads as a green
-- one.
-- ----------------------------------------------------------------------------
create temp view request_path_role as
select r.oid, r.rolname, r.rolsuper
  from pg_roles r
 where r.rolcanlogin
   and (r.rolname in ('api_login', 'worker_login', 'umi_app', 'umi_worker')
        or (not r.rolsuper and (pg_has_role(r.oid, 'api', 'usage')
                                or pg_has_role(r.oid, 'worker', 'usage'))));
insert into gate
select * from (values
  -- RLS enablement & FORCE ---------------------------------------------------
  ('merchant: every base table RLS+FORCE',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end from pg_class c
       join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='merchant' and c.relkind='r'
         and not (c.relrowsecurity and c.relforcerowsecurity))),
  -- Four, not five: umi.user_role became a PLATFORM-only grant with no merchant_id to
  -- scope a policy by. It is sealed the way umi.audit_log is — ungranted to api — and a
  -- table the request path cannot reach needs no policy.
  ('umi per-café tables RLS+FORCE (4)',
    (select case when count(*)=4 then 'PASS' else 'FAIL' end from pg_class c
       join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='umi' and c.relrowsecurity and c.relforcerowsecurity
         and c.relname in ('subscription','subscription_item','invoice','entitlement_override'))),
  -- `api` only. `readonly` is not the request path: it holds the same blanket SELECT on
  -- umi that lets it read subscription and invoice, and sealing this one table from it
  -- would buy nothing and diverge from every other per-café table.
  ('umi.user_role sealed from the request path',
    (select case when not has_table_privilege('api', 'umi.user_role', 'SELECT')
                 then 'PASS' else 'FAIL' end)),
  -- At most ONE platform grant may live forever: the bootstrap. Every other one is
  -- expected to carry an expiry. seed_rbac.sql documents the retirement step that
  -- time-boxes even that one, once a second administrator exists.
  ('at most 1 unbounded platform grant (the bootstrap)',
    (select case when count(*) <= 1 then 'PASS' else 'FAIL' end from umi.user_role
       where expires_at is null and revoked_at is null)),
  -- The composite FK should make this unreachable. Asserted anyway: the FK is the kind
  -- of thing a later migration drops without noticing what it was for.
  ('0 café roles granted platform-wide',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end
       from umi.user_role ur join umi.role r on r.id = ur.role_id
      where not r.is_platform)),
  -- The wildcard is gone from roles.ts, so authority is whatever the catalog says.
  -- A super_admin holding nothing would lock Umi out of its own platform.
  ('super_admin holds every permission key',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end
       from umi.permission p
      where not exists (
        select 1 from umi.role_permission rp join umi.role r on r.id = rp.role_id
         where rp.permission_id = p.id and r.key = 'super_admin'))),
  -- The break-glass table. `api` must hold NO privilege on it — not SELECT, and above
  -- all not INSERT. A request path that can write its own elevation record can elevate
  -- itself, which would make every other check in this file cosmetic. Checked as a
  -- sweep over all four DML verbs, not just SELECT, because INSERT is the dangerous one
  -- and a SELECT-only assertion would pass while the hole was open.
  ('umi.access_grant sealed from the request path (no DML, no read)',
    (select case when bool_and(not has_table_privilege('api', 'umi.access_grant', v))
                 then 'PASS' else 'FAIL' end
       from (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) as t(v))),
  -- A break-glass grant with no end is a standing wildcard wearing a different name.
  -- expires_at is NOT NULL in the DDL, so this can only fail if someone relaxes it.
  ('0 break-glass grants without an expiry',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end
       from umi.access_grant where expires_at is null)),
  -- Both halves of the reason must be present. The DDL says NOT NULL; this catches the
  -- other failure — a writer that satisfies NOT NULL with an empty string.
  ('every break-glass grant cites a reference and a justification',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end
       from umi.access_grant
      where btrim(coalesce(reference, '')) = ''
         or btrim(coalesce(justification, '')) = '')),
  -- MFA is what stands between one stolen password and every café. A platform grant
  -- holder without a second factor is the single highest-value account in the system
  -- protected by the weakest possible control.
  --
  -- THIS ROW FLIPS ITSELF. It used to carry an instruction to a person: "change
  -- WARN back to FAIL when the MFA module ships". The module shipped, and the
  -- instruction was still there. A control that waits for somebody to remember is
  -- not a control.
  --
  -- The three states, and why each one is right:
  --
  --   PASS  Every live platform grant holder holds a second factor. Nothing to say.
  --         A target with no grant holder also passes: there is nothing to protect.
  --   FAIL  SOME holder is enrolled and another is not. Enrolment demonstrably
  --         works on this very target, so the gap is a choice.
  --   WARN  NO holder is enrolled anywhere. The rollout has not started.
  --
  -- WARN, and not FAIL, for that last state. A check that stays red on every run
  -- makes people skip the whole file. That costs more than this check gives.
  --
  -- ⚠️ Enrol the FIRST platform grant holder only after a client can read
  -- `mfaRequired`. `POST /api/auth/local/login` returns a challenge and NO session
  -- for an enrolled account. An older client stores nothing, and that account
  -- cannot sign in. The dashboard reads the field as of PR #103.
  --
  -- One stolen password otherwise reaches every café. A platform grant holder is
  -- the highest-value account in the system.
  ('every live platform grant holder has a second factor',
    (select case
       when count(*) filter (where mfa_method is null) = 0 then 'PASS'
       when count(*) filter (where mfa_method is not null) > 0 then 'FAIL'
       else 'WARN' end
       from (
         select distinct u.id, u.mfa_method
           from umi.user_role ur
           join umi.user u on u.id = ur.user_id
          where ur.revoked_at is null
            and (ur.expires_at is null or ur.expires_at > now())
       ) holder)),
  -- PCI DSS 10.2.2 lists six fields. These are the two that were missing from the
  -- platform audit tables; the other four were always present.
  ('audit tables carry outcome + request_id (PCI DSS 10.2.2)',
    (select case when count(*)=4 then 'PASS' else 'FAIL' end
       from information_schema.columns
      where (table_schema, table_name) in (('umi','audit_log'), ('merchant','audit_log'))
        and column_name in ('outcome','request_id'))),
  -- The column that keeps the acting operator distinct from the account they acted
  -- through. Asserted before any impersonation feature exists, because the cost of
  -- adding it to a hash-chained table later is a rehash of every row.
  ('merchant audit tables carry delegate_user_id',
    (select case when count(*)=2 then 'PASS' else 'FAIL' end
       from information_schema.columns
      where table_schema = 'merchant'
        and table_name in ('audit_log','audit_event')
        and column_name = 'delegate_user_id')),
  -- Derived columns must be genuinely un-writable by the request path. This check
  -- exists because 90_rls asserted it with a statement that does nothing:
  -- `revoke update (col)` is a no-op while api holds table-level UPDATE, so the
  -- much-commented "UNFORGEABLE" guard on contact.normalized_value never bound.
  ('api cannot UPDATE derived columns (normalized_value, business_date)',
    (select case when bool_and(not has_column_privilege('api', t, c, 'UPDATE'))
                 then 'PASS' else 'FAIL' end
       from (values ('merchant.contact','normalized_value'),
                    ('merchant.customer_order','business_date'),
                    ('merchant.pos_cart','business_date')) as v(t,c))),
  -- SWEPT, not listed. This was a hardcoded pair of table names, so every runtime
  -- table added to the request path afterwards was invisible to it: the check passed
  -- while the new tables went unchecked. Stated as a universal instead — if a runtime
  -- row belongs to a merchant and the request path can touch it, it is isolated.
  -- Deliberate exceptions carry no merchant_id and are therefore not matched:
  -- idempotency_key (a global dedup key) and product_embedding (isolation comes from
  -- the join to merchant.product, which is under RLS).
  ('every api-reachable runtime table with merchant_id has RLS+FORCE',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'runtime' and c.relkind = 'r'
         and exists (select 1 from information_schema.columns col
                      where col.table_schema='runtime' and col.table_name=c.relname
                        and col.column_name='merchant_id')
         and exists (select 1 from information_schema.role_table_grants g
                      where g.table_schema='runtime' and g.table_name=c.relname
                        and g.grantee='api')
         and not (c.relrowsecurity and c.relforcerowsecurity))),
  -- Views: security_invoker -------------------------------------------------
  -- EVERY view in umi/merchant must enforce the caller's RLS. An owner-rights view
  -- leaks cross-merchant (the audit reproduced this on conversation_analytics: 0
  -- base rows, 11 cross-merchant view rows). Assert none is missing the option —
  -- count-agnostic, so adding a view (order_total/order_ticket) can't silently pass.
  ('every umi/merchant view is security_invoker',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end from pg_class c
       join pg_namespace n on n.oid=c.relnamespace
       where c.relkind='v' and n.nspname in ('umi','merchant')
         and not (coalesce(c.reloptions,'{}') @> array['security_invoker=true']))),
  -- The invoker check is count-agnostic, so it can't notice a contract view being
  -- dropped. Assert the two order projections that consumers depend on still exist.
  ('build-v3 order views exist (order_total, order_ticket)',
    (select case when count(*)=2 then 'PASS' else 'FAIL' end from pg_class c
       join pg_namespace n on n.oid=c.relnamespace
       where c.relkind='v' and n.nspname='merchant'
         and c.relname in ('order_total','order_ticket'))),
  ('api holds no DML on any view',
    (select case when bool_or(has_table_privilege('api',c.oid,'insert')
                           or has_table_privilege('api',c.oid,'update')
                           or has_table_privilege('api',c.oid,'delete')) then 'FAIL' else 'PASS' end
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where c.relkind='v' and n.nspname in ('umi','merchant'))),
  -- Credentials never on the request path -----------------------------------
  ('api CANNOT read umi.user.password_hash',
    case when has_column_privilege('api','umi.user','password_hash','select') then 'FAIL' else 'PASS' end),
  ('api CANNOT read umi.user.password_salt',
    case when has_column_privilege('api','umi.user','password_salt','select') then 'FAIL' else 'PASS' end),
  ('readonly CANNOT read umi.user.password_hash',
    case when has_column_privilege('readonly','umi.user','password_hash','select') then 'FAIL' else 'PASS' end),
  ('api CAN read umi.user.email (identity col)',
    case when has_column_privilege('api','umi.user','email','select') then 'PASS' else 'FAIL' end),
  -- Auth substrate off the request path -------------------------------------
  ('api has ZERO privilege on runtime auth tables',
    (select case when bool_or(p) then 'FAIL' else 'PASS' end from (
       select has_table_privilege('api','runtime.'||t, 'select,insert,update,delete') p
       from unnest(array['session','otp','password_reset_token','pairing']) t) x)),
  ('readonly CANNOT read runtime auth tables',
    (select case when bool_or(p) then 'FAIL' else 'PASS' end from (
       select has_table_privilege('readonly','runtime.'||t,'select') p
       from unnest(array['session','otp','password_reset_token']) t) x)),
  ('api CANNOT read umi.prospect / umi.audit_log',
    case when has_table_privilege('api','umi.prospect','select')
           or has_table_privilege('api','umi.audit_log','select') then 'FAIL' else 'PASS' end),
  -- Role posture ------------------------------------------------------------
  ('api is NOT superuser / NOT bypassrls',
    (select case when rolsuper or rolbypassrls then 'FAIL' else 'PASS' end from pg_roles where rolname='api')),
  ('worker IS bypassrls (machinery)',
    (select case when rolbypassrls then 'PASS' else 'FAIL' end from pg_roles where rolname='worker')),
  -- Least privilege on future objects ---------------------------------------
  ('no api/worker* default ACL leaks (api locked)',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end from pg_default_acl d
       join pg_namespace n on n.oid=d.defaclnamespace
       where n.nspname in ('umi','merchant','runtime')
         and array_to_string(d.defaclacl,',') ~ '(^|,)api=')),
  -- public schema hardening -------------------------------------------------
  ('PUBLIC cannot CREATE in schema public',
    case when has_schema_privilege('public','public','create') then 'FAIL' else 'PASS' end),
  -- D7 · extensions (SECURITY_GATE.md §4) -----------------------------------
  -- Asserted by PLACEMENT and CAPABILITY, not as a fixed list of names. §4 used to
  -- name an exact set — {plpgsql, vector, pg_trgm} — which was already wrong: the
  -- database also carries pgcrypto, uuid-ossp, pg_stat_statements and (since the
  -- location search) unaccent. A frozen allowlist rots on the first legitimate
  -- addition and then gets ignored, which is worse than no check.
  ('no extension installed outside pg_catalog/extensions',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end
       from pg_extension e join pg_namespace n on n.oid = e.extnamespace
      where n.nspname not in ('pg_catalog','extensions'))),
  -- These reach OUT of the database — the network, the filesystem, or a shell. None
  -- has a use in build-v3, and postgres_fdw is the one P7's replay installs on
  -- purpose and must remove afterwards (D8).
  ('no network/exec-capable extension installed',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end from pg_extension
      where extname in ('postgres_fdw','dblink','file_fdw','plpythonu','plpython3u',
                        'plperlu','pltclu','plsh','adminpack'))),
  ('api/worker have USAGE but NOT CREATE on extensions',
    (select case
       when bool_and(has_schema_privilege(r,'extensions','usage'))
        and not bool_or(has_schema_privilege(r,'extensions','create')) then 'PASS' else 'FAIL' end
       from unnest(array['api','worker']) r)),
  -- D8 · no FDW remnants (SECURITY_GATE.md §4) ------------------------------
  -- P7 backfills prod through postgres_fdw. A foreign server EMBEDS the source
  -- credentials in the target database, and a user mapping holds the password. Left
  -- behind, the migration tool becomes a permanent unaudited path back to the source.
  -- Zero today; the check earns its place the moment the replay runs.
  -- ⚠ Reads pg_user_mappingS (the VIEW), not pg_user_mapping (the CATALOG).
  -- PUBLIC cannot SELECT the catalog: has_table_privilege('public',
  -- 'pg_catalog.pg_user_mapping','select') is false, and the Supabase `postgres`
  -- role is NOT a superuser. Under ON_ERROR_STOP=1 the catalog form aborts the
  -- whole file with "permission denied", so the gate reports NOTHING — not a
  -- FAIL — and never reaches the summary. The view is readable by anyone and
  -- hides only the option values, which this check does not read.
  ('0 foreign servers / user mappings / FDWs remain',
    (select case when (select count(*) from pg_foreign_server)
                    + (select count(*) from pg_user_mappings)
                    + (select count(*) from pg_foreign_data_wrapper) = 0
                then 'PASS' else 'FAIL' end)),
  -- D10 · request-path log redaction (SECURITY_GATE.md §4) ------------------
  -- Session tokens, OTP hashes, reset tokens and merchant ids all travel as BOUND
  -- PARAMETERS. Every grant in this file is undone if those land in a log file that
  -- nobody put under the same access control as the table they came from.
  -- Assert the property, NOT one particular way of satisfying it. An earlier version
  -- of this check demanded a cluster-wide `log_statement = none`, and it was wrong:
  -- production runs `ddl`, deliberately, because the DDL trail is how an unauthorised
  -- schema change gets noticed. `ddl` logs no DML and no SELECT, so it leaks no
  -- request-path parameter. What actually matters is that the roles the REQUEST PATH
  -- connects as never log statements — satisfied by a cluster `none`, or by a per-role
  -- `none` (the pattern Supabase itself applies to supabase_admin / _auth_admin /
  -- _storage_admin, and now to umi_app / umi_worker).
  ('request-path roles never log statements',
    (select case
       when count(*) filter (where not silenced) = 0 and count(*) > 0 then 'PASS'
       when count(*) = 0 then 'WARN'   -- no request-path role present to judge
       else 'FAIL' end
       from (
         select r.rolname,
                not r.rolsuper                       -- a superuser here is a D1 defect
                and ((select setting from pg_settings where name='log_statement') = 'none'
                  or exists (
                    select 1 from pg_db_role_setting s
                     where s.setrole = r.oid
                       and array_to_string(s.setconfig, ',') ~ 'log_statement=none'
                  )) as silenced
           from request_path_role r
       ) x)),
  -- A cluster-wide 'none' is undone by one `ALTER ROLE api SET log_statement = 'all'`,
  -- which is invisible in pg_settings when read as anyone else.
  ('no role-level override re-enables statement logging',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end
       from pg_db_role_setting s
       left join pg_roles r on r.oid = s.setrole
      where array_to_string(s.setconfig, ',') ~ 'log_statement=(all|mod|ddl)'
        and (r.rolname is null or r.rolname in ('api','worker','readonly',
                                                'api_login','worker_login',
                                                'umi_app','umi_worker')))),
  -- WARN, NOT FAIL — and deliberately so. -1 means "log bind parameters IN FULL",
  -- the PostgreSQL default.
  --
  -- ⚠️ DO NOT read the check above as covering this one. `log_statement` and
  -- `log_min_duration_statement` are INDEPENDENT triggers. Silencing the first does
  -- nothing about the second: one `log_min_duration_statement = 500ms` — the most
  -- ordinary thing anyone does while debugging a slow production incident — logs the
  -- request path's statements again, bind parameters and all. Session tokens, OTP
  -- hashes and reset tokens all travel as bound parameters.
  --
  -- ⚠️ SUPERUSER-GATED ON SUPABASE. Verified 2026-08-06 on xbudk as `postgres`:
  -- `ALTER DATABASE postgres SET log_parameter_max_length = 0` → permission denied,
  -- while `ALTER ROLE … SET log_statement` on the same cluster SUCCEEDS. PostgreSQL 15+
  -- `GRANT SET ON PARAMETER` is what differs; read `pg_parameter_acl` to see which
  -- parameters the platform actually permits. If this one is ungrantable, pin
  -- `log_min_duration_statement = -1` per request-path role instead — that closes the
  -- real path and is BETTER than the global setting, being scoped to the request path.
  --
  -- The check accepts EITHER placement. A role-level `ALTER ROLE … SET` overrides
  -- the cluster default for that role's sessions, so a pin on every request-path
  -- role is equivalent for those sessions and NARROWER than the global setting.
  -- `apps/umi-api/db/roles/004_buildv3_login_roles.sql` applies the role-level pin
  -- and reports, per role, what a managed target refused.
  ('bind parameters are never logged (log_parameter_max_length = 0)',
    (select case
       when (select setting from pg_settings where name='log_parameter_max_length') = '0'
         then 'PASS'
       -- COUNT the roles, never `not exists`. `not exists (… role without the
       -- pin …)` is TRUE when the set is empty. An unprovisioned target then
       -- reads PASS, and nothing was measured. Require one role at least.
       when (select count(*) filter (where not pinned) = 0 and count(*) > 0 from (
               select not r.rolsuper and exists (
                        select 1 from pg_db_role_setting s
                         where s.setrole = r.oid
                           and array_to_string(s.setconfig, ',') ~ 'log_parameter_max_length=0'
                      ) as pinned
                 from request_path_role r
             ) x)
         then 'PASS'
       else 'WARN' end)),
  -- The independent trigger named above. PASS when duration logging is off entirely,
  -- or pinned off for every request-path role.
  ('request-path roles are not exposed to duration-based logging',
    (select case
       when (select setting from pg_settings where name='log_min_duration_statement') = '-1'
         then 'PASS'
       -- Same counting rule as the check above. An unprovisioned target must not
       -- read as PASS.
       when (select count(*) filter (where not pinned) = 0 and count(*) > 0 from (
               select not r.rolsuper and exists (
                        select 1 from pg_db_role_setting s
                         where s.setrole = r.oid
                           and array_to_string(s.setconfig, ',') ~ 'log_min_duration_statement=-1'
                      ) as pinned
                 from request_path_role r
             ) x)
         then 'PASS'
       else 'WARN' end)),
  -- D5 · SCRAM on the login roles (SECURITY_GATE.md §4) ----------------------
  -- The verifier lives in `pg_shadow.passwd`, and its first characters name the
  -- method. `pg_shadow` has NO `passwdtype` column; the document named one and
  -- the written method could not run.
  --
  -- Only a superuser reads `pg_shadow`. A managed target reports SKIP, which the
  -- summary names. Unmeasured is never approved.
  --
  -- A role with no password cannot connect, so it is not a weak credential and
  -- it does not fail this check. `004_buildv3_login_roles.sql` reports it.
  ('every request-path login role holds a SCRAM verifier (no md5)',
    (select case
       when not has_table_privilege(current_user, 'pg_shadow', 'select') then 'SKIP'
       when (select count(*) from request_path_role) = 0 then 'SKIP'
       when exists (
         select 1 from pg_shadow s
          join request_path_role r on r.rolname = s.usename
         where s.passwd is not null and s.passwd not like 'SCRAM-SHA-256$%'
       ) then 'FAIL'
       else 'PASS' end)),
  ('bind parameters are never logged on error',
    (select case when setting = '0' then 'PASS' else 'FAIL' end
       from pg_settings where name = 'log_parameter_max_length_on_error')),
  -- Append-only audit --------------------------------------------------------
  ('no role holds UPDATE/DELETE on audit_log',
    (select case when bool_or(p) then 'FAIL' else 'PASS' end from (
       select has_table_privilege(r,'umi.audit_log','update')
           or has_table_privilege(r,'merchant.audit_log','delete') p
       from unnest(array['api','worker','readonly']) r) x)),
  -- Trigger function search_path pinned -------------------------------------
  ('trigger funcs have pinned search_path',
    (select case when count(*)=3 then 'PASS' else 'FAIL' end from pg_proc p
       where p.proname in ('tg_touch_updated_at','tg_append_only','tg_order_item_void_only')
         and array_to_string(coalesce(p.proconfig,'{}'),',') like '%search_path%')),
  -- Data hygiene (credential + PII cleaning) --------------------------------
  -- Narrowed by email, not widened. A PIN-only operator is an ACTIVE user with no email
  -- and no password on purpose — they sign in at the till, never at the dashboard. The
  -- defect this check exists to catch is the other row: one that carries a login address
  -- and therefore invites a password attempt, with no hash behind it.
  ('0 active users with an email but NULL password hash',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end from umi."user"
       where status='active' and email is not null and password_hash is null)),
  -- ⚠️ CHANGED 2026-08-18 from `count(*) = 0`, and the reason matters more than
  -- the assertion.
  --
  -- The old check could not pass and could not be satisfied. A credential that
  -- carries only a legacy hash belongs to somebody who still has to sign in;
  -- deleting the hash locks them out, and no scrypt hash can be derived from a
  -- sha256 one. PR #113 therefore CARRIES every credential and heals it on the
  -- next successful login, which is the only moment the plaintext exists. A gate
  -- that demands an impossible state is a gate somebody eventually deletes.
  --
  -- What replaces it asserts the two things that are true AND protective:
  --   1. Every retained legacy hash CAN heal — an active account with an email,
  --      so a login is possible at all. A legacy hash on a disabled or
  --      address-less row can never be upgraded, and that is a real defect.
  --   2. The retained set never GROWS. Nothing in umi-api writes a legacy hash:
  --      `auth.repository.updatePassword` stamps `scrypt-sha256-v1` on every
  --      write. A rising count means some writer started producing weak hashes
  --      again, which is the regression worth blocking on.
  ('every retained legacy hash can still heal on login',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end from umi."user"
       where password_algorithm='legacy-sha256-v1'
         and (status <> 'active' or email is null))),
  ('legacy-sha256 hashes do not grow (<=2: admin+barista @nectarcafe)',
    (select case when count(*)<=2 then 'PASS' else 'FAIL' end from umi."user"
       where password_algorithm='legacy-sha256-v1')),
  -- AB#116 · P1, filed 2026-08-18. FOUR ACTIVE ACCOUNTS SHARE ONE PASSWORD:
  -- `admin@` and `barista@` at BOTH elgranribera.mx and kalalacafe.mx, one salt
  -- and one hash between the four. Two live cafés cannot tell their own staff
  -- apart, and no audit trail can either.
  --
  -- Pinned rather than asserted to zero because the fix belongs in PRODUCTION,
  -- before the cutover snapshot is taken, and not in this file. The pin is what
  -- makes the gate useful meanwhile: a FIFTH account joining the shared password
  -- fails it, and so does a second, separate shared group.
  --
  -- ⚠️ THIS GOES UNDETECTABLE AFTER THE CUTOVER. PR #113 rehashes on login and
  -- gives each account a fresh salt, so the stored hashes stop matching each
  -- other while the shared PASSWORD lives on unchanged. Reset the four in
  -- production FIRST, then drop both allowances here to zero.
  ('at most one shared-password group survives (AB#116)',
    (select case when count(*)<=1 then 'PASS' else 'FAIL' end from (
       select 1 from umi."user"
        where password_hash is not null and status='active'
        group by password_hash, password_salt having count(*) > 1) s)),
  ('no shared-password group is larger than AB#116''s four accounts',
    (select case when coalesce(max(n),0)<=4 then 'PASS' else 'FAIL' end from (
       select count(*) n from umi."user"
        where password_hash is not null and status='active'
        group by password_hash, password_salt having count(*) > 1) s)),
  -- ⚠ A BACKFILL-FIDELITY check, not a schema one — its own label says
  -- "(functional)". It asserts that the migration preserved strong password
  -- hashes, so it can only pass on a target the backfill has loaded. Detect that
  -- target from source-schema provenance, independently of migrated target rows.
  -- A target-row probe could SKIP after a partial backfill lost the very fixture
  -- it was looking for, turning migration damage into missing coverage.
  -- `umi."user"` is not a safe probe: schema integration suites seed users, and
  -- the Gift Card suite deliberately retains its append-only ledger fixture and
  -- referenced user. A FAIL on that CI data would be a false verdict: nothing
  -- regressed, nothing was measured. It reports SKIP instead, and the summary
  -- names every SKIP. Unmeasured is never approved.
  ('some strong scrypt logins survive (functional)',
    (select case
       when to_regclass('core.tenants') is null then 'SKIP'
       when count(*) >= 1 then 'PASS'
       else 'FAIL' end
     from umi."user"
       where status='active' and password_algorithm='scrypt-sha256-v1' and password_hash is not null)),
  ('ghost @umi.invalid account is not active',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end from umi."user"
       where email like '%@umi.invalid' and status='active')),
  ('no Slack ids in café-readable audit_log',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end from merchant.audit_log
       where before ? 'slack_channel_id' or after ? 'slack_channel_id'
          or before ? 'slack_channel_name' or after ? 'slack_channel_name')),
  ('no historical webhook PII in runtime',
    case when (select count(*) from runtime.outbox_event)
            + (select count(*) from runtime.inbound_event)
            + (select count(*) from runtime.dead_letter) = 0 then 'PASS' else 'FAIL' end)
) g(label,status);

\echo ''
\echo '================= STRUCTURAL GATE ================='
select status, label from gate order by (status='FAIL') desc, label;

-- ============================================================================
-- BEHAVIORAL GATE — requires a BACKFILLED target, and is SKIPPED on a pristine one.
--
-- The checks below assert production-derived facts: two merchants BY NAME, and
-- their conversation and entitlement rows. None of that exists in a schema built
-- from 00_run.sh alone.
--
-- Before this guard, a pristine run died HERE. `\gset` on a query returning no
-- rows is an error, and under ON_ERROR_STOP=1 it killed the file after the
-- structural gate had passed but BEFORE the summary — so the run printed 45 PASS
-- rows and then reported nothing at all. The structural half is a SCHEMA
-- instrument and is provable on any build; the behavioral half is a MIGRATION
-- instrument and belongs to the P7 rehearsal. Do not conflate them.
--
-- The probe below is an aggregate, so it ALWAYS returns exactly one row and
-- `\gset` can never fail on it.
-- ============================================================================
select case when count(*) = 2 then 'true' else 'false' end as have_fixtures
  from merchant.merchant where name in ('Kalala Café', 'El Gran Ribera') \gset

\if :have_fixtures

-- capture merchant ids for behavioral tests (as superuser)
select id as kalala from merchant.merchant where name='Kalala Café' \gset
select id as egr    from merchant.merchant where name='El Gran Ribera' \gset

-- THE TRUE COUNTS, read as superuser (RLS bypassed) BEFORE the role switch.
--
-- ⚠️ CHANGED 2026-08-18. These were typed in as literals — 11 conversations, 4
-- entitlements, 2 entitlements — which pinned a SECURITY gate to one afternoon's
-- dump. The 2026-08-18 snapshot holds 12 Kalala conversations where the
-- 2026-07-09 one held 11, and the gate failed because a café had kept trading.
--
-- The gate is not about how many rows exist. It is about ISOLATION: `api`, under
-- one café's GUC, sees that café's rows and nobody else's. Comparing against the
-- truth proves exactly that on any snapshot, and a literal never could.
--
-- The zero-floor below is what keeps the comparison honest. A policy that denies
-- everything makes both sides zero and would otherwise read as perfect isolation.
select count(*) as kalala_convs from merchant.conversation_analytics where merchant_id = :'kalala' \gset
select count(*) as kalala_ents  from umi.effective_entitlement    where merchant_id = :'kalala' \gset
select count(*) as egr_ents     from umi.effective_entitlement    where merchant_id = :'egr'    \gset
--
-- ⚠️ `:vars` DO NOT INTERPOLATE INSIDE `$$ … $$`. psql treats a dollar-quoted body
-- as a literal and substitutes nothing, so every comparison against a captured
-- count is made in plain SQL and reported through `\if`, never inside a `do`
-- block. A `do $$ … :var … $$` is a syntax error, not a silent pass.
select (:kalala_convs > 0 and :kalala_ents > 0 and :egr_ents > 0) as fixtures_nonzero \gset
\if :fixtures_nonzero
\else
do $$ begin raise exception 'FAIL: a fixture count is zero, so the isolation comparison would pass vacuously'; end $$;
\endif

\echo ''
\echo '================= BEHAVIORAL GATE (as role api) ================='
set role api;

-- fail-closed: no merchant context => zero rows, no error
do $$ begin
  perform set_config('app.current_merchant','',false);
  if (select count(*) from merchant.merchant) <> 0 then raise exception 'FAIL: empty GUC did not fail closed'; end if;
end $$;
\echo 'PASS: empty/missing app.current_merchant -> 0 rows, no error (fail-closed)'

-- scoped to El Gran Ribera: sees only its own, and the VIEW does not leak Kalala
select set_config('app.current_merchant', :'egr', false);
do $$ begin
  if (select count(*) from merchant.merchant)               <> 1 then raise exception 'FAIL: EGR sees <>1 merchant'; end if;
  if (select count(*) from merchant.conversation)           <> 0 then raise exception 'FAIL: EGR sees foreign conversations'; end if;
  if (select count(*) from merchant.conversation_analytics) <> 0 then raise exception 'FAIL: conversation_analytics VIEW leaks cross-merchant to EGR'; end if;
end $$;
select (select count(*) from umi.effective_entitlement) = :egr_ents as egr_ent_ok \gset
\if :egr_ent_ok
\else
do $$ begin raise exception 'FAIL: EGR effective_entitlement <> the rows it owns (leak or wrong scope)'; end $$;
\endif
\echo 'PASS: EGR scope isolated; conversation_analytics + effective_entitlement do NOT leak cross-merchant'

-- scoped to Kalala: sees exactly its own conversations and entitlements, no more
select set_config('app.current_merchant', :'kalala', false);
select (select count(*) from merchant.conversation_analytics) = :kalala_convs
   and (select count(*) from umi.effective_entitlement)     = :kalala_ents as kalala_ok \gset
\if :kalala_ok
\else
do $$ begin raise exception 'FAIL: Kalala sees a different row count than it owns (leak or wrong scope)'; end $$;
\endif
\echo 'PASS: Kalala scope sees exactly its own rows'

reset role;

\else

\echo ''
\echo '================= BEHAVIORAL GATE ================='
\echo 'SKIPPED: fixture merchants absent — this target has no backfilled data.'
\echo '         The 3 behavioral checks assert production-derived facts (two'
\echo '         merchants by name, and exact row counts). They are a MIGRATION'
\echo '         instrument, not a schema one, and cannot run on a pristine build.'
\echo '         Run them in the P7 rehearsal against the backfilled clone.'
\echo '         The structural gate above DID run and its verdict stands.'
\echo ''
\echo '⚠ THIS RUN DID NOT MEASURE THE BEHAVIORAL GATE. A skipped check is'
\echo '  unmeasured, never approved. Record it as skipped in the evidence.'

\endif

\echo ''
\echo '================= ENFORCE ================='
-- A WARN does NOT block. It is an acknowledged, dated gap — not a passing check — so it
-- is printed on its own, every run, and named in the summary. A warning nobody sees is
-- just a failure that was renamed.
do $$
declare n int; w int; s int; r record;
begin
  select count(*) into n from gate where status='FAIL';
  select count(*) into w from gate where status='WARN';
  select count(*) into s from gate where status='SKIP';
  for r in select label from gate where status='WARN' order by label loop
    raise warning 'ACKNOWLEDGED GAP: %', r.label;
  end loop;
  -- A SKIP is a check this target could not measure, not a check that passed.
  -- Name every one, on every run. An unnamed skip reads as coverage.
  for r in select label from gate where status='SKIP' order by label loop
    raise warning 'NOT MEASURED ON THIS TARGET: %', r.label;
  end loop;
  if n > 0 then raise exception 'SECURITY GATE FAILED: % structural check(s) failed', n;
  else raise notice 'SECURITY GATE PASSED: % structural check(s) green, % acknowledged gap(s), % not measured',
    (select count(*) from gate where status='PASS'), w, s;
    -- ⚠ This line reports the STRUCTURAL gate only. It used to read
    -- "+ 3 behavioral checks green" unconditionally, which was false on any
    -- target without the fixture merchants — and false in the one direction that
    -- matters, because it claimed a measurement that had not been taken. The
    -- behavioral section prints its own PASS or SKIPPED lines above. Read both.
  end if;
end $$;
