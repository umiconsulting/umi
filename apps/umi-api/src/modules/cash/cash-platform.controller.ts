import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { getRequestContext } from '../../shared/database/request-context';
import { WalletPassAdapter } from '../../shared/adapters/wallet-pass.adapter';
import { AuthGuard } from '../auth/auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { CashRepository } from './cash.repository';
import { CashPlatformRepository } from './cash-platform.repository';
import { CashBroadcastDto, CashPlatformUpdateDto } from './dto/cash-platform-update.dto';
import { parseOpenHours, toGrid } from '../business-hours/open-hours';

@UseGuards(AuthGuard, PlatformAdminGuard)
@Controller('api/umi')
export class CashPlatformController {
  constructor(
    private readonly platform: CashPlatformRepository,
    private readonly cash: CashRepository,
    private readonly wallet: WalletPassAdapter,
  ) {}

  @Get('session')
  session() {
    return { ok: true };
  }

  @Post('broadcast')
  async broadcast(@Body() dto: CashBroadcastDto) {
    const target = await this.platform.announcement(
      dto.reference,
      dto.message,
      dto.dryRun ?? false,
    );
    if (dto.dryRun) return { total: target.total, dryRun: true };
    const [apple, google] = await Promise.all([
      this.wallet.refreshMerchantWithCounts(target.id),
      this.wallet.refreshMerchantGoogleObjects(target.id),
    ]);
    return { total: target.total, apple, google };
  }

  @Get('tenants')
  list() {
    return this.platform.list();
  }

  @Get('tenants/:id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const [merchant] = await this.platform.list(id);
    if (!merchant) throw new NotFoundException({ error: 'Cafetería no encontrada.' });
    this.scope(id);
    const [branding, locations, reward] = await Promise.all([
      this.cash.branding(id),
      this.cash.publicLocations(id),
      this.cash.rewardConfig(id),
    ]);
    return {
      ...branding,
      ...merchant,
      locations,
      businessHours: toGrid(parseOpenHours(branding?.businessHours)),
      rewardConfig: reward.active[0] ?? null,
    };
  }

  @Patch('tenants/:id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CashPlatformUpdateDto) {
    this.scope(id);
    await this.platform.update(id, dto, async (client) => {
      if (dto.rewardName === undefined || dto.visitsRequired === undefined) return;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`reward_config:${id}`]);
      const current = await this.cash.rewardConfig(id, client);
      const active = current.active[0];
      const upper = current.upgrade[0];
      if (upper && dto.visitsRequired >= Number(upper.visitsRequired)) {
        throw new BadRequestException({
          error:
            'El nivel base debe requerir menos visitas que el nivel superior. Edita la escalera desde Recompensas.',
        });
      }
      await this.cash.upsertRewardConfig(
        id,
        id,
        {
          visitsRequired: dto.visitsRequired,
          rewardName: dto.rewardName,
          rewardDescription: active?.rewardDescription ?? null,
          rewardCostCentavos: Number(active?.rewardCostCentavos ?? 0),
          upgrade: upper
            ? {
                visitsRequired: Number(upper.visitsRequired),
                rewardName: upper.rewardName,
                rewardDescription: upper.rewardDescription,
                rewardCostCentavos: Number(upper.rewardCostCentavos),
              }
            : null,
        },
        client,
      );
    });
    if (
      dto.primaryColor !== undefined ||
      dto.secondaryColor !== undefined ||
      dto.rewardName !== undefined
    ) {
      void this.wallet.refreshMerchant(id);
    }
    return { ok: true };
  }

  @Delete('tenants/:id')
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.platform.delete(id);
    return { ok: true };
  }

  private scope(id: string) {
    const context = getRequestContext();
    if (context) context.merchantId = id;
  }
}
