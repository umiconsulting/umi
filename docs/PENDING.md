# Pending work

Last updated: 2026-10-06, after the register and Wallet switches were flipped,
`build-v3` was retired, and ONCA's café landed as a migration.

This is the single list of what is still open, across the platform and the device
package. Each item says what it is, why it matters, and what unblocks it. Nothing here
is a surprise to whoever reads it next — that is the point of writing it down.

## 1. Security, still deferred

| Item                                                                                                                                                                                                                                                                 | Why it matters                                                                                                                                                         | What unblocks it                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rotate `api_login` / `worker_login` passwords.** The API and the worker already connect as these roles (not as `postgres`) — that part of the cutover runbook is done — but their passwords were printed in full during the cutover and must be treated as exposed | Anyone with those passwords and the pooler host has the app's full database access                                                                                     | A quiet window: `ALTER ROLE … PASSWORD`, update the two URLs in `apps/umi-api/.env` on the VPS, recreate the containers                                                                                                                     |
| **Freeze the legacy schemas.** `REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core, grow, loyalty, ops FROM api, worker, readonly`                                                                                                                           | Nothing writes them any more — the register and the Wallet both read the new schemas — and a frozen schema is what makes "the cutover is done" true rather than likely | ⚠️ Verify first which role **umi-cash** connects as. If it is `postgres`, revoking from `api`/`worker` does not restrain it. The one route it still serves that writes is the manual `/api/umi/push-passes`, superseded by the API's resync |
| **Rotate the café admin passwords** used during the cutover (`admin@kalalacafe.mx`, `admin@elgranribera.mx`) — they appeared in plain text in the working chat                                                                                                       | Same class as the role passwords                                                                                                                                       | The cafés' own schedule; the dashboard has a password change                                                                                                                                                                                |
| **Turn wireless debugging off** on the three Android devices when commissioning ends (`docs/pilot/UMIPOS_SITE_DEVICE_INVENTORY.md` §9)                                                                                                                               | It is a full shell on a point-of-sale device                                                                                                                           | The end of the site visit                                                                                                                                                                                                                   |

## 2. Platform, in the order that makes sense

1. **PR #205** (`fix/clean-the-escaped-object-id`) is green and unmerged. It changes only the
   failure _count_ a manual pass resync reports, so it can wait for a quiet window — it needs
   a container roll.
2. **`umi-cash` → Cloudflare.** It no longer needs a database for what it still serves (the
   Wallet prefix and the frozen register prefix both forward to the API), so the last reason
   to keep it on Vercel is gone.
3. **Node 24.** `npm` reports deprecation warnings on the runners and the Dockerfiles still
   pin `node:22-alpine`; the dashboard declares `engines: 22.x`. Read the security news before
   moving, then update the three Dockerfiles and the six CI jobs together.
4. **Decide the four stale unmerged branches**: `chore/dependabot-security-fixes` (PR #34),
   `feat/customer-overview-kpis-ai-portrait`, `feat/llm-completion-seam`,
   `feat/mesas-and-cash-center-update`, `fix/umipos-demo-build-defines`. Each is either
   merged, closed, or rebased — none should stay in limbo.
5. **Close PR #184.** It was superseded by #206 (same fix, re-landed on `main`). Its branch
   `fix/umipos-enrollment-diagnostics` is also the one checked out in the local
   `umi-buildv3` worktree, which should be renamed — the branch it is named after no longer
   exists.
6. **Consider a ruleset for `staging`.** `main` is protected; `staging` is not, and it is now
   the environment every change passes through on its way there.
7. **Merge order, the way the branches depend on each other.** #206 and #207 first (they are
   what lets any device enrol at all), then #205 in a quiet window (it needs a container roll),
   then #208 (the staging workflow), and then `feat/onca-onboarding` into `staging`, which
   should carry `main` with it.

## 3. Local working tree

Three files exist only in the local `umi-buildv3` worktree and are **not** in `main`:

| File                                                     | What it is                                         |
| -------------------------------------------------------- | -------------------------------------------------- |
| `docs/design/UMIPOS_IPHONE_DESIGN.md`                    | The iPhone POS design spec, draft for owner review |
| `docs/research/2026-10-04-ios-pos-design-constraints.md` | The iOS constraints and open decisions behind it   |
| `apps/umi-pos/test/render/order_surface_render.dart`     | A rendering probe for the order surface            |

They belong to the iOS workstream, not to the device package, and they should land on
`staging` → `main` with the rest of that work rather than being lost with the worktree.

## 4. The device package (client: ONCA)

The hardware is a package borrowed from a café/restaurant, driven by Parrot today, moving to
Umi. `docs/pilot/UMIPOS_SITE_DEVICE_INVENTORY.md` is the physical record; its §0 says where
the commissioning stands.

