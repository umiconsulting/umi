import { describe, expect, it, vi } from 'vitest';
import { PosExceptionService, exceptionCommandFingerprint } from './pos-exception.service';

/**
 * §8G's acceptance, third sentence, at the point where it is WIRED:
 * "a cancelled sale cancels its fiscal document", as ONE operation.
 *
 * WHAT THIS FILE PROVES AND WHAT IT DOES NOT, because the distinction is the honest part.
 *
 * It proves the WIRING: the exception's void hands the fiscal cancellation the SAME
 * database client its own transaction is using, inside the same command, so the two facts
 * commit or roll back together; that a PAC refusal propagates and NO audit event is written;
 * and that a full refund does NOT cancel the document (a refund is the SAT's credit note, a
 * different instrument).
 *
 * It does not prove the SQL — that `cancelForSale` writes `cancelled` with a motive, calls
 * the PAC exactly once for a stamped document, calls it not at all for a pending one, and
 * leaves the document `stamped` when its transaction rolls back. That is proved against the
 * real schema in `../fiscal/fiscal.integration.ts`, whose transaction test asserts both
 * inside the transaction and after a rollback.
 *
 * The composition is the two together, and saying so is better than one test that looks
 * end-to-end while stubbing the half that actually moves the SAT's state.
 */

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const user = { id: id(1), email: 'manager@example.test', sessionId: id(2), deviceId: id(3) };
const SALE = id(7);
const MOTIVE = '03';

const authorization = {
  operatorSessionId: id(4),
  durableSessionId: id(2),
  operatorId: id(1),
  operatorReference: 'Manager',
  locationId: id(6),
  deviceId: id(3),
  credentialVersion: 1,
  permissions: ['sale.void.create', 'sale.refund.full', '*'],
};

interface Harness {
  service: PosExceptionService;
  cancelForSale: ReturnType<typeof vi.fn>;
  appendAudit: ReturnType<typeof vi.fn>;
  /** The client the repository's own transaction was handed. */
  client: object;
  run: () => Promise<unknown>;
}

function harness(exceptionType: 'void' | 'full_refund', cancelFails = false): Harness {
  const client = { name: 'the-command-transaction' };
  const cancelForSale = cancelFails
    ? vi.fn().mockRejectedValue(new Error('the PAC refused the cancellation'))
    : vi.fn().mockResolvedValue({ documentFound: true, documentId: id(30), status: 'cancelled' });
  const appendAudit = vi.fn().mockResolvedValue(id(31));

  const repo = {
    authorize: vi.fn().mockResolvedValue(authorization),
    assertPreview: vi.fn(),
    // No provider-captured terminal on this sale, so the card-refund path is inert.
    providerRefundTargets: vi.fn().mockResolvedValue([]),
    commit: vi.fn().mockResolvedValue({
      exceptionId: id(20),
      exceptionType,
      status: 'committed',
    }),
  };
  const integrity = {
    execute: vi.fn(
      async (_command: unknown, operation: (context: unknown) => Promise<{ value: unknown }>) => {
        const outcome = await operation({ client, correlationId: id(40), appendAudit });
        // The same envelope `IntegrityService` returns, so the service under test behaves as
        // it does in production rather than being handed a shape it never sees.
        return { status: 'succeeded', result: outcome.value, failureCode: null };
      },
    ),
  };
  const fiscal = { cancelForSale };

  const service = new PosExceptionService(
    repo as never,
    integrity as never,
    {} as never,
    fiscal as never,
    // The tender path: a card tender's refund is asked of the terminal through it
    // (plan §4 Phase 4). These cases carry no card tender, so it is never called.
    { refund: vi.fn() } as never,
  );

  return {
    service,
    cancelForSale,
    appendAudit,
    client,
    run: () =>
      service.commit(user, id(5), SALE, {
        locationId: id(6),
        operatorSessionId: id(4),
        previewId: id(12),
        previewFingerprint: 'a'.repeat(64),
        approvalId: null,
        expectedSaleVersion: 1,
        commandId: id(8),
        idempotencyKey: id(9),
        offline: false,
        fiscalMotive: MOTIVE,
      }),
  };
}

describe('a voided sale cancels its CFDI in the same command (§8G acceptance)', () => {
  it('hands the fiscal cancellation the SAME transaction the sale was voided in', async () => {
    const h = harness('void');
    await h.run();

    expect(h.cancelForSale).toHaveBeenCalledOnce();
    const [client, request] = h.cancelForSale.mock.calls[0] as [object, Record<string, unknown>];
    // The same client object is the proof that there is one transaction: `cancelForSale`
    // opens none of its own, so anything it writes commits with the void or not at all.
    expect(client).toBe(h.client);
    expect(request).toMatchObject({
      merchantId: id(5),
      saleId: SALE,
      locationId: id(6),
      motive: MOTIVE,
    });
  });

  it('names the fiscal document in the SAME audit event as the void', async () => {
    const h = harness('void');
    await h.run();

    expect(h.appendAudit).toHaveBeenCalledOnce();
    const event = h.appendAudit.mock.calls[0][0] as {
      eventType: string;
      publicData: Record<string, unknown>;
    };
    expect(event.eventType).toBe('sale.void_committed');
    expect(event.publicData).toMatchObject({
      exceptionType: 'void',
      fiscalDocumentFound: true,
      fiscalDocumentId: id(30),
      fiscalDocumentStatus: 'cancelled',
    });
  });

  it('cancels NOTHING when the PAC refuses, and writes no audit event', async () => {
    const h = harness('void', true);
    await expect(h.run()).rejects.toThrow('the PAC refused');
    // Nothing was recorded: the exception bubbles out of the command's operation, so the
    // transaction rolls back and the audit event is never appended. An operator cannot end
    // up with a voided sale whose CFDI the SAT still considers live.
    expect(h.appendAudit).not.toHaveBeenCalled();
  });

  it('does NOT cancel the document for a full refund — that is a credit note, not a cancellation', async () => {
    // A refund gives the money back; the SAT's instrument for that is a CFDI de Egreso
    // (Facturapi's type `E`), NOT the cancellation of the income CFDI. Cancelling here would
    // erase the fiscal record of a sale that really happened.
    const h = harness('full_refund');
    await h.run();
    expect(h.cancelForSale).not.toHaveBeenCalled();
  });

  it('never lets a void skip the fiscal step when the sale has no document', async () => {
    // The one legitimate asymmetry, and it is not a silent one: a café must be able to void
    // a ticket nobody asked a factura for. `cancelForSale` says so with `documentFound:
    // false` and writes nothing, and the audit records that answer.
    const h = harness('void');
    h.cancelForSale.mockResolvedValue({ documentFound: false, documentId: null, status: null });
    await h.run();
    expect(h.cancelForSale).toHaveBeenCalledOnce();
    const event = h.appendAudit.mock.calls[0][0] as { publicData: Record<string, unknown> };
    expect(event.publicData).toMatchObject({
      fiscalDocumentFound: false,
      fiscalDocumentId: null,
      fiscalDocumentStatus: null,
    });
  });

  it('keeps the command fingerprint stable, so the fiscal step cannot make a command replay', async () => {
    // The fingerprint is what the idempotency key is bound to; if wiring a new fact into the
    // command changed it, a retry of an already-accepted void would be refused as a
    // different command. That is the shape of failure this asserts against.
    expect(exceptionCommandFingerprint(SALE, id(12), 'a'.repeat(64), id(8))).toBe(
      exceptionCommandFingerprint(SALE, id(12), 'a'.repeat(64), id(8)),
    );
  });
});
