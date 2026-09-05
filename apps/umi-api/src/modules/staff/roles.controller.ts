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
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RolesService, type RoleInput } from './roles.service';

@UseGuards(AuthGuard, MerchantAccessGuard, RolesGuard)
@RequirePermission('merchant.manage')
@Controller('api/merchants/:merchantId/roles')
export class MerchantRolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(@Merchant() merchant: MerchantAccess) {
    return this.roles.list(merchant.merchantId);
  }

  @Post()
  @HttpCode(201)
  async create(
    @Merchant() merchant: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Body() body: RoleInput,
  ) {
    return { role: await this.roles.create(merchant.merchantId, user.id, body, merchant) };
  }

  @Patch(':roleId')
  async update(
    @Merchant() merchant: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Param('roleId') roleId: string,
    @Body() body: RoleInput,
  ) {
    return {
      role: await this.roles.update(merchant.merchantId, roleId, user.id, body, merchant),
    };
  }

  @Delete(':roleId')
  async archive(
    @Merchant() merchant: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Param('roleId') roleId: string,
    @Query('expectedRevision') expectedRevision: string,
  ) {
    await this.roles.archive(
      merchant.merchantId,
      roleId,
      user.id,
      Number(expectedRevision),
      merchant,
    );
    return { ok: true };
  }
}
