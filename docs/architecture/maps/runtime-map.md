# Runtime Map

This map summarizes execution chains. Code and migrations remain the source of truth.

## API request and job pipeline

1. `apps/umi-api` validates each request and resolves its authenticated scope.
2. API modules execute canonical business commands against PostgreSQL.
3. Durable jobs and outbox records control asynchronous side effects.
4. The worker processes bounded jobs and records safe telemetry.
5. API contracts expose normalized results to product clients.

## Conversations and prompts

- Runtime prompts and conversation logic live in `apps/umi-api`.
- The API normalizes channel data before a product client consumes it.
- Memory is context, not operational truth.

## UmiPOS execution

1. UmiPOS authenticates through an enrolled device and an operator PIN.
2. UmiPOS consumes generated Dart contracts from `packages/contract`.
3. The API owns sales, payments, inventory, customer value, and shift facts.
4. Native clients can journal approved offline cash work for controlled replay.
5. Hardware access stays behind the UmiPOS hardware runtime.

## KDS execution

1. KDS reads API-owned kitchen projections.
2. KDS mutations use backend commands.
3. The API remains the source of commercial order truth.
4. KDS renders and optimistically updates local UI state while respecting backend transitions.

## Cash execution

1. Cash uses its separate Next.js and npm workflow.
2. Cash retains Prisma compatibility behavior.
3. The frozen wallet-pass route forwards generation to the API.
4. New wallet, loyalty, and pass authority belongs in the API.

## Dashboard execution

The Dashboard reads normalized API data.
Its visible functions, screens, and flows remain the behavior contract for production hardening.

## Landing execution

The landing app serves public content and captures leads.
Canonical lead writes belong in the API.
