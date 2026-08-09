import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { getRequestContext } from '../../shared/database/request-context';
import { AuthRepository } from './auth.repository';
import type { AuthedRequest } from './auth.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PublicMerchant {
  merchantId: string;
  name: string;
  handle: string | null;
}

/**
 * Resolves the merchant for PUBLIC (no-login) routes — customer registration, gift-card
 * redemption — WITHOUT membership verification. It seeds
 * `getRequestContext().merchantId` so `PgService.withMerchant()` works on these routes
 * (it otherwise throws without an auth-set context). Not found → 404 with umi-cash's
 * exact Spanish body (`Merchant no encontrado`).
 *
 * The path segment is an id OR a handle, in that order — the same rule
 * MerchantAccessGuard uses. The id is tried first because it is the identifier and every
 * café has one; the handle is tried second because customers hold URLs that carry one.
 * The order also settles any ambiguity: `handle` is only CHECKed against
 * `^[a-z0-9][a-z0-9-]{1,62}$`, which a lowercase uuid satisfies, so a handle could in
 * principle be shaped like an id. Testing the uuid form first means the id always wins.
 */
@Injectable()
export class PublicMerchantGuard implements CanActivate {
  constructor(private readonly repo: AuthRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<AuthedRequest & { publicMerchant?: PublicMerchant }>();
    const key = req.params?.merchantRef;
    const merchant = key ? await this.resolve(key) : null;
    if (!merchant) throw new NotFoundException({ error: 'Merchant no encontrado' });

    req.publicMerchant = {
      merchantId: merchant.id,
      name: merchant.name,
      handle: merchant.handle,
    };
    const ctx = getRequestContext();
    if (ctx) ctx.merchantId = merchant.id;
    return true;
  }

  private async resolve(
    key: string,
  ): Promise<{ id: string; name: string; handle: string | null } | null> {
    if (UUID_RE.test(key)) return this.repo.merchantById(key);
    return this.repo.merchantByHandle(key);
  }
}
