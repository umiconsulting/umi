-- ============================================================================
-- 002 · ONCA: the café, its menu, and the two stations its KDS needs
--
-- WHO THIS IS FOR. ONCA arrives with hardware instead of a spreadsheet: a
-- borrowed counter package (a Parrot/iMin till, two Galaxy tablets, an Epson
-- TM-T20III and a TP-Link Archer C50) that runs a Parrot POS today. The café
-- itself does not exist anywhere in the platform — the merchant table holds
-- elgranribera, kalalacafe, nectarcafe, northwestcafe and umicafe, and nothing
-- else. So the FIRST thing ONCA needs is not a device: it is a row.
--
-- WHERE THE MENU COMES FROM. The till's own database was recovered on
-- 2026-10-05 (`com.bryajam.panpilot.trial6`, table `products`, 64 rows) and
-- normalised into `catalog-import.csv` / `catalog-import.json`: 51 sellable
-- products across 3 categories. The legacy till carried FIVE categories (Pan,
-- Calientes, Frío, Nube, Pizza) because a drink's temperature was a separate
-- category with its own price; the import collapses Calientes/Frío/Nube into
-- the product's own variants, which is what `merchant.product_variant` is for.
-- The legacy daily closures name a line "Frío · Latte", so the till already
-- thought of it as one product with a style. See
-- `docs/pilot/ONCA_MENU_TO_UMI_MAPPING.md` for the full mapping and the
-- decisions that are still open.
--
-- WHY A MIGRATION AND NOT A DASHBOARD FORM. `ORDER_MODEL.md §5` puts the
-- catalog and the stations in the CONFIG bucket — "the owner edits it at
-- business cadence". This file does not contradict that: it INSERTS config
-- rows into the config tables, and every one of them is editable in the
-- dashboard from the moment it lands. What the rule forbids is putting config
-- in a place only a migration can reach, and this does not. The seed exists
-- because the client is standing in the room with a menu recovered from a
-- database nobody wants to retype by hand. The precedent is
-- `backfill/backfill_commerce.sql`, which seeds the same tables from the
-- legacy production database.
--
-- WHAT IT WRITES, in order:
--   1  the café itself                        merchant.merchant      (handle 'onca')
--   2  the one site                          merchant.location
--   3  the two stations                      merchant.station       (barra, pizzas)
--   4  the loyalty programme and its reward  merchant.loyalty_program / _reward
--   5  the subscription, and the POS grant   umi.subscription / umi.entitlement_override
--   6  the counter drawer's register         merchant.physical_register
--      and the policy that lets a shift open  merchant.cash_shift_policy
--   7  the menu                              merchant.product_category / _product / _product_variant
--   8  what the KDS shows                    merchant.kitchen_route
--
-- WHAT IT DELIBERATELY DOES NOT WRITE, and why:
--   · NO LOGIN. `umi.user.password_hash` is scrypt-sha256-v1, and only the API
--     hashes a password (`PasswordService`). A migration that carried a hash
--     would either carry a password in plain sight or ship a credential nobody
--     can change. The ONCA owner is invited from the dashboard instead, which
--     is where every other café's second user comes from. The invite flow is
--     the same one `POST /staff` + the password-reset link use.
--   · NO DEVICE ROWS. Each tablet enrols ITSELF and mints its own credential
--     (`merchant.device` is written by the pairing route). A device row created
--     here would have no credential and would block the real enrolment on
--     `device_active_installation_uq`.
--   · NO OFFLINE CASH. `merchant.pos_offline_cash_policy` stays absent, so
--     `GET /offline/policy` answers with its cash half disabled and the till
--     refuses a provisional cash sale. That is the shipped default for a café
--     not yet certified for it, and enabling it is a decision with limits
--     attached — see `docs/pilot/ONCA_OFFLINE_FIRST_DESIGN.md`.
--   · NO HOURS. `open_hours` stays the empty default. The recovered data
--     suggests a ~09:00–18:00 window but never states one, and inventing a
--     schedule the bot then quotes to customers is worse than an empty one.
--
-- HOW TO RUN. Same as every forward migration — no `--single-transaction`
-- needed, because every statement is guarded:
--   psql -v ON_ERROR_STOP=1 -f docs/migration/build-v3/migrations/002_onca_onboarding.sql
--
-- IT IS RE-RUNNABLE. The café is found by `handle = 'onca'` (a UNIQUE column),
-- every child insert is guarded by "not exists / on conflict do nothing", and a
-- second apply changes nothing. There is no `begin;` here on purpose: the
-- caller owns the transaction.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · The café.
--
-- The handle is what makes this file idempotent, and it is also a real
-- decision: `handle` is the URL key, and it is the ONE thing about a café that
-- cannot be recalled once published. Setting it now claims
-- `cash.umiconsulting.co/onca` — and every Apple Wallet pass carries a
-- `webServiceURL` frozen at generation time, so the first pass issued under
-- this handle makes the handle permanent. 002 is where that happens, before
-- any pass exists, and not later.
--
-- timezone/currency/locale are the schema defaults for a Mexican café, stated
-- rather than inherited so a reader does not have to look them up. The brand
-- colours are LEFT NULL: the dashboard falls back to its own defaults, and a
-- colour invented here would be one the client has to notice and undo.
-- ---------------------------------------------------------------------------
insert into merchant.merchant
  (name, handle, city, timezone, currency, locale, open_hours,
   menu_source, business_day_start, status)
