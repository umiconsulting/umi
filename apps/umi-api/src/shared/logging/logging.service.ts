import { Injectable } from '@nestjs/common';
import { getRequestContext } from '../database/request-context';

type Meta = Record<string, unknown>;

/**
 * Minimal structured (JSON-line) logger. In later phases the trace methods
 * here also write `observability.*` rows that umi-logs reads; for Phase 0 it
 * just emits structured stdout with the request id from the async context.
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
