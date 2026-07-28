import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  ConflictClassification,
  OfficialCommitResult,
  OfflineCommand,
  ReplayResult,
} from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';

@Injectable()
export class PosOfflineRepository {
  constructor(private readonly pg: PgService) {}

  async acquireReplayLock(deviceId: string, credentialVersion: number) {
    const client = await this.pg.worker.connect();
    const key = `${deviceId}:${credentialVersion}`;
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
    return async () => {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
      } finally {
        client.release();
      }
    };
  }

  async context(input: {
    userId: string; deviceId: string; tenantId: string; branchId: string;
    operatorSessionId: string; credentialVersion: number;
  }) {
    const { rows } = await this.pg.worker.query<{
      lifecycle: string; credentialVersion: number; permissions: string[];
      entitlements: Array<{ featureKey?: string; enabled?: boolean }>;
      deviceKind: string; currency: string; lastAcceptedSequence: string;
    }>(
      `SELECT d.lifecycle_state AS lifecycle, d.credential_version AS "credentialVersion",
              os.permissions, os.entitlements, d.kind AS "deviceKind", b.currency,
              COALESCE(c.last_accepted_sequence, 0)::text AS "lastAcceptedSequence"
       FROM tenant.device d
       JOIN tenant.business b ON b.id=d.business_id
       JOIN runtime.operator_session os ON os.id=$5::uuid AND os.user_id=$1::uuid
        AND os.device_id=d.id AND os.business_id=$3::uuid AND os.branch_id=$4::uuid
        AND os.ended_at IS NULL AND os.expires_at > now()
       LEFT JOIN tenant.device_replay_cursor c
        ON c.device_id=d.id AND c.credential_version=$6
       WHERE d.id=$2::uuid AND d.business_id=$3::uuid
        AND (d.branch_id IS NULL OR d.branch_id=$4::uuid)`,
      [input.userId, input.deviceId, input.tenantId, input.branchId,
        input.operatorSessionId, input.credentialVersion],
    );
    return rows[0] ? {
      ...rows[0], lastAcceptedSequence: Number(rows[0].lastAcceptedSequence),
    } : null;
  }

  async policy(tenantId: string, branchId: string) {
    const { rows } = await this.pg.worker.query<{
      id: string; enabled: boolean; version: string; currency: string;
      issuedAt: Date; expiresAt: Date;
      maxPolicyAgeSeconds: number; maxSingleSaleMinorUnits: string;
      maxAccumulatedMinorUnits: string; maxOfflineSaleCount: number;
      maxActiveQueueDepth: number; maxCommandAgeSeconds: number;
      maxCatalogAgeSeconds: number; maxPricingAgeSeconds: number; maxTaxAgeSeconds: number;
      managerApprovalThresholdMinorUnits: string | null; allowedDeviceClasses: string[];
    }>(
      `SELECT id::text,enabled,version,currency,issued_at AS "issuedAt",expires_at AS "expiresAt",
              max_policy_age_seconds AS "maxPolicyAgeSeconds",
              max_single_sale_minor_units::text AS "maxSingleSaleMinorUnits",
              max_accumulated_minor_units::text AS "maxAccumulatedMinorUnits",
              max_offline_sale_count AS "maxOfflineSaleCount",
              max_active_queue_depth AS "maxActiveQueueDepth",
              max_command_age_seconds AS "maxCommandAgeSeconds",
              max_catalog_age_seconds AS "maxCatalogAgeSeconds",
              max_pricing_age_seconds AS "maxPricingAgeSeconds",
              max_tax_age_seconds AS "maxTaxAgeSeconds",
              manager_approval_threshold_minor_units::text AS "managerApprovalThresholdMinorUnits",
              allowed_device_classes AS "allowedDeviceClasses"
       FROM tenant.pos_offline_cash_policy
       WHERE business_id=$1::uuid AND branch_id=$2::uuid`,
      [tenantId, branchId],
    );
    return rows[0] ?? null;
  }

  async replay(
    command: OfflineCommand,
    officialCommit: OfficialCommitResult | null = null,
  ): Promise<ReplayResult> {
    const client = await this.pg.worker.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ fingerprint: string; result: ReplayResult }>(
        `SELECT fingerprint, result FROM tenant.offline_replay_command
         WHERE command_id=$1::uuid FOR SHARE`, [command.commandId],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        if (existing.rows[0].fingerprint !== command.fingerprint) {
          return this.recordConflict(command, 'fingerprint_mismatch', true);
        }
        return { ...existing.rows[0].result, status: 'duplicate' };
      }
      await client.query(
        `INSERT INTO tenant.device_replay_cursor
          (business_id,branch_id,device_id,credential_version)
         VALUES ($1,$2,$3,$4) ON CONFLICT (device_id,credential_version) DO NOTHING`,
        [command.tenantId, command.branchId, command.deviceId, command.deviceCredentialVersion],
      );
      const cursor = await client.query<{ last: string }>(
        `SELECT last_accepted_sequence::text AS last FROM tenant.device_replay_cursor
         WHERE device_id=$1::uuid AND credential_version=$2 FOR UPDATE`,
        [command.deviceId, command.deviceCredentialVersion],
      );
      const last = Number(cursor.rows[0]?.last ?? 0);
      if (command.deviceSequence !== last + 1) {
        await client.query('COMMIT');
        return this.recordConflict(
          command,
          command.deviceSequence <= last ? 'sequence_behind' : 'sequence_gap',
          true,
        );
      }
      const result: ReplayResult = {
        commandId: command.commandId, deviceSequence: command.deviceSequence,
        status: 'accepted', officialId: officialCommit?.officialSaleId ?? null,
        officialCommit, serverConflictReference: null, failure: null,
      };
      await client.query(
        `INSERT INTO tenant.offline_replay_command
         (business_id,branch_id,device_id,credential_version,device_sequence,command_id,
          operator_session_id,idempotency_key,command_type,fingerprint,contract_version,
          schema_version,client_created_at,result,provisional_id,payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [command.tenantId, command.branchId, command.deviceId, command.deviceCredentialVersion,
          command.deviceSequence, command.commandId, command.operatorSessionId,
          command.idempotencyKey, command.commandType, command.fingerprint,
          command.contractVersion, command.schemaVersion, command.createdAt,
          JSON.stringify(result), command.provisionalId, JSON.stringify(command.payload)],
      );
      await client.query(
        `UPDATE tenant.device_replay_cursor SET last_accepted_sequence=$3, updated_at=clock_timestamp()
         WHERE device_id=$1::uuid AND credential_version=$2`,
        [command.deviceId, command.deviceCredentialVersion, command.deviceSequence],
      );
      if (officialCommit && command.provisionalId) {
        await client.query(
          `INSERT INTO tenant.offline_provisional_mapping
            (business_id,branch_id,device_id,command_id,provisional_id,official_sale_id,
             official_receipt_id,official_receipt_number,reconciliation_reference)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (business_id,provisional_id) DO NOTHING`,
          [
            command.tenantId, command.branchId, command.deviceId, command.commandId,
            command.provisionalId, officialCommit.officialSaleId,
            officialCommit.officialReceiptId, officialCommit.officialReceiptNumber,
            officialCommit.reconciliationReference,
          ],
        );
        const mapping = await client.query<{ officialSaleId: string }>(
          `SELECT official_sale_id::text AS "officialSaleId"
           FROM tenant.offline_provisional_mapping
           WHERE business_id=$1 AND provisional_id=$2`,
          [command.tenantId, command.provisionalId],
        );
        if (mapping.rows[0]?.officialSaleId !== officialCommit.officialSaleId) {
          throw new Error('PROVISIONAL_MAPPING_CONFLICT');
        }
      }
      await client.query(
        `INSERT INTO tenant.audit_event
          (business_id,branch_id,command_id,event_type,entity_type,entity_id,outcome,
           public_data,correlation_id,event_hash)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'offline.replay.accepted',
          'offline_command',$3::uuid,'success',
          jsonb_build_object('commandType',$4::text,'deviceSequence',$5::bigint),$3::text,'')`,
        [
          command.tenantId, command.branchId, command.commandId,
          command.commandType, command.deviceSequence,
        ],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async cashExposure(
    tenantId: string,
    branchId: string,
    deviceId: string,
    policyFingerprint: string,
  ) {
    const { rows } = await this.pg.worker.query<{ count: string; amount: string }>(
      `SELECT count(*)::text AS count,
              COALESCE(sum((payload->'snapshot'->>'amountDueMinorUnits')::bigint),0)::text
                AS amount
       FROM tenant.offline_replay_command
       WHERE business_id=$1::uuid AND branch_id=$2::uuid AND device_id=$3::uuid
        AND command_type='pos.checkout.cash'
        AND payload->>'policyFingerprint'=$4`,
      [tenantId, branchId, deviceId, policyFingerprint],
    );
    return {
      count: Number(rows[0]?.count ?? 0),
      amount: Number(rows[0]?.amount ?? 0),
    };
  }

  async commandResult(
    tenantId: string,
    branchId: string,
    deviceId: string,
    credentialVersion: number,
    commandId: string,
  ) {
    const { rows } = await this.pg.worker.query<{ result: ReplayResult }>(
      `SELECT result FROM tenant.offline_replay_command
       WHERE business_id=$1::uuid AND branch_id=$2::uuid AND device_id=$3::uuid
        AND credential_version=$4 AND command_id=$5::uuid`,
      [tenantId, branchId, deviceId, credentialVersion, commandId],
    );
    return rows[0]?.result ?? null;
  }

  async diagnostics(tenantId: string, deviceId: string, credentialVersion: number) {
    const { rows } = await this.pg.worker.query<{
      lastAcceptedSequence: string; acceptedCount: string; lastReplayAt: Date | null;
    }>(
      `SELECT COALESCE(c.last_accepted_sequence,0)::text AS "lastAcceptedSequence",
              count(r.command_id)::text AS "acceptedCount", max(r.accepted_at) AS "lastReplayAt"
       FROM tenant.device_replay_cursor c
       LEFT JOIN tenant.offline_replay_command r ON r.device_id=c.device_id
        AND r.credential_version=c.credential_version
       WHERE c.business_id=$1::uuid AND c.device_id=$2::uuid AND c.credential_version=$3
       GROUP BY c.last_accepted_sequence`,
      [tenantId, deviceId, credentialVersion],
    );
    return rows[0] ?? { lastAcceptedSequence: '0', acceptedCount: '0', lastReplayAt: null };
  }

  async acknowledge(tenantId: string, deviceId: string, reconciliationId: string) {
    const result = await this.pg.worker.query(
      `UPDATE tenant.offline_reconciliation SET acknowledged_at=clock_timestamp()
       WHERE id=$1::uuid AND business_id=$2::uuid AND device_id=$3::uuid
        AND acknowledged_at IS NULL`,
      [reconciliationId, tenantId, deviceId],
    );
    return result.rowCount === 1;
  }

  async persistReconciliation(input: {
    tenantId: string;
    branchId: string;
    deviceId: string;
    credentialVersion: number;
    summary: Record<string, unknown>;
  }) {
    const id = randomUUID();
    await this.pg.worker.query(
      `INSERT INTO tenant.offline_reconciliation
        (id,business_id,branch_id,device_id,credential_version,summary)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        id, input.tenantId, input.branchId, input.deviceId,
        input.credentialVersion, JSON.stringify(input.summary),
      ],
    );
    return id;
  }

  async conflicts(tenantId: string, branchId: string, deviceId: string) {
    const { rows } = await this.pg.worker.query<{
      commandId: string; deviceSequence: string; classification: ConflictClassification;
      blocksFollowing: boolean; operatorActionRequired: boolean;
      managerActionRequired: boolean; guidanceCode: string; correlationId: string;
      officialId: string | null; id: string;
    }>(
      `SELECT command_id::text AS "commandId",device_sequence::text AS "deviceSequence",
              classification,blocks_following AS "blocksFollowing",
              operator_action_required AS "operatorActionRequired",
              manager_action_required AS "managerActionRequired",guidance_code AS "guidanceCode",
              correlation_id AS "correlationId",official_id::text AS "officialId",id::text
       FROM tenant.offline_replay_conflict
       WHERE business_id=$1::uuid AND branch_id=$2::uuid AND device_id=$3::uuid
        AND resolution_state <> 'resolved' ORDER BY device_sequence LIMIT 100`,
      [tenantId, branchId, deviceId],
    );
    return rows.map((row) => ({
      commandId: row.commandId,
      deviceSequence: Number(row.deviceSequence),
      status: 'conflict' as const,
      officialId: row.officialId,
      officialCommit: null,
      serverConflictReference: row.id,
      failure: {
        classification: row.classification,
        retryable: false,
        blocksFollowing: row.blocksFollowing,
        operatorActionRequired: row.operatorActionRequired,
        managerActionRequired: row.managerActionRequired,
        guidanceCode: row.guidanceCode,
        correlationId: row.correlationId,
      },
    }));
  }

  async mappings(tenantId: string, branchId: string, deviceId: string) {
    const { rows } = await this.pg.worker.query<{
      provisionalId: string; officialId: string; commandId: string;
    }>(
      `SELECT provisional_id::text AS "provisionalId",
              official_sale_id::text AS "officialId",
              command_id::text AS "commandId"
       FROM tenant.offline_provisional_mapping
       WHERE business_id=$1::uuid AND branch_id=$2::uuid AND device_id=$3::uuid
       ORDER BY mapped_at LIMIT 100`,
      [tenantId, branchId, deviceId],
    );
    return rows;
  }

  async audit(tenantId: string, branchId: string, deviceId: string) {
    const { rows } = await this.pg.worker.query<{
      eventCategory: string; occurredAt: Date; correlationId: string;
      commandReference: string | null; sequence: string; outcomeCode: string;
    }>(
      `SELECT a.event_type AS "eventCategory",a.occurred_at AS "occurredAt",
              a.correlation_id AS "correlationId",a.command_id::text AS "commandReference",
              COALESCE(a.public_data->>'deviceSequence','0') AS sequence,
              a.outcome AS "outcomeCode"
       FROM tenant.audit_event a
       WHERE a.business_id=$1::uuid AND a.branch_id=$2::uuid
        AND a.event_type LIKE 'offline.%'
        AND EXISTS (
          SELECT 1 FROM tenant.offline_replay_command c
          WHERE c.command_id=a.command_id AND c.device_id=$3::uuid
        )
       ORDER BY a.occurred_at DESC LIMIT 100`,
      [tenantId, branchId, deviceId],
    );
    return rows.map((row) => ({
      eventCategory: row.eventCategory,
      occurredAt: row.occurredAt.toISOString(),
      correlationId: row.correlationId,
      commandReference: row.commandReference,
      deviceReference: deviceId,
      sequence: Number(row.sequence),
      branchReference: branchId,
      outcomeCode: row.outcomeCode,
      resolutionStatus: 'recorded',
    }));
  }

  private conflict(
    command: OfflineCommand,
    classification: ConflictClassification,
    blocksFollowing: boolean,
  ): ReplayResult {
    return {
      commandId: command.commandId, deviceSequence: command.deviceSequence,
      status: 'conflict', officialId: null, officialCommit: null,
      serverConflictReference: null,
      failure: {
        classification,
        retryable: false, blocksFollowing, operatorActionRequired: true,
        managerActionRequired: false, guidanceCode: classification,
        correlationId: command.commandId,
      },
    };
  }

  async recordConflict(
    command: OfflineCommand,
    classification: ConflictClassification,
    blocksFollowing: boolean,
  ): Promise<ReplayResult> {
    const result = this.conflict(command, classification, blocksFollowing);
    const { rows } = await this.pg.worker.query<{ id: string }>(
      `INSERT INTO tenant.offline_replay_conflict
        (business_id,branch_id,device_id,command_id,device_sequence,classification,
         blocks_following,operator_action_required,manager_action_required,guidance_code,
         correlation_id,provisional_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,false,$6,$4::text,$8)
       ON CONFLICT (business_id,device_id,command_id) DO UPDATE
        SET last_observed_at=clock_timestamp()
       RETURNING id::text`,
      [
        command.tenantId, command.branchId, command.deviceId, command.commandId,
        command.deviceSequence, classification, blocksFollowing, command.provisionalId,
      ],
    );
    return { ...result, serverConflictReference: rows[0].id };
  }
}
