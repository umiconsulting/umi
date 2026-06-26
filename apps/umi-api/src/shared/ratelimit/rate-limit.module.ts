import { Global, Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';

/** Global in-memory rate limiter (public cash routes). */
@Global()
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
