import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import type { EffectiveEntitlement, LocationAccess, OperatorSessionView } from '@umi/contract';
import type { QueryResultRow } from 'pg';
import { getRequestContext } from '../../shared/database/request-context';

export type EntryMerchant = {
  id: string;
  name: string;
  roles: string[];
  permissions: string[];
  locations: LocationAccess[];
  entitlements: EffectiveEntitlement[];
};

@Injectable()
export class PosEntryRepository {
  constructor(private readonly pg: PgService) {}

  private scopedQuery<T extends QueryResultRow>(
    merchantId: string,
    locationId: string,
    text: string,
    params: unknown[],
  ) {
    return this.pg.runWithMerchant(
      merchantId,
      getRequestContext()?.userId ?? null,
      (client) => client.query<T>(text, params),
      locationId,
    );
  }

  async entryContext(userId: string, deviceId: string): Promise<EntryMerchant[]> {
    // This cross-merchant discovery read runs before the operator selects a merchant.
    // It uses exact user and device predicates. All selected-merchant work uses RLS.
    const { rows } = await this.pg.worker.query<{
      id: string;
      name: string;
      roles: string[];
      permissions: string[];
      locations: LocationAccess[];
      entitlements: EffectiveEntitlement[];
    }>(
      `SELECT b.id::text, b.name,
              ARRAY[r.key] AS roles,
              COALESCE(array_agg(DISTINCT p.key) FILTER (
                WHERE p.key IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM merchant.staff_permission_override up
                  WHERE up.staff_id = s.id AND up.permission_id = p.id
                    AND up.effect = 'deny'
                    AND (up.expires_at IS NULL OR up.expires_at > now())
                )
              ), '{}') ||
              COALESCE((
                SELECT array_agg(DISTINCT p_allow.key)
                FROM merchant.staff_permission_override up_allow
                JOIN umi.permission p_allow ON p_allow.id = up_allow.permission_id
                WHERE up_allow.staff_id = s.id AND up_allow.effect = 'allow'
                  AND (up_allow.expires_at IS NULL OR up_allow.expires_at > now())
                  AND NOT EXISTS (
                    SELECT 1 FROM merchant.staff_permission_override up_deny
                    WHERE up_deny.staff_id = up_allow.staff_id
                      AND up_deny.permission_id = up_allow.permission_id
                      AND up_deny.effect = 'deny'
                      AND (up_deny.expires_at IS NULL OR up_deny.expires_at > now())
                  )
              ), '{}')
                AS permissions,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', br.id::text, 'merchantId', b.id::text, 'name', br.name,
                  'status', br.status,
                  'deviceAllowed', d.location_id IS NULL OR d.location_id = br.id,
                  'operatorAllowed', s.location_id IS NULL OR s.location_id = br.id
                ) ORDER BY br.name)
                FROM merchant.location br
                WHERE br.merchant_id = b.id AND br.status = 'active'
                  AND (d.location_id IS NULL OR d.location_id = br.id)
                  AND (s.location_id IS NULL OR s.location_id = br.id)
              ), '[]'::jsonb) AS locations,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'featureKey', ee.feature_key, 'enabled', ee.enabled,
                  'limit', ee.limit_value, 'subscriptionStatus', s.status
                ))
                FROM umi.effective_entitlement ee
                JOIN umi.subscription s ON s.merchant_id = ee.merchant_id
                WHERE ee.merchant_id = b.id
              ), '[]'::jsonb) AS entitlements
       FROM merchant.device d
       JOIN merchant.merchant b ON b.id = d.merchant_id AND b.status = 'active'
       JOIN merchant.staff s ON s.user_id = $1::uuid AND s.merchant_id = b.id
         AND s.status = 'active'
       JOIN umi.role r ON r.id = s.role_id
       LEFT JOIN umi.role_permission rp ON rp.role_id = r.id
       LEFT JOIN umi.permission p ON p.id = rp.permission_id
       WHERE d.id = $2::uuid AND d.status = 'active'
         AND EXISTS (
           SELECT 1 FROM umi.effective_entitlement pos_entitlement
           WHERE pos_entitlement.merchant_id=b.id
             AND pos_entitlement.feature_key='pos' AND pos_entitlement.enabled
         )
       GROUP BY b.id, d.id, s.id, r.key`,
      [userId, deviceId],
    );
    return rows;
  }

