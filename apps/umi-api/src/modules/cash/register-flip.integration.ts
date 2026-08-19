import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';

/**
 * THE FLIP CANNOT FORWARD A ROUTE THIS APP DOES NOT SERVE.
 *
 * `apps/umi-cash/next.config.mjs` lists the register routes it hands to umi-api
 * when `CASH_API_ORIGIN` is set. A Next rewrite is a proxy: it does not check
 * that the destination exists. An entry umi-api does not serve becomes a 404
 * from an origin the café operator is not looking at, on a till that worked
 * yesterday — and the two files live in different apps, so nothing but this
 * connects them.
 *
 * SCHEMA FAMILY, deliberately. It needs the app to BOOT and nothing more: no
 * customers, no cards, no backfill. That is what lets it run on the pristine
 * build in CI, on every pull request, which is the only place a list edited by
 * hand gets caught in time.
 */
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

  it('lists every forwarded route among this app’s own routes', () => {
    const config = readFileSync(resolve(__dirname, '../../../../umi-cash/next.config.mjs'), 'utf8');
    const block = config.match(/const REGISTER_ROUTES = \[([\s\S]*?)\];/);
    expect(block, 'REGISTER_ROUTES not found in umi-cash/next.config.mjs').toBeTruthy();

    // Strip the comments first. They carry apostrophes ("the customer's own
    // side"), and a naive quote match reads those as route literals.
    const literals = block![1].replace(/\/\/[^\n]*/g, '');
    const forwarded = [...literals.matchAll(/'(\/[^']+)'/g)].map((m) => m[1]);
    expect(forwarded.length).toBeGreaterThan(10);

    // The two apps name their path parameters differently — umi-cash says
    // `:handle`, umi-api says `:merchantRef`. What a proxy forwards on is the
    // SHAPE of the path, so that is what is compared.
    const shape = (url: string) => url.replace(/:[A-Za-z]+/g, ':p');
    const shapesServed = new Set([...served].map((r) => shape(r.split(' ')[1])));
    const missing = forwarded.filter((f) => !shapesServed.has(shape(f)));
    expect(missing).toEqual([]);
  });

  it('does NOT forward the gift-card routes, which answer 500 (AB#13)', () => {
    // Named rather than merely absent. `merchant.loyalty_gift_card` has six
    // columns and the Cash repositories read ten; forwarding these would trade a
    // working screen for a broken one. When PR #94 lands and they answer, this
    // test is the reminder to add them — delete it then.
    const config = readFileSync(resolve(__dirname, '../../../../umi-cash/next.config.mjs'), 'utf8');
    const block = config.match(/const REGISTER_ROUTES = \[([\s\S]*?)\];/)![1];
    expect(block).not.toContain('gift-cards');
    expect(block).not.toContain('/gift/');
  });
});