values
  ('ONCA', 'onca', null, 'America/Mexico_City', 'MXN', 'es-MX', '{}'::jsonb,
   'dashboard', '00:00', 'active')
on conflict do nothing;

-- The café is looked up by handle from here on. `on conflict do nothing` above
-- covers both unique columns, so this is also the guard that says what went
-- wrong when somebody has already created an ONCA by another name.
do $$
begin
  if not exists (select 1 from merchant.merchant where handle = 'onca') then
    raise exception
      '002_onca_onboarding: a café named ONCA already exists without handle ''onca''. '
      'Give it the handle, or delete the stray row, and run this file again.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · The one site.
--
-- `payment_methods` is a fact about the counter, and the recovered daily
-- closures are the evidence for these three: every closure of 2026-10-01 →
-- 10-03 splits its sales into efectivo, tarjeta and transferencia. The array is
-- what the bot tells a customer who asks how to pay; it is not a payment
-- integration.
--
-- `open_hours` is LEFT NULL so the location inherits the café's (empty) hours,
-- and `timezone` too. See the header for why no schedule is invented.
-- ---------------------------------------------------------------------------
insert into merchant.location
  (merchant_id, name, address, payment_methods, status)
select m.id, 'ONCA', null,
       array['efectivo', 'tarjeta', 'transferencia']::text[], 'active'
  from merchant.merchant m
 where m.handle = 'onca'
   and not exists (
     select 1 from merchant.location l where l.merchant_id = m.id
   );

-- ---------------------------------------------------------------------------
-- 3 · The two stations.
--
-- These mirror the two station apps the café runs today: `comandera-barra-v4`
-- and `Cocina-de-Pizzas-v1`. A station is what a KDS device pairs to, so the
-- tablet named "KDS" pairs to `barra` or to `pizzas` — which one is a
-- commissioning choice, and the routing in step 8 is what decides which
-- tickets land on it.
--
-- The keys are the stable handles (`station_merchant_location_key_uidx`), so a
-- rename in the dashboard does not create a second station on a re-run.
-- ---------------------------------------------------------------------------
insert into merchant.station (merchant_id, location_id, key, name, sort_order, status)
select m.id, l.id, s.key, s.name, s.sort_order, 'active'
  from merchant.merchant m
  join merchant.location l on l.merchant_id = m.id
  cross join (values
    ('barra',  'Barra',             10),
    ('pizzas', 'Cocina de pizzas',  20)
  ) as s(key, name, sort_order)
 where m.handle = 'onca'
   and not exists (
     select 1 from merchant.station st
      where st.merchant_id = m.id and st.key = s.key and st.status <> 'archived'
   );

-- ---------------------------------------------------------------------------
-- 4 · The loyalty programme, and the reward it earns.
--
-- Ten stamps for a free drink — the same ladder umi-cash's own signup form
-- seeds (`MerchantsService.provision`), so an ONCA customer's card behaves like
-- every other café's on day one. `self_registration = true` matches the
-- provisioner too: customers enrol themselves from the card page.
--
-- `card_prefix` is initials only; `loyalty_card.card_number` is unique per café
-- and this is the human-facing half of it.
-- ---------------------------------------------------------------------------
insert into merchant.loyalty_program
  (merchant_id, card_prefix, self_registration, stamps_per_reward,
   topup_enabled, multi_seal_enabled, birthday_reward_enabled)
