import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  TableStateChangeResult,
  TableStateMap,
  type ClearTableRequest,
  type MarkTableAwaitingPaymentRequest,
  type MarkTableOrderedRequest,
  type MarkTableServedRequest,
  type MergeTablesRequest,
  type MovePartyRequest,
  type OpenTableRequest,
  type PosTableStateQuery,
  type SeatTableRequest,
  type SplitPartyRequest,
  type TableStateEntry,
} from '@umi/contract';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { resolveLocationAuthority } from '../auth/location-authority';
import type { TransactionContext } from '../integrity/integrity.types';
import { IntegrityService } from '../integrity/integrity.service';
import { TableMapRepository } from './table-map.repository';

/**
 * The live state of the room (plan §8D, steps 3 to 5).
 *
 * Every write is an idempotent command, through the same integrity service the
 * rest of the platform's writes use. That is not ceremony here: a till that taps
 * "seat party of four" and loses its response must be able to retry, and without
 * the command journal the retry would either seat a second party (if the table
 * were free again) or come back as a refusal the operator cannot distinguish from
 * a real conflict. With it, the replay returns the first attempt's own result.
 *
 * The operations live in the repository because each one is a single transaction
 * whose refusals are decided by what the database currently holds — the service
 * only wraps them, checks the caller's authority, and writes the audit trail.
 */
@Injectable()
export class TableMapService {
  constructor(
    private readonly repo: TableMapRepository,
    private readonly integrity: IntegrityService,
  ) {}

  read(access: MerchantAccess, locationId: string) {
    resolveLocationAuthority(access, locationId);
    return this.repo.read(access.merchantId, locationId);
  }

  async readForPos(user: AuthUser, merchantId: string, query: PosTableStateQuery) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    return TableStateMap.parse(await this.repo.readForPos(user, merchantId, query));
  }

  seat(user: AuthUser, merchantId: string, dto: SeatTableRequest) {
    return this.command(
      user,
      merchantId,
      'table_state.seat',
      dto,
      (context) =>
        this.repo.seat(context.client, merchantId, dto.locationId, {
          tableId: dto.tableId,
          partySize: dto.partySize,
        }),
      { tableIds: [dto.tableId], partySize: dto.partySize },
    );
  }

  move(user: AuthUser, merchantId: string, dto: MovePartyRequest) {
    return this.command(
      user,
      merchantId,
      'table_state.move',
      dto,
      (context) =>
        this.repo.move(context.client, merchantId, dto.locationId, {
          fromTableId: dto.fromTableId,
          toTableId: dto.toTableId,
        }),
      { tableIds: [dto.fromTableId, dto.toTableId] },
    );
  }

  merge(user: AuthUser, merchantId: string, dto: MergeTablesRequest) {
    return this.command(
      user,
      merchantId,
      'table_state.merge',
      dto,
      (context) =>
        this.repo.merge(context.client, merchantId, dto.locationId, {
          tableIds: dto.tableIds,
          partySize: dto.partySize,
        }),
      { tableIds: dto.tableIds, partySize: dto.partySize },
    );
  }

  split(user: AuthUser, merchantId: string, dto: SplitPartyRequest) {
    return this.command(
      user,
      merchantId,
      'table_state.split',
      dto,
      (context) =>
        this.repo.split(context.client, merchantId, dto.locationId, { tableId: dto.tableId }),
      { tableIds: [dto.tableId] },
    );
  }

  clear(user: AuthUser, merchantId: string, dto: ClearTableRequest) {
    return this.command(
      user,
      merchantId,
      'table_state.clear',
      dto,
      (context) =>
        this.repo.clear(context.client, merchantId, dto.locationId, { tableId: dto.tableId }),
      { tableIds: [dto.tableId] },
    );
  }

  openTable(user: AuthUser, merchantId: string, dto: OpenTableRequest) {
    return this.command(
      user,
      merchantId,
      'table_state.open',
      dto,
      (context) =>
        this.repo.openTable(context.client, merchantId, dto.locationId, { tableId: dto.tableId }),
      { tableIds: [dto.tableId] },
    );
  }

  /**
   * The three service transitions (plan §8D step 5's remainder). Each is the
   * same command shape as `clear` and `open` — one table, one operator session,
   * one idempotency key — and each is its own route so a refusal names the
   * operation that was refused. The rules about which states may follow which
   * live in {@link TableMapRepository.ordered} and its siblings.
   */
  markOrdered(user: AuthUser, merchantId: string, dto: MarkTableOrderedRequest) {
    return this.command(
      user,
      merchantId,
      'table_state.ordered',
      dto,
      (context) =>
        this.repo.ordered(context.client, merchantId, dto.locationId, { tableId: dto.tableId }),
      { tableIds: [dto.tableId] },
    );
  }

  markServed(user: AuthUser, merchantId: string, dto: MarkTableServedRequest) {
    return this.command(
      user,
      merchantId,
      'table_state.served',
      dto,
      (context) =>
        this.repo.served(context.client, merchantId, dto.locationId, { tableId: dto.tableId }),
      { tableIds: [dto.tableId] },
    );
  }

  markAwaitingPayment(user: AuthUser, merchantId: string, dto: MarkTableAwaitingPaymentRequest) {
    return this.command(
      user,
      merchantId,
      'table_state.awaiting_payment',
      dto,
      (context) =>
        this.repo.awaitingPayment(context.client, merchantId, dto.locationId, {
          tableId: dto.tableId,
        }),
      { tableIds: [dto.tableId] },
    );
  }

  /**
   * One shape for every operation: prove the operator, do the work, record it,
   * and hand back the tables the command changed.
   *
   * A refusal thrown from the operation aborts the transaction — including the
   * command row — so a refused seat leaves no trace to replay and the operator's
   * retry re-runs the real check. That is the same behaviour the floor-plan
   * version conflict has, and it is deliberate: a refused command is not a
   * completed one.
   */
  private async command(
    user: AuthUser,
    merchantId: string,
    commandType: string,
    dto: { locationId: string; operatorSessionId: string; idempotencyKey: string },
    run: (context: TransactionContext) => Promise<TableStateEntry[]>,
    publicData: Record<string, unknown>,
  ): Promise<TableStateChangeResult> {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    const outcome = await this.integrity.execute<TableStateChangeResult>(
      {
        merchantId,
        locationId: dto.locationId,
        commandId: dto.idempotencyKey,
        idempotencyKey: dto.idempotencyKey,
        commandType,
        payload: dto,
      },
      async (context) => {
        await this.repo.assertOperator(
          context.client,
          user,
          merchantId,
          dto.locationId,
          dto.operatorSessionId,
        );
        const changed = await run(context);
        await context.appendAudit({
          eventType: `${commandType}.applied`,
          entityType: 'table_state',
          entityId: dto.locationId,
          outcome: 'success',
          publicData: { ...publicData, changed: changed.map((entry) => entry.tableId) },
        });
        return {
          ok: true,
          value: {
            locationId: dto.locationId,
            commandId: context.commandId,
            changed,
            serverTime: new Date().toISOString(),
          },
        };
      },
    );
    if (outcome.status !== 'succeeded' || !outcome.result)
      throw new ConflictException({
        code: outcome.failureCode ?? 'CONFLICT',
        message: 'The table command did not complete.',
      });
    return TableStateChangeResult.parse(outcome.result);
  }
}
