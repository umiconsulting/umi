# Dashboard sales performance

## Outcome and scope

The user requested a deep investigation of dashboard query speed and memory.
The user permits up to 60 seconds of cache age and requires a manual refresh.
All changes remain local. Staging integration and deployment require explicit authorization.
The performance branch starts at `origin/staging`, commit `b04a1ba4`.
The local category dashboard also receives the candidate changes for combined browser verification.
The existing category PR remains unchanged.

See the [primary-source research](../research/2026-11-07-dashboard-performance.md) for tools, versions, licences, tradeoffs and failed research routes.

## Measurements before changes

The browser measured the same ONCA period through the deployed API and the local verification adapter.
The local adapter opened a separate SSH process for every repository query.

| Observation                | Deployed staging | Local verification adapter |
| -------------------------- | ---------------: | -------------------------: |
| First visible sales widget |         2,172 ms |                   8,781 ms |
| Main sales report request  |           162 ms |                   7,059 ms |

These are individual observations, rather than latency percentiles.
The local frontend uses Vite development mode, which also differs from a deployed bundle.
They do not prove a production slowdown of seven seconds.

Read-only `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON)` used the actual repository SQL and the scoped `api` role.

| Repository query                     | PostgreSQL execution |
| ------------------------------------ | -------------------: |
| Merchant metadata and first sale     |             4.318 ms |
| Products                             |             0.461 ms |
| Locations                            |             0.212 ms |
| Saved groups                         |             0.384 ms |
| Receipt lines and refunds, 300 sales |            16.109 ms |

The measured queries used shared buffer hits and wrote zero temporary blocks.
Sequential scans on these small tables do not establish an index defect.
The existing migration `064_sales_analysis_indexes.sql` already covers receipt dates, sale scope and committed refunds.

PostgreSQL is 17.10. Its settings include `shared_buffers=128MB`, `work_mem=4MB` and `max_connections=100`.
The sample had six idle connections and one active diagnostic connection.
`pg_stat_statements` exists in schema `extensions`, but `shared_preload_libraries` is empty.
The qualified view returned the required-preload error. No server settings were changed.

## Local transport correction

The local adapter now reuses one SSH and PostgreSQL session.
It serializes complete transactions and preserves `BEGIN READ ONLY`, role `api` and tenant context.
It deallocates prepared statements and applies a local statement timeout.
It uses asynchronous transport, which preserves the Node event loop during network waits.
The adapter obtains the authorized staging browser session for read requests, rather than rotating a cloned refresh token.
Business writes remain blocked.

A subsequent observation measured the main local report at 1,316 ms and the first widget at 3,390 ms.
The current and previous reports share the diagnostic connection, so they can queue behind each other.
This adapter is a local verification tool. It does not replace the production connection pool.

## Exact backend computation

The analysis previously counted every pair again for each identical basket.
Its limit of 100,000 distinct pairs did not limit repeated pair work.
The synthetic 1,000-ticket case with 400 repeated products took 13,792 ms.

The candidate applies these changes:

- Index returned quantities once per sale, rather than scan all refunds once per line.
- Count identical product sets with their exact ticket weights.
- Keep small baskets on the direct path to avoid unnecessary cache keys.
- Limit retained basket patterns to 1,000 entries.
- Limit actual pair evaluations to five million, independently of the distinct-pair limit.
- Reject excessive computation with `REPORT_RANGE_TOO_COMPLEX` and a specific UI message.
- Stream sale and refund metric events into all dimensions in one pass.
- Count refunded units without temporary flattened arrays.

The five-million budget is an UMI inference from the local CPU measurements.
It is a work bound, rather than a promise that every request finishes within a fixed wall time.
The pattern limit bounds retained optimization state. It does not bound the complete report payload.
The existing 20,000-ticket and 5,000-product limits remain active.
Large line or refund payloads still need representative load tests before a separate database-side byte limit is selected.

The benchmark uses deterministic synthetic inputs, rather than invented merchant data.
It compares hashes of the complete report, including monetary totals, dimensions, coverage, pairs and selected groups.
The original and optimized results must match exactly for accepted inputs.

The release comparison used Node 22.23.2 and three repetitions per implementation.
The table reports medians from fresh processes.
Initial exploratory runs used Node 24.21.0, the workstation default.

| Synthetic input                             |    Original | Candidate |
| ------------------------------------------- | ----------: | --------: |
| 300 tickets, 4 products                     |     12.1 ms |   11.1 ms |
| 20,000 tickets, 4 products                  |    119.4 ms |  104.9 ms |
| 10,000 tickets, 50 repeated products        |  2,193.1 ms |  146.4 ms |
| 10,000 tickets, 4 products, 20 refunds each |    507.6 ms |  425.4 ms |
| 1,000 tickets, 400 repeated products        | 18,948.0 ms |  120.2 ms |

