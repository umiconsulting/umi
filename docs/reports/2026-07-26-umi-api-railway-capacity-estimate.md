# Umi API Railway capacity estimate

Date: 2026-07-26

## Decision

Use these values as a planning range.

| Daily order meaning               | Monthly orders | Estimated Railway bill | Safe monthly budget |
| --------------------------------- | -------------: | ---------------------: | ------------------: |
| 100 orders across all tenants     |          3,000 |                $20–$30 |                 $35 |
| 100 orders for each of 50 tenants |        150,000 |               $70–$180 |                $200 |

The estimate includes the API, the worker, Redis, volume storage, and Railway egress.
It excludes Supabase, Anthropic, Voyage, Twilio, and email costs.

## Workload model

One completed WhatsApp order can require four to eight customer turns.
The base case uses six customer turns for each order.

| Daily order meaning           | Customer turns each day | Customer turns each month |
| ----------------------------- | ----------------------: | ------------------------: |
| 100 orders across all tenants |                 400–800 |             12,000–24,000 |
| 100 orders for each tenant    |           20,000–40,000 |         600,000–1,200,000 |

The tenant count has a small direct effect.
The customer turn count and peak concurrency control the required capacity.

## Railway resource model

### 100 total orders each day

- Run one web replica.
- Run one worker replica.
- Run one Redis service with a 5 GB volume.
- Expect 0.8–1.8 GB of average RAM.
- Expect 0.05–0.20 average vCPU.
- Expect less than 20 GB of monthly egress.

This model gives about $10–$25 of resource use.
The Railway Pro minimum makes the likely bill $20–$30.

### 5,000 total orders each day

- Run two web replicas for availability.
- Run 8–20 worker replicas with the current queue settings.
- Run one Redis service with a 5–10 GB volume.
- Expect 4–10 GB of average RAM.
- Expect 0.3–2.0 average vCPU.
- Expect 30–150 GB of monthly egress.

This model gives about $50–$150 of normal resource use.
A slow model response can require more worker replicas.
Use $70–$180 as the planning range.
Set a $200 alert before production traffic starts.

The current BullMQ processors do not set `concurrency`.
Each queue worker therefore uses the BullMQ default concurrency of one.
Higher I/O concurrency can reduce the required worker replica count.
Test that change before production use.

The current rate limit uses a process-local `Map`.
Move this state to Redis before the API uses multiple web replicas.

## Price basis

Railway charges for actual average use.
The Pro plan costs at least $20 each month.
That amount includes the first $20 of resource use.

The current rates are:

- RAM: $10 for each GB-month.
- CPU: $20 for each vCPU-month.
- Service egress: $0.05 for each GB.
- Volume storage: $0.15 for each GB-month.

Use this formula:

`monthly bill = max($20, RAM + CPU + egress + volume + backups)`

Railway private network traffic has no egress charge.
Use the private network between the worker and Redis.
Supabase remains external and can create Railway egress.

## Important external cost

The API uses `claude-haiku-4-5-20251001`.
Anthropic lists standard pricing at $1 per million input tokens.
Anthropic lists standard pricing at $5 per million output tokens.

The API source records $0.25 and $1.25 per million tokens.
Those constants understate the current standard price by four times.

Each processed turn can make several interactive model calls.
It also queues customer fact extraction after every completed turn.
It queues a summary after the conversation has more than eight messages.
Anthropic and Twilio can therefore cost much more than Railway.

## Sources

- [Railway pricing](https://docs.railway.com/pricing)
- [Railway plans](https://docs.railway.com/pricing/plans)
- [Railway private networking](https://docs.railway.com/networking/private-networking/how-it-works)
- [Railway volumes](https://docs.railway.com/volumes/reference)
- [Railway cost controls](https://docs.railway.com/pricing/cost-control)
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [`docker-compose.yml`](../../apps/umi-api/docker-compose.yml)
- [`job-options.ts`](../../apps/umi-api/src/jobs/job-options.ts)
- [`rate-limit.service.ts`](../../apps/umi-api/src/shared/ratelimit/rate-limit.service.ts)
- [`turn.service.ts`](../../apps/umi-api/src/modules/conversations/turn.service.ts)
- [`enrichment.processor.ts`](../../apps/umi-api/src/jobs/enrichment.processor.ts)
