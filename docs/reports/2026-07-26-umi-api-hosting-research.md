# Umi API hosting research: VPS, Railway, or Cloudflare

**Date:** 2026-07-26  
**Status:** Evidence report. This report does not change the accepted architecture.

## Executive finding

Keep `apps/umi-api` on the current VPS now.

The VPS is the best fit for the current code and the current traffic. The service already runs in production there.

Choose Railway Pro if server operations become a measured problem. Railway is the best managed migration target for this code.

Do not move the current service to Cloudflare Workers. That move needs a new runtime model and a queue migration.

Cloudflare Containers can run the image. However, it adds a Worker and Durable Object control layer. It also needs external Redis.

## Scope

This report compares these targets:

- The current single VPS with Docker Compose
- Railway Pro
- Cloudflare Workers
- Cloudflare Containers

The comparison covers `apps/umi-api`. It does not evaluate the frontend hosts.

## Repository facts

| Fact                                                                             | Evidence                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The package requires Node.js 22 or later.                                        | [`package.json`](../../apps/umi-api/package.json)                                                                                                                                                                |
| One image starts two processes: `web` and `worker`.                              | [`README.md`](../../apps/umi-api/README.md), [`Dockerfile`](../../apps/umi-api/Dockerfile)                                                                                                                       |
| The web process runs NestJS with Fastify.                                        | [`src/main.ts`](../../apps/umi-api/src/main.ts)                                                                                                                                                                  |
| The worker runs BullMQ processors and schedulers without an HTTP listener.       | [`src/worker.ts`](../../apps/umi-api/src/worker.ts), [`src/worker.module.ts`](../../apps/umi-api/src/worker.module.ts)                                                                                           |
| Both processes require Redis. The worker also uses Redis locks and delayed jobs. | [`src/jobs/queue.module.ts`](../../apps/umi-api/src/jobs/queue.module.ts), [`src/modules/conversations/conversation-lock.service.ts`](../../apps/umi-api/src/modules/conversations/conversation-lock.service.ts) |
| PostgreSQL stays on Supabase today. The app opens two direct `pg` pools.         | [`config.schema.ts`](../../apps/umi-api/src/shared/config/config.schema.ts), [`pg.service.ts`](../../apps/umi-api/src/shared/database/pg.service.ts)                                                             |
| Compose runs web, worker, Redis with AOF, and Caddy.                             | [`docker-compose.yml`](../../apps/umi-api/docker-compose.yml)                                                                                                                                                    |
| CI builds one immutable image and checks `/health` after deployment.             | [`deploy-backend.yml`](../../.github/workflows/deploy-backend.yml), [`deploy-pipeline.md`](../../apps/umi-api/docs/deploy-pipeline.md)                                                                           |
| The accepted design uses a long-running VPS runtime.                             | [`centralization spec`](../architecture/2026-06-23-umi-api-centralization-spec.md)                                                                                                                               |
| The accepted design treats one VPS as an acceptable current risk.                | [`centralization spec §12.6`](../architecture/2026-06-23-umi-api-centralization-spec.md#126-scaling-path)                                                                                                        |

The repository has no current VPS price or production resource history. Therefore, this report gives no exact cost comparison.

## Provider comparison

| Criterion                  | Current VPS   | Railway Pro          | Cloudflare Workers    | Cloudflare Containers           |
| -------------------------- | ------------- | -------------------- | --------------------- | ------------------------------- |
| Current Docker image       | Direct fit    | Direct fit           | No                    | Supported with a control Worker |
| Long-running web process   | Direct fit    | Direct fit           | Request-based runtime | Supported                       |
| Long-running BullMQ worker | Direct fit    | Direct fit           | No direct fit         | Possible with lifecycle code    |
| Redis AOF storage          | Local volume  | Railway Redis volume | External Redis        | External Redis                  |
| Current deployment reuse   | Full          | Partial              | None                  | Partial                         |
| Host operations            | Umi owns them | Railway owns them    | Cloudflare owns them  | Cloudflare owns them            |
| Current migration size     | None          | Medium               | High                  | High                            |
| Current fit                | Best          | Good                 | Poor                  | Possible, but complex           |

### Current VPS

**Documented facts**

- The complete production stack already matches the Compose file.
- The deploy pipeline builds outside the VPS.
- The deploy script pins an immutable image tag.
- Caddy terminates TLS.
- Redis persists data on a named volume.

**Tradeoff**

The VPS keeps the smallest architecture. Umi owns patches, monitoring, backups, and recovery.

The current stack has one host failure domain. The architecture spec already records this risk.

**Umi-specific inference**

The current VPS remains the best choice while it meets the availability target. A host migration has no proven return today.

### Railway Pro

**Documented facts**

Railway can build a selected Dockerfile. It can also map each Compose service to one Railway service.
([Dockerfile documentation](https://docs.railway.com/builds/dockerfiles),
[Compose migration guide](https://docs.railway.com/guides/docker-compose))

Railway services are long-running by default. A service can override the image start command.
([advanced concepts](https://docs.railway.com/overview/advanced-concepts),
[start command](https://docs.railway.com/deployments/start-command))

Private networking gives each service an internal DNS name. It supports TCP traffic between services.
([private networking](https://docs.railway.com/private-networking))

Railway can gate a deployment with `/health`. This check runs during deployment, not continuously.
([health checks](https://docs.railway.com/deployments/healthchecks))

Paid plans can restart failed services without the Free plan limit.
([restart policy](https://docs.railway.com/deployments/restart-policy))

Railway Redis is a Redis Docker image with a simple template. Railway classifies this database as unmanaged.
([Redis documentation](https://docs.railway.com/databases/redis))

Railway volumes support scheduled backups. A service with a volume cannot use replicas.
([backup documentation](https://docs.railway.com/volumes/backups),
[volume limits](https://docs.railway.com/volumes/reference))

Railway Pro costs at least USD 20 each month. That amount includes the first USD 20 of resource use.

Current resource rates are:

- RAM: USD 10 per GB-month
- CPU: USD 20 per vCPU-month
- Egress: USD 0.05 per GB
- Volume storage: USD 0.15 per GB-month

([Railway pricing](https://docs.railway.com/pricing/plans))

Railway has a US East deployment region in Virginia.
([Railway regions](https://docs.railway.com/deployments/regions))

**Tradeoff**

Railway removes host and TLS operations. It also adds platform billing and platform configuration.

Railway does not remove Redis operations. Umi must still configure Redis backups and monitoring.

The Redis volume remains a single storage instance. Railway cannot add replicas to that volume-backed service.

**Umi-specific inference**

Railway is the best alternative when Umi wants fewer host duties. Use Railway Pro for a production team service.

The target Railway project would contain:

1. A public `umi-api-web` service with `node dist/main.js`
2. A private `umi-api-worker` service with `node dist/worker.js`
3. A private Redis service with a volume at `/data`

Use the same Dockerfile for both Node.js services. Set `/health` only on the web service.

Place all three services in US East. Keep PostgreSQL on Supabase until a separate database decision.

Remove Caddy from this target. Railway terminates public TLS at its edge.
([edge networking](https://docs.railway.com/networking/edge-networking))

### Cloudflare Workers

**Documented facts**

Workers supports only a subset of Node.js APIs. Some compatibility modules are non-functional stubs.
([Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/))

A paid Worker has 128 MB of memory. It has a default 30-second CPU limit and a five-minute maximum CPU limit.

HTTP duration has no fixed limit while the client stays connected. Background `waitUntil()` work gets at most 30 extra seconds.

Cron, queue, and Durable Object alarm invocations have a 15-minute wall-time limit.
([Workers limits](https://developers.cloudflare.com/workers/platform/limits/))

Cloudflare Queues has different delivery, retry, retention, and execution limits from BullMQ.
([Queues limits](https://developers.cloudflare.com/queues/platform/limits/))

**Tradeoff**

The web routes need an adapter for the Workers request model. The BullMQ worker needs a different execution model.

A move to Cloudflare Queues changes job identifiers, retry policy, schedulers, locks, and dead-letter behavior.

**Umi-specific inference**

Cloudflare Workers is not a hosting change for `umi-api`. It is a backend rewrite.

That rewrite conflicts with the current centralization goal. It adds risk without evidence of a current capacity problem.

### Cloudflare Containers

**Documented facts**

Cloudflare Containers can run an existing Docker image. The image must support `linux/amd64`.

Each container needs a Worker and a Durable Object for routing and lifecycle control.
([Containers overview](https://developers.cloudflare.com/containers/),
[getting started](https://developers.cloudflare.com/containers/get-started/))

Containers start on demand. Their default idle timeout is ten minutes.

Lifecycle code can renew the timeout without stopping the container.
([container interface](https://developers.cloudflare.com/containers/container-class/))

All container disk is ephemeral. A restart gives the container a fresh image disk.
([container lifecycle](https://developers.cloudflare.com/containers/platform-details/architecture/))

Container scaling is manual today. Cloudflare plans built-in stateless autoscaling for a future release.
([scaling and routing](https://developers.cloudflare.com/containers/platform-details/scaling-and-routing/),
[Containers FAQ](https://developers.cloudflare.com/containers/faq/))

The Workers Paid plan costs USD 5 each month. Container memory, CPU, disk, and egress have separate usage rates.

Workers and Durable Object charges also apply.
([Containers pricing](https://developers.cloudflare.com/containers/pricing/))

**Tradeoff**

The current image can run, but it cannot use local disk for Redis AOF. Umi must keep Redis on another service.

The HTTP container needs routing code. The BullMQ container needs start, idle, restart, and health control code.

The result adds Cloudflare-specific control logic around a host-agnostic service.

**Umi-specific inference**

Cloudflare Containers does not improve the current architecture enough to justify the new control layer.

Reconsider it after built-in autoscaling changes. Also reconsider it if Umi replaces BullMQ with a Cloudflare-native queue.

## Cost decision

Do not compare headline plan prices.

Collect these values first:

1. The current VPS monthly invoice
2. Web and worker p50 and p95 RAM use
3. Web and worker CPU use
4. Redis memory and disk growth
5. Monthly egress
6. Operator hours for patches, deploys, and recovery

Railway recommends at least one week of usage before estimating a monthly bill.
([Railway pricing FAQ](https://docs.railway.com/pricing/faqs))

The operator time matters. Railway can cost more than a VPS and still reduce the total operating cost.

## Recommendation

### Now

Keep the VPS.

Complete these controls before a host migration:

1. Add continuous external monitoring for `/health`.
2. Add an automated off-host Redis backup.
3. Test the Redis restore procedure.
4. Record CPU, RAM, Redis, and egress data for 30 days.
5. Record the availability target and the current result.
6. Patch the host on a defined schedule.

The current CI check runs only after deployment. It does not provide continuous availability monitoring.

### Move to Railway when

Move the complete web, worker, and Redis stack together when one condition becomes true:

- Host operations consume material team time.
- The VPS misses the availability target.
- Umi needs a repeatable staging backend.
- Web and worker need independent resource changes.
- The current VPS needs a major rebuild.

Run Railway Pro in US East. Keep Redis on the same private network and region.

### Use Cloudflare for

Use Cloudflare as an optional public proxy, WAF, or DNS layer in front of the origin.

Do not use Workers as the primary runtime for the current service.

Do not use Containers as the primary runtime until its added control layer has a measured benefit.

## Decision basis

**Documented fact:** The current service needs two long-running Node.js processes, Redis, and PostgreSQL.

**Source-backed tradeoff:** Railway reduces host work with moderate migration effort. Redis remains an unmanaged stateful service.

**Source-backed tradeoff:** Cloudflare Workers improves edge execution but requires a new queue and process model.

**Source-backed tradeoff:** Cloudflare Containers runs the image but adds lifecycle code and external Redis.

**Umi-specific inference:** The current VPS is best now. Railway Pro is the best next host if operations become the main constraint.
