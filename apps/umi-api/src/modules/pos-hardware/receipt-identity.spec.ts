import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { PgService } from '../../shared/database/pg.service';
import { PosHardwareRepository } from './pos-hardware.repository';

const MERCHANT = '10000000-0000-4000-8000-000000000101';
const LOCATION = '10000000-0000-4000-8000-000000000102';
const SESSION = '10000000-0000-4000-8000-000000000103';
const RECEIPT = '20000000-0000-4000-8000-000000000913';
const COMMAND = '30000000-0000-4000-8000-000000000913';
const PRINTER = '10000000-0000-4000-8000-000000000301';

/**
 * THE PAPER NAMES THE ORDER, THE TICKET AND THE COPY.
 *
 * "TICKET 0001" is the document's consecutive number — the one the tax rule asks for —
 * and it says nothing to the guest at the counter. The order number is the account the
 * crew calls out, so it leads the header and the folio rides under it; and every paper
 * after the sale's own says which copy it is, counted from the impressions the receipt
 * already has (owner, 2026-10-12).
 */
function harness(options: {
  priorImpressions: number;
  accountNumber: string | null;
  exceptionReceipt?: boolean;
}) {
  const commands: Record<string, unknown>[] = [];
  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes('FROM merchant.receipt_snapshot r')) {
        return {
          rows: [
            {
              id: RECEIPT,
              receiptNumber: options.exceptionReceipt ? 'EX-0002' : '0042',
              businessDate: '2026-10-12',
              // The instant the receipt froze, and the café's own timezone. The paper's hour
              // is the one these two say together, which is why the row carries both.
              issuedAt: new Date('2026-10-12T18:12:34.000Z'),
              timezone: 'America/Mazatlan',
              currency: 'MXN',
              exceptionMarker: options.exceptionReceipt ? 'refund' : null,
              accountNumber: options.accountNumber,
              originalReceiptNumber: options.exceptionReceipt ? '0001' : null,
              merchantLogoUrl: options.exceptionReceipt ? 'http://api.test/onca-logo.png' : null,
              snapshot: {
                merchantName: 'ONCA',
                locationName: 'ONCA',
                lines: [],
                payments: [],
                grandTotal: { minorUnits: 5000, currency: 'MXN' },
              },
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes('count(*)::text AS prior')) {
        return { rows: [{ prior: String(options.priorImpressions) }], rowCount: 1 };
      }
      if (text.includes('create_hardware_command')) {
        commands.push(values?.[0] as Record<string, unknown>);
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('FROM merchant.hardware_command c')) {
        return {
          rows: [
            {
              commandId: COMMAND,
              commandType: 'print_receipt',
              targetHardwareId: PRINTER,
              merchantId: MERCHANT,
              locationId: LOCATION,
              registerId: null,
              originatingPosDeviceId: null,
              operatorId: null,
              sourceAggregateType: 'receipt',
              sourceAggregateId: RECEIPT,
              payloadFingerprint: 'a'.repeat(64),
              idempotencyKey: 'idempotency',
              expectedConfigurationVersion: 1,
              correlationId: 'correlation',
              status: 'queued',
              createdAt: new Date('2026-10-12T00:00:00.000Z'),
              startedAt: null,
              completedAt: null,
              failureCode: null,
              safeResultMetadata: null,
              safePayload: {},
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as PoolClient;
  const repository = new PosHardwareRepository({} as PgService);
  const request = {
    commandId: COMMAND,
    targetHardwareId: PRINTER,
    commandType: 'print_receipt' as const,
    sourceAggregateType: 'receipt',
    sourceAggregateId: RECEIPT,
    locationId: LOCATION,
    operatorSessionId: SESSION,
    registerId: null,
    expectedConfigurationVersion: 1,
    idempotencyKey: 'idempotency',
    copy: true,
  };
  const payloadOf = async () => {
    await repository.createCommand(
      client,
      MERCHANT,
      {
        operatorSessionId: SESSION,
        credentialVersion: 1,
      } as never,
      request as never,
      'correlation',
    );
    const command = commands.at(-1) as { safePayload: { printPayload: Record<string, unknown> } };
    return command.safePayload.printPayload;
  };
  return { payloadOf };
}

describe('the receipt payload names what the paper is', () => {
  it('carries the order number the guest hears, padded like the account is', async () => {
    const { payloadOf } = harness({ priorImpressions: 0, accountNumber: '131' });
    expect((await payloadOf()).orderNumber).toBe('131');
  });

  it('counts the copy from the impressions the receipt already has', async () => {
    const first = harness({ priorImpressions: 0, accountNumber: '131' });
    expect((await first.payloadOf()).copyIndex).toBe(1);

    const third = harness({ priorImpressions: 2, accountNumber: '131' });
    expect((await third.payloadOf()).copyIndex).toBe(2);
  });

  it('names the impression with the print job it came out of', async () => {
    const { payloadOf } = harness({ priorImpressions: 0, accountNumber: '131' });
    expect((await payloadOf()).impressionId).toBe(COMMAND);
  });

  it('a café that never had an account number still gets its ticket', async () => {
    const { payloadOf } = harness({ priorImpressions: 1, accountNumber: null });
    const payload = await payloadOf();
    expect(payload.orderNumber).toBeNull();
    expect(payload.receiptNumber).toBe('0042');
    // 18:12:34 UTC is 11:12:34 in the café (America/Mazatlan, -07:00). The paper prints the
    // hour the café read, with the offset that says which clock it is.
    expect(payload.issuedAt).toBe('2026-10-12T11:12:34.000-07:00');
  });

  it('links a refund to the original order and ticket and carries the logo', async () => {
    const { payloadOf } = harness({
      priorImpressions: 0,
      accountNumber: '193',
      exceptionReceipt: true,
    });
    const payload = await payloadOf();
    expect(payload.receiptNumber).toBe('EX-0002');
    expect(payload.orderNumber).toBe('193');
    expect(payload.originalReceiptNumber).toBe('0001');
    expect(payload.logoUrl).toBe('http://api.test/onca-logo.png');
    expect(payload.exceptionMarker).toBe('refund');
  });
});

/**
 * A CONTROLLED REPRINT IS A NEW IMPRESSION, NOT A NEW DOCUMENT.
 *
 * The job's content is the customer's paper as it was — items, totals, receipt
 * number — but the order it belongs to, which copy it is and which job it came out of
 * are facts about THIS impression. Copying them printed a second copy that claimed to
 * be the first, and a paper with no order at all when the original was written before
 * the till printed order numbers (owner, 2026-10-12).
 */
describe('a reprint says which copy it is, and carries its own job', () => {
  const JOB = '40000000-0000-4000-8000-000000000913';
  const COMMAND = '50000000-0000-4000-8000-000000000913';

  function harness(options: {
    prior: string;
    accountNumber: string | null;
    logo: string | null;
    originalReceiptNumber?: string | null;
  }) {
    const documents: Record<string, unknown>[] = [];
    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        if (text.includes('FROM merchant.hardware_print_job j') && text.includes('safe_document')) {
          return {
            rows: [
              {
                jobId: JOB,
                registerId: null,
                targetPrinterId: PRINTER,
                sourceAggregateType: 'receipt',
                sourceAggregateId: RECEIPT,
                configurationVersion: 1,
                printPayload: {
                  receiptId: RECEIPT,
                  merchantName: 'ONCA',
                  locationName: 'ONCA',
                  receiptNumber: '0042',
                  // The original was written before the paper named the order.
                  orderNumber: null,
                  copyIndex: 0,
                  impressionId: null,
                  businessDate: '2026-10-12',
                  currency: 'MXN',
                  items: [],
                  totals: {},
                },
                safeDocument: { printPayload: {}, credentialVersion: 1 },
              },
            ],
            rowCount: 1,
          };
        }
        if (text.includes('FROM merchant.merchant m')) {
          return {
            rows: [
              {
                logoUrl: options.logo,
                orderNumber: options.accountNumber,
                originalReceiptNumber: options.originalReceiptNumber ?? null,
                prior: options.prior,
              },
            ],
            rowCount: 1,
          };
        }
        if (text.includes('create_controlled_reprint')) {
          // `query(sql, values)`: the document is the last parameter, as pg takes them.
          documents.push((values?.at(-1) ?? {}) as Record<string, unknown>);
          return { rows: [], rowCount: 1 };
        }
        if (text.includes('FROM merchant.hardware_print_job j')) {
          return {
            rows: [
              {
                jobId: JOB,
                targetPrinterId: PRINTER,
                type: 'receipt_copy',
                sourceAggregateType: 'receipt',
                sourceAggregateId: RECEIPT,
                correlationId: 'correlation',
                idempotencyKey: 'idempotency-reprint',
                payloadFingerprint: 'a'.repeat(64),
                copies: 1,
                status: 'queued',
                attempts: 0,
                createdAt: new Date('2026-10-12T00:00:00.000Z'),
                startedAt: null,
                completedAt: null,
                failureCode: null,
                originalJobId: JOB,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;
    const repository = new PosHardwareRepository({} as PgService);
    return { repository, client, documents };
  }

  it('stamps the copy index, the order and its own impression id', async () => {
    const { repository, client, documents } = harness({
      prior: '3',
      accountNumber: '104',
      logo: 'http://192.168.1.9:4001/logos/onca.png',
    });

    await repository.reprint(
      client,
      MERCHANT,
      JOB,
      {
        locationId: LOCATION,
        operatorSessionId: SESSION,
        commandId: COMMAND,
        idempotencyKey: 'idempotency-reprint',
        reason: 'customer_copy',
      } as never,
      'correlation',
    );

    const document = documents.at(0) as { printPayload: Record<string, unknown> };
    const payload = document.printPayload;
    expect(payload.copyIndex).toBe(3);
    expect(payload.orderNumber).toBe('104');
    expect(String(payload.impressionId)).toHaveLength(36);
    expect(payload.receiptNumber).toBe('0042');
    expect(payload.logoUrl).toBe('http://192.168.1.9:4001/logos/onca.png');
  });

  it('restores the original order and ticket on a copy of an older EX receipt', async () => {
    const { repository, client, documents } = harness({
      prior: '1',
      accountNumber: '193',
      originalReceiptNumber: '0001',
      logo: 'http://192.168.1.9:4001/logos/onca.png',
    });
    await repository.reprint(
      client,
      MERCHANT,
      JOB,
      {
        locationId: LOCATION,
        operatorSessionId: SESSION,
        commandId: COMMAND,
        idempotencyKey: 'idempotency-reprint-exception',
        reason: 'customer_copy',
      } as never,
      'correlation',
    );
    const payload = (documents.at(0) as { printPayload: Record<string, unknown> }).printPayload;
    expect(payload.orderNumber).toBe('193');
    expect(payload.originalReceiptNumber).toBe('0001');
    expect(payload.logoUrl).toBe('http://192.168.1.9:4001/logos/onca.png');
  });
});
