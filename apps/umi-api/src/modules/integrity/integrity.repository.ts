import { ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PgService } from '../../shared/database/pg.service';
import type {
  AuditAppend,
  CommandInput,
  CommandResult,
  FailureClass,
  FinancialAppend,
} from './integrity.types';
import { redactObject } from './canonical-json';

interface CommandRow {
  commandId: string;
  fingerprint: string;
  status: 'processing' | 'succeeded' | 'failed';
  responseData: unknown;
  failureCode: string | null;
  retryable: boolean;
  correlationId: string;
}

export interface AuditSearch {
  limit: number;
  before?: string;
  eventType?: string;
  entityType?: string;
  entityId?: string;
  correlationId?: string;
}

@Injectable()
export class IntegrityRepository {
  constructor(private readonly pg: PgService) {}

  transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.pg.withMerchant(work);
  }

  async claimCommand(
    client: PoolClient,
    input: CommandInput,
    fingerprint: string,
  ): Promise<{ owner: boolean; row: CommandRow }> {
    const inserted = await client.query<CommandRow>(
      `INSERT INTO merchant.business_command
         (merchant_id, location_id, command_id, idempotency_key, command_type, fingerprint,
          status, expected_version, correlation_id, expires_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'processing', $7, $8,
               now() + interval '30 days')
       ON CONFLICT (merchant_id, idempotency_key) DO NOTHING
       RETURNING command_id::text AS "commandId", fingerprint, status,
                 response_data AS "responseData", failure_code AS "failureCode",
                 retryable, correlation_id AS "correlationId"`,
      [
        input.merchantId,
        input.locationId,
        input.commandId,
        input.idempotencyKey,
        input.commandType,
        fingerprint,
        input.expectedVersion ?? null,
        input.correlationId,
      ],
    );
    if (inserted.rows[0]) return { owner: true, row: inserted.rows[0] };

    const existing = await client.query<CommandRow>(
      `SELECT command_id::text AS "commandId", fingerprint, status,
              response_data AS "responseData", failure_code AS "failureCode",
              retryable, correlation_id AS "correlationId"
       FROM merchant.business_command
       WHERE merchant_id = $1::uuid AND idempotency_key = $2
       FOR UPDATE`,
      [input.merchantId, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) throw new Error('command_claim_missing');
    if (row.fingerprint !== fingerprint) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'The idempotency key belongs to a different command fingerprint.',
      });
    }
    if (row.status === 'failed' && row.retryable) {
      const reset = await client.query<CommandRow>(
        `UPDATE merchant.business_command
         SET status = 'processing', response_data = NULL, failure_code = NULL,
             retryable = false, completed_at = NULL, correlation_id = $3
         WHERE merchant_id = $1::uuid AND idempotency_key = $2
         RETURNING command_id::text AS "commandId", fingerprint, status,
                   response_data AS "responseData", failure_code AS "failureCode",
                   retryable, correlation_id AS "correlationId"`,
        [input.merchantId, input.idempotencyKey, input.correlationId],
      );
      return { owner: true, row: reset.rows[0] };
    }
    return { owner: false, row };
  }

  async getCommand(
    client: PoolClient,
    merchantId: string,
    idempotencyKey: string,
  ): Promise<CommandRow> {
    const result = await client.query<CommandRow>(
      `SELECT command_id::text AS "commandId", fingerprint, status,
              response_data AS "responseData", failure_code AS "failureCode",
              retryable, correlation_id AS "correlationId"
       FROM merchant.business_command
       WHERE merchant_id = $1::uuid AND idempotency_key = $2`,
      [merchantId, idempotencyKey],
    );
    if (!result.rows[0]) throw new Error('command_result_missing');
    return result.rows[0];
  }

  async succeed<T>(
    client: PoolClient,
    merchantId: string,
    idempotencyKey: string,
    value: T,
  ): Promise<void> {
    await client.query(
      `UPDATE merchant.business_command
       SET status = 'succeeded', response_data = $3, completed_at = now()
       WHERE merchant_id = $1::uuid AND idempotency_key = $2 AND status = 'processing'`,
      [merchantId, idempotencyKey, redactObject(value)],
    );
  }

  async fail(
    client: PoolClient,
    merchantId: string,
    idempotencyKey: string,
    code: string,
    failureClass: FailureClass,
    retryable: boolean,
  ): Promise<void> {
    await client.query(
      `UPDATE merchant.business_command
       SET status = 'failed', failure_code = $3, retryable = $4,
           response_data = jsonb_build_object('failureClass', $5::text), completed_at = now()
       WHERE merchant_id = $1::uuid AND idempotency_key = $2 AND status = 'processing'`,
      [merchantId, idempotencyKey, code, retryable, failureClass],
    );
  }

  result<T>(row: CommandRow, duplicate: boolean): CommandResult<T> {
    const failureClass =
      row.status === 'failed' &&
      row.responseData &&
      typeof row.responseData === 'object' &&
      'failureClass' in row.responseData
        ? (String(row.responseData.failureClass) as FailureClass)
        : null;
    return {
      commandId: row.commandId,
      status: row.status === 'succeeded' ? 'succeeded' : 'failed',
      duplicate,
      retryable: row.retryable,
      result: row.status === 'succeeded' ? (row.responseData as T) : null,
      failureCode: row.failureCode,
      failureClass,
      correlationId: row.correlationId,
    };
  }

  async claimVersion(
    client: PoolClient,
    merchantId: string,
    aggregateType: string,
    aggregateId: string,
    expectedVersion: number,
  ): Promise<number> {
    await client.query(
      `INSERT INTO merchant.aggregate_version
         (merchant_id, aggregate_type, aggregate_id, version)
       VALUES ($1::uuid, $2, $3::uuid, 0)
       ON CONFLICT DO NOTHING`,
      [merchantId, aggregateType, aggregateId],
    );
    const updated = await client.query<{ version: string }>(
      `UPDATE merchant.aggregate_version
       SET version = version + 1, updated_at = now()
       WHERE merchant_id = $1::uuid AND aggregate_type = $2
         AND aggregate_id = $3::uuid AND version = $4
       RETURNING version::text`,
      [merchantId, aggregateType, aggregateId, expectedVersion],
    );
    if (!updated.rows[0]) {
      throw new ConflictException({
        code: 'OPTIMISTIC_VERSION_CONFLICT',
        message: 'The aggregate version changed.',
      });
    }
    return Number(updated.rows[0].version);
  }

  async appendAudit(
    client: PoolClient,
    input: CommandInput,
    actorUserId: string | null,
    event: AuditAppend,
  ): Promise<string> {
    const audit = await client.query<{ id: string }>(
      `INSERT INTO merchant.audit_event
         (merchant_id, location_id, actor_user_id, command_id, event_type, entity_type,
          entity_id, outcome, reason_code, public_data, correlation_id, event_hash)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::uuid, $8, $9, $10, $11, '')
       RETURNING id::text`,
      [
        input.merchantId,
        input.locationId,
        actorUserId,
        input.commandId,
        event.eventType,
        event.entityType,
        event.entityId ?? null,
        event.outcome,
        event.reasonCode ?? null,
        redactObject(event.publicData ?? {}),
        input.correlationId,
      ],
    );
    const id = audit.rows[0].id;
    await client.query(
      `INSERT INTO runtime.audit_event_internal (audit_event_id, merchant_id, metadata)
       VALUES ($1::uuid, $2::uuid, $3)`,
      [id, input.merchantId, redactObject(event.internalMetadata ?? {})],
    );
    return id;
  }

  async appendFinancial(
    client: PoolClient,
    input: CommandInput,
    event: FinancialAppend,
    aggregateVersion: number,
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO merchant.financial_event
         (merchant_id, location_id, command_id, aggregate_type, aggregate_id,
          aggregate_version, event_type, amount_minor_units, currency,
          compensates_event_id, public_data, correlation_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7, $8, $9,
               $10::uuid, $11, $12)
       RETURNING id::text`,
      [
        input.merchantId,
        input.locationId,
        input.commandId,
        event.aggregateType,
        event.aggregateId,
        aggregateVersion,
        event.eventType,
        event.amountMinorUnits,
        event.currency,
        event.compensatesEventId ?? null,
        redactObject(event.publicData ?? {}),
        input.correlationId,
      ],
    );
    return rows[0].id;
  }

  async searchAudit(merchantId: string, search: AuditSearch): Promise<unknown[]> {
    return this.pg.withMerchant(async (client) => {
      const { rows } = await client.query(
        `SELECT id::text, merchant_id::text AS "merchantId", location_id::text AS "locationId",
                event_type AS "eventType", entity_type AS "entityType",
                entity_id::text AS "entityId", outcome, reason_code AS "reasonCode",
                public_data AS data, correlation_id AS "correlationId",
                occurred_at::text AS "occurredAt"
         FROM merchant.audit_event
         WHERE merchant_id = $1::uuid
           AND ($2::timestamptz IS NULL OR occurred_at < $2::timestamptz)
           AND ($3::text IS NULL OR event_type = $3)
           AND ($4::text IS NULL OR entity_type = $4)
           AND ($5::uuid IS NULL OR entity_id = $5::uuid)
           AND ($6::text IS NULL OR correlation_id = $6)
         ORDER BY occurred_at DESC, id DESC
         LIMIT $7`,
        [
          merchantId,
          search.before ?? null,
          search.eventType ?? null,
          search.entityType ?? null,
          search.entityId ?? null,
          search.correlationId ?? null,
          search.limit,
        ],
      );
      return rows;
    });
  }
}