All five cases retain identical report hashes.
Another 800 deterministic comparisons cover both refund criteria, both basket units, multiple branches, dates and overlapping groups.
Every complete report matches the original implementation.
The refund-heavy case's median heap delta changed from 51.0 MB to 17.7 MB.
This is an allocation snapshot, rather than a process memory limit or a claim of lower memory for every workload.
The small 20,000-ticket case had a higher heap delta, which can reflect garbage collection timing.

Run the benchmark after the API build:

```sh
UMI_BENCH_MAX_MS=2000 node --expose-gc tools/performance/sales-analysis.cjs
```

`UMI_ANALYSIS_MODULE` selects an alternate compiled implementation for comparison.
`UMI_BENCH_OUTPUT` selects the JSON evidence path.
Heap deltas are snapshots of temporary allocation, rather than peak memory measurements.
Process RSS includes the fixtures and prior scenarios, so it must not be attributed solely to report computation.

## Browser cache and refresh

The dashboard uses the existing TanStack Query 5.102.8 cache.
No Redis cache or new service was added.

- Report keys contain merchant, branch context, user, permission context and canonical report filters.
- Empty optional filters and property order produce the same key.
- Manual refresh refetches the same entry, rather than adding a counter to the cache key.
- Reports remain fresh for 60 seconds. Unobserved entries expire from memory after five minutes.
- Active reports and options refresh according to the age of their current result.
- A stale report refreshes when the browser regains focus.
- Requests consume the TanStack `AbortSignal`.
- A background refresh preserves the current report and shows **Actualizando ventas…**.
- Query errors retain the explicit error flow. They never become zero totals.
- Successful group writes cancel and invalidate the merchant's options and report entries after API confirmation.
- Failed requests schedule the next automatic attempt from the error time, rather than poll each second.

The backend still checks current permissions on every actual request.
The change adds no shared server cache that could bypass RLS or expose another user's report.

The real browser verification confirmed:

- Two initial report requests for the current and previous periods.
- Zero additional report requests for home → detail → home within the freshness interval.
- Two report entries after a manual refresh, rather than four.
- Visible report values during background refresh.
- Automatic refresh after 58,877 ms in the measured run.
- Zero JavaScript errors.
- A computation error preserves the explicit error state, avoids repeated requests and recovers through manual retry.

The final category regression also passed all data states and three axe scans with zero violations.

The driver is `tools/performance/dashboard-sales-browser.mjs`.
It uses an authorized local browser session and preserves the user's tabs.
It records screenshots, request counts and timings under `/tmp/umi-dashboard-performance` by default.

## Database and cache decisions

The measurements do not justify global memory changes, a larger pool, new indexes or Redis.
`work_mem` can apply to multiple operations in each concurrent session.
Increasing it without measured spills can increase total memory pressure.
The pool needs acquisition-wait and concurrency measurements before its size changes.

A future backend cache needs permission checks before every hit and explicit scope in its keys.
Its invalidation must cover sales, refunds, offline ingestion, catalog changes and saved groups.
An older `sale_result` report can change after a later refund.
The current catalog can also change historical category attribution.
Historical periods are therefore not immutable cache entries.

If cross-process reuse becomes necessary, compare a bounded cache against a dedicated aggregate projection.
Use committed data revisions or an outbox for invalidation across writers.
Do not evict shared queue or session data to make room for report blobs.
These are future decisions, not implemented capabilities.

## Verification record

The computational budget test first failed against the original analyzer.
The benchmark also failed its two-second budget before the optimization.
The cache tests first failed because the new policy module did not exist.
The accepted-input reports retain exact hashes across implementations.

The first full build found the new worktree's missing local environment configuration.
The local configuration was supplied before the next verification run.
No production or staging configuration changed.

The affected gate passed seven tasks: builds, lint and tests.
The dashboard suite passed 660 tests. The API suite passed 2,163 tests and retained 29 existing skips.
The sales analysis PostgreSQL integration suite passed seven tests.
The API typecheck and canonical repository gate passed.
The dashboard retains its baseline of 68 lint warnings and its existing bundle size warning.

## Independent reviews

Standards: zero unresolved material findings.
Spec: zero unresolved findings.
The reviews found failed-poll repetition and stale inactive options after group writes.
They also reproduced an in-flight write race with cached and empty query data.
The fixes use the latest error time for polling and explicit cancellation before options and report invalidation.
Ten cache tests cover reuse, scope, refresh, errors and all four invalidation race cases.
The reviewers independently confirmed the final fixes.

Tools: Node 22.23.2, pnpm 10.29.3, PostgreSQL 17.10, pg 8.22.0, TanStack Query 5.102.8, Playwright 1.62.1 and Chromium CDP.
