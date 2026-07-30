import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import type { BranchAccess, EffectiveEntitlement, OperatorSessionView } from '@umi/contract';

export type EntryTenant = {
  id: string;
  name: string;
  roles: string[];
  permissions: string[];
  branches: BranchAccess[];
  entitlements: EffectiveEntitlement[];
};

@Injectable()
export class PosEntryRepository {
  constructor(private readonly pg: PgService) {}

  async entryContext(userId: string, deviceId: string): Promise<EntryTenant[]> {
    const { rows } = await this.pg.worker.query<{
      id: string;
      name: string;
      roles: string[];
      permissions: string[];
      branches: BranchAccess[];
      entitlements: EffectiveEntitlement[];
    }>(
      `SELECT b.id::text, b.name,
              COALESCE(array_agg(DISTINCT r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS roles,
              COALESCE(array_agg(DISTINCT p.key) FILTER (
                WHERE p.key IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM umi.user_permission_override up
                  WHERE up.user_id = $1::uuid AND up.permission_id = p.id
                    AND up.effect = 'deny'
                    AND (up.business_id IS NULL OR up.business_id = b.id)
                    AND (up.branch_id IS NULL OR up.branch_id = d.branch_id)
                    AND (up.expires_at IS NULL OR up.expires_at > now())
                )
              ), '{}') ||
              COALESCE((
                SELECT array_agg(DISTINCT p_allow.key)
                FROM umi.user_permission_override up_allow
                JOIN umi.permission p_allow ON p_allow.id = up_allow.permission_id
                WHERE up_allow.user_id = $1::uuid AND up_allow.effect = 'allow'
                  AND (up_allow.business_id IS NULL OR up_allow.business_id = b.id)
                  AND (up_allow.branch_id IS NULL OR up_allow.branch_id = d.branch_id)
                  AND (up_allow.expires_at IS NULL OR up_allow.expires_at > now())
                  AND NOT EXISTS (
                    SELECT 1 FROM umi.user_permission_override up_deny
                    WHERE up_deny.user_id = up_allow.user_id
                      AND up_deny.permission_id = up_allow.permission_id
                      AND up_deny.effect = 'deny'
                      AND (up_deny.business_id IS NULL OR up_deny.business_id = b.id)
                      AND (up_deny.branch_id IS NULL OR up_deny.branch_id = d.branch_id)
                      AND (up_deny.expires_at IS NULL OR up_deny.expires_at > now())
                  )
              ), '{}')
                AS permissions,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', br.id::text, 'tenantId', b.id::text, 'name', br.name,
                  'status', br.status,
                  'deviceAllowed', d.branch_id IS NULL OR d.branch_id = br.id,
                  'operatorAllowed', ur2.branch_id IS NULL OR ur2.branch_id = br.id
                ) ORDER BY br.name)
                FROM tenant.branch br
                LEFT JOIN umi.user_role ur2
                  ON ur2.user_id = $1::uuid AND ur2.business_id = b.id
                WHERE br.business_id = b.id AND br.status = 'active'
                  AND (d.branch_id IS NULL OR d.branch_id = br.id)
                  AND (ur2.branch_id IS NULL OR ur2.branch_id = br.id)
              ), '[]'::jsonb) AS branches,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'featureKey', ee.feature_key, 'enabled', ee.enabled,
                  'limit', ee.limit_value, 'subscriptionStatus', s.status
                ))
                FROM umi.effective_entitlement ee
                JOIN umi.subscription s ON s.business_id = ee.business_id
                WHERE ee.business_id = b.id
              ), '[]'::jsonb) AS entitlements
       FROM tenant.device d
       JOIN tenant.business b ON b.id = d.business_id AND b.status = 'active'
       JOIN umi.user_role ur ON ur.user_id = $1::uuid
         AND (ur.business_id = b.id OR ur.business_id IS NULL)
       JOIN umi.role r ON r.id = ur.role_id
       LEFT JOIN umi.role_permission rp ON rp.role_id = r.id
       LEFT JOIN umi.permission p ON p.id = rp.permission_id
       WHERE d.id = $2::uuid AND d.lifecycle_state = 'active'
       GROUP BY b.id, d.id`,
      [userId, deviceId],
    );
    return rows;
  }

