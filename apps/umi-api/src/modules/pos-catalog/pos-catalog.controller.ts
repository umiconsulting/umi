import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { PosCatalogService } from './pos-catalog.service';

@UseGuards(AuthGuard)
@Controller('api/pos/tenants/:tenantId/catalog')
export class PosCatalogController {
  constructor(private readonly catalog: PosCatalogService) {}

  @Get('categories')
  @Header('Cache-Control', 'private, max-age=30, stale-while-revalidate=60')
  categories(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Query() raw: Record<string, string | undefined>,
  ) {
    return this.catalog.categories(user, tenantId, this.catalog.parseQuery(raw));
  }

  @Get('products')
  @Header('Cache-Control', 'private, max-age=30, stale-while-revalidate=60')
  products(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Query() raw: Record<string, string | undefined>,
  ) {
    return this.catalog.products(user, tenantId, this.catalog.parseQuery(raw));
  }

  @Get('products/:productId')
  @Header('Cache-Control', 'private, max-age=30, stale-while-revalidate=60')
  detail(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('productId') productId: string,
    @Query() raw: Record<string, string | undefined>,
  ) {
    return this.catalog.detail(user, tenantId, productId, this.catalog.parseQuery(raw));
  }
}
