import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  ConflictClassification,
  OfficialCommitResult,
  OfflineCommand,
  ReplayResult,
} from '@umi/contract';
import type { QueryResultRow } from 'pg';
import { PgService } from '../../shared/database/pg.service';
import { getRequestContext } from '../../shared/database/request-context';

@Injectable()
export class PosOfflineRepository {
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

  async acquireReplayLock(deviceId: string, credentialVersion: number) {
    const client = await this.pg.app.connect();
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
    userId: string;
    deviceId: string;
    merchantId: string;
    locationId: string;
    operatorSessionId: string;
    credentialVersion: number;
  }) {
    const { rows } = await this.scopedQuery<{
      lifecycle: string;
      credentialVersion: number;
      permissions: string[];
      entitlements: Array<{ featureKey?: string; enabled?: boolean }>;
      deviceKind: string;
      currency: string;
      lastAcceptedSequence: string;
      lastProcessedSequence: string;
    }>(
      input.merchantId,
      input.locationId,
      `SELECT d.status AS lifecycle, d.credential_version AS "credentialVersion",
              os.permissions, os.entitlements, d.kind AS "deviceKind", b.currency,
              COALESCE(c.last_accepted_sequence, 0)::text AS "lastAcceptedSequence",
              COALESCE(
                c.last_processed_sequence,
                c.last_accepted_sequence,
                0
              )::text AS "lastProcessedSequence"
       FROM merchant.device d
       JOIN merchant.merchant b ON b.id=d.merchant_id
       JOIN runtime.operator_session os ON os.id=$5::uuid AND os.user_id=$1::uuid
        AND os.device_id=d.id AND os.merchant_id=$3::uuid AND os.location_id=$4::uuid
        AND os.ended_at IS NULL AND os.expires_at > now()
       LEFT JOIN merchant.device_replay_cursor c
        ON c.device_id=d.id AND c.credential_version=$6
       WHERE d.id=$2::uuid AND d.merchant_id=$3::uuid
        AND (d.location_id IS NULL OR d.location_id=$4::uuid)`,
      [
        input.userId,
        input.deviceId,
        input.merchantId,
        input.locationId,
        input.operatorSessionId,
        input.credentialVersion,
      ],
    );
    return rows[0]
      ? {
          ...rows[0],
          lastAcceptedSequence: Number(rows[0].lastAcceptedSequence),
          lastProcessedSequence: Number(rows[0].lastProcessedSequence),
        }
      : null;
  }

  async policy(merchantId: string, locationId: string) {
    const { rows } = await this.scopedQuery<{
      id: string;
      enabled: boolean;
      version: string;
      currency: string;
      issuedAt: Date;
      expiresAt: Date;
      maxPolicyAgeSeconds: number;
      maxSingleSaleMinorUnits: string;
      maxAccumulatedMinorUnits: string;
      maxOfflineSaleCount: number;
      maxActiveQueueDepth: number;
      maxCommandAgeSeconds: number;
      maxCatalogAgeSeconds: number;
      maxPricingAgeSeconds: number;
      maxTaxAgeSeconds: number;
      managerApprovalThresholdMinorUnits: string | null;
      allowedDeviceClasses: string[];
    }>(
      merchantId,
      locationId,
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
       FROM merchant.pos_offline_cash_policy
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid`,
      [merchantId, locationId],
    );
    return rows[0] ?? null;
  }

  async replay(
    command: OfflineCommand,
    officialCommit: OfficialCommitResult | null = null,
    officialId: string | null = null,
    replayOperatorSessionId: string = command.operatorSessionId,
    streamKey: string | null = null,
  ): Promise<ReplayResult> {
    const provisionalId = normalizeProvisionalId(command.provisionalId);
    return this.pg.runWithMerchant(
      command.merchantId,
      getRequestContext()?.userId ?? null,
      async (client) => {
        const existing = await client.query<{ fingerprint: string; result: ReplayResult }>(
          `SELECT fingerprint, result FROM merchant.offline_replay_command
         WHERE command_id=$1::uuid`,
          [command.commandId],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].fingerprint !== command.fingerprint) {
            return this.recordConflict(command, 'fingerprint_mismatch', true);
          }
          return existing.rows[0].result.status === 'accepted'
            ? { ...existing.rows[0].result, status: 'duplicate' }
            : existing.rows[0].result;
        }
        await client.query(
          `INSERT INTO merchant.device_replay_cursor
          (merchant_id,location_id,device_id,credential_version)
         VALUES ($1,$2,$3,$4) ON CONFLICT (device_id,credential_version) DO NOTHING`,
          [
            command.merchantId,
            command.locationId,
            command.deviceId,
            command.deviceCredentialVersion,
          ],
        );
        const cursor = await client.query<{ lastAccepted: string; lastProcessed: string }>(
          `SELECT last_accepted_sequence::text AS "lastAccepted",
                  last_processed_sequence::text AS "lastProcessed"
           FROM merchant.device_replay_cursor
         WHERE device_id=$1::uuid AND credential_version=$2 FOR UPDATE`,
          [command.deviceId, command.deviceCredentialVersion],
        );
        const lastProcessed = Number(cursor.rows[0]?.lastProcessed ?? 0);
        if (command.deviceSequence > lastProcessed + 1) {
          return this.recordConflict(command, 'sequence_gap', true);
        }
        if (command.deviceSequence <= lastProcessed) {
          const resolvedConflict = await client.query<{ found: boolean }>(
            `SELECT true AS found
             FROM merchant.offline_replay_conflict
             WHERE merchant_id=$1::uuid AND device_id=$2::uuid
               AND credential_version=$3 AND command_id=$4::uuid
               AND resolution_state='resolved'
             LIMIT 1`,
            [
              command.merchantId,
              command.deviceId,
              command.deviceCredentialVersion,
              command.commandId,
            ],
          );
          if (!resolvedConflict.rows[0]?.found) {
            return this.recordConflict(command, 'sequence_behind', true);
          }
        }
        const result: ReplayResult = {
          commandId: command.commandId,
          deviceSequence: command.deviceSequence,
          status: 'accepted',
          officialId: officialCommit?.officialSaleId ?? officialId,
          officialCommit,
          serverConflictReference: null,
          failure: null,
        };
        await client.query(
          `INSERT INTO merchant.offline_replay_command
         (merchant_id,location_id,device_id,credential_version,device_sequence,command_id,
          operator_session_id,replay_operator_session_id,idempotency_key,command_type,
          fingerprint,contract_version,schema_version,client_created_at,result,
          provisional_id,payload,stream_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [
            command.merchantId,
            command.locationId,
            command.deviceId,
            command.deviceCredentialVersion,
            command.deviceSequence,
            command.commandId,
            command.operatorSessionId,
            replayOperatorSessionId,
            command.idempotencyKey,
            command.commandType,
            command.fingerprint,
            command.contractVersion,
            command.schemaVersion,
            command.createdAt,
            JSON.stringify(result),
            provisionalId,
            JSON.stringify(command.payload),
            streamKey,
          ],
        );
        await client.query(
          `UPDATE merchant.device_replay_cursor
           SET last_accepted_sequence=GREATEST(last_accepted_sequence,$3),
               last_processed_sequence=GREATEST(last_processed_sequence,$3),
               updated_at=clock_timestamp()
         WHERE device_id=$1::uuid AND credential_version=$2`,
          [command.deviceId, command.deviceCredentialVersion, command.deviceSequence],
        );
        await client.query(
          `UPDATE merchant.offline_replay_conflict
              SET resolution_state='resolved',
                  resolution_acknowledged_at=COALESCE(resolution_acknowledged_at, clock_timestamp()),
                  last_observed_at=clock_timestamp()
            WHERE merchant_id=$1::uuid AND device_id=$2::uuid AND command_id=$3::uuid
              AND resolution_state <> 'resolved'`,
          [command.merchantId, command.deviceId, command.commandId],
        );
        if (officialCommit && provisionalId) {
          await client.query(
            `INSERT INTO merchant.offline_provisional_mapping
            (merchant_id,location_id,device_id,command_id,provisional_id,official_sale_id,
             official_receipt_id,official_receipt_number,reconciliation_reference)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (merchant_id,provisional_id) DO NOTHING`,
            [
              command.merchantId,
              command.locationId,
              command.deviceId,
              command.commandId,
              provisionalId,
              officialCommit.officialSaleId,
              officialCommit.officialReceiptId,
              officialCommit.officialReceiptNumber,
              officialCommit.reconciliationReference,
            ],
          );
          const mapping = await client.query<{ officialSaleId: string }>(
            `SELECT official_sale_id::text AS "officialSaleId"
           FROM merchant.offline_provisional_mapping
           WHERE merchant_id=$1 AND provisional_id=$2`,
            [command.merchantId, provisionalId],
          );
          if (mapping.rows[0]?.officialSaleId !== officialCommit.officialSaleId) {
            throw new Error('PROVISIONAL_MAPPING_CONFLICT');
          }
        }
        await client.query(
          `INSERT INTO merchant.audit_event
          (merchant_id,location_id,command_id,event_type,entity_type,entity_id,outcome,
           public_data,correlation_id,event_hash)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'offline.replay.accepted',
          'offline_command',$3::uuid,'success',
          jsonb_build_object(
            'commandType',$4::text,
            'deviceSequence',$5::bigint,
            'originDeviceId',$6::text,
            'originOperatorSessionId',$7::text
          ),$3::text,'')`,
          [
            command.merchantId,
            command.locationId,
            command.commandId,
            command.commandType,
            command.deviceSequence,
            command.originDeviceId ?? null,
            command.originOperatorSessionId ?? null,
          ],
        );
        return result;
      },
      command.locationId,
    );
  }

  async cashExposure(
    merchantId: string,
    locationId: string,
    deviceId: string,
    policyFingerprint: string,
  ) {
    const { rows } = await this.scopedQuery<{ count: string; amount: string }>(
      merchantId,
      locationId,
      `SELECT count(*)::text AS count,
              COALESCE(sum((payload->'snapshot'->>'amountDueMinorUnits')::bigint),0)::text
                AS amount
       FROM merchant.offline_replay_command
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND device_id=$3::uuid
        AND command_type='pos.checkout.cash'
        AND payload->>'policyFingerprint'=$4`,
      [merchantId, locationId, deviceId, policyFingerprint],
    );
    return {
      count: Number(rows[0]?.count ?? 0),
      amount: Number(rows[0]?.amount ?? 0),
    };
  }

  async commandResult(
    merchantId: string,
    locationId: string,
    deviceId: string,
    credentialVersion: number,
    commandId: string,
  ) {
    const { rows } = await this.scopedQuery<{ result: ReplayResult }>(
      merchantId,
      locationId,
      `SELECT result FROM merchant.offline_replay_command
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND device_id=$3::uuid
        AND credential_version=$4 AND command_id=$5::uuid`,
      [merchantId, locationId, deviceId, credentialVersion, commandId],
    );
    if (rows[0]?.result) return rows[0].result;
    const conflict = await this.scopedQuery<{
      commandId: string;
      deviceSequence: string;
      classification: ConflictClassification;
      blocksFollowing: boolean;
      operatorActionRequired: boolean;
      managerActionRequired: boolean;
      guidanceCode: string;
      correlationId: string;
      officialId: string | null;
      retryable: boolean;
      id: string;
    }>(
      merchantId,
      locationId,
      `SELECT command_id::text AS "commandId",
              device_sequence::text AS "deviceSequence",
              classification,blocks_following AS "blocksFollowing",
              operator_action_required AS "operatorActionRequired",
              manager_action_required AS "managerActionRequired",
              guidance_code AS "guidanceCode",
              correlation_id AS "correlationId",
              official_id::text AS "officialId",
              retryable,id::text
       FROM merchant.offline_replay_conflict
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid
         AND device_id=$3::uuid AND credential_version=$4
         AND command_id=$5::uuid
       LIMIT 1`,
      [merchantId, locationId, deviceId, credentialVersion, commandId],
    );
    const row = conflict.rows[0];
    if (!row) return null;
    return {
      commandId: row.commandId,
      deviceSequence: Number(row.deviceSequence),
      status: 'conflict' as const,
      officialId: row.officialId,
      officialCommit: null,
      serverConflictReference: row.id,
      failure: {
        classification: row.classification,
        retryable: row.retryable,
        blocksFollowing: row.blocksFollowing,
        operatorActionRequired: row.operatorActionRequired,
        managerActionRequired: row.managerActionRequired,
        guidanceCode: row.guidanceCode,
        correlationId: row.correlationId,
      },
    };
  }

  async diagnostics(merchantId: string, deviceId: string, credentialVersion: number) {
    const { rows } = await this.scopedQuery<{
      lastAcceptedSequence: string;
      lastProcessedSequence: string;
      acceptedCount: string;
      lastReplayAt: Date | null;
    }>(
      merchantId,
      getRequestContext()?.locationId ?? '',
      `SELECT COALESCE(c.last_accepted_sequence,0)::text AS "lastAcceptedSequence",
              COALESCE(c.last_processed_sequence,0)::text AS "lastProcessedSequence",
              count(r.command_id)::text AS "acceptedCount", max(r.accepted_at) AS "lastReplayAt"
       FROM merchant.device_replay_cursor c
       LEFT JOIN merchant.offline_replay_command r ON r.device_id=c.device_id
        AND r.credential_version=c.credential_version
       WHERE c.merchant_id=$1::uuid AND c.device_id=$2::uuid AND c.credential_version=$3
       GROUP BY c.last_accepted_sequence,c.last_processed_sequence`,
      [merchantId, deviceId, credentialVersion],
    );
    return (
      rows[0] ?? {
        lastAcceptedSequence: '0',
        lastProcessedSequence: '0',
        acceptedCount: '0',
        lastReplayAt: null,
      }
    );
  }

  async acknowledge(merchantId: string, deviceId: string, reconciliationId: string) {
    const result = await this.scopedQuery<{ acknowledged: boolean; rewound: boolean }>(
      merchantId,
      getRequestContext()?.locationId ?? '',
      `WITH target AS (
         SELECT id, credential_version, summary
         FROM merchant.offline_reconciliation
         WHERE id=$1::uuid AND merchant_id=$2::uuid AND device_id=$3::uuid
           AND acknowledged_at IS NULL
         FOR UPDATE
       ),
       acknowledged AS (
         UPDATE merchant.offline_reconciliation r
         SET acknowledged_at=clock_timestamp()
         FROM target t
         WHERE r.id=t.id
         RETURNING t.credential_version, t.summary
       ),
       rewound AS (
         UPDATE merchant.device_replay_cursor c
         SET last_accepted_sequence=LEAST(
               c.last_accepted_sequence,
               COALESCE((a.summary->>'localLastAcknowledgedSequence')::bigint,
                        c.last_accepted_sequence)
             ),
             updated_at=clock_timestamp()
         FROM acknowledged a
         WHERE c.merchant_id=$2::uuid AND c.device_id=$3::uuid
           AND c.credential_version=a.credential_version
           AND COALESCE((a.summary->>'reconciliationRequired')::boolean,false)
           AND COALESCE((a.summary->>'serverLastAcceptedSequence')::bigint,0)
               > COALESCE((a.summary->>'localLastAcknowledgedSequence')::bigint,0)
           AND NOT EXISTS (
             SELECT 1
             FROM merchant.offline_replay_command r
             WHERE r.merchant_id=$2::uuid AND r.device_id=$3::uuid
               AND r.credential_version=c.credential_version
               AND r.device_sequence >
                   COALESCE((a.summary->>'localLastAcknowledgedSequence')::bigint,0)
           )
         RETURNING 1
       )
       SELECT EXISTS(SELECT 1 FROM acknowledged) AS acknowledged,
              EXISTS(SELECT 1 FROM rewound) AS rewound`,
      [reconciliationId, merchantId, deviceId],
    );
    return result.rows[0]?.acknowledged === true;
  }

  async persistReconciliation(input: {
    merchantId: string;
    locationId: string;
    deviceId: string;
    credentialVersion: number;
    summary: Record<string, unknown>;
  }) {
    const id = randomUUID();
    await this.scopedQuery(
      input.merchantId,
      input.locationId,
      `INSERT INTO merchant.offline_reconciliation
        (id,merchant_id,location_id,device_id,credential_version,summary)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        id,
        input.merchantId,
        input.locationId,
        input.deviceId,
        input.credentialVersion,
        JSON.stringify(input.summary),
      ],
    );
    return id;
  }

  async conflicts(
    merchantId: string,
    locationId: string,
    deviceId: string,
    credentialVersion: number,
  ) {
    const { rows } = await this.scopedQuery<{
      commandId: string;
      deviceSequence: string;
      classification: ConflictClassification;
      blocksFollowing: boolean;
      operatorActionRequired: boolean;
      managerActionRequired: boolean;
      guidanceCode: string;
      correlationId: string;
      officialId: string | null;
      retryable: boolean;
      id: string;
    }>(
      merchantId,
      locationId,
      `SELECT command_id::text AS "commandId",device_sequence::text AS "deviceSequence",
              classification,blocks_following AS "blocksFollowing",
              operator_action_required AS "operatorActionRequired",
              manager_action_required AS "managerActionRequired",guidance_code AS "guidanceCode",
              correlation_id AS "correlationId",official_id::text AS "officialId",
              retryable,id::text
       FROM merchant.offline_replay_conflict
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND device_id=$3::uuid
        AND credential_version=$4
        AND resolution_state <> 'resolved' ORDER BY device_sequence LIMIT 100`,
      [merchantId, locationId, deviceId, credentialVersion],
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
        retryable: row.retryable,
        blocksFollowing: row.blocksFollowing,
        operatorActionRequired: row.operatorActionRequired,
        managerActionRequired: row.managerActionRequired,
        guidanceCode: row.guidanceCode,
        correlationId: row.correlationId,
      },
    }));
  }

  async resolveConflict(
    merchantId: string,
    locationId: string,
    deviceId: string,
    credentialVersion: number,
    commandId: string,
  ) {
    const { rows } = await this.scopedQuery<{
      hasConflict: boolean;
      resolved: boolean;
      deviceSequence: string | null;
      nextAcceptedSequence: string;
      nextProcessedSequence: string;
    }>(
      merchantId,
      locationId,
      `WITH cursor_ready AS (
         INSERT INTO merchant.device_replay_cursor
           (merchant_id,location_id,device_id,credential_version)
         VALUES ($1,$2,$3,$5)
         ON CONFLICT (device_id,credential_version) DO NOTHING
         RETURNING device_id
       ),
       conflict_row AS (
         SELECT id,device_sequence,resolution_state,command_type,stream_key,classification
         FROM merchant.offline_replay_conflict
         WHERE merchant_id=$1::uuid AND location_id=$2::uuid
           AND device_id=$3::uuid AND command_id=$4::uuid
           AND credential_version=$5
         FOR UPDATE
       ),
       cursor_row AS (
         SELECT last_accepted_sequence,last_processed_sequence
         FROM merchant.device_replay_cursor c
         LEFT JOIN cursor_ready ready ON TRUE
         WHERE c.merchant_id=$1::uuid AND c.device_id=$3::uuid
           AND c.credential_version=$5
         FOR UPDATE OF c
       ),
       resolvable AS (
         SELECT c.id,c.device_sequence,c.stream_key,c.classification
         FROM conflict_row c,cursor_row r
         WHERE (
           c.resolution_state='resolved'
           AND r.last_processed_sequence >= c.device_sequence
         ) OR (
           c.resolution_state='open'
           AND (
             r.last_processed_sequence >= c.device_sequence
             OR c.classification='sequence_gap'
           )
           AND c.command_type IN (
             'pos.table.command',
             'pos.cart.table.set',
             'pos.command.group',
             -- A line that never reached a cart is safe to discard. The row
             -- stays in history; only its open state closes. Checkout and
             -- payment commands remain protected.
             'pos.cart.line.add',
             'pos.cart.line.update',
             'pos.cart.line.remove',
             'pos.cart.open',
             'pos.cart.clear',
             'pos.cart.prepare',
             'pos.cart.fire',
             'pos.cart.fulfillment.set'
           )
         )
       ),
       resolved AS (
         UPDATE merchant.offline_replay_conflict c
         SET resolution_state='resolved',
             resolution_acknowledged_at=COALESCE(
               c.resolution_acknowledged_at,
               clock_timestamp()
             ),
             last_observed_at=clock_timestamp()
         FROM resolvable r
         WHERE c.id=r.id AND c.resolution_state='open'
         RETURNING r.device_sequence,r.classification
       ),
       dependents AS (
         UPDATE merchant.offline_replay_conflict c
         SET resolution_state='resolved',
             resolution_acknowledged_at=COALESCE(
               c.resolution_acknowledged_at,
               clock_timestamp()
             ),
             last_observed_at=clock_timestamp()
         FROM resolvable r
         WHERE r.stream_key IS NOT NULL
           AND c.merchant_id=$1::uuid
           AND c.location_id=$2::uuid
           AND c.device_id=$3::uuid
           AND c.credential_version=$5
           AND c.stream_key=r.stream_key
           AND c.classification='stream_blocked'
           AND c.resolution_state <> 'resolved'
         RETURNING c.device_sequence
       ),
       advanced AS (
         UPDATE merchant.device_replay_cursor c
         SET last_accepted_sequence=CASE
               WHEN r.device_sequence=c.last_accepted_sequence + 1
                 OR r.classification='sequence_gap'
               THEN GREATEST(c.last_accepted_sequence,r.device_sequence)
               ELSE c.last_accepted_sequence
             END,
             last_processed_sequence=GREATEST(
               c.last_processed_sequence,
               r.device_sequence
             ),
             updated_at=clock_timestamp()
         FROM resolved r
         WHERE c.merchant_id=$1::uuid AND c.device_id=$3::uuid
           AND c.credential_version=$5
         RETURNING c.last_accepted_sequence
       )
       SELECT EXISTS(SELECT 1 FROM conflict_row) AS "hasConflict",
              EXISTS(SELECT 1 FROM resolvable) AS resolved,
              (SELECT device_sequence::text FROM conflict_row) AS "deviceSequence",
              COALESCE(
                (SELECT last_accepted_sequence::text FROM advanced),
                (SELECT last_accepted_sequence::text FROM cursor_row),
                '0'
              ) AS "nextAcceptedSequence",
              COALESCE(
                (SELECT last_processed_sequence::text FROM cursor_row),
                '0'
              ) AS "nextProcessedSequence"`,
      [merchantId, locationId, deviceId, commandId, credentialVersion],
    );
    const row = rows[0];
    if (!row?.hasConflict) return null;
    return {
      resolved: row.resolved,
      deviceSequence: Number(row.deviceSequence),
      nextAcceptedSequence: Number(row.nextAcceptedSequence),
      nextProcessedSequence: Number(row.nextProcessedSequence),
    };
  }

  async mappings(merchantId: string, locationId: string, deviceId: string) {
    const { rows } = await this.scopedQuery<{
      provisionalId: string;
      officialId: string;
      commandId: string;
    }>(
      merchantId,
      locationId,
      `SELECT provisional_id::text AS "provisionalId",
              official_sale_id::text AS "officialId",
              command_id::text AS "commandId"
       FROM merchant.offline_provisional_mapping
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND device_id=$3::uuid
       ORDER BY mapped_at LIMIT 100`,
      [merchantId, locationId, deviceId],
    );
    return rows;
  }

  /**
   * Resolve a till-side cart identity after the command that created it.
   *
   * Replay batches are bounded. The server keeps the official cart id on the
   * accepted open or group command, so a later batch does not need to guess
   * from whichever account happens to be active now.
   */
  async provisionalCartId(
    merchantId: string,
    locationId: string,
    provisionalId: string,
  ): Promise<string | null> {
    const normalized = normalizeProvisionalId(provisionalId);
    if (normalized == null) return null;
    const { rows } = await this.scopedQuery<{ officialId: string }>(
      merchantId,
      locationId,
      `SELECT result->>'officialId' AS "officialId"
       FROM merchant.offline_replay_command
       WHERE merchant_id=$1::uuid
         AND location_id=$2::uuid
         AND provisional_id=$3
         AND command_type IN ('pos.cart.open','pos.command.group')
         AND result->>'status' IN ('accepted','duplicate')
         AND result->>'officialId' IS NOT NULL
       ORDER BY client_created_at DESC
       LIMIT 1`,
      [merchantId, locationId, normalized],
    );
    return rows[0]?.officialId ?? null;
  }

  async audit(merchantId: string, locationId: string, deviceId: string) {
    const { rows } = await this.scopedQuery<{
      eventCategory: string;
      occurredAt: Date;
      correlationId: string;
      commandReference: string | null;
      sequence: string;
      outcomeCode: string;
    }>(
      merchantId,
      locationId,
      `SELECT a.event_type AS "eventCategory",a.occurred_at AS "occurredAt",
              a.correlation_id AS "correlationId",a.command_id::text AS "commandReference",
              COALESCE(a.public_data->>'deviceSequence','0') AS sequence,
              a.outcome AS "outcomeCode"
       FROM merchant.audit_event a
       WHERE a.merchant_id=$1::uuid AND a.location_id=$2::uuid
        AND a.event_type LIKE 'offline.%'
        AND EXISTS (
          SELECT 1 FROM merchant.offline_replay_command c
          WHERE c.command_id=a.command_id AND c.device_id=$3::uuid
        )
       ORDER BY a.occurred_at DESC LIMIT 100`,
      [merchantId, locationId, deviceId],
    );
    return rows.map((row) => ({
      eventCategory: row.eventCategory,
      occurredAt: row.occurredAt.toISOString(),
      correlationId: row.correlationId,
      commandReference: row.commandReference,
      deviceReference: deviceId,
      sequence: Number(row.sequence),
      locationReference: locationId,
      outcomeCode: row.outcomeCode,
      resolutionStatus: 'recorded',
    }));
  }

  private conflict(
    command: OfflineCommand,
    classification: ConflictClassification,
    blocksFollowing: boolean,
    guidanceCode: string = classification,
    retryable = false,
  ): ReplayResult {
    return {
      commandId: command.commandId,
      deviceSequence: command.deviceSequence,
      status: 'conflict',
      officialId: null,
      officialCommit: null,
      serverConflictReference: null,
      failure: {
        classification,
        retryable,
        blocksFollowing,
        operatorActionRequired: true,
        managerActionRequired: false,
        guidanceCode,
        correlationId: command.commandId,
      },
    };
  }

  async recordConflict(
    command: OfflineCommand,
    classification: ConflictClassification,
    blocksFollowing: boolean,
    guidanceCode: string = classification,
  ): Promise<ReplayResult> {
    const result = this.conflict(command, classification, blocksFollowing, guidanceCode);
    const { rows } = await this.scopedQuery<{ id: string }>(
      command.merchantId,
      command.locationId,
      `SELECT merchant.record_offline_replay_conflict(
         $1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::text,$8,$10::text,
         $9::uuid,$11::text,NULL,false,false
       )::text AS id`,
      [
        command.merchantId,
        command.locationId,
        command.deviceId,
        command.deviceCredentialVersion,
        command.commandId,
        command.deviceSequence,
        classification,
        blocksFollowing,
        normalizeProvisionalId(command.provisionalId),
        guidanceCode,
        command.commandType,
      ],
    );
    return { ...result, serverConflictReference: rows[0].id };
  }

  /**
   * Record a refusal for one account stream and advance the processed cursor.
   *
   * The command remains unaccepted. A later command for a different account can
   * use the next device sequence. The same account stays blocked until an
   * operator resolves the refusal.
   */
  async recordStreamConflict(
    command: OfflineCommand,
    classification: ConflictClassification,
    streamKey: string,
    guidanceCode: string = classification,
    retryable = false,
  ): Promise<ReplayResult> {
    const result = this.conflict(command, classification, false, guidanceCode, retryable);
    const { rows } = await this.scopedQuery<{ id: string }>(
      command.merchantId,
      command.locationId,
      `SELECT merchant.record_offline_replay_conflict(
         $1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::text,false,$8::text,
         $9::uuid,$10::text,$11::text,$12,true
       )::text AS id`,
      [
        command.merchantId,
        command.locationId,
        command.deviceId,
        command.deviceCredentialVersion,
        command.commandId,
        command.deviceSequence,
        classification,
        guidanceCode,
        normalizeProvisionalId(command.provisionalId),
        command.commandType,
        streamKey,
        retryable,
      ],
    );
    return { ...result, serverConflictReference: rows[0].id };
  }

  async hasOpenStreamConflict(
    merchantId: string,
    locationId: string,
    deviceId: string,
    credentialVersion: number,
    streamKey: string,
  ): Promise<boolean> {
    const { rows } = await this.scopedQuery<{ blocked: boolean }>(
      merchantId,
      locationId,
      `SELECT EXISTS(
         SELECT 1
         FROM merchant.offline_replay_conflict
         WHERE merchant_id=$1::uuid
           AND location_id=$2::uuid
           AND device_id=$3::uuid
           AND credential_version=$4
           AND stream_key=$5
           AND resolution_state <> 'resolved'
       ) AS blocked`,
      [merchantId, locationId, deviceId, credentialVersion, streamKey],
    );
    return rows[0]?.blocked === true;
  }

  async hasResolvedConflict(
    merchantId: string,
    locationId: string,
    deviceId: string,
    credentialVersion: number,
    commandId: string,
  ): Promise<boolean> {
    const { rows } = await this.scopedQuery<{ found: boolean }>(
      merchantId,
      locationId,
      `SELECT EXISTS(
         SELECT 1
         FROM merchant.offline_replay_conflict
         WHERE merchant_id=$1::uuid
           AND location_id=$2::uuid
           AND device_id=$3::uuid
           AND credential_version=$4
           AND command_id=$5::uuid
           AND resolution_state='resolved'
       ) AS found`,
      [merchantId, locationId, deviceId, credentialVersion, commandId],
    );
    return rows[0]?.found === true;
  }
}

function normalizeProvisionalId(value: string | null): string | null {
  return value?.startsWith('prov-') ? value.slice('prov-'.length) : value;
}
