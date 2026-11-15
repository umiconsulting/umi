import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';

/** Verify the HTTP contracts the preserved Cash interfaces and frozen wallet URLs consume. */
describe('the register flip forwards only routes this app serves', () => {
  let app: NestFastifyApplication;
  const served = new Set<string>();

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    const fastify = app.getHttpAdapter().getInstance();
    fastify.addHook('onRoute', (r: { method: string | string[]; url: string }) => {
      const methods = Array.isArray(r.method) ? r.method : [r.method];
      for (const m of methods) served.add(`${m} ${r.url}`);
    });
    await app.init();
    await fastify.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('serves the Cash business, public, and wallet contracts', () => {
    const contracts = [
      'POST /api/:ref/auth/login',
      'POST /api/:ref/auth/refresh',
      'POST /api/:ref/auth/logout',
      'GET /api/:ref/config',
      'GET /api/:ref/admin/settings',
      'PATCH /api/:ref/admin/settings',
      'GET /api/:ref/admin/messages',
      'GET /api/:ref/admin/stats',
      'GET /api/:ref/admin/customers',
      'GET /api/:ref/admin/reward-config',
      'GET /api/:ref/admin/gift-cards',
      'POST /api/:ref/admin/gift-cards',
      'GET /api/:ref/gift/:code',
      'POST /api/:ref/gift/:code',
      'GET /api/:ref/passes/google',
      'GET /api/:ref/passes/apple',
      'GET /api/:ref/stamp-strip/:state',
      'POST /api/:ref/passes/apple/v1/devices/:deviceId/registrations/:passTypeId/:serial',
      'GET /api/:ref/passes/apple/v1/passes/:passTypeId/:serial',
      'POST /api/merchants',
      'GET /api/umi/tenants',
      'GET /api/umi/tenants/:id',
      'PATCH /api/umi/tenants/:id',
      'DELETE /api/umi/tenants/:id',
    ];
    const shape = (route: string) => route.replace(/:[A-Za-z]+/g, ':p');
    const shapes = new Set([...served].map(shape));
    expect(contracts.filter((route) => !shapes.has(shape(route)))).toEqual([]);
  });

  it('refuses anonymous access to the internal admin projection', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/umi/tenants' });
    expect(response.statusCode).toBe(401);
  });
});
