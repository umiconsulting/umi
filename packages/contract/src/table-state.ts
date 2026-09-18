import { z } from 'zod';
import { IsoTimestamp, Uuid } from './platform';

/**
 * Live table state — workstream D, steps 3, 4 and 5 (plan §8D).
 *
 * The floor plan (`FloorPlanDocument`) is the LAYOUT: which tables exist, where
 * they are, how big they are. This is the ROOM: who is sitting where right now,
 * how long they have been there, and which tables one party has taken. The two
 * are deliberately separate models with separate lifetimes — a layout is edited
 * and published, a seating is over in ninety minutes.
 *
 * The six states are the plan's, verbatim, and the client is not allowed to
 * invent a seventh. `StateValue` is the union the server and the Dart client
 * share; the API's column carries the same six in a CHECK constraint, so a
 * value that is not here cannot be stored either.
 */
export const TABLE_STATE_VALUES = [
  'open',
  'seated',
  'ordered',
  'served',
  'awaiting_payment',
  'dirty',
] as const;
export const TableStateValue = z.enum(TABLE_STATE_VALUES);
export type TableStateValue = z.infer<typeof TableStateValue>;

/**
 * The four states in which a party is ON the table. Used by the refinements
 * below to mirror, in the published contract, the invariants the database
 * enforces in `table_state_party_presence`: the two must agree, or a client can
 * construct a payload the server's own schema accepts and its column refuses.
 */
export const PARTY_PRESENT_STATES = ['seated', 'ordered', 'served', 'awaiting_payment'] as const;
export const partyIsPresent = (state: TableStateValue): boolean =>
  (PARTY_PRESENT_STATES as readonly string[]).includes(state);

const PartySize = z.number().int().min(1).max(100);

/**
 * One table's live state. `seatedAt` is the turn timer's origin: the client
 * renders elapsed time from it, and the server refuses to move it while a party
 * is present, so a move cannot restart the clock.
 */
export const TableStateEntry = z
  .object({
    tableId: Uuid,
    state: TableStateValue,
    seatedAt: IsoTimestamp.nullable(),
    partySize: PartySize.nullable(),
    /** The merge identity: the tables of one party share it. */
    groupId: Uuid.nullable(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const present = partyIsPresent(entry.state);
    const issue = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message });
    if (present !== (entry.seatedAt !== null))
      issue('A party is present exactly when seatedAt is set.');
    if (present !== (entry.partySize !== null))
      issue('A party is present exactly when partySize is set.');
    if (entry.groupId !== null && !present) issue('A merged group needs a party on the table.');
  });
export type TableStateEntry = z.infer<typeof TableStateEntry>;

/**
 * The whole room, in one read. The POS draws its map from the floor plan and
 * colours it from this; `serverTime` travels with it so a device with a wrong
 * clock renders turn times from the server's now rather than its own.
 *
 * A table with no entry here is `open`: the layout says the table exists and
 * nothing has happened on it yet, so the state row was never created. Readers
 * must therefore default a missing table to `open` rather than to "unknown".
 */
export const TableStateMap = z
  .object({
    locationId: Uuid,
    serverTime: IsoTimestamp,
    states: z.array(TableStateEntry).max(1000),
  })
  .strict();
export type TableStateMap = z.infer<typeof TableStateMap>;

export const TableStateQuery = z.object({ locationId: Uuid }).strict();
export const PosTableStateQuery = TableStateQuery.extend({ operatorSessionId: Uuid }).strict();
export type TableStateQuery = z.infer<typeof TableStateQuery>;
export type PosTableStateQuery = z.infer<typeof PosTableStateQuery>;

/**
 * Every write is a POS command: it carries the operator session it was made
 * under and an idempotency key, because a till that loses its response must be
 * able to retry without seating a second party at the same table. The dashboards
 * read this state; they do not write it.
 */
const PosCommandContext = {
  locationId: Uuid,
  operatorSessionId: Uuid,
  idempotencyKey: Uuid,
};

export const SeatTableRequest = z
  .object({ ...PosCommandContext, tableId: Uuid, partySize: PartySize })
  .strict();
