-- 008_dashboard_compat_core.sql
-- Dashboard compatibility layer: Prisma-model-named views over platform/cash/conversaflow
-- plus local-auth tables (local_user_credentials, password_reset_tokens).
-- Captured 2026-06-10 from umi_platform_transition_exec_v2_20260515 during plan S4.1,
-- where this schema existed ad hoc but was absent from the replay scripts (staging gap).
-- Apply after 001-007 schema scripts and 010-044 backfills. Credential seed rows are
-- local-dev only (scrypt hashes, no plaintext).

--
-- PostgreSQL database dump
--


-- Dumped from database version 18.3 (Homebrew)
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: dashboard_compat; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA dashboard_compat;


--
-- Name: ApplePushToken; Type: VIEW; Schema: dashboard_compat; Owner: -
--

CREATE VIEW dashboard_compat."ApplePushToken" AS
 SELECT NULL::text AS id,
    NULL::text AS "cardId",
    NULL::text AS "deviceToken",
    NULL::text AS "pushToken",
    NULL::timestamp with time zone AS "createdAt"
  WHERE false;


--
-- Name: BirthdayReward; Type: VIEW; Schema: dashboard_compat; Owner: -
--

CREATE VIEW dashboard_compat."BirthdayReward" AS
 SELECT NULL::text AS id,
    NULL::text AS "tenantId",
    NULL::text AS "loyaltyCardId",
    NULL::integer AS year,
    NULL::timestamp with time zone AS "issuedAt",
    NULL::timestamp with time zone AS "expiresAt",
    NULL::timestamp with time zone AS "redeemedAt",
    NULL::text AS status
  WHERE false;


--
-- Name: GiftCard; Type: VIEW; Schema: dashboard_compat; Owner: -
--

CREATE VIEW dashboard_compat."GiftCard" AS
 SELECT (id)::text AS id,
    (tenant_id)::text AS "tenantId",
    code,
    amount_cents AS "amountCentavos",
    COALESCE((created_by_staff_member_id)::text, '00000000-0000-0000-0000-000000000000'::text) AS "createdByStaffId",
    sender_name AS "senderName",
    message,
    recipient_email AS "recipientEmail",
    recipient_phone AS "recipientPhone",
    recipient_name AS "recipientName",
    (redeemed_at IS NOT NULL) AS "isRedeemed",
    redeemed_at AS "redeemedAt",
    (redeemed_loyalty_card_id)::text AS "redeemedCardId",
    expires_at AS "expiresAt",
    created_at AS "createdAt"
   FROM cash.gift_cards;


--
-- Name: Location; Type: VIEW; Schema: dashboard_compat; Owner: -
--

CREATE VIEW dashboard_compat."Location" AS
 SELECT (id)::text AS id,
    (tenant_id)::text AS "tenantId",
    name,
    NULL::text AS address,
    NULL::double precision AS latitude,
    NULL::double precision AS longitude,
    (status = 'active'::text) AS "isActive"
   FROM platform.locations l;


--
-- Name: LoyaltyCard; Type: VIEW; Schema: dashboard_compat; Owner: -
--

CREATE VIEW dashboard_compat."LoyaltyCard" AS
 SELECT (lc.id)::text AS id,
    (lc.tenant_id)::text AS "tenantId",
    COALESCE((la.contact_id)::text, (lc.loyalty_account_id)::text) AS "userId",
    lc.card_number AS "cardNumber",
    lc.balance_cents AS "balanceCentavos",
    lc.total_visits AS "totalVisits",
    lc.visits_this_cycle AS "visitsThisCycle",
    lc.pending_rewards AS "pendingRewards",
    NULL::text AS "applePassSerial",
    NULL::text AS "applePassAuthToken",
    NULL::text AS "googlePassObjectId",
    lc.qr_token AS "qrToken",
    lc.qr_issued_at AS "qrIssuedAt",
    lc.created_at AS "createdAt",
    lc.updated_at AS "updatedAt"
   FROM (cash.loyalty_cards lc
     LEFT JOIN cash.loyalty_accounts la ON ((la.id = lc.loyalty_account_id)));


--
-- Name: OtpVerification; Type: VIEW; Schema: dashboard_compat; Owner: -
--

CREATE VIEW dashboard_compat."OtpVerification" AS
 SELECT (id)::text AS id,
    identity_value AS phone,
    (tenant_id)::text AS "tenantId",
    code_hash AS "codeHash",
    expires_at AS "expiresAt",
    attempts,
    (verified_at IS NOT NULL) AS verified,
    created_at AS "createdAt"
   FROM cash.otp_verifications;


