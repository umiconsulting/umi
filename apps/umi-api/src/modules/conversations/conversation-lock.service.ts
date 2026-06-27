import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/** Atomic compare-and-delete: only release the lock if we still own the token. */
const RELEASE_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

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

  /**
   * Try to acquire the lock. Returns a per-acquire token on success (pass it to
   * `release`), or null if another worker holds it. On a Redis error we fail OPEN
   * by returning a token — `release` then no-ops since the key isn't ours.
   */
  async acquire(conversationId: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    try {
      const res = await (await this.client()).set(this.key(conversationId), token, 'PX', ttlMs, 'NX');
      return res === 'OK' ? token : null;
    } catch (err) {
      this.logger.warn(
        `lock acquire failed (failing open) for ${conversationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return token;
    }
  }

  /** Release the lock ONLY if we still own it (token match) — never another
   *  worker's lock that replaced ours after a TTL expiry. */
  async release(conversationId: string, token: string): Promise<void> {
    try {
      await (await this.client()).eval(RELEASE_LUA, 1, this.key(conversationId), token);
    } catch (err) {
      this.logger.warn(
        `lock release failed for ${conversationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