  async startOperator(input: {
    durableSessionId: string;
    userId: string;
    deviceId: string;
    merchantId: string;
    locationId: string;
    expiresAt: Date;
  }): Promise<OperatorSessionView | null> {
    const { rows } = await this.scopedQuery<OperatorSessionView>(
      input.merchantId,
      input.locationId,
      `WITH authorized AS (
         SELECT s.id AS staff_id,
                COALESCE(array_agg(DISTINCT p.key) FILTER (
                  WHERE p.key IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM merchant.staff_permission_override up
                    WHERE up.staff_id = s.id AND up.permission_id = p.id
                      AND up.effect = 'deny'
                      AND (up.expires_at IS NULL OR up.expires_at > now())
                  )
                ), '{}') ||
                COALESCE((
                  SELECT array_agg(DISTINCT p_allow.key)
                  FROM merchant.staff_permission_override up_allow
                  JOIN umi.permission p_allow ON p_allow.id = up_allow.permission_id
                  WHERE up_allow.staff_id = s.id AND up_allow.effect = 'allow'
                    AND (up_allow.expires_at IS NULL OR up_allow.expires_at > now())
                    AND NOT EXISTS (
                      SELECT 1 FROM merchant.staff_permission_override up_deny
                      WHERE up_deny.staff_id = up_allow.staff_id
                        AND up_deny.permission_id = up_allow.permission_id
                        AND up_deny.effect = 'deny'
                        AND (up_deny.expires_at IS NULL OR up_deny.expires_at > now())
                    )
                ), '{}') perms,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'featureKey', ee.feature_key, 'enabled', ee.enabled,
                    'limit', ee.limit_value, 'subscriptionStatus', sub.status
                  ))
                  FROM umi.effective_entitlement ee
                  JOIN umi.subscription sub ON sub.merchant_id = ee.merchant_id
                  WHERE ee.merchant_id = $4::uuid
                ), '[]'::jsonb) ents
         FROM merchant.staff s
         JOIN merchant.device d ON d.id = $3::uuid AND d.merchant_id = s.merchant_id
         JOIN merchant.location b ON b.id = $5::uuid AND b.merchant_id = s.merchant_id
         JOIN umi.role r ON r.id = s.role_id
         LEFT JOIN umi.role_permission rp ON rp.role_id = r.id
         LEFT JOIN umi.permission p ON p.id = rp.permission_id
         WHERE s.user_id = $2::uuid AND s.merchant_id = $4::uuid
           AND s.status = 'active' AND b.status = 'active'
           AND d.status = 'active'
           AND EXISTS (
             SELECT 1 FROM umi.effective_entitlement pos_entitlement
             WHERE pos_entitlement.merchant_id=$4::uuid
               AND pos_entitlement.feature_key='pos' AND pos_entitlement.enabled
           )
           AND (s.location_id IS NULL OR s.location_id = b.id)
           AND (d.location_id IS NULL OR d.location_id = b.id)
         GROUP BY s.id
       ), inserted AS (
         INSERT INTO runtime.operator_session
           (durable_session_id, user_id, staff_id, device_id, merchant_id, location_id,
            permissions, entitlements, expires_at)
         SELECT $1::uuid, $2::uuid, staff_id, $3::uuid, $4::uuid, $5::uuid,
                perms, ents, $6 FROM authorized
         ON CONFLICT (durable_session_id) WHERE state IN ('active','locked')
         DO UPDATE SET last_activity_at = now()
         RETURNING *
       )
       SELECT id::text, user_id::text AS "userId", staff_id::text AS "staffId",
              merchant_id::text AS "merchantId", location_id::text AS "locationId",
              device_id::text AS "deviceId", state, permissions, entitlements,
              started_at AS "startedAt", last_activity_at AS "lastActivityAt",
              expires_at AS "expiresAt"
       FROM inserted`,
      [
        input.durableSessionId,
        input.userId,
        input.deviceId,
        input.merchantId,
        input.locationId,
        input.expiresAt,
      ],
    );
    if (rows[0]) {
      await this.scopedQuery(
        input.merchantId,
        input.locationId,
        `INSERT INTO runtime.security_audit_event
           (actor_user_id, session_id, merchant_id, location_id, event_type,
            entity_type, entity_id, outcome)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'operator.session_started',
                 'operator_session', $5::uuid, 'success')`,
        [input.userId, input.durableSessionId, input.merchantId, input.locationId, rows[0].id],
      );
    }
    return rows[0] ?? null;
  }

