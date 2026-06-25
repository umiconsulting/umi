import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomersService } from './customers.service';

function make() {
  const repo = {
    listCustomers: vi.fn(),
    timeline: vi.fn(),
    conversations: vi.fn(),
    orders: vi.fn(),
    cash: vi.fn(),
    identity: vi.fn(),
  };
  const tenants = { loadProducts: vi.fn() };
  return { svc: new CustomersService(repo as never, tenants as never), repo, tenants };
}

const PRODUCTS = {
  dashboard: { status: 'active' },
  cash: { status: 'active' },
  conversaflow: { status: 'active' },
};

describe('CustomersService.list → customerDto', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('derives status, product flags and formats money', async () => {
    h.repo.listCustomers.mockResolvedValue({
      rows: [
        {
          id: 'p1',
          display_name: 'Ana',
          phone: '+5219999',
          normalized_phone: '+5219999',
          email: 'ana@x.co',
          loyalty_count: 1,
          total_visits: 4,
          wallet_balance_cents: 12345,
          conversation_count: 2,
          active_conversations: 1,
          orders_count: 3,
          total_spend_cents: 50000,
          memory_count: 2,
          merge_candidate_count: 0,
          data_quality_count: 0,
          identities: [{ identity_type: 'whatsapp' }],
        },
      ],
      total: 1,
    });

    const res = await h.svc.list('t1', PRODUCTS, { page: '1', limit: '20' });
    const dto = res.customers[0];
    expect(dto.status).toBe('active');
    expect(dto.products.cash.active).toBe(true);
    expect(dto.products.whatsapp.active).toBe(true);
    expect(dto.value.walletBalance).toContain('123'); // 12345 centavos → $123
    expect(dto.memory.embeddingHealth).toBe('context_ready');
    expect(res.totalPages).toBe(1);
  });

  it('flags needs_review when there are merge candidates', async () => {
    h.repo.listCustomers.mockResolvedValue({
      rows: [{ id: 'p2', display_name: 'B', merge_candidate_count: 1, identities: [] }],
      total: 1,
    });
    const res = await h.svc.list('t1', PRODUCTS, {});
    expect(res.customers[0].status).toBe('needs_review');
    expect(res.customers[0].dataQuality.needsReview).toBe(true);
  });

  it('clamps limit to 100 and caps contactUuid for non-uuid contactId', async () => {
    h.repo.listCustomers.mockResolvedValue({ rows: [], total: 0 });
    await h.svc.list('t1', PRODUCTS, { limit: '500', contactId: 'not-a-uuid' });
    const q = h.repo.listCustomers.mock.calls[0][1];
    expect(q.limit).toBe(100);
    expect(q.contactUuid).toBe('t1'); // falls back to tenant id → matches nobody
  });
});

describe('CustomersService.detail', () => {
  it('returns null for a non-uuid contactId without touching the repo', async () => {
    const h = make();
    const r = await h.svc.detail('t1', PRODUCTS, 'nope');
    expect(r).toBeNull();
    expect(h.repo.listCustomers).not.toHaveBeenCalled();
  });
});

describe('CustomersService.cash', () => {
  it('returns availability + null account when no loyalty row', async () => {
    const h = make();
    h.repo.cash.mockResolvedValue(null);
    const r = await h.svc.cash('t1', PRODUCTS, '00000000-0000-4000-8000-000000000000');
    expect(r).toEqual({ available: true, source: 'cash', account: null });
  });
});
