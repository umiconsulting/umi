import type { PoolClient } from 'pg';

export type FailureClass =
  'validation' | 'authorization' | 'conflict' | 'transient' | 'permanent' | 'unknown_outcome';

export interface CommandInput {
  merchantId: string;
  locationId: string | null;
  commandId: string;
  idempotencyKey: string;
  commandType: string;
  payload: unknown;
  expectedVersion?: number;
  correlationId: string;
}

export interface CommandResult<T> {
  commandId: string;
  status: 'succeeded' | 'failed';
  duplicate: boolean;
  retryable: boolean;
  result: T | null;
  failureCode: string | null;
  failureClass: FailureClass | null;
  correlationId: string;
}

export interface AuditAppend {
  eventType: string;
  entityType: string;
  entityId?: string | null;
  outcome: 'success' | 'denied' | 'failure';
  reasonCode?: string | null;
  publicData?: Record<string, unknown>;
  internalMetadata?: Record<string, unknown>;
}

export interface FinancialAppend {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  amountMinorUnits: number;
  currency: string;
  compensatesEventId?: string | null;
  publicData?: Record<string, unknown>;
}

export interface TransactionContext {
  client: PoolClient;
  commandId: string;
  correlationId: string;
  claimVersion(
    aggregateType: string,
    aggregateId: string,
    expectedVersion: number,
  ): Promise<number>;
  appendAudit(event: AuditAppend): Promise<string>;
  appendFinancial(event: FinancialAppend, expectedVersion: number): Promise<string>;
}

export interface BusinessFailure {
  ok: false;
  code: string;
  failureClass: FailureClass;
  retryable: boolean;
}

export interface BusinessSuccess<T> {
  ok: true;
  value: T;
}

export type BusinessOutcome<T> = BusinessSuccess<T> | BusinessFailure;
