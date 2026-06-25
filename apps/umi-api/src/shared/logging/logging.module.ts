import { Global, Module } from '@nestjs/common';
import { LoggingService } from './logging.service';
import { TraceService } from './trace.service';

@Global()
@Module({
  providers: [LoggingService, TraceService],
  exports: [LoggingService, TraceService],
})
export class LoggingModule {}
