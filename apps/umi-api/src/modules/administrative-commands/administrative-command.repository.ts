import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

export interface AdministrativeCommandRow {
  id: string;
  fingerprint: string;
  status: 'pending' | 'succeeded' | 'failed' | 'unknown';
  result: unknown;
  failureCode: string | null;
  correlationId: string;
}

@Injectable()
export class AdministrativeCommandRepository {
  constructor(private readonly pg: PgService) {}

  async assertDashboardSession(userId: string, sessionId: string): Promise<boolean> {
    const { rows } = await this.pg.query<{ active: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM runtime.dashboard_session
          WHERE id=$1::uuid AND user_id=$2::uuid AND is_active AND expires_at>clock_timestamp()
       ) AS active`,
      [sessionId, userId],
    );
    return rows[0]?.active === true;
  }

  async findCommand(
    merchantId: string,
    commandId: string,
    idempotencyKey: string,
  ): Promise<{ fingerprint: string; status: string; result: unknown } | null> {
    const { rows } = await this.pg.query<{ fingerprint: string; status: string; result: unknown }>(
      `SELECT fingerprint,status,result
         FROM merchant.administrative_command
        WHERE merchant_id=$1::uuid AND (command_id=$2::uuid OR idempotency_key=$3::uuid)
        LIMIT 1`,
      [merchantId, commandId, idempotencyKey],
    );
    return rows[0] ?? null;
  }

  async claimCommand(input: {
    actorUserId: string;
    membershipId: string;
    merchantId: string;
    locationId: string | null;
    sessionId: string;
    operation: string;
    commandId: string;
    idempotencyKey: string;
    targetAggregateId: string;
    targetVersion: number | null;
    permission: string;
    approvalId: string | null;
    fingerprint: string;
    correlationId: string;
  }): Promise<{ owner: boolean; row: AdministrativeCommandRow }> {
    return this.pg.runWithMerchant(
      input.merchantId,
      input.actorUserId,
      async (client) => {
        const inserted = await client.query<AdministrativeCommandRow>(
          `INSERT INTO merchant.administrative_command
             (merchant_id,location_id,command_id,idempotency_key,operation,actor_user_id,
              membership_id,dashboard_session_id,target_aggregate_id,target_version,permission,
              approval_id,fingerprint,status,correlation_id)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7::uuid,$8::uuid,
                   $9::uuid,$10,$11,$12::uuid,$13,'pending',$14)
           ON CONFLICT DO NOTHING
           RETURNING id::text,fingerprint,status,result,failure_code AS "failureCode",
                     correlation_id AS "correlationId"`,
          [
            input.merchantId,
            input.locationId,
            input.commandId,
            input.idempotencyKey,
            input.operation,
            input.actorUserId,
            input.membershipId,
            input.sessionId,
            input.targetAggregateId,
            input.targetVersion,
            input.permission,
            input.approvalId,
            input.fingerprint,
            input.correlationId,
          ],
        );
        if (inserted.rows[0]) return { owner: true, row: inserted.rows[0] };
        const existing = await client.query<AdministrativeCommandRow>(
          `SELECT id::text,fingerprint,status,result,failure_code AS "failureCode",
                  correlation_id AS "correlationId"
             FROM merchant.administrative_command
            WHERE merchant_id=$1::uuid AND (command_id=$2::uuid OR idempotency_key=$3::uuid)
            FOR UPDATE`,
          [input.merchantId, input.commandId, input.idempotencyKey],
        );
        if (!existing.rows[0]) throw new Error('administrative_command_claim_missing');
        return { owner: false, row: existing.rows[0] };
      },
      input.locationId,
    );
  }

  async completeCommand(
    context: { actorUserId: string; merchantId: string; locationId: string | null },
    id: string,
    status: 'succeeded' | 'failed' | 'unknown',
    result: unknown,
    failureCode: string | null,
  ): Promise<void> {
    await this.pg.runWithMerchant(
      context.merchantId,
      context.actorUserId,
      (client) =>
        client.query(
          `UPDATE merchant.administrative_command
              SET status=$2,result=$3,failure_code=$4,completed_at=clock_timestamp()
            WHERE id=$1::uuid AND status='pending'`,
          [id, status, result ?? {}, failureCode],
        ),
      context.locationId,
    );
  }

  queryOriginalCommand(
    userId: string,
    merchantId: string,
    locationId: string | null,
    commandId: string,
  ) {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const result = await client.query<{
          commandId: string;
          commandType: string;
          idempotencyKey: string;
          status: string;
          retryable: boolean;
          failureCode: string | null;
          correlationId: string;
          createdAt: string;
          completedAt: string | null;
        }>(
          `SELECT command_id::text AS "commandId",command_type AS "commandType",idempotency_key AS "idempotencyKey",status,retryable,
                  failure_code AS "failureCode",correlation_id AS "correlationId",
                  started_at::text AS "createdAt",completed_at::text AS "completedAt"
             FROM merchant.business_command
            WHERE merchant_id=$1::uuid AND command_id=$2::uuid
              AND ($3::uuid IS NULL OR location_id=$3::uuid)`,
          [merchantId, commandId, locationId],
        );
        if (!result.rows[0]) throw new Error('COMMAND_NOT_FOUND');
        return result.rows[0];
      },
      locationId,
    );
  }

  configureRegister(input: {
    actorUserId: string;
    merchantId: string;
    locationId: string;
    registerId: string;
    expectedVersion: number;
    displayName?: unknown;
    assignmentPolicy?: unknown;
    assignedDeviceId?: unknown;
    enabled?: unknown;
  }) {
    return this.pg.runWithMerchant(
      input.merchantId,
      input.actorUserId,
      async (client) => {
        const current = await client.query<{
          version: number;
          displayName: string;
          assignmentPolicy: string;
          assignedDeviceId: string | null;
          status: string;
          currentShiftId: string | null;
        }>(
          `SELECT version,display_name AS "displayName",assignment_policy AS "assignmentPolicy",
                  assigned_device_id::text AS "assignedDeviceId",status,
                  current_shift_id::text AS "currentShiftId"
             FROM merchant.physical_register
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND id=$3::uuid
            FOR UPDATE`,
          [input.merchantId, input.locationId, input.registerId],
        );
        const row = current.rows[0];
        if (!row) throw new Error('REGISTER_NOT_FOUND');
        if (row.version !== input.expectedVersion) throw new Error('REGISTER_VERSION_STALE');
        const displayName = registerDisplayName(input.displayName, row.displayName);
        const assignmentPolicy = registerAssignmentPolicy(
          input.assignmentPolicy,
          row.assignmentPolicy,
        );
        const assignedDeviceId = registerDevice(input.assignedDeviceId, row.assignedDeviceId);
        if (assignedDeviceId) {
          const device = await client.query(
            `SELECT 1 FROM merchant.device
              WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND id=$3::uuid
                AND status='active'`,
            [input.merchantId, input.locationId, assignedDeviceId],
          );
          if (!device.rows[0]) throw new Error('REGISTER_DEVICE_SCOPE');
        }
        const enabled =
          typeof input.enabled === 'boolean' ? input.enabled : row.status !== 'suspended';
        if (!enabled && row.currentShiftId) throw new Error('REGISTER_SHIFT_OPEN');
        const result = await client.query(
          `UPDATE merchant.physical_register
              SET display_name=$4,assignment_policy=$5,assigned_device_id=$6::uuid,
                  status=CASE WHEN $7::boolean THEN
                    CASE WHEN status='suspended' THEN 'available' ELSE status END
                    ELSE 'suspended' END,
                  version=version+1
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND id=$3::uuid
            RETURNING id::text,display_name AS "displayName",public_reference AS "publicReference",
                      assignment_policy AS "assignmentPolicy",assigned_device_id::text AS "assignedDeviceId",
                      status,version`,
          [
            input.merchantId,
            input.locationId,
            input.registerId,
            displayName,
            assignmentPolicy,
            assignedDeviceId,
            enabled,
          ],
        );
        return result.rows[0];
      },
      input.locationId,
    );
  }
}

function registerDisplayName(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) {
    throw new Error('REGISTER_DISPLAY_NAME_INVALID');
  }
  return value.trim();
}

function registerAssignmentPolicy(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (value !== 'device_required' && value !== 'operator_selects') {
    throw new Error('REGISTER_ASSIGNMENT_POLICY_INVALID');
  }
  return value;
}

function registerDevice(value: unknown, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error('REGISTER_DEVICE_INVALID');
  }
  return value;
}
