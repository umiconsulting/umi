import { ConflictException, Injectable } from '@nestjs/common';
import type { PointOperatingMode } from '@umi/contract';
import type { PoolClient } from 'pg';
import { getRequestContext } from '../../shared/database/request-context';
import { PgService } from '../../shared/database/pg.service';

/**
 * WHICH REGISTER OWNS WHICH TERMINAL, AT REST — plan section 4 phase 5 step 3, and the only
 * code that reads or writes `merchant.device_point_terminal` (72_mp_point.sql section 4).
 *
 * WHAT THE TABLE GUARANTEES, AND WHY EVERY WRITE BELOW IS SHAPED BY IT. The migration states
 * two uniqueness rules as constraints rather than conventions: `unique (device_id)` is "a
 * register has one terminal" and `unique (merchant_id, terminal_id)` is "a terminal serves one
 * register of one merchant". Together they make a binding a MOVE rather than an addition, and
 * that is why `bind` cannot be one statement: pointing register B at the terminal that sits on
 * register A has to release B's previous terminal AND take the terminal away from A, and either
 * half alone collides with one of the two constraints. Both statements run in ONE transaction,
 * so a concurrent reader sees the before or the after and never a register holding two.
 *
 * THE FOREIGN KEYS DO THE PROVING, NOT THIS FILE. `(merchant_id, location_id, device_id)`
 * references `merchant.device(merchant_id, location_id, id)` and `(merchant_id, location_id)`
 * references `merchant.location(merchant_id, id)` in their composite forms (40_pos_hardware_
 * runtime and 65_table_reservation), so a device that belongs to another cafe, or to another
 * location of this one, is refused by the database. That is stronger than any check this layer
 * could make and it is why the body's `deviceId` and `locationId` are inserted as given instead
 * of being re-verified here.
 *
 * RLS IS THE ONE THING THE DATABASE WILL NOT DO FOR US, and `runScoped` is where it happens:
 * `PgService.runWithMerchant` sets the merchant — and, when there is one, the location — that
 * the `device_point_terminal_scope` policy reads, so a query issued with the wrong merchant
 * returns nothing rather than somebody else's terminal. The location is passed through from the
 * request context when the caller does not name one, exactly as `fiscal.repository.ts` does it.
 */

/** One register's terminal, as the row stores it. The vendor's ids are text, always. */
export interface PointTerminalBinding {
  readonly deviceId: string;
  readonly locationId: string;
  readonly terminalId: string;
  readonly storeId: string | null;
  readonly posId: string | null;
  readonly operatingMode: PointOperatingMode;
}

export interface PointTerminalBindingInput {
  readonly merchantId: string;
  readonly locationId: string;
  readonly deviceId: string;
  readonly terminalId: string;
  readonly storeId: string | null;
  readonly posId: string | null;
  readonly operatingMode: PointOperatingMode;
}

/** One row, named column by column, with the aliases the interfaces above expect. */
const ROW_COLUMNS = `device_id AS "deviceId",
                     location_id AS "locationId",
                     terminal_id AS "terminalId",
                     store_id AS "storeId",
                     pos_id AS "posId",
                     operating_mode AS "operatingMode"`;

type Row = PointTerminalBinding;

