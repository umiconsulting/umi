import { ConflictException, Injectable } from '@nestjs/common';
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

  /**
   * The branch this device physically belongs to: a location id when the device
   * is pinned, `null` when it floats, `undefined` when there is no such active
   * device in the merchant.
   *
   * It runs with the location scope deliberately CLEARED. `merchant.device`
   * carries a `location_narrowing` RLS policy, so a device pinned to another
   * branch is invisible while `app.current_location` names a branch — which is
   * exactly the row this lookup has to be able to see in order to correct the
   * caller. `umi.current_location()` maps the empty setting to NULL, and the
   * policy short-circuits on NULL.
   */
  async deviceLocation(merchantId: string, deviceId: string): Promise<string | null | undefined> {
    const { rows } = await this.pg.runWithMerchant(
      merchantId,
      getRequestContext()?.userId ?? null,
      (client) =>
        client.query<{ locationId: string | null }>(
          `SELECT d.location_id::text AS "locationId"
             FROM merchant.device d
            WHERE d.id = $1::uuid AND d.merchant_id = $2::uuid AND d.status = 'active'`,
          [deviceId, merchantId],
        ),
      null,
    );
    return rows[0] ? rows[0].locationId : undefined;
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
              umi.resolve_staff_permissions(s.id) AS permissions,
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
       WHERE d.id = $2::uuid AND d.status = 'active'
         AND EXISTS (
           SELECT 1 FROM umi.effective_entitlement pos_entitlement
           WHERE pos_entitlement.merchant_id=b.id
             AND pos_entitlement.feature_key='pos' AND pos_entitlement.enabled
         )
       ORDER BY b.name`,
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
    return this.pg.workerTx(async (client) => {
      const scope = [input.merchantId, input.locationId, input.deviceId, input.userId];
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `operator:${input.merchantId}:${input.userId}`,
      ]);
      // The worker pool owns durable authentication. Each query fixes the complete scope.
      const durable = await client.query<{ id: string; createdAt: string }>(
        `SELECT s.id,s.created_at::text AS "createdAt" FROM runtime.session s
         WHERE s.id=$5::uuid AND s.merchant_id=$1::uuid
           AND s.principal_type='device' AND s.principal_id=$3::uuid
           AND s.metadata->>'app'='pos' AND s.metadata->>'operatorUserId'=$4
           AND s.metadata->>'locationId'=$2 AND s.is_active AND s.expires_at>now()
           AND NOT EXISTS (
             SELECT 1 FROM runtime.session newer
             WHERE newer.merchant_id=$1::uuid AND newer.principal_type='device'
               AND newer.principal_id=$3::uuid AND newer.metadata->>'app'='pos'
               AND newer.metadata->>'operatorUserId'=$4 AND newer.metadata->>'locationId'=$2
               AND newer.is_active AND newer.expires_at>now() AND newer.created_at>s.created_at
           ) FOR UPDATE OF s`,
        [...scope, input.durableSessionId],
      );
      if (!durable.rowCount) return null;
      const authorization = await client.query<{
        staffId: string;
        permissions: string[];
        entitlements: OperatorSessionView['entitlements'];
      }>(
        `SELECT s.id::text AS "staffId", umi.resolve_staff_permissions(s.id) AS permissions,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'featureKey', ee.feature_key, 'enabled', ee.enabled,
                    'limit', ee.limit_value, 'subscriptionStatus', sub.status
                  )) FROM umi.effective_entitlement ee
                  JOIN umi.subscription sub ON sub.merchant_id=ee.merchant_id
                  WHERE ee.merchant_id=$1::uuid
                ), '[]'::jsonb) AS entitlements
         FROM merchant.staff s
         JOIN merchant.device d ON d.id=$3::uuid AND d.merchant_id=s.merchant_id
         JOIN merchant.location b ON b.id=$2::uuid AND b.merchant_id=s.merchant_id
         WHERE s.user_id=$4::uuid AND s.merchant_id=$1::uuid
           AND s.status='active' AND b.status='active' AND d.status='active'
           AND (s.location_id IS NULL OR s.location_id=b.id)
           AND (d.location_id IS NULL OR d.location_id=b.id)
           AND EXISTS (SELECT 1 FROM umi.effective_entitlement ee
             WHERE ee.merchant_id=$1::uuid AND ee.feature_key='pos' AND ee.enabled)`,
        scope,
      );
      const authorized = authorization.rows[0];
      if (!authorized) return null;
      // Serialize starts for this user across devices before any recovery write.
      const otherPos = await client.query(
        `SELECT os.id FROM runtime.operator_session os
         JOIN runtime.session s ON s.id=os.durable_session_id
         JOIN merchant.device d ON d.id=os.device_id AND d.merchant_id=os.merchant_id
         WHERE os.merchant_id=$1::uuid AND os.user_id=$2::uuid
           AND os.device_id<>$3::uuid AND os.state IN ('active','locked')
           AND os.expires_at>now() AND s.is_active AND s.expires_at>now()
           AND d.status='active' LIMIT 1`,
        [input.merchantId, input.userId, input.deviceId],
      );
      if (otherPos.rowCount) {
        throw new ConflictException({ code: 'OPERATOR_SESSION_BUSY' });
      }
      // Logout locks the durable before the operator. Recovery uses the same order.
      await client.query(
        `SELECT id FROM runtime.session
         WHERE merchant_id=$1::uuid AND principal_type='device' AND principal_id=$3::uuid
           AND metadata->>'app'='pos' AND metadata->>'operatorUserId'=$4
           AND metadata->>'locationId'=$2 AND is_active AND id<>$5::uuid
           AND created_at<=$6::timestamptz ORDER BY id FOR UPDATE`,
        [...scope, input.durableSessionId, durable.rows[0].createdAt],
      );
      const candidates = await client.query<{
        id: string;
        durableSessionId: string;
        permissions: string[];
        activeAccounts: number;
      }>(
        `SELECT os.id::text, os.durable_session_id::text AS "durableSessionId", os.permissions,
           (SELECT count(*)::int FROM merchant.pos_cart c
             WHERE c.merchant_id=$1::uuid AND c.location_id=$2::uuid
               AND c.operator_session_id=os.id
               AND c.lifecycle_state IN ('building_cart','ready_for_checkout','recovered')) AS "activeAccounts"
         FROM runtime.operator_session os
         WHERE os.merchant_id=$1::uuid AND os.location_id=$2::uuid
           AND os.device_id=$3::uuid AND os.user_id=$4::uuid
           AND (os.state IN ('active','locked') OR EXISTS (
             SELECT 1 FROM merchant.pos_cart c WHERE c.merchant_id=$1::uuid AND c.location_id=$2::uuid
               AND c.operator_session_id=os.id
               AND c.lifecycle_state IN ('building_cart','ready_for_checkout','recovered')))
         ORDER BY "activeAccounts" DESC, (os.durable_session_id=$5::uuid) DESC,
           os.started_at DESC, os.id
         FOR UPDATE OF os`,
        [...scope, input.durableSessionId],
      );
      if (candidates.rows.filter((candidate) => candidate.activeAccounts > 0).length > 1) {
        throw new ConflictException({ code: 'CART_ACTOR_BUSY' });
      }
      const prior = candidates.rows[0];
      const resumed = prior != null && prior.durableSessionId !== input.durableSessionId;
      const permissions =
        !prior || authorized.permissions.includes('*')
          ? (prior?.permissions ?? authorized.permissions)
          : prior.permissions.includes('*')
            ? authorized.permissions
            : prior.permissions.filter((permission) => authorized.permissions.includes(permission));
      if (prior) {
        await client.query(
          `UPDATE runtime.operator_session SET state='ended',ended_at=now(),last_activity_at=now()
           WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND device_id=$3::uuid
             AND user_id=$4::uuid AND state IN ('active','locked') AND id<>$5::uuid`,
          [...scope, prior.id],
        );
      }
      await client.query(
        `UPDATE runtime.session SET is_active=false,revoked_at=now(),
           revoked_reason='operator_same_device_recovery',replaced_by_id=$5::uuid
         WHERE merchant_id=$1::uuid AND principal_type='device' AND principal_id=$3::uuid
           AND metadata->>'app'='pos' AND metadata->>'operatorUserId'=$4
           AND metadata->>'locationId'=$2 AND is_active AND id<>$5::uuid
           AND created_at<=$6::timestamptz`,
        [...scope, input.durableSessionId, durable.rows[0].createdAt],
      );
      const view = `id::text, user_id::text AS "userId", staff_id::text AS "staffId",
        merchant_id::text AS "merchantId", location_id::text AS "locationId",
        device_id::text AS "deviceId", state, permissions, entitlements,
        started_at AS "startedAt", last_activity_at AS "lastActivityAt", expires_at AS "expiresAt"`;
      const result = prior
        ? await client.query<OperatorSessionView>(
            `UPDATE runtime.operator_session SET durable_session_id=$6::uuid, permissions=$7::text[],
               entitlements=$8::jsonb,
               state=CASE WHEN durable_session_id<>$6::uuid OR state='ended' THEN 'active' ELSE state END,
               ended_at=NULL,
               last_activity_at=now(),expires_at=$9
             WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND device_id=$3::uuid
               AND user_id=$4::uuid AND id=$5::uuid RETURNING ${view}`,
            [
              ...scope,
              prior.id,
              input.durableSessionId,
              permissions,
              JSON.stringify(authorized.entitlements),
              input.expiresAt,
            ],
          )
        : await client.query<OperatorSessionView>(
            `INSERT INTO runtime.operator_session
               (merchant_id,location_id,device_id,user_id,staff_id,durable_session_id,
                permissions,entitlements,expires_at)
             VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::text[],$8::jsonb,$9)
             RETURNING ${view}`,
            [
              ...scope,
              authorized.staffId,
              input.durableSessionId,
              permissions,
              JSON.stringify(authorized.entitlements),
              input.expiresAt,
            ],
          );
      const operator = result.rows[0];
      if (operator) {
        await client.query(
          `INSERT INTO runtime.security_audit_event
             (actor_user_id,session_id,merchant_id,location_id,event_type,entity_type,entity_id,outcome)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'operator_session',$6::uuid,'success')`,
          [
            input.userId,
            input.durableSessionId,
            input.merchantId,
            input.locationId,
            resumed ? 'operator.session_resumed' : 'operator.session_started',
            operator.id,
          ],
        );
      }
      return operator ?? null;
    });
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
    }>(
      merchantId,
      locationId,
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
    actingUserId: string,
    durableSessionId: string,
    deviceId: string,
  ) {
    const { rows } = await this.scopedQuery<{
      staffId: string;
      userId: string;
      salt: string | null;
      hash: string | null;
      credential: 'operator_pin' | 'manager_card';
      lockedUntil: Date | null;
    }>(
      merchantId,
      locationId,
      // One lookup value, two possible credentials. The caller derives the hash
      // from whichever the manager presented, and the row answers with the salt
      // and hash belonging to THAT credential, so the verify step never compares
      // a card against a PIN hash.
      `SELECT s.id::text AS "staffId",s.user_id::text AS "userId",
              CASE WHEN s.operator_pin_lookup=$1 THEN s.operator_pin_salt
                   ELSE s.manager_card_salt END AS salt,
              CASE WHEN s.operator_pin_lookup=$1 THEN s.operator_pin_hash
                   ELSE s.manager_card_hash END AS hash,
              CASE WHEN s.operator_pin_lookup=$1 THEN 'operator_pin'
                   ELSE 'manager_card' END AS credential,
              d.pin_locked_until AS "lockedUntil"
       FROM merchant.staff s
       JOIN runtime.operator_session acting ON acting.id=$5::uuid
         AND acting.merchant_id=s.merchant_id AND acting.location_id=$3::uuid
         AND acting.user_id=$6::uuid AND acting.durable_session_id=$7::uuid
         AND acting.device_id=$8::uuid
       JOIN merchant.device d ON d.id=$8::uuid AND d.id=acting.device_id
         AND d.status='active'
       WHERE s.merchant_id=$2::uuid AND (s.location_id IS NULL OR s.location_id=$3::uuid)
         AND (s.operator_pin_lookup=$1 OR s.manager_card_lookup=$1)
         AND s.status='active'
         AND acting.state='active' AND acting.expires_at>now()
         -- EL ADMIN PUEDE AUTORIZAR SU PROPIO ACTO.
         --
         -- This clause used to require the credential to belong to SOMEBODY ELSE. That was
         -- written when cashiers and managers held
         -- authorizations, so a second person was the control. The owner's later rule —
         -- only an admin authorizes — moved the control to the PERMISSION, and with one
         -- admin in the café (the usual shape of a small business, and this pilot's) the
         -- old clause made every sensitive act impossible for the person who IS the
         -- authority: the admin signed in at the till, typing their own PIN, was told
         -- "ese PIN no autoriza este movimiento" (owner, 2026-10-13).
         --
         -- What still holds, and is what the audit reads: the PIN proves a live
         -- credential of a staff member who HOLDS this permission, the grant is single-use
         -- and bound to the act's fingerprint, and approved_by names whoever approved —
         -- the actor when it was their own act. A second sighting is no longer required;
         -- an authorization is.
         AND $4=ANY(umi.resolve_staff_permissions(s.id))
         AND EXISTS (
           SELECT 1 FROM umi.effective_entitlement ee
           WHERE ee.merchant_id=s.merchant_id AND ee.feature_key='pos' AND ee.enabled
         )
       LIMIT 1`,
      [
        lookupHash,
        merchantId,
        locationId,
        permission,
        operatorSessionId,
        actingUserId,
        durableSessionId,
        deviceId,
      ],
    );
    return rows[0] ?? null;
  }

  async administrativeManagerPinRecord(input: {
    lookupHash: string;
    merchantId: string;
    locationId: string;
    permission: string;
    actingUserId: string;
    dashboardSessionId: string;
  }) {
    const { rows } = await this.pg.query<{
      staffId: string;
      userId: string;
      salt: string | null;
      hash: string | null;
      lockedUntil: Date | null;
    }>(
      `SELECT s.id::text AS "staffId",s.user_id::text AS "userId",
              s.operator_pin_salt AS salt,s.operator_pin_hash AS hash,
              ds.approval_locked_until AS "lockedUntil"
         FROM merchant.staff s
         JOIN runtime.dashboard_session ds ON ds.id=$6::uuid
          AND ds.user_id=$5::uuid AND ds.is_active AND ds.expires_at>clock_timestamp()
        WHERE s.merchant_id=$2::uuid AND (s.location_id IS NULL OR s.location_id=$3::uuid)
          AND s.operator_pin_lookup=$1 AND s.status='active' AND s.user_id<>$5::uuid
          AND $4=ANY(umi.resolve_staff_permissions(s.id))
          AND EXISTS (
            SELECT 1 FROM umi.effective_entitlement ee
             WHERE ee.merchant_id=s.merchant_id AND ee.feature_key='pos' AND ee.enabled
          )
        LIMIT 1`,
      [
        input.lookupHash,
        input.merchantId,
        input.locationId,
        input.permission,
        input.actingUserId,
        input.dashboardSessionId,
      ],
    );
    return rows[0] ?? null;
  }

  async recordAdministrativePinFailure(
    merchantId: string,
    locationId: string,
    dashboardSessionId: string,
  ): Promise<void> {
    await this.pg.query(
      `UPDATE runtime.dashboard_session
          SET approval_failed_attempts=least(approval_failed_attempts+1,10),
              approval_locked_until=CASE WHEN approval_failed_attempts+1>=5
                THEN clock_timestamp()+interval '15 minutes' ELSE approval_locked_until END
        WHERE id=$1::uuid`,
      [dashboardSessionId],
    );
  }

  async recordPinFailure(merchantId: string, locationId: string, deviceId: string): Promise<void> {
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
                 jsonb_build_object('method','operator_pin','permission',$6::text))`,
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
    /** Which credential the manager presented. Recorded on the grant and its audit event. */
    method: 'manager_approval' | 'manager_card';
  }) {
    const { rows } = await this.scopedQuery<{ id: string; expiresAt: Date }>(
      input.merchantId,
      input.locationId,
      `WITH manager_allowed AS (
         SELECT 1
         FROM merchant.staff ms
         WHERE ms.user_id = $1::uuid AND ms.merchant_id = $3::uuid
           AND ms.id = $6::uuid
           AND (ms.location_id IS NULL OR ms.location_id = $4::uuid)
           AND ms.status='active'
           AND $5=ANY(umi.resolve_staff_permissions(ms.id))
           AND EXISTS (
             SELECT 1 FROM umi.effective_entitlement ee
             WHERE ee.merchant_id=ms.merchant_id AND ee.feature_key='pos' AND ee.enabled
           )
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
              $8, $1::uuid, now() + interval '5 minutes',$7
       -- NO "different person" COMPARISON HERE EITHER: the same rule as the lookup above —
       -- the holder of the permission may approve their own act. The row still records the
       -- approver in approved_by, which is the fact an audit needs when the actor and the
       -- approver are the same person.
       FROM target, manager_allowed
       RETURNING id::text, expires_at AS "expiresAt"`,
      [
        input.managerUserId,
        input.operatorSessionId,
        input.merchantId,
        input.locationId,
        input.permission,
        input.managerStaffId,
        input.commandFingerprint,
        input.method,
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
                 jsonb_build_object('method',$6::text,'permission',$5::text))`,
        [
          input.managerUserId,
          input.merchantId,
          input.locationId,
          rows[0].id,
          input.permission,
          input.method,
        ],
      );
    }
    return rows[0] ?? null;
  }

  async grantAdministrativeManagerElevation(input: {
    managerUserId: string;
    managerStaffId: string;
    actingUserId: string;
    dashboardSessionId: string;
    merchantId: string;
    locationId: string;
    permission: string;
    commandFingerprint: string | null;
  }) {
    const { rows } = await this.pg.query<{ id: string; expiresAt: Date }>(
      `WITH manager_allowed AS (
         SELECT 1 FROM merchant.staff ms
          WHERE ms.user_id=$1::uuid AND ms.id=$2::uuid AND ms.merchant_id=$5::uuid
            AND (ms.location_id IS NULL OR ms.location_id=$6::uuid)
            AND ms.status='active' AND $7=ANY(umi.resolve_staff_permissions(ms.id))
       ), acting AS (
         SELECT 1 FROM runtime.dashboard_session ds
          WHERE ds.id=$4::uuid AND ds.user_id=$3::uuid
            AND ds.is_active AND ds.expires_at>clock_timestamp()
       ), reset AS (
         UPDATE runtime.dashboard_session
            SET approval_failed_attempts=0,approval_locked_until=null
          WHERE id=$4::uuid AND EXISTS (SELECT 1 FROM acting)
         RETURNING 1
       )
       INSERT INTO runtime.elevation_grant
         (session_id,dashboard_session_id,merchant_id,location_id,permission_key,method,
          approved_by,expires_at,command_fingerprint)
       SELECT null,$4::uuid,$5::uuid,$6::uuid,$7,'manager_approval',$1::uuid,
              clock_timestamp()+interval '5 minutes',$8
         FROM manager_allowed,acting,reset
        WHERE $1::uuid<>$3::uuid
       RETURNING id::text,expires_at AS "expiresAt"`,
      [
        input.managerUserId,
        input.managerStaffId,
        input.actingUserId,
        input.dashboardSessionId,
        input.merchantId,
        input.locationId,
        input.permission,
        input.commandFingerprint,
      ],
    );
    return rows[0] ?? null;
  }
}
