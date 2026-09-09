import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DevicesModule } from '../devices/devices.module';
import { DashboardRealtimeGateway } from './dashboard-realtime.gateway';
import { MessageNotifyListener } from './message-notify.listener';
import { PairingRealtimeGateway } from './pairing-realtime.gateway';

/**
 * The socket surface. It belongs to the API process only: the worker root has no
 * HTTP listener, so it must never import this module.
 */
@Module({
  imports: [DevicesModule, AuthModule],
  providers: [PairingRealtimeGateway, DashboardRealtimeGateway, MessageNotifyListener],
})
export class RealtimeModule {}
