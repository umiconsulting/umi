import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  AssignHardwareRequest,
  ControlledReprintRequest,
  ControlledReprintResult,
  HardwareCommandRequest,
  HardwareCommandResult,
  HardwareCommandTransitionRequest,
  HardwareDevice,
  HardwareConnectionConfiguration,
  HardwareDiagnosticRequest,
  HardwareDiagnosticResult,
  HardwareRegistryQuery,
  HardwareRuntimeSnapshot,
  HardwarePilotPolicy,
  HardwarePilotPolicyResult,
  PrintJob,
  ReceiptPrintPayload,
  RegisterHardwareRequest,
  UpdateHardwareRequest,
  UpdateHardwarePolicyRequest,
} from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import { hardwareCommandFingerprint } from './hardware-fingerprint';

export interface HardwareAuthorization {
  operatorId: string;
  deviceId: string;
  credentialVersion: number;
  permissions: string[];
}

interface DeviceRow {
  id: string;
  merchantId: string;
  locationId: string;
  registerId: string | null;
  assignedPosDeviceId: string | null;
  primary: boolean;
  deviceType: HardwareDevice['type'];
  manufacturer: string;
  model: string;
  publicReference: string;
  transport: HardwareDevice['transport'];
  connectionConfiguration: HardwareConnectionConfiguration;
  capabilities: HardwareDevice['capabilities'];
  enabled: boolean;
  configurationVersion: string;
  connectionState: HardwareDevice['connectionState'];
  firmwareVersion: string | null;
  lastHeartbeatAt: Date | string | null;
  lastDiagnosticAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  archivedAt: Date | string | null;
  optimisticVersion: string;
}

interface CommandRow {
  commandId: string;
  commandType: HardwareCommandResult['command']['commandType'];
  targetHardwareId: string;
  merchantId: string;
  locationId: string;
  registerId: string | null;
  originatingPosDeviceId: string;
  operatorId: string;
  sourceAggregateType: string;
  sourceAggregateId: string;
  payloadFingerprint: string;
  idempotencyKey: string;
  expectedConfigurationVersion: number;
  correlationId: string;
  status: HardwareCommandResult['command']['status'];
  createdAt: Date | string;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  failureCode: HardwareCommandResult['command']['failureCode'];
  safeResultMetadata: HardwareCommandResult['command']['safeResultMetadata'];
  safePayload: HardwareCommandResult['dispatchPayload'];
}

const iso = (value: Date | string | null): string | null =>
  value === null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();

const deterministicUuid = (value: string): string => {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
};

@Injectable()
export class PosHardwareRepository {
  constructor(private readonly pg: PgService) {}

