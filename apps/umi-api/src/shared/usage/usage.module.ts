import { Global, Module } from '@nestjs/common';
import { AiUsageRepository } from './ai-usage.repository';

/**
 * The LLM billing fact writer, global like the other shared infrastructure.
 * Three domains record usage — conversations, customers and dashboard
 * operations — so one module owns the repository instead of three copies.
 */
@Global()
@Module({
  providers: [AiUsageRepository],
  exports: [AiUsageRepository],
})
export class UsageModule {}
