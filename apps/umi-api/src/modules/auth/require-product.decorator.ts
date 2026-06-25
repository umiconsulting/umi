import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PRODUCT = 'umi:requireProduct';

/**
 * Gate a route on a tenant product entitlement (e.g. `@RequireProduct('cash')`).
 * EntitlementGuard returns 403 `product_not_active` when the tenant's
 * `core.product_instances.status` is not active/trialing.
 */
export const RequireProduct = (productKey: string) =>
  SetMetadata(REQUIRE_PRODUCT, productKey);
