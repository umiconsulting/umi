import { Injectable } from '@nestjs/common';
import { getRequestContext } from '../database/request-context';

type Meta = Record<string, unknown>;

/**
 * Structured (JSON-line) logger. One line to stdout for each event, with the
 * request id from the async context.
 *
 * This is the whole logging path. An earlier version of this comment promised
 * that the trace methods would also write `observability.*` rows for a service
 * named umi-logs to read. Both are DELETED: the four tables exist in no DDL, so
 * every such write failed and was swallowed, and no reader was ever built.
 * `trace.service.ts` is gone, and its 13 call sites now log here. See decision
 * L20 in `docs/migration/build-v3/BACKFILL_METHODOLOGY.md`.
 *
 * A log line goes to stdout, and the collector keeps it. Do not put a raw phone
 * number, a token, or a whole user message in `meta`. See `security-event.ts`.
 */
@Injectable()
export class LoggingService {
  log(message: string, meta: Meta = {}): void {
    this.write('info', message, meta);
  }
  warn(message: string, meta: Meta = {}): void {
    this.write('warn', message, meta);
  }
  error(message: string, meta: Meta = {}): void {
    this.write('error', message, meta);
  }

  private write(level: string, message: string, meta: Meta): void {
    const requestId = getRequestContext()?.requestId;
    const base = { ts: new Date().toISOString(), level, message };
    // requestId is spread LAST so caller-supplied meta can never override the
    // contextual request id. The whole thing is guarded so a circular/
    // unserializable meta can never crash the logger.
    let line: string;
    try {
      line = JSON.stringify({ ...base, ...meta, ...(requestId ? { requestId } : {}) });
    } catch (err) {
      line = JSON.stringify({
        ...base,
        ...(requestId ? { requestId } : {}),
        metaError: err instanceof Error ? err.message : 'unserializable meta',
      });
    }
    process.stdout.write(line + '\n');
  }
}