  authorize(
    userId: string,
    durableSessionId: string,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    deviceId: string,
    permission: string,
  ): Promise<HardwareAuthorization | null> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const { rows } = await client.query<HardwareAuthorization>(
          `SELECT os.user_id::text AS "operatorId",os.device_id::text AS "deviceId",
                  d.credential_version AS "credentialVersion",os.permissions
             FROM runtime.operator_session os
             JOIN merchant.device d ON d.id=os.device_id AND d.merchant_id=os.merchant_id
            WHERE os.id=$5::uuid AND os.durable_session_id=$2::uuid
              AND os.user_id=$1::uuid AND os.merchant_id=$3::uuid
              AND os.location_id=$4::uuid AND os.device_id=$6::uuid
              AND os.state='active' AND os.expires_at>clock_timestamp()
              AND d.status='active' AND d.credential_version>0
              AND ($7=ANY(os.permissions) OR '*'=ANY(os.permissions))
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(os.entitlements) e
                WHERE e->>'featureKey'='pos' AND coalesce((e->>'enabled')::boolean,false))`,
          [
            userId,
            durableSessionId,
            merchantId,
            locationId,
            operatorSessionId,
            deviceId,
            permission,
          ],
        );
        return rows[0] ?? null;
      },
      locationId,
    );
  }

  async snapshot(
    userId: string,
    merchantId: string,
    query: HardwareRegistryQuery & { operatorSessionId: string },
  ): Promise<HardwareRuntimeSnapshot> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        await client.query(
          `SELECT * FROM merchant.read_hardware_runtime($1::uuid,$2::uuid,$3::uuid,$4::uuid)`,
          [merchantId, query.locationId, query.operatorSessionId, query.registerId ?? null],
        );
        const devices = await this.devices(client, merchantId, query.locationId, query.registerId);
        const printJobs = await this.printJobs(client, merchantId, query.locationId);
        const policy = await this.policy(
          client,
          merchantId,
          query.locationId,
          query.registerId ?? null,
        );
        const unknown = await client.query<{ commandType: string }>(
          `SELECT c.command_type AS "commandType"
             FROM merchant.hardware_command c
             JOIN LATERAL (SELECT status FROM merchant.hardware_command_event e
               WHERE e.merchant_id=c.merchant_id AND e.command_id=c.id
               ORDER BY e.sequence DESC LIMIT 1) e ON true
            WHERE c.merchant_id=$1::uuid AND c.location_id=$2::uuid AND e.status='unknown'
            ORDER BY c.created_at,c.id LIMIT 100`,
          [merchantId, query.locationId],
        );
        return {
          merchantId,
          locationId: query.locationId,
          registerId: query.registerId ?? null,
          policy: policy.policy,
          policyVersion: policy.version,
          devices: query.includeDisabled ? devices : devices.filter((device) => device.enabled),
          printJobs,
          recoveryStates: [
            ...printJobs.map((job) => {
              if (job.status === 'unknown_outcome') return 'unknown_print' as const;
              if (job.status === 'retryable_failure' || job.status === 'terminal_failure') {
                return 'failed_print' as const;
              }
              return 'pending_print' as const;
            }),
            ...unknown.rows.map((row) =>
              row.commandType === 'open_drawer'
                ? ('drawer_unknown' as const)
                : ('disconnected' as const),
            ),
          ].slice(0, 100),
          pendingJobs: printJobs.filter((job) => ['queued', 'printing'].includes(job.status))
            .length,
          retryableJobs: printJobs.filter((job) => job.status === 'retryable_failure').length,
          unknownCommands: unknown.rowCount ?? 0,
          capturedAt: new Date().toISOString(),
        };
      },
      query.locationId,
    );
  }

  async register(
    client: PoolClient,
    merchantId: string,
    operatorSessionId: string,
    dto: RegisterHardwareRequest,
  ): Promise<HardwareDevice> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT merchant.register_hardware_device($1::jsonb)::text AS id`,
      [
        {
          merchantId,
          locationId: dto.locationId,
          operatorSessionId,
          registerId: dto.registerId,
          assignedPosDeviceId: dto.assignedPosDeviceId,
          deviceType: dto.type,
          manufacturer: dto.manufacturer,
          model: dto.model,
          publicReference: dto.publicReference,
          transport: dto.transport,
          capabilities: dto.capabilities,
          connectionConfiguration: dto.connectionConfiguration,
        },
      ],
    );
    return this.device(client, merchantId, rows[0].id);
  }

  async update(
    client: PoolClient,
    merchantId: string,
    hardwareId: string,
    dto: UpdateHardwareRequest,
  ): Promise<HardwareDevice> {
    await client.query(`SELECT merchant.update_hardware_device($1::jsonb)`, [
      {
        merchantId,
        hardwareId,
        locationId: dto.locationId,
        operatorSessionId: dto.operatorSessionId,
        expectedVersion: dto.expectedVersion,
        enabled: dto.enabled,
        connectionConfiguration: dto.connectionConfiguration,
      },
    ]);
    return this.device(client, merchantId, hardwareId);
  }

  async updatePolicy(
    client: PoolClient,
    merchantId: string,
    dto: UpdateHardwarePolicyRequest,
  ): Promise<HardwarePilotPolicyResult> {
    await client.query(`SELECT merchant.update_hardware_pilot_policy($1::jsonb)`, [
      {
        merchantId,
        locationId: dto.locationId,
        registerId: dto.registerId,
        operatorSessionId: dto.operatorSessionId,
        expectedVersion: dto.expectedVersion,
        policy: dto.policy,
      },
    ]);
    return this.policy(client, merchantId, dto.locationId, dto.registerId);
  }

  async assign(
    client: PoolClient,
    merchantId: string,
    hardwareId: string,
    dto: AssignHardwareRequest & { operatorSessionId: string },
  ): Promise<HardwareDevice> {
    await client.query(`SELECT merchant.assign_hardware_device($1::jsonb)`, [
      {
        merchantId,
        hardwareId,
        locationId: dto.locationId,
        operatorSessionId: dto.operatorSessionId,
        registerId: dto.registerId,
        assignedPosDeviceId: dto.assignedPosDeviceId,
        primary: dto.primary,
        expectedVersion: dto.expectedVersion,
      },
    ]);
    return this.device(client, merchantId, hardwareId);
  }

  async createCommand(
    client: PoolClient,
    merchantId: string,
    authorization: HardwareAuthorization,
    dto: HardwareCommandRequest,
    correlationId: string,
  ): Promise<HardwareCommandResult> {
    const printPayload =
      dto.commandType === 'print_receipt'
        ? await this.authoritativePrintPayload(
            client,
            merchantId,
            dto.locationId,
            dto.sourceAggregateId,
          )
        : dto.printPayload;
    const canonical = { ...dto, printPayload };
    const payloadFingerprint = hardwareCommandFingerprint(canonical);
    await client.query(`SELECT merchant.create_hardware_command($1::jsonb)`, [
      {
        merchantId,
        locationId: dto.locationId,
        operatorSessionId: dto.operatorSessionId,
        registerId: dto.registerId,
        commandId: dto.commandId,
        idempotencyKey: dto.idempotencyKey,
        hardwareId: dto.targetHardwareId,
        commandType: dto.commandType,
        sourceAggregateType: dto.sourceAggregateType,
        sourceAggregateId: dto.sourceAggregateId,
        configurationVersion: dto.expectedConfigurationVersion,
        payloadFingerprint,
        correlationId,
        printJobId: dto.commandId,
        safePayload: {
          drawer: dto.drawer,
          display: dto.display,
          printPayload,
          credentialVersion: authorization.credentialVersion,
        },
      },
    ]);
    return this.commandResult(client, merchantId, dto.commandId, false);
  }

  async transition(
    userId: string,
    merchantId: string,
    commandId: string,
    dto: HardwareCommandTransitionRequest,
  ): Promise<HardwareCommandResult> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        await client.query(
          `SELECT merchant.transition_hardware_command(
             $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::jsonb
           )`,
          [
            merchantId,
            dto.locationId,
            dto.operatorSessionId,
            commandId,
            dto.status,
            dto.failureCode,
            dto.safeResultMetadata,
          ],
        );
        return this.commandResult(client, merchantId, commandId, false);
      },
      dto.locationId,
    );
  }

  currentCommand(
    userId: string,
    merchantId: string,
    locationId: string,
    commandId: string,
  ): Promise<HardwareCommandResult> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      (client) => this.commandResult(client, merchantId, commandId, true),
      locationId,
    );
  }

  printJobCommand(
    userId: string,
    merchantId: string,
    locationId: string,
    jobId: string,
  ): Promise<HardwareCommandResult> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const { rows } = await client.query<{ commandId: string }>(
          `SELECT command_id::text AS "commandId" FROM merchant.hardware_print_job
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND id=$3::uuid`,
          [merchantId, locationId, jobId],
        );
        if (!rows[0]) throw new Error('HARDWARE_PRINT_JOB_NOT_FOUND');
        return this.commandResult(client, merchantId, rows[0].commandId, true);
      },
      locationId,
    );
  }

  async reprint(
    client: PoolClient,
    merchantId: string,
    jobId: string,
    dto: ControlledReprintRequest,
    correlationId: string,
  ): Promise<ControlledReprintResult> {
    const newJobId = dto.commandId;
    const dispatchCommandId = deterministicUuid(`hardware-reprint:${dto.commandId}`);
    const dispatchIdempotencyKey = `hardware-reprint-dispatch-${dto.commandId}`;
    const original = await this.printJobSource(client, merchantId, jobId, dto.locationId);
    const command: HardwareCommandRequest = {
      locationId: dto.locationId,
      registerId: original.registerId,
      operatorSessionId: dto.operatorSessionId,
      commandId: dispatchCommandId,
      idempotencyKey: dispatchIdempotencyKey,
      targetHardwareId: original.targetPrinterId,
      commandType: 'controlled_reprint',
      sourceAggregateType: original.sourceAggregateType,
      sourceAggregateId: original.sourceAggregateId,
      expectedConfigurationVersion: original.configurationVersion,
      payloadFingerprint: '0'.repeat(64),
      drawer: null,
      display: null,
      printPayload: original.printPayload,
    };
    command.payloadFingerprint = hardwareCommandFingerprint(command);
    await client.query(
      `SELECT merchant.create_controlled_reprint(
         $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,$10
       )`,
      [
        merchantId,
        dto.locationId,
        dto.operatorSessionId,
        jobId,
        newJobId,
        dispatchCommandId,
        dispatchIdempotencyKey,
        dto.reason,
        correlationId,
        command.payloadFingerprint,
      ],
    );
    return { job: await this.printJob(client, merchantId, newJobId), command };
  }

  async diagnostic(
    client: PoolClient,
    merchantId: string,
    dto: HardwareDiagnosticRequest,
    correlationId: string,
  ): Promise<HardwareDiagnosticResult> {
    const diagnosticId = dto.commandId;
    await client.query(`SELECT merchant.record_hardware_diagnostic($1::jsonb)`, [
      {
        merchantId,
        locationId: dto.locationId,
        operatorSessionId: dto.operatorSessionId,
        diagnosticId,
        hardwareId: dto.hardwareId,
        diagnostic: dto.diagnostic,
        health: dto.health,
        connectionState: dto.connectionState,
        latencyMs: dto.latencyMs,
        failureCode: dto.failureCode,
        correlationId,
        safeResult: dto.safeResult,
      },
    ]);
    const { rows } = await client.query<{
      diagnosticId: string;
      hardwareId: string;
      diagnostic: HardwareDiagnosticResult['diagnostic'];
      health: HardwareDiagnosticResult['health'];
      connectionState: HardwareDiagnosticResult['connectionState'];
      capabilities: HardwareDiagnosticResult['capabilities'];
      latencyMs: number | null;
      failureCode: string | null;
      occurredAt: Date | string;
      correlationId: string;
    }>(
      `SELECT id::text AS "diagnosticId",hardware_id::text AS "hardwareId",
              diagnostic_type AS diagnostic,health,connection_state AS "connectionState",
              capability_snapshot AS capabilities,latency_ms AS "latencyMs",
              failure_code AS "failureCode",occurred_at AS "occurredAt",correlation_id AS "correlationId"
         FROM merchant.hardware_diagnostic WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, diagnosticId],
    );
    const row = rows[0];
    return {
      diagnosticId: row.diagnosticId,
      hardwareId: row.hardwareId,
      diagnostic: row.diagnostic,
      health: row.health,
      connectionState: row.connectionState,
      capabilities: row.capabilities,
      latencyMs: row.latencyMs,
      failure:
        row.failureCode === null
          ? null
          : {
              code: row.failureCode as HardwareDiagnosticResult['failure'] extends infer F
                ? F extends { code: infer C }
                  ? C
                  : never
                : never,
              retryable: [
                'disconnected',
                'busy',
                'transport_unavailable',
                'command_timeout',
                'retryable_transport_failure',
              ].includes(row.failureCode),
              operatorGuidance: 'review_hardware_status',
              safeDetail: null,
              correlationId: row.correlationId,
            },
      occurredAt: iso(row.occurredAt)!,
      correlationId: row.correlationId,
    };
  }

  private async device(client: PoolClient, merchantId: string, hardwareId: string) {
    const { rows } = await client.query<DeviceRow>(
      `${this.deviceSelect()} WHERE d.merchant_id=$1::uuid AND d.id=$2::uuid`,
      [merchantId, hardwareId],
    );
    return this.mapDevice(rows[0]);
  }

  private async devices(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    registerId?: string,
  ) {
    const { rows } = await client.query<DeviceRow>(
      `${this.deviceSelect()} WHERE d.merchant_id=$1::uuid AND d.location_id=$2::uuid
        AND ($3::uuid IS NULL OR d.register_id=$3::uuid) AND d.archived_at IS NULL
        ORDER BY d.device_type,d.public_reference LIMIT 100`,
      [merchantId, locationId, registerId ?? null],
    );
    return rows.map((row) => this.mapDevice(row));
  }

  private deviceSelect() {
    return `SELECT d.id::text,d.merchant_id::text AS "merchantId",d.location_id::text AS "locationId",
      d.register_id::text AS "registerId",d.assigned_pos_device_id::text AS "assignedPosDeviceId",
      coalesce(a.primary_device,false) AS primary,
      d.device_type AS "deviceType",d.manufacturer,d.model,d.public_reference AS "publicReference",
      d.transport,d.connection_configuration AS "connectionConfiguration",
      d.capabilities,d.enabled,d.configuration_version::text AS "configurationVersion",
      d.connection_state AS "connectionState",d.firmware_version AS "firmwareVersion",
      d.last_heartbeat_at AS "lastHeartbeatAt",d.last_diagnostic_at AS "lastDiagnosticAt",
      d.created_at AS "createdAt",d.updated_at AS "updatedAt",d.archived_at AS "archivedAt",
      d.optimistic_version::text AS "optimisticVersion" FROM merchant.hardware_device d
      LEFT JOIN merchant.hardware_assignment a ON a.merchant_id=d.merchant_id
        AND a.hardware_id=d.id AND a.released_at IS NULL`;
  }

  private mapDevice(row: DeviceRow): HardwareDevice {
    return {
      id: row.id,
      merchantId: row.merchantId,
      locationId: row.locationId,
      registerId: row.registerId,
      assignedPosDeviceId: row.assignedPosDeviceId,
      primary: row.primary,
      type: row.deviceType,
      manufacturer: row.manufacturer,
      model: row.model,
      publicReference: row.publicReference,
      transport: row.transport,
      connectionConfiguration: row.connectionConfiguration,
      capabilities: row.capabilities,
      enabled: row.enabled,
      configurationVersion: Number(row.configurationVersion),
      connectionState: row.connectionState,
      firmwareVersion: row.firmwareVersion,
      lastHeartbeatAt: iso(row.lastHeartbeatAt),
      lastDiagnosticAt: iso(row.lastDiagnosticAt),
      createdAt: iso(row.createdAt)!,
      updatedAt: iso(row.updatedAt)!,
      archivedAt: iso(row.archivedAt),
      optimisticVersion: Number(row.optimisticVersion),
    };
  }

  private async policy(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    registerId: string | null,
  ): Promise<HardwarePilotPolicyResult> {
    const { rows } = await client.query<{
      policy: HardwarePilotPolicy;
      version: string;
      updatedAt: Date | string;
    }>(
      `SELECT policy,version::text,updated_at AS "updatedAt"
         FROM merchant.hardware_pilot_policy
        WHERE merchant_id=$1::uuid AND location_id=$2::uuid
          AND register_id IS NOT DISTINCT FROM $3::uuid
        LIMIT 1`,
      [merchantId, locationId, registerId],
    );
    const row = rows[0];
    return {
      merchantId,
      locationId,
      registerId,
      policy: row?.policy ?? {
        autoPrintReceipt: true,
        openDrawerOnCashSale: true,
        openDrawerOnCashRefund: true,
        allowNoSale: false,
        receiptCopiesDefault: 1,
        hardwareRetryLimit: 2,
        hardwareHealthIntervalSeconds: 30,
        scannerEnabled: true,
        customerDisplayEnabled: false,
      },
      version: Number(row?.version ?? 1),
      updatedAt: iso(row?.updatedAt ?? new Date(0))!,
    };
  }

  private async commandResult(
    client: PoolClient,
    merchantId: string,
    commandId: string,
    recovered: boolean,
  ): Promise<HardwareCommandResult> {
    const { rows } = await client.query<CommandRow>(
      `SELECT c.id::text AS "commandId",c.command_type AS "commandType",
              c.hardware_id::text AS "targetHardwareId",c.merchant_id::text AS "merchantId",
              c.location_id::text AS "locationId",c.register_id::text AS "registerId",
              c.originating_pos_device_id::text AS "originatingPosDeviceId",
              c.operator_id::text AS "operatorId",c.source_aggregate_type AS "sourceAggregateType",
              c.source_aggregate_id AS "sourceAggregateId",c.payload_fingerprint AS "payloadFingerprint",
              c.idempotency_key AS "idempotencyKey",
              c.expected_configuration_version::int AS "expectedConfigurationVersion",
              c.correlation_id AS "correlationId",
              e.status,c.created_at AS "createdAt",
              CASE WHEN e.status='dispatching' THEN e.occurred_at END AS "startedAt",
              CASE WHEN e.status IN ('succeeded','failed','cancelled','unknown') THEN e.occurred_at END AS "completedAt",
              e.failure_code AS "failureCode",e.safe_result AS "safeResultMetadata",
              c.safe_payload AS "safePayload"
         FROM merchant.hardware_command c
         JOIN LATERAL (SELECT * FROM merchant.hardware_command_event e
           WHERE e.merchant_id=c.merchant_id AND e.command_id=c.id
           ORDER BY e.sequence DESC LIMIT 1) e ON true
        WHERE c.merchant_id=$1::uuid AND c.id=$2::uuid`,
      [merchantId, commandId],
    );
    const row = rows[0];
    const failure = row.failureCode
      ? {
          code: row.failureCode,
          retryable: row.status === 'retryable',
          operatorGuidance:
            row.status === 'unknown' ? 'verify_physical_result' : 'review_hardware_status',
          safeDetail: null,
          correlationId: row.correlationId,
        }
      : null;
    return {
      command: {
        ...row,
        createdAt: iso(row.createdAt)!,
        startedAt: iso(row.startedAt),
        completedAt: iso(row.completedAt),
      },
      recovered,
      failure,
      dispatchPayload: {
        drawer: row.safePayload.drawer ?? null,
        display: row.safePayload.display ?? null,
        printPayload: row.safePayload.printPayload ?? null,
      },
    };
  }

  private async authoritativePrintPayload(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    receiptId: string,
  ): Promise<ReceiptPrintPayload> {
    const { rows } = await client.query<{
      id: string;
      receiptNumber: string;
      businessDate: string;
      currency: string;
      snapshot: Record<string, unknown>;
      exceptionMarker: 'refund' | 'void' | null;
    }>(
      `SELECT id::text,receipt_number AS "receiptNumber",business_date::text AS "businessDate",
              currency,snapshot,NULL::text AS "exceptionMarker"
         FROM merchant.receipt_snapshot
        WHERE id=$1::uuid AND merchant_id=$2::uuid AND location_id=$3::uuid
       UNION ALL
       SELECT id::text,receipt_number,business_date::text,currency,snapshot,
              CASE WHEN snapshot->>'exceptionType'='void' THEN 'void' ELSE 'refund' END
         FROM merchant.pos_exception_receipt
        WHERE id=$1::uuid AND merchant_id=$2::uuid AND location_id=$3::uuid
       LIMIT 1`,
      [receiptId, merchantId, locationId],
    );
    const row = rows[0];
    if (!row) throw new Error('HARDWARE_RECEIPT_NOT_FOUND');
    const source = row.snapshot;
    const money = (value: unknown): number =>
      typeof value === 'object' && value !== null && 'minorUnits' in value
        ? Number(value.minorUnits)
        : 0;
    const allocation = (source.allocation ?? {}) as Record<string, unknown>;
    const lines = Array.isArray(source.lines) ? source.lines : [];
    const payments = Array.isArray(source.payments)
      ? source.payments
      : Array.isArray(source.tenders)
        ? source.tenders
        : [];
    return {
      receiptId: row.id,
      merchantName: String(source.merchantName ?? source.merchantDisplayName ?? 'Umi').slice(
        0,
        160,
      ),
      locationName: String(source.locationName ?? source.locationDisplayName ?? 'UmiPOS').slice(
        0,
        160,
      ),
      registerName: null,
      receiptNumber: row.receiptNumber,
      businessDate: row.businessDate,
      currency: row.currency,
      items: lines.slice(0, 500).map((value) => {
        const line = value as Record<string, unknown>;
        return {
          name: String(line.description ?? line.productName ?? 'Item').slice(0, 160),
          quantity: Number(line.quantity ?? 1),
          totalMinorUnits: money(line.lineTotal ?? line.total),
          modifiers: Array.isArray(line.modifiers)
            ? line.modifiers.slice(0, 40).map((item) => String(item).slice(0, 120))
            : [],
        };
      }),
      subtotalMinorUnits: money(source.subtotal) || money(allocation.merchandise),
      discountMinorUnits: money(source.discountTotal) || money(allocation.discount),
      taxMinorUnits: money(source.taxTotal) || money(allocation.tax),
      tipMinorUnits: money(source.tip) || money(allocation.tip),
      totalMinorUnits: money(source.grandTotal) || money(allocation.total),
      tenders: payments.slice(0, 16).map((value) => {
        const tender = value as Record<string, unknown>;
        const rawType = String(tender.method ?? tender.tenderType ?? tender.type ?? 'other');
        const type = ['cash', 'manual_terminal', 'wallet', 'gift_card'].includes(rawType)
          ? (rawType as 'cash' | 'manual_terminal' | 'wallet' | 'gift_card')
          : 'other';
        return {
          type,
          amountMinorUnits: money(tender.amount),
          maskedReference: null,
        };
      }),
      changeMinorUnits: payments.reduce((total, value) => {
        const tender = value as Record<string, unknown>;
        return total + money(tender.change);
      }, 0),
      loyaltySummary: null,
      customerValueSummary: null,
      exceptionMarker: row.exceptionMarker,
      qrValue: null,
      footer: null,
    };
  }

  private async printJobSource(
    client: PoolClient,
    merchantId: string,
    jobId: string,
    locationId: string,
  ) {
    const { rows } = await client.query<{
      registerId: string | null;
      targetPrinterId: string;
      sourceAggregateType: string;
      sourceAggregateId: string;
      configurationVersion: number;
      printPayload: ReceiptPrintPayload;
    }>(
      `SELECT j.register_id::text AS "registerId",j.printer_id::text AS "targetPrinterId",
              j.source_aggregate_type AS "sourceAggregateType",
              j.source_aggregate_id AS "sourceAggregateId",
              d.configuration_version::int AS "configurationVersion",
              j.safe_document->'printPayload' AS "printPayload"
         FROM merchant.hardware_print_job j
         JOIN merchant.hardware_device d ON d.id=j.printer_id AND d.merchant_id=j.merchant_id
        WHERE j.id=$1::uuid AND j.merchant_id=$2::uuid AND j.location_id=$3::uuid`,
      [jobId, merchantId, locationId],
    );
    if (!rows[0]) throw new Error('HARDWARE_PRINT_JOB_NOT_FOUND');
    return rows[0];
  }

  private async printJobs(client: PoolClient, merchantId: string, locationId: string) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id::text FROM merchant.hardware_print_job
        WHERE merchant_id=$1::uuid AND location_id=$2::uuid ORDER BY created_at,id LIMIT 100`,
      [merchantId, locationId],
    );
    return Promise.all(rows.map((row) => this.printJob(client, merchantId, row.id)));
  }

  private async printJob(client: PoolClient, merchantId: string, jobId: string): Promise<PrintJob> {
    const { rows } = await client.query<{
      jobId: string;
      targetPrinterId: string;
      type: PrintJob['type'];
      sourceAggregateType: string;
      sourceAggregateId: string;
      correlationId: string;
      idempotencyKey: string;
      payloadFingerprint: string;
      copies: number;
      status: PrintJob['status'];
      attempts: number;
      createdAt: Date | string;
      startedAt: Date | string | null;
      completedAt: Date | string | null;
      failureCode: string | null;
      originalJobId: string | null;
    }>(
      `SELECT j.id::text AS "jobId",j.printer_id::text AS "targetPrinterId",j.job_type AS type,
              j.source_aggregate_type AS "sourceAggregateType",j.source_aggregate_id AS "sourceAggregateId",
              j.correlation_id AS "correlationId",j.idempotency_key AS "idempotencyKey",
              j.payload_fingerprint AS "payloadFingerprint",j.copies,
              coalesce(e.status,'queued') AS status,coalesce(e.attempt,0) AS attempts,
              j.created_at AS "createdAt",
              CASE WHEN e.status='printing' THEN e.occurred_at END AS "startedAt",
              CASE WHEN e.status IN ('printed','terminal_failure','cancelled','unknown_outcome')
                THEN e.occurred_at END AS "completedAt",
              e.failure_code AS "failureCode",j.original_job_id::text AS "originalJobId"
         FROM merchant.hardware_print_job j
         LEFT JOIN LATERAL (SELECT * FROM merchant.hardware_print_job_event e
           WHERE e.merchant_id=j.merchant_id AND e.print_job_id=j.id
           ORDER BY e.sequence DESC LIMIT 1) e ON true
        WHERE j.merchant_id=$1::uuid AND j.id=$2::uuid`,
      [merchantId, jobId],
    );
    const row = rows[0];
    return {
      ...row,
      createdAt: iso(row.createdAt)!,
      startedAt: iso(row.startedAt),
      completedAt: iso(row.completedAt),
      failure: row.failureCode
        ? {
            code: row.failureCode as NonNullable<PrintJob['failure']>['code'],
            retryable: row.status === 'retryable_failure',
            operatorGuidance:
              row.status === 'unknown_outcome' ? 'verify_print' : 'review_printer_status',
            safeDetail: null,
            correlationId: row.correlationId,
          }
        : null,
    };
  }
}
