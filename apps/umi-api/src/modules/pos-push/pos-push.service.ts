import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { z } from 'zod';
import type { AppConfig } from '../../shared/config/config.schema';
import type { AuthUser } from '../auth/auth.types';
import { PosPushRepository } from './pos-push.repository';

const readyEvent = z.object({
  type: z.enum(['kitchen_item_ready', 'kitchen_order_ready']),
  merchantId: z.string().uuid(),
  kitchenOrderId: z.string().uuid(),
  sourceOrderId: z.string().uuid(),
  itemId: z.string().uuid(),
  eventId: z.string().uuid(),
  environment: z.string(),
  projectId: z.string(),
});

@Injectable()
export class PosPushService {
  private readonly logger = new Logger(PosPushService.name);
  private readonly environment: string;
  private readonly projectId: string | undefined;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly repo: PosPushRepository,
  ) {
    this.environment = config.get('UMI_ENVIRONMENT', { infer: true });
    this.projectId = config.get('FCM_PROJECT_ID', { infer: true });
  }

  async register(
    user: AuthUser,
    merchantId: string,
    body: { token: string; platform: 'android'; operatorSessionId: string },
  ) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    if (!this.projectId) throw new ServiceUnavailableException({ code: 'FCM_NOT_CONFIGURED' });
    const registered = await this.repo.register({
      merchantId,
      userId: user.id,
      durableSessionId: user.sessionId,
      deviceId: user.deviceId,
      operatorSessionId: body.operatorSessionId,
      environment: this.environment,
      projectId: this.projectId,
      token: body.token,
    });
    if (!registered) throw new ForbiddenException({ code: 'OPERATOR_SESSION_REQUIRED' });
    return { ok: true as const };
  }

  async revoke(user: AuthUser, merchantId: string, body: { token: string }) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    await this.repo.revoke({
      merchantId,
      userId: user.id,
      deviceId: user.deviceId,
      token: body.token,
    });
    return { ok: true as const };
  }

  async sendReadyEvent(raw: unknown): Promise<void> {
    const event = readyEvent.parse(raw);
    if (
      !this.projectId ||
      event.environment !== this.environment ||
      event.projectId !== this.projectId
    ) {
      throw new Error('FCM_ENVIRONMENT_MISMATCH');
    }
    const recipients = await this.repo.recipients({
      merchantId: event.merchantId,
      kitchenOrderId: event.kitchenOrderId,
      itemId: event.itemId,
      environment: this.environment,
      projectId: this.projectId,
    });
    if (recipients.length === 0) {
      this.logger.log(`pos_push_no_recipient event=${event.eventId} item=${event.itemId}`);
      return;
    }
    const appName = `umi-pos-${this.environment}`;
    const app =
      getApps().find((candidate) => candidate.name === appName) ??
      initializeApp({ credential: applicationDefault(), projectId: this.projectId }, appName);
    for (const recipient of recipients) {
      try {
        const account = recipient.tableName
          ? `${recipient.accountFolio} · ${recipient.tableName}`
          : recipient.accountFolio;
        await getMessaging(app).send({
          token: recipient.token,
          notification: {
            title: 'Pedido listo',
            body:
              event.type === 'kitchen_order_ready'
                ? `${account}: orden lista para entregar`
                : `${account}: ${recipient.productName} ya se puede entregar`,
          },
          android: {
            priority: 'high',
            collapseKey: `${event.kitchenOrderId}:${event.itemId}`,
            notification: {
              channelId: 'orders_ready_v2',
              sound: 'default',
              visibility: 'public',
              tag: `${event.eventId}:${event.itemId}`,
            },
          },
          data: {
            type: event.type,
            sourceOrderId: event.sourceOrderId,
            kitchenOrderId: event.kitchenOrderId,
            itemId: event.itemId,
            eventId: event.eventId,
            cartId: recipient.cartId,
          },
        });
        this.logger.log(`pos_push_sent event=${event.eventId} item=${event.itemId}`);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          await this.repo.revokeInvalid(recipient.token, this.projectId);
          this.logger.warn(`pos_push_invalid_token event=${event.eventId} code=${code}`);
          continue;
        }
        throw error;
      }
    }
  }
}
