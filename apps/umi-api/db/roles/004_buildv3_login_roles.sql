-- ============================================================================
-- build-v3 LOGIN roles — the file the cutover runs (D1, D5, D10)
--
-- Run ONCE against the build-v3 target, as the operator role:
--
--     psql -v ON_ERROR_STOP=1 -d "$TARGET" -f apps/umi-api/db/roles/004_buildv3_login_roles.sql
--
-- ⚠️ Set the passwords SEPARATELY, and never in this repository:
--
--     \password api_login
--     \password worker_login
--
-- Then put the two values in `DATABASE_URL_APP` and `DATABASE_URL_WORKER` in
-- the VPS `.env`, and nowhere else. This file carries NO password, so it is safe
-- to read, to review, and to run again.
--
-- ── Why the earlier files do not serve ──
--
--   `001_api_roles.sql` provisions `umi_app` / `umi_worker` / `umi_readonly`
--   with `noinherit` and with `CHANGE_ME_*` passwords. That is the v2 model.
--   build-v3 ships `api` / `worker` / `readonly` as NOLOGIN GROUP roles
--   (`00_foundation.sql:12`), and `noinherit` breaks every grant. Do not run it
--   against a build-v3 target.
--
--   `harness-roles.sql` is the local test cluster only. It carries literal
--   passwords and it points at `127.0.0.1:5233`.
--
-- ── Postgres semantics this file depends on ──
--
--   A role ATTRIBUTE is never inherited through membership. LOGIN, SUPERUSER
--   and BYPASSRLS belong to the role that carries them. A member of `worker`
--   inherits the table grants of `worker` and stays RLS-confined. So
--   `worker_login` must carry BYPASSRLS ITSELF. `api_login` needs no attribute,
--   because grants do inherit.
--
--   The D1 boot guard reads the attribute, not the membership
--   (`pg.service.ts` → `assertPoolRoles`), and refuses the boot on a mismatch.
-- ============================================================================

\set ON_ERROR_STOP on

-- ----------------------------------------------------------------------------
-- 1. The two LOGIN roles. No password here — see the header.
--    A role with no password cannot connect, which is the safe state until the
--    operator runs `\password`.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'api_login') then
    create role api_login login in role api;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'worker_login') then
    create role worker_login login bypassrls in role worker;
  end if;
end $$;

-- Idempotent, and a repair for a role that already exists in the wrong shape.
alter role api_login    login nosuperuser nocreatedb nocreaterole nobypassrls inherit;
alter role worker_login login nosuperuser nocreatedb nocreaterole bypassrls   inherit;

grant api    to api_login;
grant worker to worker_login;

-- ----------------------------------------------------------------------------
-- 2. D10 — the request path never writes a statement to the log.
--
-- Bind parameters carry session tokens, reset tokens, OTP hashes and merchant
-- ids. `log_parameter_max_length` governs how much of a parameter reaches the
-- log, and it is `-1` by default, which means IN FULL.
--
-- Today that leaks nothing, because `log_statement = none` means no statement
-- is logged at all. It becomes a credential sink the moment somebody turns on
-- slow-query logging to debug an incident — which is exactly when somebody will.
--
-- `log_parameter_max_length` needs superuser or a `pg_parameter_acl` grant, and
-- the managed target refused `ALTER DATABASE … SET log_parameter_max_length`.
-- So pin the trigger instead of the payload: with
-- `log_min_duration_statement = -1` on the request-path roles, a cluster-wide
-- slow-query setting does not reach them, and no statement of theirs is logged.
-- This is the narrower control, and it survives a cluster-level change.
--
-- Both are attempted. A managed target may refuse either one; the block reports
-- what it could not set and does not abort the file.
-- ----------------------------------------------------------------------------
do $$
declare
  r text;
  p text;
begin
  foreach r in array array['api_login', 'worker_login'] loop
    foreach p in array array['log_min_duration_statement = -1', 'log_parameter_max_length = 0'] loop
      begin
        execute format('alter role %I set %s', r, p);
      exception when insufficient_privilege then
        raise warning 'D10 NOT SET on %: % — needs superuser or a pg_parameter_acl grant. Record it as a gap.', r, p;
      end;
    end loop;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Report. Read this output; do not assume the file did what it says.
--
-- `pg_roles` carries the attributes and `rolconfig`. `pg_authid` does NOT carry
-- `rolconfig`, and `pg_roles.rolpassword` reads `********` for everybody, so
-- neither view answers "is there a password". Section 4 answers that.
-- ----------------------------------------------------------------------------
select rolname                                  as role,
       rolcanlogin                              as can_login,
       rolsuper                                 as superuser,
       rolbypassrls                             as bypassrls,
       pg_has_role(rolname, 'api', 'USAGE')     as inherits_api,
       pg_has_role(rolname, 'worker', 'USAGE')  as inherits_worker,
       rolconfig                                as settings
  from pg_roles
 where rolname in ('api_login', 'worker_login')
 order by rolname;

-- ----------------------------------------------------------------------------
-- 4. D5 — the password verifier, when this operator can read it.
--
-- SECURITY_GATE.md D5 asks that every app LOGIN role hold a SCRAM-SHA-256
-- verifier and none hold md5. The verifier lives in `pg_shadow.passwd`, and its
-- first characters name the method: `SCRAM-SHA-256$` or `md5`. `pg_shadow` has
-- no `passwdtype` column — an earlier version of that document named one.
--
-- Only a superuser reads `pg_shadow`. A managed target reports NOT READABLE,
-- and the operator runs this part from the provider console.
-- ----------------------------------------------------------------------------
do $$
declare
  row_out text;
begin
  if not has_table_privilege(current_user, 'pg_shadow', 'select') then
    raise notice 'D5 NOT READABLE by %: pg_shadow needs a superuser. Check the verifier from the provider console.', current_user;
    return;
  end if;
  for row_out in
    select format('D5 %s: %s', usename,
             case
               when passwd is null                      then 'NO PASSWORD (cannot connect yet — run \password)'
               when passwd like 'SCRAM-SHA-256$%'        then 'scram-sha-256 OK'
               when passwd like 'md5%'                   then 'md5 — REPROVISION, set password_encryption=scram-sha-256 first'
               else 'unrecognised verifier'
             end)
      from pg_shadow
     where usename in ('api_login', 'worker_login')
     order by usename
  loop
    raise notice '%', row_out;
  end loop;
end $$;
