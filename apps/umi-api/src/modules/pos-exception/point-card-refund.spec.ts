import { describe, expect, it, vi } from 'vitest';
import { derivedUuid, PosExceptionService } from './pos-exception.service';

/**
 * THE CALLER OF THE REFUND COMMAND — plan §4 Phase 4, and the half that makes the acceptance
 * sentence true of the SYSTEM rather than of one route: "a partial refund moves money and the
 * sale records the refunded amount".
 *
 * The command itself is proved against the real schema in
 * `src/modules/tender/point-refund.integration.ts`. What is asserted here is the ORDER and the
 * refusal rules of the exception flow that calls it:
 *
 *   · the terminal is asked BEFORE the sale records anything, and with an identity derived
 *     from the preview and the tender, so a retried exception asks for the same refund;
 *   · a refund the vendor declined, or did not answer, REFUSES the whole command — the sale
 *     must not record money coming back that nobody gave back;
 *   · the confirmed attempts travel into the commit, which verifies them for itself;
 *   · a console (administrative) refund of a card tender is refused rather than recorded as a
 *     person's word, because there is no till at the counter for the terminal to answer to.
 */

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const user = { id: id(1), email: 'cashier@example.test', sessionId: id(2), deviceId: id(3) };

const authorization = {
  commandContextType: 'pos_device' as const,
  administrativeCommandId: null,
  operatorSessionId: id(4),
  durableSessionId: id(2),
  operatorId: id(1),
  operatorReference: 'Cashier',
  locationId: id(6),
  deviceId: id(3),
  credentialVersion: 1,
  permissions: ['sale.exception.read', 'sale.refund.partial', 'sale.refund.manual_terminal'],
};

const TENDER = id(30);
const CAPTURE_ATTEMPT = id(31);
const REFUND_ATTEMPT = id(32);

const command = () => ({
  locationId: id(6),
  operatorSessionId: id(4),
  previewId: id(12),
  previewFingerprint: 'a'.repeat(64),
  approvalId: null,
  expectedSaleVersion: 1,
  commandId: id(8),
  idempotencyKey: id(9),
  offline: false as const,
  fiscalMotive: '02' as const,
});

const sample = (
  options: {
    targets?: unknown[];
    refund?: unknown;
    authorization?: unknown;
  } = {},
) => {
  const repo = {
    authorize: vi.fn().mockResolvedValue(options.authorization ?? authorization),
    authorizeAdministrative: vi.fn().mockResolvedValue(options.authorization ?? authorization),
    providerRefundTargets: vi.fn().mockResolvedValue(
      options.targets ?? [
        {
          tenderId: TENDER,
          attemptId: CAPTURE_ATTEMPT,
          tenderAmountMinorUnits: 2_000,
          currency: 'MXN',
          provider: 'mercado_pago_point',
        },
      ],
    ),
    commit: vi.fn().mockResolvedValue({
      exceptionId: id(10),
      exceptionType: 'partial_refund',
      status: 'committed',
    }),
  };
  const integrity = {
    execute: vi.fn(async (_input, operation) => {
      const outcome = await operation({
        client: {},
        correlationId: 'refund',
        appendAudit: vi.fn(),
      });
      return { status: 'succeeded', result: outcome.value, failureCode: null };
    }),
  };
  const tender = {
    refund: (options.refund ??
      vi.fn().mockResolvedValue({
        refundAttempt: { id: REFUND_ATTEMPT, commandIdentity: 'derived' },
        outcome: { kind: 'succeeded', providerStatus: 'refunded', code: null, message: null },
        providerRefundId: 'REFUND-1',
        paidAmountMinorUnits: 6_000,
        idempotentReplay: false,
      })) as ReturnType<typeof vi.fn>,
  };
  const service = new PosExceptionService(
    repo as never,
    integrity as never,
    {} as never,
    { cancelForSale: vi.fn() } as never,
    tender as never,
  );
  return { repo, integrity, tender, service };
};

