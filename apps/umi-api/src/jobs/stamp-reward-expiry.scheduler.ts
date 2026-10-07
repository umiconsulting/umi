import { Injectable, type OnModuleInit } from '@nestjs/common';
import { EnqueueService } from './enqueue.service';
import { OutboxRouter } from './outbox-relay.service';
import { QUEUES } from './queues';
import { JobPriority } from './job-options';
import {
  STAMP_REWARD_EXPIRY_JOB,
  STAMP_REWARD_REMINDER_TOPIC,
} from './stamp-reward-expiry.processor';

@Injectable()
export class StampRewardExpiryScheduler implements OnModuleInit {
  constructor(
    private readonly enqueue: EnqueueService,
    private readonly router: OutboxRouter,
  ) {}
  async onModuleInit(): Promise<void> {
    this.router.register(STAMP_REWARD_REMINDER_TOPIC, {
      queue: QUEUES.outbound,
      jobName: STAMP_REWARD_REMINDER_TOPIC,
      priority: JobPriority.Background,
    });
    await this.enqueue
      .getQueue(QUEUES.system)
      .upsertJobScheduler(
        'stamp-reward-expiry',
        { every: 60_000 },
        { name: STAMP_REWARD_EXPIRY_JOB, data: { batchSize: 100 } },
      );
  }
}
