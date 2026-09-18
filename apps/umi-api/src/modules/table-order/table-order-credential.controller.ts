import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  IssueTableOrderCredentialRequest,
  RevokeTableOrderCredentialRequest,
  TableOrderCredentialQuery,
  Uuid,
  type IssueTableOrderCredentialRequest as IssueRequest,
  type RevokeTableOrderCredentialRequest as RevokeRequest,
  type TableOrderCredentialQuery as CredentialQuery,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TableOrderService } from './table-order.service';

/**
 * THE OWNER'S DOOR: print a table's code, and kill it.
 *
 * The ADR (§9) requires that a table's QR be "revocable without reprinting every
 * table's code", and a revocation COLUMN with no operation behind it does not satisfy
 * that — it is a fact nobody can change. So the two operations are here, on the
 * console's side of the house (`api/merchants/:merchantId/...`, the same prefix the
 * dashboard's floor-plan and table-state reads use), because a QR is printed once and
 * stuck to a table: this is setup work, not till work.
 *
 * PRINTING THE QR IS NOT THIS ROUTE'S JOB. `GET` returns the table's credential ROW
 * (without the token — the database cannot reproduce it), and `POST` returns the token
 * once, at issuance. Turning that token into an image is the screen's concern, and the
 * plan's tool list already names a QR generator for the table flow.
 */
@RequireProduct('dashboard')
@RequirePermission('table_order.credential.manage')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@Controller('api/merchants/:merchantId/table-order-credentials')
export class TableOrderCredentialController {
  constructor(private readonly orders: TableOrderService) {}

  /** Live and revoked credentials for a location — what the owner has in the room. */
  @Get()
  list(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(TableOrderCredentialQuery)) query: CredentialQuery,
  ) {
    return this.orders.listCredentials(access, query.locationId);
  }

  /** Issue the code for one table. Refused while that table already has a live one. */
  @Post()
  issue(
    @Merchant() access: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(IssueTableOrderCredentialRequest)) dto: IssueRequest,
  ) {
    return this.orders.issueCredential(user, access, dto);
  }

  /**
   * Revoke one code. A POST rather than a DELETE: the credential is NOT deleted — it is
   * the record that this table's code existed and when it stopped working, and the
   * `table_order` rows that reference it stay readable. The operation also carries an
   * idempotency key, which a DELETE has nowhere to put.
   */
  @Post(':credentialId/revoke')
  revoke(
    @Merchant() access: MerchantAccess,
    @CurrentUser() user: AuthUser,
    // Piped through the contract's own `Uuid`, not taken as a bare string: an id that is
    // not a uuid reaches the repository as `$3::uuid` and comes back as a `22P02` — a 500
    // for a client mistake, and a log line naming a Postgres cast rather than the route.
    @Param('credentialId', new ZodValidationPipe(Uuid)) credentialId: string,
    @Query(new ZodValidationPipe(TableOrderCredentialQuery)) query: CredentialQuery,
    @Body(new ZodValidationPipe(RevokeTableOrderCredentialRequest)) dto: RevokeRequest,
  ) {
    return this.orders.revokeCredential(user, access, credentialId, query.locationId, dto);
  }
}
