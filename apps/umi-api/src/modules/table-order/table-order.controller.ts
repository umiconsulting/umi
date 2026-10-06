import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { PlaceTableOrderRequest, type PlaceTableOrderRequest as PlaceRequest } from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { Public } from '../auth/public.decorator';
import { TableOrderCredentialGuard, type TableOrderRequest } from './table-order-credential.guard';
import { TableOrderRateLimitGuard } from './table-order-rate-limit.guard';
import { TableOrderService } from './table-order.service';
import type { ResolvedTableOrderCredential } from './table-order.repository';

/**
 * THE GUEST'S TWO ROUTES. Unauthenticated by construction — a QR at a table is read by
 * whoever is sitting there.
 *
 * WHY `/api/public/table-order` AND NOT A `:merchantRef` PREFIX. The two existing public
 * surfaces in the repo both take a merchant in the path: `PublicMerchantGuard` resolves
 * `api/:merchantRef/...` for customer registration and gift cards. This surface cannot:
 * the guest's URL carries ONE opaque token and nothing else, because the merchant and
 * the table are facts the credential RESOLVES — `api/:merchantRef/gift/:code` would put
 * the café's handle in the guest's hands, and the handle is not what was printed on the
 * table. `api/public/` is therefore a new prefix, and it is named so the whole
 * unauthenticated surface is greppable in one place: everything under it opts out of
 * `AuthGuard` and carries its own authority instead.
 *
 * THE GUARD ORDER IS THE DESIGN. `TableOrderCredentialGuard` first — it is the only
 * thing that can seed a merchant, and without it the repository throws. Then
 * `TableOrderRateLimitGuard`, which bounds the CREDENTIAL as well as the address and
 * therefore has to run after the credential exists.
 *
 * NOT IN `ROUTE_TABLE`, deliberately, and the reason is the table's own stated scope:
 * it carries the POS and device surfaces plus what `routes.ts` already imported, and
 * leaves the browser-facing and dashboard handlers out with that boundary written down.
 * The guest page this serves is a separate job and imports no path today.
 */
@Public()
@UseGuards(TableOrderCredentialGuard, TableOrderRateLimitGuard)
@Controller('api/public/table-order')
export class TableOrderController {
  constructor(private readonly orders: TableOrderService) {}

  /** The menu this table may order from. Read-only and safe to refresh. */
  @Get(':token')
  menu(@Req() request: TableOrderRequest) {
    return this.orders.menu(credentialOf(request));
  }

  /**
   * Place the order. 201, because this creates one — and `created: false` in the body
   * when the guest's page retried a submission that had already landed.
   */
  @Post(':token/orders')
  @HttpCode(201)
  place(
    @Req() request: TableOrderRequest,
    @Body(new ZodValidationPipe(PlaceTableOrderRequest)) dto: PlaceRequest,
  ) {
    return this.orders.placeOrder(credentialOf(request), dto);
  }
}

/**
 * The credential the guard resolved. The guard refuses everything without one, so a
 * missing value here is a routing mistake (a handler added to the right controller but
 * somehow reached without the guard) rather than a client error — and it must not be a
 * silent `undefined` that reaches the repository.
 */
function credentialOf(request: TableOrderRequest): ResolvedTableOrderCredential {
  const credential = request.tableOrderCredential;
  if (!credential) throw new Error('table-order route reached without its credential guard');
  return credential;
}