  async transition(
    id: string,
    durableSessionId: string,
    state: 'locked' | 'ended',
  ): Promise<boolean> {
    // The auth substrate resolves the RLS scope from the current durable session.
    const scope = await this.pg.worker.query<{ merchantId: string; locationId: string }>(
      `SELECT merchant_id::text AS "merchantId",metadata->>'locationId' AS "locationId"
       FROM runtime.session
       WHERE id=$1::uuid AND principal_type='device' AND is_active AND expires_at>now()`,
      [durableSessionId],
    );
    const current = scope.rows[0];
    if (!current?.locationId) return false;
    const { rowCount } = await this.scopedQuery(
      current.merchantId,
      current.locationId,
      `UPDATE runtime.operator_session
       SET state = $3, last_activity_at = now(),
           ended_at = CASE WHEN $3 = 'ended' THEN now() ELSE ended_at END
       WHERE id = $1::uuid AND durable_session_id = $2::uuid
         AND state <> 'ended'`,
      [id, durableSessionId, state],
    );
    const changed = (rowCount ?? 0) > 0;
    if (changed) {
      await this.scopedQuery(
        current.merchantId,
        current.locationId,
        `INSERT INTO runtime.security_audit_event
           (session_id, event_type, entity_type, entity_id, outcome)
         VALUES ($1::uuid, $3, 'operator_session', $2::uuid, 'success')`,
        [durableSessionId, id, `operator.${state}`],
      );
    }
    return changed;
  }

  async pinRecord(userId: string, merchantId: string, locationId: string, deviceId: string) {
    const { rows } = await this.scopedQuery<{
      staffId: string;
      salt: string | null;
      hash: string | null;
      attempts: number;
      lockedUntil: Date | null;
    }>(merchantId, locationId,
      `SELECT s.id::text AS "staffId", s.operator_pin_salt AS salt,
              s.operator_pin_hash AS hash, d.pin_failed_attempts AS attempts,
              d.pin_locked_until AS "lockedUntil"
       FROM merchant.staff s
       JOIN merchant.device d ON d.id=$3::uuid AND d.merchant_id=s.merchant_id
       WHERE s.user_id = $1::uuid AND s.merchant_id = $2::uuid
         AND s.status = 'active' AND d.status='active' LIMIT 1`,
      [userId, merchantId, deviceId],
    );
    return rows[0] ?? null;
  }

  async managerPinRecord(
    lookupHash: string,
    merchantId: string,
    locationId: string,
    permission: string,
    operatorSessionId: string,
  ) {
    const { rows } = await this.scopedQuery<{
      staffId: string;
      userId: string;
      salt: string | null;
      hash: string | null;
      lockedUntil: Date | null;
    }>(merchantId, locationId,
      `SELECT s.id::text AS "staffId",s.user_id::text AS "userId",
              s.operator_pin_salt AS salt,s.operator_pin_hash AS hash,
              d.pin_locked_until AS "lockedUntil"
       FROM merchant.staff s
       JOIN umi.role r ON r.id=s.role_id
       LEFT JOIN umi.role_permission rp ON rp.role_id=r.id
       LEFT JOIN umi.permission p ON p.id=rp.permission_id
       JOIN runtime.operator_session acting ON acting.id=$5::uuid
         AND acting.merchant_id=s.merchant_id AND acting.location_id=$3::uuid
       JOIN merchant.device d ON d.id=acting.device_id AND d.status='active'
       WHERE s.merchant_id=$2::uuid AND (s.location_id IS NULL OR s.location_id=$3::uuid)
         AND s.operator_pin_lookup=$1 AND s.status='active'
         AND acting.user_id<>s.user_id
         AND r.key IN ('owner','admin','manager','supervisor','super_admin')
         AND (p.key=$4 OR r.key='super_admin')
       LIMIT 1`,
      [lookupHash, merchantId, locationId, permission, operatorSessionId],
    );
    return rows[0] ?? null;
  }

