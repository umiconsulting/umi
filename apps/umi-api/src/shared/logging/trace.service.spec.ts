import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { PgService } from '../database/pg.service';
import { TraceService } from './trace.service';

function makeService(queryImpl?: (text: string, params: unknown[]) => Promise<unknown>) {
  const query = vi.fn(
    queryImpl ?? (async (_text: string, _params: unknown[]) => ({ rows: [], rowCount: 1 })),
  );
  const pg = { query } as unknown as PgService;
  const config = { get: () => 'conversaflow' } as unknown as ConfigService<
    Record<string, unknown>,
    true
  >;
  return { service: new TraceService(pg, config), query };
}

describe('TraceService', () => {
  it('persists an AI turn and emits safe telemetry', async () => {
    const { service, query } = makeService();
    await service.logAiTurn({ model: 'test-model', latency_ms: 42 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('conversaflow.ai_turn_logs');
    expect(params).toContain('test-model');
    expect(params).toContain(42);
  });

  it('serializes safe metadata for the persistent sink', async () => {
    const { service, query } = makeService();
    await service.logEdgeFunction({
      function_name: 'handler',
      status: 'success',
      metadata: { command: 'c1' },
    });
    expect(query.mock.calls[0][0]).toContain('conversaflow.edge_function_logs');
    expect(query.mock.calls[0][1]).toContain(JSON.stringify({ command: 'c1' }));
  });

  it('hashes identity and redacts security content', async () => {
    const { service, query } = makeService();
    await service.logSecurityEvent({ phone: '+1', eventType: 'rate_limit', inputText: 'secret' });
    const params = query.mock.calls[0][1];
    expect(params[0]).toMatch(/^[0-9a-f]{16}$/);
    expect(params[2]).toBe('[REDACTED_INPUT]');
  });

  it('does not fail the caller when the persistent sink fails', async () => {
    const { service } = makeService(async () => {
      throw new Error('db down');
    });
    await expect(
      service.logPipelineTrace({ trace_id: 't1', stage: 'inbound', event: 'received' }),
    ).resolves.toBeUndefined();
  });
});
