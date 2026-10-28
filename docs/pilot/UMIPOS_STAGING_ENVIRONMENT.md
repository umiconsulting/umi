# The staging environment, and how to put a device on it

Status: `WORKING AND VERIFIED ON REAL HARDWARE`, 2026-10-16.
Scope: `api-staging.umiconsulting.co`, the QA stack on the VPS, and the four
things that went wrong in getting devices onto it.

## 1. What staging is

| Piece        | Value                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| API          | `https://api-staging.umiconsulting.co` — the prod Caddy fronts it              |
| Host         | `juan@2.24.204.15` (Tailscale `100.68.235.92`), compose project `umi-api-test` |
| Compose file | `deploy/staging/compose.yml`, resolved from `/home/juan/umi-staging`           |
| State        | `/home/juan/umi-api-test` — `.env`, `certs/`, `secrets/` (not in git)          |
| Database     | `umi_staging` on `umi-api-test-postgres-staging-1`, same box as the API        |
| Own secrets  | its own `JWT_SECRET`, database and domain — nothing shared with production     |

To put staging on the same _artifact_ production runs, set `UMI_API_TAG` in
`/home/juan/umi-api-test/.env` to production's image tag and roll:

```sh
cd /home/juan/umi-staging
docker compose --project-name umi-api-test \
  --project-directory /home/juan/umi-api-test \
  -f deploy/staging/compose.yml pull
… up -d
```

Back the `.env` up first. The next push to the `staging` branch will re-roll the
tag from whatever CI built, so this is parity by hand, not by pipeline.

## 2. What staging does NOT have

Comparing the two environments' `.env` keys, production holds 54 and staging 42.
The twenty-one production-only keys are provider credentials: `FCM_PROJECT_ID`,
`GOOGLE_APPLICATION_CREDENTIALS`, the Apple APN and Wallet pair, `SMTP_USER` /
`SMTP_PASSWORD`, `PLANE_DOMAIN`, `OBSERVABILITY_SCHEMA`, `WALLET_PUBLIC_ORIGIN`.

So staging is production-equivalent in **code, schema and permissions**, and not
in **push, wallet, mail and accounting integrations**. The visible consequence:
every till that starts against staging logs `POST /push-tokens` → **503**, and
the KDS falls back to its poll loop rather than the push nudge.

**That 503 is cheap, and it is worth knowing exactly how cheap before anyone
goes hunting.** Over three hours of a working session staging logged 39 attempts,
and they are not a retry loop: they arrive in bursts of exactly four inside about
one second, minutes apart, one burst per app launch. Four failed calls per start,
nothing in between — a forty-minute quiet window logged zero. So a till running
against staging pays four 503s at boot and nothing thereafter, which is why this
is a parity gap to close when it is convenient rather than a fault to chase.

One more, worth knowing before it looks like a bug: the ledger can lie. Staging
reported `expectedSchemaVersion: build-v3-79` and its `runtime.schema_migration`
table said `build-v3-79`, while the objects those migrations create were absent.
`/health` cannot see this class of drift — it would have called staging healthy
right up until a barista tapped a product.

## 2.1 The floor plan was empty — it is now seeded

The location on staging shipped with no tables:

```sql
select count(*) from merchant.floor_plan;   -- was 0, now 1
select count(*) from merchant.table_state;  -- still 0: created when a table is used
```

That emptiness is not cosmetic. It produced three symptoms, in increasing
surprise:

1. Cuentas read _"Aún no hay mesas / Crear mesas"_ with a table count of zero.
2. Firing an account that has no table raised the first-use prompt _"Agrega tus
   mesas"_, which from the outside looks like "Enviar a cocina" opening the wrong
   dialog.
3. **The step "on the handheld, set the table to eating" could not be completed
   at all**, whatever the state of the handheld. There was no table to set.

Seeded through the API, as the merchant admin — no console needed:

