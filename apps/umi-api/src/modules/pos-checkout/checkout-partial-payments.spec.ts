import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { CheckoutPartialPaymentRequest } from '@umi/contract';
import { PosCheckoutService } from './pos-checkout.service';
import type { PartialPaymentRow } from './pos-checkout.repository';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const money = (minorUnits: number) => ({ minorUnits, currency: 'MXN' });
const user = { id: id(1), sessionId: id(2), deviceId: id(3), email: 'cashier@test.local' };
const merchantId = id(4);
const locationId = id(5);
const cartId = id(6);
const operatorSessionId = id(7);
const cashShiftId = id(8);

const cart = {
  id: cartId,
  merchantId,
  locationId,
  operatorSessionId,
  originalOperatorUserId: id(80),
  version: 3,
  businessDate: '2026-10-14',
  merchantName: 'ONCA',
  merchantLogoUrl: null,
  locationName: 'Local',
  operatorName: 'Caja',
  customerId: null,
  originOrderId: null,
  originChannel: null,
  fulfillmentType: 'dine_in',
  lines: [
    {
      id: id(9),
      productId: id(10),
      variantId: null,
      quantity: 1,
      courseNumber: 1,
      note: null,
      modifiers: [],
    },
  ],
};

function harness(mixedTenderEnabled = true) {
  const rows: PartialPaymentRow[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO merchant.pos_partial_payment')) {
        rows.push({
          tenderId: params[3] as string,
          position: params[4] as number,
          cartVersion: params[5] as number,
          cartFingerprint: params[6] as string,
          baseDueMinorUnits: String(params[7]),
          currency: params[8] as string,
          tenderType: params[9] as PartialPaymentRow['tenderType'],
          amountMinorUnits: String(params[10]),
          tipMinorUnits: String(params[11]),
          receivedMinorUnits: params[12] == null ? null : String(params[12]),
          status: params[13] as PartialPaymentRow['status'],
          cashShiftId: params[14] as string | null,
          confirmationReference: params[15] as string | null,
          serviceOperatorUserId: params[17] as string,
          processedByUserId: params[18] as string,
          tipRecipientUserId: params[19] as string,
        });
      }
      if (sql.includes("SET status='operator_reported_failure'")) {
        const row = rows.find((item) => item.tenderId === params[3]);
        if (row) {
          row.status = 'operator_reported_failure';
          row.position = null;
        }
      }
      if (sql.includes("SET status='confirmed_success'")) {
        const row = rows.find((item) => item.tenderId === params[3]);
        if (row) row.status = 'confirmed_success';
      }
      return { rowCount: 1, rows: [] };
    }),
  };
  const repo = {
    authorize: vi.fn().mockResolvedValue({
      operatorId: user.id,
      operatorName: 'Caja',
      permissions: ['checkout.commit', 'checkout.terminal.confirm'],
    }),
    lockCart: vi.fn().mockResolvedValue(cart),
    partialRows: vi.fn(async () => [...rows]),
    partialRowsForPos: vi.fn(async () => [...rows]),
    policy: vi.fn().mockResolvedValue({
      version: '1',
      manualTerminalEnabled: true,
      bankTransferEnabled: true,
      bankTransferDetails: { holderName: 'ONCA', bankName: 'Banco', clabe: '012345678901234567' },
      mixedTenderEnabled,
      maximumTenderLines: 2,
      manualTerminalApprovalThreshold: money(50_000),
      manualTerminalApprovalPermission: 'checkout.terminal.approve',
      tip: {
        enabled: true,
        presetBasisPoints: [1000],
        customPercentageEnabled: true,
        customFixedEnabled: true,
        maximumTip: money(5_000),
        requiredPermission: null,
        attribution: 'account_owner',
        version: '1',
      },
      discount: {
        enabled: false,
        maximumBasisPoints: 0,
        maximumAmount: money(0),
        cashierThreshold: money(0),
        customRequiresApproval: false,
        requiredPermission: 'checkout.discount.apply',
        approvalPermission: 'checkout.discount.approve',
        version: '1',
      },
    }),
    saveDraft: vi.fn().mockResolvedValue({ id: id(11), version: 1 }),
    payments: vi.fn().mockResolvedValue([]),
    recordPartialCash: vi.fn().mockResolvedValue(id(12)),
  };
  const carts = {
    readAccount: vi.fn().mockResolvedValue({
      id: cartId,
      version: 3,
      totals: { grandTotal: money(10_000) },
    }),
    price: vi.fn().mockResolvedValue({
      productId: id(10),
      productName: 'Pizza',
      saleAction: 'merchandise',
      variantId: null,
      variantName: null,
      variantAttributes: {},
      basePrice: 10_000,
      variantDelta: 0,
      taxRateBasisPoints: 0,
      currency: 'MXN',
      modifiers: [],
    }),
  };
  const results = new Map<string, unknown>();
  const integrity = {
    execute: vi.fn(
      async (
        command: { idempotencyKey: string },
        operation: (ctx: unknown) => Promise<unknown>,
      ) => {
        if (results.has(command.idempotencyKey)) {
          return { status: 'succeeded', result: results.get(command.idempotencyKey) };
        }
        const outcome = (await operation({
          client,
          commandId: id(13),
          correlationId: 'test',
          appendAudit: vi.fn(),
          appendFinancial: vi.fn(),
        })) as { ok: boolean; value?: unknown; code?: string };
        if (!outcome.ok) return { status: 'failed', failureCode: outcome.code };
        results.set(command.idempotencyKey, outcome.value);
        return { status: 'succeeded', result: outcome.value };
      },
    ),
  };
  return {
    service: new PosCheckoutService(repo as never, carts as never, integrity as never),
    repo,
    rows,
    client,
  };
}

