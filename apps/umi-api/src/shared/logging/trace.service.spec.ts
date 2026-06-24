import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PgService } from '../database/pg.service';
import { TraceService } from './trace.service';

function makeService(
  queryImpl?: (text: string, params: unknown[]) => Promise<unknown>,
) {
  const query = vi.fn(
    queryImpl ??
      (async (_text: string, _params: unknown[]) => ({ rows: [], rowCount: 1 })),
  );
  const pg = { query } as unknown as PgService;
  const config = {
    get: () => 'conversaflow',
  } as unknown as ConfigService<Record<string, unknown>, true>;
  return { service: new TraceService(pg, config), query };
}

describe('TraceService', () => {
  it('hashes phones to a stable 16-hex-char prefix', () => {
    const { service } = makeService();
    const h = service.hashPhone('+5215512345678');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(service.hashPhone('+5215512345678')).toBe(h); // deterministic
  });

  it('inserts an AI turn into the configured observability schema', async () => {
    const { service, query } = makeService();
    await service.logAiTurn({ model: 'claude-haiku-4-5-20251001', latency_ms: 42 });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('conversaflow.ai_turn_logs');
    expect(params).toContain('claude-haiku-4-5-20251001');
    expect(params).toContain(42);
  });

  it('serializes jsonb columns', async () => {
    const { service, query } = makeService();
    await service.logEdgeFunction({
      function_name: 'whatsapp-handler',
      status: 'success',
      metadata: { message_id: 'm1' },
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('conversaflow.edge_function_logs');
    expect(params).toContain(JSON.stringify({ message_id: 'm1' }));
  });

  it('truncates security input_text to 500 chars', async () => {
    const { service, query } = makeService();
    await service.logSecurityEvent({
      phone: '+1',
      eventType: 'rate_limit',
      inputText: 'x'.repeat(900),
    });
    const params = query.mock.calls[0][1];
    expect((params[2] as string).length).toBe(500);
  });

  it('is best-effort — a failed insert never throws', async () => {
    const { service } = makeService(async () => {
      throw new Error('db down');
    });
    await expect(
      service.logPipelineTrace({ trace_id: 't1', stage: 'inbound', event: 'received' }),
    ).resolves.toBeUndefined();
  });
});
