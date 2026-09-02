# Per-Client Reward Overrides (umi-cash) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An ADMIN can assign a specific client a custom reward (name + optional description) that replaces the tenant's standard reward everywhere that client sees or redeems it, until the admin removes it.

**Architecture:** A nullable `reward_config_id` on `loyalty.cards` points at an alternative `reward_configs` row (created `is_active: false` so it can never become the tenant default). A pure resolver merges override + tenant default into one "reward profile"; every card-scoped call site swaps its tenant-scoped `getActiveRewardConfig` + `rewardConfigDefaults` pair for the card-scoped helper. Redemptions record the override config id, so the canjes bitácora stays truthful.

**Tech Stack:** Next.js 14 App Router, Prisma 5 (Postgres, schemas `loyalty`/`core`), vitest, Apple/Google Wallet push helpers already in `src/lib`.

**Spec:** Inline — see "Spec (decisions)" below. No tracker item; decided with the owner on 2026-09-01.

## Spec (decisions)

- **Persistent override**, not a one-shot gift: the client earns their custom reward every cycle until the override is cleared. (Owner decision 2026-09-01.)
- **Reward-only:** `visits_required` ALWAYS comes from the tenant's active default config. An override never changes thresholds, progress bars, or milestone copy. (Owner decision 2026-09-01.)
- ADMIN-only mutation (STAFF can see, not set — same stance as the redemption revert endpoint).
- The override must show everywhere the reward name renders for that card: scan preview/commit messages, seals, customer profile, customer card view, Apple/Google wallet passes, lifecycle push copy (`{rewardName}`), reward-earned email.
- Tenant-wide surfaces (public landing `src/app/[slug]/page.tsx`, analytics aggregates) keep the tenant default.
- A redemption by an overridden card records the override's `reward_config_id` in `reward_redemptions`.
- Changing/clearing an override triggers a wallet pass re-push for that card.

## Global Constraints

- All user-facing copy is Spanish (existing strings: "Recompensa", "Canjear recompensa", errors like "No autorizado").
- `visits_required` resolution: tenant default ONLY — never the override row's value (its `visits_required` column is informational filler).
- pnpm is NOT installed on this machine. Use `npm` inside `apps/umi-cash` (`npm test`, `./node_modules/.bin/tsc --noEmit`).
- `next build` needs `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `APP_QR_SECRET` env vars, each ≥32 chars (module-load `requireSecret` in `src/lib/auth.ts`).
- No GitHub Actions workflow covers umi-cash; the Vercel preview build is the CI gate. Local gate: vitest + tsc + build.
- Prod DDL is applied manually to the Supabase database with explicit owner approval BEFORE the code deploy (repo practice, e.g. migration `20260829010000`). The new column is backward-compatible: the currently-deployed Prisma client doesn't know it and ignores it.
- All work happens in `apps/umi-cash/` on branch `feat/umi-cash-per-client-rewards`. Commit trailers per repo Claude conventions.

---

### Task 1: Pure reward-profile resolver

**Files:**
- Create: `apps/umi-cash/src/lib/reward-profile.ts`
- Test: `apps/umi-cash/src/lib/reward-profile.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_VISITS_REQUIRED`, `DEFAULT_REWARD_NAME` from `@/lib/constants` (already exist; used by `rewardConfigDefaults`).
- Produces: `type RewardProfile = { visitsRequired: number; rewardName: string; rewardDescription: string | null; redemptionConfigId: string | null }` and `resolveRewardProfile(defaultConfig, overrideConfig): RewardProfile`. Tasks 2–6 build on these exact names.

- [ ] **Step 1: Write the failing test**

```ts
// apps/umi-cash/src/lib/reward-profile.test.ts
import { describe, it, expect } from 'vitest';
import { resolveRewardProfile } from './reward-profile';
import { DEFAULT_VISITS_REQUIRED, DEFAULT_REWARD_NAME } from './constants';

const tenantDefault = {
  id: 'cfg-default', visits_required: 10,
  reward_name: 'Bebida gratis', reward_description: 'Cualquier bebida del menú',
};
const override = {
  id: 'cfg-override', visits_required: 5, // deliberately different — must be ignored
  reward_name: 'Postre gratis', reward_description: null,
};

