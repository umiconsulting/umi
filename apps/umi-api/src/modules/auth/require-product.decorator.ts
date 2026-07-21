import { SetMetadata } from '@nestjs/common';
import type { ProductKey } from '@umi/contract';

export const REQUIRE_PRODUCT = 'umi:requireProduct';

/**
 * Gate a route on a tenant product entitlement (e.g. `@RequireProduct('cash')`).
 * EntitlementGuard returns 403 `product_not_active` when the feature is not
 * enabled for the café in `umi.effective_entitlement` (the derived view, already
 * filtered to trialing/active subscriptions).
 */
export const RequireProduct = (productKey: ProductKey) => SetMetadata(REQUIRE_PRODUCT, productKey);
