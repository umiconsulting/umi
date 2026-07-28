import { Module } from '@nestjs/common';
import { PosCatalogController } from './pos-catalog.controller';
import { PosCatalogRepository } from './pos-catalog.repository';
import { PosCatalogService } from './pos-catalog.service';

@Module({
  controllers: [PosCatalogController],
  providers: [PosCatalogRepository, PosCatalogService],
})
export class PosCatalogModule {}
