import { z } from 'zod';
import { Uuid } from './platform';
import { InventoryAllergenRef } from './pos-inventory';

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
  'fire_course',
]);

export const KitchenOrderItem = z
  .object({
    id: Uuid,
    status: KitchenItemStatus,
    productName: z.string().min(1).max(300),
    variantName: z.string().max(300).nullable(),
    /**
     * §8.5. The allergen labels this line carries, derived from the product's recipe
     * when the board is read. Never stored on the ticket: a stored copy would keep
     * showing a removed ingredient after the recipe changed.
     */
    allergens: z.array(InventoryAllergenRef).max(50),
    modifiers: z.array(z.string().max(300)).max(100),
    quantity: z.number().int().positive(),
    preparationNote: z.string().max(500).nullable(),
    displayOrder: z.number().int().nonnegative(),
    targetSeconds: z.number().int().min(30).max(86_400).nullable(),
    /**
     * §8H step 4. The course this item is served in, and whether it is FIRED yet.
     *
     * `fired` is derived from `courseNumber <= firedThroughCourse`, never stored: a
     * stored flag would be a second place for the truth and the two would disagree the
     * moment a course was fired and then corrected. A HELD item is returned like any
     * other, with `fired: false` — the board draws the distinction, SQL does not hide
     * the row.
     */
    courseNumber: z.number().int().min(1).max(20),
    fired: z.boolean(),
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
    /**
     * How far this ticket has been fired: every item of course <= this value is on the
     * rail, everything above it is held. Monotone — the command that writes it never
     * moves it backwards, so a replayed "fire course 1" after "fire course 2" is a
     * no-op rather than a rewind.
     */
    firedThroughCourse: z.number().int().min(1).max(20),
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
    /**
     * The course a `fire_course` command fires through, 1..20. Null for every other
     * command type. A value at or below the ticket's current watermark is accepted and
     * does nothing: the caller that asks again, or asks late, gets the current state
     * instead of an error.
     */
    courseNumber: z.number().int().min(1).max(20).nullable().default(null),
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

/**
 * THE ALL-DAY COUNT (§8H step 6): how many of each item the kitchen has been
 * asked for on the trading day it is working.
 *
 * "Four more of these" is the question a ticket cannot answer — a ticket is one
 * order, and the count is across every order of the day — and it is the number a
 * cook reads first. Two counts, because they are different questions: `ordered`
 * is everything asked for (cancelled orders were never cooked and are excluded),
 * and `outstanding` is what has not been marked ready yet.
 *
 * It is keyed on the product NAME and variant, not on a product id: the kitchen
 * projector stores what the order said, and a ticket line carries no catalogue
 * reference to join on. That is also why the two names are the key here.
 */
export const KitchenAllDayItem = z
  .object({
    productName: z.string().min(1).max(300),
    variantName: z.string().max(300).nullable(),
    ordered: z.number().int().nonnegative(),
    outstanding: z.number().int().nonnegative(),
  })
  .strict();

export const KitchenAllDayResponse = z
  .object({
    ok: z.literal(true),
    /**
     * The day the counts are for. The SERVER answers this rather than echoing a
     * request: the trading day is derived from the location's business-day start,
     * and a till with a drifted clock would otherwise ask for the wrong one.
     */
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    data: z.array(KitchenAllDayItem).max(500),
  })
  .strict();

export const KitchenCommandResponse = z
  .object({ ok: z.literal(true), data: KitchenCommandResult })
  .strict();

/**
 * The board's wake-up (§8H step 8): a HELD request, not a stream.
 *
 * The till asks "tell me when this location's kitchen changes" and the answer arrives when a ticket
 * moves, or — if nothing moves — when the hold expires, with `changed: false`. That second answer is
 * the poll kept as the floor: a missed notification, a dropped connection or a ticket written by
 * hand in SQL all fall back to it, and `waitedMs` is on the response so a cook's screen can be
 * honest about how long it waited.
 *
 * It is deliberately NOT a websocket or an SSE stream. The native client has neither, its HTTP
 * client does, and the house's own rule about nudges applies unchanged: the wake-up says only that
 * something changed, and the board re-reads over RLS REST.
 */
export const KitchenBoardWatchResponse = z
  .object({
    ok: z.literal(true),
    changed: z.boolean(),
    waitedMs: z.number().int().nonnegative(),
  })
  .strict();
export const PosKitchenOrderQuery = z
  .object({ locationId: Uuid, operatorSessionId: Uuid })
  .strict();

/**
 * The all-day read. Same authorisation pair as the board — the till has no
 * station, so the PERSON at it is authorised by `locationId` +
 * `operatorSessionId` — with an optional day so a manager can ask about a past
 * one. Omitted (the till's own case), the server answers with the newest day
 * that has orders at that location, which is the day the kitchen is on.
 */
export const PosKitchenAllDayQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    businessDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();
/**
 * A kitchen command sent by the POS-role device's unified KDS mode.
 *
 * The command itself is the iPad's own `KitchenCommandRequest` — same identity
 * fields, same optimistic version, same per-command permissions — and the two
 * extra fields are the POS context the board read already carries. The till has
 * no station: `merchant.kitchen_device_station` is empty for a POS device, so the
 * device route's station check can never pass for it. `locationId` and
 * `operatorSessionId` are what authorise the person at the till instead (defect
 * D33, §8H step 3).
 */
export const PosKitchenCommandRequest = KitchenCommandRequest.extend(
  PosKitchenOrderQuery.shape,
).strict();
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
export type KitchenAllDayItem = z.infer<typeof KitchenAllDayItem>;
export type KitchenAllDayResponse = z.infer<typeof KitchenAllDayResponse>;
export type KitchenBoardWatchResponse = z.infer<typeof KitchenBoardWatchResponse>;
export type PosKitchenOrderQuery = z.infer<typeof PosKitchenOrderQuery>;
export type PosKitchenAllDayQuery = z.infer<typeof PosKitchenAllDayQuery>;
export type PosKitchenCommandRequest = z.infer<typeof PosKitchenCommandRequest>;

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
  KitchenAllDayItem,
  KitchenAllDayResponse,
  KitchenCommandResponse,
  KitchenBoardWatchResponse,
  PosKitchenOrderQuery,
  PosKitchenAllDayQuery,
  PosKitchenCommandRequest,
  PosKitchenStatusResult,
} as const;