describe('the exception flow asks the terminal before it records a card refund', () => {
  it('moves the money first, with an identity derived from the preview and the tender', async () => {
    const { repo, tender, service } = sample();
    await service.commit(user, id(5), id(7), command());

    expect(tender.refund).toHaveBeenCalledOnce();
    const [, merchantId, attemptId, dto] = tender.refund.mock.calls[0];
    expect(merchantId).toBe(id(5));
    // The CAPTURE is what carries the payment id a partial refund needs (note 01 §4.3).
    expect(attemptId).toBe(CAPTURE_ATTEMPT);
    expect(dto).toMatchObject({
      attemptId: CAPTURE_ATTEMPT,
      amount: { minorUnits: 2_000, currency: 'MXN' },
      commandIdentity: derivedUuid('pos-exception-refund', id(12), TENDER),
    });
    // And the same run twice asks for the SAME refund: a retry is a replay, not a second
    // giving-back (plan D3).
    const first = sample();
    const second = sample();
    await first.service.commit(user, id(5), id(7), command());
    await second.service.commit(user, id(5), id(7), command());
    expect(second.tender.refund.mock.calls[0][3].commandIdentity).toBe(
      first.tender.refund.mock.calls[0][3].commandIdentity,
    );

    // The commit is handed the attempt the vendor confirmed, which it verifies for itself.
    expect(repo.commit.mock.calls[0][7]).toEqual([{ tenderId: TENDER, attemptId: REFUND_ATTEMPT }]);
  });

  it('refuses the whole command when the vendor declines, and records nothing', async () => {
    const { repo, service } = sample({
      refund: vi.fn().mockResolvedValue({
        refundAttempt: { id: REFUND_ATTEMPT },
        outcome: {
          kind: 'declined',
          providerStatus: 'refused',
          code: 'partial_refund_forbidden_with_tips',
          message: null,
        },
        providerRefundId: null,
        paidAmountMinorUnits: 6_000,
        idempotentReplay: false,
      }),
    });
    await expect(service.commit(user, id(5), id(7), command())).rejects.toMatchObject({
      response: {
        code: 'TERMINAL_REFUND_REFUSED',
        details: { providerCode: 'partial_refund_forbidden_with_tips' },
      },
    });
    // The sale does not learn about a refund that did not happen.
    expect(repo.commit).not.toHaveBeenCalled();
  });

  it('refuses the command when the terminal has not answered', async () => {
    const { repo, service } = sample({
      refund: vi.fn().mockResolvedValue({
        refundAttempt: { id: REFUND_ATTEMPT },
        outcome: { kind: 'unknown', providerStatus: 'processing', code: null, message: null },
        providerRefundId: null,
        paidAmountMinorUnits: 6_000,
        idempotentReplay: false,
      }),
    });
    await expect(service.commit(user, id(5), id(7), command())).rejects.toMatchObject({
      response: { code: 'PAYMENT_OUTCOME_UNKNOWN' },
    });
    expect(repo.commit).not.toHaveBeenCalled();
  });

  it('refuses a card refund from the console rather than recording a person’s word', async () => {
    const { repo, service } = sample({
      authorization: { ...authorization, commandContextType: 'dashboard_administrative' },
    });
    await expect(
      service.commitAdministrative(
        user,
        { merchantId: id(5), permissions: authorization.permissions } as never,
        {
          type: 'administrative',
          locationId: id(6),
          commandRecordId: id(40),
        } as never,
        id(7),
        {
          previewId: id(12),
          previewFingerprint: 'a'.repeat(64),
          approvalId: null,
          expectedSaleVersion: 1,
          commandId: id(8),
          idempotencyKey: id(9),
          offline: false,
          fiscalMotive: '02' as const,
        },
      ),
    ).rejects.toMatchObject({ response: { code: 'TERMINAL_REFUND_REQUIRES_TILL' } });
    expect(repo.commit).not.toHaveBeenCalled();
  });

  it('refuses without the terminal-refund permission, before asking anyone', async () => {
    const { repo, tender, service } = sample({
      authorization: {
        ...authorization,
        permissions: ['sale.exception.read', 'sale.refund.partial'],
      },
    });
    await expect(service.commit(user, id(5), id(7), command())).rejects.toMatchObject({
      response: {
        code: 'PERMISSION_REVOKED',
        details: { permission: 'sale.refund.manual_terminal' },
      },
    });
    expect(tender.refund).not.toHaveBeenCalled();
    expect(repo.commit).not.toHaveBeenCalled();
  });
});
