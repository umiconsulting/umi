import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { DashboardCatalogService } from './dashboard-catalog.service';

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
// A new category starts on a palette colour the server assigns (see the repository),
// so the create body carries no colour — the owner recolours it afterwards.
const CreateCategoryBody = z.object({ name: z.string().trim().min(1).max(160) }).strict();
const UpdateCategoryBody = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    color: HexColor.optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.color !== undefined, {
    message: 'at_least_one_field',
  });

@UseGuards(AuthGuard, MerchantAccessGuard)
@Controller('api/merchants/:merchantId/catalog/categories')
export class DashboardCatalogController {
  constructor(private readonly catalog: DashboardCatalogService) {}

  @Get()
  list(@Merchant() merchant: MerchantAccess, @Param('merchantId') _merchantId: string) {
    return this.catalog.listCategories(merchant);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Merchant() merchant: MerchantAccess,
    @Param('merchantId') _merchantId: string,
    @Body(new ZodValidationPipe(CreateCategoryBody)) body: z.infer<typeof CreateCategoryBody>,
  ) {
    return this.catalog.createCategory(user, merchant, { name: body.name });
  }

  @Patch(':categoryId')
  update(
    @CurrentUser() user: AuthUser,
    @Merchant() merchant: MerchantAccess,
    @Param('merchantId') _merchantId: string,
    @Param('categoryId') categoryId: string,
    @Body(new ZodValidationPipe(UpdateCategoryBody)) body: z.infer<typeof UpdateCategoryBody>,
  ) {
    return this.catalog.updateCategory(user, merchant, categoryId, body);
  }
}
