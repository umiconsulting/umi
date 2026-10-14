import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PosPushService } from './pos-push.service';
import type { PosPushRepository } from './pos-push.repository';

const send = vi.fn();
vi.mock('firebase-admin/app', () => ({
  applicationDefault: () => ({}),
  getApps: () => [],
  initializeApp: () => ({ name: 'umi-pos-development' }),
}));
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({ send }) }));

const event = {
  type: 'kitchen_item_ready',
  merchantId: '1ce49462-b85e-4f05-85bd-8ecf249156e2',
  kitchenOrderId: '180589ae-19ea-4d23-8aa8-6dd2c6d113da',
  sourceOrderId: 'bd847932-9a58-4197-ab3c-22fabf56f078',
  itemId: '45f0fb4d-4496-43c9-8a42-8f4c6c3d2182',
  eventId: 'f4b23b92-55af-4c2a-84e2-cb0f7940328e',
  environment: 'development',
  projectId: 'umiconsulting-pos-dev',
};

function setup() {
  const repo = {
    register: vi.fn().mockResolvedValue(true),
    revoke: vi.fn().mockResolvedValue(undefined),
    revokeInvalid: vi.fn().mockResolvedValue(undefined),
    recipients: vi.fn().mockResolvedValue([
      {
        token: 'fcm-test-token',
        cartId: '9322304f-7e53-467f-bca4-790160ec63a4',
        accountFolio: 'Cuenta 004',
        tableName: 'Mesa 1',
        productName: 'Pizza',
      },
    ]),
  };
  const config = {
    get: (key: string) =>
      ({ UMI_ENVIRONMENT: 'development', FCM_PROJECT_ID: 'umiconsulting-pos-dev' })[key],
  } as ConfigService;
  return {
    repo,
    service: new PosPushService(config as never, repo as unknown as PosPushRepository),
  };
}

describe('PosPushService', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('binds registration to the authenticated user and device', async () => {
    const { repo, service } = setup();
    await service.register(
      { id: 'actor', sessionId: 'durable', deviceId: 'device', email: null },
      'merchant',
      { token: 'a'.repeat(50), platform: 'android', operatorSessionId: 'operator' },
    );
    expect(repo.register).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'actor',
        durableSessionId: 'durable',
        deviceId: 'device',
        environment: 'development',
        projectId: 'umiconsulting-pos-dev',
      }),
    );
  });

  it('sends only within the same Firebase environment and includes order identity', async () => {
    send.mockResolvedValue('projects/umiconsulting-pos-dev/messages/1');
    const { service } = setup();
    await service.sendReadyEvent(event);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'fcm-test-token',
        notification: {
          title: 'Pedido listo',
          body: 'Cuenta 004 · Mesa 1: Pizza ya se puede entregar',
        },
        android: expect.objectContaining({
          priority: 'high',
          notification: expect.objectContaining({
            channelId: 'orders_ready_v2',
            visibility: 'public',
          }),
        }),
        data: expect.objectContaining({
          type: 'kitchen_item_ready',
          itemId: event.itemId,
          eventId: event.eventId,
        }),
      }),
    );
    await expect(service.sendReadyEvent({ ...event, projectId: 'other-project' })).rejects.toThrow(
      'FCM_ENVIRONMENT_MISMATCH',
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('revokes an invalid token and does not retry that address', async () => {
    send.mockRejectedValue(
      Object.assign(new Error('invalid token'), {
        code: 'messaging/registration-token-not-registered',
      }),
    );
    const { repo, service } = setup();
    await service.sendReadyEvent(event);
    expect(repo.revokeInvalid).toHaveBeenCalledWith('fcm-test-token', 'umiconsulting-pos-dev');
  });

  it('sends one distinct order-ready message for the final item', async () => {
    send.mockResolvedValue('projects/umiconsulting-pos-dev/messages/2');
    const { service } = setup();
    await service.sendReadyEvent({ ...event, type: 'kitchen_order_ready' });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: {
          title: 'Pedido listo',
          body: 'Cuenta 004 · Mesa 1: orden lista para entregar',
        },
        data: expect.objectContaining({ type: 'kitchen_order_ready' }),
      }),
    );
  });
});
