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
    messages: vi.fn(),
    triage: vi.fn(),
  };
  const merchants = { loadProducts: vi.fn() };
  return { svc: new CustomersService(repo as never, merchants as never), repo, merchants };
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
      nextCursor: null,
    });

    const res = await h.svc.list('t1', PRODUCTS, { limit: '20' });
    const dto = res.customers[0];
    expect(dto.status).toBe('active');
    expect(dto.products.cash.active).toBe(true);
    expect(dto.products.whatsapp.active).toBe(true);
    expect(dto.value.walletBalance).toContain('123'); // 12345 centavos → $123
    expect(dto.memory.embeddingHealth).toBe('context_ready');
    expect(res.nextCursor).toBeNull();
  });

  it('flags needs_review when there are merge candidates', async () => {
    h.repo.listCustomers.mockResolvedValue({
      rows: [{ id: 'p2', display_name: 'B', merge_candidate_count: 1, identities: [] }],
      nextCursor: null,
    });
    const res = await h.svc.list('t1', PRODUCTS, {});
    expect(res.customers[0].status).toBe('needs_review');
    expect(res.customers[0].dataQuality.needsReview).toBe(true);
  });

  it('clamps limit to 100 and caps contactUuid for non-uuid contactId', async () => {
    h.repo.listCustomers.mockResolvedValue({ rows: [], nextCursor: null });
    await h.svc.list('t1', PRODUCTS, { limit: '500', contactId: 'not-a-uuid' });
    const q = h.repo.listCustomers.mock.calls[0][1];
    expect(q.limit).toBe(100);
    expect(q.contactUuid).toBe('t1'); // falls back to merchant id → matches nobody
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

describe('CustomersService.messages', () => {
  const CID = '00000000-0000-4000-8000-000000000001';
  const CONV = '00000000-0000-4000-8000-000000000002';

  const row = (id: string, iso: string, over: Record<string, unknown> = {}) => ({
    id,
    direction: 'inbound',
    sender: 'customer',
    body: id,
    delivery_status: null,
    occurred_at: new Date(iso),
    occurred_cursor: iso,
    created_at: new Date(iso),
    ...over,
  });

  it('returns empty for non-uuid ids without touching the repo', async () => {
    const h = make();
    const r = await h.svc.messages('t1', 'nope', 'nope', {});
    expect(r).toEqual({ messages: [], nextCursor: null });
    expect(h.repo.messages).not.toHaveBeenCalled();
  });

  it('asks the repo for limit + 1, reverses to oldest-first, and emits a nextCursor', async () => {
    const h = make();
    // repo yields newest-first; three rows for a page of two → a further page exists
    h.repo.messages.mockResolvedValue([
      row('m3', '2026-01-03T00:00:00.000Z', { sender: 'bot', direction: 'outbound' }),
      row('m2', '2026-01-02T00:00:00.000Z'),
      row('m1', '2026-01-01T00:00:00.000Z'),
    ]);
    const r = await h.svc.messages('t1', CID, CONV, { limit: '2' });
    expect(h.repo.messages).toHaveBeenCalledWith('t1', CID, CONV, null, 3);
    expect(r.messages.map((m) => m.id)).toEqual(['m2', 'm3']); // page [m3,m2] reversed
    expect(r.nextCursor).toBeTruthy();
    // the cursor encodes the OLDEST row of the page (m2), so the next page continues below it
    const decoded = JSON.parse(Buffer.from(r.nextCursor as string, 'base64url').toString('utf8'));
    expect(decoded.id).toBe('m2');
    expect(decoded.occurredAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('has no nextCursor when the thread fits in one page', async () => {
    const h = make();
    h.repo.messages.mockResolvedValue([row('m1', '2026-01-01T00:00:00.000Z')]);
    const r = await h.svc.messages('t1', CID, CONV, { limit: '2' });
    expect(r.nextCursor).toBeNull();
    expect(r.messages).toHaveLength(1);
  });

  it('round-trips a cursor back to the repo as {occurredAt,id}', async () => {
    const h = make();
    h.repo.messages.mockResolvedValue([]);
    const cursor = Buffer.from(
      JSON.stringify({ occurredAt: '2026-01-02T00:00:00.000Z', id: CID }),
      'utf8',
    ).toString('base64url');
    await h.svc.messages('t1', CID, CONV, { cursor });
    expect(h.repo.messages).toHaveBeenCalledWith('t1', CID, CONV, {
      occurredAt: '2026-01-02T00:00:00.000Z',
      id: CID,
    }, 31);
  });
});

describe('CustomersService.triage', () => {
  it('maps waiting conversations and clamps the limit', async () => {
    const h = make();
    h.repo.triage.mockResolvedValue([
      {
        id: 'cv1',
        customer_id: 'cust1',
        customer_name: 'Ana',
        customer_phone: '+5219999',
        status: 'open',
        summary: 'pedido',
        last_sender: 'customer',
        last_message: '¿ya está?',
        waiting_since: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    const r = await h.svc.triage('t1', { limit: '500' });
    expect(h.repo.triage).toHaveBeenCalledWith('t1', 100); // clamped to the cap
    expect(r.total).toBe(1);
    expect(r.conversations[0]).toMatchObject({
      id: 'cv1',
      customerId: 'cust1',
      customerName: 'Ana',
      lastSender: 'customer',
      lastMessage: '¿ya está?',
    });
    expect(r.conversations[0].waitingSince).toBeTruthy();
  });

  it('defaults to a limit of 50', async () => {
    const h = make();
    h.repo.triage.mockResolvedValue([]);
    await h.svc.triage('t1', {});
    expect(h.repo.triage).toHaveBeenCalledWith('t1', 50);
  });
});
