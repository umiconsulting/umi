import type { PaymentSummary } from '@umi/contract';
import { describe, expect, it, vi } from 'vitest';
import { PosCheckoutRepository } from './pos-checkout.repository';

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;

describe('Gate 3B checkout persistence', () => {
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
        tenantId: id(4),
        branchId: id(5),
        permissions: ['checkout.discount.approve', 'checkout.terminal.approve'],
        fingerprint: 'a'.repeat(64),
        commandId: id(6),
      }),
    ).resolves.toEqual({ approved: true, missingPermission: null });
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
        tenantId: id(4),
        branchId: id(5),
        permissions: ['checkout.discount.approve', 'checkout.terminal.approve'],
        fingerprint: 'a'.repeat(64),
        commandId: id(6),
      }),
    ).resolves.toEqual({
      approved: false,
      missingPermission: 'checkout.terminal.approve',
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
          tenantId: id(10),
          branchId: id(11),
          operatorSessionId: id(12),
          version: 1,
          businessDate: '2026-07-29',
          tenantName: 'Umi',
          branchName: 'Local',
          operatorName: 'Cashier',
          customerId: null,
          lines: [],
        },
        id(7),
        summary,
        'test-correlation',
      ),
    ).rejects.toThrow('Tender identity conflicts with another checkout.');
    expect(query).toHaveBeenCalledOnce();
  });

  it('uses the worker only for scope proof and applies branch RLS to recovery data', async () => {
    const worker = { query: vi.fn().mockResolvedValue({ rows: [{ allowed: 1 }] }) };
    const appQuery = vi
      .fn()
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
    const runWithTenant = vi.fn(
      async (
        _tenantId: string,
        _userId: string,
        work: (client: { query: typeof appQuery }) => Promise<unknown>,
        _branchId: string,
      ) => work({ query: appQuery }),
    );
    const repository = new PosCheckoutRepository({ worker, runWithTenant } as never);
    await expect(
      repository.recovery(id(3), id(4), id(5), id(2), id(6), false),
    ).resolves.toMatchObject({ checkoutId: id(1), paymentOutcome: null });
    expect(runWithTenant).toHaveBeenCalledWith(
      id(3),
      id(6),
      expect.any(Function),
      id(4),
    );
    expect(appQuery.mock.calls[0][0]).not.toContain('runtime.operator_session');
  });
});