select m.id, 'ONC', true, 10, false, false, false
  from merchant.merchant m
 where m.handle = 'onca'
   and not exists (
     select 1 from merchant.loyalty_program p where p.merchant_id = m.id
   );

insert into merchant.loyalty_reward
  (merchant_id, name, type, kind, stamps_required, active)
select m.id, 'Bebida gratis', 'stamps_free_item', 'standard', 10, true
  from merchant.merchant m
 where m.handle = 'onca'
   and not exists (
     select 1 from merchant.loyalty_reward r
      where r.merchant_id = m.id and r.name = 'Bebida gratis'
   );

-- ---------------------------------------------------------------------------
-- 5 · The plan, and the one feature the plan does not bundle.
--
-- ONCA bought the whole stack, so the subscription is `pro`: cash (loyalty and
-- stored value), dashboard, conversaflow and kds. `pos` is deliberately bundled
-- into NO public plan — UmiPOS is sold, not included — so it arrives as an
-- `entitlement_override` on this subscription. That is exactly the shape
-- `umi.effective_entitlement` documents: "a single café's deviation is an
-- override, not a bespoke plan".
--
-- No `trialEndsAt`, so the status is `active` and not `trialing`: a café that
-- is paying is not on a clock. An `effective_entitlement` row only exists for
-- status in ('trialing','active'), so a subscription written any other way
-- silently owns nothing.
-- ---------------------------------------------------------------------------
insert into umi.subscription (merchant_id, plan_id, status, current_period_start)
select m.id, p.id, 'active', now()
  from merchant.merchant m
  join umi.plan p on p.key = 'pro' and p.status = 'active'
 where m.handle = 'onca'
   and not exists (
     select 1 from umi.subscription s where s.merchant_id = m.id
   );

insert into umi.entitlement_override
  (subscription_id, feature_id, enabled, reason)
select s.id, f.id, true,
       'ONCA commissioning 2026-10-06: UmiPOS sold with the counter package'
  from merchant.merchant m
  join umi.subscription s on s.merchant_id = m.id
  join umi.feature f on f.key = 'pos'
 where m.handle = 'onca'
on conflict (subscription_id, feature_id) do nothing;

-- ---------------------------------------------------------------------------
-- 6 · The drawer.
--
-- The cash drawer hangs off the iMin counter till rather than off a printer, so
-- the register is the till's. One register ("Caja 1"), `device_required` —
-- a shift names the device that took responsibility for the drawer, which is
-- what `cash_shift.holding_device_id` needs.
--
-- The shift POLICY is the part that is easy to miss: without a row in
-- `merchant.cash_shift_policy`, `PosCashRepository.policy()` answers
-- `default-deny` and the first "abrir caja" of the day is refused for a reason
-- that has nothing to do with the cashier. The bounds below are the
-- commissioning baseline and are the café's to tighten in the dashboard:
--
--   opening float      cap $2,000.00   (the observed float was $959.00)
--   movement approval  above $2,000.00 (their largest withdrawal is the $1,000 rent,
--                                       so a normal withdrawal does not stall on an
--                                       approval; `amount >= threshold` gates, so a
--                                       0 here would gate EVERYTHING)
--   variance tolerance $5.00
--   count method       denomination_or_total, blind count required
--
-- `expires_at` is far future ON PURPOSE. The reader filters
-- `expires_at > now()`, and nothing in the product re-issues a shift policy yet,
-- so a short expiry would leave the till default-deny on an arbitrary morning.
-- The `fingerprint` is a real sha256 of the policy's own version string, not a
-- placeholder: it is the value the till echoes back when it re-reads the policy.
-- ---------------------------------------------------------------------------
insert into merchant.physical_register
  (merchant_id, location_id, display_name, public_reference, currency,
   active, assignment_policy, allowed_device_classes)
select m.id, l.id, 'Caja 1', 'CAJA-1', 'MXN',
       true, 'device_required', array['pos_terminal']::text[]
  from merchant.merchant m
  join merchant.location l on l.merchant_id = m.id
 where m.handle = 'onca'
   and not exists (
     select 1 from merchant.physical_register r
      where r.merchant_id = m.id and r.public_reference = 'CAJA-1'
   );

insert into merchant.cash_shift_policy
  (merchant_id, location_id, version, currency,
   maximum_opening_float, allowed_movement_types, movement_approval_threshold,
   variance_tolerance, count_method, blind_count_required, handoff_allowed,
   no_sale_drawer_allowed, offline_cash_shift_allowed, denominations,
   issued_at, expires_at, fingerprint)
