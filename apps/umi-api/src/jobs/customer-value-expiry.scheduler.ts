import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../shared/config/config.schema';
import { EnqueueService } from './enqueue.service';
import { QUEUES } from './queues';

@Injectable()
export class CustomerValueExpiryScheduler implements OnModuleInit {
  private readonly logger = new Logger(CustomerValueExpiryScheduler.name);

  constructor(
    private readonly enqueue: EnqueueService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const queue = this.enqueue.getQueue(QUEUES.system);
    const id = 'customer-value:authorization-expiry';
    if (!this.config.get('CUSTOMER_VALUE_EXPIRY_ENABLED', { infer: true })) {
      await queue.removeJobScheduler(id).catch(() => undefined);
      this.logger.log('customer value expiry disabled');
      return;
    }
    await queue.upsertJobScheduler(
      id,
      { every: 60_000 },
      { name: 'customer_value_authorization_expiry', data: { batchSize: 100 } },
    );
    this.logger.log('customer value expiry scheduled');
  }
}
