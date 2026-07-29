import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PosCatalogController } from './pos-catalog.controller';
import { PosCatalogRepository } from './pos-catalog.repository';
import { PosCatalogService } from './pos-catalog.service';

@Module({
  imports: [AuthModule],
  controllers: [PosCatalogController],
  providers: [PosCatalogRepository, PosCatalogService],
})
export class PosCatalogModule {}