```sh
PUT  /api/merchants/{merchantId}/floor-plan           # {locationId, expectedVersion, idempotencyKey, document}
POST /api/merchants/{merchantId}/floor-plan/publish   # {locationId, expectedVersion, idempotencyKey}
```

The document is one area of four square tables; `FloorPlanDocument` in
`packages/contract/src/floor-plan.ts` carries the shape. `expectedVersion` starts
at 0 and every write returns the new one, so save-then-publish is version 1 then 2. Publication is what the till reads — a saved draft alone changes nothing on the
screen.

Verified on the iMin: the Cuentas screen now reports **4 mesas** and lays out
Mesa 1–4 on the Salón map, with the state legend the floor plan exists to drive —
**Libre · Ocupada · Pedido tomado · Servido · Por cobrar · Por limpiar**. Those
are the states "set the table to eating" is asking about.

The state machine was exercised on the till, not just read: tapping Mesa 1 offers
**Abrir cuenta · Sentar · Seleccionar**, and _Sentar_ opened **Cuenta 002 bound to
Mesa 1**, moved the table to an occupied colour with a live service timer (`33 s`),
and wrote `merchant.table_state.state = 'seated'` on staging. So the capability
the handheld was going to demonstrate is confirmed working against this
environment; what is missing is only the handheld.

## 3. Building a device for staging

The API base URL is a **compile-time** `--dart-define`, so no installed device
can be repointed by configuration. The recipe:

```sh
flutter build apk --profile --flavor staging --target-platform android-arm64 \
  -PumiposApplicationId=co.umiconsulting.umi_pos.estacion \
  --dart-define=UMIPOS_ENVIRONMENT=staging \
  --dart-define=UMIPOS_API_BASE_URL=https://api-staging.umiconsulting.co \
  --dart-define=UMIPOS_DEVICE_KEY= \
  --dart-define=UMIPOS_CONTRACT_VERSION=2.39.0 \
  --dart-define=UMIPOS_RELEASE_VERSION=0.1.0 \
  --dart-define=UMIPOS_RELEASE_GIT_COMMIT=<40-hex sha> \
  --dart-define=UMIPOS_RELEASE_BUILD_TIMESTAMP=<UTC iso> \
  --dart-define=UMIPOS_CONFIG_SCHEMA_VERSION=1 \
  --dart-define=UMIPOS_DEVELOPMENT_DIAGNOSTICS=false \
  --dart-define=UMIPOS_FEATURE_BOOTSTRAP=disabled \
  --dart-define=UMIPOS_HARDWARE_SIMULATOR_ENABLED=false
```

Three of those are not optional and each fails in its own way:

- **`UMIPOS_ENVIRONMENT` must equal the flavour.** `android/app/build.gradle.kts`
  throws otherwise.
- **`UMIPOS_DEVELOPMENT_DIAGNOSTICS=true` is refused outright** in
  staging/pilot/production — `PILOT_CONFIGURATION_UNSAFE`. Wanting the diagnostic
  log in staging is exactly what the guard is there to stop, and it costs a
  rebuild to find out.
- **The release identity must be complete.** `RELEASE_IDENTITY_INVALID` unless the
  commit is a full 40-hex sha and the timestamp parses as UTC.

Build with `--profile`, never `--debug`: a debug build is JIT and its timings are
not the product's.

### Main station and LAN peers

The main station adds `UMIPOS_LAN_NODE=host`. It runs the local KDS node on port
4244. Every other POS or KDS device adds the main station address as
`UMIPOS_LAN_HUB`:

```sh
--dart-define=UMIPOS_LAN_HUB=http://192.168.0.10:4244
```

The peer also discovers `_umi-pos._tcp.local` with DNS-SD. The configured URL is
the fallback when multicast is unavailable. Do not set `UMIPOS_LAN_NODE=host` on
a peer.

### Pilot Wi-Fi network

The TP-Link Archer C50 v6 that served the Parrot POS deployment was reset and
rebuilt as the UmiPOS service network on 2026-10-17:

| Setting | Value |
| --- | --- |
| SSID (2.4 GHz) | `UmiPOS` |
| SSID (5 GHz) | `UmiPOS-5G` |
| Security | WPA2-PSK (AES) — WPA3/SAE off for tablet compatibility |
| Gateway | `192.168.0.1` |
| DHCP pool | `192.168.0.100`–`192.168.0.249`, 120-minute leases |
| iMin D3 reservation | `D0-C8-57-4A-11-6D` → `192.168.0.10` |
| WAN | DHCP behind the venue router (internet for cloud replay) |
| WPS | Disabled |

The Wi-Fi passphrase and the router administrator password live in the pilot
credential sheet, not in this repository. Android tablets must use the **device
MAC** (not a randomized MAC) on `UmiPOS` so the `.10` reservation matches.

The router's WAN port is on the venue LAN, so the UmiPOS network has its own
subnet and NAT: devices keep talking to each other at layer 2 while cloud calls
go out through the venue router. That is the topology the LAN lane assumes.

## 4. Enrolling a device

The app asks for an eight-character code that the administrator generates. Over
the API, as an admin:

1. `POST /api/auth/local/login` (cookie session), then send
   `X-UMI-CSRF` from the `umi_csrf` cookie on every write. Without it, writes
   answer **403** and read like a permission problem.
2. `POST /api/v1/merchants/{id}/devices/enrollment` → `setupCode`.
3. Type the code on the device. It claims the request; the request moves to
   `awaiting_approval`.
4. `POST /api/v1/merchants/{id}/devices/enrollment-requests/{requestId}/approve`
   → `credential_ready`, then the device lands on the operator PIN.

The code expires **five minutes** after it is issued, which is shorter than it
feels when you are walking between two devices.

## 5. The four things that went wrong

| Symptom                                                                    | Cause                                                                                                                                                       | Fix                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Recovery card: _"no puede iniciar de forma segura con esta configuración"_ | `UMIPOS_DEVICE_KEY=keystore`. The keystore-backed key fails on this iMin and surfaces as `apiUnavailable`, which reads like a network fault.                | Build with an empty device key, as the device reports already did. |
| `ENROLLMENT_REJECTED` on every code, request stuck at `created`            | The claim only succeeds when `request.deviceKind === input.deviceType`, and **the app always claims `pos_terminal`**. A `kds` request can never be claimed. | Create the request as `pos_terminal`; the role is chosen in-app.   |
| Device hangs on _"Comprobando tu terminal"_                                | A credential for the other environment is still in app storage.                                                                                             | `adb shell pm clear <package>`, then enrol.                        |
| _"Tu rol no permite mover la cocina"_ on the KDS                           | `kitchen.ready` is held by admin/manager/owner/super_admin/supervisor. A `staff` operator can read the board and not move it.                               | Give the kitchen operator a role that holds `kitchen.ready`.       |

One rule that is not a defect, but surprises: **one operator, one terminal
session.** A second device signing in as the same operator is refused with _"este
usuario ya tiene una sesión abierta en otro POS"_. A three-device shift needs
three people, which is also how a café runs.

## 6. The register was assigned to nobody, so cash could not be taken

`merchant.physical_register` shipped with the ONCA onboarding and looked healthy:
one row, `Caja 1`, `active`, `status = available`, `allowed_device_classes =
{pos_terminal}`. But:

```sql
assignment_policy  = 'device_required'
assigned_device_id = NULL
```

`device_required` with no device means **no terminal can open a shift on it**, and
without a shift the till refuses cash: _"El cobro no tiene un turno de caja al cual
abonar el efectivo."_ The Cash Centre's register picker reads `—` and is disabled,
so the operator cannot fix it from the till either. This is the trap
`docs/development/LOCAL_VERIFICATION_PLAYBOOK.md` names — "a register that still
names an old device keeps _Abrir turno de caja_ disabled" — arriving on staging
because the register was created before any device existed to name.

Assigned to the till, mirroring the statement the product's own administrative
command runs (`apps/umi-api/src/modules/administrative-commands/administrative-command.repository.ts`):

