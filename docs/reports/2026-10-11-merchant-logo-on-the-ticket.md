# The café's own logo: uploaded in the console, printed on the ticket

Date: 11 October 2026, 17:19–17:56 MST. The owner asked for the place's icon on the ticket, and
for the dashboard to be where it is uploaded, before there is anywhere to upload images. They then
chose the option that keeps the bytes in our own database and said the one thing that worried them
about it: _"solo me preocupe almacenar tanto en la base"_.

## Where the bytes live, and why the worry is answered with a number

One row per café in `merchant.merchant_branding_logo` (migration `014`), and `merchant.logo_url`
points at it. `logo_url` was already the field every reader used — the Apple and Google pass
builders, the POS register shape — and **nothing wrote it**; a café created after the cutover had
no logo anywhere except a hand-placed file in umi-cash's `public/`. This closes that hole without
inventing a second field for anyone to learn.

The size worry is handled by refusing to store what was uploaded:

| Guard                                             | Where                                                      |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Every upload is re-encoded to fit 768 px          | `merchant-branding.service.ts`, `resize({fit:'inside'})`   |
| A PNG over 256 KiB becomes a JPEG                 | same service, fallback that re-encodes rather than refuses |
| Nothing over 256 KiB can reach the row            | `CHECK (octet_length(bytes) between 1 and 262144)`         |
| A 4 000 × 4 000 photo cannot be decoded as a bomb | `limitInputPixels` in sharp                                |
| A phone photo never travels whole                 | the console shrinks it first (`data.jsx`, 768 px canvas)   |

A logo written on a 203 dpi receipt is 384 dots wide, so 768 px is already twice what the paper can
show. The measured cost on this walk: a 900 × 300 PNG went in and the stored row is **19 655 bytes**
— a thousand cafés of the same are ~20 MB in a table Postgres TOASTs anyway. The bytes are also
content-addressed: the asset's name carries the SHA-256 of what is stored, so a new upload is a new
URL and no cache anywhere has to be busted.

## The path, end to end

| Leg                                      | What happens                                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Ajustes → `Logo del negocio`             | file picker → canvas 768 px → PNG (JPEG if the PNG exceeds the cap) → base64 → `PUT /api/merchants/:id/branding/logo`                     |
| `merchant-branding.service`              | decodes, checks the magic bytes against the declared type, normalises, digests, then writes **the row and `logo_url` in one transaction** |
| `GET /logos/:asset` (public, no session) | serves the bytes with `ETag`, `Content-Type` and `Cache-Control: public, max-age=31536000, immutable`                                     |
| The till                                 | the receipt snapshot carries `merchantLogoUrl`, frozen at commit, and the paper draws it above the café's name                            |
| Apple / Google Wallet                    | the pass builders already fetched `logoUrl`; they now find one there                                                                      |

`DELETE` on the same URL empties both the row and `logo_url`, so a café that wants its old logo gone
does not have to upload a blank one.

### Per merchant, which is the part the owner asked about

The table's key **is** the merchant, and three independent things keep the logos apart:

1. the write is scoped by the merchant in the URL, and `MerchantAccessGuard` refuses a caller who
   is not a member of it;
2. the row is under `FORCE ROW LEVEL SECURITY` with the merchant isolation policy;
3. **the asset name carries the merchant id**, and the public read opens the same scoped
   transaction for that merchant — so the till, the wallet builders and a browser can fetch a logo
   without a session, and still cannot reach another café's bytes.

Measured against two cafés in the same database:

| Check                                                      | Result                           |
| ---------------------------------------------------------- | -------------------------------- |
| Upload for the café the caller is NOT a member of (`ONCA`) | `404 merchant_not_found`         |
| Asset named for that other café                            | `404`                            |
| Asset mixing one café's id with a digest it does not have  | `404`                            |
| The café's own asset                                       | `200`, 19 655 bytes, `image/png` |

## Verified

| Step                                                                          | Evidence                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------ |
| The console card: upload, "Logo actualizado", preview loads through the proxy | `00-before.png`, `01-after-upload.png`           |
| Remove: the preview goes back to `Sin logo`                                   | `02-after-remove.png`                            |
| Upload again, and the same content-addressed URL                              | `03-uploaded-again.png`, `walk.json` (6/6 steps) |
| A sale on the iMin D3-504, then `Ver comprobante`                             | `10-imin-receipt-with-logo.png`                  |
| `Ventas → Abrir recibo` (the reprint) shows the same mark                     | `11-imin-reprint-with-logo.png`                  |
| The uploaded file itself                                                      | `uploaded-logo.png`                              |

Tests: API **1802 pass** (8 new: the normalisation, the fallback origin, the refusals, the
content-addressed miss, and the two-statement transaction), dashboard **355 pass** (4 new: the
route, the type refusal, the 768 px fit, the JPEG fallback), POS **707 pass** (2 new: the mark on
the paper and its absence when there is none), contract **83 pass**, `flutter analyze`, `tsc
--noEmit`, `eslint` and the lint-warning baseline all clean.

The instrument is `tools/ux-sweep/dashboard-merchant-logo.mjs` — real clicks in the real browser,
and it asserts that the image **loaded** (`naturalWidth > 0`), not just that a URL was written.

