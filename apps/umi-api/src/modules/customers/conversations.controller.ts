import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { CustomersService } from './customers.service';

/**
 * Merchant-wide conversation list (admin view). Slug-routed + membership-checked;
 * no product gate, matching server.js. Reads `merchant.conversation` + `merchant.customer`.
 */
@UseGuards(AuthGuard, MerchantAccessGuard)
@Controller('api/:merchantRef/admin/conversations')
export class ConversationsController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Merchant() merchant: MerchantAccess, @Query() query: Record<string, string>) {
    return this.customers.conversationsList(merchant.merchantId, query);
  }
}
