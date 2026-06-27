import { Injectable, Logger } from '@nestjs/common';
import { EnqueueService } from '../../jobs/enqueue.service';
import { QUEUES } from '../../jobs/queues';

/**
 * Per-conversation single-flight for `turn.process` (preflight §5: Redis
 * `SET NX PX` mutex keyed on conversation_id + delayed re-enqueue). Prevents two
 * workers from running the LLM loop for the same conversation at once (wasted
 * work). Correctness is ALSO guaranteed by the conversation `state_version` CAS,
 * so this is best-effort: a Redis error fails OPEN (proceed) rather than stalling
 * turns.
 *
 * Reuses BullMQ's existing Redis connection (no separate client).
 */

interface RedisLike {
  set(key: string, value: string, px: 'PX', ms: number, nx: 'NX'): Promise<string | null>;
  del(key: string): Promise<number>;
}

@Injectable()
export class ConversationLockService {
  private readonly logger = new Logger(ConversationLockService.name);

  constructor(private readonly enqueue: EnqueueService) {}

  private async client(): Promise<RedisLike> {
    return (await this.enqueue.getQueue(QUEUES.turns).client) as unknown as RedisLike;
  }

  private key(conversationId: string): string {
    return `turn:lock:${conversationId}`;
  }

  /** Try to acquire the lock. Returns true if acquired (or on Redis error). */
  async acquire(conversationId: string, ttlMs: number): Promise<boolean> {
    try {
      const res = await (await this.client()).set(this.key(conversationId), '1', 'PX', ttlMs, 'NX');
      return res === 'OK';
    } catch (err) {
      this.logger.warn(
        `lock acquire failed (failing open) for ${conversationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return true;
    }
  }

  async release(conversationId: string): Promise<void> {
    try {
      await (await this.client()).del(this.key(conversationId));
    } catch (err) {
      this.logger.warn(
        `lock release failed for ${conversationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
