import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrityController } from './integrity.controller';
import { IntegrityRepository } from './integrity.repository';
import { IntegrityService } from './integrity.service';

@Module({
  imports: [AuthModule],
  controllers: [IntegrityController],
  providers: [IntegrityRepository, IntegrityService],
  exports: [IntegrityService],
})
export class IntegrityModule {}
