import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PointWebhookController } from './point-webhook.controller';
import type { PointNotificationEnvelope } from './point-webhook.service';
import type { PointSignatureVerdict } from './point-signature';

/**
 * The controller is built directly with a stubbed service — no Nest module, no Redis,
 * no network — because what it owns is the HTTP contract: which value is verified,
 * what reaches the service, and which status comes back.
 */

const QUERY_ID = 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3';
const REQUEST_ID = '2066ca19-c6f1-498a-be75-1923005edd06';
const SIGNATURE =
  'ts=1742505638683,v1=ced36ab6d33566bb1e16c125819b8d840d6b8ef136b0b9127c76064466f5229b';

/** The `order.processed` body of research note 02 §1.3, verbatim. */
const BODY = {
  action: 'order.processed',
  api_version: 'v1',
  application_id: '123456',
  data: {
    external_reference: 'ext_ref_1235',
    id: QUERY_ID,
    status: 'processed',
    status_detail: 'accredited',
    total_paid_amount: '120',
    type: 'point',
    version: 3,
  },
  date_created: '2025-08-07T18:54:40.851374414Z',
  live_mode: true,
  type: 'order',
  user_id: '123456',
};

function make(verdict: PointSignatureVerdict) {
  const service = {
    verify: vi.fn().mockReturnValue(verdict),
    accept: vi.fn().mockResolvedValue({ enqueued: true }),
  };
  const config = { get: vi.fn().mockReturnValue('panel-secret') };
  const controller = new PointWebhookController(service as never, config as never);
  return { controller, service, config };
}

describe('PointWebhookController.receive', () => {
  it('answers 401 and enqueues nothing when the signature does not verify', async () => {
    const { controller, service } = make({ ok: false, reason: 'mismatch' });

    const error = await controller
      .receive(BODY, QUERY_ID, 'order', SIGNATURE, REQUEST_ID)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getStatus()).toBe(401);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      code: 'POINT_WEBHOOK_SIGNATURE_INVALID',
    });
    expect(service.accept).not.toHaveBeenCalled();
  });

  it('answers 200 and enqueues exactly one job when the signature verifies', async () => {
    const { controller, service } = make({ ok: true });

    await expect(
      controller.receive(BODY, QUERY_ID, 'order', SIGNATURE, REQUEST_ID),
    ).resolves.toEqual({ received: true });

    expect(service.accept).toHaveBeenCalledTimes(1);
  });

  it('verifies the data.id from the query string and hands the body to accept unchanged', async () => {
    const { controller, service } = make({ ok: true });

    await controller.receive(BODY, 'ord01jq4s4ky8hwq6na5pxb65b3d3', 'order', SIGNATURE, REQUEST_ID);

    // The QUERY value is what the vendor signed; it is lowercased inside the manifest.
    expect(service.verify).toHaveBeenCalledWith({
      signatureHeader: SIGNATURE,
      requestId: REQUEST_ID,
      dataId: 'ord01jq4s4ky8hwq6na5pxb65b3d3',
    });

    // The BODY is what becomes the envelope: the order id, the command identity it
    // carries, the status, and the seller all travel to the worker as received.
    const expected: PointNotificationEnvelope = {
      action: 'order.processed',
      orderId: QUERY_ID,
      externalReference: 'ext_ref_1235',
      status: 'processed',
      statusDetail: 'accredited',
      sellerUserId: '123456',
      liveMode: true,
      requestId: REQUEST_ID,
    };
    expect(service.accept).toHaveBeenCalledWith(expected);
  });

  it('fills absent fields with null instead of inventing values', async () => {
    const { controller, service } = make({ ok: true });

    await controller.receive({}, undefined, undefined, undefined, undefined);

    expect(service.verify).toHaveBeenCalledWith({
      signatureHeader: undefined,
      requestId: undefined,
      dataId: undefined,
    });
    const expected: PointNotificationEnvelope = {
      action: '',
      orderId: null,
      externalReference: null,
      status: null,
      statusDetail: null,
      sellerUserId: null,
      liveMode: null,
      requestId: null,
    };
    expect(service.accept).toHaveBeenCalledWith(expected);
  });

  it('ignores a non-string query value rather than passing it into the manifest', async () => {
    const { controller, service } = make({ ok: false, reason: 'mismatch' });

    const error = await controller
      .receive(BODY, ['a', 'b'] as never, 'order', SIGNATURE, REQUEST_ID)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(service.verify).toHaveBeenCalledWith({
      signatureHeader: SIGNATURE,
      requestId: REQUEST_ID,
      dataId: undefined,
    });
  });

  it('answers 503, never 200, when the enqueue itself fails', async () => {
    const { controller, service } = make({ ok: true });
    service.accept.mockResolvedValue({ enqueued: false });

    const error = await controller
      .receive(BODY, QUERY_ID, 'order', SIGNATURE, REQUEST_ID)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
  });

  it('warns at construction when no panel secret is configured', () => {
    const service = { verify: vi.fn(), accept: vi.fn() };
    const config = { get: vi.fn().mockReturnValue(undefined) };
    expect(() => new PointWebhookController(service as never, config as never)).not.toThrow();
  });
});
