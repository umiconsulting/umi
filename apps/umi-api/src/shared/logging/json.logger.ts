import type { LoggerService } from '@nestjs/common';
import { redactLogString, redactTelemetry } from '../operations/redaction';

export interface LoggerIdentity {
  service: string;
  environment: string;
  release: string;
}

export class JsonLogger implements LoggerService {
  constructor(private readonly identity: LoggerIdentity) {}

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  error(message: unknown, _trace?: string, context?: string): void {
    this.write('error', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.write('fatal', message, context);
  }

  private write(severity: string, message: unknown, context?: string): void {
    const safeMessage =
      typeof message === 'string' ? redactLogString(message) : redactTelemetry(message);
    process.stdout.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        ...this.identity,
        severity,
        message: safeMessage,
        ...(context ? { category: context } : {}),
      })}\n`,
    );
  }
}