describe('resolveRewardProfile', () => {
  it('uses the tenant default when there is no override', () => {
    expect(resolveRewardProfile(tenantDefault, null)).toEqual({
      visitsRequired: 10,
      rewardName: 'Bebida gratis',
      rewardDescription: 'Cualquier bebida del menú',
      redemptionConfigId: 'cfg-default',
    });
  });

  it('takes reward identity from the override but visits from the default', () => {
    const p = resolveRewardProfile(tenantDefault, override);
    expect(p.rewardName).toBe('Postre gratis');
    expect(p.rewardDescription).toBeNull();
    expect(p.redemptionConfigId).toBe('cfg-override');
    // Reward-only override (spec): thresholds never change per client.
    expect(p.visitsRequired).toBe(10);
  });

  it('falls back to constants when the tenant has no active config at all', () => {
    expect(resolveRewardProfile(null, null)).toEqual({
      visitsRequired: DEFAULT_VISITS_REQUIRED,
      rewardName: DEFAULT_REWARD_NAME,
      rewardDescription: null,
      redemptionConfigId: null,
    });
  });

  it('still lets an override apply when the tenant default is missing', () => {
    const p = resolveRewardProfile(null, override);
    expect(p.rewardName).toBe('Postre gratis');
    expect(p.redemptionConfigId).toBe('cfg-override');
    expect(p.visitsRequired).toBe(DEFAULT_VISITS_REQUIRED);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/umi-cash && npm test -- src/lib/reward-profile.test.ts`
Expected: FAIL — "Failed to load url ./reward-profile" (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// apps/umi-cash/src/lib/reward-profile.ts
import { DEFAULT_VISITS_REQUIRED, DEFAULT_REWARD_NAME } from './constants';

/** The columns resolution needs — structurally satisfied by a prisma reward_configs row. */
export type RewardConfigRow = {
  id: string;
  visits_required: number;
  reward_name: string;
  reward_description: string | null;
};

export type RewardProfile = {
  visitsRequired: number;
  rewardName: string;
  rewardDescription: string | null;
  redemptionConfigId: string | null;
};

/**
 * Merge a card's reward override into the tenant default. Overrides are
 * reward-ONLY by decision (2026-09-01): the override supplies the reward's
 * identity (name/description, and the config a redemption records), while
 * visitsRequired always comes from the tenant's active default — a per-client
 * threshold would fork progress bars, pass rendering, and milestone copy.
 */
export function resolveRewardProfile(
  defaultConfig: RewardConfigRow | null,
  overrideConfig: RewardConfigRow | null,
): RewardProfile {
  const identity = overrideConfig ?? defaultConfig;
  return {
    visitsRequired: defaultConfig?.visits_required ?? DEFAULT_VISITS_REQUIRED,
    rewardName: identity?.reward_name ?? DEFAULT_REWARD_NAME,
    rewardDescription: identity?.reward_description ?? null,
    redemptionConfigId: identity?.id ?? null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/reward-profile.test.ts` → 4 passing. Then full suite `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add apps/umi-cash/src/lib/reward-profile.ts apps/umi-cash/src/lib/reward-profile.test.ts
git commit -m "feat(umi-cash): pure reward-profile resolver for per-client overrides"
```

---

### Task 2: Schema column, migration, and card-scoped fetch helper

**Files:**
- Modify: `apps/umi-cash/prisma/schema.prisma` (`model cards` ~line 546, `model reward_configs` ~line 764)
- Create: `apps/umi-cash/prisma/migrations/20260902000000_add_card_reward_override/migration.sql`
- Modify: `apps/umi-cash/src/lib/prisma-helpers.ts`

**Interfaces:**
- Consumes: `resolveRewardProfile`, `RewardProfile` from Task 1.
- Produces: `cards.reward_config_id: string | null` on every fetched card row; `getRewardProfileForCard(tenantId: string, card: { reward_config_id: string | null }): Promise<RewardProfile>` in `@/lib/prisma-helpers`. Tasks 3–6 call it with card rows they already have.

- [ ] **Step 1: Add the column and relation to `schema.prisma`**

In `model cards`, after `metadata Json @default("{}")`:

```prisma
  // Per-client reward override (reward identity only — visits_required always
  // comes from the tenant's active default config). NULL = standard reward.
  reward_config_id    String?               @db.Uuid
```

In the relations block of `model cards` (next to `accounts`/`tenants`):

```prisma
  reward_override     reward_configs?       @relation("card_reward_override", fields: [tenant_id, reward_config_id], references: [tenant_id, id], onDelete: NoAction, onUpdate: NoAction)
```

`NoAction`, NOT `SetNull`: on a composite FK, plain `ON DELETE SET NULL` nulls ALL referencing columns — including NOT-NULL `tenant_id` — so a delete of the referenced config would fail with a not-null violation at runtime (the column-list form needs PG15+ and Prisma can't express it). Nothing in the app deletes `reward_configs` rows (both admin paths only deactivate: `reward-config/route.ts:64`, `api/umi/tenants/[id]/route.ts:222`), so `NO ACTION` costs nothing. Do not copy the `programs` relation's `SetNull` (schema.prisma:776) — that precedent carries the same latent hazard.

In `model reward_configs`, next to `reward_redemptions reward_redemptions[]`:

```prisma
  // 'standard' = a tenant default (current or retired); 'override' = a per-client
  // custom reward. Keeps override rows out of the rewards settings "history" list
  // and out of getActiveRewardConfig's candidate pool by construction.
  kind               String               @default("standard")
  override_cards     cards[]              @relation("card_reward_override")
```

(Overlapping use of `tenant_id` across relations is already the established pattern in this model — `accounts` and `tenants` share it the same way.)

- [ ] **Step 2: Write the migration SQL**

```sql
-- apps/umi-cash/prisma/migrations/20260902000000_add_card_reward_override/migration.sql
ALTER TABLE loyalty.reward_configs ADD COLUMN kind text NOT NULL DEFAULT 'standard';
ALTER TABLE loyalty.reward_configs
  ADD CONSTRAINT loyalty_reward_configs_kind_check CHECK (kind IN ('standard', 'override'));

ALTER TABLE loyalty.cards ADD COLUMN reward_config_id uuid;

-- NO ACTION, not SET NULL: composite SET NULL would null tenant_id (NOT NULL) too.
-- reward_configs rows are never deleted (only deactivated), so this never fires.
ALTER TABLE loyalty.cards
  ADD CONSTRAINT loyalty_cards_reward_override_fkey
  FOREIGN KEY (tenant_id, reward_config_id)
  REFERENCES loyalty.reward_configs (tenant_id, id)
  ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX loyalty_cards_reward_override_idx
  ON loyalty.cards (tenant_id, reward_config_id)
  WHERE reward_config_id IS NOT NULL;
```

Do NOT run `prisma migrate dev` against prod. Regenerate the client only: `npx prisma generate`. The DDL reaches prod via the manual approved-DDL step in Task 7.

- [ ] **Step 3: Add the DB helper to `prisma-helpers.ts`**

Append after `rewardConfigDefaults` (keep both old functions — the landing page and analytics stay tenant-scoped):

```ts
import { resolveRewardProfile, type RewardProfile } from './reward-profile';

/**
 * Card-scoped reward resolution: tenant active default + this card's override
 * (if any). The override row is fetched by id but tenant-guarded so a stale or
 * cross-tenant id can never leak another tenant's reward copy.
 */
export async function getRewardProfileForCard(
  tenantId: string,
  card: { reward_config_id: string | null },
): Promise<RewardProfile> {
  const [defaultConfig, overrideConfig] = await Promise.all([
    getActiveRewardConfig(tenantId),
    card.reward_config_id
      ? prisma.reward_configs.findFirst({ where: { tenant_id: tenantId, id: card.reward_config_id } })
      : Promise.resolve(null),
  ]);
  return resolveRewardProfile(defaultConfig, overrideConfig);
}
```

(`import` lines go at the top of the file with the existing imports.)

- [ ] **Step 4: Verify**

Run: `npx prisma generate && ./node_modules/.bin/tsc --noEmit` → clean. `npm test` → green (helper is exercised via Task 1's pure tests; DB helper is a thin fetch-and-delegate).

- [ ] **Step 5: Commit**

```bash
git add apps/umi-cash/prisma/schema.prisma apps/umi-cash/prisma/migrations/20260902000000_add_card_reward_override apps/umi-cash/src/lib/prisma-helpers.ts
git commit -m "feat(umi-cash): cards.reward_config_id override column + card-scoped reward profile helper"
```

---

### Task 3: Scan commit, preview, and seals use the card's profile

**Files:**
- Modify: `apps/umi-cash/src/app/api/[slug]/admin/scan/route.ts:101-102, 120-123, 181-187`
- Modify: `apps/umi-cash/src/app/api/[slug]/admin/scan/preview/route.ts:44-56`
- Modify: `apps/umi-cash/src/app/api/[slug]/admin/scan/seals/route.ts:82-83`

**Interfaces:**
- Consumes: `getRewardProfileForCard` (Task 2). Every route already holds a hydrated card row (`resolveScanTarget` / `findCardByIdentifier` return full rows, which now include `reward_config_id` after `prisma generate`).
- Produces: no API shape changes — `rewardName`/`visitsRequired` in responses now reflect the override; `reward_redemptions.reward_config_id` records the resolved config.

- [ ] **Step 1: scan/route.ts — swap resolution**

Replace lines 101–102:

```ts
    const rewardConfig = await getActiveRewardConfig(tenant.id);
    const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig);
```

with:

```ts
    const rewardProfile = await getRewardProfileForCard(tenant.id, card);
    const { visitsRequired, rewardName } = rewardProfile;
```

Update the import at line 6 to `import { getRewardProfileForCard } from '@/lib/prisma-helpers';` (drop the two old names if now unused in the file).

- [ ] **Step 2: scan/route.ts — redeem guard and redemption row**

The guard at ~line 120 (`if (includesRedeem && !rewardConfig)`) becomes:

```ts
    if (includesRedeem && !rewardProfile.redemptionConfigId) {
      // A reward config is required to record a redemption (FK to reward_configs).
      return NextResponse.json({ error: 'No hay configuración de recompensa activa' }, { status: 400 });
    }
```

Inside the transaction, the redeem branch condition `if (includesRedeem && rewardConfig)` becomes `if (includesRedeem && rewardProfile.redemptionConfigId)`, and the `reward_redemptions.create` data uses:

```ts
            reward_config_id: rewardProfile.redemptionConfigId,
```

- [ ] **Step 3: preview/route.ts — same swap**

Replace the `getActiveRewardConfig` entry in the `Promise.all` (line 44–45) and the `rewardConfigDefaults` line 56 with a single call after `card` is resolved:

```ts
    const [rewardProfile, activeBirthdayReward] = await Promise.all([
      getRewardProfileForCard(tenant.id, card),
      prisma.birthday_rewards.findFirst({
        // NULL expires_at = never expires (Postgres NULL >= now() is NULL, not true).
        where: {
          tenant_id: tenant.id,
          loyalty_card_id: card.id,
          status: 'active',
          OR: [{ expires_at: null }, { expires_at: { gte: new Date() } }],
        },
      }),
    ]);
    const { visitsRequired, rewardName } = rewardProfile;
```

- [ ] **Step 4: seals/route.ts — same swap**

Replace lines 82–83 with the two-line profile fetch from Step 1 (the route fetched `card` earlier via `findCardByIdentifier`); keep `const required = Math.max(1, visitsRequired);` untouched.

- [ ] **Step 5: Verify and commit**

In all three files remove the now-unused `getActiveRewardConfig`/`rewardConfigDefaults` imports (nothing enforces unused-import removal here). Then `./node_modules/.bin/tsc --noEmit && npm test` → clean/green.

```bash
git add "apps/umi-cash/src/app/api/[slug]/admin/scan"
git commit -m "feat(umi-cash): scan/preview/seals resolve the card's reward override; redemptions record it"
```

---

### Task 4: Admin API — read and set the override (ADMIN-only PATCH)

**Files:**
- Modify: `apps/umi-cash/src/app/api/[slug]/admin/customers/[id]/route.ts` (GET ~lines 21-24, 45, response ~line 100; add PATCH export)

**Interfaces:**
- Consumes: `getRewardProfileForCard` (Task 2), `triggerWalletUpdates` + `readLifecycleMessage` from `@/lib/scan-helpers`, `afterResponse` from `@/lib/after-response`, `getActiveRewardConfig`.
- Produces (Task 5 relies on these exact shapes):
  - GET adds `rewardName: string` and `customReward: { name: string; description: string | null } | null`.
  - `PATCH /api/[slug]/admin/customers/[id]` body `{ customReward: { name: string; description?: string | null } | null }` → `{ success: true, customReward: { name, description } | null }`. Non-ADMIN gets 401 (`requireAuth(['ADMIN'])` returns null for a STAFF token — same behavior as the revert endpoint; the UI additionally gates on `viewerIsAdmin`).

- [ ] **Step 1: GET — resolve per card and expose the override**

Drop `getActiveRewardConfig(tenant.id)` from the opening `Promise.all` — one element remains, so rewrite it as a plain `const person = await prisma.people.findFirst(...)`. After `card` is loaded replace `const { visitsRequired } = rewardConfigDefaults(rewardConfig);` with:

```ts
  const rewardProfile = await getRewardProfileForCard(tenant.id, card);
  const { visitsRequired, rewardName } = rewardProfile;
  const overrideConfig = card.reward_config_id
    ? await prisma.reward_configs.findFirst({ where: { tenant_id: tenant.id, id: card.reward_config_id } })
    : null;
```

Add to the JSON response, next to `visitsRequired`:

```ts
    rewardName,
    customReward: overrideConfig
      ? { name: overrideConfig.reward_name, description: overrideConfig.reward_description }
      : null,
```

- [ ] **Step 2: Add the PATCH handler**

Append to the same route file:

```ts
const RewardOverrideSchema = z.object({
  customReward: z.union([
    z.object({
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(200).nullish(),
    }),
    z.null(),
  ]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { slug: string; id: string } }
) {
  // Setting a client's reward is an owner decision — same ADMIN-only stance as
  // the redemption revert endpoint.
  const user = await requireAuth(['ADMIN'])(req);
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });
  if (user.tenantId !== tenant.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  try {
    const { customReward } = RewardOverrideSchema.parse(await req.json());

    const person = await prisma.people.findFirst({ where: { id: params.id, tenant_id: tenant.id } });
    if (!person) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
    const account = await prisma.accounts.findFirst({
      where: { tenant_id: tenant.id, person_id: person.id },
      select: { id: true },
    });
    const card = account
      ? await prisma.cards.findFirst({
          where: { tenant_id: tenant.id, account_id: account.id },
          orderBy: { created_at: 'desc' },
        })
      : null;
    if (!card) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });

    let overrideId: string | null = null;
    if (customReward) {
      const description = customReward.description?.trim() || null;
      // Reuse an identical override config (several VIPs sharing "Postre gratis"
      // share one row). kind:'override' + is_active:false keeps these rows out of
      // getActiveRewardConfig and out of the rewards settings history list, and
      // means an override can never alias a retired tenant default.
      const existing = await prisma.reward_configs.findFirst({
        where: {
          tenant_id: tenant.id,
          kind: 'override',
          is_active: false,
          reward_name: customReward.name,
          reward_description: description,
        },
      });
      if (existing) {
        overrideId = existing.id;
      } else {
        const defaults = rewardConfigDefaults(await getActiveRewardConfig(tenant.id));
        const created = await prisma.reward_configs.create({
          data: {
            tenant_id: tenant.id,
            kind: 'override',
            reward_name: customReward.name,
            reward_description: description,
            // Informational filler — resolution always takes visits from the
            // tenant default (reward-only override, decision 2026-09-01).
            visits_required: defaults.visitsRequired,
            is_active: false,
          },
        });
        overrideId = created.id;
      }
    }

    const updatedCard = await prisma.cards.update({
      where: { id: card.id },
      data: { reward_config_id: overrideId },
    });

    // The pass shows the reward name — push the new identity to the wallet.
    const rewardProfile = await getRewardProfileForCard(tenant.id, updatedCard);
    const activeBirthdayReward = await prisma.birthday_rewards.findFirst({
      where: {
        tenant_id: tenant.id,
        loyalty_card_id: card.id,
        status: 'active',
        OR: [{ expires_at: null }, { expires_at: { gte: new Date() } }],
      },
      select: { id: true },
    });
    await afterResponse(
      'wallet:reward-override',
      triggerWalletUpdates(
        card.id, card.card_number, updatedCard, person.display_name,
        rewardProfile.visitsRequired, rewardProfile.rewardName, card.created_at,
        tenant.name, params.slug, tenant.primaryColor,
        activeBirthdayReward ? tenant.birthdayRewardName : null,
        readLifecycleMessage(updatedCard.metadata),
      ),
    );

    return NextResponse.json({
      success: true,
      customReward: customReward
        ? { name: customReward.name, description: customReward.description?.trim() || null }
        : null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    console.error('[CustomerReward]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Error al actualizar la recompensa' }, { status: 500 });
  }
}
```

New imports needed at the top of the file: `z` from `'zod'`, `getRewardProfileForCard` from `@/lib/prisma-helpers`, `triggerWalletUpdates, readLifecycleMessage` from `@/lib/scan-helpers`, `afterResponse` from `@/lib/after-response`. Add `export const maxDuration = 30;` (same waitUntil-budget stance as the scan route).

- [ ] **Step 3: Verify and commit**

`./node_modules/.bin/tsc --noEmit && npm test` → clean/green.

```bash
git add "apps/umi-cash/src/app/api/[slug]/admin/customers/[id]/route.ts"
git commit -m "feat(umi-cash): ADMIN endpoint to set/clear a client's custom reward"
```

---

### Task 5: Customer profile UI — show and edit the custom reward

**Files:**
- Modify: `apps/umi-cash/src/app/[slug]/(admin)/admin/customers/[id]/page.tsx` (interface at line 10; render near the visits stat at ~line 181; handlers near `handleRevert` at ~line 108)

**Interfaces:**
- Consumes: Task 4's GET fields (`rewardName`, `customReward`) and PATCH contract. Page idioms: `authedFetch(slug, url, init)`, classes `u-btn u-btn-primary`, `u-btn-secondary`, `u-input`, `u-surface`, `u-eyebrow`; `customer.viewerIsAdmin` gates admin controls (line ~365 shows the existing pattern).

- [ ] **Step 1: Extend the `CustomerDetail` interface**

Add to the interface at line 10:

```ts
  rewardName: string;
  customReward: { name: string; description: string | null } | null;
```

- [ ] **Step 2: Add state + handlers (next to the other handlers)**

```ts
  const [showRewardEdit, setShowRewardEdit] = useState(false);
  const [rewardNameInput, setRewardNameInput] = useState('');
  const [rewardDescInput, setRewardDescInput] = useState('');
  const [savingReward, setSavingReward] = useState(false);

  async function saveCustomReward(clear: boolean) {
    setSavingReward(true);
    try {
      const res = await authedFetch(slug, `/api/${slug}/admin/customers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customReward: clear ? null : { name: rewardNameInput.trim(), description: rewardDescInput.trim() || null },
        }),
      });
      if (res.ok) {
        setShowRewardEdit(false);
        await loadCustomer();
      }
    } finally {
      setSavingReward(false);
    }
  }
