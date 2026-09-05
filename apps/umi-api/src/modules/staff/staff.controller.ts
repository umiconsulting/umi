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
 * Staff CRUD over `merchant.staff`. MerchantAccessGuard resolves the reference
 * and verifies membership.
 *
 * NOT gated on the POS product. The UmiPOS integration arrived with
 * `@RequireProduct('pos')` on this class, which would have hidden the dashboard's
 * staff screen (build-v3 #124) from every café that runs Cash without a POS —
 * and the operator PIN this screen now issues is the till's credential for those
 * cafés too (AB#118). Employment is a dashboard capability; the product gate
 * belongs on the POS routes, where it is.
 */
@UseGuards(AuthGuard, MerchantAccessGuard, RolesGuard)
@RequirePermission('merchant.manage')
@Controller('api/:merchantRef/admin/staff')
export class StaffController {
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
