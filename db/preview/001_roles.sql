
SET default_transaction_read_only = off;

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

CREATE ROLE "umi_app";
ALTER ROLE "umi_app" WITH INHERIT NOCREATEROLE NOCREATEDB LOGIN NOBYPASSRLS;
CREATE ROLE "umi_readonly";
ALTER ROLE "umi_readonly" WITH INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOBYPASSRLS;
CREATE ROLE "umi_worker";
ALTER ROLE "umi_worker" WITH INHERIT NOCREATEROLE NOCREATEDB LOGIN NOBYPASSRLS;

ALTER ROLE "anon" SET "statement_timeout" TO '3s';

ALTER ROLE "authenticated" SET "statement_timeout" TO '8s';

ALTER ROLE "authenticator" SET "statement_timeout" TO '8s';

RESET ALL;
