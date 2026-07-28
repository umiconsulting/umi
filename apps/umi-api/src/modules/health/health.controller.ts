import { Controller, ForbiddenException, Get, Headers, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { HealthService, type HealthResult } from './health.service';
import type { AppConfig } from '../../shared/config/config.schema';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Get('live')
  live() {
    return this.health.live();
  }

  /** Compatibility alias for readiness. */
  @Get()
  async get(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthResult> {
    return this.ready(reply);
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthResult> {
    const result = await this.health.check();
    if (result.status !== 'ok') {
      void reply.status(503);
    }
    return result;
  }

  @Get('diagnostics')
  diagnostics(@Headers('x-umi-operations-token') supplied?: string): object {
    const expected = this.config.get('OPERATIONS_TOKEN', { infer: true });
    if (!expected || !supplied || !sameSecret(expected, supplied)) {
      throw new ForbiddenException('operations_access_denied');
    }
    return this.health.diagnostics();
  }
}

function sameSecret(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}
