import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { DashboardOperationsQuery, ReportsSalesQuery } from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { DashboardOperationsService } from './dashboard-operations.service';

/** The switch writes one rule, and it names the location it writes it for. */
const CashPolicyUpdate = z
  .object({
    locationId: z.string().min(1).max(80),
    blindCountRequired: z.boolean(),
  })
  .strict();
const CheckoutPolicyUpdate = z
  .object({
    locationId: z.string().uuid(),
    manualTerminalEnabled: z.boolean(),
    bankTransferEnabled: z.boolean(),
    bankTransferDetails: z
      .object({
        holderName: z.string().trim().min(1).max(120),
        bankName: z.string().trim().min(1).max(120),
        clabe: z
          .string()
          .regex(/^\d{18}$/)
          .nullable()
          .optional(),
        accountNumber: z
          .string()
          .regex(/^\d{1,24}$/)
          .nullable()
          .optional(),
      })
      .strict()
      .nullable(),
    mixedTenderEnabled: z.boolean(),
    allowDineInWithoutTable: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.bankTransferEnabled &&
      (!value.bankTransferDetails ||
        (!value.bankTransferDetails.clabe && !value.bankTransferDetails.accountNumber))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bankTransferDetails'],
        message: 'La transferencia requiere CLABE o número de cuenta.',
      });
    }
  });

@UseGuards(AuthGuard, MerchantAccessGuard)
@Controller('api/merchants/:merchantId/operations')
export class DashboardOperationsController {
  constructor(private readonly operations: DashboardOperationsService) {}

  @Get()
  snapshot(
    @CurrentUser() user: AuthUser,
    @Merchant() merchant: MerchantAccess,
    @Param('merchantId') _merchantId: string,
    @Query(new ZodValidationPipe(DashboardOperationsQuery)) query: DashboardOperationsQuery,
  ) {
    return this.operations.snapshot(user, merchant, query);
  }

  // The drawer count rule of one location, read by the switch on Caja y turnos
  // and written by the same screen. It sits beside the operations feed because
  // the switch is read next to the shifts, not in the café's profile.
  @Get('cash-policy')
  cashPolicy(
    @CurrentUser() user: AuthUser,
    @Merchant() merchant: MerchantAccess,
    @Query('locationId') locationId?: string,
  ) {
    return this.operations.cashPolicy(user, merchant, locationId ?? null);
  }

  @Patch('cash-policy')
  setCashPolicy(
    @CurrentUser() user: AuthUser,
    @Merchant() merchant: MerchantAccess,
    @Body(new ZodValidationPipe(CashPolicyUpdate))
    body: { locationId: string; blindCountRequired: boolean },
  ) {
    return this.operations.setCashPolicy(user, merchant, body.locationId, body.blindCountRequired);
  }

  // La configuración usa la misma política que lee el POS.
  @Get('checkout-policy')
  checkoutPolicy(
    @CurrentUser() user: AuthUser,
    @Merchant() merchant: MerchantAccess,
    @Query('locationId') locationId?: string,
  ) {
    return this.operations.checkoutPolicy(user, merchant, locationId ?? null);
  }

  @Patch('checkout-policy')
  setCheckoutPolicy(
    @CurrentUser() user: AuthUser,
    @Merchant() merchant: MerchantAccess,
    @Body(new ZodValidationPipe(CheckoutPolicyUpdate)) body: z.infer<typeof CheckoutPolicyUpdate>,
  ) {
    return this.operations.setCheckoutPolicy(user, merchant, body.locationId, body);
  }

  @Get('sales/:saleId/receipt')
  saleReceipt(
    @CurrentUser() user: AuthUser,
    @Merchant() merchant: MerchantAccess,
    @Param('merchantId') _merchantId: string,
    @Param('saleId') saleId: string,
  ) {
    return this.operations.saleReceipt(user, merchant, saleId);
  }

  @Get('reports/sales')
  salesSummary(
    @CurrentUser() user: AuthUser,
    @Merchant() merchant: MerchantAccess,
    @Param('merchantId') _merchantId: string,
    @Query(new ZodValidationPipe(ReportsSalesQuery)) query: ReportsSalesQuery,
  ) {
    return this.operations.salesSummary(user, merchant, query);
  }

  @Get('reports/sales/insight')
  salesInsight(
    @CurrentUser() user: AuthUser,
    @Merchant() merchant: MerchantAccess,
    @Param('merchantId') _merchantId: string,
    @Query(new ZodValidationPipe(ReportsSalesQuery)) query: ReportsSalesQuery,
  ) {
    return this.operations.salesInsight(user, merchant, query);
  }

  @Get('cash-shifts/:shiftId')
  cashShiftDetail(
    @CurrentUser() user: AuthUser,
    @Merchant() merchant: MerchantAccess,
    @Param('merchantId') _merchantId: string,
    @Param('shiftId') shiftId: string,
  ) {
    return this.operations.cashShiftDetail(user, merchant, shiftId);
  }
}
