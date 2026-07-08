import { SetMetadata } from '@nestjs/common';
import type { ProductKey } from '@umi/contract';

export const REQUIRE_PRODUCT = 'umi:requireProduct';

/**
 * Gate a route on a tenant product entitlement (e.g. `@RequireProduct('cash')`).
 * EntitlementGuard returns 403 `product_not_active` when the tenant's
 * `umi.subscription_item.status` is not active/trialing.
 */
export const RequireProduct = (productKey: ProductKey) =>
  SetMetadata(REQUIRE_PRODUCT, productKey);
