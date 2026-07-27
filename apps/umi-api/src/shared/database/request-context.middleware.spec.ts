import { describe, expect, it, vi } from 'vitest';
import { getRequestContext } from './request-context';
import { RequestContextMiddleware } from './request-context.middleware';

describe('RequestContextMiddleware', () => {
  it('propagates bounded request and correlation identifiers', () => {
    const header = vi.fn();
    new RequestContextMiddleware().use(
      {
        headers: {
          'x-request-id': 'request-1',
          'x-correlation-id': 'business-operation-1',
        },
      },
      { header },
      () => {
        expect(getRequestContext()).toMatchObject({
          requestId: 'request-1',
          correlationId: 'business-operation-1',
        });
      },
    );
    expect(header).toHaveBeenCalledWith('x-correlation-id', 'business-operation-1');
  });

  it('rejects unbounded identifiers and creates safe server identifiers', () => {
    new RequestContextMiddleware().use(
      { headers: { 'x-request-id': '../unsafe', 'x-correlation-id': 'x'.repeat(129) } },
      {},
      () => {
        const context = getRequestContext();
        expect(context?.requestId).toMatch(/^[0-9a-f-]{36}$/);
        expect(context?.correlationId).toBe(context?.requestId);
      },
    );
  });
});
