import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PointWebhookService, type PointNotificationEnvelope } from './point-webhook.service';

/**
 * The Mercado Pago Point notification receiver (plan Phase 2, steps 1 and 2).
 *
 * PUBLIC ON PURPOSE: the vendor's servers post here, so there is no session to
 * authenticate and no `AuthGuard` on this controller — the `x-signature` HMAC is the
 * authentication. The global `CsrfGuard` lets a cookie-less POST through, exactly as
 * it does for the leads webhook, so nothing else is needed to reach this route.
 *
 * The route does four cheap things and answers: read the request, verify the
 * signature, enqueue one job, return 200. It does not write the attempt and never
 * calls the provider — the worker does that, and it is the worker's job because the
 * vendor's 22-second budget is not enough for a database round trip plus a re-read
 * (plan §3 D2).
 */
@Controller('api/webhooks')
export class PointWebhookController {
  private readonly logger = new Logger(PointWebhookController.name);

  constructor(
    private readonly point: PointWebhookService,
    config: ConfigService<AppConfig, true>,
  ) {
    // The controller holds config for exactly one reason: it can say at BOOT that this
    // deployment has no panel secret, which means every notification will be refused
    // with a 401 and no card sale will ever resolve itself. The secret itself is never
    // read here — the service resolves it per call, and nothing logs it.
    if (!config.get('MERCADO_PAGO_POINT_WEBHOOK_SECRET', { infer: true })) {
      this.logger.warn(
        'mercado_pago_point_webhook_unconfigured: MERCADO_PAGO_POINT_WEBHOOK_SECRET is not set — every notification will be refused (401)',
      );
    }
  }

  @Post('mercado-pago-point')
  @HttpCode(200)
  async receive(
    @Body() rawBody: unknown,
    @Query('data.id') queryDataId?: string,
    @Query('type') queryType?: string,
    @Headers('x-signature') signatureHeader?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{ received: true }> {
    // ── TWO SOURCES, ON PURPOSE ────────────────────────────────────────────────
    // The vendor signs `data.id` as it arrives in the URL QUERY STRING (research note
    // 02 §2.7: every official SDK helper reads it there), while the BODY carries its
    // own richer copy of the same order — `external_reference`, `status`,
    // `status_detail`, `user_id`. So the query value is the one that goes into the
    // manifest and the body is the one that becomes the envelope. They are not
    // interchangeable: the body is not part of the hash, so reading the id from it
    // would verify nothing and would let a forger point the worker at any order.
    const body = asRecord(rawBody);
    const data = asRecord(body.data);
    const envelope: PointNotificationEnvelope = {
      action: asString(body.action) ?? '',
      orderId: asString(data.id) ?? null,
      externalReference: asString(data.external_reference) ?? null,
      status: asString(data.status) ?? null,
      statusDetail: asString(data.status_detail) ?? null,
      sellerUserId: asString(body.user_id) ?? null,
      liveMode: typeof body.live_mode === 'boolean' ? body.live_mode : null,
      requestId: asString(requestId) ?? null,
    };
    const type = asString(queryType);

    const verdict = this.point.verify({
      signatureHeader: asString(signatureHeader),
      requestId: asString(requestId),
      dataId: asString(queryDataId),
    });

    // Plan §7: every notification logs its verdict and its order id BEFORE it does
    // anything with it. Never the secret, never the signature header verbatim, never
    // the token.
    if (!verdict.ok) {
      this.logger.warn(
        `mercado_pago_point_webhook_rejected verdict=${verdict.reason} type=${type ?? '-'} order=${envelope.orderId ?? '-'}`,
      );
      // Nothing else happens on this path: no enqueue, no write, no provider call.
      throw new UnauthorizedException({ code: 'POINT_WEBHOOK_SIGNATURE_INVALID' });
    }

    this.logger.log(
      `mercado_pago_point_webhook verdict=ok type=${type ?? '-'} action=${envelope.action || '-'} order=${envelope.orderId ?? '-'} request_id=${envelope.requestId ?? '-'}`,
    );

    const { enqueued } = await this.point.accept(envelope);
    if (!enqueued) {
      // A refused enqueue is answered with a 5xx rather than a 200: the vendor retries
      // until it gets a 200, so an infrastructure failure here costs a retry, while a
      // `200` would drop the notification for good.
      throw new ServiceUnavailableException({ code: 'POINT_WEBHOOK_ENQUEUE_FAILED' });
    }
    return { received: true };
  }
}

/** Nest hands back whatever the query parser produced; only a non-empty string is usable. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