  async startOperator(input: {
    durableSessionId: string;
    userId: string;
    deviceId: string;
    tenantId: string;
    branchId: string;
    expiresAt: Date;
  }): Promise<OperatorSessionView | null> {
    const { rows } = await this.pg.worker.query<OperatorSessionView>(
      `WITH authorized AS (
         SELECT s.id AS staff_id,
                COALESCE(array_agg(DISTINCT p.key) FILTER (
                  WHERE p.key IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM umi.user_permission_override up
                    WHERE up.user_id = $2::uuid AND up.permission_id = p.id
                      AND up.effect = 'deny'
                      AND (up.business_id IS NULL OR up.business_id = $4::uuid)
                      AND (up.branch_id IS NULL OR up.branch_id = $5::uuid)
                      AND (up.expires_at IS NULL OR up.expires_at > now())
                  )
                ), '{}') ||
                COALESCE((
                  SELECT array_agg(DISTINCT p_allow.key)
                  FROM umi.user_permission_override up_allow
                  JOIN umi.permission p_allow ON p_allow.id = up_allow.permission_id
                  WHERE up_allow.user_id = $2::uuid AND up_allow.effect = 'allow'
                    AND (up_allow.business_id IS NULL OR up_allow.business_id = $4::uuid)
                    AND (up_allow.branch_id IS NULL OR up_allow.branch_id = $5::uuid)
                    AND (up_allow.expires_at IS NULL OR up_allow.expires_at > now())
                    AND NOT EXISTS (
                      SELECT 1 FROM umi.user_permission_override up_deny
                      WHERE up_deny.user_id = up_allow.user_id
                        AND up_deny.permission_id = up_allow.permission_id
                        AND up_deny.effect = 'deny'
                        AND (up_deny.business_id IS NULL OR up_deny.business_id = $4::uuid)
                        AND (up_deny.branch_id IS NULL OR up_deny.branch_id = $5::uuid)
                        AND (up_deny.expires_at IS NULL OR up_deny.expires_at > now())
                    )
                ), '{}') perms,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'featureKey', ee.feature_key, 'enabled', ee.enabled,
                    'limit', ee.limit_value, 'subscriptionStatus', sub.status
                  ))
                  FROM umi.effective_entitlement ee
                  JOIN umi.subscription sub ON sub.business_id = ee.business_id
                  WHERE ee.business_id = $4::uuid
                ), '[]'::jsonb) ents
         FROM tenant.staff s
         JOIN tenant.device d ON d.id = $3::uuid AND d.business_id = s.business_id
         JOIN tenant.branch b ON b.id = $5::uuid AND b.business_id = s.business_id
         JOIN umi.user_role ur ON ur.user_id = s.user_id
           AND (ur.business_id = s.business_id OR ur.business_id IS NULL)
           AND (ur.branch_id IS NULL OR ur.branch_id = b.id)
         JOIN umi.role r ON r.id = ur.role_id
         LEFT JOIN umi.role_permission rp ON rp.role_id = r.id
         LEFT JOIN umi.permission p ON p.id = rp.permission_id
         WHERE s.user_id = $2::uuid AND s.business_id = $4::uuid
           AND s.status = 'active' AND b.status = 'active'
           AND d.lifecycle_state = 'active'
           AND (s.branch_id IS NULL OR s.branch_id = b.id)
           AND (d.branch_id IS NULL OR d.branch_id = b.id)
         GROUP BY s.id
       ), inserted AS (
         INSERT INTO runtime.operator_session
           (durable_session_id, user_id, staff_id, device_id, business_id, branch_id,
            permissions, entitlements, expires_at)
         SELECT $1::uuid, $2::uuid, staff_id, $3::uuid, $4::uuid, $5::uuid,
                perms, ents, $6 FROM authorized
         ON CONFLICT (durable_session_id) WHERE state IN ('active','locked')
         DO UPDATE SET last_activity_at = now()
         RETURNING *
       )
       SELECT id::text, user_id::text AS "userId", staff_id::text AS "staffId",
              business_id::text AS "tenantId", branch_id::text AS "branchId",
              device_id::text AS "deviceId", state, permissions, entitlements,
              started_at AS "startedAt", last_activity_at AS "lastActivityAt",
              expires_at AS "expiresAt"
       FROM inserted`,
      [
        input.durableSessionId,
        input.userId,
        input.deviceId,
        input.tenantId,
        input.branchId,
        input.expiresAt,
      ],
    );
    if (rows[0]) {
      await this.pg.worker.query(
        `INSERT INTO runtime.security_audit_event
           (actor_user_id, session_id, business_id, branch_id, event_type,
            entity_type, entity_id, outcome)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'operator.session_started',
                 'operator_session', $5::uuid, 'success')`,
        [input.userId, input.durableSessionId, input.tenantId, input.branchId, rows[0].id],
      );
    }
    return rows[0] ?? null;
  }