function request(
  n: number,
  type: 'cash' | 'bank_transfer' | 'manual_terminal',
  amount: number,
  tip = 0,
): CheckoutPartialPaymentRequest {
  return {
    locationId,
    operatorSessionId,
    expectedCartVersion: 3,
    cashShiftId: type === 'cash' ? cashShiftId : null,
    approvalIds: [],
    idempotencyKey: id(20 + n),
    tender: {
      id: id(30 + n),
      type,
      amount: money(amount),
      amountReceived: type === 'cash' ? money(amount) : null,
      tipAmount: money(tip),
      status: type === 'cash' ? 'draft' : 'confirmed_success',
      correlationId: null,
    },
    confirmationReference: type === 'cash' ? null : `comprobante-${n}`,
  };
}

describe('cobro parcial durable', () => {
  it('devuelve la versión vigente de la cuenta, no la del primer abono', async () => {
    const { service, repo, rows } = harness();
    rows.push({
      tenderId: id(30),
      position: 0,
      cartVersion: 2,
      cartFingerprint: 'a'.repeat(64),
      baseDueMinorUnits: '10000',
      currency: 'MXN',
      tenderType: 'bank_transfer',
      amountMinorUnits: '4000',
      tipMinorUnits: '0',
      receivedMinorUnits: null,
      status: 'confirmed_success',
      confirmationReference: 'transfer-1',
      cashShiftId: null,
      serviceOperatorUserId: null,
      processedByUserId: null,
      tipRecipientUserId: null,
    });
    repo.partialRowsForPos.mockResolvedValueOnce([...rows]);

    const result = await service.partialPayments(user, merchantId, cartId, {
      locationId,
      operatorSessionId,
    });

    expect(result.data).toMatchObject({
      cartVersion: 3,
      appliedAmount: money(4_000),
      remainingBalance: money(6_000),
    });
  });

  it('una cuenta sin abonos devuelve un saldo vacío, no un 404', async () => {
    const { service } = harness();
    const result = await service.partialPayments(user, merchantId, cartId, {
      locationId,
      operatorSessionId,
    });
    expect(result.data).toMatchObject({
      cartId,
      cartVersion: 3,
      amountDue: money(10_000),
      appliedAmount: money(0),
      remainingBalance: money(10_000),
      tipAmount: money(0),
      tenderDrafts: [],
      blockedByUnknown: false,
      canFinalize: false,
    });
  });

  it('registra un tramo por terminal sin aprobación de gerente aunque el umbral sea cero', async () => {
    const { service, repo } = harness();
    repo.policy.mockResolvedValue({
      ...(await repo.policy()),
      manualTerminalApprovalThreshold: money(0),
    });
    const result = await service.collectPartialPayment(
      user,
      merchantId,
      cartId,
      request(1, 'manual_terminal', 10_000),
    );
    expect(result.data.remainingBalance).toEqual(money(0));
    expect(result.data.canFinalize).toBe(true);
    expect(repo.payments).toHaveBeenCalledOnce();
  });

  it('acepta tres tramos y conserva saldo de consumo y propina por tramo', async () => {
    const { service, repo } = harness();
    const first = await service.collectPartialPayment(
      user,
      merchantId,
      cartId,
      request(1, 'cash', 3000),
    );
    expect(first.data.remainingBalance.minorUnits).toBe(7000);
    const second = await service.collectPartialPayment(
      user,
      merchantId,
      cartId,
      request(2, 'cash', 2500),
    );
    expect(second.data.remainingBalance.minorUnits).toBe(4500);
    const third = await service.collectPartialPayment(
      user,
      merchantId,
      cartId,
      request(3, 'bank_transfer', 5000, 500),
    );
    expect(third.data).toMatchObject({
      canFinalize: true,
      appliedAmount: money(10_000),
      remainingBalance: money(0),
      tipAmount: money(500),
    });
    expect(third.data.tenderDrafts).toHaveLength(3);
    expect(repo.recordPartialCash).toHaveBeenCalledTimes(2);
    expect(repo.payments).toHaveBeenCalledTimes(3);
    const recovered = await service.partialPayments(user, merchantId, cartId, {
      locationId,
      operatorSessionId,
    });
    expect(recovered.data.tenderDrafts).toEqual(third.data.tenderDrafts);
  });

  it('continúa el cobro cuando la cuenta avanzó pero el contenido no cambió', async () => {
    const { service } = harness();
    const currentVersion = cart.version;
    cart.version = 2;
    await service.collectPartialPayment(
      user,
      merchantId,
      cartId,
      request(1, 'bank_transfer', 4000),
    );
    // Suspending/resuming an account advances its version without changing the
    // frozen order. The first tender's historical version must not make the
    // remaining balance unpayable.
    cart.version = 3;
    const second = await service.collectPartialPayment(
      user,
      merchantId,
      cartId,
      request(2, 'cash', 6000),
    );
    cart.version = currentVersion;

    expect(second.data).toMatchObject({
      cartVersion: 3,
      appliedAmount: money(10_000),
      remainingBalance: money(0),
      canFinalize: true,
    });
  });

  it.each([
    ['account_owner', 'cash', id(80)],
    ['account_owner', 'manual_terminal', id(80)],
    ['account_owner', 'bank_transfer', id(80)],
    ['payment_processor', 'cash', user.id],
    ['payment_processor', 'manual_terminal', user.id],
    ['payment_processor', 'bank_transfer', user.id],
  ] as const)(
    'guarda los dos empleados y aplica la atribución %s con %s',
    async (attribution, tenderType, expectedRecipient) => {
      const { service, repo, rows } = harness();
      repo.policy.mockResolvedValue({
        ...(await repo.policy()),
        tip: {
          ...(await repo.policy()).tip,
          attribution,
        },
      });

      await service.collectPartialPayment(
        user,
        merchantId,
        cartId,
        request(1, tenderType, 1000, 100),
      );

      expect(rows[0]).toMatchObject({
        serviceOperatorUserId: id(80),
        processedByUserId: user.id,
        tipRecipientUserId: expectedRecipient,
      });
    },
  );

  it('rechaza propina negativa, propina igual al cobro y propina sobre el máximo', async () => {
    const { service } = harness();
    const invalidTips = [-1, 1000, 5001];
    for (const [index, tip] of invalidTips.entries()) {
      await expect(
        service.collectPartialPayment(
          user,
          merchantId,
          cartId,
          request(10 + index, 'bank_transfer', 1000, tip),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    }
  });

  it('no repite el cobro si reenvía la misma identidad y bloquea importe alterado', async () => {
    const { service, repo } = harness();
    const first = request(1, 'cash', 3000);
    await service.collectPartialPayment(user, merchantId, cartId, first);
    await service.collectPartialPayment(user, merchantId, cartId, first);
    expect(repo.payments).toHaveBeenCalledTimes(1);
    await expect(
      service.collectPartialPayment(user as never, merchantId, cartId, {
        ...first,
        idempotencyKey: id(99),
        tender: { ...first.tender, amount: money(3500) },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('retiene resultado incierto sin descontar saldo y exige resolverlo', async () => {
    const { service, repo } = harness();
    const unknown = request(1, 'manual_terminal', 3000);
    unknown.tender.status = 'outcome_unknown';
    unknown.confirmationReference = null;
    const pending = await service.collectPartialPayment(user, merchantId, cartId, unknown);
    expect(pending.data).toMatchObject({
      blockedByUnknown: true,
      remainingBalance: money(10_000),
      canFinalize: false,
    });
    expect(repo.payments).not.toHaveBeenCalled();
    await expect(
      service.collectPartialPayment(user as never, merchantId, cartId, request(2, 'cash', 1000)),
    ).rejects.toBeInstanceOf(ConflictException);
    const failed = await service.collectPartialPayment(user, merchantId, cartId, {
      ...unknown,
      idempotencyKey: id(98),
      confirmationReference: 'terminal_screen_shows_declined',
      tender: { ...unknown.tender, status: 'operator_reported_failure' },
    });
    expect(failed.data.blockedByUnknown).toBe(false);
    expect(failed.data.remainingBalance.minorUnits).toBe(10_000);
    const after = await service.collectPartialPayment(
      user,
      merchantId,
      cartId,
      request(3, 'cash', 1000),
    );
    expect(after.data.remainingBalance.minorUnits).toBe(9000);
  });

  it('respeta política de métodos mixtos entre tramos', async () => {
    const { service } = harness(false);
    await service.collectPartialPayment(user, merchantId, cartId, request(1, 'cash', 3000));
    await expect(
      service.collectPartialPayment(
        user as never,
        merchantId,
        cartId,
        request(2, 'bank_transfer', 7000),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const secondCash = await service.collectPartialPayment(
      user,
      merchantId,
      cartId,
      request(3, 'cash', 7000),
    );
    expect(secondCash.data.canFinalize).toBe(true);
  });
});
