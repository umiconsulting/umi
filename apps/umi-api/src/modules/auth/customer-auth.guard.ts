import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { CustomerTokenService } from '../../shared/auth/customer-token.service';
import type { AuthedRequest } from './auth.types';
import type { PublicMerchant } from './public-merchant.guard';

export interface CustomerAuth {
  /** The `merchant.customer` this session speaks for. */
  customerId: string;
  merchantId: string;
}

/**
 * A logged-in CUSTOMER, on a merchant-scoped route.
 *
 * Runs AFTER `PublicMerchantGuard`, which resolves `:merchantRef` and seeds the
 * RLS context — a customer is not a staff member, so `MerchantAccessGuard` (which
 * verifies membership) can never be the guard for these routes.
 *
 * TWO CHECKS, and the second is the one worth writing down. A valid token proves
 * who the customer is; it does not prove she belongs to the café in the URL.
 * Without the comparison, any customer's token would read any café's route — and
 * because `PublicMerchantGuard` has already set the RLS scope to THAT café, the
 * queries would happily answer. Same refusal umi-cash makes (`user.tenantId !==
 * tenant.id` → 403), for the same reason.
 */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(private readonly tokens: CustomerTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      AuthedRequest & {
        headers?: Record<string, string | undefined>;
        publicMerchant?: PublicMerchant;
        customerAuth?: CustomerAuth;
      }
    >();

    const claims = await this.tokens.fromHeader(req.headers?.authorization);
    if (!claims) throw new UnauthorizedException({ error: 'No autorizado' });

    const merchantId = req.publicMerchant?.merchantId;
    if (!merchantId || claims.merchantId !== merchantId) {
      throw new ForbiddenException({ error: 'No autorizado' });
    }

    req.customerAuth = { customerId: claims.subjectId, merchantId };
    return true;
  }
}
