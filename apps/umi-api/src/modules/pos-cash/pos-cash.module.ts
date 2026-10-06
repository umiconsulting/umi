import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrityModule } from '../integrity/integrity.module';
import { PosCashController } from './pos-cash.controller';
import { PosCashRepository } from './pos-cash.repository';
import { PosCashService } from './pos-cash.service';

@Module({
  imports: [AuthModule, IntegrityModule],
  controllers: [PosCashController],
  providers: [PosCashRepository, PosCashService],
  exports: [PosCashRepository],
})
export class PosCashModule {}