select m.id, l.id, 'onca-commissioning-v1', 'MXN',
       200000, array['paid_in', 'paid_out', 'safe_drop']::text[], 200000,
       500, 'denomination_or_total', true, false,
       false, false,
       ('[{"minorUnits":100000,"currency":"MXN"},{"minorUnits":50000,"currency":"MXN"},'
        '{"minorUnits":20000,"currency":"MXN"},{"minorUnits":10000,"currency":"MXN"},'
        '{"minorUnits":5000,"currency":"MXN"},{"minorUnits":2000,"currency":"MXN"},'
        '{"minorUnits":1000,"currency":"MXN"},{"minorUnits":500,"currency":"MXN"}]')::jsonb,
       now(), '2099-12-31T00:00:00Z'::timestamptz,
       encode(extensions.digest('onca-commissioning-v1|MXN|device_required', 'sha256'), 'hex')
  from merchant.merchant m
  join merchant.location l on l.merchant_id = m.id
 where m.handle = 'onca'
   and not exists (
     select 1 from merchant.cash_shift_policy sp where sp.merchant_id = m.id
   );

-- ---------------------------------------------------------------------------
-- 7 · The menu.
--
-- Three categories, and the colours are taken from the schema's own 16-colour
-- palette (`product_category.color`). They matter: the POS paints the tint
-- behind every photo-less product, and the column's default is RANDOM, so
-- leaving it unset would give the barista a different colour on every install.
--
-- Prices are centavos and INCLUDE IVA, which is how a Mexican menu price works
-- and how the legacy till priced. `tax_rate_basis_points` carries the 16% IVA
-- alongside, so the receipt can show the breakdown without the price moving.
-- ⚠️ The recovered import says "taxRateBasisPoints a confirmar" — confirm the
-- rate and the gross/net convention with ONCA's accountant before the first
-- invoice is printed.
--
-- `requires_preparation` is what makes a line a kitchen line at all
-- (`resolveKitchenRoutes` returns nothing for a line whose product does not
-- require preparation unless a route names it explicitly). Bread comes out of
-- the case, so Pan is false. Bottled kombucha is opened, not made, so it is
-- false too — and that is the change that moves them OFF the bar screen.
-- Everything else on the bar is made to order.
-- ---------------------------------------------------------------------------
insert into merchant.product_category (merchant_id, name, display_order, color)
select m.id, c.name, c.display_order, c.color
  from merchant.merchant m
  cross join (values
    ('Pan',      1, '#f58231'),
    ('Bebidas',  2, '#4363d8'),
    ('Pizzas',   3, '#e6194b')
  ) as c(name, display_order, color)
 where m.handle = 'onca'
on conflict (merchant_id, name) do nothing;

insert into merchant.product
  (merchant_id, category_id, name, price, tax_rate_basis_points, active,
   requires_preparation)
