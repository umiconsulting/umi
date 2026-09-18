import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  CancelPurchaseOrderRequest,
  CreatePurchaseOrderRequest,
  CreateSupplierRequest,
  PurchaseOrderQuery,
  PurchaseOrderScopeQuery,
  ReceivePurchaseOrderRequest,
  SendPurchaseOrderRequest,
  SupplierInvoiceQuery,
  SupplierQuery,
  UpdateSupplierRequest,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ProcurementService } from './procurement.service';

/**
 * The merchant console's purchasing surface (plan §8E step 3).
 *
 * Gate chain and permission are the floor plan's, deliberately: `dashboard` +
 * `merchant.manage`. Buying stock is the same class of work as editing the layout
 * — a manager deciding how the business spends money — and the alternative, an
 * `inventory.*` key, is carried only by POS operator sessions, which would make
 * these routes unreachable from the surface that needs them. No new permission is
 * invented: a key no role holds is a feature nobody can use, which is the failure
 * `pnpm check:role-surfaces` exists to catch.
 *
 * The paths are unversioned because the dashboard deploys in lockstep with the API
 * (the route table's own rule): only the POS and device surfaces carry `/api/v1`,
 * because the POS is the client that lives in the field on an old build.
 *
 * Every write verb names its operation rather than sharing one endpoint, for the
 * reason the table map records: `PURCHASE_ORDER_OVER_RECEIPT` and
 * `PURCHASE_ORDER_NOT_SENT` are different facts about different mistakes, and one
 * polymorphic verb would have to publish one error set for both.
 */
@RequireProduct('dashboard')
@RequirePermission('merchant.manage')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@Controller('api/merchants/:merchantId/suppliers')
export class SupplierController {
  constructor(private readonly procurement: ProcurementService) {}

  @Get()
  list(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(SupplierQuery)) query: SupplierQuery,
  ) {
    return this.procurement.listSuppliers(access, query);
  }

  @Post()
  create(
    @Merchant() access: MerchantAccess,
    @Body(new ZodValidationPipe(CreateSupplierRequest)) dto: CreateSupplierRequest,
  ) {
    return this.procurement.createSupplier(access, dto);
  }

  @Put(':supplierId')
  update(
    @Merchant() access: MerchantAccess,
    @Body(new ZodValidationPipe(UpdateSupplierRequest)) dto: UpdateSupplierRequest,
  ) {
    return this.procurement.updateSupplier(access, dto);
  }
}

@RequireProduct('dashboard')
@RequirePermission('merchant.manage')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@Controller('api/merchants/:merchantId/purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly procurement: ProcurementService) {}

  @Get()
  list(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(PurchaseOrderQuery)) query: PurchaseOrderQuery,
  ) {
    return this.procurement.listPurchaseOrders(access, query);
  }

  @Get(':purchaseOrderId')
  get(
    @Merchant() access: MerchantAccess,
    @Param('purchaseOrderId') purchaseOrderId: string,
    @Query(new ZodValidationPipe(PurchaseOrderScopeQuery)) query: PurchaseOrderScopeQuery,
  ) {
    return this.procurement.getPurchaseOrder(access, query, purchaseOrderId);
  }

  @Post()
  create(
    @Merchant() access: MerchantAccess,
    @Body(new ZodValidationPipe(CreatePurchaseOrderRequest)) dto: CreatePurchaseOrderRequest,
  ) {
    return this.procurement.createPurchaseOrder(access, dto);
  }

  /**
   * Sending is the moment the ordered goods become `in_transit`. It is a route of
   * its own rather than a status the client may PUT, because the transition posts
   * stock and must be idempotent as a command.
   */
  @Post(':purchaseOrderId/send')
  send(
    @Merchant() access: MerchantAccess,
    @Body(new ZodValidationPipe(SendPurchaseOrderRequest)) dto: SendPurchaseOrderRequest,
  ) {
    return this.procurement.sendPurchaseOrder(access, dto);
  }

  /**
   * Receiving is what moves stock. Partial is the normal case and repeatable: a
   * supplier who sends half the order today and half next week is two deliveries
   * against one order, and the second is a separate command with its own key.
   */
  @Post(':purchaseOrderId/receipts')
  receive(
    @Merchant() access: MerchantAccess,
    @Body(new ZodValidationPipe(ReceivePurchaseOrderRequest)) dto: ReceivePurchaseOrderRequest,
  ) {
    return this.procurement.receivePurchaseOrder(access, dto);
  }

  @Post(':purchaseOrderId/cancel')
  cancel(
    @Merchant() access: MerchantAccess,
    @Body(new ZodValidationPipe(CancelPurchaseOrderRequest)) dto: CancelPurchaseOrderRequest,
  ) {
    return this.procurement.cancelPurchaseOrder(access, dto);
  }
}

/**
 * The console's supplier-invoice inbox (recipes module plan §6.2 and §10).
 *
 * ONE READ, AND THE ABSENCE OF WRITES IS THE DESIGN. Every invoice WRITE — upload,
 * match, commit — is an administrative command on the door this platform already has
 * (`merchants.administrativeCommands`), because each one must be versioned,
 * fingerprinted and idempotent (plan D15). A write route here would re-implement that
 * machinery.
 *
 * The read is gated by `merchant.manage`, exactly like the orders and the costing
 * reads beside it: an `inventory.*` key is carried only by POS sessions, and an owner
 * reviewing what the café was charged is a browser session, not a till.
 */
@RequireProduct('dashboard')
@RequirePermission('merchant.manage')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@Controller('api/merchants/:merchantId/supplier-invoices')
export class SupplierInvoiceController {
  constructor(private readonly procurement: ProcurementService) {}

  @Get()
  list(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(SupplierInvoiceQuery)) query: SupplierInvoiceQuery,
  ) {
    return this.procurement.listSupplierInvoices(access, query);
  }
}
