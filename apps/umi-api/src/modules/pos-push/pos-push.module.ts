import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PosPushController } from './pos-push.controller';
import { PosPushRepository } from './pos-push.repository';
import { PosPushService } from './pos-push.service';

@Module({
  imports: [AuthModule],
  controllers: [PosPushController],
  providers: [PosPushRepository, PosPushService],
  exports: [PosPushService],
})
export class PosPushModule {}
