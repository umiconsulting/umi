import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { KdsController } from './kds.controller';
import {
  KdsAdminController,
  KdsDashboardController,
} from './kds-dashboard.controller';
import { KdsService } from './kds.service';
import { KdsRepository } from './kds.repository';

/**
 * KDS domain (spec §8.1, Phase 4). Two faces over the canonical `ops.*`/
 * `device.*`/`kitchen.*` model:
 *   - the FROZEN iPad contract (`KdsController`: pairing/board/command +
 *     `/functions/v1/*` aliases + heartbeat), and
 *   - the owner dashboard surface (`KdsDashboardController` +
 *     `KdsAdminController`: device management, board orders, transitions).
 *
 * Web-process only — transitions run on the request path and write
 * `runtime.outbox_events`, which the existing OutboxRelay/OutboundProcessor (worker)
 * already deliver as `twilio.status_notification` / `twilio.cancel_notification`.
 */
@Module({
  imports: [AuthModule, TenantsModule],
  controllers: [KdsController, KdsDashboardController, KdsAdminController],
  providers: [KdsService, KdsRepository],
})
export class KdsModule {}
