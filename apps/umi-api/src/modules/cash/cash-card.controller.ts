import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { PublicMerchantGuard } from '../auth/public-merchant.guard';
import { CustomerAuthGuard } from '../auth/customer-auth.guard';
import { Customer, PubMerchant } from '../auth/current-user.decorator';
import type { PublicMerchant } from '../auth/public-merchant.guard';
import type { CustomerAuth } from '../auth/customer-auth.guard';
import { CashCardService } from './cash-card.service';

/**
 * The logged-in CUSTOMER's own card: the page, and the QR she shows the barista.
 *
 * Guard order matters. `PublicMerchantGuard` resolves `:merchantRef` and seeds
 * the RLS scope; `CustomerAuthGuard` then verifies her token AND refuses it if it
 * was minted for a different café. Neither guard alone is sufficient.
 */
@UseGuards(PublicMerchantGuard, CustomerAuthGuard)
@Controller('api/:merchantRef/card')
export class CashCardController {
  constructor(private readonly cards: CashCardService) {}

  @Get()
  card(@PubMerchant() m: PublicMerchant, @Customer() c: CustomerAuth) {
    return this.cards.card(c.merchantId, c.customerId, m.name);
  }

  /**
   * `no-store`, carried over deliberately: the payload is a five-minute
   * single-use credential, and a cached copy is a code the register will refuse.
   */
  @Get('qr')
  @Header('Cache-Control', 'no-store')
  qr(@Customer() c: CustomerAuth) {
    return this.cards.qr(c.merchantId, c.customerId);
  }
}
