import { z } from 'zod';
import { Uuid } from './platform';

const IdempotencyKey = z.string().trim().min(8).max(200);
const KitchenCorrelationId = z.string().trim().min(8).max(200);

export const KitchenOrderStatus = z.enum([
  'queued',
  'in_preparation',
  'partially_ready',
  'ready',
  'completed',
  'cancelled',
  'exception',
]);
export const KitchenItemStatus = z.enum(['queued', 'preparing', 'ready', 'cancelled', 'exception']);
export const KitchenPriority = z.enum(['normal', 'high', 'urgent']);
export const KitchenCommandType = z.enum([
  'start_preparation',
  'mark_item_ready',
  'mark_order_ready',
  'complete',
  'recall',
  'cancel_ack',
  'change_priority',
]);

export const KitchenOrderItem = z
  .object({
    id: Uuid,
    status: KitchenItemStatus,
    productName: z.string().min(1).max(300),
    variantName: z.string().max(300).nullable(),
    modifiers: z.array(z.string().max(300)).max(100),
    quantity: z.number().int().positive(),
    preparationNote: z.string().max(500).nullable(),
    displayOrder: z.number().int().nonnegative(),
    targetSeconds: z.number().int().min(30).max(86_400).nullable(),
    version: z.number().int().positive(),
  })
  .strict();

export const KitchenOrderProjection = z
  .object({
    id: Uuid,
    sourceOrderId: Uuid,
    publicReference: z.string().min(1).max(160),
    merchantId: Uuid,
    locationId: Uuid,
    stationId: Uuid,
    source: z.enum(['whatsapp', 'pos', 'web', 'dashboard']),
    status: KitchenOrderStatus,
    priority: KitchenPriority,
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    queuedAt: z.string().datetime({ offset: true }),
    preparationStartedAt: z.string().datetime({ offset: true }).nullable(),
    updatedAt: z.string().datetime({ offset: true }),
    version: z.number().int().positive(),
    lastEventSequence: z.number().int().nonnegative(),
    items: z.array(KitchenOrderItem).max(500),
  })
  .strict();

export const KitchenBoardRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('snapshot') }).strict(),
  z
    .object({
      action: z.literal('events'),
      afterSequence: z.number().int().nonnegative(),
      limit: z.number().int().min(1).max(500),
    })
    .strict(),
]);

export const KitchenCommandRequest = z
  .object({
    action: z.literal('command'),
    commandId: Uuid,
    idempotencyKey: IdempotencyKey,
    correlationId: KitchenCorrelationId,
    expectedVersion: z.number().int().positive(),
    kitchenOrderId: Uuid,
    commandType: KitchenCommandType,
    itemIds: z.array(Uuid).max(500).default([]),
    reasonCode: z.string().min(1).max(100).nullable().default(null),
    reasonNote: z.string().max(500).nullable().default(null),
    priority: KitchenPriority.nullable().default(null),
  })
  .strict();

export const KitchenCommandResult = z
  .object({
    kitchenOrderId: Uuid,
    status: KitchenOrderStatus,
    version: z.number().int().positive(),
    sequence: z.number().int().nonnegative(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const KitchenEventProjection = z
  .object({
    sequence: z.number().int().positive(),
    kitchenOrderId: Uuid,
    sourceOrderId: Uuid,
    merchantId: Uuid,
    locationId: Uuid,
    stationId: Uuid.nullable(),
    kind: z.enum([
      'order_created',
      'order_updated',
      'item_updated',
      'order_cancelled',
      'priority_changed',
      'order_recalled',
      'recovery_required',
    ]),
    aggregateVersion: z.number().int().positive(),
    status: KitchenOrderStatus.nullable(),
    occurredAt: z.string().datetime({ offset: true }),
    correlationId: z.string().min(8).max(200),
    source: z.literal('umi_api'),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const KitchenBoardResponse = z
  .object({
    ok: z.literal(true),
    data: z.union([z.array(KitchenOrderProjection), z.array(KitchenEventProjection)]),
  })
  .strict();
export const KitchenCommandResponse = z
  .object({ ok: z.literal(true), data: KitchenCommandResult })
  .strict();
export const PosKitchenOrderQuery = z
  .object({ locationId: Uuid, operatorSessionId: Uuid })
  .strict();
export const PosKitchenStatusResult = z
  .object({
    kitchenOrderId: Uuid,
    sourceOrderId: Uuid,
    publicReference: z.string().min(1).max(160),
    status: KitchenOrderStatus,
    priority: KitchenPriority,
    version: z.number().int().positive(),
    stationIds: z.array(Uuid).max(100),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type KitchenOrderStatus = z.infer<typeof KitchenOrderStatus>;
export type KitchenItemStatus = z.infer<typeof KitchenItemStatus>;
export type KitchenPriority = z.infer<typeof KitchenPriority>;
export type KitchenCommandRequest = z.infer<typeof KitchenCommandRequest>;
export type KitchenOrderProjection = z.infer<typeof KitchenOrderProjection>;
export type PosKitchenOrderQuery = z.infer<typeof PosKitchenOrderQuery>;

export const posKitchenModels = {
  KitchenOrderStatus,
  KitchenItemStatus,
  KitchenPriority,
  KitchenCommandType,
  KitchenOrderItem,
  KitchenOrderProjection,
  KitchenBoardRequest,
  KitchenCommandRequest,
  KitchenCommandResult,
  KitchenEventProjection,
  KitchenBoardResponse,
  KitchenCommandResponse,
  PosKitchenOrderQuery,
  PosKitchenStatusResult,
} as const;
