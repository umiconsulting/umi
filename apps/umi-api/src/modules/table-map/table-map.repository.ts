import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TableStateEntry, type PosTableStateQuery, type TableStateValue } from '@umi/contract';
import type { PoolClient } from 'pg';
import { PgService } from '../../shared/database/pg.service';
import { planTables, type PlanTable } from '../../shared/floor-plan/plan-tables';
import type { AuthUser } from '../auth/auth.types';

/** The permission a POS operator needs to see or move the room. */
const POS_PERMISSION = 'sale.lifecycle';

/** A row of `merchant.table_state`, as node-postgres hands it back. */
type StateRow = {
  table_id: string;
  state: TableStateValue;
  seated_at: Date | null;
  party_size: number | null;
  group_id: string | null;
};

const STATE_COLUMNS =
  'table_id::text AS table_id,state,seated_at,party_size,group_id::text AS group_id';

/** A state row as the contract publishes it. */
export function tableStateEntry(row: StateRow): TableStateEntry {
  return TableStateEntry.parse({
    tableId: row.table_id,
    state: row.state,
    seatedAt: row.seated_at?.toISOString() ?? null,
    partySize: row.party_size,
    groupId: row.group_id,
  });
}

/**
 * `UPDATE ... RETURNING` and a multi-row upsert hand their rows back in whatever
 * order the plan chose, so anything with more than one row is ordered here: a
 * result that reshuffles between two identical calls is not a result a client (or
 * a test) can compare.
 */
function byTableId(rows: StateRow[]): TableStateEntry[] {
  return [...rows].sort((a, b) => a.table_id.localeCompare(b.table_id)).map(tableStateEntry);
}

@Injectable()
export class TableMapRepository {
  constructor(private readonly pg: PgService) {}