  async transition(
    id: string,
    durableSessionId: string,
    state: 'locked' | 'ended',
  ): Promise<boolean> {
    const { rowCount } = await this.pg.worker.query(
      `UPDATE runtime.operator_session
       SET state = $3, last_activity_at = now(),
           ended_at = CASE WHEN $3 = 'ended' THEN now() ELSE ended_at END
       WHERE id = $1::uuid AND durable_session_id = $2::uuid
         AND state <> 'ended'`,
      [id, durableSessionId, state],
    );
    const changed = (rowCount ?? 0) > 0;
    if (changed) {
      await this.pg.worker.query(
        `INSERT INTO runtime.security_audit_event
           (session_id, event_type, entity_type, entity_id, outcome)
         VALUES ($1::uuid, $3, 'operator_session', $2::uuid, 'success')`,
        [durableSessionId, id, `operator.${state}`],
      );
    }
    return changed;
  }

  async pinRecord(userId: string, tenantId: string) {
    const { rows } = await this.pg.worker.query<{
      staffId: string;
      salt: string | null;
      hash: string | null;
      attempts: number;
      lockedUntil: Date | null;
    }>(
      `SELECT id::text AS "staffId", operator_pin_salt AS salt,
              operator_pin_hash AS hash, pin_failed_attempts AS attempts,
              pin_locked_until AS "lockedUntil"
       FROM tenant.staff WHERE user_id = $1::uuid AND business_id = $2::uuid
         AND status = 'active' LIMIT 1`,
      [userId, tenantId],
    );
    return rows[0] ?? null;
  }

  async managerPinRecord(
    lookupHash: string,
    tenantId: string,
    branchId: string,
    permission: string,
    operatorSessionId: string,
  ) {
    const { rows } = await this.pg.worker.query<{
      staffId: string;
      userId: string;
      salt: string | null;
      hash: string | null;
      lockedUntil: Date | null;
    }>(
      `SELECT s.id::text AS "staffId",s.user_id::text AS "userId",
              s.operator_pin_salt AS salt,s.operator_pin_hash AS hash,
              s.pin_locked_until AS "lockedUntil"
       FROM tenant.staff s
       JOIN umi.user_role ur ON ur.user_id=s.user_id
         AND (ur.business_id=s.business_id OR ur.business_id IS NULL)
         AND (ur.branch_id IS NULL OR ur.branch_id=$3::uuid)
       JOIN umi.role r ON r.id=ur.role_id
       LEFT JOIN umi.role_permission rp ON rp.role_id=r.id
       LEFT JOIN umi.permission p ON p.id=rp.permission_id
       JOIN runtime.operator_session acting ON acting.id=$5::uuid
         AND acting.business_id=s.business_id AND acting.branch_id=$3::uuid
       WHERE s.business_id=$2::uuid AND (s.branch_id IS NULL OR s.branch_id=$3::uuid)
         AND s.operator_pin_lookup_hash=$1 AND s.status='active'
         AND acting.user_id<>s.user_id
         AND r.key IN ('owner','admin','manager','supervisor','super_admin')
         AND (p.key=$4 OR r.key='super_admin')
       LIMIT 1`,
      [lookupHash, tenantId, branchId, permission, operatorSessionId],
    );
    return rows[0] ?? null;
  }

  async recordPinFailure(staffId: string): Promise<void> {
    await this.pg.worker.query(
      `UPDATE tenant.staff
       SET pin_failed_attempts = least(pin_failed_attempts + 1, 10),
           pin_locked_until = CASE WHEN pin_failed_attempts + 1 >= 5
             THEN now() + interval '15 minutes' ELSE pin_locked_until END
       WHERE id = $1::uuid`,
      [staffId],
    );
  }

