import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PgService } from '../../shared/database/pg.service';
import type { DeviceSummary } from '@umi/contract';

type ChallengeRow = {
  id: string;
  businessId: string;
  branchId: string | null;
  displayName: string;
  deviceKind: 'kds' | 'pos_terminal';
  platform: 'android' | 'ios' | 'linux' | 'macos' | 'windows' | 'web';
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  replacesDeviceId: string | null;
};

const DEVICE_PROJECTION = `
  d.id::text,
  d.public_id::text AS "publicId",
  d.business_id::text AS "tenantId",
  d.branch_id::text AS "branchId",
  d.name AS "displayName",
  d.kind AS type,
  d.platform,
  d.lifecycle_state AS state,
  d.credential_version AS "credentialVersion",
  d.last_seen_at AS "lastSeenAt",
  (d.lifecycle_state = 'rotation_required') AS "rotationRequired",
  d.revoked_at AS "revokedAt",
  d.replacement_device_id::text AS "replacementDeviceId"`;

@Injectable()
export class DevicesRepository {
  constructor(private readonly pg: PgService) {}

  async beginEnrollment(input: {
    id: string;
    tenantId: string;
    branchId: string | null;
    displayName: string;
    type: 'kds' | 'pos_terminal';
    platform: ChallengeRow['platform'];
    codeHash: string;
    idempotencyKey: string;
    expiresAt: Date;
    actorUserId: string;
    replacesDeviceId?: string | null;
  }): Promise<{ id: string; expiresAt: Date }> {
    const { rows } = await this.pg.worker.query<{ id: string; expiresAt: Date }>(
      `INSERT INTO runtime.device_enrollment_challenge
         (id, business_id, branch_id, display_name, device_kind, platform, code_hash,
          idempotency_key, expires_at, created_by, replaces_device_id)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::uuid, $9, $10::uuid, $11::uuid
       WHERE $3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM tenant.branch
         WHERE id = $3::uuid AND business_id = $2::uuid AND status = 'active'
       )
       ON CONFLICT (business_id, idempotency_key) DO UPDATE
         SET idempotency_key = excluded.idempotency_key
       RETURNING id::text, expires_at AS "expiresAt"`,
      [
        input.id,
        input.tenantId,
        input.branchId,
        input.displayName,
        input.type,
        input.platform,
        input.codeHash,
        input.idempotencyKey,
        input.expiresAt,
        input.actorUserId,
        input.replacesDeviceId ?? null,
      ],
    );
    if (!rows[0]) throw new Error('branch_not_allowed');
    return rows[0];
  }