select m.id, c.id, s.name, s.price_centavos, 1600, true, s.requires_preparation
  from merchant.merchant m
  join (values
    -- Pan (21)
    ('Pan', 'Croissant',                 4500, false),
    ('Pan', 'Peppe',                     7000, false),
    ('Pan', 'Dona de azucar',            5000, false),
    ('Pan', 'Chocolatin',                6000, false),
    ('Pan', 'Peinado',                   8000, false),
    ('Pan', 'Danesa',                    5000, false),
    ('Pan', 'Coyota',                    3500, false),
    ('Pan', 'Trenza fresa',              5000, false),
    ('Pan', 'Trenza cajeta',             5000, false),
    ('Pan', 'Roll',                      5000, false),
    ('Pan', 'Dona de chocolate',         6000, false),
    ('Pan', 'Dona de cajeta',            5000, false),
    ('Pan', 'Burgir pack',               6500, false),
    ('Pan', 'Dona Limon',                6000, false),
    ('Pan', 'Coricos pack',              3000, false),
    ('Pan', 'Oreja',                     3500, false),
    ('Pan', 'Barra MM',                 13000, false),
    ('Pan', 'Hogaza MM',                12000, false),
    ('Pan', 'Chocorico',                 1000, false),
    ('Pan', 'Concha',                    4500, false),
    ('Pan', 'Pan de muerto',             4500, false),
    -- Bebidas (25)
    ('Bebidas', 'Espresso',                    5000, true),
    ('Bebidas', 'Americano',                   5000, true),
    ('Bebidas', 'Capuccino',                   6000, true),
    ('Bebidas', 'V60',                         8000, true),
    ('Bebidas', 'Aeropress',                   8000, true),
    ('Bebidas', 'Prensa',                      8000, true),
    ('Bebidas', 'Origami',                     8000, true),
    ('Bebidas', 'Moca',                        7000, true),
    ('Bebidas', 'Capuccino de olla',           6000, true),
    ('Bebidas', 'Dirty chai',                  7000, true),
    ('Bebidas', 'Carajillo',                  13000, true),
    ('Bebidas', 'Chai',                        6000, true),
    ('Bebidas', 'Matcha',                      7000, true),
    ('Bebidas', 'Latte',                       8000, true),
    ('Bebidas', 'Cold brew',                   8000, true),
    ('Bebidas', 'Americano limón natural',     8000, true),
    ('Bebidas', 'Americano limón mineral',     9000, true),
    ('Bebidas', 'Amanecer',                    9000, true),
    ('Bebidas', 'Té con jazmín',               5000, true),
    ('Bebidas', 'Kombucha kiwi',               5000, false),
    ('Bebidas', 'Kombucha manzana',            5000, false),
    ('Bebidas', 'Kombucha mango',              5000, false),
    ('Bebidas', 'Kombucha lichi',              5000, false),
    ('Bebidas', 'Kombu Fresa',                 5000, false),
    ('Bebidas', 'Kombu Mandarina',             5000, false),
    -- Pizzas (5)
    ('Pizzas', 'Margarita',                22000, true),
    ('Pizzas', 'Pepperoni con champi',     25000, true),
    ('Pizzas', 'Pepperoni sin champi',     25000, true),
    ('Pizzas', 'Tocino con queso de cabra', 25000, true),
    ('Pizzas', 'Mitad y mitad',            25000, true)
  ) as s(category_name, name, price_centavos, requires_preparation)
    on true
  join merchant.product_category c
    on c.merchant_id = m.id and c.name = s.category_name
 where m.handle = 'onca'
   -- The guard is (category, name), NOT name alone. `merchant.product` has no
   -- unique index on the name, and it should not: a café may sell "Americano"
   -- at the bar and "Americano" in a bottle at the same time. Keying this guard
   -- on the name would silently insert nothing on the re-run.
   and not exists (
     select 1 from merchant.product p
      where p.merchant_id = m.id and p.name = s.name and p.category_id = c.id
   );

-- Preparation targets, in seconds: what the KDS counts down once a ticket is
-- fired. Pizzas are 15 minutes; everything else at the bar is 5. Both are
-- owner-editable per product in the catalog screen.
update merchant.product p
   set preparation_target_seconds = case c.name
                                      when 'Pizzas' then 900
                                      else 300
                                    end
  from merchant.merchant m, merchant.product_category c
 where m.handle = 'onca'
   and p.merchant_id = m.id
   and p.category_id = c.id
   and p.requires_preparation
   and p.preparation_target_seconds is distinct from
       case c.name when 'Pizzas' then 900 else 300 end;

-- The variants. Eleven of the bar's drinks are sold in more than one style, and
-- the style carries the price. `pidx` is the display order the till shows them
-- in: Caliente, Frío, Nube.
--
-- `attributes` carries the style as data as well as in the name, because the
-- name is copy the owner may translate ("Iced" instead of "Frío") while the
-- attribute is what a future report groups by.
insert into merchant.product_variant
  (merchant_id, product_id, name, price_delta, attributes, display_order, active)
