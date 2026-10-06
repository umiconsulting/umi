import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequirePermission } from '../auth/roles.decorator';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { resolveLocationAuthority } from '../auth/location-authority';
import { StaffService } from './staff.service';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';

/**
 * Merchant-routed staff façade the dashboard SPA calls
 * (`/api/merchants/:merchantId/staff`). Dispatches to the same StaffService as the
 * reference-addressed register route, mirroring BusinessHoursMerchantController.
 *
 * Without it the SPA's four staff calls 404'd: the screen reported every café as
 * having no staff at all, and an invite failed silently. The paths are declared in
 * `@umi/contract`'s route table, so the drift test now proves this controller
 * answers them.
 */
@UseGuards(AuthGuard, MerchantAccessGuard, RolesGuard)
@RequirePermission('merchant.manage')
@Controller('api/merchants/:merchantId/staff')
export class StaffMerchantController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  async list(@Merchant() merchant: MerchantAccess) {
    return { staff: await this.staff.list(merchant.merchantId) };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Merchant() merchant: MerchantAccess,
    @Body() dto: CreateStaffDto,
    @Query('locationId') locationId?: string,
  ) {
    return {
      staff: await this.staff.create(
        merchant.merchantId,
        resolveLocationAuthority(merchant, locationId),
        dto,
        merchant,
      ),
    };
  }

  @Patch(':staffId')
  async update(
    @Merchant() merchant: MerchantAccess,
    @Param('staffId') staffId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return { staff: await this.staff.update(merchant.merchantId, staffId, dto, merchant) };
  }

  @Delete(':staffId')
  async remove(@Merchant() merchant: MerchantAccess, @Param('staffId') staffId: string) {
    await this.staff.remove(merchant.merchantId, staffId);
    return { ok: true };
  }
}