```sql
UPDATE merchant.physical_register
   SET assigned_device_id = '<till device id>'::uuid, status = 'available',
       version = version + 1
 WHERE merchant_id = '<id>' AND location_id = '<id>';
```

**The app caches its register list.** The till kept showing `—` after the
assignment, through a refresh of the Cash Centre; only restarting the app picked
it up, and the picker then read **Caja 1**. Worth knowing before concluding that
an assignment did not work.

Two more things this path taught, both worth recording:

- **The tender sheet offers cash only**, because the location has no
  card option. That is not a missing row: `040_onca_checkout_policy.sql` writes one
  deliberately, `onca-initial-cash-only-v1`, with `manual_terminal_enabled`,
  `bank_transfer_enabled` and `mixed_tender_enabled` all false and
  `maximum_tender_lines` 1. The till is meant to take cash here, and
  `merchant.pos_offline_cash_policy` is empty for the same reason — so the
  _"Efectivo sin conexión: Requiere conexión"_ line in the Cash Centre is the
  policy working, not a gap to close.
- Opening its tender sheet is the **heaviest tap measured** at 294 ms (59 ms of it
  frame build), against a ~114 ms floor for a keypad digit.
- The cash policy the till loads is `onca-commissioning-v1`: blind count,
  tolerance MXN 5.00, maximum float MXN 2,000.00, PIN required for movements from
  MXN 2,000.00, and **Efectivo sin conexión: Requiere conexión** — the offline cash
  policy is off, exactly as `ONCA_OFFLINE_FIRST_DESIGN.md` §6.1 says it is.

### 6.1 The whole flow now closes on staging

Opening the shift needed nothing more than the right tap target: with the float
counted the button at `(920, 938)` opened it, and `merchant.cash_shift` went to
one row, `status = open`, `opening_float_minor_units = 20000` (MXN 200). Every
earlier attempt had aimed at y=851 or y=880, which is the empty space above it —
the instrument reported `STALLED` for each one, which is how the misses were
caught rather than being read as a disabled control.

With the shift open, one order went from start to settled on staging:

1. Mesa 1 seated → **Cuenta 002**, `table_state.state = 'seated'`
2. Americano Caliente added → MXN 50.00, tax MXN 6.90 inside
3. Sent to the kitchen → **En cola**, and the KDS board showed it
4. Charged → tender sheet, cash, change MXN 0.00
5. **Pagado — MXN 50.00**, confirmed on the till with _Ver comprobante_

and the database agrees: `merchant.payment` 1 row, `merchant.cash_ledger_entry`
2 rows (the opening float and the cash sale), both under the open shift.

That is staging taking money end to end.

### 6.2 The fleet, and the waiter's step

All three terminals are enrolled against staging and active:

| Device         | Name          | kind           | mobility | Operator    |
| -------------- | ------------- | -------------- | -------- | ----------- |
| iMin D3-504    | Caja iMin     | `pos_terminal` | static   | Admin ONCA  |
| Galaxy Tab A9+ | KDS Cocina    | `pos_terminal` | static   | Cocina ONCA |
| Galaxy Tab A11 | Comandera A11 | `pos_terminal` | mobile   | Mesero      |

The handheld was the last one in, and the only thing that had been missing was
power. Its enrolment was the standard three steps, and note what it confirms: the
app claims as `pos_terminal` even on the device meant to be a handheld, so a
`mobile` **mobility** is set at enrolment while the **kind** stays `pos_terminal`.

The waiter's table flow, exercised on the A11 against staging — the step the
whole exercise was originally about:

```
Mesa 1 (Ocupada, 1:02 h) → Marcar servido → table_state.state = 'served'
```

The handheld's table menu is the full waiter set: **Abrir cuenta · Mover · Pedido
enviado · Marcar servido · Pedir la cuenta · Liberar mesa**. _Marcar servido_ is
the "eating" equivalent, and the map re-coloured the table and updated its state
badge on the A11 and, through the API, everywhere else.
