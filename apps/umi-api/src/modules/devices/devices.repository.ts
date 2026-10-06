import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PgService } from '../../shared/database/pg.service';
import type { DeviceSummary } from '@umi/contract';
import type {
  DeviceEnrollmentDecision,
  DeviceEnrollmentRequestView,
  DevicePairingAcknowledgement,
  DevicePairingPollResponse,
} from '@umi/contract';

type ChallengeRow = {
  id: string;
  businessId: string;
  locationId: string | null;
  displayName: string;
  deviceKind: 'kds' | 'pos_terminal';
  platform: 'android' | 'ios' | 'linux' | 'macos' | 'windows' | 'web';
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  replacesDeviceId: string | null;
};

type PairingRequestRow = {
  id: string;
  businessId: string;
  locationId: string | null;
  displayName: string;
  deviceKind: 'kds' | 'pos_terminal';
  platform: ChallengeRow['platform'];
  requestedPlatform: ChallengeRow['platform'] | null;
  mobility: 'static' | 'mobile';
  state: string;
  attempts: number;
  installationHash: string | null;
  expiresAt: Date;
  pairingSessionId: string | null;
  deviceId: string | null;
  replacesDeviceId: string | null;
  ephemeralPublicKey: string | null;
};

const DEVICE_PROJECTION = `
  d.id::text,
  d.public_id::text AS "publicId",
  d.merchant_id::text AS "merchantId",
  d.location_id::text AS "locationId",
  d.name AS "displayName",
  d.kind AS type,
  d.platform,
  d.mobility,
  d.status AS state,
  d.credential_version AS "credentialVersion",
  d.last_seen_at AS "lastSeenAt",
  (d.status = 'rotation_required') AS "rotationRequired",
  d.revoked_at AS "revokedAt",
  d.replacement_device_id::text AS "replacementDeviceId"`;

@Injectable()
export class DevicesRepository {
  constructor(private readonly pg: PgService) {}