--
-- Name: RewardConfig; Type: VIEW; Schema: dashboard_compat; Owner: -
--

CREATE VIEW dashboard_compat."RewardConfig" AS
 SELECT (id)::text AS id,
    (tenant_id)::text AS "tenantId",
    visits_required AS "visitsRequired",
    reward_name AS "rewardName",
    reward_description AS "rewardDescription",
    reward_cost_cents AS "rewardCostCentavos",
    is_active AS "isActive",
    activated_at AS "activatedAt",
    created_at AS "createdAt"
   FROM cash.reward_configs;


--
-- Name: RewardRedemption; Type: VIEW; Schema: dashboard_compat; Owner: -
--

CREATE VIEW dashboard_compat."RewardRedemption" AS
 SELECT (id)::text AS id,
    (loyalty_card_id)::text AS "cardId",
    (reward_config_id)::text AS "configId",
    COALESCE((staff_member_id)::text, '00000000-0000-0000-0000-000000000000'::text) AS "staffId",
    redeemed_at AS "redeemedAt",
    note
   FROM cash.reward_redemptions;


--
-- Name: Session; Type: VIEW; Schema: dashboard_compat; Owner: -
--

CREATE VIEW dashboard_compat."Session" AS
 SELECT NULL::text AS id,
    NULL::text AS "userId",
    NULL::text AS token,
    NULL::timestamp with time zone AS "expiresAt",
    NULL::timestamp with time zone AS "createdAt"
  WHERE false;


--
-- Name: Tenant; Type: VIEW; Schema: dashboard_compat; Owner: -
--

CREATE VIEW dashboard_compat."Tenant" AS
 SELECT (t.id)::text AS id,
    t.slug,
    t.name,
    NULL::text AS city,
    COALESCE(wp.card_prefix, upper("left"(t.slug, 3)), 'LYL'::text) AS "cardPrefix",
    COALESCE((wp.branding ->> 'primary_color'::text), '#B5605A'::text) AS "primaryColor",
    (wp.branding ->> 'secondary_color'::text) AS "secondaryColor",
    (wp.branding ->> 'logo_url'::text) AS "logoUrl",
    (wp.branding ->> 'strip_image_url'::text) AS "stripImageUrl",
    COALESCE(wp.pass_style, 'default'::text) AS "passStyle",
    (wp.branding ->> 'promo_message'::text) AS "promoMessage",
    (NULLIF((wp.branding ->> 'promo_starts_at'::text), ''::text))::timestamp with time zone AS "promoStartsAt",
    (NULLIF((wp.branding ->> 'promo_ends_at'::text), ''::text))::timestamp with time zone AS "promoEndsAt",
    (wp.branding ->> 'promo_days'::text) AS "promoDays",
    (wp.branding -> 'business_hours'::text) AS "businessHours",
    t.timezone,
    COALESCE(wp.topup_enabled, true) AS "topupEnabled",
    true AS "selfRegistration",
    upper(t.status) AS "subscriptionStatus",
    NULL::timestamp with time zone AS "suspendedAt",
    NULL::timestamp with time zone AS "trialEndsAt",
    COALESCE(((wp.branding ->> 'birthday_reward_enabled'::text))::boolean, false) AS "birthdayRewardEnabled",
    COALESCE((wp.branding ->> 'birthday_reward_name'::text), 'Regalo de cumpleaños'::text) AS "birthdayRewardName",
    t.created_at AS "createdAt",
    t.updated_at AS "updatedAt"
   FROM (platform.tenants t
     LEFT JOIN LATERAL ( SELECT p.id,
            p.tenant_id,
            p.location_id,
            p.name,
            p.card_prefix,
            p.topup_enabled,
            p.pass_style,
            p.branding,
            p.status,
            p.created_at,
            p.updated_at
           FROM cash.wallet_programs p
          WHERE (p.tenant_id = t.id)
          ORDER BY p.created_at DESC
         LIMIT 1) wp ON (true));


--
-- Name: Transaction; Type: VIEW; Schema: dashboard_compat; Owner: -
--

CREATE VIEW dashboard_compat."Transaction" AS
 SELECT (id)::text AS id,
    (loyalty_card_id)::text AS "cardId",
    (staff_member_id)::text AS "staffId",
    upper(type) AS type,
    amount_cents AS "amountCentavos",
    description,
    created_at AS "createdAt"
   FROM cash.wallet_transactions;


--
-- Name: User; Type: VIEW; Schema: dashboard_compat; Owner: -
--

