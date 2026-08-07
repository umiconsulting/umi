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
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { StaffService } from './staff.service';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';

/**
 * Staff CRUD over `merchant.staff`. Slug-routed; MerchantAccessGuard resolves
 * the reference → merchant and verifies membership (no membership check existed in
 * server.js — hardened here). No product entitlement gate, matching server.js.
 */
@UseGuards(AuthGuard, MerchantAccessGuard)
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
      staff: await this.staff.create(merchant.merchantId, locationId ?? null, dto),
    };
  }

  @Patch(':staffId')
  async update(
    @Merchant() merchant: MerchantAccess,
    @Param('staffId') staffId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return { staff: await this.staff.update(merchant.merchantId, staffId, dto) };
  }

  @Delete(':staffId')
  async remove(@Merchant() merchant: MerchantAccess, @Param('staffId') staffId: string) {
    await this.staff.remove(merchant.merchantId, staffId);
    return { ok: true };
  }
}