select m.id, p.id, v.variant_name, v.price_delta,
       jsonb_build_object('estilo', v.variant_name), v.display_order, true
  from merchant.merchant m
  join merchant.product_category c
    on c.merchant_id = m.id and c.name = 'Bebidas'
  join (values
    ('Americano',   'Caliente',     0, 0),
    ('Americano',   'Frío',      1000, 1),
    ('V60',         'Caliente',     0, 0),
    ('V60',         'Frío',         0, 1),
    ('Aeropress',   'Caliente',     0, 0),
    ('Aeropress',   'Frío',         0, 1),
    ('Origami',     'Caliente',     0, 0),
    ('Origami',     'Frío',         0, 1),
    ('Moca',        'Caliente',     0, 0),
    ('Moca',        'Frío',      1000, 1),
    ('Moca',        'Nube',      2000, 2),
    ('Dirty chai',  'Caliente',     0, 0),
    ('Dirty chai',  'Frío',      2000, 1),
    ('Carajillo',   'Caliente',     0, 0),
    ('Carajillo',   'Frío',         0, 1),
    ('Chai',        'Caliente',     0, 0),
    ('Chai',        'Frío',      1000, 1),
    ('Matcha',      'Caliente',     0, 0),
    ('Matcha',      'Frío',      1000, 1),
    ('Matcha',      'Nube',      2000, 2),
    ('Latte',       'Frío',         0, 0),
    ('Latte',       'Nube',      1000, 1),
    ('Cold brew',   'Frío',         0, 0),
    ('Cold brew',   'Nube',      1000, 1)
  ) as v(product_name, variant_name, price_delta, display_order)
    on true
  join merchant.product p
    on p.merchant_id = m.id and p.name = v.product_name and p.category_id = c.id
 where m.handle = 'onca'
on conflict (product_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- 8 · What the KDS shows.
--
-- ONE default route and ONE category route, which together say:
--   · a line that requires preparation, and matches nothing else -> the bar
--   · anything in Pizzas                                        -> the pizza oven
--   · a line that does NOT require preparation and is not named
--     explicitly by a route                                      -> no ticket
--
-- That last clause is why the bottled kombuchas never reach a screen, and it is
-- the whole reason this is two rows instead of one route per product:
-- `kitchen_route_category_uidx` makes a category route reach EVERY product in
-- the category, so routing Bebidas by category would put a kombucha on the bar
-- screen along with the espresso. Routing by default does not.
--
-- The precedence is in `resolveKitchenRoutes`: product route, then category
-- route, then default. So a pizza hits the category route and not the default.
-- ---------------------------------------------------------------------------
insert into merchant.kitchen_route
  (merchant_id, location_id, product_id, category_id, station_id,
   requires_preparation, route_priority, target_seconds, active)
select m.id, l.id, null, null, s.id, true, 100, 300, true
  from merchant.merchant m
  join merchant.location l on l.merchant_id = m.id
  join merchant.station s on s.merchant_id = m.id and s.key = 'barra'
 where m.handle = 'onca'
   and not exists (
     select 1 from merchant.kitchen_route r
      where r.merchant_id = m.id and r.location_id = l.id
        and r.product_id is null and r.category_id is null and r.active
   );

insert into merchant.kitchen_route
  (merchant_id, location_id, product_id, category_id, station_id,
   requires_preparation, route_priority, target_seconds, active)
select m.id, l.id, null, c.id, s.id, true, 100, 900, true
  from merchant.merchant m
  join merchant.location l on l.merchant_id = m.id
  join merchant.product_category c on c.merchant_id = m.id and c.name = 'Pizzas'
  join merchant.station s on s.merchant_id = m.id and s.key = 'pizzas'
 where m.handle = 'onca'
   and not exists (
     select 1 from merchant.kitchen_route r
      where r.merchant_id = m.id and r.location_id = l.id
        and r.product_id is null and r.category_id = c.id and r.active
   );

-- ---------------------------------------------------------------------------
-- 9 · Say what happened.
--
-- A migration that prints nothing gives the operator no evidence, and the
-- maintenance window is when evidence matters. These counts are read from the
-- tables rather than incremented, so the numbers are true on a first apply AND
-- on a re-run — where they are the same numbers.
-- ---------------------------------------------------------------------------
do $$
declare
  m_id      uuid;
  c_menu    integer;
  c_prep    integer;
  c_var     integer;
  c_routes  integer;
  c_station integer;
begin
  select id into m_id from merchant.merchant where handle = 'onca';

  select count(*) into c_menu    from merchant.product           where merchant_id = m_id;
  select count(*) into c_prep    from merchant.product           where merchant_id = m_id and requires_preparation;
  select count(*) into c_var     from merchant.product_variant   where merchant_id = m_id;
  select count(*) into c_routes  from merchant.kitchen_route     where merchant_id = m_id and active;
  select count(*) into c_station from merchant.station           where merchant_id = m_id and status <> 'archived';

  raise notice
    '002_onca_onboarding: ONCA present. % products (% require preparation), '
    '% variants, % stations, % kitchen routes. No login and no devices were '
    'created — invite the owner from the dashboard, then enrol each tablet '
    'from the app.', c_menu, c_prep, c_var, c_station, c_routes;
end $$;
