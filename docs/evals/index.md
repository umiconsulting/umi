# Eval Index

This index routes agents to correctness checks. It does not replace repo-specific test commands.

## ConversaFlow

- Runtime correctness surfaces: Deno tests, mini-harness signoff, SQL audits, trace diagnostics, pipeline trace inspection.
- Key eval docs/reports: `apps/umi-conversaflow/reports/mini-harness-signoff/signoff-review.md`.
- Run repo-local checks before modifying prompts, processors, workflow jobs, memory, or tools.

## KDS

- Runtime correctness surfaces: Swift/Xcode tests where available, KDS architecture contract docs, client API behavior checks.
- Run relevant Swift tests before modifying client state, API calls, or UI behavior.

## Cash

- Runtime correctness surfaces: Next.js build, Prisma validation/migration workflows, package scripts, Vercel cron behavior.
- Run repo-local build/test/lint commands where available before modifying runtime behavior.

## Logs

- Runtime correctness surfaces: Next.js build and trace parser behavior.
- Add focused parser tests before broad trace-assembly changes.

## Dashboard

- Runtime correctness surface: build validation plus visual/function preservation of the live dashboard.
- Future production hardening should treat current screens and flows as expected behavior.
