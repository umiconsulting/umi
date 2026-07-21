import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isProductStatusActive } from '@umi/contract';
import { AuthRepository } from './auth.repository';
import { REQUIRE_PRODUCT } from './require-product.decorator';
import type { AuthedRequest } from './auth.types';

/**
 * Enforces `@RequireProduct('<key>')`. Reads the tenant resolved by
 * TenantAccessGuard and 403s with the dashboard's exact `product_not_active`
 * envelope when the entitlement isn't active/trialing. No decorator ⇒ no gate.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly repo: AuthRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const productKey = this.reflector.getAllAndOverride<string>(REQUIRE_PRODUCT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!productKey) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const tenantId = req.tenantAccess?.tenantId;
    if (!tenantId) {
      // TenantAccessGuard must run first; treat a missing tenant as not-active.
      throw new ForbiddenException({
        error: 'product_not_active',
        product: productKey,
        status: 'missing',
      });
    }

    const status = await this.repo.productStatus(tenantId, productKey);
    if (!isProductStatusActive(status)) {
      throw new ForbiddenException({
        error: 'product_not_active',
        product: productKey,
        status: status ?? 'missing',
      });
    }
    return true;
  }
}