| Piece                                                  | State                                                                                                                                                                                                                                                                                                                                                       | Unblocked by                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ONCA as a merchant                                     | **Written, not merged.** `docs/migration/build-v3/migrations/002_onca_onboarding.sql` creates the café (handle `onca`), its site, two stations, the loyalty ladder, the `pro` subscription plus the `pos` override, the CASH register and shift policy, and the 51-product menu. Applied twice clean on a pristine build, and the security gate stays 48/48 | Merging `feat/onca-onboarding` into `staging`, then the same file onto `main`                                                                             |
| **ONCA's first login**                                 | **Deliberately absent.** `002` creates no `umi.user`, because only the API hashes a password                                                                                                                                                                                                                                                                | Invite the owner from the dashboard (`POST /staff` + the reset link). The platform's `hola@umiconsulting.co` login already sees every café as super_admin |
| ONCA's menu, mapped                                    | Done and evidenced against real sales: `docs/pilot/ONCA_MENU_TO_UMI_MAPPING.md`. 64 legacy rows became 51 products × 24 variants across 3 categories                                                                                                                                                                                                        | Client confirmation of the IVA and of the open items in §6 of that file                                                                                   |
| Offline cash for ONCA                                  | **Off, by design.** `002` writes no `merchant.pos_offline_cash_policy`, so a dropped uplink means the till cannot commit a sale                                                                                                                                                                                                                             | The decision in `docs/pilot/ONCA_OFFLINE_FIRST_DESIGN.md` §6.1, and the drill in its §7                                                                   |
| Enrolling any device                                   | **Was blocked** — the app sent `platform: 'Android'`/`'iOS'` where the contract requires lower case, so the API refused every claim with a 400. Verified live                                                                                                                                                                                               | Merging #206 (the client fix) and #207 (the release build's `INTERNET` permission, below)                                                                 |
| iMin D3-504 (counter till, `pos_terminal` · `static`)  | UmiPOS installed and reaching `readyForAuthentication`; the cash drawer hangs off this device                                                                                                                                                                                                                                                               | Install the artifact in `/home/juan/umi-pos-builds/`, then enroll                                                                                         |
| Galaxy Tab A9+ (`kds`)                                 | UmiPOS not installed                                                                                                                                                                                                                                                                                                                                        | Same                                                                                                                                                      |
| Galaxy Tab A11 (mobile POS, `pos_terminal` · `mobile`) | UmiPOS not installed                                                                                                                                                                                                                                                                                                                                        | Same                                                                                                                                                      |
| Epson TM-T20III                                        | On Ethernet per the rear panel; not on a network yet                                                                                                                                                                                                                                                                                                        | An IP, a port 9100 test, and the paper width and character set confirmed. The printer is also the cash drawer's opening path                              |
| Cash drawer                                            | **Not available right now** — deliberately last                                                                                                                                                                                                                                                                                                             | The printer on the network, then a test pulse                                                                                                             |
| TP-Link Archer C50                                     | Still `TP-Link_AE61` / `_5G`, and it is the whole package's network                                                                                                                                                                                                                                                                                         | Rename the SSIDs to Umi, rotate the Wi-Fi password, pin DHCP reservations **by hardware MAC** (both tablets randomise the per-network MAC)                |
| Access for commissioning                               | Wireless debugging on the three devices, workstation on the same network                                                                                                                                                                                                                                                                                    | The site visit                                                                                                                                            |

### The offline-first answer

The TP-Link is not just a router in this design: it is the local network the till, the KDS,
the handheld and the printer share, and therefore the only thing that keeps working when the
Internet does not. That is now written down, in
`docs/pilot/ONCA_OFFLINE_FIRST_DESIGN.md`, and its two uncomfortable findings are worth
repeating here: **the kitchen screen is the one device a WAN outage takes away entirely**
(a ticket is a server-side projection, so no server means no ticket), and **the till's cash
path offline is a decision nobody has made yet** — it is off until an
`pos_offline_cash_policy` with real bounds exists, and it should be on before the first
service runs on this package. The note also carries the seven-step drill, which is the only
thing that turns any of it from a design into a fact.

## 5. Repository hygiene, done tonight

For the record, so nobody looks for them: `build-v3` and 36 other merged branches were
deleted, along with the `build-v3 protection` ruleset (kept at `/tmp/buildv3-ruleset.json`
only for the record — the branch it protected no longer exists). `main` and `staging` remain,
plus the unmerged work listed above.

The flow from here is the orthodox one, and it is the one this branch is already following:
**local → `staging` → `main`**, with each step a PR. `feat/onca-onboarding` is based on
`staging`, which now carries `main` and the new staging deploy workflow
(`api-staging.umiconsulting.co/health` reports `ok / Healthy`, schema `build-v3-79`), so a
migration rehearsed here is rehearsed against the same schema the café will run.
