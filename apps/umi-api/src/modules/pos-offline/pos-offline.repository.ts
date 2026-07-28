import { Injectable } from '@nestjs/common';
import type { ConflictClassification, OfflineCommand, ReplayResult } from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';

@Injectable()
export class PosOfflineRepository {
  constructor(private readonly pg: PgService) {}

  async context(input: {
    userId: string; deviceId: string; tenantId: string; branchId: string;
    operatorSessionId: string; credentialVersion: number;
  }) {
    const { rows } = await this.pg.worker.query<{
      lifecycle: string; credentialVersion: number; permissions: string[];
      lastAcceptedSequence: string;
    }>(
      `SELECT d.lifecycle_state AS lifecycle, d.credential_version AS "credentialVersion",
              os.permissions,
              COALESCE(c.last_accepted_sequence, 0)::text AS "lastAcceptedSequence"
       FROM tenant.device d
       JOIN tenant.operator_session os ON os.id=$5::uuid AND os.user_id=$1::uuid
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

  async policy(tenantId: string) {
    const { rows } = await this.pg.worker.query<{
      version: string; issuedAt: Date; expiresAt: Date; allowedCommandTypes: string[];
      maxQueueDepth: number; maxBatchSize: number; maxCommandAgeSeconds: number;
    }>(
      `SELECT version, issued_at AS "issuedAt", expires_at AS "expiresAt",
              allowed_command_types AS "allowedCommandTypes",
              max_queue_depth AS "maxQueueDepth", max_batch_size AS "maxBatchSize",
              max_command_age_seconds AS "maxCommandAgeSeconds"
       FROM tenant.pos_offline_policy WHERE business_id=$1::uuid`,
      [tenantId],
    );
    return rows[0] ?? {
      version: 'default-deny', issuedAt: new Date(), expiresAt: new Date(Date.now() + 3600000),
      allowedCommandTypes: ['operational.ack'], maxQueueDepth: 250,
      maxBatchSize: 20, maxCommandAgeSeconds: 86400,
    };
  }

  async replay(command: OfflineCommand): Promise<ReplayResult> {
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
          return this.conflict(command, 'fingerprint_mismatch', true);
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
        await client.query('ROLLBACK');
        return this.conflict(command, command.deviceSequence <= last ? 'sequence_behind' : 'sequence_gap', true);
      }
      const result: ReplayResult = {
        commandId: command.commandId, deviceSequence: command.deviceSequence,
        status: 'accepted', officialId: null, failure: null,
      };
      await client.query(
        `INSERT INTO tenant.offline_replay_command
         (business_id,branch_id,device_id,credential_version,device_sequence,command_id,
          operator_session_id,idempotency_key,command_type,fingerprint,contract_version,
          schema_version,client_created_at,result,provisional_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [command.tenantId, command.branchId, command.deviceId, command.deviceCredentialVersion,
          command.deviceSequence, command.commandId, command.operatorSessionId,
          command.idempotencyKey, command.commandType, command.fingerprint,
          command.contractVersion, command.schemaVersion, command.createdAt,
          JSON.stringify(result), command.provisionalId],
      );
      await client.query(
        `UPDATE tenant.device_replay_cursor SET last_accepted_sequence=$3, updated_at=clock_timestamp()
         WHERE device_id=$1::uuid AND credential_version=$2`,
        [command.deviceId, command.deviceCredentialVersion, command.deviceSequence],
      );
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

  async commandResult(tenantId: string, deviceId: string, commandId: string) {
    const { rows } = await this.pg.worker.query<{ result: ReplayResult }>(
      `SELECT result FROM tenant.offline_replay_command
       WHERE business_id=$1::uuid AND device_id=$2::uuid AND command_id=$3::uuid`,
      [tenantId, deviceId, commandId],
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

  private conflict(
    command: OfflineCommand,
    classification: ConflictClassification,
    blocksFollowing: boolean,
  ): ReplayResult {
    return {
      commandId: command.commandId, deviceSequence: command.deviceSequence,
      status: 'conflict', officialId: null,
      failure: {
        classification,
        retryable: false, blocksFollowing, operatorActionRequired: true,
        managerActionRequired: false, guidanceCode: classification,
        correlationId: command.commandId,
      },
    };
  }
}
