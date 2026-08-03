import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PublicMerchantGuard } from '../auth/public-merchant.guard';
import { PubMerchant } from '../auth/current-user.decorator';
import type { PublicMerchant } from '../auth/public-merchant.guard';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import { CashRegisterService } from './cash-register.service';
import { CashWriteService } from './cash-write.service';
import { CashWriteRepository } from './cash-write.repository';
import { GiftRedeemDto, RegisterDto } from './dto/register.dto';

const WINDOW = 15 * 60 * 1000; // 15 min, all gift limits

/**
 * PUBLIC customer self-service (no login): registration + gift-card lookup/redeem.
 * PublicMerchantGuard resolves `:slug` → merchant and seeds the RLS context so the
 * merchant-scoped repos work without an auth-set context. Abuse control is the
 * ported per-IP + per-code rate limiter (the only guard on these money-adjacent
 * routes). Merchant-not-found uses umi-cash's `Merchant no encontrado` body.
 */
@UseGuards(PublicMerchantGuard)
@Controller('api/:slug')
export class CashCustomerController {
  constructor(
    private readonly register: CashRegisterService,
    private readonly cash: CashWriteService,
    private readonly cashRepo: CashWriteRepository,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('customers')
  @HttpCode(201)
  registerCustomer(
    @PubMerchant() t: PublicMerchant,
    @Body() dto: RegisterDto,
    @Headers('user-agent') ua?: string,
  ) {
    return this.register.register(t.merchantId, t.name, dto, ua ?? null);
  }

  @Get('gift/:code')
  async giftInfo(
    @PubMerchant() t: PublicMerchant,
    @Param('code') code: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const ip = clientIp(req);
    this.guard(reply, `gift-lookup:${ip}`, 10);
    this.guard(reply, `gift-code:${code.toUpperCase()}`, 5);

    const info = await this.cashRepo.giftCardInfo(t.merchantId, code.toUpperCase());
    if (!info) throw new NotFoundException({ error: 'Código no válido' });
    return { ...info, merchantName: t.name };
  }

  @Post('gift/:code')
  async giftRedeem(
    @PubMerchant() t: PublicMerchant,
    @Param('code') code: string,
    @Body() dto: GiftRedeemDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const ip = clientIp(req);
    this.guard(reply, `gift-redeem:${ip}`, 5);
    this.guard(reply, `gift-redeem-code:${code.toUpperCase()}`, 3);

    if (!dto.phone && !dto.email) {
      throw new BadRequestException({ error: 'Se requiere teléfono o email para identificarte' });
    }
    return this.cash.redeemGiftCard(t.merchantId, code, {
      phone: dto.phone,
      email: dto.email,
    });
  }

  /** Apply one rate-limit bucket; on exhaustion set Retry-After and 429. */
  private guard(reply: FastifyReply, key: string, max: number): void {
    const r = this.rateLimit.hit(key, max, WINDOW);
    if (!r.allowed) {
      void reply.header('Retry-After', String(Math.ceil((r.resetAt - Date.now()) / 1000)));
      throw new HttpException({ error: 'Demasiados intentos. Intenta de nuevo más tarde.' }, 429);
    }
  }
}

function clientIp(req: FastifyRequest): string {
  // Fastify resolves req.ip from X-Forwarded-For using its configured trustProxy
  // hop count (set in main.ts). Trusting the raw leftmost XFF here instead would
  // let a caller spoof the header and rotate past the per-IP rate-limit buckets.
  return req.ip || 'unknown';
}
