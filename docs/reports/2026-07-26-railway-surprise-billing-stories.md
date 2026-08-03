# Railway surprise billing reports

**Date:** 2026-07-26
**Status:** Evidence report. User claims are not verified invoices unless the report says otherwise.

## Executive finding

Real Railway users report surprise bills from USD 30 to several thousand dollars.

Most reports show valid metered use. The main causes are network egress, memory, duplicate environments, and Railway Agent use.

One report shows a confirmed Railway billing defect. Railway confirmed repeated charges and issued refunds.

Railway can control this risk with hard limits. A hard limit can also stop all production workloads.

## Evidence standard

The confidence label rates the public evidence.

- **High:** Railway staff confirmed the charge, cause, credit, refund, or defect.
- **Medium:** The user gave details, and Railway gave a plausible cause.
- **Low:** The report has no invoice, staff confirmation, or clear resolution.

These reports prove that the public conversations exist. They do not prove every user statement.

## First-person reports

| Date            | Amount and status                                        | Workload                                             | Cause and result                                                                                                                                             | Confidence                                                                                                                                                                              |
| --------------- | -------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2024-03-28      | USD 497 refund, plus other card charges                  | Commercial Pro account; workload not stated          | Railway confirmed repeated charges from a billing defect. Threshold billing ignored earlier invoices. Railway voided three invoices and issued full refunds. | **High.** Railway confirmed the defect and refund. [Source](https://station.railway.com/questions/i-ve-been-10x-wrongly-charged-ecf7d3c6)                                               |
| 2024-04-01      | USD 466 bill; user said they paid it                     | Simple Discord bots; prior bills were at most USD 10 | The thread linked the cost to public database traffic instead of private traffic. The user requested a partial refund. No refund result appears.             | **Medium.** The amount and payment are user claims. [Source](https://station.railway.com/questions/extremely-expensive-by-previous-standard-dc676a85)                                   |
| 2025-04-03      | About USD 100 charged; another USD 70 attempted          | Eight Sophon nodes                                   | A moderator saw about USD 5 without network use and about USD 61 with egress. The likely cause was public network traffic.                                   | **Medium.** Screenshots informed the response, but no invoice is public. [Source](https://station.railway.com/questions/railway-cut-many-dollar-on-my-card-need-9873abab)               |
| 2025-11-27      | USD 29.01 current use; USD 32.20 estimate                | One MySQL database and other services                | MySQL used about 1.4 GB RAM. The cost matched Railway rates. The user accepted the explanation.                                                              | **Medium-high.** The thread includes calculations and a resolution. [Source](https://station.railway.com/questions/unexpected-high-billing-please-review-92db6711)                      |
| About late 2025 | USD 476 monthly estimate                                 | One Bun service and one Python service               | The estimate came mainly from egress. The user considered self-hosting. The thread gives no final invoice.                                                   | **Medium.** This was an estimate, not a charge. [Source](https://station.railway.com/questions/need-help-to-understand-railway-cost-dda4164a)                                           |
| About late 2025 | More than USD 600 estimate; USD 5.65 current use         | Two scanner services in a five-service project       | One day produced about 85 GB egress. Public database connections caused internal traffic charges. The user stopped the costly service.                       | **High for the explanation.** The large number was not a bill. [Source](https://station.railway.com/questions/what-s-this-amount-on-my-usage-03ea82f2)                                  |
| 2026-01-10      | USD 51.79 bill; USD 41 for 820 GB egress                 | A small MCP site with about 260 MB of demo videos    | Visitors downloaded the videos from Railway. The user removed them. A moderator suggested a refund request and a hard limit.                                 | **Medium-high.** The cause is detailed. No refund result appears. [Source](https://station.railway.com/questions/unexpected-egress-charges-first-time-u-e0dfc695)                       |
| 2026-01-16      | USD 900 normal; USD 2,070.61 paid; USD 3,470.72 forecast | Many microservices and development environments      | Egress drove the increase. A private-domain change removed large transfers. No refund or final forecast result appears.                                      | **Medium-high.** Railway explained the network flow. The paid amount is a user claim. [Source](https://station.railway.com/questions/unexpected-egress-spike-causing-2-3x-mon-01458b94) |
| 2026-05         | USD 56.61 egress; more than USD 60 expected              | Redis and an application with live statistics        | Redis used about 1,132 GB of egress through public networking. Railway applied a USD 30 goodwill credit.                                                     | **High.** Railway confirmed the use and credit. [Source](https://station.railway.com/questions/egress-spike-865e6382)                                                                   |
| 2026-05-15      | USD 51 monthly estimate; user expected USD 5.25          | 23 services with about 4.5 GB total RAM              | The user used an incorrect USD 0.50 RAM rate. The correct USD 10 rate explained about USD 45.                                                                | **High.** Railway gave the itemized current use. This was not overbilling. [Source](https://station.railway.com/questions/billing-discrepancy-51-mo-vs-5-25-mo-b8888901)                |
| 2026-07         | USD 4.75 Agent use; service use was USD 0.04             | Railway AI features during deployment                | LLM token use caused the amount. Railway denied another user's refund request. It advised an Agent hard limit of zero.                                       | **High for the cause.** This was recorded use, not a shown invoice. [Source](https://station.railway.com/questions/unexplained-agent-charges-on-my-hobby-ed98d4d7)                      |

## What the reports show

### Documented facts

Railway uses a minimum monthly commitment. Hobby costs USD 5, and Pro costs USD 20.

The commitment covers the same amount of resource use. Higher use raises the total bill.

Current resource rates are:

- RAM: USD 10 per GB-month
- CPU: USD 20 per vCPU-month
- Network egress: USD 0.05 per GB
- Volume storage: USD 0.15 per GB-month

Railway bills compute by the minute. A low-traffic service can still use billable RAM.

[Railway pricing](https://docs.railway.com/pricing/plans) and [bill guide](https://docs.railway.com/pricing/understanding-your-bill) support these facts.

### Source-backed tradeoff

Usage billing can reduce costs for small workloads. It can also turn a fault or traffic spike into a larger bill.

The public reports show these common causes:

1. Public connections between Railway services
2. Large files served from an application
3. High base memory from MySQL or many services
4. Scanner, node, or monitoring traffic
5. Railway Agent token use
6. A dashboard estimate based on a short traffic spike

Railway also lists memory leaks, traffic growth, resource-heavy templates, and PR environments as common causes.

[Railway pricing FAQ](https://docs.railway.com/pricing/faqs) supports this list.

### Important distinction

An **estimated bill** predicts month-end use. It is not the current amount due.

A short egress spike can create a large estimate. The USD 600 report had only USD 5.65 of current use.

The [project usage guide](https://docs.railway.com/projects/project-usage) defines current and estimated costs.

## Cost controls

Configure these controls before a production migration:

1. Set a compute email alert below the acceptable limit.
2. Set a compute hard limit at the maximum acceptable amount.
3. Set a separate Agent hard limit.
4. Set replica limits for the web, worker, and Redis services.
5. Use private networking for all Railway service traffic.
6. Use Serverless only for services that can stop safely.
7. Review each project and PR environment every week.

Railway sends hard-limit notices at 75%, 90%, and 100%.

At 100%, Railway stops all workloads. This control protects cost but can cause a production outage.

[Railway cost controls](https://docs.railway.com/pricing/cost-control) describe these actions.

## Refund risk

Railway gives refunds at its sole discretion. It generally does not refund consumed resources.

The Redis report received a goodwill credit. The repeated-charge defect received full refunds.

Do not assume that Railway will refund a valid egress or memory charge.

[Railway refund policy](https://docs.railway.com/pricing/refunds) states this rule.

## Umi-specific inference

The evidence does not show routine false billing. It shows material surprise-cost risk under usage billing.

For `umi-api`, keep Redis, web, and worker traffic on Railway private networking.

Supabase remains external to Railway. Traffic from `umi-api` to Supabase can create billable egress.

The API also sends billable egress to clients. The current JSON workload has less media risk than the video report.

Use this minimum control set if Umi selects Railway:

- Pro plan
- One production workspace
- A compute alert
- A compute hard limit
- An Agent hard limit of zero
- Private Redis connections
- Weekly usage review
- External uptime monitoring

Choose the hard limit from measured production use. Add enough margin for a normal traffic peak.

The hard limit changes the failure mode. Railway stops the API when the limit is reached.