  async grantPinElevation(input: {
    staffId: string;
    sessionId: string;
    tenantId: string;
    branchId: string;
    permission: string;
    userId: string;
  }) {
    const { rows } = await this.pg.worker.query<{ id: string; expiresAt: Date }>(
      `WITH reset AS (
         UPDATE tenant.staff SET pin_failed_attempts = 0, pin_locked_until = null
         WHERE id = $1::uuid
       )
       INSERT INTO runtime.elevation_grant
         (session_id, business_id, branch_id, permission_key, method, approved_by, expires_at)
       VALUES ($2::uuid, $3::uuid, $4::uuid, $5, 'operator_pin', $6::uuid,
               now() + interval '5 minutes')
       RETURNING id::text, expires_at AS "expiresAt"`,
      [
        input.staffId,
        input.sessionId,
        input.tenantId,
        input.branchId,
        input.permission,
        input.userId,
      ],
    );
    if (rows[0]) {
      await this.pg.worker.query(
        `INSERT INTO runtime.security_audit_event
           (actor_user_id, session_id, business_id, branch_id, event_type,
            entity_type, entity_id, outcome, metadata)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'elevation.granted',
                 'elevation_grant', $5::uuid, 'success',
                 jsonb_build_object('method','operator_pin','permission',$6))`,
        [
          input.userId,
          input.sessionId,
          input.tenantId,
          input.branchId,
          rows[0].id,
          input.permission,
        ],
      );
    }
    return rows[0];
  }

  async grantManagerElevation(input: {
    managerUserId: string;
    managerStaffId: string;
    operatorSessionId: string;
    tenantId: string;
    branchId: string;
    permission: string;
    commandFingerprint: string | null;
  }) {
    const { rows } = await this.pg.worker.query<{ id: string; expiresAt: Date }>(
      `WITH manager_allowed AS (
         SELECT 1
         FROM umi.user_role ur
         JOIN umi.role r ON r.id = ur.role_id
         JOIN umi.role_permission rp ON rp.role_id = r.id
         JOIN umi.permission p ON p.id = rp.permission_id
         WHERE ur.user_id = $1::uuid
           AND (ur.business_id = $3::uuid OR ur.business_id IS NULL)
           AND (ur.branch_id IS NULL OR ur.branch_id = $4::uuid)
           AND r.key IN ('owner','admin','manager','supervisor','super_admin')
           AND (p.key = $5 OR r.key = 'super_admin')
       ), target AS (
         SELECT durable_session_id, user_id
         FROM runtime.operator_session
         WHERE id = $2::uuid AND business_id = $3::uuid AND branch_id = $4::uuid
           AND state = 'active' AND expires_at > now()
       ), reset AS (
         UPDATE tenant.staff SET pin_failed_attempts = 0, pin_locked_until = null
         WHERE id = $6::uuid
       )
       INSERT INTO runtime.elevation_grant
         (session_id, business_id, branch_id, permission_key, method, approved_by,
          expires_at,command_fingerprint)
       SELECT target.durable_session_id, $3::uuid, $4::uuid, $5,
              'manager_approval', $1::uuid, now() + interval '5 minutes',$7
       FROM target, manager_allowed
       WHERE target.user_id <> $1::uuid
       RETURNING id::text, expires_at AS "expiresAt"`,
      [
        input.managerUserId,
        input.operatorSessionId,
        input.tenantId,
        input.branchId,
        input.permission,
        input.managerStaffId,
        input.commandFingerprint,
      ],
    );
    if (rows[0]) {
      await this.pg.worker.query(
        `INSERT INTO runtime.security_audit_event
           (actor_user_id, business_id, branch_id, event_type, entity_type,
            entity_id, outcome, metadata)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'elevation.manager_granted',
                 'elevation_grant', $4::uuid, 'success',
                 jsonb_build_object('method','manager_approval','permission',$5))`,
        [input.managerUserId, input.tenantId, input.branchId, rows[0].id, input.permission],
      );
    }
    return rows[0] ?? null;
  }
}