export const MovePartyRequest = z
  .object({ ...PosCommandContext, fromTableId: Uuid, toTableId: Uuid })
  .strict()
  .superRefine((value, ctx) => {
    if (value.fromTableId === value.toTableId)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toTableId'],
        message: 'A move needs two different tables.',
      });
  });
export const MergeTablesRequest = z
  .object({ ...PosCommandContext, tableIds: z.array(Uuid).min(2).max(20), partySize: PartySize })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.tableIds).size !== value.tableIds.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tableIds'],
        message: 'A merged group names each table once.',
      });
  });
export const SplitPartyRequest = z.object({ ...PosCommandContext, tableId: Uuid }).strict();
export const ClearTableRequest = z.object({ ...PosCommandContext, tableId: Uuid }).strict();
export const OpenTableRequest = z.object({ ...PosCommandContext, tableId: Uuid }).strict();

/**
 * The three service transitions (plan §8D step 5's remainder: "one small route
 * each"). They advance a party that is already ON the table to the state the
 * front of house is in, and they take the same body as `clear` and `open` because
 * they are the same kind of operation: one table, named by the operator, under an
 * operator session and an idempotency key.
 *
 * THERE IS NO IMPOSED SEQUENCE. Any party-present state may go to any of the
 * three. Real service is not linear — a table orders a second round after being
 * served, and a drinks-only table asks for the bill straight from `seated` — so a
 * made-up order would refuse those perfectly normal taps and leave the operator
 * with a refusal and no recovery action, which §4 of the plan forbids. The
 * database deliberately allows the whole matrix (asserted in
 * `table-map/table-state.integration.ts`, "the DATABASE allows a service
 * transition — seated to served — without touching the timer"), and the only
 * refusal these routes add is a table with no party on it.
 *
 * The party's identity is left alone: `seated_at` (the turn timer), `party_size`
 * and `group_id` are not in the SET list, so the timer cannot restart and a
 * merged party stays one party. That is not a convention — a present-to-present
 * `seated_at` change is refused outright by `table_state_turn_timer_immutable`.
 */
export const MarkTableOrderedRequest = z.object({ ...PosCommandContext, tableId: Uuid }).strict();
export const MarkTableServedRequest = z.object({ ...PosCommandContext, tableId: Uuid }).strict();
export const MarkTableAwaitingPaymentRequest = z
  .object({ ...PosCommandContext, tableId: Uuid })
  .strict();

export type SeatTableRequest = z.infer<typeof SeatTableRequest>;
export type MovePartyRequest = z.infer<typeof MovePartyRequest>;
export type MergeTablesRequest = z.infer<typeof MergeTablesRequest>;
export type SplitPartyRequest = z.infer<typeof SplitPartyRequest>;
export type ClearTableRequest = z.infer<typeof ClearTableRequest>;
export type OpenTableRequest = z.infer<typeof OpenTableRequest>;
export type MarkTableOrderedRequest = z.infer<typeof MarkTableOrderedRequest>;
export type MarkTableServedRequest = z.infer<typeof MarkTableServedRequest>;
export type MarkTableAwaitingPaymentRequest = z.infer<typeof MarkTableAwaitingPaymentRequest>;

/**
 * What a write returns: the tables it changed, in their new state, plus the
 * server's clock. It is NOT the whole room — a replayed command returns the
 * outcome recorded the first time, and a whole-room snapshot replayed minutes
 * later would redraw the operator's board backwards. The affected entries are
 * the command's own result, which is the truth about them until someone else
 * changes them; the board itself is refreshed from the read route.
 */
export const TableStateChangeResult = z
  .object({
    locationId: Uuid,
    commandId: Uuid,
    changed: z.array(TableStateEntry).min(1).max(64),
    serverTime: IsoTimestamp,
  })
  .strict();
export type TableStateChangeResult = z.infer<typeof TableStateChangeResult>;

export const tableStateModels = {
  TableStateEntry,
  TableStateMap,
  TableStateQuery,
  PosTableStateQuery,
  SeatTableRequest,
  MovePartyRequest,
  MergeTablesRequest,
  SplitPartyRequest,
  ClearTableRequest,
  OpenTableRequest,
  MarkTableOrderedRequest,
  MarkTableServedRequest,
  MarkTableAwaitingPaymentRequest,
  TableStateChangeResult,
};
