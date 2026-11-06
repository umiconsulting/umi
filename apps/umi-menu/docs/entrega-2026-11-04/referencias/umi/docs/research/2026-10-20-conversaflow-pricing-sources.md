# Conversaflow: official prices for operation

Research date: 2026-10-20, from the session date.
Currency: USD. All estimates exclude tax. No currency conversion applies.
Scope: published vendor rates and illustrative budgets. Actual deployment bills remain UNVERIFIED.

## Method and tool choice

The repository `research` skill requires a background agent. This note is that agent's output.
The research used rung 1: official vendor documentation and official files for prices.
Search results identified sources. Direct page reads supplied the evidence.

| Step 0 question | Answer |
| --- | --- |
| Does a proven tool exist? | Yes. `mcp__codex_apps__search_service_web_run` provides search and page extraction. `curl` retrieves official files. |
| Is it installed? | Yes. Both tools ran in this session. |
| Can an agent drive it? | Yes. The calls required no interactive login. |
| What does adoption cost? | No installation or repository dependency. Usage charges for the managed research tool are UNVERIFIED. |
| What is the fallback? | Use `curl` on the official source when page extraction fails. Read official CSV and HTML data when calculators omit rates. |

Tool record:

- Managed web MCP: tool name above. Version, licence, and maintenance version are not exposed: UNVERIFIED.
- `curl` 8.7.1: installed version from `curl --version`. Release date: 2024-03-27. Licence: [curl licence](https://curl.se/docs/copyright.html).
- Python 3.14.4: installed version from `python3 --version`. [PSF licence](https://docs.python.org/3.14/license.html).
- The standard Python library parsed official CSV and static HTML. This avoided a crawler dependency for small, public files.
- The installed CLI versions are known. Their latest upstream versions were outside this research scope.

## Verified rates

Every row below is a **documented fact**. Conditions and deployment assumptions follow the table.

| Product or charge | Published USD rate | Official source |
| --- | --- | --- |
| Claude Haiku 4.5, ordinary input | $1.00 per 1M tokens | [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Claude Haiku 4.5, output | $5.00 per 1M tokens | [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Claude Haiku 4.5, cache write, 5 minutes | $1.25 per 1M tokens | [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Claude Haiku 4.5, cache write, 1 hour | $2.00 per 1M tokens | [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Claude Haiku 4.5, cache read | $0.10 per 1M tokens | [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| `voyage-4-lite`, documents and queries | $0.02 per 1M tokens; first 200M tokens free per account | [Voyage pricing](https://docs.voyageai.com/docs/pricing) |
| Twilio WhatsApp, inbound or outbound | $0.005 per message, plus applicable Meta fees | [Twilio pricing](https://www.twilio.com/en-us/whatsapp/pricing) |
| Meta Mexico, marketing | $0.0397 per delivered message | [Twilio official CSV](https://www.twilio.com/content/dam/twilio-com/pricing-data/en/WhatsAppPricing-pricing-details.csv) |
| Meta Mexico, utility | $0.0085 per delivered message, before applicable volume tiers | [Twilio official CSV](https://www.twilio.com/content/dam/twilio-com/pricing-data/en/WhatsAppPricing-pricing-details.csv) |
| Meta Mexico, authentication | $0.0085 per delivered message, before applicable volume tiers | [Twilio official CSV](https://www.twilio.com/content/dam/twilio-com/pricing-data/en/WhatsAppPricing-pricing-details.csv) |
| Meta Mexico, service | $0.0085 per delivered message, subject to the service allowance | [Twilio official CSV](https://www.twilio.com/content/dam/twilio-com/pricing-data/en/WhatsAppPricing-pricing-details.csv) |
| DigitalOcean Basic Regular, 4 GiB | $24/month; 2 vCPUs, 80 GiB SSD, 4,000 GiB transfer | [Droplet prices](https://www.digitalocean.com/pricing/droplets) |
| DigitalOcean Basic Regular, 8 GiB | $48/month; 4 vCPUs, 160 GiB SSD, 5,000 GiB transfer | [Droplet prices](https://www.digitalocean.com/pricing/droplets) |
| DigitalOcean backups, percentage plan | Weekly: +20%; daily: +30% of the Droplet price | [Backup prices](https://docs.digitalocean.com/products/backups/details/pricing/) |
| Supabase Pro, optional managed database | From $25/month per organization, including $10/month of compute credits | [Supabase pricing](https://supabase.com/pricing) |
| Supabase Micro compute | About $10/month; covered by the $10 credit for one full-month Micro project | [Supabase pricing](https://supabase.com/pricing), [compute billing](https://supabase.com/docs/guides/platform/manage-your-usage/compute) |
| Cloudflare Pages, static frontend | $0 for static requests; free and unlimited on Free and Paid plans | [Pages prices](https://developers.cloudflare.com/pages/functions/pricing/) |
| Cloudflare Workers Static Assets | $0 for static requests and asset storage | [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) |

**Documented fact:** the Mexico row in Twilio's CSV was:

```csv
ISO Code,Country,Region,Marketing,Utility,Authentication,International Authentication Rates Applicable,Service
MX,Mexico,Mexico,0.039700,0.008500,0.008500,n/a,0.008500
```

The HTML data for Mexico on Twilio's pricing page had the same four prices and the $0.005 Twilio fee.
These are Meta charges that Twilio passes through. Twilio adds its own fee.

## WhatsApp: the October 2026 change matters

**Documented fact:** Meta's current developer documentation states that these rules took effect on October 1, 2026:

- Meta charges for service messages and utility messages inside the customer service window.
- Each business phone number receives 1,000 free delivered service messages each month.
- Meta charges from service message 1,001. Unused allowance expires each month.
- Meta does not charge for inbound messages from a user.
- A customer message starts or resets a 24-hour customer service window.
- A business can send non-template messages while that window is open. It needs templates outside that window.

Source: [Meta developer pricing](https://developers.facebook.com/docs/whatsapp/pricing), including `effective-october-1-2026` and `free-tier-of-monthly-service-messages`.
The canonical current route is [Meta business messaging pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing#effective-october-1-2026).
Direct `curl -sS -L` returned the current Markdown document, with HTTP 200.

**Documented fact:** eligible free entry points can also remove Meta charges. The current developer page describes a window of up to seven days.
**Inference:** an ordinary WhatsApp conversation does not establish that eligibility. The estimates below assume no free entry point.

**Source-backed tradeoff:** the pages contain inconsistent text. Twilio's main explanation includes the new charges, but its calculator retains older free-window wording.
The WhatsApp marketing page also retains the older free-service description and a 72-hour entry window.
Use Meta's current developer rules and Twilio's current country data for this estimate.
Sources: [Twilio pricing](https://www.twilio.com/en-us/whatsapp/pricing), [WhatsApp marketing page](https://whatsappbusiness.com/products/platform-pricing/).

**UNVERIFIED:** Conversaflow's actual template mix, recipient countries, business numbers, billing currency, discounts, delivery outcomes, and free-entry eligibility.
**UNVERIFIED:** whether Meta classifies this deployment as an AI Provider. That classification has separate rules.
Source: [Meta policy for AI Providers](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers).
The examples below assume an ordinary business that uses an assistant for customer service.

## Hosting conditions

**Inference:** a standalone budget can place the API, worker, Redis, and PostgreSQL on one VPS.
The 4–8 GiB plans provide price references. Capacity for this workload remains UNVERIFIED until measured.

| Illustrative VPS configuration | Monthly USD total | Basis |
| --- | ---: | --- |
| 4 GiB, weekly backups | $28.80 | $24 × 1.20 |
| 4 GiB, daily backups | $31.20 | $24 × 1.30 |
| 8 GiB, weekly backups | $57.60 | $48 × 1.20 |
| 8 GiB, daily backups | $62.40 | $48 × 1.30 |

**Inference:** these configurations require no separate managed Redis or managed database subscription.
The estimate excludes domain registration, number rental, external backup storage, excess transfer, operator labor, and optional observability services.
Actual number rental and use of optional paid messaging features remain UNVERIFIED.
The user selected a standalone deployment. This estimate gives that deployment its own VPS budget.
The DigitalOcean references do not identify an existing deployment or actual monthly bill.

**Documented fact:** Supabase Pro includes 8 GB of database disk per project, 250 GB of egress, and daily backups retained for seven days.
Additional projects and larger compute add charges. Compute credits apply once per organization.
Sources: [Supabase pricing](https://supabase.com/pricing), [compute billing](https://supabase.com/docs/guides/platform/manage-your-usage/compute).
**Inference:** treat Supabase as an optional managed database alternative. Add at least $25/month if selected; retain the API and worker host budget.
Actual project size and use beyond the included amounts remain UNVERIFIED.

**Documented fact:** Cloudflare Pages Free permits 500 builds/month, 20,000 files/site, and a maximum file size of 25 MiB.
Source: [Pages limits](https://developers.cloudflare.com/pages/platform/limits/).
Workers Static Assets Free also permits 20,000 files, with a maximum size of 25 MiB per file.
Source: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
Worker or Pages Function execution has separate charges. Workers Paid starts at $5/month.
Source: [Workers prices](https://developers.cloudflare.com/workers/platform/pricing/).

**Documented fact:** Cloudflare's self-serve terms support entity accounts and free services.
**Inference:** a commercial static dashboard can use this $0 reference. The reviewed terms contain no general personal-use-only condition.
The terms and service limits still apply.
Source: [Cloudflare Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/), sections 2.1, 2.2, and 2.6.

**Documented implementation fact:** the current Dashboard includes `public/_worker.js` in Pages advanced mode.
It calls `env.ASSETS.fetch` for static content. No `_routes.json` is present in the reviewed Dashboard source.
Advanced mode gives the Function control of requests, so this deployment is subject to Worker invocation quotas.
**Inference:** use $0 only while those requests remain within the Free quotas, or after an explicit static-hosting change.
Otherwise reserve at least the $5/month paid Worker minimum and applicable usage charges.
Sources: [Dashboard Worker](../../apps/umi-dashboard/public/_worker.js),
[Pages advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/),
and [Workers prices](https://developers.cloudflare.com/workers/platform/pricing/).

## Example costs with explicit assumptions

Everything in this section is an **inference**, from the rates above.
One analytical conversation contains these assumed totals:

- Eight inbound and eight outbound WhatsApp messages.
- 60,000 cumulative ordinary Haiku input tokens, across all calls.
- 5,000 cumulative Haiku output tokens, across all calls.
- 2,000 Voyage embedding tokens.
- One business phone number; all recipients are in Mexico.
- All eight outbound messages qualify as service messages and are delivered within an open customer service window.
- No cache discount, batch discount, free entry point, or remaining Voyage free allowance.
- The service allowance is available to this workload at the start of the month.

This analytical unit is not a WhatsApp tariff session. It does not represent a measured average.
Token totals must include all loop calls, tool payloads, history, fact extraction, and summaries.
An intent call adds cost only if the application invokes it. The reviewed turn path has no separate intent caller.

```text
Haiku per unit = 60,000 / 1,000,000 × $1 + 5,000 / 1,000,000 × $5 = $0.085
Voyage per unit = 2,000 / 1,000,000 × $0.02 = $0.00004
Twilio per unit = 16 × $0.005 = $0.080
Meta per month = max(8 × N - 1,000, 0) × $0.0085
Variable monthly total = N × $0.16504 + Meta per month
```

| Analytical units/month | Haiku | Voyage | Twilio | Meta service | Variable total | With illustrative VPS and backups |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | $8.50 | $0.004 | $8.00 | $0.00 | $16.504 | $45.30–$78.90 |
| 1,000 | $85.00 | $0.04 | $80.00 | $59.50 | $224.54 | $253.34–$286.94 |
| 10,000 | $850.00 | $0.40 | $800.00 | $671.50 | $2,321.90 | $2,350.70–$2,384.30 |

The fixed range uses $28.80–$62.40/month. It includes self-hosted PostgreSQL and Redis, plus the frontend within its Free quotas.
An exhausted service allowance adds $6.80 at 100 units, or $8.50 at 1,000 and 10,000 units.
A different number or message mix changes the calculation.
Marketing templates through Twilio cost $0.0447 each at these list rates. Ordinary utility and authentication templates cost $0.0135 each before discounts.

## Optional DeepSeek path

**Documented fact:** the current official page lists `deepseek-flash`, version `DeepSeek-V4.1-Flash-1017`:

| Token type | Off-peak, per 1M tokens | Peak, per 1M tokens |
| --- | ---: | ---: |
| Input, cache miss | $0.15 | $0.30 |
| Input, cache hit | $0.003 | $0.006 |
| Output | $0.60 | $1.20 |

Peak periods are 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday, except Chinese public holidays.
Source: [DeepSeek model prices](https://api-docs.deepseek.com/quick_start/pricing/).

**Documented fact from the parent code review:** the current default for `DEEPSEEK_MODEL` is `deepseek-flash`.
This note did not test that API key or a live model call. The active deployment's provider setting remains UNVERIFIED.
**Inference:** switching one-shot tasks does not establish a saving for the Anthropic chat loop.
The parent code review must identify the calls that actually switch provider.

## Route failures and fallbacks

| Target and route | Observed result | Resolution |
| --- | --- | --- |
| Meta developer pricing, MCP `open`, old and current paths | 429; linked route also failed | Direct `curl -sS -L` on the official old route returned current Markdown, HTTP 200. |
| Meta non-template subpage, MCP `open` | Tool reported inaccessible | Current main Meta developer document supplied the service rules. |
| WhatsApp marketing pricing page | Readable; older free-service text | Current Meta developer document supplied the effective October 2026 rule. |
| Twilio help article, MCP `open` | JavaScript shell | Its public help-center JSON route also failed. Main Twilio pricing and official CSV supplied the evidence. |
| Twilio pricing, MCP `open` | Readable; country selection omitted Mexico message rates | Direct `curl` read Mexico's static HTML data and linked official CSV. Both matched. |
| Other official price pages | Readable with the web MCP | No secondary source was needed for a price. |

The note marks unresolved deployment claims UNVERIFIED. No account credentials or private invoices were read.
