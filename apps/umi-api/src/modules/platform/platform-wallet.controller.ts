import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { ApplePushService } from '../wallet/apple-push.service';
import { WalletPassRepository } from '../wallet/wallet-pass.repository';
import { PushPassesDto } from './dto/push-passes.dto';

const DEFAULT_STALE_DAYS = 30;
const MAX_STALE_DAYS = 365;

/**
 * THE OPERATOR'S WALLET SURFACE: which passes are broken, and push them.
 *
 * Two halves of one problem, which is why they live together. Work item 31 is
 * open on DETECTION, not prevention: four failure paths log and nothing counts
 * them, and `passHealth` has existed with NO caller at all — a counter nobody
 * reads is a counter that is not measuring anything. `push` is the other half,
 * ported from umi-cash `POST /api/umi/push-passes`.
 *
 * ⚠️ NO SHARED SECRET. umi-cash authenticated this with a bearer `CRON_SECRET`.
 * It authenticates with the superadmin session everything else uses, following
 * the AB#112 ruling that retired `UMI_ADMIN_PASSWORD` and `UMI_ADMIN_JWT_SECRET`:
 * one credential, revocable, attributable to a person. A long-lived shared
 * secret in an environment variable is none of those.
 *
 * Silent on both sides is the failure mode this addresses. A pass that stops
 * updating keeps working — it opens, renders and scans — and only the UPDATE
 * stops. Nothing else in the system reports it.
 */
@UseGuards(AuthGuard, PlatformAdminGuard)
@Controller('api/platform/wallet')
export class PlatformWalletController {
  constructor(
    private readonly push: ApplePushService,
    private readonly repo: WalletPassRepository,
  ) {}

  /**
   * How many Apple passes exist, how many can never be reached, and how many
   * have not changed lately. Three numbers, never added together.
   */
  @Get('pass-health')
  async passHealth(@Query('staleDays') staleDays?: string) {
    const days = staleDays === undefined ? DEFAULT_STALE_DAYS : Number(staleDays);
    if (!Number.isInteger(days) || days < 0 || days > MAX_STALE_DAYS) {
      throw new BadRequestException({ error: 'invalid_stale_days', max: MAX_STALE_DAYS });
    }
    const health = await this.repo.passHealth(days);
    return {
      ...health,
      staleDays: days,
      // Stated rather than inferred: with no certificates the counts are real
      // but nothing could be pushed, and a zero `sent` would look like a defect.
      pushConfigured: this.push.isConfigured(),
    };
  }

  /**
   * Force an update onto named cards, whole cafés, or both.
   *
   * An empty body is refused rather than treated as "everything". Pushing every
   * pass Umi has ever issued is a thing an operator may want and must ASK for,
   * one café at a time.
   */
  @Post('push')
  async pushPasses(@Body() dto: PushPassesDto) {
    const cardIds = dto.cardIds ?? [];
    const merchantIds = dto.merchantIds ?? [];
    if (cardIds.length === 0 && merchantIds.length === 0) {
      throw new BadRequestException({ error: 'nothing_to_push' });
    }

    let cards = 0;
    let sent = 0;
    if (cardIds.length) {
      const r = await this.push.pushCards(cardIds);
      cards += r.cards;
      sent += r.sent;
    }
    // Per café, in series. `pushMerchant` already batches within a café, and
    // running cafés concurrently would multiply the connection count to Apple
    // by the number of cafés for no gain — the batch size is the limit that
    // matters, not the wall clock.
    for (const merchantId of merchantIds) {
      const r = await this.push.pushMerchant(merchantId);
      cards += r.cards;
      sent += r.sent;
    }
    return { cards, sent, pushConfigured: this.push.isConfigured() };
  }
}
