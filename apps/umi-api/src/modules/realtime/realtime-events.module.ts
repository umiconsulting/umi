import { Global, Module } from '@nestjs/common';
import { DashboardRealtimeEvents } from './dashboard-realtime.events';
import { DevicePairingEvents } from './device-pairing.events';

/**
 * The event bus alone, with no dependency on the devices domain or on the
 * gateway. Keeping it separate is what lets `DevicesModule` and `KdsModule`
 * publish events and `RealtimeModule` consume them without a circular module
 * import.
 */
@Global()
@Module({
  providers: [DevicePairingEvents, DashboardRealtimeEvents],
  exports: [DevicePairingEvents, DashboardRealtimeEvents],
})
export class RealtimeEventsModule {}
