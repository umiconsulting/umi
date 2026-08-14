import { Injectable } from '@nestjs/common';
import { getRequestContext } from '../database/request-context';
import { redactTelemetry } from '../operations/redaction';
import { ReleaseIdentityService } from '../release/release-identity.service';

type Meta = Record<string, unknown>;

/**
 * Minimal structured (JSON-line) logger. In later phases the trace methods
 * here also write `observability.*` rows that umi-logs reads; for Phase 0 it
 * just emits structured stdout with the request id from the async context.
 */
@Injectable()
export class LoggingService {
  constructor(private readonly releaseIdentity: ReleaseIdentityService) {}
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
    const context = getRequestContext();
    const requestId = context?.requestId;
    const correlationId = context?.correlationId;
    const release = this.releaseIdentity.current();
    const base = {
      timestamp: new Date().toISOString(),
      service: release.application,
      environment: release.environment,
      release: release.version,
      severity: level,
      message,
    };
    // requestId is spread LAST so caller-supplied meta can never override the
    // contextual request id. The whole thing is guarded so a circular/
    // unserializable meta can never crash the logger.
    let line: string;
    try {
      line = JSON.stringify(
        redactTelemetry({
          ...base,
          ...meta,
          ...(requestId ? { requestId } : {}),
          ...(correlationId ? { correlationId } : {}),
        }),
      );
    } catch (err) {
      line = JSON.stringify({
        ...base,
        ...(requestId ? { requestId } : {}),
        ...(correlationId ? { correlationId } : {}),
        metaError: err instanceof Error ? err.message : 'unserializable meta',
      });
    }
    process.stdout.write(line + '\n');
  }
}