## What the owner should know

- **The logo can only be uploaded by an owner or an admin.** The route asks for
  `merchant.manage`, which only those two roles carry. In this demo database ONCA's members are all
  `staff`, so ONCA's logo cannot be set from the console until the café has an owner/admin
  membership — the API refuses with `404 merchant_not_found` (a non-member) or `403` (a member
  without the permission). This is the same rule every other merchant-settings write follows, not
  something new for the logo.
- **Two deployment facts have to be true for the till and the passes:** `PUBLIC_API_URL` (or, as a
  fallback, `WALLET_PUBLIC_ORIGIN`) must be set, or the stored URL is relative and only the console
  will resolve it; and Caddy's `/api` matcher must include `/logos/*`, which it now does. The dev
  proxy learned `/logos` too, so a preview in `vite dev` is not a 404 of the SPA.
- **The receipt's logo is frozen.** The URL is in the snapshot like every other fact on that paper,
  so a reprint shows what the customer was handed even after the café changes its mark.
- **The migration has to be applied by hand wherever the console is used.** This is the folder's
  rule (`docs/migration/build-v3/migrations/README.md`: a post-cutover change is a file here), and
  the workstation shows the failure mode plainly: the console the owner runs proxies to the API on
  `:4001`, that API's database has no `merchant.merchant_branding_logo`, and `GET /logos/<a real
name>` answers **500** there while `:4013` (the demo database, where `014` was applied) answers
  `200`. Nothing in the deploy chain applies this folder — `deploy/pilot/migrate.sh` branches on the
  recorded version and, from `EXPECTED_SCHEMA_VERSION` on, only runs `99_verify.sql`.
- **Not done yet:** rasterising the mark for ESC/POS paper (the physical printer is still not on
  the network, which is why printing itself remains unmeasured), and the wallet preview inside the
  card (that preview is Umi Cash–gated, and the card itself is not).

## The harness, so anyone can repeat it

```sh
# the API the till reaches (adb reverse tcp:4013 tcp:4013)
cd apps/umi-api && npm run build
setsid bash -c 'set -a; source /tmp/umi-api-4013.shellenv; set +a; exec node dist/main.js' \
  >/tmp/umi-api-4013-new.log 2>&1 &
# a console that talks to it, on its own port so the owner's :4000 is untouched
cd apps/umi-dashboard && VITE_DEV_PORT=4020 VITE_API_PROXY_TARGET=http://127.0.0.1:4013 \
  npx vite --host 127.0.0.1
./scripts/ux-browser.sh          # the harness browser, on a workspace of its own
UX_BASE=http://127.0.0.1:4020 UX_OWNER_EMAIL=<owner> UX_OWNER_PASSWORD='<pw>' \
  node tools/ux-sweep/dashboard-merchant-logo.mjs <logo.png> <outDir>
```

Two fixture notes, both in the disposable demo database and both reversible: `owner@umipos.local`
was given a local credential so the console could be signed into, and the `umipos-local` plan was
given the `dashboard` feature — without it the settings surface answers `403 product_not_active`,
which is the entitlement working, not the logo failing.

## ONCA, the café this was asked for (18:05–18:20 MST)

The logo could be _built_ for ONCA but not _set_ there: migration `002` seeded the café with four
logins — `caja@`, `barra@`, `cocina@` and `mesero@onca.mx` — and every one of them is `staff`, so
nobody at ONCA held `merchant.manage` and the upload answered `403`. `scripts/onca-admin-fixture.sql`
adds the missing person: `admin@onca.mx`, active, local credential, employed at ONCA with the
`admin` role and scoped to its one location. It is re-runnable (both statements carry their
identity) and its password is the shared local rehearsal one (`Umi2026!`), documented in
`docs/development/LOCAL_VERIFICATION_PLAYBOOK.md` and the same shape the other fixtures use.

Then ONCA was walked as that administrator, in the console, with real clicks
(`tools/ux-sweep/dashboard-onca-sample.mjs`, **9/9 steps**):

| Check                                                     | Result                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Sign-in, and the shell names the café                     | `Good afternoon, ONCA.` · breadcrumb `ONCA · ONCA` · `Admin ONCA`            |
| Four screens render                                       | Overview, Products, Customers, Settings — every marker present               |
| **ONCA's own data**, not a café's heading                 | the recovered menu rendered — `Aeropress`, `Amanecer` (`05-onca-menu.png`)   |
| The logo, uploaded through the card as this administrator | `…/logos/e6b14af1-…-bb98785b021d90f7.png`, 768 px, **loaded** in the preview |
| The Wallet pass preview draws the same URL                | `07-onca-pass-and-logo.png`                                                  |
| The row, per café                                         | ONCA and UmiPOS Local each hold their own logo, each named for its own id    |
| The public asset                                          | `200`, `image/png`, 16 182 bytes                                             |

One thing the walk saw and did not chase, said plainly because it is an observation and not a
verdict: ONCA's **Products** screen reads `20 products` while the café has **51 active rows** in
`merchant.product`. Whether that is a page that has not been paged through, a filter, or a lost
31 rows is not answered here — it is the next thing to look at, and it is not about the logo.