  async assertLocation(client: PoolClient, merchantId: string, locationId: string) {
    const result = await client.query(
      `SELECT id FROM merchant.location WHERE merchant_id=$1::uuid AND id=$2::uuid AND status='active' FOR SHARE`,
      [merchantId, locationId],
    );
    if (!result.rowCount) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });
  }

  /**
   * The operator session check, inside the caller's transaction.
   *
   * Each POS module owns its copy of this SQL — pos-cart, pos-cash and floor-plan
   * all do the same, and the reason is that the permission key differs per module
   * and the check has to run in the SAME transaction as the write it guards, on
   * the same RLS-scoped client. It is not a guard because a guard cannot see the
   * `operatorSessionId` in the body and cannot re-assert it against
   * `runtime.operator_session`'s own merchant, location, device and state.
   */
  async assertOperator(
    client: PoolClient,
    user: AuthUser,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ) {
    const authorization = await client.query(
      `SELECT 1 FROM runtime.operator_session os
       JOIN merchant.device d ON d.id=os.device_id AND d.merchant_id=os.merchant_id
       WHERE os.id=$1::uuid AND os.user_id=$2::uuid AND os.durable_session_id=$3::uuid
         AND os.device_id=$4::uuid AND os.merchant_id=$5::uuid AND os.location_id=$6::uuid
         AND os.state='active' AND os.expires_at>now() AND d.status='active'
         AND ($7::text=ANY(os.permissions) OR '*'=ANY(os.permissions))
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(os.entitlements) e
           WHERE e->>'featureKey'='pos' AND coalesce((e->>'enabled')::boolean,false))`,
      [
        operatorSessionId,
        user.id,
        user.sessionId,
        user.deviceId,
        merchantId,
        locationId,
        POS_PERMISSION,
      ],
    );
    if (!authorization.rowCount) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
  }

  /**
   * The plan the room is operated against: the PUBLISHED document, or the draft
   * when nothing has ever been published (plan §8D's rule for capacity). No
   * document at all means there is no room to operate on, and that is a refusal
   * rather than an empty room: seating a party at a table nobody drew would put
   * state on the floor that no screen can show.
   */
  async servingTables(
    client: PoolClient,
    merchantId: string,
    locationId: string,
  ): Promise<Map<string, PlanTable>> {
    await this.assertLocation(client, merchantId, locationId);
    const result = await client.query<{ plan: unknown }>(
      `SELECT coalesce(published, draft) AS plan FROM merchant.floor_plan
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid`,
      [merchantId, locationId],
    );
    const plan = result.rows[0]?.plan ?? null;
    if (plan === null)
      throw new ConflictException({
        code: 'FLOOR_PLAN_NOT_PUBLISHED',
        message: 'This location has no floor plan, so there is no table to work with.',
      });
    return planTables(plan);
  }

  /** The table in the served plan, or a typed refusal naming it. */
  private static table(
    tables: Map<string, PlanTable>,
    tableId: string,
    field = 'tableId',
  ): PlanTable {
    const table = tables.get(tableId);
    if (!table)
      throw new ConflictException({
        code: 'TABLE_NOT_IN_PLAN',
        message: 'That table is not in this location’s floor plan.',
        fieldErrors: { [field]: [tableId] },
      });
    return table;
  }

  async read(merchantId: string, locationId: string) {
    return this.pg.withMerchant(async (client) => {
      await this.assertLocation(client, merchantId, locationId);
      return this.readInTransaction(client, merchantId, locationId);
    });
  }

  async readInTransaction(
    client: PoolClient,
    merchantId: string,
    locationId: string,
  ): Promise<{
    locationId: string;
    serverTime: string;
    states: TableStateEntry[];
  }> {
    const rows = await client.query<StateRow>(
      `SELECT ${STATE_COLUMNS} FROM merchant.table_state
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid ORDER BY table_id`,
      [merchantId, locationId],
    );
    const clock = await client.query<{ now: Date }>('SELECT now() AS now');
    return {
      locationId,
      serverTime: clock.rows[0].now.toISOString(),
      states: rows.rows.map(tableStateEntry),
    };
  }

  async readForPos(user: AuthUser, merchantId: string, query: PosTableStateQuery) {
    return this.pg.runWithMerchant(
      merchantId,
      user.id,
      async (client) => {
        await this.assertOperator(
          client,
          user,
          merchantId,
          query.locationId,
          query.operatorSessionId,
        );
        await this.assertLocation(client, merchantId, query.locationId);
        return this.readInTransaction(client, merchantId, query.locationId);
      },
      query.locationId,
    );
  }

  /** The current state row, locked, or null when the table has never been used. */
  private async lockState(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    tableId: string,
  ): Promise<StateRow | null> {
    const result = await client.query<StateRow>(
      `SELECT ${STATE_COLUMNS} FROM merchant.table_state
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=$3::uuid FOR UPDATE`,
      [merchantId, locationId, tableId],
    );
    return result.rows[0] ?? null;
  }

  private static occupied(tableId: string, field = 'tableId'): never {
    throw new ConflictException({
      code: 'TABLE_ALREADY_OCCUPIED',
      message: 'That table already has a party on it.',
      fieldErrors: { [field]: [tableId] },
    });
  }

  /**
   * Seat a party. Refused when the table is not free (`open` and `dirty` are both
   * free) and when the party does not fit the table's published capacity.
   *
   * The upsert carries the free-ness test in its own `where`, so the check cannot
   * be raced: a second till that passes the read above still cannot take a table
   * that the first has just seated, because Postgres re-evaluates the qualifier
   * against the committed row after the lock.
   */
  async seat(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    input: { tableId: string; partySize: number },
  ): Promise<TableStateEntry[]> {
    const tables = await this.servingTables(client, merchantId, locationId);
    const table = TableMapRepository.table(tables, input.tableId);
    const current = await this.lockState(client, merchantId, locationId, input.tableId);
    if (current?.seated_at) TableMapRepository.occupied(input.tableId);
    if (input.partySize > table.capacity)
      throw new ConflictException({
        code: 'TABLE_CAPACITY_EXCEEDED',
        message: 'The party is larger than that table seats.',
        fieldErrors: { tableId: [input.tableId] },
      });
    const result = await client.query<StateRow>(
      `INSERT INTO merchant.table_state
         (merchant_id,location_id,table_id,state,seated_at,party_size,group_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'seated',now(),$4,NULL)
       ON CONFLICT (merchant_id,location_id,table_id) DO UPDATE
         SET state='seated',seated_at=now(),party_size=$4,group_id=NULL,updated_at=now()
         WHERE merchant.table_state.seated_at IS NULL
       RETURNING ${STATE_COLUMNS}`,
      [merchantId, locationId, input.tableId, input.partySize],
    );
    if (!result.rows[0]) TableMapRepository.occupied(input.tableId);
    return [tableStateEntry(result.rows[0])];
  }

  /**
   * Move a party to another table. The turn timer and the party size travel with
   * it; the source becomes `dirty`.
   *
   * A merged group moves WHOLE: the target receives the party, and every other
   * member of the group is released to `dirty` — the group's tables were holding
   * one party, and that party is now on the target. Because the party is on one
   * table afterwards, the group is dissolved: `group_id` is set exactly while a
   * group has more than one table. The target must seat the WHOLE party, which is
   * why the capacity it is checked against is the party size and not a share.
   */
  async move(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    input: { fromTableId: string; toTableId: string },
  ): Promise<TableStateEntry[]> {
    const tables = await this.servingTables(client, merchantId, locationId);
    TableMapRepository.table(tables, input.fromTableId, 'fromTableId');
    const target = TableMapRepository.table(tables, input.toTableId, 'toTableId');
    const source = await this.lockState(client, merchantId, locationId, input.fromTableId);
    if (!source?.seated_at)
      throw new ConflictException({
        code: 'TABLE_NOT_OCCUPIED',
        message: 'There is no party on that table to move.',
        fieldErrors: { fromTableId: [input.fromTableId] },
      });
    const destination = await this.lockState(client, merchantId, locationId, input.toTableId);
    if (destination?.seated_at) TableMapRepository.occupied(input.toTableId, 'toTableId');
    const partySize = source.party_size ?? 0;
    if (partySize > target.capacity)
      throw new ConflictException({
        code: 'TABLE_CAPACITY_EXCEEDED',
        message: 'The party is larger than the table it is moving to.',
        fieldErrors: { toTableId: [input.toTableId] },
      });

    const moved = await client.query<StateRow>(
      `INSERT INTO merchant.table_state
         (merchant_id,location_id,table_id,state,seated_at,party_size,group_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::timestamptz,$6,NULL)
       ON CONFLICT (merchant_id,location_id,table_id) DO UPDATE
         SET state=$4,seated_at=$5::timestamptz,party_size=$6,group_id=NULL,updated_at=now()
         WHERE merchant.table_state.seated_at IS NULL
       RETURNING ${STATE_COLUMNS}`,
      [merchantId, locationId, input.toTableId, source.state, source.seated_at, partySize],
    );
    if (!moved.rows[0]) TableMapRepository.occupied(input.toTableId, 'toTableId');

    // The source and, when the party was merged, every other member of the group
    // go to `dirty`: they need wiping, and they no longer hold a party.
    const released = source.group_id
      ? await client.query<StateRow>(
          `UPDATE merchant.table_state
             SET state='dirty',seated_at=NULL,party_size=NULL,group_id=NULL,updated_at=now()
           WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND group_id=$3::uuid
             AND table_id<>$4::uuid
           RETURNING ${STATE_COLUMNS}`,
          [merchantId, locationId, source.group_id, input.toTableId],
        )
      : await client.query<StateRow>(
          `UPDATE merchant.table_state
             SET state='dirty',seated_at=NULL,party_size=NULL,group_id=NULL,updated_at=now()
           WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=$3::uuid
           RETURNING ${STATE_COLUMNS}`,
          [merchantId, locationId, input.fromTableId],
        );
    return byTableId([moved.rows[0], ...released.rows]);
  }

  /**
   * Merge free tables into one party. All of them must be free and in the served
   * plan; they share one `seated_at` (the statement's `now()`, which is the
   * transaction's clock, so every row gets the same instant) and one new
   * `group_id`, and the party must fit their COMBINED capacity.
   */
  async merge(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    input: { tableIds: string[]; partySize: number },
  ): Promise<TableStateEntry[]> {
    const tables = await this.servingTables(client, merchantId, locationId);
    let capacity = 0;
    for (const tableId of input.tableIds)
      capacity += TableMapRepository.table(tables, tableId).capacity;
    const current = await client.query<StateRow>(
      `SELECT ${STATE_COLUMNS} FROM merchant.table_state
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=ANY($3::uuid[])
         AND seated_at IS NOT NULL FOR UPDATE`,
      [merchantId, locationId, input.tableIds],
    );
    if (current.rows[0])
      throw new ConflictException({
        code: 'TABLE_ALREADY_OCCUPIED',
        message: 'A table in that group already has a party on it.',
        fieldErrors: { tableIds: current.rows.map((row) => row.table_id) },
      });
    if (input.partySize > capacity)
      throw new ConflictException({
        code: 'TABLE_CAPACITY_EXCEEDED',
        message: 'The party is larger than the tables it would take together.',
        fieldErrors: { tableIds: input.tableIds },
      });
    // The group id is minted HERE rather than by `gen_random_uuid()` in the
    // SELECT: that function is volatile, so PostgreSQL would evaluate it once per
    // row and the "one party" would arrive as a group of strangers.
    const groupId = randomUUID();
    const inserted = await client.query<StateRow>(
      `INSERT INTO merchant.table_state
         (merchant_id,location_id,table_id,state,seated_at,party_size,group_id)
       SELECT $1::uuid,$2::uuid,t,'seated',now(),$4,$5::uuid
       FROM unnest($3::uuid[]) AS t
       ON CONFLICT (merchant_id,location_id,table_id) DO UPDATE
         SET state='seated',seated_at=now(),party_size=$4,
             group_id=excluded.group_id,updated_at=now()
         WHERE merchant.table_state.seated_at IS NULL
       RETURNING ${STATE_COLUMNS}`,
      [merchantId, locationId, input.tableIds, input.partySize, groupId],
    );
    // Every named table must have been written. A short answer means one of them
    // was taken between the read above and this write, and the transaction is
    // about to roll back — so the refusal is the whole outcome, not a half-merge.
    if (inserted.rows.length !== input.tableIds.length)
      throw new ConflictException({
        code: 'TABLE_ALREADY_OCCUPIED',
        message: 'A table in that group already has a party on it.',
        fieldErrors: { tableIds: input.tableIds },
      });
    return byTableId(inserted.rows);
  }

  /**
   * Dissolve the group containing this table. The nominated table keeps the
   * party; every other member becomes `dirty`. The group identity goes with the
   * group, so the survivor carries none — `group_id` is set exactly while a group
   * has more than one table.
   */
  async split(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    input: { tableId: string },
  ): Promise<TableStateEntry[]> {
    const tables = await this.servingTables(client, merchantId, locationId);
    TableMapRepository.table(tables, input.tableId);
    const source = await this.lockState(client, merchantId, locationId, input.tableId);
    if (!source?.seated_at)
      throw new ConflictException({
        code: 'TABLE_NOT_OCCUPIED',
        message: 'There is no party on that table to split.',
        fieldErrors: { tableId: [input.tableId] },
      });
    if (!source.group_id)
      throw new ConflictException({
        code: 'TABLE_NOT_GROUPED',
        message: 'That table is not part of a merged group.',
        fieldErrors: { tableId: [input.tableId] },
      });
    const members = await client.query<StateRow>(
      `SELECT ${STATE_COLUMNS} FROM merchant.table_state
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND group_id=$3::uuid
       FOR UPDATE`,
      [merchantId, locationId, source.group_id],
    );
    if (members.rows.length < 2)
      throw new ConflictException({
        code: 'TABLE_NOT_GROUPED',
        message: 'That table is not part of a merged group.',
        fieldErrors: { tableId: [input.tableId] },
      });
    const released = await client.query<StateRow>(
      `UPDATE merchant.table_state
         SET state='dirty',seated_at=NULL,party_size=NULL,group_id=NULL,updated_at=now()
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND group_id=$3::uuid
         AND table_id<>$4::uuid
       RETURNING ${STATE_COLUMNS}`,
      [merchantId, locationId, source.group_id, input.tableId],
    );
    const survivor = await client.query<StateRow>(
      `UPDATE merchant.table_state SET group_id=NULL,updated_at=now()
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=$3::uuid
       RETURNING ${STATE_COLUMNS}`,
      [merchantId, locationId, input.tableId],
    );
    return byTableId([survivor.rows[0], ...released.rows]);
  }

  /**
   * The party leaves and the table needs wiping: `dirty`. Clearing any member of
   * a merged group clears the whole party, because the group IS the party — the
   * four people who merged two tables did not leave one of them behind.
   *
   * A table returns to `open` through `openTable` below, once someone has wiped
   * it; nothing infers that from a timer, because "the table was cleared an hour
   * ago so it must be clean" is exactly the guess that puts a party at a dirty
   * table during a rush.
   */
  async clear(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    input: { tableId: string },
  ): Promise<TableStateEntry[]> {
    const tables = await this.servingTables(client, merchantId, locationId);
    TableMapRepository.table(tables, input.tableId);
    const source = await this.lockState(client, merchantId, locationId, input.tableId);
    if (!source?.seated_at)
      throw new ConflictException({
        code: 'TABLE_NOT_OCCUPIED',
        message: 'There is no party on that table to clear.',
        fieldErrors: { tableId: [input.tableId] },
      });
    const cleared = await client.query<StateRow>(
      `UPDATE merchant.table_state
         SET state='dirty',seated_at=NULL,party_size=NULL,group_id=NULL,updated_at=now()
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid
         AND ($3::uuid IS NULL AND table_id=$4::uuid OR group_id=$3::uuid)
       RETURNING ${STATE_COLUMNS}`,
      [merchantId, locationId, source.group_id, input.tableId],
    );
    return byTableId(cleared.rows);
  }

  /**
   * Advance a party that is already ON the table to the state the front of house
   * is in: `ordered` (food is in), `served` (food is out), `awaiting_payment`
   * (the bill has been asked for). Plan §8D step 5's remainder.
   *
   * ANY PARTY-PRESENT STATE MAY GO TO ANY OF THE THREE. Real service is not
   * linear — a table orders a second round after being served, a drinks-only
   * table asks for the bill straight from `seated`, and the kitchen sends food
   * for a table nobody told the till about — so a made-up sequence would refuse
   * ordinary taps and hand the operator a refusal with no recovery action, which
   * §4 of the plan forbids. The database deliberately permits the whole matrix
   * (`table_state.integration.ts`, "the DATABASE allows a service transition —
   * seated to served — without touching the timer"). The ONE refusal added here is
   * a table with no party on it.
   *
   * THE PARTY KEEPS ITS IDENTITY. Only `state` and `updated_at` are in the SET
   * list: `seated_at` is the turn timer's origin and a present-to-present change
   * is refused outright by `table_state_turn_timer_immutable`; `group_id` is what
   * makes a merged party ONE party. The whole group moves together, through the
   * same `group_id`-aware predicate `clear` uses, so advancing one table of a
   * merged party advances the party rather than leaving half of it behind.
   *
   * Idempotent by construction: a table already in the target state matches the
   * WHERE clause and returns its own row unchanged, so a waiter who taps twice is
   * not told off for it — the same shape `openTable` gives an already-open table.
   */
  private async transition(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    input: { tableId: string; state: 'ordered' | 'served' | 'awaiting_payment' },
  ): Promise<TableStateEntry[]> {
    const tables = await this.servingTables(client, merchantId, locationId);
    TableMapRepository.table(tables, input.tableId);
    const source = await this.lockState(client, merchantId, locationId, input.tableId);
    if (!source?.seated_at)
      throw new ConflictException({
        code: 'TABLE_NOT_OCCUPIED',
        message: 'There is no party on that table to serve.',
        fieldErrors: { tableId: [input.tableId] },
      });
    const changed = await client.query<StateRow>(
      `UPDATE merchant.table_state
         SET state=$5,updated_at=now()
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid
         AND ($3::uuid IS NULL AND table_id=$4::uuid OR group_id=$3::uuid)
         AND seated_at IS NOT NULL
       RETURNING ${STATE_COLUMNS}`,
      [merchantId, locationId, source.group_id, input.tableId, input.state],
    );
    return byTableId(changed.rows);
  }

  /** Food is in (`ordered`). See {@link transition} for the rules. */
  ordered(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    input: { tableId: string },
  ): Promise<TableStateEntry[]> {
    return this.transition(client, merchantId, locationId, { ...input, state: 'ordered' });
  }

  /** Food is out (`served`). See {@link transition} for the rules. */
  served(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    input: { tableId: string },
  ): Promise<TableStateEntry[]> {
    return this.transition(client, merchantId, locationId, { ...input, state: 'served' });
  }

  /** The bill has been asked for (`awaiting_payment`). See {@link transition}. */
  awaitingPayment(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    input: { tableId: string },
  ): Promise<TableStateEntry[]> {
    return this.transition(client, merchantId, locationId, {
      ...input,
      state: 'awaiting_payment',
    });
  }

  /**
   * Wipe done: `dirty` returns to `open`. Refused while a party is present (a
   * table cannot be wiped under one), and idempotent otherwise, so a waiter who
   * taps twice is not told off for it.
   */
  async openTable(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    input: { tableId: string },
  ): Promise<TableStateEntry[]> {
    const tables = await this.servingTables(client, merchantId, locationId);
    TableMapRepository.table(tables, input.tableId);
    const source = await this.lockState(client, merchantId, locationId, input.tableId);
    if (source?.seated_at) TableMapRepository.occupied(input.tableId);
    const opened = await client.query<StateRow>(
      `INSERT INTO merchant.table_state
         (merchant_id,location_id,table_id,state,seated_at,party_size,group_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'open',NULL,NULL,NULL)
       ON CONFLICT (merchant_id,location_id,table_id) DO UPDATE
         SET state='open',seated_at=NULL,party_size=NULL,group_id=NULL,updated_at=now()
         WHERE merchant.table_state.seated_at IS NULL
       RETURNING ${STATE_COLUMNS}`,
      [merchantId, locationId, input.tableId],
    );
    if (!opened.rows[0]) TableMapRepository.occupied(input.tableId);
    return [tableStateEntry(opened.rows[0])];
  }
}
