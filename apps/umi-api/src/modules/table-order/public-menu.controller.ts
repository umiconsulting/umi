import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { PublicMenuQuery, type PublicMenuQuery as MenuQuery } from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { Public } from '../auth/public.decorator';
import { TableOrderRateLimitGuard } from './table-order-rate-limit.guard';
import { TableOrderService } from './table-order.service';

@Public()
@UseGuards(TableOrderRateLimitGuard)
@Controller('api/public/menu')
export class PublicMenuController {
  constructor(private readonly menus: TableOrderService) {}

  @Get(':handle')
  menu(
    @Param('handle') handle: string,
    @Query(new ZodValidationPipe(PublicMenuQuery)) query: MenuQuery,
  ) {
    return this.menus.publicMenu(handle, query.locationId);
  }
}
