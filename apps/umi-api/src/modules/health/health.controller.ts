import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { HealthService, type HealthResult } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness/readiness. 200 when DB + Redis are reachable, else 503. */
  @Get()
  async get(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<HealthResult> {
    const result = await this.health.check();
    if (result.status !== 'ok') {
      void reply.status(503);
    }
    return result;
  }
}
