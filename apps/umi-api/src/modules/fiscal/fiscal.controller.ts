import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  FiscalDocumentQuery,
  FiscalStampSaleRequest,
  type FiscalDocumentList,
  type FiscalStampSaleResult,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import type { MerchantAccess } from '../auth/auth.types';
import { Merchant } from '../auth/current-user.decorator';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { FiscalService } from './fiscal.service';

/**
 * The merchant console's fiscal surface (plan §8G step 5): the owner's view of the
 * CFDI clock, and the command that stamps a committed sale.
 *
 * THE GATE IS THE CONSOLE'S, deliberately: `dashboard` + `merchant.manage`, the same
 * pair the floor plan and purchasing use. Invoicing is back-office work with a
 * contador's review behind it, and a till that could stamp its own CFDI with a
 * customer's RFC typed at the counter is a liability rather than a feature. No new
 * permission key is invented: a key no role holds is a feature nobody can use.
 *
 * THERE IS NO CANCELLATION ROUTE, ON PURPOSE. §8G's acceptance requires that
 * cancelling a SALE cancels its fiscal document, so the cancellation lives inside
 * `pos.saleCancel` — one command, in one transaction, where the sale is — rather than
 * in a second place an operator could half-do. `FiscalService.cancelForSale` takes the
 * caller's transaction and never opens one of its own.
 *
 * The paths are unversioned because the dashboard deploys in lockstep with the API
 * (the route table's own rule): only the POS and device surfaces carry `/api/v1`.
 */
@RequireProduct('dashboard')
@RequirePermission('merchant.manage')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@Controller('api/merchants/:merchantId/fiscal/documents')
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

  /** The list, with the counts behind the deadline view and the server's trading day. */
  @Get()
  documents(
    @Merchant() access: MerchantAccess,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(FiscalDocumentQuery)) query: FiscalDocumentQuery,
  ): Promise<FiscalDocumentList> {
    return this.fiscal.documents(access, merchantId, query);
  }

  /**
   * Stamp the committed sale's nominative CFDI.
   *
   * A POST on the collection rather than on the sale, because the document this
   * creates is the collection's member and the sale is identified by its cart id in
   * the body: the same sale stamped twice is one document, and the replay says so.
   */
  @Post()
  stamp(
    @Merchant() access: MerchantAccess,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(FiscalStampSaleRequest)) dto: FiscalStampSaleRequest,
  ): Promise<FiscalStampSaleResult> {
    return this.fiscal.stampSale(access, merchantId, dto);
  }
}