  async completeEnrollment(input: {
    challengeId: string;
    codeHash: string;
    installationHash: string;
    credentialHash: string;
  }): Promise<DeviceSummary | 'expired' | 'rejected' | 'attempts_exceeded'> {
    const client = await this.pg.worker.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<ChallengeRow>(
        `SELECT id::text, business_id::text AS "businessId", branch_id::text AS "branchId",
                display_name AS "displayName", device_kind AS "deviceKind", platform,
                code_hash AS "codeHash", expires_at AS "expiresAt", attempts,
                consumed_at AS "consumedAt", replaces_device_id::text AS "replacesDeviceId"
         FROM runtime.device_enrollment_challenge
         WHERE id = $1::uuid FOR UPDATE`,
        [input.challengeId],
      );
      const challenge = result.rows[0];
      if (!challenge || challenge.consumedAt) {
        await client.query('ROLLBACK');
        return 'rejected';
      }
      if (challenge.expiresAt.getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        return 'expired';
      }
      if (challenge.attempts >= 5) {
        await client.query('ROLLBACK');
        return 'attempts_exceeded';
      }
      if (challenge.codeHash !== input.codeHash) {
        await client.query(
          `UPDATE runtime.device_enrollment_challenge
           SET attempts = least(attempts + 1, 5) WHERE id = $1::uuid`,
          [input.challengeId],
        );
        await client.query('COMMIT');
        return challenge.attempts + 1 >= 5 ? 'attempts_exceeded' : 'rejected';
      }
      const inserted = await client.query<DeviceSummary>(
        `INSERT INTO tenant.device AS d
           (business_id, branch_id, name, kind, status, platform, lifecycle_state,
            installation_hash, credential_hash, credential_version)
         VALUES ($1::uuid, $2::uuid, $3, $4, 'active', $5, 'active', $6, $7, 1)
         RETURNING ${DEVICE_PROJECTION}`,
        [
          challenge.businessId,
          challenge.branchId,
          challenge.displayName,
          challenge.deviceKind,
          challenge.platform,
          input.installationHash,
          input.credentialHash,
        ],
      );
      await client.query(
        `UPDATE runtime.device_enrollment_challenge SET consumed_at = now() WHERE id = $1::uuid`,
        [input.challengeId],
      );
      if (challenge.replacesDeviceId) {
        await client.query(
          `UPDATE tenant.device
           SET lifecycle_state = 'replaced', status = 'retired', revoked_at = now(),
               revocation_reason = 'replaced', replacement_device_id = $2::uuid,
               credential_hash = null, updated_at = now()
           WHERE id = $1::uuid AND business_id = $3::uuid
             AND lifecycle_state NOT IN ('revoked','replaced')`,
          [challenge.replacesDeviceId, inserted.rows[0].id, challenge.businessId],
        );
      }
      await client.query(
        `INSERT INTO runtime.security_audit_event
           (actor_user_id, business_id, branch_id, event_type, entity_type, entity_id, outcome)
         SELECT created_by, business_id, branch_id, 'device.enrollment_completed',
                'device', $2::uuid, 'success'
         FROM runtime.device_enrollment_challenge WHERE id = $1::uuid`,
        [input.challengeId, inserted.rows[0].id],
      );
      await client.query('COMMIT');
      return inserted.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async authenticate(
    publicId: string,
    installationHash: string,
    credentialHash: string,
  ): Promise<DeviceSummary | null> {
    const { rows } = await this.pg.worker.query<DeviceSummary>(
      `UPDATE tenant.device AS d SET last_seen_at = now(), updated_at = now()
       WHERE d.public_id = $1::uuid
         AND d.installation_hash = $2
         AND d.credential_hash = $3
         AND d.lifecycle_state IN ('active','rotation_required')
         AND d.status = 'active'
       RETURNING ${DEVICE_PROJECTION}`,
      [publicId, installationHash, credentialHash],
    );
    return rows[0] ?? null;
  }

  async rotate(
    client: PoolClient,
    tenantId: string,
    deviceId: string,
    currentVersion: number,
    credentialHash: string,
  ): Promise<DeviceSummary | null> {
    const { rows } = await client.query<DeviceSummary>(
      `UPDATE tenant.device AS d
         SET credential_hash = $4, credential_version = credential_version + 1,
             lifecycle_state = 'active', updated_at = now()
         WHERE id = $2::uuid AND business_id = $1::uuid
           AND credential_version = $3 AND lifecycle_state IN ('active','rotation_required')
       RETURNING ${DEVICE_PROJECTION}`,
      [tenantId, deviceId, currentVersion, credentialHash],
    );
    return rows[0] ?? null;
  }

  async revoke(
    client: PoolClient,
    tenantId: string,
    deviceId: string,
    reason: string,
  ): Promise<DeviceSummary | null> {
    const { rows } = await client.query<DeviceSummary>(
      `UPDATE tenant.device AS d
         SET lifecycle_state = 'revoked', status = 'retired', revoked_at = now(),
             revocation_reason = $3, credential_hash = null, updated_at = now()
         WHERE id = $2::uuid AND business_id = $1::uuid
           AND lifecycle_state NOT IN ('revoked','replaced')
       RETURNING ${DEVICE_PROJECTION}`,
      [tenantId, deviceId, reason],
    );
    return rows[0] ?? null;
  }
}
