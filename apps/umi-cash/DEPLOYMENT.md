# Umi Cash — Comprehensive Deployment Guide

**Stack:** Next.js 14 · Prisma · PostgreSQL · Vercel · Supabase

---

## Table of Contents

1. [Overview & cost estimate](#1-overview--cost-estimate)
2. [Prerequisites — accounts & tools](#2-prerequisites--accounts--tools)
3. [Prepare the codebase](#3-prepare-the-codebase)
4. [Set up Supabase (database)](#4-set-up-supabase-database)
5. [Deploy to Vercel](#5-deploy-to-vercel)
6. [Initialize the database](#6-initialize-the-database)
7. [Custom domain](#7-custom-domain)
8. [Apple Wallet certificates](#8-apple-wallet-certificates)
9. [Google Wallet](#9-google-wallet)
10. [Email with Resend](#10-email-with-resend)
11. [WhatsApp notifications with Twilio](#11-whatsapp-notifications-with-twilio)
12. [Create your first tenant](#12-create-your-first-tenant)
13. [Go-live checklist](#13-go-live-checklist)
14. [Ongoing maintenance](#14-ongoing-maintenance)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Overview & cost estimate

| Layer | Service | Free tier | Paid |
|---|---|---|---|
| Hosting | Vercel | 100 GB bandwidth/mo | Pro $20/mo |
| Database | Supabase | 500 MB, 2 projects | Pro $25/mo |
| Email | Resend | 3,000 emails/mo | $20/mo for 50k |
| Apple Wallet | Apple Developer | — | $99/year |
| Google Wallet | Google Cloud | Free | Free |
| WhatsApp/SMS | Twilio | Trial credits | ~$0.005/message |
| Domain | Your registrar | — | Already owned |

**Minimum cost to launch:** $0/month (free tiers) + $99/year if you want Apple Wallet.

**Steps 1–6 get you a fully working app.** Steps 7–11 are enhancements you can add any time after launch.

---

## 2. Prerequisites — accounts & tools

### Accounts (create these before starting)

- [ ] **GitHub** — [github.com](https://github.com) — free
- [ ] **Vercel** — [vercel.com](https://vercel.com) — sign up with your GitHub account
- [ ] **Supabase** — [supabase.com](https://supabase.com) — free
- [ ] **Resend** *(optional, for email)* — [resend.com](https://resend.com)
- [ ] **Apple Developer** *(optional, for Apple Wallet)* — [developer.apple.com](https://developer.apple.com) — $99/year
- [ ] **Google Cloud** *(optional, for Google Wallet)* — [console.cloud.google.com](https://console.cloud.google.com) — free
- [ ] **Twilio** *(optional, for WhatsApp)* — [twilio.com](https://twilio.com)

### Tools on your machine

```bash
# Check you have Node 18+
node -v   # must be v18.x or higher

# Check npm
npm -v

# Prisma CLI (already in devDependencies — no global install needed)
npx prisma --version
```

---

## 3. Prepare the codebase

### 3.1 Switch the database driver to PostgreSQL

Open `prisma/schema.prisma` and update the datasource block:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Delete the SQLite migration history (it's incompatible with PostgreSQL):

```bash
rm -rf prisma/migrations
```

### 3.2 Push code to GitHub

If the project is not on GitHub yet:

1. Go to [github.com](https://github.com) → **New repository**
2. Name: `umi-cash` · Visibility: **Private** → **Create repository**

Then in your terminal inside the project folder:

```bash
git add .
git commit -m "Switch to PostgreSQL for production"
git remote add origin https://github.com/YOUR_USERNAME/umi-cash.git
git push -u origin main
```

> **Security:** confirm `.env.local` is in `.gitignore` before pushing. Never commit secrets.

---

## 4. Set up Supabase (database)

### 4.1 Create a new project

1. Log in to [supabase.com](https://supabase.com) → **New project**
2. Name: `umi-cash`
3. Database password: generate a strong one and **save it somewhere safe**
4. Region: choose the one closest to Mexico (**US East** or **US West**)
5. Wait ~2 minutes for provisioning to complete

### 4.2 Get the connection string

1. In your Supabase project → **Settings** (gear icon) → **Database**
2. Scroll to **Connection string** → select the **URI** tab
3. Copy the string — it looks like:

   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres
   ```

4. Replace `[YOUR-PASSWORD]` with the password from step 4.1

> **Important:** use port **5432** (session mode), not 6543 (transaction/pooler mode). Prisma requires session mode.

This is your `DATABASE_URL`. Keep it safe.

---

## 5. Deploy to Vercel

### 5.1 Import the project

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. **Import** your `umi-cash` GitHub repository
3. Vercel auto-detects Next.js — no build settings to change
4. **Do not click Deploy yet** — add environment variables first

### 5.2 Generate secrets

Run this command **three separate times** in your terminal and save each output:

```bash
openssl rand -base64 32
```

Label the three outputs as:
- `JWT_ACCESS_SECRET` (signs 15-minute access tokens)
- `JWT_REFRESH_SECRET` (signs 30-day refresh tokens)
- `APP_QR_SECRET` (signs 5-minute QR payloads)

> **These must be different from each other.** Each must be at least 32 characters. If `openssl` isn't available, use: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

### 5.3 Add environment variables in Vercel

In the Vercel import screen, expand **Environment Variables** and add each variable below. You can also add/edit them later at **Project Settings → Environment Variables**.

#### Required — app will not start without these

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Supabase connection string from step 4.2 |
| `JWT_ACCESS_SECRET` | Secret #1 |
| `JWT_REFRESH_SECRET` | Secret #2 |
| `APP_QR_SECRET` | Secret #3 |
| `UMI_ADMIN_PASSWORD` | Master admin password — make it strong |
| `NEXT_PUBLIC_APP_URL` | `https://cash.umiconsulting.co` (your final domain) |

> Set `NEXT_PUBLIC_APP_URL` to your Vercel preview URL first (e.g. `https://umi-cash.vercel.app`) and update it after configuring your custom domain in step 7. Apple Wallet push notifications and QR deep links use this value.

#### Apple Wallet — needed for iOS wallet passes

| Variable | Value |
|---|---|
| `APPLE_TEAM_ID` | Your 10-character Apple Team ID |
| `APPLE_PASS_TYPE_ID` | `pass.co.umicash.loyalty` |
| `APPLE_KEY_PASSPHRASE` | Your certificate passphrase (leave blank if none) |
| `APPLE_APN_KEY_ID` | Your APN key ID |
| `APPLE_APN_BUNDLE_ID` | `pass.co.umicash.loyalty` |

> The certificate files are set up in step 8. Leave the Apple variables empty for now if you're not doing wallets yet.

#### Google Wallet — needed for Android wallet passes

| Variable | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `wallet@your-project.iam.gserviceaccount.com` |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Full private key from service account JSON (include `-----BEGIN...END-----`) |
| `GOOGLE_WALLET_ISSUER_ID` | Your issuer ID from Google Wallet Console |
| `GOOGLE_WALLET_CLASS_ID` | `umicash_loyalty_v1` |

#### Email — needed for gift card and welcome emails

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | From your Resend dashboard |
| `EMAIL_FROM` | `Umi Cash <noreply@umiconsulting.co>` |

#### WhatsApp — needed for gift card WhatsApp notifications

| Variable | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | From your Twilio console |
| `TWILIO_AUTH_TOKEN` | From your Twilio console |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+14155238886` (Twilio sandbox) or your approved number |

### 5.4 Deploy

Click **Deploy**. The first deployment may fail because the database tables don't exist yet — that's expected. Fix it in the next step.

---

## 6. Initialize the database

### 6.1 Set your database URL locally

In your terminal, temporarily set the Supabase `DATABASE_URL`:

```bash
export DATABASE_URL="postgresql://postgres:[PASSWORD]@db.xxxx.supabase.co:5432/postgres"
```

### 6.2 Push the schema

```bash
npx prisma db push
```

This creates all tables in Supabase. You'll see output confirming each model was created. This command is safe to re-run — it applies only the differences.

### 6.3 Redeploy on Vercel

Go to **Vercel dashboard → your project → Deployments** → click ··· on the latest deployment → **Redeploy**. The app will now start successfully.

### 6.4 Verify

Visit `https://your-project.vercel.app/umi/admin` (or your custom domain) and log in with your `UMI_ADMIN_PASSWORD`. If the master admin dashboard loads, everything is working.

---

## 7. Custom domain

### 7.1 Add the domain in Vercel

1. **Project Settings → Domains** → type `cash.umiconsulting.co` → **Add**
2. Vercel shows the DNS records to add

### 7.2 Add DNS records at your registrar

Log in to wherever you manage `umiconsulting.co` (Cloudflare, GoDaddy, Namecheap, etc.) → DNS settings → add:

| Type | Name | Value |
|---|---|---|
| CNAME | `cash` | `cname.vercel-dns.com` |

> If using Cloudflare, set the proxy to **DNS only** (grey cloud) for the CNAME — Vercel handles its own TLS.

DNS propagation takes 5 minutes to 24 hours. Vercel provisions an SSL certificate automatically.

### 7.3 Update NEXT_PUBLIC_APP_URL

Once DNS is verified and the domain works, update `NEXT_PUBLIC_APP_URL` in Vercel to `https://cash.umiconsulting.co` and redeploy. This makes Apple Wallet push notifications and QR links point to the correct domain.

---

## 8. Apple Wallet certificates

This requires a **Mac** and an **Apple Developer account** ($99/year).

### 8.1 Create a Pass Type ID

1. Log in to [developer.apple.com](https://developer.apple.com) → **Account** → **Certificates, IDs & Profiles**
2. **Identifiers** → **+** → select **Pass Type IDs** → Continue
3. Description: `Umi Cash Loyalty`
4. Identifier: `pass.co.umicash.loyalty` → **Register**

### 8.2 Create the Pass Type certificate

1. **Certificates** → **+** → **Services** section → **Pass Type ID Certificate** → Continue
2. Select the Pass Type ID you just created → Continue
3. You'll be asked to create a Certificate Signing Request (CSR):
   - Open **Keychain Access** on your Mac
   - Menu: **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority**
   - Enter your email, name → **Saved to disk** → Continue → save `CertificateSigningRequest.certSigningRequest`
4. Upload the CSR → download `pass.cer`
5. Double-click `pass.cer` to install it in Keychain

### 8.3 Export the certificate as P12

1. Open **Keychain Access** → category **My Certificates**
2. Find the pass certificate (named `Pass Type ID: pass.co.umicash.loyalty`)
3. Right-click → **Export** → save as `pass.p12`
4. Set a passphrase — note it down as `APPLE_KEY_PASSPHRASE`

### 8.4 Convert to PEM files

```bash
# Extract the signer certificate
openssl pkcs12 -in pass.p12 -clcerts -nokeys -out signerCert.pem -legacy

# Extract the private key (you'll be prompted for the P12 passphrase)
openssl pkcs12 -in pass.p12 -nocerts -out signerKey.pem -legacy
# Remove the passphrase from the key (easier to manage):
openssl rsa -in signerKey.pem -out signerKey.pem

# Download the Apple WWDR G4 intermediate certificate:
# https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
# Then convert it:
openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem
```

### 8.5 Place certificates in the project

The certificate files must live at these exact paths inside the project:

```
passes/
└── apple/
    ├── certificates/
    │   ├── signerCert.pem
    │   ├── signerKey.pem
    │   └── wwdr.pem
    └── template/
        ├── pass.json
        ├── icon.png
        ├── icon@2x.png
        ├── logo.png
        └── logo@2x.png
```

> **The `passes/` directory must be committed to Git** for Vercel to include the certificates in the deployment. Add it to Git:
>
> ```bash
> git add passes/apple/certificates/
> git commit -m "Add Apple Wallet certificates"
> git push
> ```

### 8.6 Create an APN key (for push updates)

This lets the wallet pass update automatically when the customer's balance or visits change.

1. **Keys** → **+** → check **Apple Push Notifications service (APNs)**
2. Name: `Umi Cash APN` → Continue → Register
3. **Download** the `.p8` file — you can only download it once
4. Note the **Key ID** shown on the page → `APPLE_APN_KEY_ID`

Place the `.p8` file in the project:

```
passes/
└── apple/
    └── apn_key.p8
```

Commit it alongside the other certificate files.

### 8.7 Update environment variables

In Vercel, add or confirm:

| Variable | Value |
|---|---|
| `APPLE_TEAM_ID` | Your 10-character Team ID (visible at top right of developer.apple.com) |
| `APPLE_PASS_TYPE_ID` | `pass.co.umicash.loyalty` |
| `APPLE_KEY_PASSPHRASE` | The passphrase you set in step 8.3 (or blank if you stripped it) |
| `APPLE_APN_KEY_ID` | The Key ID from step 8.6 |
| `APPLE_APN_BUNDLE_ID` | `pass.co.umicash.loyalty` |

Redeploy after setting these. Test by visiting `/{slug}/card` on an iPhone and tapping **Add to Apple Wallet**.

---

## 9. Google Wallet

Google Wallet requires approval from Google, which can take 1–5 business days. The app works without it in the meantime.

### 9.1 Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. **Select a project** → **New Project** → name it `umi-cash` → **Create**

### 9.2 Enable the Google Wallet API

1. In your project → **APIs & Services** → **Library**
2. Search **Google Wallet API** → **Enable**

### 9.3 Create a service account

1. **IAM & Admin** → **Service Accounts** → **Create Service Account**
2. Name: `wallet-service` → **Create and Continue**
3. Role: **Editor** → Done
4. Click the service account → **Keys** tab → **Add Key** → **JSON** → **Create**
5. A JSON file downloads. Open it and copy:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (include the full `-----BEGIN PRIVATE KEY-----` … `-----END PRIVATE KEY-----` block, with literal `\n` replaced by actual newlines or kept as `\n` — Vercel handles both)

### 9.4 Request Google Wallet issuer access

1. Go to [pay.google.com/business/console](https://pay.google.com/business/console)
2. Sign in and register as an issuer
3. Fill in business details and submit for approval
4. Once approved, your **Issuer ID** is shown in the console → `GOOGLE_WALLET_ISSUER_ID`
5. Set `GOOGLE_WALLET_CLASS_ID` to `umicash_loyalty_v1`

### 9.5 Update environment variables

Add to Vercel and redeploy. Test by visiting `/{slug}/card` on Android and tapping **Add to Google Wallet**.

---

## 10. Email with Resend

Emails are sent for: gift card delivery, gift card redemption confirmation, and welcome registration.

### 10.1 Create a Resend account and API key

1. Go to [resend.com](https://resend.com) → sign up
2. **API Keys** → **Create API Key** → copy the key → `RESEND_API_KEY`

### 10.2 Verify your sending domain

1. **Domains** → **Add Domain** → enter `umiconsulting.co`
2. Resend provides DNS records (TXT, MX, CNAME) — add them at your registrar
3. Once verified (can take 5–30 minutes), emails will send from `noreply@umiconsulting.co`

### 10.3 Update environment variables

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | Your Resend API key |
| `EMAIL_FROM` | `Umi Cash <noreply@umiconsulting.co>` |

Add to Vercel and redeploy.

---

## 11. WhatsApp notifications with Twilio

WhatsApp messages are sent when a gift card is created with a phone number recipient.

### 11.1 Create a Twilio account

1. Go to [twilio.com](https://twilio.com) → sign up
2. Note your **Account SID** and **Auth Token** from the console dashboard

### 11.2 Option A — Twilio Sandbox (testing)

The sandbox lets you test without approval.

1. **Messaging → Try it out → Send a WhatsApp message**
2. Follow the instructions to join the sandbox from your phone (send a code to the sandbox number)
3. Sandbox number is usually `whatsapp:+14155238886` → `TWILIO_WHATSAPP_FROM`

> Sandbox messages only reach numbers that have opted in. For production, use Option B.

### 11.3 Option B — Approved WhatsApp Sender (production)

1. **Messaging → Senders → WhatsApp Senders** → **Request access**
2. Submit business details and a WhatsApp Business profile
3. Approval takes 1–3 business days
4. Once approved, use your assigned number as `TWILIO_WHATSAPP_FROM` (format: `whatsapp:+521XXXXXXXXXX`)

### 11.4 Update environment variables

| Variable | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | From your Twilio console |
| `TWILIO_AUTH_TOKEN` | From your Twilio console |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+14155238886` (sandbox) or your approved sender |

Add to Vercel and redeploy.

---

## 12. Create your first tenant

Tenants (coffee shops) are created from the master admin panel — no code changes or database commands needed.

### 12.1 Log in to master admin

Navigate to `https://cash.umiconsulting.co/umi/admin` (or `/umi/login` first if redirected).

Password: your `UMI_ADMIN_PASSWORD`.

### 12.2 Create a tenant

1. Click **Nuevo negocio** (or **+**)
2. Fill in:
   - **Nombre** — business name (e.g. `El Gran Ribera`)
   - **Slug** — URL identifier, lowercase letters and hyphens only (e.g. `elgranribera`). Cannot be changed later.
   - **Prefijo de tarjeta** — 3-character card number prefix, uppercase (e.g. `EGR`). Cannot be changed later.
   - **Ciudad** — city and state
   - **Color principal** — brand color hex (e.g. `#B5605A`)
   - **Admin email & password** — credentials for the business owner
3. Click **Crear** — the tenant and admin account are created instantly

### 12.3 Configure rewards and loyalty program

1. Click the tenant row → go to the tenant's admin at `/{slug}/admin-login`
2. Log in with the admin credentials just created
3. **Recompensas** — set visits required and reward name
4. **Configuración** — update business name, city, logo URL, colors, and self-registration toggle

### 12.4 Add staff accounts

From the master admin or from the tenant's **Configuración** panel, create staff accounts. Staff can scan QRs and process top-ups but cannot access settings or rewards.

---

## 13. Go-live checklist

Work through this top to bottom before announcing the app.

### Core functionality

- [ ] `https://cash.umiconsulting.co/umi/admin` loads and login works
- [ ] Can create a new tenant from the master admin panel
- [ ] Customer self-registration works at `/{slug}/register`
- [ ] Customer card page loads at `/{slug}/card` after login
- [ ] QR code generates and displays on the card page
- [ ] Staff can scan a QR at `/{slug}/admin/scan` and register a visit
- [ ] Visit counter increments correctly
- [ ] Top-up adds balance correctly at `/{slug}/admin/topup`
- [ ] Reward is earned after the configured number of visits
- [ ] Staff can redeem a reward from the scan screen
- [ ] Gift card can be created by staff at `/{slug}/admin/gift-cards`
- [ ] Gift card can be redeemed at `/{slug}/gift/{code}`

### Wallet passes (if configured)

- [ ] Apple Wallet pass downloads on iPhone at `/{slug}/card`
- [ ] Pass shows correct balance and visit count
- [ ] After a visit is logged, the pass updates automatically (requires APN)
- [ ] Google Wallet pass opens on Android at `/{slug}/card`

### Email (if configured)

- [ ] Gift card email arrives when created with an email address
- [ ] Test by creating a gift card with your own email as recipient

### WhatsApp (if configured)

- [ ] Gift card WhatsApp message arrives when created with a phone number
- [ ] Test by creating a gift card with your own number as recipient

### Security & domain

- [ ] App loads on `https://cash.umiconsulting.co` (HTTPS)
- [ ] HTTP redirects to HTTPS automatically (Vercel handles this)
- [ ] `UMI_ADMIN_PASSWORD` is strong and not shared with staff
- [ ] Tenant admin passwords are strong and different from each other
- [ ] `.env.local` is NOT committed to Git (`git log --all -- .env.local` returns nothing)

---

## 14. Ongoing maintenance

### Deploying code changes

Every push to `main` triggers an automatic Vercel deployment (~2–3 minutes):

```bash
git add .
git commit -m "describe what changed"
git push
```

No other steps needed.

### Updating the database schema

When `prisma/schema.prisma` changes, apply the changes to production:

```bash
# Set DATABASE_URL to your Supabase connection string
export DATABASE_URL="postgresql://postgres:[PASSWORD]@db.xxxx.supabase.co:5432/postgres"

npx prisma db push
```

Then commit and push the updated schema file normally.

### Adding a new tenant

Use the master admin UI at `/umi/admin` — no code or database commands needed. See step 12.

### Rotating secrets

If you ever need to rotate `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, or `APP_QR_SECRET`:

1. Update the value in Vercel → **Environment Variables**
2. Redeploy
3. All existing sessions and QR tokens will immediately become invalid — users will need to log in again. This is expected and safe.

### Monitoring

| Tool | Where | What to watch |
|---|---|---|
| Vercel dashboard | vercel.com → project → **Functions** | API response times, error rates |
| Vercel logs | project → **Deployments** → latest → **Functions** | Live logs and 4xx/5xx errors |
| Supabase dashboard | supabase.com → **Table Editor** | Browse data directly |
| Supabase logs | project → **Logs → Postgres** | Slow queries, errors |

### Backups

Supabase Pro ($25/mo) includes automatic daily backups with 7-day point-in-time recovery.

On the free tier, take manual backups:

```bash
pg_dump "postgresql://postgres:[PASSWORD]@db.xxxx.supabase.co:5432/postgres" \
  --no-acl --no-owner -f backup_$(date +%Y%m%d).sql
```

Run this regularly and store the file somewhere safe (not in the repo).

### Suspending a tenant

In the master admin panel, edit the tenant → set **Estado de suscripción** to **Suspendido**. Staff will see a suspension banner and all API write operations will return HTTP 402.

---

## 15. Troubleshooting

### App won't start — "Missing required environment variable"

The app throws on startup if `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, or `APP_QR_SECRET` are missing or shorter than 32 characters. Check Vercel **Environment Variables** and redeploy.

### Config page stuck on loading skeleton

The settings page (`/{slug}/admin/settings`) stays in a loading state if:
- The access token in localStorage is expired (tokens last 15 minutes)
- The user is not authenticated

**Fix:** log out and log back in at `/{slug}/admin-login`. Access tokens are short-lived by design — the app uses refresh tokens to issue new ones automatically via `/{slug}/auth/refresh`.

### "Tenant no encontrado" (404) on any tenant page

The slug in the URL does not match any tenant in the database. Check:

```bash
# In Prisma Studio or Supabase Table Editor
# Look at the Tenant table and verify the slug column
npx prisma studio
```

### Apple Wallet returns 503

Certificates are missing or unreadable. Verify:
1. `passes/apple/certificates/signerCert.pem`, `signerKey.pem`, and `wwdr.pem` exist in the repo
2. `APPLE_PASS_TYPE_ID` and `APPLE_TEAM_ID` are set in Vercel
3. The files were committed and the latest deployment includes them

### Apple Wallet pass downloads but doesn't update after visits

APNs push is not configured or the device token was not registered. Check:
1. `APPLE_APN_KEY_ID` and `APPLE_APN_BUNDLE_ID` are set in Vercel
2. `passes/apple/apn_key.p8` exists in the repo and is committed
3. The customer added the pass to Wallet **after** the APNs variables were set (passes added before won't have registered a push token)

### Google Wallet link doesn't work

1. Verify `GOOGLE_WALLET_ISSUER_ID` is correct
2. Confirm Google Wallet API is enabled in your Google Cloud project
3. Confirm the service account has the correct permissions
4. If issuer approval is still pending, the pass URL will fail — wait for approval

### Emails not sending

1. Check `RESEND_API_KEY` is set in Vercel
2. Verify the sending domain is verified in Resend (green checkmark)
3. Check Resend logs at resend.com → **Logs** for delivery errors

### WhatsApp not sending

1. Check `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_WHATSAPP_FROM` are set
2. If using sandbox, the recipient phone must have joined the sandbox first
3. Check Twilio logs at console.twilio.com → **Monitor → Logs → Messaging**
4. Phone numbers must be in international format — the app auto-adds `+52` for bare Mexican numbers

### "CORS — origin not allowed" (403 on API calls)

`NEXT_PUBLIC_APP_URL` does not match the URL you're calling from. Update it in Vercel to match your actual domain and redeploy.

### Database migration error ("column does not exist" or similar)

The production schema is out of sync with the code. Run:

```bash
export DATABASE_URL="postgresql://postgres:[PASSWORD]@db.xxxx.supabase.co:5432/postgres"
npx prisma db push
```

### Rate limit hit (429 on login or scan endpoints)

The app uses an in-memory rate limiter. On Vercel's serverless architecture each function invocation is independent, so rate limits are per-instance rather than global. If you need true global rate limiting at scale, add a Redis-backed solution (e.g. Upstash) and update `src/lib/rate-limit.ts`.

---

## Recommended order of operations

| # | Task | Estimated time | Required to launch? |
|---|---|---|---|
| 1 | Switch to PostgreSQL + push to GitHub | 15 min | Yes |
| 2 | Create Supabase project + get connection string | 10 min | Yes |
| 3 | Deploy to Vercel + set required env vars | 20 min | Yes |
| 4 | Run `prisma db push` | 5 min | Yes |
| 5 | Create first tenant via master admin | 10 min | Yes |
| 6 | Set up custom domain + DNS | 15 min + propagation | No — vercel.app URL works |
| 7 | Set up Resend email | 20 min | No — app works without it |
| 8 | Set up Twilio WhatsApp | 30 min | No — app works without it |
| 9 | Set up Apple Wallet certificates | 1–2 hours | No — web card works without it |
| 10 | Set up Google Wallet | 1 hour + 1–5 day approval | No — web card works without it |

**Steps 1–5 = fully working app in production.**
