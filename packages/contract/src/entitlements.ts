// Single source of truth for the product-entitlement vocabulary, shared by:
//   - umi-api  EntitlementGuard / @RequireProduct
//     (apps/umi-api/src/modules/auth/{entitlement.guard,require-product.decorator}.ts)
//   - umi-dashboard module registry
//     (apps/umi-dashboard/src/lib/module-registry.js)
// Today both sides hand-maintain their own copy of PRODUCT_ACTIVE_STATUSES — this
// module exists to collapse that drift (the actual re-wiring lands in a follow-up PR).
//
// Zero-dependency ON PURPOSE: no zod import, so the dashboard (plain JS, zod-free
// bundle) can consume it exactly like it consumes '@umi/contract/routes'.

/**
 * Products a tenant can be entitled to — the values `@RequireProduct(...)` gates
 * on, and the `product` field in the dashboard module registry.
 *
 * Note: the entitlement catalog (`umi.feature`) additionally permits internal/
 * non-purchasable modules that no `@RequireProduct` gates on. `pos` (UmiPOS) IS a
 * purchasable product: it lives in the catalog and is gateable here, but is bundled
 * into no plan yet — a café is entitled only when POS is explicitly sold (a
 * `umi.plan_feature` grant or `umi.entitlement_override`).
 */
export const PRODUCT_KEYS = ['cash', 'conversaflow', 'kds', 'dashboard', 'pos'] as const;
export type ProductKey = (typeof PRODUCT_KEYS)[number];

/**
 * The entitlement statuses that grant access to a gated product. Ported 1:1 from
 * server.js `PRODUCT_ACTIVE_STATUSES`; mirrored today in the api guard
 * (`entitlement.guard.ts`) and the dashboard registry (`module-registry.js`).
 */
export const PRODUCT_ACTIVE_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing']);

/** True if `status` (a `core.product_instances.status`) grants product access. */
export function isProductStatusActive(status: string | null | undefined): boolean {
  return status != null && PRODUCT_ACTIVE_STATUSES.has(status);
}