CREATE VIEW dashboard_compat."User" AS
 SELECT DISTINCT ON (c.id) (c.id)::text AS id,
    (c.tenant_id)::text AS "tenantId",
    c.phone,
    c.email,
    c.display_name AS name,
    NULL::date AS "birthDate",
    'CUSTOMER'::text AS role,
    NULL::text AS "passwordHash",
    NULL::text AS device,
    NULL::text AS os,
    NULL::timestamp with time zone AS "phoneVerifiedAt",
    c.created_at AS "createdAt",
    c.updated_at AS "updatedAt"
   FROM (platform.contacts c
     JOIN cash.loyalty_accounts la ON ((la.contact_id = c.id)))
UNION ALL
 SELECT (sm.id)::text AS id,
    (sm.tenant_id)::text AS "tenantId",
    sm.phone,
    sm.email,
    sm.name,
    NULL::date AS "birthDate",
        CASE
            WHEN (lower(sm.name) = 'admin'::text) THEN 'ADMIN'::text
            ELSE 'STAFF'::text
        END AS role,
    NULL::text AS "passwordHash",
    NULL::text AS device,
    NULL::text AS os,
    NULL::timestamp with time zone AS "phoneVerifiedAt",
    sm.created_at AS "createdAt",
    sm.updated_at AS "updatedAt"
   FROM platform.staff_members sm;


--
-- Name: Visit; Type: VIEW; Schema: dashboard_compat; Owner: -
--

CREATE VIEW dashboard_compat."Visit" AS
 SELECT (id)::text AS id,
    (loyalty_card_id)::text AS "cardId",
    COALESCE((staff_member_id)::text, '00000000-0000-0000-0000-000000000000'::text) AS "staffId",
    occurred_at AS "scannedAt",
    note
   FROM cash.visit_events;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: local_user_credentials; Type: TABLE; Schema: dashboard_compat; Owner: -
--

CREATE TABLE dashboard_compat.local_user_credentials (
    user_id uuid NOT NULL,
    username text NOT NULL,
    password_salt text NOT NULL,
    password_hash text NOT NULL,
    algorithm text DEFAULT 'scrypt-sha256-v1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: password_reset_tokens; Type: TABLE; Schema: dashboard_compat; Owner: -
--

CREATE TABLE dashboard_compat.password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Data for Name: local_user_credentials; Type: TABLE DATA; Schema: dashboard_compat; Owner: -
--

-- Seed the local-owner credential by auth_subject, not by hardcoded uuid: backfill 030
-- regenerates platform.users ids per environment, so a copied uuid would orphan the row
-- (observed in the 2026-06-10 staging replay).
INSERT INTO dashboard_compat.local_user_credentials (user_id, username, password_salt, password_hash, algorithm)
SELECT id,
       'hola@umiconsulting.co',
       'e4460be451be2ccc371331b46be60e11',
       'c5d4b2fc7e8afc6c148caa7ce782d4e97f93b3494f7d33b438b9b16d6329a37d78d26f61ce48cebf306503a5d3feb2b76ac2d9c9ab7d9098e35f6626019414a1',
       'scrypt-sha256-v1'
FROM platform.users
WHERE auth_subject = 'local-owner-1'
ON CONFLICT (user_id) DO NOTHING;


--
-- Data for Name: password_reset_tokens; Type: TABLE DATA; Schema: dashboard_compat; Owner: -
--

-- password_reset_tokens: no seed data (tokens are ephemeral)


--
-- Name: local_user_credentials local_user_credentials_pkey; Type: CONSTRAINT; Schema: dashboard_compat; Owner: -
--

ALTER TABLE ONLY dashboard_compat.local_user_credentials
    ADD CONSTRAINT local_user_credentials_pkey PRIMARY KEY (user_id);


--
-- Name: local_user_credentials local_user_credentials_username_key; Type: CONSTRAINT; Schema: dashboard_compat; Owner: -
--

ALTER TABLE ONLY dashboard_compat.local_user_credentials
    ADD CONSTRAINT local_user_credentials_username_key UNIQUE (username);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: dashboard_compat; Owner: -
--

ALTER TABLE ONLY dashboard_compat.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens_token_hash_idx; Type: INDEX; Schema: dashboard_compat; Owner: -
--

CREATE INDEX password_reset_tokens_token_hash_idx ON dashboard_compat.password_reset_tokens USING btree (token_hash);


--
-- Name: local_user_credentials local_user_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: dashboard_compat; Owner: -
--

ALTER TABLE ONLY dashboard_compat.local_user_credentials
    ADD CONSTRAINT local_user_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES platform.users(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: dashboard_compat; Owner: -
--

ALTER TABLE ONLY dashboard_compat.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES platform.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


