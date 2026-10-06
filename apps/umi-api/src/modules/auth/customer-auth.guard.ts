import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { CustomerTokenService } from '../../shared/auth/customer-token.service';
import type { AuthedRequest } from './auth.types';
import type { PublicMerchant } from './public-merchant.guard';

/** What `CustomerSessionService` stamps on a customer session, and only on one. */
const CUSTOMER_ROLE = 'CUSTOMER';

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
 * THREE CHECKS, and the two after the signature are the ones worth writing down.
 *
 * A valid token proves who the subject is; it does not prove she belongs to the
 * café in the URL. Without the merchant comparison, any customer's token would
 * read any café's route — and because `PublicMerchantGuard` has already set the
 * RLS scope to THAT café, the queries would happily answer. Same refusal
 * umi-cash makes (`user.tenantId !== tenant.id` → 403), for the same reason.
 *
 * ⚠️ NOR DOES A VALID SIGNATURE PROVE THE SUBJECT IS A CUSTOMER. One key signs
 * the barista's session as well, so a STAFF token reaches this guard perfectly
 * signed and, until the role check below, was accepted — `subjectId` is then a
 * `umi.user.id` being handed to a query that keys on `merchant.customer.id`. No
 * customer data leaks today because the two id spaces do not collide, which is
 * an accident of uuids and not a decision anyone made. The role check makes it
 * a decision.
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
    if (!claims || claims.role !== CUSTOMER_ROLE) {
      throw new UnauthorizedException({ error: 'No autorizado' });
    }

    const merchantId = req.publicMerchant?.merchantId;
    if (!merchantId || claims.merchantId !== merchantId) {
      throw new ForbiddenException({ error: 'No autorizado' });
    }

    req.customerAuth = { customerId: claims.subjectId, merchantId };
    return true;
  }
}
