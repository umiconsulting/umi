import type { PaymentSummary } from '@umi/contract';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PosCheckoutRepository } from './pos-checkout.repository';

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;

describe('Gate 3B checkout persistence', () => {
  /**
   * The tender a capture already owns (workstream G). A draft that was captured through a
   * provider adapter arrives here with an attempt row keyed by the draft's own id, and the
   * guard has three branches. Two of them are proved below; the third — no captured attempt
   * at all — is the path every tender the till sends today takes, and it is covered by the
   * existing cases in this file.
   *
   * These are the money-path branches with no other coverage: nothing in `apps/umi-pos`
   * calls `pos.tenderCapture` yet, so no end-to-end run can produce this state. A branch
   * that only a future client can reach is exactly the branch that must not ship untested.
   */
  const capturedTenderSummary = (): PaymentSummary => ({
    checkoutId: id(7),
    state: 'collecting_payment',
    tenders: [
      {
        tenderId: id(8),
        type: 'manual_terminal',
        applied: { minorUnits: 5500, currency: 'MXN' },
        received: null,
        change: { minorUnits: 0, currency: 'MXN' },
        status: 'confirmed_success',
      },
    ],
    amountDue: { minorUnits: 5500, currency: 'MXN' },
    appliedAmount: { minorUnits: 5500, currency: 'MXN' },
    remainingBalance: { minorUnits: 0, currency: 'MXN' },
    change: { minorUnits: 0, currency: 'MXN' },
    partialPaymentState: 'fully_covered',
    tip: null,
    discounts: { total: { minorUnits: 0, currency: 'MXN' }, entries: [] },
  });

  const capturedCart = () => ({
    id: id(9),
    merchantId: id(10),
    locationId: id(11),
    operatorSessionId: id(12),
    version: 1,
    businessDate: '2026-07-29',
    merchantName: 'Umi',
    locationName: 'Local',
    operatorName: 'Cashier',
    customerId: null,
    originOrderId: null,
    originChannel: null,
    lines: [],
  });

  /** Answers by SQL content, so the case does not depend on the order of the statements. */
  const clientFor = (
    captured: { status: string; amountMinorUnits?: string; currency?: string } | null,
  ) => ({
    query: vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO merchant.pos_tender_fact')) {
        return { rowCount: 1, rows: [{ id: id(8) }] };
      }
      if (sql.includes('tender_draft_id')) {
        return {
          rowCount: captured ? 1 : 0,
          rows: captured
            ? [
                {
                  id: id(20),
                  status: captured.status,
                  provider: 'mercado_pago_point',
                  proofSource: 'provider',
                  amountMinorUnits: captured.amountMinorUnits ?? '5500',
                  currency: captured.currency ?? 'MXN',
                },
              ]
            : [],
        };
      }
      if (sql.includes('UPDATE merchant.pos_payment_attempt')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: id(20),
              method: 'external_terminal',
              amountMinorUnits: '5500',
              currency: 'MXN',
              status: 'succeeded',
              queryOnly: false,
              correlationId: 'corr',
              expiresAt: null,
              createdAt: '2026-07-29T10:00:00.000Z',
            },
          ],
        };
      }
      return { rowCount: 1, rows: [] };
    }),
  });

  it('refuses to commit a sale whose captured tender is still unresolved', async () => {
    const repository = new PosCheckoutRepository({} as never);
    await expect(
      repository.payments(
        clientFor({ status: 'unknown' }) as never,
        capturedCart() as never,
        id(7),
        capturedTenderSummary(),
        'corr',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'PAYMENT_UNKNOWN',
        details: { attemptId: id(20), attemptStatus: 'unknown' },
      },
    });
  });

  it('refuses a TIMEOUT too: neither unresolved state may become a paid sale', async () => {
    // `timeout` is the other unresolved state, and the two are distinguished on purpose:
    // one is "the provider answered in a way we cannot read", the other is "it never
    // answered". Both are query-only, and neither may become a paid sale.
    const repository = new PosCheckoutRepository({} as never);
    await expect(
      repository.payments(
        clientFor({ status: 'timeout' }) as never,
        capturedCart() as never,
        id(7),
        capturedTenderSummary(),
        'corr',
      ),
    ).rejects.toMatchObject({ response: { code: 'PAYMENT_UNKNOWN' } });
  });

  it('links the captured attempt instead of writing a second one for the same money', async () => {
    const repository = new PosCheckoutRepository({} as never);
    // Held as the mock it is, and cast only where the repository wants a real
    // `PoolClient`: the assertions below read `client.query`'s call log, which a
    // variable typed `never` cannot offer.
    const client = clientFor({ status: 'succeeded' });
    const outcomes = await repository.payments(
      client as never,
      capturedCart(),
      id(7),
      capturedTenderSummary(),
      'corr',
    );
    // The outcome IS the captured attempt — the row that holds the provider's payment id —
    // and no INSERT of a second attempt was issued.
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].attempt.id).toBe(id(20));
    expect(outcomes[0].attempt.method).toBe('external_terminal');
    const issued = (client.query as unknown as { mock: { calls: string[][] } }).mock.calls.map(
      (call) => call[0],
    );
    const attemptInserts = issued.filter((sql) =>
      sql.includes('INSERT INTO merchant.pos_payment_attempt'),
    );
    expect(attemptInserts).toHaveLength(0);
  });

  it('refuses when the captured amount disagrees with the tender', async () => {
    const repository = new PosCheckoutRepository({} as never);
    await expect(
      repository.payments(
        clientFor({ status: 'succeeded', amountMinorUnits: '9900' }) as never,
        capturedCart() as never,
        id(7),
        capturedTenderSummary(),
        'corr',
      ),
    ).rejects.toMatchObject({ response: { code: 'TENDER_OVERALLOCATION' } });
  });

  it('leaves the protected stock balance write lock to append_stock_ledger', async () => {
    const source = readFileSync(join(__dirname, 'pos-checkout.repository.ts'), 'utf8');
    expect(source).toContain('FROM merchant.stock_balance');
    expect(source).not.toContain('inventory_item_id=$2::uuid FOR UPDATE');
    expect(source).toContain('sum(quantity_numerator/quantity_denominator)::bigint::text');
  });

  it('freezes channel attribution on the committed sale and closes the linked order', async () => {
    const source = readFileSync(join(__dirname, 'pos-checkout.repository.ts'), 'utf8');
    // origin_* is stamped onto the frozen sale fact (ADR 2026-09-13-pos-channel-attribution).
    expect(source).toContain(
      'receipt_snapshot_id,totals_fingerprint,cash_shift_id,origin_order_id,origin_channel',
    );
    expect(source).toContain('c.origin_order_id::text AS "originOrderId"');
    // Link, don't merge: a settled upstream order is closed on the append-only spine, and only
    // from a non-terminal state so a POS sale never reopens a completed/canceled order.
    expect(source).toContain("SET status='completed'");
    expect(source).toContain("status IN ('placed','preparing','ready')");
    expect(source).toContain(
      "INSERT INTO merchant.order_event (order_id,status) VALUES ($1::uuid,'completed')",
    );
  });

  it('consumes one exact approval for each required permission', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          { id: id(1), permission: 'checkout.discount.approve' },
          { id: id(2), permission: 'checkout.terminal.approve' },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 2 });
    const repository = new PosCheckoutRepository({} as never);
    await expect(
      repository.consumeApprovals({ query } as never, [id(1), id(2)], {
        sessionId: id(3),
        merchantId: id(4),
        locationId: id(5),
        permissions: ['checkout.discount.approve', 'checkout.terminal.approve'],
        fingerprint: 'a'.repeat(64),
        commandId: id(6),
      }),
    ).resolves.toEqual({
      approved: true,
      missingPermission: null,
      approvalIdsByPermission: {
        'checkout.discount.approve': id(1),
        'checkout.terminal.approve': id(2),
      },
    });
    expect(query.mock.calls[0][0]).toContain('command_fingerprint=$6');
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(query.mock.calls[1][0]).toContain('consumed_at IS NULL');
  });

  it('returns the missing permission without consuming a partial approval set', async () => {
    const repository = new PosCheckoutRepository({} as never);
    const query = vi.fn();
    await expect(
      repository.consumeApprovals({ query } as never, [id(1)], {
        sessionId: id(3),
        merchantId: id(4),
        locationId: id(5),
        permissions: ['checkout.discount.approve', 'checkout.terminal.approve'],
        fingerprint: 'a'.repeat(64),
        commandId: id(6),
      }),
    ).resolves.toEqual({
      approved: false,
      missingPermission: 'checkout.terminal.approve',
      approvalIdsByPermission: {},
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects reuse of one tender identity across checkout scopes', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const repository = new PosCheckoutRepository({} as never);
    const summary: PaymentSummary = {
      checkoutId: id(7),
      state: 'collecting_payment',
      tenders: [
        {
          tenderId: id(8),
          type: 'cash',
          applied: { minorUnits: 1000, currency: 'MXN' },
          received: { minorUnits: 1000, currency: 'MXN' },
          change: { minorUnits: 0, currency: 'MXN' },
          status: 'draft',
        },
      ],
      amountDue: { minorUnits: 1000, currency: 'MXN' },
      appliedAmount: { minorUnits: 1000, currency: 'MXN' },
      remainingBalance: { minorUnits: 0, currency: 'MXN' },
      change: { minorUnits: 0, currency: 'MXN' },
      partialPaymentState: 'fully_covered',
      tip: null,
      discounts: {
        total: { minorUnits: 0, currency: 'MXN' },
        entries: [],
      },
    };
    await expect(
      repository.payments(
        { query } as never,
        {
          id: id(9),
          merchantId: id(10),
          locationId: id(11),
          operatorSessionId: id(12),
          version: 1,
          businessDate: '2026-07-29',
          merchantName: 'Umi',
          locationName: 'Local',
          operatorName: 'Cashier',
          customerId: null,
          originOrderId: null,
          originChannel: null,
          lines: [],
        },
        id(7),
        summary,
        'test-correlation',
      ),
    ).rejects.toThrow('Tender identity conflicts with another checkout.');
    expect(query).toHaveBeenCalledOnce();
  });

  it('uses the RLS request pool for scope proof and recovery data', async () => {
    const appQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ allowed: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            checkoutId: id(1),
            cartId: id(2),
            checkoutVersion: 1,
            state: 'collecting_payment',
            tenderDrafts: [],
            tipDraft: null,
            discountDrafts: [],
            receiptDelivery: {
              destination: 'display',
              channel: null,
              customerContactId: null,
            },
            paymentSummary: null,
            recoveryState: 'none',
            checkoutFingerprint: null,
            result: null,
            updatedAt: '2026-07-29T20:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const runWithMerchant = vi.fn(
      async (
        _merchantId: string,
        _userId: string,
        work: (client: { query: typeof appQuery }) => Promise<unknown>,
        _locationId: string,
      ) => work({ query: appQuery }),
    );
    const repository = new PosCheckoutRepository({ runWithMerchant } as never);
    await expect(
      repository.recovery(id(3), id(4), id(5), id(2), id(6), false),
    ).resolves.toMatchObject({ checkoutId: id(1), paymentOutcome: null });
    expect(runWithMerchant).toHaveBeenCalledWith(id(3), id(6), expect.any(Function), id(4));
    expect(appQuery.mock.calls[0][0]).toContain('runtime.operator_session');
    expect(appQuery.mock.calls[1][0]).not.toContain('runtime.operator_session');
  });
});
