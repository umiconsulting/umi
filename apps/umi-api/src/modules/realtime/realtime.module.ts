import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DevicesModule } from '../devices/devices.module';
import { DashboardRealtimeGateway } from './dashboard-realtime.gateway';
import { KitchenBoardListener } from './kitchen-board.listener';
import { MessageNotifyListener } from './message-notify.listener';
import { PairingRealtimeGateway } from './pairing-realtime.gateway';
import { TenderAttemptListener } from './tender-attempt.listener';

/**
 * The socket surface. It belongs to the API process only: the worker root has no
 * HTTP listener, so it must never import this module.
 */
@Module({
  imports: [DevicesModule, AuthModule],
  providers: [
    PairingRealtimeGateway,
    DashboardRealtimeGateway,
    MessageNotifyListener,
    TenderAttemptListener,
    KitchenBoardListener,
  ],
})
export class RealtimeModule {}