```

- [ ] **Step 3: Render the reward line + ADMIN edit block**

Below the "Progreso de visitas" block (page.tsx:177–187 — insert after line 187), add:

```tsx
      <div className="u-surface p-4 mt-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="u-eyebrow" style={{ fontSize: 10 }}>Recompensa</span>
            <p className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
              {customer.rewardName}
              {customer.customReward && (
                <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Personalizada</span>
              )}
            </p>
            {customer.customReward?.description && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-ink-light)' }}>{customer.customReward.description}</p>
            )}
          </div>
          {customer.viewerIsAdmin && !showRewardEdit && (
            <button
              className="u-btn u-btn-secondary px-3"
              onClick={() => {
                setRewardNameInput(customer.customReward?.name ?? '');
                setRewardDescInput(customer.customReward?.description ?? '');
                setShowRewardEdit(true);
              }}
            >
              Editar
            </button>
          )}
        </div>
        {showRewardEdit && (
          <div className="mt-3 space-y-2">
            <input
              type="text" value={rewardNameInput} onChange={(e) => setRewardNameInput(e.target.value)}
              placeholder="Nombre de la recompensa" className="u-input" maxLength={80} autoFocus
            />
            <input
              type="text" value={rewardDescInput} onChange={(e) => setRewardDescInput(e.target.value)}
              placeholder="Descripción (opcional)" className="u-input" maxLength={200}
            />
            <div className="flex gap-2">
              <button className="u-btn u-btn-secondary flex-1" onClick={() => setShowRewardEdit(false)} disabled={savingReward}>
                Cancelar
              </button>
              {customer.customReward && (
                <button className="u-btn u-btn-secondary flex-1" onClick={() => saveCustomReward(true)} disabled={savingReward}>
                  Quitar personalizada
                </button>
              )}
              <button
                className="u-btn u-btn-primary flex-1"
                onClick={() => saveCustomReward(false)}
                disabled={savingReward || !rewardNameInput.trim()}
              >
                {savingReward ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        )}
      </div>
```

- [ ] **Step 4: Verify and commit**

`./node_modules/.bin/tsc --noEmit` clean, then a visual pass with the dev server (`JWT_ACCESS_SECRET=… npm run dev`) or rely on Task 7's build + Vercel preview.

```bash
git add "apps/umi-cash/src/app/[slug]/(admin)/admin/customers/[id]/page.tsx"
git commit -m "feat(umi-cash): customer profile shows and edits the per-client reward (ADMIN)"
```

---

### Task 6: Remaining render surfaces — passes, card view, money routes, lifecycle

Every site below currently does the same two lines (`getActiveRewardConfig(tenant.id)` then `rewardConfigDefaults(...)`) with a card row in scope; each swaps to `const { visitsRequired, rewardName } = await getRewardProfileForCard(tenant.id, card);` (destructure `rewardDescription` too where the old code used it) and updates the `@/lib/prisma-helpers` import accordingly. Anchors:

**Files (all Modify):**
- `apps/umi-cash/src/app/api/[slug]/card/route.ts:29,35` — move the fetch out of the `Promise.all` to after the `!card` guard (it needs the card row).
- `apps/umi-cash/src/app/api/[slug]/passes/apple/route.ts:33,39` — same restructure as card view.
- `apps/umi-cash/src/app/api/[slug]/passes/apple/v1/[...path]/route.ts:184,187` — card is already in scope; replace the `Promise.all` member with `getRewardProfileForCard(tenant.id, card)`.
- `apps/umi-cash/src/app/api/[slug]/passes/apple/[serial]/route.ts:34,40` — the pass-refresh endpoint devices hit after every push; `card` is in scope from line 23. Swap the `Promise.all` member at line 34 and drop the `rewardConfigDefaults` line 40. Missing this one means Apple passes never show the override.
- `apps/umi-cash/src/app/api/[slug]/passes/google/route.ts:34,43` — `card` in scope from line 27; no restructure needed.
- `apps/umi-cash/src/app/api/[slug]/admin/purchase/route.ts:99-100`
- `apps/umi-cash/src/app/api/[slug]/admin/topup/route.ts:123-124`
- `apps/umi-cash/src/app/api/[slug]/gift/[code]/route.ts:133-134`
- `apps/umi-cash/src/app/api/[slug]/admin/redemptions/[id]/revert/route.ts` — no card row exists at the call site (only `redemption`, line 60; the card is first fetched INSIDE the transaction at line 75 and `rewardName` is used within it at line 83). Before the transaction add:

  ```ts
  const cardForReward = await prisma.cards.findUnique({
    where: { id: redemption.loyalty_card_id },
    select: { reward_config_id: true },
  });
  const { visitsRequired, rewardName } = await getRewardProfileForCard(tenant.id, cardForReward ?? { reward_config_id: null });
  ```

- `apps/umi-cash/src/lib/lifecycle.ts` — single-card sender, see Step 2.
- `apps/umi-cash/src/app/api/[slug]/admin/reward-config/route.ts:29-30` — the history list (`findMany` on `is_active: false`) must add `kind: 'standard'` to its `where`, or per-client override rows show up on the rewards settings page as fake former defaults. (Belt-and-suspenders: `getActiveRewardConfig` in prisma-helpers may also add `kind: 'standard'` — overrides are never `is_active: true`, but the filter documents the invariant.)

In every edited file, also remove the now-unused `getActiveRewardConfig`/`rewardConfigDefaults` imports (no `noUnusedLocals` to catch them, so do it by hand).

Leave tenant-scoped on purpose: `src/app/[slug]/page.tsx` (public landing) and `src/app/api/[slug]/admin/analytics/route.ts` (aggregates).

**Interfaces:**
- Consumes: `getRewardProfileForCard` (Task 2); every listed route already holds the card row.
- Produces: wallet passes, the customer card view, and lifecycle pushes render the override name.

- [ ] **Step 1: Apply the swap to the nine route files**

Mechanical per the anchors above. In `card/route.ts` also pass through `rewardDescription` (line 35 destructures it today — keep it from the profile).

- [ ] **Step 2: lifecycle.ts — card-scoped resolution in the single-card sender**

`sendLifecycleMessage` (lifecycle.ts:36) handles ONE card per call — there is no loop and nothing to batch. Three edits:

1. The card query at lifecycle.ts:66 uses a narrow `select`, so the new column will NOT be present unless added — include `reward_config_id: true` in that select.
2. Replace lines 96–97 (`getActiveRewardConfig(tenantId)` + `rewardConfigDefaults(...)`) with:

   ```ts
   const { visitsRequired, rewardName } = await getRewardProfileForCard(tenantId, existing);
   ```

   (`existing` is the selected card row at that point in the function.)
3. Update the import at lifecycle.ts:12 to `import { getRewardProfileForCard } from './prisma-helpers';`.

- [ ] **Step 3: Verify and commit**

`./node_modules/.bin/tsc --noEmit && npm test` clean/green. Grep-gate: `grep -rn "getActiveRewardConfig" src/app` must list ONLY `[slug]/page.tsx` and `admin/analytics/route.ts` — anything else is a missed swap. (In `src/lib`, only `prisma-helpers.ts` keeps a call; `lifecycle.ts` goes through `getRewardProfileForCard` after Step 2.)

```bash
git add apps/umi-cash/src
git commit -m "feat(umi-cash): passes, card view, money routes and lifecycle render the per-client reward"
```

---

### Task 7: Ship — mechanical gates, PR, prod DDL

- [ ] **Step 1: Full local gate**

```bash
cd apps/umi-cash
npm test
./node_modules/.bin/tsc --noEmit
S=local-placeholder-secret-0123456789abcdef JWT_ACCESS_SECRET=$S JWT_REFRESH_SECRET=$S APP_QR_SECRET=$S npm run build
```

All must be green, read from real output.

- [ ] **Step 2: pr-gates review pass**

Run the repo `pr-gates` flow (two-axis review vs. merge-base, this plan is the spec). Resolve or explicitly accept findings.

- [ ] **Step 3: Open the PR**

Branch `feat/umi-cash-per-client-rewards`, PR titled `feat(umi-cash): per-client reward overrides`. Note on the PR: no GH Actions workflow covers umi-cash; Vercel preview is the CI gate. Summon CodeRabbit with a `@coderabbitai full review` comment (it skips this repo otherwise).

- [ ] **Step 4: Prod DDL before merge-deploy (OWNER APPROVAL REQUIRED)**

Apply `20260902000000_add_card_reward_override/migration.sql` to the production database (Supabase project `xbudknbimkgjjgohnjgp`) with explicit owner approval, BEFORE merging: the old deployed client ignores the new column (backward-compatible), while the new code requires it. Then merge on green Vercel + secret-scan, and verify the production deploy.

- [ ] **Step 5: Manual smoke test on prod**

As ADMIN: open a test client's profile → set custom reward "Postre gratis" → confirm profile badge, scan-preview shows "Postre gratis" as the redeem sublabel, and the customer's wallet pass re-renders with the new name. Redeem once → canjes bitácora row exists → clear the override → pass reverts to the standard reward.

---

## Self-review notes

- Spec coverage: persistence (Task 2 column + Task 4 PATCH), reward-only (Task 1 resolver rule + test), ADMIN-only (Task 4), all render surfaces (Tasks 3, 5, 6 — grep-gate in Task 6 Step 3 catches misses), redemption records override (Task 3 Step 2), wallet re-push on change (Task 4 Step 2), tenant-wide surfaces untouched (Task 6 exclusion list).
- Type consistency: `RewardProfile`/`resolveRewardProfile`/`getRewardProfileForCard` names and shapes are identical across Tasks 1–6; PATCH/GET shapes in Task 4 match the UI in Task 5.
- Known accepted risk: two admins editing the same client's reward concurrently last-write-wins on `cards.reward_config_id` — harmless (no counter involved), so no lock added.
- Verified against the codebase 2026-09-01 (independent review pass): FK changed to NO ACTION (composite SET NULL would null tenant_id), lifecycle.ts corrected to its real single-card shape (narrow select needs `reward_config_id: true`), `passes/apple/[serial]` added to Task 6, revert route's pre-transaction card fetch added, all remaining line anchors and the `triggerWalletUpdates` argument order confirmed.
- Second pass (product surfaces beyond the checklist): Google pass face renders the reward name from OBJECT-level text modules (`pending_rewards`/`next_reward`, pass-google.ts:87-113) that the class template references by id — per-card names render correctly, no class change needed. Analytics bitácora rows carry no reward name (analytics/route.ts:236-243) — no mislabeling. The rewards settings history leak led to the `kind` discriminator (see Task 2/4/6).
- Out-of-scope follow-up recorded: once rewards can differ per client, the canjes bitácora could show WHICH reward each canje was (join `reward_configs.reward_name` per row in analytics/route.ts:236-243 and render it in analytics/page.tsx:243). Not required for this feature to be correct.