@Injectable()
export class PointTerminalRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * Every terminal this merchant has bound AT ONE LOCATION, or at every location when the
   * caller's own location is unknown.
   *
   * THE LIST IS THE VENDOR'S AND THIS IS THE ENRICHMENT, so this method is deliberately a plain
   * read of OUR rows: it does not try to be the source of which terminals exist (only
   * `GET /terminals/v1/list` can say that), and it does not filter out a row whose terminal has
   * left the vendor's account. The service joins the two, and the join is the one place where
   * "the cafe no longer owns this" is a fact.
   *
   * A LOCATION-NARROWED OPERATOR SEES FEWER BINDINGS, and that is the intended outcome rather
   * than a gap: the policy of 72_mp_point.sql narrows by location, so a terminal bound at a
   * branch the operator cannot see reads as unbound on their screen instead of leaking the
   * branch's register.
   */
  async list(merchantId: string, locationId: string | null): Promise<PointTerminalBinding[]> {
    // The caller's location when it has one — `bind`'s destination branch, or the session's own
    // when it is pinned — and the request's otherwise, so a pinned session reads only its branch
    // and an unpinned one reads the whole cafe.
    const scope = locationId ?? getRequestContext()?.locationId ?? null;
    return this.runScoped(merchantId, scope, async (client) => {
      const { rows } = await client.query<Row>(
        `SELECT ${ROW_COLUMNS}
           FROM merchant.device_point_terminal
          WHERE merchant_id=$1::uuid
          ORDER BY updated_at DESC`,
        [merchantId],
      );
      return rows;
    });
  }

  /**
   * This MERCHANT's row for one terminal, wherever it is bound.
   *
   * IT IS NOT LOCATION-SCOPED, deliberately — not even by the session's own location. Binding a
   * terminal that already serves another register of the same cafe is a MOVE, and the point of
   * sale such a move must reuse belongs to the TERMINAL rather than to the branch it happens to
   * sit at today; a lookup narrowed to the destination would miss the row and create a second
   * point of sale for one terminal, which is the vendor's own 412.
   */
  async find(merchantId: string, terminalId: string): Promise<PointTerminalBinding | null> {
    return this.runScoped(merchantId, null, async (client) => {
      const { rows } = await client.query<Row>(
        `SELECT ${ROW_COLUMNS}
           FROM merchant.device_point_terminal
          WHERE merchant_id=$1::uuid AND terminal_id=$2::text`,
        [merchantId, terminalId],
      );
      return rows[0] ?? null;
    });
  }

  /**
   * The store id this merchant's terminals already sit under, if any of them knows one.
   *
   * WHY ASK THE ROWS INSTEAD OF THE VENDOR. The store is a fact about the ACCOUNT and it is
   * created once (`POST /users/{id}/stores`, step 4); a second terminal of the same cafe belongs
   * in the store the first one is already in, and re-creating it would produce a second store
   * for one address. The vendor's list stays the source of truth for the terminal's own
   * attachment — this value only fills in the `store_id` a new point of sale must name, which is
   * why the search is merchant-wide rather than narrowed to the branch being bound.
   */
  async merchantStoreId(merchantId: string): Promise<string | null> {
    return this.runScoped(merchantId, null, async (client) => {
      const { rows } = await client.query<{ storeId: string }>(
        `SELECT store_id AS "storeId"
           FROM merchant.device_point_terminal
          WHERE merchant_id=$1::uuid AND store_id IS NOT NULL
          ORDER BY updated_at DESC
          LIMIT 1`,
        [merchantId],
      );
      return rows[0]?.storeId ?? null;
    });
  }

  /**
   * POINT THIS REGISTER AT THIS TERMINAL — the two statements the two unique constraints force,
   * in one transaction.
   *
   * THE `DELETE` IS NOT TIDINESS. `device_point_terminal_device_uq` says one register holds one
   * terminal, so if this register was already pointing somewhere else, that row has to go before
   * the insert or the insert fails on the device. It is scoped to the merchant and to the device
   * and it spares the terminal being bound, so it can only ever remove a binding this register
   * itself is giving up.
   *
   * THE `ON CONFLICT` IS THE TERMINAL MOVING. `device_point_terminal_terminal_uq` says one
   * terminal serves one register, so when the terminal already exists for this merchant the row
   * is UPDATED — including its device and location — rather than duplicated. `updated_at` is set
   * here because the touch trigger of 72_mp_point.sql fires on UPDATE and the INSERT path needs
   * the same treatment; the column is in the insert for the same reason.
   *
   * THE MODE COMES FROM THE CALLER, AND THE CALLER GOT IT FROM THE VENDOR. It is written as
   * given because the service only reaches this method after `PATCH /terminals/v1/setup`
   * answered 200, so the value written is the mode the account confirmed rather than the mode we
   * hoped for.
   *
   * A UNIQUE VIOLATION IS TRANSLATED. The two constraints above are checked by the database and
   * the delete-then-upsert pair closes both, so a `23505` reaching here means a concurrent bind
   * decided differently in the same instant. It is named
   * (`MP_POINT_TERMINAL_BINDING_CONFLICT`) rather than surfaced as a driver error with a
   * constraint name in it, because the operator's next move — re-read the screen — is different
   * from "something went wrong".
   */
  async bind(input: PointTerminalBindingInput): Promise<PointTerminalBinding> {
    return this.runScoped(input.merchantId, input.locationId, async (client) => {
      try {
        await client.query(
          `DELETE FROM merchant.device_point_terminal
             WHERE merchant_id=$1::uuid
               AND device_id=$2::uuid
               AND terminal_id<>$3::text`,
          [input.merchantId, input.deviceId, input.terminalId],
        );

        const { rows } = await client.query<Row>(
          `INSERT INTO merchant.device_point_terminal
             (merchant_id, device_id, location_id, terminal_id, store_id, pos_id,
              operating_mode, created_at, updated_at)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,
                   clock_timestamp(), clock_timestamp())
           ON CONFLICT (merchant_id, terminal_id) DO UPDATE SET
             device_id=excluded.device_id,
             location_id=excluded.location_id,
             store_id=excluded.store_id,
             pos_id=excluded.pos_id,
             operating_mode=excluded.operating_mode,
             updated_at=clock_timestamp()
           RETURNING ${ROW_COLUMNS}`,
          [
            input.merchantId,
            input.deviceId,
            input.locationId,
            input.terminalId,
            input.storeId,
            input.posId,
            input.operatingMode,
          ],
        );
        const row = rows[0];
        if (row === undefined) {
          // A write that returned no row is not a success we can describe, and the caller's
          // response is built from this row.
          throw new ConflictException({ code: 'MP_POINT_TERMINAL_BINDING_CONFLICT' });
        }
        return row;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ code: 'MP_POINT_TERMINAL_BINDING_CONFLICT' });
        }
        throw error;
      }
    });
  }

  /**
   * RELEASE THE REGISTER'S CLAIM ON ONE TERMINAL, and hand back the row that was released.
   *
   * WHICH MERCHANT, WHICH TERMINAL, AND NO LOCATION — and that asymmetry with `bind` is the
   * route table's own: `mpPoint.terminalUnbind` declares no location context, because the
   * operator who knows a terminal should stop being bound may be looking at it from anywhere.
   * The scope still comes from the merchant, so this can only ever delete this cafe's row.
   *
   * IT IS MERCHANT-WIDE, and that is the route table's own shape rather than an oversight:
   * `mpPoint.terminalUnbind` declares no location context, so an operator who knows a terminal
   * should stop being bound may release it from anywhere. The RLS scope still comes from the
   * merchant, so this can only ever delete this cafe's row.
   *
   * THE ROW IS RETURNED RATHER THAN A COUNT. Unbinding is idempotent at the HTTP level — asking
   * twice is asking the same question — but the ANSWER to the first ask is the binding that was
   * there (its store and point of sale ids included), and a caller that received only a count
   * would have to guess them. A second ask finds no row and returns null, which is the honest
   * answer to "there is nothing there to release".
   *
   * NOTHING IS SENT TO THE VENDOR ON THIS PATH. Unbinding a register is our bookkeeping about
   * which till offers the card method; the terminal's `operating_mode` is the ACCOUNT's state and
   * leaving a terminal in `PDV` because a register stopped using it would be switching the
   * counter's mode behind the operator, which is not this route's job.
   */
  async unbind(merchantId: string, terminalId: string): Promise<PointTerminalBinding | null> {
    return this.runScoped(merchantId, null, async (client) => {
      const { rows } = await client.query<Row>(
        `DELETE FROM merchant.device_point_terminal
          WHERE merchant_id=$1::uuid AND terminal_id=$2::text
        RETURNING ${ROW_COLUMNS}`,
        [merchantId, terminalId],
      );
      return rows[0] ?? null;
    });
  }

  /**
   * ONE TRANSACTION, ONE SCOPE, AND THE CALLER SAYS WHICH. This is a plain pass-through on
   * purpose: `null` is a MERCHANT-WIDE scope in `PgService` (it sets `app.current_location` to
   * the empty string, which is the migration's `current_location() is null` branch), and a value
   * narrows the policy to it. A fallback to the session's own location hidden in here would make
   * `find` and `unbind` impossible to keep merchant-wide, so the one caller that wants the
   * session's location asks for it explicitly.
   */
  private runScoped<T>(
    merchantId: string,
    locationId: string | null,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.pg.runWithMerchant(
      merchantId,
      getRequestContext()?.userId ?? null,
      work,
      locationId,
    );
  }
}

/** The two constraints this file's insert can collide with, as one predicate. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
  );
}
