import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { getRequestContext } from '../../shared/database/request-context';
import type { AuthedRequest } from '../auth/auth.types';
import {
  TableOrderRepository,
  hashTableOrderToken,
  type ResolvedTableOrderCredential,
} from './table-order.repository';

/** What the guest's two handlers read instead of a body field. */
export type TableOrderRequest = AuthedRequest & {
  tableOrderCredential?: ResolvedTableOrderCredential;
};

/**
 * Resolves the guest's token — the `:token` path segment — to (merchant, location,
 * table), and seeds the RLS context from THAT ROW.
 *
 * THIS GUARD IS THE AUTHORITY FOR THE PUBLIC INTAKE, and it is the mirror of
 * `PublicMerchantGuard`: both exist so an unauthenticated route can still run through
 * merchant-scoped repositories, and both resolve the scope from the credential rather
 * than from anything the caller sent. The difference is what the credential is worth.
 * A merchant handle is public; a table-order token is a secret printed at one table, so
 * this guard also narrows the LOCATION — a token minted for café A's table 4 cannot
 * read or write café B's menu even if the request is replayed against a different host,
 * and it cannot reach another branch of the same café.
 *
 * A REVOKED OR UNKNOWN TOKEN IS ONE REFUSAL. See `resolveCredential` for why the two
 * are deliberately indistinguishable here.
 */
@Injectable()
export class TableOrderCredentialGuard implements CanActivate {
  constructor(private readonly repo: TableOrderRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TableOrderRequest>();
    const token = request.params?.token;
    const credential = token ? await this.repo.resolveCredential(hashTableOrderToken(token)) : null;
    if (!credential) {
      throw new NotFoundException({
        code: 'TABLE_ORDER_CREDENTIAL_INVALID',
        message:
          'Este código de mesa ya no está activo. Pídele a tu mesero un código nuevo o haz tu pedido en la caja.',
      });
    }

    request.tableOrderCredential = credential;
    const ctx = getRequestContext();
    if (ctx) {
      ctx.merchantId = credential.merchantId;
      // Not decoration: both new tables carry a location-narrowed policy, and the
      // catalog's availability is per LOCATION. Without this the reads would come back
      // empty, which looks exactly like "this café has no menu".
      ctx.locationId = credential.locationId;
    }
    return true;
  }
}