  async beginEnrollment(input: {
    id: string;
    merchantId: string;
    locationId: string | null;
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
         (id, merchant_id, location_id, display_name, device_kind, platform, code_hash,
          idempotency_key, expires_at, created_by, replaces_device_id)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::uuid, $9, $10::uuid, $11::uuid
       WHERE $3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM merchant.location
         WHERE id = $3::uuid AND merchant_id = $2::uuid AND status = 'active'
       )
       ON CONFLICT (merchant_id, idempotency_key) DO UPDATE
         SET idempotency_key = excluded.idempotency_key
       RETURNING id::text, expires_at AS "expiresAt"`,
      [
        input.id,
        input.merchantId,
        input.locationId,
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

  async beginPairing(input: {
    id: string;
    merchantId: string;
    locationId: string | null;
    displayName: string;
    type: 'kds' | 'pos_terminal';
    platform: ChallengeRow['platform'];
    mobility: 'static' | 'mobile';
    codeHash: string;
    idempotencyKey: string;
    expiresAt: Date;
    actorUserId: string;
    replacesDeviceId?: string | null;
  }): Promise<{ id: string; expiresAt: Date }> {
    const { rows } = await this.pg.worker.query<{ id: string; expiresAt: Date }>(
      `INSERT INTO runtime.device_enrollment_request
         (id, merchant_id, location_id, display_name, device_kind, platform,
          setup_code_hash, idempotency_key, expires_at, created_by, replaces_device_id,
          mobility)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::uuid, $9, $10::uuid, $11::uuid,
              $12
       WHERE $3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM merchant.location
         WHERE id = $3::uuid AND merchant_id = $2::uuid AND status = 'active'
       )
       ON CONFLICT (merchant_id, idempotency_key) DO UPDATE
         SET idempotency_key = excluded.idempotency_key
       RETURNING id::text, expires_at AS "expiresAt"`,
      [
        input.id,
        input.merchantId,
        input.locationId,
        input.displayName,
        input.type,
        input.platform,
        input.codeHash,
        input.idempotencyKey,
        input.expiresAt,
        input.actorUserId,
        input.replacesDeviceId ?? null,
        input.mobility,
      ],
    );
    if (!rows[0]) throw new Error('branch_not_allowed');
    if (rows[0].id === input.id) {
      await this.pg.worker.query(
        `INSERT INTO runtime.security_audit_event
           (actor_user_id, merchant_id, location_id, event_type, entity_type, entity_id, outcome)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'device.enrollment_created',
                 'device_enrollment_request', $4::uuid, 'success')`,
        [input.actorUserId, input.merchantId, input.locationId, input.id],
      );
    }
    return rows[0];
  }

  async claimPairing(input: {
    setupCodeHash: string;
    installationHash: string;
    installationReference: string;
    platform: ChallengeRow['platform'];
    deviceType: 'kds' | 'pos_terminal';
    ephemeralPublicKey: string | null;
    pairingSessionId: string;
    pollingCredentialHash: string;
  }): Promise<
    { state: 'claimed'; pairingSessionId: string; expiresAt: Date } | { state: 'rejected' }
  > {
    const client = await this.pg.worker.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<PairingRequestRow>(
        `SELECT r.id::text, r.merchant_id::text AS "businessId",
                r.location_id::text AS "locationId", r.display_name AS "displayName",
                r.device_kind AS "deviceKind", r.platform, r.requested_platform AS "requestedPlatform",
                r.mobility, r.state, r.attempts, r.installation_hash AS "installationHash",
                r.expires_at AS "expiresAt", s.id::text AS "pairingSessionId",
                r.device_id::text AS "deviceId",
                r.replaces_device_id::text AS "replacesDeviceId"
         FROM runtime.device_enrollment_request r
         LEFT JOIN runtime.device_pairing_session s ON s.enrollment_request_id = r.id
         WHERE r.setup_code_hash = $1
         FOR UPDATE OF r`,
        [input.setupCodeHash],
      );
      const request = selected.rows[0];
      if (!request) {
        await client.query('ROLLBACK');
        return { state: 'rejected' };
      }
      if (request.expiresAt.getTime() <= Date.now()) {
        await client.query(
          `UPDATE runtime.device_enrollment_request
           SET state = 'expired', updated_at = now()
           WHERE id = $1::uuid AND state IN ('created', 'awaiting_approval')`,
          [request.id],
        );
        await this.audit(client, request, 'device.enrollment_expired', 'denied', null);
        await client.query('COMMIT');
        return { state: 'rejected' };
      }
      if (
        request.state !== 'created' ||
        request.attempts >= 5 ||
        request.platform !== input.platform ||
        request.deviceKind !== input.deviceType
      ) {
        if (request.state === 'created') {
          await client.query(
            `UPDATE runtime.device_enrollment_request
             SET attempts = least(attempts + 1, 5), updated_at = now()
             WHERE id = $1::uuid`,
            [request.id],
          );
        }
        await this.audit(client, request, 'device.enrollment_claim_denied', 'denied', null);
        await client.query('COMMIT');
        return { state: 'rejected' };
      }
      await client.query(
        `UPDATE runtime.device_enrollment_request
         SET state = 'awaiting_approval', installation_hash = $2,
             installation_reference = $3, requested_platform = $4,
             ephemeral_public_key = $5, claimed_at = now(), updated_at = now()
         WHERE id = $1::uuid`,
        [
          request.id,
          input.installationHash,
          input.installationReference,
          input.platform,
          input.ephemeralPublicKey,
        ],
      );
      await client.query(
        `INSERT INTO runtime.device_pairing_session
           (id, enrollment_request_id, polling_credential_hash)
         VALUES ($1::uuid, $2::uuid, $3)`,
        [input.pairingSessionId, request.id, input.pollingCredentialHash],
      );
      await this.audit(client, request, 'device.enrollment_claimed', 'success', null, {
        installationReference: input.installationReference,
      });
      await client.query('COMMIT');
      return {
        state: 'claimed',
        pairingSessionId: input.pairingSessionId,
        expiresAt: request.expiresAt,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The enrolled POS terminals for one merchant — the devices themselves, not the
   * requests that produced them.
   *
   * A device whose `location_id` is NULL is included in EVERY branch view rather than
   * none. Such a row is a defect from an enrolment that ran before the API required a
   * branch, and hiding it would leave it active with no screen able to revoke it.
   */
  async listDevices(merchantId: string, locationIds: string[] | null): Promise<DeviceSummary[]> {
    const { rows } = await this.pg.worker.query<DeviceSummary>(
      `SELECT ${DEVICE_PROJECTION}
         FROM merchant.device d
        WHERE d.merchant_id = $1::uuid
          AND d.kind = 'pos_terminal'
          AND d.status NOT IN ('revoked', 'replaced', 'retired')
          AND ($2::uuid[] IS NULL OR d.location_id = any($2::uuid[]) OR d.location_id IS NULL)
        ORDER BY d.registered_at DESC
        LIMIT 200`,
      [merchantId, locationIds],
    );
    return rows;
  }

  /**
   * Rename a terminal and restate how it is used on the floor. Neither field is
   * security material, so this does not touch the credential columns and cannot move
   * the device to another branch — a branch change means enrolling again.
   */
  async updateDevice(input: {
    merchantId: string;
    deviceId: string;
    displayName: string;
    mobility: 'static' | 'mobile';
    allowedBranchIds: string[] | null;
  }): Promise<DeviceSummary | null> {
    const { rows } = await this.pg.worker.query<DeviceSummary>(
      `UPDATE merchant.device AS d
          SET name = $3, mobility = $4, updated_at = now()
        WHERE d.id = $2::uuid AND d.merchant_id = $1::uuid
          AND d.kind = 'pos_terminal'
          AND d.status NOT IN ('revoked', 'replaced')
          AND ($5::uuid[] IS NULL OR d.location_id = any($5::uuid[]) OR d.location_id IS NULL)
        RETURNING ${DEVICE_PROJECTION}`,
      [input.merchantId, input.deviceId, input.displayName, input.mobility, input.allowedBranchIds],
    );
    return rows[0] ?? null;
  }

  async listPairingRequests(
    merchantId: string,
    locationIds: string[] | null,
  ): Promise<DeviceEnrollmentRequestView[]> {
    const { rows } = await this.pg.worker.query<DeviceEnrollmentRequestView>(
      `SELECT id::text, merchant_id::text AS "merchantId", location_id::text AS "locationId",
              display_name AS "displayName", device_kind AS type, platform,
              requested_platform AS "requestedPlatform", mobility, state,
              expires_at AS "expiresAt", claimed_at AS "claimedAt",
              installation_reference AS "installationReference", created_at AS "createdAt"
       FROM runtime.device_enrollment_request
       WHERE merchant_id = $1::uuid
         AND ($2::uuid[] IS NULL OR location_id = any($2::uuid[]))
       ORDER BY created_at DESC
       LIMIT 200`,
      [merchantId, locationIds],
    );
    return rows;
  }

  async decidePairing(input: {
    merchantId: string;
    requestId: string;
    actorUserId: string;
    idempotencyKey: string;
    approve: boolean;
    credentialHash: string | null;
    allowedBranchIds: string[] | null;
    // `pairingSessionId` rides along for the realtime nudge. It is internal: the
    // HTTP response model stays `DeviceEnrollmentDecision`.
  }): Promise<(DeviceEnrollmentDecision & { pairingSessionId: string }) | null> {
    const client = await this.pg.worker.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<PairingRequestRow>(
        `SELECT r.id::text, r.merchant_id::text AS "businessId",
                r.location_id::text AS "locationId", r.display_name AS "displayName",
                r.device_kind AS "deviceKind", r.platform, r.requested_platform AS "requestedPlatform",
                r.mobility, r.state, r.attempts, r.installation_hash AS "installationHash",
                r.expires_at AS "expiresAt", s.id::text AS "pairingSessionId",
                r.device_id::text AS "deviceId",
                r.replaces_device_id::text AS "replacesDeviceId",
                r.ephemeral_public_key AS "ephemeralPublicKey"
         FROM runtime.device_enrollment_request r
         LEFT JOIN runtime.device_pairing_session s ON s.enrollment_request_id = r.id
         WHERE r.id = $1::uuid AND r.merchant_id = $2::uuid
           AND ($3::uuid[] IS NULL OR r.location_id = any($3::uuid[]))
         FOR UPDATE OF r`,
        [input.requestId, input.merchantId, input.allowedBranchIds],
      );
      const request = selected.rows[0];
      if (!request || !request.pairingSessionId || !request.installationHash) {
        await client.query('ROLLBACK');
        return null;
      }
      if (
        request.state === (input.approve ? 'credential_ready' : 'denied') ||
        request.state === (input.approve ? 'credential_delivered' : 'denied') ||
        request.state === (input.approve ? 'completed' : 'denied')
      ) {
        const decided = await client.query<{ decidedAt: Date }>(
          `SELECT decided_at AS "decidedAt"
           FROM runtime.device_enrollment_request
           WHERE id = $1::uuid AND decision_idempotency_key = $2::uuid`,
          [request.id, input.idempotencyKey],
        );
        if (!decided.rows[0]) {
          await client.query('ROLLBACK');
          return null;
        }
        await client.query('COMMIT');
        return {
          enrollmentRequestId: request.id,
          state: input.approve ? 'credential_ready' : 'denied',
          decidedAt: decided.rows[0].decidedAt.toISOString(),
          pairingSessionId: request.pairingSessionId,
        };
      }
      if (request.state !== 'awaiting_approval' || request.expiresAt.getTime() <= Date.now()) {
        if (request.expiresAt.getTime() <= Date.now()) {
          await client.query(
            `UPDATE runtime.device_enrollment_request
             SET state = 'expired', updated_at = now() WHERE id = $1::uuid`,
            [request.id],
          );
        }
        await client.query('COMMIT');
        return null;
      }
      let deviceId: string | null = null;
      if (input.approve) {
        if (!input.credentialHash) throw new Error('credential_hash_required');
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO merchant.device
             (merchant_id, location_id, name, kind, status, platform,
              installation_hash, credential_hash, credential_version, mobility,
              ephemeral_public_key)
           VALUES ($1::uuid, $2::uuid, $3, $4, 'active', $5, $6, $7, 1, $8, $9)
           RETURNING id::text`,
          [
            request.businessId,
            request.locationId,
            request.displayName,
            request.deviceKind,
            request.requestedPlatform ?? request.platform,
            request.installationHash,
            input.credentialHash,
            request.mobility,
            request.ephemeralPublicKey ?? null,
          ],
        );
        deviceId = inserted.rows[0].id;
        if (request.replacesDeviceId) {
          await client.query(
            `UPDATE merchant.device
             SET status = 'replaced', revoked_at = now(),
                 revocation_reason = 'replaced', replacement_device_id = $2::uuid,
                 credential_hash = null, updated_at = now()
             WHERE id = $1::uuid AND merchant_id = $3::uuid
               AND status NOT IN ('revoked', 'replaced')`,
            [request.replacesDeviceId, deviceId, request.businessId],
          );
        }
      }
      const nextState = input.approve ? 'credential_ready' : 'denied';
      const updated = await client.query<{ decidedAt: Date }>(
        `UPDATE runtime.device_enrollment_request
         SET state = $2, device_id = $3::uuid, decided_at = now(), decided_by = $4::uuid,
             decision_idempotency_key = $5::uuid, updated_at = now()
         WHERE id = $1::uuid
         RETURNING decided_at AS "decidedAt"`,
        [request.id, nextState, deviceId, input.actorUserId, input.idempotencyKey],
      );
      await this.audit(
        client,
        request,
        input.approve ? 'device.enrollment_approved' : 'device.enrollment_denied',
        input.approve ? 'success' : 'denied',
        input.actorUserId,
      );
      await client.query('COMMIT');
      return {
        enrollmentRequestId: request.id,
        state: nextState,
        decidedAt: updated.rows[0].decidedAt.toISOString(),
        pairingSessionId: request.pairingSessionId,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Read-only twin of the `pollPairing` lookup, for the realtime handshake. It
   * takes no row lock, counts no attempt, and writes no state: a socket that
   * reconnects must not consume the 240-attempt budget that guards the poll
   * route, and must not move a request toward `expired` or `credential_delivered`.
   */
  async findPairingSessionForRealtime(input: {
    pairingSessionId: string;
    pollingCredentialHash: string;
    installationHash: string;
  }): Promise<{ pairingSessionId: string; requestId: string; expiresAt: Date } | null> {
    const result = await this.pg.worker.query<{
      requestId: string;
      installationHash: string;
      expiresAt: Date;
      pollingAttempts: number;
    }>(
      `SELECT r.id::text AS "requestId", r.installation_hash AS "installationHash",
              r.expires_at AS "expiresAt", s.polling_attempts AS "pollingAttempts"
       FROM runtime.device_pairing_session s
       JOIN runtime.device_enrollment_request r ON r.id = s.enrollment_request_id
       WHERE s.id = $1::uuid AND s.polling_credential_hash = $2`,
      [input.pairingSessionId, input.pollingCredentialHash],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.installationHash !== input.installationHash ||
      row.pollingAttempts >= 240 ||
      row.expiresAt.getTime() <= Date.now()
    ) {
      return null;
    }
    return {
      pairingSessionId: input.pairingSessionId,
      requestId: row.requestId,
      expiresAt: row.expiresAt,
    };
  }

  async pollPairing(input: {
    pairingSessionId: string;
    pollingCredentialHash: string;
    installationHash: string;
  }): Promise<{
    requestId: string;
    state: DevicePairingPollResponse['state'];
    expiresAt: Date;
    device: DeviceSummary | null;
  } | null> {
    const client = await this.pg.worker.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<PairingRequestRow & { pollingAttempts: number }>(
        `SELECT r.id::text, r.merchant_id::text AS "businessId",
                r.location_id::text AS "locationId", r.display_name AS "displayName",
                r.device_kind AS "deviceKind", r.platform, r.requested_platform AS "requestedPlatform",
                r.mobility, r.state, r.attempts, r.installation_hash AS "installationHash",
                r.expires_at AS "expiresAt", s.id::text AS "pairingSessionId",
                r.device_id::text AS "deviceId",
                r.replaces_device_id::text AS "replacesDeviceId",
                s.polling_attempts AS "pollingAttempts"
         FROM runtime.device_pairing_session s
         JOIN runtime.device_enrollment_request r ON r.id = s.enrollment_request_id
         WHERE s.id = $1::uuid AND s.polling_credential_hash = $2
         FOR UPDATE OF r, s`,
        [input.pairingSessionId, input.pollingCredentialHash],
      );
      const request = selected.rows[0];
      if (
        !request ||
        request.installationHash !== input.installationHash ||
        request.pollingAttempts >= 240
      ) {
        await client.query('ROLLBACK');
        return null;
      }
      let state = request.state as DevicePairingPollResponse['state'];
      if (
        request.expiresAt.getTime() <= Date.now() &&
        ['created', 'awaiting_approval'].includes(state)
      ) {
        state = 'expired';
        await client.query(
          `UPDATE runtime.device_enrollment_request
           SET state = 'expired', updated_at = now() WHERE id = $1::uuid`,
          [request.id],
        );
        await this.audit(client, request, 'device.enrollment_expired', 'denied', null);
      }
      await client.query(
        `UPDATE runtime.device_pairing_session
         SET polling_attempts = polling_attempts + 1, last_polled_at = now(),
             credential_delivered_at = CASE
               WHEN $2 IN ('credential_ready', 'credential_delivered')
               THEN coalesce(credential_delivered_at, now())
               ELSE credential_delivered_at
             END
         WHERE id = $1::uuid`,
        [input.pairingSessionId, state],
      );
      if (state === 'credential_ready') {
        await client.query(
          `UPDATE runtime.device_enrollment_request
           SET state = 'credential_delivered', updated_at = now() WHERE id = $1::uuid`,
          [request.id],
        );
        state = 'credential_delivered';
        await this.audit(client, request, 'device.credential_delivered', 'success', null);
      }
      let device: DeviceSummary | null = null;
      if (
        request.deviceId &&
        ['credential_ready', 'credential_delivered', 'completed'].includes(state)
      ) {
        const result = await client.query<DeviceSummary>(
          `SELECT ${DEVICE_PROJECTION}
           FROM merchant.device d WHERE d.id = $1::uuid AND d.merchant_id = $2::uuid`,
          [request.deviceId, request.businessId],
        );
        device = result.rows[0] ?? null;
      }
      await client.query('COMMIT');
      return { requestId: request.id, state, expiresAt: request.expiresAt, device };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async acknowledgePairing(input: {
    pairingSessionId: string;
    pollingCredentialHash: string;
    installationHash: string;
    credentialHash: string;
  }): Promise<DevicePairingAcknowledgement | null> {
    const client = await this.pg.worker.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<PairingRequestRow>(
        `SELECT r.id::text, r.merchant_id::text AS "businessId",
                r.location_id::text AS "locationId", r.display_name AS "displayName",
                r.device_kind AS "deviceKind", r.platform, r.requested_platform AS "requestedPlatform",
                r.mobility, r.state, r.attempts, r.installation_hash AS "installationHash",
                r.expires_at AS "expiresAt", s.id::text AS "pairingSessionId",
                r.device_id::text AS "deviceId",
                r.replaces_device_id::text AS "replacesDeviceId"
         FROM runtime.device_pairing_session s
         JOIN runtime.device_enrollment_request r ON r.id = s.enrollment_request_id
         JOIN merchant.device d ON d.id = r.device_id
         WHERE s.id = $1::uuid AND s.polling_credential_hash = $2
           AND r.installation_hash = $3 AND d.credential_hash = $4
         FOR UPDATE OF r, s`,
        [
          input.pairingSessionId,
          input.pollingCredentialHash,
          input.installationHash,
          input.credentialHash,
        ],
      );
      const request = result.rows[0];
      if (!request || !['credential_delivered', 'completed'].includes(request.state)) {
        await client.query('ROLLBACK');
        return null;
      }
      const completed = await client.query<{ completedAt: Date }>(
        `UPDATE runtime.device_enrollment_request
         SET state = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now()
         WHERE id = $1::uuid
         RETURNING completed_at AS "completedAt"`,
        [request.id],
      );
      await client.query(
        `UPDATE runtime.device_pairing_session
         SET acknowledged_at = coalesce(acknowledged_at, now())
         WHERE id = $1::uuid`,
        [input.pairingSessionId],
      );
      if (request.state !== 'completed') {
        await this.audit(client, request, 'device.enrollment_completed', 'success', null);
      }
      await client.query('COMMIT');
      return {
        pairingSessionId: input.pairingSessionId,
        state: 'completed',
        completedAt: completed.rows[0].completedAt.toISOString(),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async audit(
    client: PoolClient,
    request: Pick<PairingRequestRow, 'id' | 'businessId' | 'locationId'>,
    eventType: string,
    outcome: 'success' | 'denied' | 'failure',
    actorUserId: string | null,
    metadata: Record<string, string> = {},
  ): Promise<void> {
    await client.query(
      `INSERT INTO runtime.security_audit_event
         (actor_user_id, merchant_id, location_id, event_type, entity_type, entity_id,
          outcome, metadata)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'device_enrollment_request',
               $5::uuid, $6, $7::jsonb)`,
      [
        actorUserId,
        request.businessId,
        request.locationId,
        eventType,
        request.id,
        outcome,
        JSON.stringify(metadata),
      ],
    );
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
        `SELECT id::text, merchant_id::text AS "businessId", location_id::text AS "locationId",
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
        `INSERT INTO merchant.device AS d
           (merchant_id, location_id, name, kind, status, platform,
            installation_hash, credential_hash, credential_version)
         VALUES ($1::uuid, $2::uuid, $3, $4, 'active', $5, $6, $7, 1)
         RETURNING ${DEVICE_PROJECTION}`,
        [
          challenge.businessId,
          challenge.locationId,
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
          `UPDATE merchant.device
           SET status = 'replaced', revoked_at = now(),
               revocation_reason = 'replaced', replacement_device_id = $2::uuid,
               credential_hash = null, updated_at = now()
           WHERE id = $1::uuid AND merchant_id = $3::uuid
             AND status NOT IN ('revoked','replaced')`,
          [challenge.replacesDeviceId, inserted.rows[0].id, challenge.businessId],
        );
      }
      await client.query(
        `INSERT INTO runtime.security_audit_event
           (actor_user_id, merchant_id, location_id, event_type, entity_type, entity_id, outcome)
         SELECT created_by, merchant_id, location_id, 'device.enrollment_completed',
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
      `UPDATE merchant.device AS d SET last_seen_at = now(), updated_at = now()
       WHERE d.public_id = $1::uuid
         AND d.installation_hash = $2
         AND d.credential_hash = $3
         AND d.status IN ('active','rotation_required')
       RETURNING ${DEVICE_PROJECTION}`,
      [publicId, installationHash, credentialHash],
    );
    return rows[0] ?? null;
  }

  async rotate(
    client: PoolClient,
    merchantId: string,
    deviceId: string,
    currentVersion: number,
    credentialHash: string,
  ): Promise<DeviceSummary | null> {
    const { rows } = await client.query<DeviceSummary>(
      `UPDATE merchant.device AS d
         SET credential_hash = $4, credential_version = credential_version + 1,
             status = 'active', updated_at = now()
         WHERE id = $2::uuid AND merchant_id = $1::uuid
           AND credential_version = $3 AND status IN ('active','rotation_required')
       RETURNING ${DEVICE_PROJECTION}`,
      [merchantId, deviceId, currentVersion, credentialHash],
    );
    return rows[0] ?? null;
  }

  async revoke(
    client: PoolClient,
    merchantId: string,
    deviceId: string,
    reason: string,
  ): Promise<DeviceSummary | null> {
    const { rows } = await client.query<DeviceSummary>(
      `UPDATE merchant.device AS d
         SET status = 'revoked', revoked_at = now(),
             revocation_reason = $3, credential_hash = null, updated_at = now()
         WHERE id = $2::uuid AND merchant_id = $1::uuid
           AND status NOT IN ('revoked','replaced')
       RETURNING ${DEVICE_PROJECTION}`,
      [merchantId, deviceId, reason],
    );
    return rows[0] ?? null;
  }
}
