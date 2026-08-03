import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { getRequestContext } from '../../shared/database/request-context';
import { AuthRepository } from './auth.repository';
import type { AuthedRequest } from './auth.types';

export interface PublicMerchant {
  merchantId: string;
  name: string;
  slug: string;
}

/**
 * Resolves the merchant from `:slug` for PUBLIC (no-login) routes — customer
 * registration, gift-card redemption — WITHOUT membership verification. It seeds
 * `getRequestContext().merchantId` so `PgService.withMerchant()` works on these
 * routes (it otherwise throws without an auth-set context). Missing slug → 404
 * with umi-cash's exact Spanish body (`Merchant no encontrado`).
 */
@Injectable()
export class PublicMerchantGuard implements CanActivate {
  constructor(private readonly repo: AuthRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<AuthedRequest & { publicMerchant?: PublicMerchant }>();
    const slug = req.params?.slug;
    const merchant = slug ? await this.repo.merchantBySlug(slug) : null;
    if (!merchant) throw new NotFoundException({ error: 'Merchant no encontrado' });

    req.publicMerchant = { merchantId: merchant.id, name: merchant.name, slug: merchant.slug };
    const ctx = getRequestContext();
    if (ctx) ctx.merchantId = merchant.id;
    return true;
  }
}