  async recordPinFailure(
    merchantId: string,
    locationId: string,
    deviceId: string,
  ): Promise<void> {
    await this.scopedQuery(
      merchantId,
      locationId,
      `UPDATE merchant.device
       SET pin_failed_attempts = least(pin_failed_attempts + 1, 10),
           pin_locked_until = CASE WHEN pin_failed_attempts + 1 >= 5
             THEN now() + interval '15 minutes' ELSE pin_locked_until END
       WHERE id = $1::uuid`,
      [deviceId],
    );
  }

  async grantPinElevation(input: {
    staffId: string;
    sessionId: string;
    merchantId: string;
    locationId: string;
    permission: string;
    userId: string;
    deviceId: string;
  }) {
    const { rows } = await this.scopedQuery<{ id: string; expiresAt: Date }>(
      input.merchantId,
      input.locationId,
      `WITH reset AS (
         UPDATE merchant.device SET pin_failed_attempts = 0, pin_locked_until = null
         WHERE id = $7::uuid
       )
       INSERT INTO runtime.elevation_grant
         (session_id, merchant_id, location_id, permission_key, method, approved_by, expires_at)
       VALUES ($2::uuid, $3::uuid, $4::uuid, $5, 'operator_pin', $6::uuid,
               now() + interval '5 minutes')
       RETURNING id::text, expires_at AS "expiresAt"`,
      [
        input.staffId,
        input.sessionId,
        input.merchantId,
        input.locationId,
        input.permission,
        input.userId,
        input.deviceId,
      ],
    );
    if (rows[0]) {
      await this.scopedQuery(
        input.merchantId,
        input.locationId,
        `INSERT INTO runtime.security_audit_event
           (actor_user_id, session_id, merchant_id, location_id, event_type,
            entity_type, entity_id, outcome, metadata)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'elevation.granted',
                 'elevation_grant', $5::uuid, 'success',
                 jsonb_build_object('method','operator_pin','permission',$6))`,
        [
          input.userId,
          input.sessionId,
          input.merchantId,
          input.locationId,
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
    merchantId: string;
    locationId: string;
    permission: string;
    commandFingerprint: string | null;
  }) {
    const { rows } = await this.scopedQuery<{ id: string; expiresAt: Date }>(
      input.merchantId,
      input.locationId,
      `WITH manager_allowed AS (
         SELECT 1
         FROM merchant.staff ms
         JOIN umi.role r ON r.id = ms.role_id
         JOIN umi.role_permission rp ON rp.role_id = r.id
         JOIN umi.permission p ON p.id = rp.permission_id
         WHERE ms.user_id = $1::uuid AND ms.merchant_id = $3::uuid
           AND (ms.location_id IS NULL OR ms.location_id = $4::uuid)
           AND ms.status='active'
           AND r.key IN ('owner','admin','manager','supervisor','super_admin')
           AND (p.key = $5 OR r.key = 'super_admin')
       ), target AS (
         SELECT durable_session_id, user_id, device_id
         FROM runtime.operator_session
         WHERE id = $2::uuid AND merchant_id = $3::uuid AND location_id = $4::uuid
           AND state = 'active' AND expires_at > now()
       ), reset AS (
         UPDATE merchant.device SET pin_failed_attempts = 0, pin_locked_until = null
         WHERE id = (SELECT device_id FROM target)
       )
       INSERT INTO runtime.elevation_grant
         (session_id, merchant_id, location_id, permission_key, method, approved_by,
          expires_at,command_fingerprint)
       SELECT target.durable_session_id, $3::uuid, $4::uuid, $5,
              'manager_approval', $1::uuid, now() + interval '5 minutes',$7
       FROM target, manager_allowed
       WHERE target.user_id <> $1::uuid
       RETURNING id::text, expires_at AS "expiresAt"`,
      [
        input.managerUserId,
        input.operatorSessionId,
        input.merchantId,
        input.locationId,
        input.permission,
        input.managerStaffId,
        input.commandFingerprint,
      ],
    );
    if (rows[0]) {
      await this.scopedQuery(
        input.merchantId,
        input.locationId,
        `INSERT INTO runtime.security_audit_event
           (actor_user_id, merchant_id, location_id, event_type, entity_type,
            entity_id, outcome, metadata)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'elevation.manager_granted',
                 'elevation_grant', $4::uuid, 'success',
                 jsonb_build_object('method','manager_approval','permission',$5))`,
        [input.managerUserId, input.merchantId, input.locationId, rows[0].id, input.permission],
      );
    }
    return rows[0] ?? null;
  }
}
