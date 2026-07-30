import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  CashCenterSnapshot,
  CashCommandRecoveryResult,
  CashCountState,
  CashMovement,
  CashMovementRequest,
  CashReconciliationOutcome,
  CashShift,
  CashShiftPolicy,
  CashShiftSummary,
  ExpectedCash,
  NoSaleDrawerEvent,
  NoSaleDrawerRequest,
  OpenCashShiftRequest,
  OpenCashShiftResult,
  ReconcileCashShiftRequest,
  RecountRequest,
  RegisterStatus,
  ResolveCashVarianceRequest,
  ShiftCloseRequest,
  ShiftCloseResult,
  ShiftHandoff,
  ShiftHandoffRequest,
  ShiftTransitionRequest,
  SubmitBlindCountRequest,
} from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import { calculateExpectedCash, calculateVariance, type CashFact } from './cash-domain';

export interface CashAuthorization {
  operatorSessionId: string;
  operatorId: string;
  deviceId: string;
  credentialVersion: number;
  permissions: string[];
}

interface PhysicalRegisterRow {
  id: string;
  tenantId: string;
  branchId: string;
  displayName: string;
  publicReference: string;
  currency: string;
  active: boolean;
  assignmentPolicy: 'device_required' | 'operator_selects';
  assignedDeviceId: string | null;
  allowedDeviceClasses: string[];
  currentShiftId: string | null;
  status: RegisterStatus;
  version: number;
  createdAt: string;
  archivedAt: string | null;
}

interface StoredReconciliationHeader {
  id: string;
  shiftId: string;
  countAttemptId: string;
  outcome: CashReconciliationOutcome;
  ledgerSequence: number;
  reconciledAt: string;
}

@Injectable()
export class PosCashRepository {
  constructor(private readonly pg: PgService) {}

  commandRecovery(
    userId: string,
    tenantId: string,
    branchId: string,
    commandId: string,
    idempotencyKey: string,
  ): Promise<CashCommandRecoveryResult> {
    return this.pg.runWithTenant(
      tenantId,
      userId,
      async (client) => {
        const result = await client.query<{
          commandId: string;
          commandType: string;
          status: 'processing' | 'succeeded' | 'failed';
          retryable: boolean;
          failureCode: string | null;
          correlationId: string;
        }>(
          `SELECT command_id::text AS "commandId",command_type AS "commandType",
                  status,retryable,failure_code AS "failureCode",
                  correlation_id::text AS "correlationId"
           FROM tenant.business_command
           WHERE business_id=$1::uuid AND branch_id=$2::uuid
             AND command_id=$3::uuid AND idempotency_key=$4
             AND command_type LIKE 'pos.cash.%'
           LIMIT 1`,
          [tenantId, branchId, commandId, idempotencyKey],
        );
        const row = result.rows[0];
        if (!row) {
          return {
            commandId,
            commandType: null,
            status: 'not_found',
            retryable: true,
            failureCode: null,
            correlationId: null,
          };
        }
        return row;
      },
      branchId,
    );
  }

  async authorize(
    userId: string,
    durableSessionId: string,
    deviceId: string,
    tenantId: string,
    branchId: string,
    operatorSessionId: string,
  ): Promise<CashAuthorization | null> {
    const { rows } = await this.pg.worker.query<CashAuthorization>(
      `SELECT os.id::text AS "operatorSessionId",os.user_id::text AS "operatorId",
              os.device_id::text AS "deviceId",d.credential_version AS "credentialVersion",
              os.permissions
       FROM runtime.operator_session os
       JOIN tenant.device d ON d.id=os.device_id
       WHERE os.id=$6::uuid AND os.durable_session_id=$2::uuid
         AND os.user_id=$1::uuid AND os.device_id=$3::uuid
         AND os.business_id=$4::uuid AND os.branch_id=$5::uuid
         AND os.state='active' AND os.expires_at>now()
         AND d.lifecycle_state='active' AND d.credential_version>0`,
      [userId, durableSessionId, deviceId, tenantId, branchId, operatorSessionId],
    );
    return rows[0] ?? null;
  }

  async policy(
    client: PoolClient,
    tenantId: string,
    branchId: string,
    currency: string,
  ): Promise<CashShiftPolicy> {
    const { rows } = await client.query<{
      version: string;
      issuedAt: string;
      expiresAt: string;
      fingerprint: string;
      cashShiftRequired: boolean;
      registerAssignmentRequired: boolean;
      oneShiftPerOperator: boolean;
      oneShiftPerRegister: boolean;
      openingFloatRequired: boolean;
      maximumOpeningFloat: string;
      allowedMovementTypes: CashShiftPolicy['allowedMovementTypes'];
      movementApprovalThreshold: string;
      countMethod: CashShiftPolicy['countMethod'];
      blindCountRequired: boolean;
      handoffAllowed: boolean;
      handoffCountRequired: boolean;
      varianceTolerance: string;
      closeApprovalThreshold: string;
      noSaleDrawerAllowed: boolean;
      offlineCashShiftAllowed: boolean;
      denominations: Array<{ minorUnits: number; currency: string }>;
    }>(
      `SELECT version,issued_at::text AS "issuedAt",expires_at::text AS "expiresAt",
              fingerprint,cash_shift_required AS "cashShiftRequired",
              register_assignment_required AS "registerAssignmentRequired",
              one_shift_per_operator AS "oneShiftPerOperator",
              one_shift_per_register AS "oneShiftPerRegister",
              opening_float_required AS "openingFloatRequired",
              maximum_opening_float::text AS "maximumOpeningFloat",
              allowed_movement_types AS "allowedMovementTypes",
              movement_approval_threshold::text AS "movementApprovalThreshold",
              count_method AS "countMethod",blind_count_required AS "blindCountRequired",
              handoff_allowed AS "handoffAllowed",
              handoff_count_required AS "handoffCountRequired",
              variance_tolerance::text AS "varianceTolerance",
              close_approval_threshold::text AS "closeApprovalThreshold",
              no_sale_drawer_allowed AS "noSaleDrawerAllowed",
              offline_cash_shift_allowed AS "offlineCashShiftAllowed",denominations
       FROM tenant.cash_shift_policy
       WHERE business_id=$1::uuid AND branch_id=$2::uuid AND currency=$3
         AND expires_at>now()`,
      [tenantId, branchId, currency],
    );
    const row = rows[0];
    const money = (minorUnits: number) => ({ minorUnits, currency });
    if (!row) {
      const now = new Date();
      return {
        version: 'default-deny',
        issuedAt: now.toISOString(),
        expiresAt: now.toISOString(),
        fingerprint: '0'.repeat(64),
        cashShiftRequired: true,
        registerAssignmentRequired: true,
        oneShiftPerOperator: true,
        oneShiftPerRegister: true,
        openingFloatRequired: true,
        maximumOpeningFloat: money(0),
        allowedMovementTypes: [],
        movementApprovalThreshold: money(0),
        countMethod: 'total_only',
        blindCountRequired: true,
        handoffAllowed: false,
        handoffCountRequired: true,
        varianceTolerance: money(0),
        closeApprovalThreshold: money(0),
        noSaleDrawerAllowed: false,
        offlineCashShiftAllowed: false,
        denominations: [],
      };
    }
    return {
      ...row,
      maximumOpeningFloat: money(Number(row.maximumOpeningFloat)),
      movementApprovalThreshold: money(Number(row.movementApprovalThreshold)),
      varianceTolerance: money(Number(row.varianceTolerance)),
      closeApprovalThreshold: money(Number(row.closeApprovalThreshold)),
      denominations: row.denominations,
    };
  }

  async openShift(
    client: PoolClient,
    tenantId: string,
    authorization: CashAuthorization,
    dto: OpenCashShiftRequest,
    correlationId: string,
  ): Promise<OpenCashShiftResult> {
    const register = await client.query<{
      id: string;
      branchId: string;
      displayName: string;
      publicReference: string;
      currency: string;
      active: boolean;
      assignmentPolicy: 'device_required' | 'operator_selects';
      assignedDeviceId: string | null;
      allowedDeviceClasses: string[];
      status: 'available' | 'assigned';
      version: number;
      createdAt: string;
    }>(
      `SELECT id::text,branch_id::text AS "branchId",display_name AS "displayName",
              public_reference AS "publicReference",currency,active,
              assignment_policy AS "assignmentPolicy",
              assigned_device_id::text AS "assignedDeviceId",
              allowed_device_classes AS "allowedDeviceClasses",status,version,
              created_at::text AS "createdAt"
       FROM tenant.physical_register
       WHERE id=$1::uuid AND business_id=$2::uuid AND branch_id=$3::uuid
         AND active AND archived_at IS NULL AND status IN ('available','assigned')
         AND version=$4
       FOR UPDATE`,
      [dto.registerId, tenantId, dto.branchId, dto.expectedRegisterVersion],
    );
    const current = register.rows[0];
    if (
      !current ||
      (current.assignmentPolicy === 'device_required' &&
        current.assignedDeviceId !== authorization.deviceId)
    ) {
      throw new Error('REGISTER_NOT_AVAILABLE');
    }
    if (current.currency !== dto.openingFloat.currency) throw new Error('CURRENCY_MISMATCH');
    const policy = await this.policy(client, tenantId, dto.branchId, current.currency);
    if (
      policy.version === 'default-deny' ||
      dto.openingFloat.minorUnits > policy.maximumOpeningFloat.minorUnits
    ) {
      throw new Error('CASH_POLICY_DENIED');
    }
    const businessDate = await client.query<{ value: string }>(
      `SELECT current_date::text AS value`,
    );
    const authoritativeBusinessDate = businessDate.rows[0].value;
    const shift = await client.query<{
      id: string;
      openedAt: string;
      version: number;
    }>(
      `INSERT INTO tenant.cash_shift
         (business_id,branch_id,register_id,device_id,device_credential_version,
          opening_operator_id,responsible_operator_id,operator_session_id,currency,
          business_date,status,opening_command_id,opening_float_minor_units,
          opening_denominations,opening_note)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$6::uuid,$7::uuid,
               $8,$9::date,'open',$10::uuid,$11,$12,$13)
       RETURNING id::text,opened_at::text AS "openedAt",version`,
      [
        tenantId,
        dto.branchId,
        dto.registerId,
        authorization.deviceId,
        authorization.credentialVersion,
        authorization.operatorId,
        authorization.operatorSessionId,
        current.currency,
        authoritativeBusinessDate,
        dto.commandId,
        dto.openingFloat.minorUnits,
        JSON.stringify(dto.denominations),
        dto.note,
      ],
    );
    const opened = shift.rows[0];
    await client.query(
      `INSERT INTO tenant.cash_ledger_entry
         (business_id,branch_id,register_id,shift_id,sequence,entry_type,
          amount_minor_units,currency,command_id,business_date,public_data)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,1,'opening_float',$5,$6,
               $7::uuid,$8::date,jsonb_build_object('denominationCount',$9::integer))`,
      [
        tenantId,
        dto.branchId,
        dto.registerId,
        opened.id,
        dto.openingFloat.minorUnits,
        current.currency,
        dto.commandId,
        authoritativeBusinessDate,
        dto.denominations.length,
      ],
    );
    await client.query(`UPDATE tenant.cash_shift SET ledger_sequence=1 WHERE id=$1::uuid`, [
      opened.id,
    ]);
    const updated = await client.query<{ version: number }>(
      `UPDATE tenant.physical_register
       SET status='in_use',current_shift_id=$2::uuid,version=version+1
       WHERE id=$1::uuid RETURNING version`,
      [dto.registerId, opened.id],
    );
    const registerResult = {
      id: current.id,
      tenantId,
      branchId: current.branchId,
      displayName: current.displayName,
      publicReference: current.publicReference,
      currency: current.currency,
      active: current.active,
      assignmentPolicy: current.assignmentPolicy,
      assignment: {
        deviceId: current.assignedDeviceId,
        allowedDeviceClasses: current.allowedDeviceClasses,
        assignedAt: null,
      },
      currentShiftId: opened.id,
      status: 'in_use' as const,
      version: updated.rows[0].version,
      createdAt: current.createdAt,
      archivedAt: null,
    };
    return {
      register: registerResult,
      shift: {
        id: opened.id,
        tenantId,
        branchId: dto.branchId,
        registerId: dto.registerId,
        deviceId: authorization.deviceId,
        deviceCredentialVersion: authorization.credentialVersion,
        openingOperatorId: authorization.operatorId,
        responsibleOperatorId: authorization.operatorId,
        operatorSessionId: authorization.operatorSessionId,
        currency: current.currency,
        businessDate: authoritativeBusinessDate,
        status: 'open',
        openingCommandId: dto.commandId,
        openedAt: opened.openedAt,
        suspendedAt: null,
        closedAt: null,
        ledgerSequence: 1,
        version: opened.version,
      },
      openingFloat: {
        total: dto.openingFloat,
        denominations: dto.denominations,
        note: dto.note,
      },
      policy,
      correlationId,
      recovered: false,
    };
  }

  async expectedCash(client: PoolClient, shiftId: string): Promise<ExpectedCash> {
    const shift = await client.query<{ currency: string; version: number }>(
      `SELECT currency,version FROM tenant.cash_shift WHERE id=$1::uuid`,
      [shiftId],
    );
    if (!shift.rows[0]) throw new Error('SHIFT_NOT_FOUND');
    const entries = await client.query<{
      sequence: string;
      type: CashFact['type'];
      amountMinorUnits: string;
      received: string;
      change: string;
    }>(
      `SELECT sequence::text,entry_type AS type,amount_minor_units::text AS "amountMinorUnits",
              cash_received_minor_units::text AS received,
              change_given_minor_units::text AS change
       FROM tenant.cash_ledger_entry WHERE shift_id=$1::uuid ORDER BY sequence`,
      [shiftId],
    );
    return calculateExpectedCash(
      shift.rows[0].currency,
      entries.rows.map((row) => ({
        sequence: Number(row.sequence),
        type: row.type,
        amountMinorUnits: Number(row.amountMinorUnits),
        received: Number(row.received),
        change: Number(row.change),
      })),
      shift.rows[0].version,
    );
  }

  async movement(
    client: PoolClient,
    tenantId: string,
    authorization: CashAuthorization,
    dto: CashMovementRequest,
  ): Promise<CashMovement> {
    const shift = await client.query<{
      registerId: string;
      currency: string;
      businessDate: string;
      version: number;
      sequence: string;
    }>(
      `SELECT register_id::text AS "registerId",currency,business_date::text AS "businessDate",
              version,ledger_sequence::text AS sequence
       FROM tenant.cash_shift
       WHERE id=$1::uuid AND business_id=$2::uuid AND branch_id=$3::uuid
         AND responsible_operator_id=$4::uuid AND device_id=$5::uuid
         AND status='open' AND version=$6
       FOR UPDATE`,
      [
        dto.shiftId,
        tenantId,
        dto.branchId,
        authorization.operatorId,
        authorization.deviceId,
        dto.expectedShiftVersion,
      ],
    );
    const current = shift.rows[0];
    if (!current || current.currency !== dto.amount.currency) throw new Error('SHIFT_NOT_OPEN');
    const policy = await this.policy(client, tenantId, dto.branchId, current.currency);
    if (!policy.allowedMovementTypes.includes(dto.type)) throw new Error('CASH_POLICY_DENIED');
    if (
      dto.amount.minorUnits >= policy.movementApprovalThreshold.minorUnits &&
      dto.approvalId === null
    ) {
      throw new Error('APPROVAL_REQUIRED');
    }
    if (dto.approvalId) {
      if (!dto.actionFingerprint) throw new Error('APPROVAL_FINGERPRINT_REQUIRED');
      await this.consumeApproval(client, dto.approvalId, {
        tenantId,
        branchId: dto.branchId,
        permission: `cash.movement.${dto.type}`,
        fingerprint: dto.actionFingerprint,
        commandId: dto.commandId,
      });
    }
    if (dto.type === 'paid_out' || dto.type === 'safe_drop') {
      const expected = await this.expectedCash(client, dto.shiftId);
      if (dto.amount.minorUnits > expected.expectedDrawerCash.minorUnits) {
        throw new Error('INSUFFICIENT_EXPECTED_CASH');
      }
    }
    const sequence = Number(current.sequence) + 1;
    const entry = await client.query<{ id: string; occurredAt: string }>(
      `INSERT INTO tenant.cash_ledger_entry
         (business_id,branch_id,register_id,shift_id,sequence,entry_type,
          amount_minor_units,currency,command_id,business_date)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9::uuid,$10::date)
       RETURNING id::text,occurred_at::text AS "occurredAt"`,
      [
        tenantId,
        dto.branchId,
        current.registerId,
        dto.shiftId,
        sequence,
        dto.type,
        dto.amount.minorUnits,
        dto.amount.currency,
        dto.commandId,
        current.businessDate,
      ],
    );
    const movement = await client.query<{ id: string; committedAt: string }>(
      `INSERT INTO tenant.cash_movement
         (business_id,branch_id,register_id,shift_id,ledger_entry_id,movement_type,
          amount_minor_units,currency,reason_code,note,operator_id,approval_id,command_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,
               $11::uuid,$12::uuid,$13::uuid)
       RETURNING id::text,committed_at::text AS "committedAt"`,
      [
        tenantId,
        dto.branchId,
        current.registerId,
        dto.shiftId,
        entry.rows[0].id,
        dto.type,
        dto.amount.minorUnits,
        dto.amount.currency,
        dto.reasonCode,
        dto.note,
        authorization.operatorId,
        dto.approvalId,
        dto.commandId,
      ],
    );
    await client.query(
      `UPDATE tenant.cash_shift
       SET ledger_sequence=$2,version=version+1
       WHERE id=$1::uuid`,
      [dto.shiftId, sequence],
    );
    return {
      id: movement.rows[0].id,
      type: dto.type,
      amount: dto.amount,
      reasonCode: dto.reasonCode,
      note: dto.note,
      operatorId: authorization.operatorId,
      shiftId: dto.shiftId,
      registerId: current.registerId,
      businessDate: current.businessDate,
      ledgerEntry: {
        id: entry.rows[0].id,
        tenantId,
        branchId: dto.branchId,
        registerId: current.registerId,
        shiftId: dto.shiftId,
        sequence,
        type: dto.type,
        amount: dto.amount,
        cashReceived: { minorUnits: 0, currency: dto.amount.currency },
        changeGiven: { minorUnits: 0, currency: dto.amount.currency },
        saleId: null,
        commandId: dto.commandId,
        businessDate: current.businessDate,
        occurredAt: entry.rows[0].occurredAt,
      },
      committedAt: movement.rows[0].committedAt,
    };
  }

  async submitCount(
    client: PoolClient,
    tenantId: string,
    authorization: CashAuthorization,
    dto: SubmitBlindCountRequest,
  ) {
    const shift = await client.query<{
      registerId: string;
      currency: string;
      sequence: string;
      version: number;
    }>(
      `SELECT register_id::text AS "registerId",currency,ledger_sequence::text AS sequence,version
       FROM tenant.cash_shift
       WHERE id=$1::uuid AND business_id=$2::uuid AND branch_id=$3::uuid
         AND responsible_operator_id=$4::uuid AND device_id=$5::uuid
         AND status IN ('open','suspended','counting','reconciliation_required')
         AND version=$6 AND ledger_sequence=$7
       FOR UPDATE`,
      [
        dto.shiftId,
        tenantId,
        dto.branchId,
        authorization.operatorId,
        authorization.deviceId,
        dto.expectedShiftVersion,
        dto.expectedLedgerSequence,
      ],
    );
    const current = shift.rows[0];
    if (!current || current.currency !== dto.countedCash.currency) throw new Error('STALE_COUNT');
    const prior = await client.query<{ attempts: string }>(
      `SELECT count(*)::text AS attempts FROM tenant.cash_count_attempt WHERE shift_id=$1::uuid`,
      [dto.shiftId],
    );
    const attempt = Number(prior.rows[0].attempts) + 1;
    if (attempt > 10) throw new Error('RECOUNT_LIMIT');
    const expected = await this.expectedCash(client, dto.shiftId);
    const policy = await this.policy(client, tenantId, dto.branchId, current.currency);
    if (policy.version === 'default-deny') throw new Error('CASH_POLICY_DENIED');
    const variance = calculateVariance(
      expected.expectedDrawerCash.minorUnits,
      dto.countedCash.minorUnits,
      policy.varianceTolerance.minorUnits,
      current.currency,
      dto.expectedLedgerSequence,
    );
    const state =
      variance.signedVariance.minorUnits === 0
        ? 'resolved'
        : variance.approvalRequired
          ? 'approval_required'
          : 'variance_calculated';
    const count = await client.query<{ id: string; submittedAt: string }>(
      `INSERT INTO tenant.cash_count_attempt
         (business_id,branch_id,register_id,shift_id,attempt_number,state,
          counted_minor_units,currency,denominations,operator_id,ledger_sequence,note,command_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10::uuid,$11,$12,$13::uuid)
       RETURNING id::text,submitted_at::text AS "submittedAt"`,
      [
        tenantId,
        dto.branchId,
        current.registerId,
        dto.shiftId,
        attempt,
        state,
        dto.countedCash.minorUnits,
        current.currency,
        JSON.stringify(dto.denominations),
        authorization.operatorId,
        dto.expectedLedgerSequence,
        dto.note,
        dto.commandId,
      ],
    );
    await client.query(
      `UPDATE tenant.cash_shift
       SET status='reconciliation_required',version=version+1
       WHERE id=$1::uuid`,
      [dto.shiftId],
    );
    await client.query(
      `UPDATE tenant.physical_register
       SET status='reconciliation_required',version=version+1
       WHERE id=$1::uuid`,
      [current.registerId],
    );
    const approvalFingerprint = variance.approvalRequired
      ? createHash('sha256')
          .update(
            [
              tenantId,
              dto.branchId,
              dto.shiftId,
              count.rows[0].id,
              dto.countedCash.minorUnits,
              variance.ledgerSequence,
            ].join(':'),
          )
          .digest('hex')
      : null;
    return {
      count: {
        id: count.rows[0].id,
        shiftId: dto.shiftId,
        attemptNumber: attempt,
        state,
        countedCash: dto.countedCash,
        denominations: dto.denominations,
        operatorId: authorization.operatorId,
        ledgerSequence: dto.expectedLedgerSequence,
        submittedAt: count.rows[0].submittedAt,
      },
      variance,
      approvalFingerprint,
    };
  }

  async requestRecount(
    client: PoolClient,
    tenantId: string,
    authorization: CashAuthorization,
    dto: RecountRequest,
  ): Promise<CashShift> {
    const prior = await client.query<{ attempts: string }>(
      `SELECT count(*)::text AS attempts
       FROM tenant.cash_count_attempt
       WHERE id=$1::uuid AND shift_id=$2::uuid
         AND business_id=$3::uuid AND branch_id=$4::uuid`,
      [dto.priorCountAttemptId, dto.shiftId, tenantId, dto.branchId],
    );
    if (Number(prior.rows[0].attempts) !== 1) throw new Error('COUNT_NOT_FOUND');
    const { rows } = await client.query<CashShift>(
      `UPDATE tenant.cash_shift
       SET status='counting',version=version+1
       WHERE id=$1::uuid AND business_id=$2::uuid AND branch_id=$3::uuid
         AND responsible_operator_id=$4::uuid AND device_id=$5::uuid
         AND version=$6 AND status='reconciliation_required'
         AND (
           SELECT count(*) FROM tenant.cash_count_attempt
           WHERE shift_id=$1::uuid
         )<10
       RETURNING id::text,business_id::text AS "tenantId",
                 branch_id::text AS "branchId",register_id::text AS "registerId",
                 device_id::text AS "deviceId",
                 device_credential_version AS "deviceCredentialVersion",
                 opening_operator_id::text AS "openingOperatorId",
                 responsible_operator_id::text AS "responsibleOperatorId",
                 operator_session_id::text AS "operatorSessionId",currency,
                 business_date::text AS "businessDate",status,
                 opening_command_id::text AS "openingCommandId",
                 opened_at::text AS "openedAt",suspended_at::text AS "suspendedAt",
                 closed_at::text AS "closedAt",ledger_sequence AS "ledgerSequence",version`,
      [
        dto.shiftId,
        tenantId,
        dto.branchId,
        authorization.operatorId,
        authorization.deviceId,
        dto.expectedShiftVersion,
      ],
    );
    if (!rows[0]) throw new Error('RECOUNT_NOT_AVAILABLE');
    await client.query(
      `UPDATE tenant.physical_register
       SET status='counting',version=version+1
       WHERE id=$1::uuid`,
      [rows[0].registerId],
    );
    return rows[0];
  }

  async resolveVariance(
    client: PoolClient,
    tenantId: string,
    authorization: CashAuthorization,
    dto: ResolveCashVarianceRequest,
  ) {
    const row = await client.query<{
      ledgerSequence: string;
      state: string;
      counted: string;
      currency: string;
    }>(
      `SELECT c.ledger_sequence::text AS "ledgerSequence",c.state,
              c.counted_minor_units::text AS counted,c.currency
       FROM tenant.cash_count_attempt c
       JOIN tenant.cash_shift s ON s.id=c.shift_id
       WHERE c.id=$1::uuid AND c.shift_id=$2::uuid AND c.business_id=$3::uuid
         AND c.branch_id=$4::uuid AND s.version=$5
         AND s.responsible_operator_id=$6::uuid AND s.device_id=$7::uuid
         AND s.operator_session_id=$8::uuid
       FOR UPDATE OF s`,
      [
        dto.countAttemptId,
        dto.shiftId,
        tenantId,
        dto.branchId,
        dto.expectedShiftVersion,
        authorization.operatorId,
        authorization.deviceId,
        dto.operatorSessionId,
      ],
    );
    if (!row.rows[0]) throw new Error('COUNT_NOT_FOUND');
    if (row.rows[0].state === 'approval_required' && dto.approvalId === null) {
      throw new Error('APPROVAL_REQUIRED');
    }
    if (dto.approvalId) {
      if (!dto.approvalFingerprint) throw new Error('APPROVAL_FINGERPRINT_REQUIRED');
      const expectedFingerprint = createHash('sha256')
        .update(
          [
            tenantId,
            dto.branchId,
            dto.shiftId,
            dto.countAttemptId,
            Number(row.rows[0].counted),
            Number(row.rows[0].ledgerSequence),
          ].join(':'),
        )
        .digest('hex');
      if (expectedFingerprint !== dto.approvalFingerprint) {
        throw new Error('APPROVAL_FINGERPRINT_MISMATCH');
      }
      await this.consumeApproval(client, dto.approvalId, {
        tenantId,
        branchId: dto.branchId,
        permission: 'cash.variance.approve',
        fingerprint: dto.approvalFingerprint,
        commandId: dto.commandId,
      });
    }
    const resolution = await client.query<{ id: string; resolvedAt: string }>(
      `INSERT INTO tenant.cash_variance_resolution
         (business_id,branch_id,shift_id,count_attempt_id,reason,note,approval_id,
          ledger_sequence,command_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::uuid,$8,$9::uuid)
       RETURNING id::text,resolved_at::text AS "resolvedAt"`,
      [
        tenantId,
        dto.branchId,
        dto.shiftId,
        dto.countAttemptId,
        dto.reason,
        dto.note,
        dto.approvalId,
        row.rows[0].ledgerSequence,
        dto.commandId,
      ],
    );
    return {
      id: resolution.rows[0].id,
      shiftId: dto.shiftId,
      countAttemptId: dto.countAttemptId,
      reason: dto.reason,
      note: dto.note,
      approvalId: dto.approvalId,
      approvalFingerprint: dto.approvalFingerprint,
      ledgerSequence: Number(row.rows[0].ledgerSequence),
      resolvedAt: resolution.rows[0].resolvedAt,
    };
  }

  async reconcile(
    client: PoolClient,
    tenantId: string,
    authorization: CashAuthorization,
    dto: ReconcileCashShiftRequest,
  ) {
    const count = await client.query<{
      id: string;
      attemptNumber: number;
      counted: string;
      currency: string;
      denominations: never[];
      operatorId: string;
      ledgerSequence: string;
      submittedAt: string;
      resolutionId: string | null;
      resolutionReason: string | null;
      resolutionNote: string | null;
      approvalId: string | null;
      resolvedAt: string | null;
    }>(
      `SELECT c.id::text,c.attempt_number AS "attemptNumber",
              c.counted_minor_units::text AS counted,c.currency,c.denominations,
              c.operator_id::text AS "operatorId",c.ledger_sequence::text AS "ledgerSequence",
              c.submitted_at::text AS "submittedAt",r.id::text AS "resolutionId",
              r.reason AS "resolutionReason",r.note AS "resolutionNote",
              r.approval_id::text AS "approvalId",r.resolved_at::text AS "resolvedAt"
       FROM tenant.cash_count_attempt c
       JOIN tenant.cash_shift s ON s.id=c.shift_id
       LEFT JOIN tenant.cash_variance_resolution r ON r.count_attempt_id=c.id
       WHERE c.id=$1::uuid AND c.shift_id=$2::uuid AND c.business_id=$3::uuid
         AND c.branch_id=$4::uuid AND s.version=$5
         AND s.status='reconciliation_required' AND s.ledger_sequence=c.ledger_sequence
         AND s.responsible_operator_id=$6::uuid AND s.device_id=$7::uuid
         AND s.operator_session_id=$8::uuid
       FOR UPDATE OF s`,
      [
        dto.countAttemptId,
        dto.shiftId,
        tenantId,
        dto.branchId,
        dto.expectedShiftVersion,
        authorization.operatorId,
        authorization.deviceId,
        dto.operatorSessionId,
      ],
    );
    const selected = count.rows[0];
    if (!selected) throw new Error('STALE_COUNT');
    const expected = await this.expectedCash(client, dto.shiftId);
    const policy = await this.policy(client, tenantId, dto.branchId, selected.currency);
    if (policy.version === 'default-deny') throw new Error('CASH_POLICY_DENIED');
    const variance = calculateVariance(
      expected.expectedDrawerCash.minorUnits,
      Number(selected.counted),
      policy.varianceTolerance.minorUnits,
      selected.currency,
      Number(selected.ledgerSequence),
    );
    if (
      variance.signedVariance.minorUnits !== 0 &&
      (!selected.resolutionId || selected.resolutionId !== dto.resolutionId)
    ) {
      throw new Error('VARIANCE_UNRESOLVED');
    }
    const outcome =
      variance.signedVariance.minorUnits === 0
        ? 'balanced'
        : variance.withinTolerance
          ? 'within_tolerance'
          : 'approved_variance';
    const closeApprovalRequired =
      expected.expectedDrawerCash.minorUnits > policy.closeApprovalThreshold.minorUnits;
    const closeApprovalFingerprint = closeApprovalRequired
      ? createHash('sha256')
          .update(
            [
              tenantId,
              dto.branchId,
              dto.shiftId,
              selected.id,
              expected.expectedDrawerCash.minorUnits,
              selected.ledgerSequence,
              'cash.shift.close',
            ].join(':'),
          )
          .digest('hex')
      : null;
    const reconciliation = await client.query<{ id: string; reconciledAt: string }>(
      `INSERT INTO tenant.cash_reconciliation
         (business_id,branch_id,shift_id,count_attempt_id,resolution_id,
          expected_minor_units,counted_minor_units,variance_minor_units,
          tolerance_minor_units,currency,outcome,ledger_sequence,command_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$13::uuid)
       RETURNING id::text,reconciled_at::text AS "reconciledAt"`,
      [
        tenantId,
        dto.branchId,
        dto.shiftId,
        dto.countAttemptId,
        dto.resolutionId,
        expected.expectedDrawerCash.minorUnits,
        selected.counted,
        variance.signedVariance.minorUnits,
        policy.varianceTolerance.minorUnits,
        selected.currency,
        outcome,
        selected.ledgerSequence,
        dto.commandId,
      ],
    );
    await client.query(
      `UPDATE tenant.cash_shift SET status='closing',version=version+1 WHERE id=$1::uuid`,
      [dto.shiftId],
    );
    const resolution = selected.resolutionId
      ? {
          id: selected.resolutionId,
          shiftId: dto.shiftId,
          countAttemptId: selected.id,
          reason: selected.resolutionReason,
          note: selected.resolutionNote,
          approvalId: selected.approvalId,
          ledgerSequence: Number(selected.ledgerSequence),
          resolvedAt: selected.resolvedAt,
        }
      : null;
    return {
      id: reconciliation.rows[0].id,
      shiftId: dto.shiftId,
      countAttemptId: selected.id,
      expectedCash: expected,
      selectedCount: {
        id: selected.id,
        shiftId: dto.shiftId,
        attemptNumber: selected.attemptNumber,
        state: 'resolved' as const,
        countedCash: { minorUnits: Number(selected.counted), currency: selected.currency },
        denominations: selected.denominations,
        operatorId: selected.operatorId,
        ledgerSequence: Number(selected.ledgerSequence),
        submittedAt: selected.submittedAt,
      },
      variance,
      resolution,
      outcome,
      ledgerSequence: Number(selected.ledgerSequence),
      closeApprovalRequired,
      closeApprovalFingerprint,
      reconciledAt: reconciliation.rows[0].reconciledAt,
    };
  }

  async close(
    client: PoolClient,
    tenantId: string,
    authorization: CashAuthorization,
    dto: ShiftCloseRequest,
    correlationId: string,
  ): Promise<ShiftCloseResult> {
    const shift = await client.query<{
      id: string;
      branchId: string;
      registerId: string;
      deviceId: string;
      deviceCredentialVersion: number;
      openingOperatorId: string;
      responsibleOperatorId: string;
      operatorSessionId: string;
      currency: string;
      businessDate: string;
      openingCommandId: string;
      openingFloat: string;
      openedAt: string;
      ledgerSequence: string;
      version: number;
    }>(
      `SELECT id::text,branch_id::text AS "branchId",register_id::text AS "registerId",
              device_id::text AS "deviceId",device_credential_version AS "deviceCredentialVersion",
              opening_operator_id::text AS "openingOperatorId",
              responsible_operator_id::text AS "responsibleOperatorId",
              operator_session_id::text AS "operatorSessionId",currency,
              business_date::text AS "businessDate",opening_command_id::text AS "openingCommandId",
              opening_float_minor_units::text AS "openingFloat",
              opened_at::text AS "openedAt",ledger_sequence::text AS "ledgerSequence",version
       FROM tenant.cash_shift
       WHERE id=$1::uuid AND business_id=$2::uuid AND branch_id=$3::uuid
         AND status='closing' AND version=$4
         AND responsible_operator_id=$5::uuid AND device_id=$6::uuid
         AND operator_session_id=$7::uuid
       FOR UPDATE`,
      [
        dto.shiftId,
        tenantId,
        dto.branchId,
        dto.expectedShiftVersion,
        authorization.operatorId,
        authorization.deviceId,
        dto.operatorSessionId,
      ],
    );
    const current = shift.rows[0];
    if (!current) throw new Error('SHIFT_NOT_CLOSABLE');
    const policy = await this.policy(client, tenantId, dto.branchId, current.currency);
    if (policy.version === 'default-deny') throw new Error('CASH_POLICY_DENIED');
    const reconciliation = await client.query<{
      payload: StoredReconciliationHeader;
    }>(
      `SELECT jsonb_build_object(
         'id',r.id::text,'shiftId',r.shift_id::text,'countAttemptId',r.count_attempt_id::text,
         'outcome',r.outcome,'ledgerSequence',r.ledger_sequence,
         'reconciledAt',r.reconciled_at::text) AS payload
       FROM tenant.cash_reconciliation r
       WHERE r.id=$1::uuid AND r.shift_id=$2::uuid AND r.count_attempt_id=$3::uuid
         AND r.ledger_sequence=$4`,
      [dto.reconciliationId, dto.shiftId, dto.countAttemptId, current.ledgerSequence],
    );
    if (!reconciliation.rows[0]) throw new Error('RECONCILIATION_REQUIRED');
    const expected = await this.expectedCash(client, dto.shiftId);
    const count = await client.query<{
      counted: string;
      attempts: string;
      attemptNumber: number;
      denominations: never[];
      operatorId: string;
      submittedAt: string;
    }>(
      `SELECT counted_minor_units::text AS counted,
              (SELECT count(*)::text FROM tenant.cash_count_attempt
               WHERE shift_id=$1::uuid) AS attempts,
              attempt_number AS "attemptNumber",denominations,
              operator_id::text AS "operatorId",submitted_at::text AS "submittedAt"
       FROM tenant.cash_count_attempt
       WHERE id=$2::uuid AND shift_id=$1::uuid
         AND ledger_sequence=$3`,
      [dto.shiftId, dto.countAttemptId, current.ledgerSequence],
    );
    if (!count.rows[0]) throw new Error('COUNT_NOT_FOUND');
    const variance = Number(count.rows[0].counted) - expected.expectedDrawerCash.minorUnits;
    const closeApprovalRequired =
      expected.expectedDrawerCash.minorUnits > policy.closeApprovalThreshold.minorUnits;
    const closeApprovalFingerprint = closeApprovalRequired
      ? createHash('sha256')
          .update(
            [
              tenantId,
              dto.branchId,
              dto.shiftId,
              dto.countAttemptId,
              expected.expectedDrawerCash.minorUnits,
              current.ledgerSequence,
              'cash.shift.close',
            ].join(':'),
          )
          .digest('hex')
      : null;
    if (closeApprovalRequired && (!dto.approvalId || !dto.approvalFingerprint)) {
      throw new Error('APPROVAL_REQUIRED');
    }
    if (dto.approvalId && dto.approvalFingerprint) {
      if (dto.approvalFingerprint !== closeApprovalFingerprint) {
        throw new Error('APPROVAL_FINGERPRINT_MISMATCH');
      }
      await this.consumeApproval(client, dto.approvalId, {
        tenantId,
        branchId: dto.branchId,
        permission: 'cash.shift.close',
        fingerprint: dto.approvalFingerprint,
        commandId: dto.commandId,
      });
    }
    const register = await client.query<{
      displayName: string;
      publicReference: string;
      active: boolean;
      assignmentPolicy: 'device_required' | 'operator_selects';
      assignedDeviceId: string | null;
      allowedDeviceClasses: string[];
      createdAt: string;
      version: number;
    }>(
      `UPDATE tenant.physical_register
       SET status=CASE WHEN assigned_device_id IS NULL THEN 'available' ELSE 'assigned' END,
           current_shift_id=NULL,version=version+1
       WHERE id=$1::uuid
       RETURNING display_name AS "displayName",public_reference AS "publicReference",active,
                 assignment_policy AS "assignmentPolicy",
                 assigned_device_id::text AS "assignedDeviceId",
                 allowed_device_classes AS "allowedDeviceClasses",
                 created_at::text AS "createdAt",version`,
      [current.registerId],
    );
    const closedAt = new Date().toISOString();
    const shiftSummary: CashShiftSummary = {
      shift: {
        id: current.id,
        tenantId,
        branchId: current.branchId,
        registerId: current.registerId,
        deviceId: current.deviceId,
        deviceCredentialVersion: current.deviceCredentialVersion,
        openingOperatorId: current.openingOperatorId,
        responsibleOperatorId: current.responsibleOperatorId,
        operatorSessionId: current.operatorSessionId,
        currency: current.currency,
        businessDate: current.businessDate,
        status: 'closed',
        openingCommandId: current.openingCommandId,
        openedAt: current.openedAt,
        suspendedAt: null,
        closedAt,
        ledgerSequence: Number(current.ledgerSequence),
        version: current.version + 1,
      },
      register: {
        id: current.registerId,
        tenantId,
        branchId: current.branchId,
        displayName: register.rows[0].displayName,
        publicReference: register.rows[0].publicReference,
        currency: current.currency,
        active: register.rows[0].active,
        assignmentPolicy: register.rows[0].assignmentPolicy,
        assignment: {
          deviceId: register.rows[0].assignedDeviceId,
          allowedDeviceClasses: register.rows[0].allowedDeviceClasses,
          assignedAt: null,
        },
        currentShiftId: null,
        status: register.rows[0].assignedDeviceId ? 'assigned' : 'available',
        version: register.rows[0].version,
        createdAt: register.rows[0].createdAt,
        archivedAt: null,
      },
      openingFloat: { minorUnits: Number(current.openingFloat), currency: current.currency },
      expectedCash: expected,
      countedCash: { minorUnits: Number(count.rows[0].counted), currency: current.currency },
      variance: { minorUnits: variance, currency: current.currency },
      varianceReason: null,
      reconciliationOutcome: reconciliation.rows[0].payload.outcome,
      countAttempts: Number(count.rows[0].attempts),
      handoffCount: 0,
    };
    await client.query(
      `INSERT INTO tenant.cash_shift_close
         (business_id,branch_id,register_id,shift_id,reconciliation_id,summary,command_id,closed_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::uuid,$8::timestamptz)`,
      [
        tenantId,
        dto.branchId,
        current.registerId,
        dto.shiftId,
        dto.reconciliationId,
        JSON.stringify(shiftSummary),
        dto.commandId,
        closedAt,
      ],
    );
    await client.query(
      `UPDATE tenant.cash_shift
       SET status='closed',closed_at=$2::timestamptz,version=version+1
       WHERE id=$1::uuid`,
      [dto.shiftId, closedAt],
    );
    return {
      summary: shiftSummary,
      reconciliation: {
        ...reconciliation.rows[0].payload,
        expectedCash: expected,
        selectedCount: {
          id: dto.countAttemptId,
          shiftId: dto.shiftId,
          attemptNumber: count.rows[0].attemptNumber,
          state: 'resolved',
          countedCash: { minorUnits: Number(count.rows[0].counted), currency: current.currency },
          denominations: count.rows[0].denominations,
          operatorId: count.rows[0].operatorId,
          ledgerSequence: Number(current.ledgerSequence),
          submittedAt: count.rows[0].submittedAt,
        },
        variance: calculateVariance(
          expected.expectedDrawerCash.minorUnits,
          Number(count.rows[0].counted),
          0,
          current.currency,
          Number(current.ledgerSequence),
        ),
        resolution: null,
        closeApprovalRequired,
        closeApprovalFingerprint,
      },
      closedAt,
      correlationId,
      recovered: false,
    };
  }

  async center(
    userId: string,
    tenantId: string,
    branchId: string,
    operatorSessionId: string,
    deviceId: string,
    operatorId: string,
  ): Promise<CashCenterSnapshot> {
    return this.pg.runWithTenant(
      tenantId,
      userId,
      async (client) => {
        const registers = await client.query<PhysicalRegisterRow>(
          `SELECT id::text,business_id::text AS "tenantId",branch_id::text AS "branchId",
                  display_name AS "displayName",public_reference AS "publicReference",
                  currency,active,assignment_policy AS "assignmentPolicy",
                  assigned_device_id::text AS "assignedDeviceId",
                  allowed_device_classes AS "allowedDeviceClasses",
                  current_shift_id::text AS "currentShiftId",status,version,
                  created_at::text AS "createdAt",archived_at::text AS "archivedAt"
           FROM tenant.physical_register
           WHERE business_id=$1::uuid AND branch_id=$2::uuid AND active
             AND archived_at IS NULL
             AND (assignment_policy='operator_selects' OR assigned_device_id=$3::uuid)
           ORDER BY display_name LIMIT 100`,
          [tenantId, branchId, deviceId],
        );
        const current = await client.query<CashShift>(
          `SELECT id::text,business_id::text AS "tenantId",branch_id::text AS "branchId",
                  register_id::text AS "registerId",device_id::text AS "deviceId",
                  device_credential_version AS "deviceCredentialVersion",
                  opening_operator_id::text AS "openingOperatorId",
                  responsible_operator_id::text AS "responsibleOperatorId",
                  operator_session_id::text AS "operatorSessionId",currency,
                  business_date::text AS "businessDate",status,
                  opening_command_id::text AS "openingCommandId",
                  opened_at::text AS "openedAt",suspended_at::text AS "suspendedAt",
                  closed_at::text AS "closedAt",ledger_sequence AS "ledgerSequence",version
           FROM tenant.cash_shift
           WHERE business_id=$1::uuid AND branch_id=$2::uuid
             AND device_id=$4::uuid AND status<>'closed'
             AND responsible_operator_id=$5::uuid
           ORDER BY opened_at DESC LIMIT 1`,
          [tenantId, branchId, operatorSessionId, deviceId, operatorId],
        );
        const mappedRegisters = registers.rows.map((row) => ({
          ...row,
          assignment: {
            deviceId: row.assignedDeviceId,
            allowedDeviceClasses: row.allowedDeviceClasses,
            assignedAt: null,
          },
        }));
        const shift = current.rows[0] ?? null;
        const sessionMatches = shift?.operatorSessionId === operatorSessionId;
        const closeSummaryResult = !shift
          ? await client.query<{ summary: CashShiftSummary }>(
              `SELECT c.summary
               FROM tenant.cash_shift_close c
               JOIN tenant.cash_shift s ON s.id=c.shift_id
               WHERE c.business_id=$1::uuid AND c.branch_id=$2::uuid
                 AND s.device_id=$3::uuid AND s.responsible_operator_id=$4::uuid
               ORDER BY c.closed_at DESC LIMIT 1`,
              [tenantId, branchId, deviceId, operatorId],
            )
          : null;
        const closeSummary = closeSummaryResult?.rows[0]?.summary ?? null;
        const businessDateResult = await client.query<{ businessDate: string }>(
          `SELECT current_date::text AS "businessDate"`,
        );
        const currency = shift?.currency ?? mappedRegisters[0]?.currency ?? 'MXN';
        const policy = await this.policy(client, tenantId, branchId, currency);
        const policyUsable =
          policy.version !== 'default-deny' && Date.parse(policy.expiresAt) > Date.now();
        const expected = shift ? await this.expectedCash(client, shift.id) : null;
        const latestCountResult = shift
          ? await client.query<{
              id: string;
              attemptNumber: number;
              state: CashCountState;
              counted: string;
              denominations: Array<{
                denomination: { minorUnits: number; currency: string };
                quantity: number;
                lineTotal: { minorUnits: number; currency: string };
              }>;
              operatorId: string;
              ledgerSequence: string;
              submittedAt: string;
            }>(
              `SELECT id::text,attempt_number AS "attemptNumber",state,
                      counted_minor_units::text AS counted,denominations,
                      operator_id::text AS "operatorId",
                      ledger_sequence::text AS "ledgerSequence",
                      submitted_at::text AS "submittedAt"
               FROM tenant.cash_count_attempt
               WHERE shift_id=$1::uuid
               ORDER BY attempt_number DESC LIMIT 1`,
              [shift.id],
            )
          : null;
        const latestCountRow = latestCountResult?.rows[0] ?? null;
        const latestVariance =
          shift && expected && latestCountRow
            ? calculateVariance(
                expected.expectedDrawerCash.minorUnits,
                Number(latestCountRow.counted),
                policy.varianceTolerance.minorUnits,
                shift.currency,
                Number(latestCountRow.ledgerSequence),
              )
            : null;
        const approvalFingerprint =
          shift && latestCountRow && latestVariance?.approvalRequired
            ? createHash('sha256')
                .update(
                  [
                    tenantId,
                    branchId,
                    shift.id,
                    latestCountRow.id,
                    Number(latestCountRow.counted),
                    Number(latestCountRow.ledgerSequence),
                  ].join(':'),
                )
                .digest('hex')
            : null;
        const latestCount =
          shift && latestCountRow && latestVariance
            ? {
                count: {
                  id: latestCountRow.id,
                  shiftId: shift.id,
                  attemptNumber: latestCountRow.attemptNumber,
                  state: latestCountRow.state,
                  countedCash: {
                    minorUnits: Number(latestCountRow.counted),
                    currency: shift.currency,
                  },
                  denominations: latestCountRow.denominations,
                  operatorId: latestCountRow.operatorId,
                  ledgerSequence: Number(latestCountRow.ledgerSequence),
                  submittedAt: latestCountRow.submittedAt,
                },
                variance: latestVariance,
                approvalFingerprint,
              }
            : null;
        const reconciliationResult = shift
          ? await client.query<StoredReconciliationHeader>(
              `SELECT id::text,shift_id::text AS "shiftId",
                      count_attempt_id::text AS "countAttemptId",outcome,
                      ledger_sequence AS "ledgerSequence",
                      reconciled_at::text AS "reconciledAt"
               FROM tenant.cash_reconciliation
               WHERE shift_id=$1::uuid
               ORDER BY reconciled_at DESC LIMIT 1`,
              [shift.id],
            )
          : null;
        const resolutionResult =
          shift && latestCountRow
            ? await client.query<{
                id: string;
                reason: string;
                note: string | null;
                approvalId: string | null;
                ledgerSequence: string;
                resolvedAt: string;
              }>(
                `SELECT id::text,reason,note,approval_id::text AS "approvalId",
                        ledger_sequence::text AS "ledgerSequence",
                        resolved_at::text AS "resolvedAt"
                 FROM tenant.cash_variance_resolution
                 WHERE shift_id=$1::uuid AND count_attempt_id=$2::uuid
                 LIMIT 1`,
                [shift.id, latestCountRow.id],
              )
            : null;
        const resolutionRow = resolutionResult?.rows[0] ?? null;
        const varianceResolution =
          shift && latestCountRow && resolutionRow
            ? {
                id: resolutionRow.id,
                shiftId: shift.id,
                countAttemptId: latestCountRow.id,
                reason: resolutionRow.reason as ResolveCashVarianceRequest['reason'],
                note: resolutionRow.note,
                approvalId: resolutionRow.approvalId,
                approvalFingerprint: resolutionRow.approvalId === null ? null : approvalFingerprint,
                ledgerSequence: Number(resolutionRow.ledgerSequence),
                resolvedAt: resolutionRow.resolvedAt,
              }
            : null;
        const reconciliationHeader = reconciliationResult?.rows[0] ?? null;
        const handoffReady =
          policy.handoffAllowed &&
          policy.handoffCountRequired &&
          latestCount !== null &&
          (latestCount.variance.signedVariance.minorUnits === 0 || resolutionRow !== null);
        const reconciliation =
          reconciliationHeader && expected && latestCount
            ? {
                ...reconciliationHeader,
                expectedCash: expected,
                selectedCount: latestCount.count,
                variance: latestCount.variance,
                resolution: null,
                closeApprovalRequired:
                  expected.expectedDrawerCash.minorUnits > policy.closeApprovalThreshold.minorUnits,
                closeApprovalFingerprint:
                  expected.expectedDrawerCash.minorUnits > policy.closeApprovalThreshold.minorUnits
                    ? createHash('sha256')
                        .update(
                          [
                            tenantId,
                            branchId,
                            shift.id,
                            latestCount.count.id,
                            expected.expectedDrawerCash.minorUnits,
                            latestCount.count.ledgerSequence,
                            'cash.shift.close',
                          ].join(':'),
                        )
                        .digest('hex')
                    : null,
              }
            : null;
        return {
          businessDate: businessDateResult.rows[0].businessDate,
          policy,
          registers: mappedRegisters,
          currentShift: shift,
          expectedCash: latestCount ? expected : null,
          latestCount,
          varianceResolution,
          reconciliation,
          recoveryState: !policyUsable
            ? 'policy_expired'
            : shift
              ? !sessionMatches
                ? 'operator_mismatch'
                : shift.status === 'open'
                  ? 'none'
                  : shift.status === 'suspended' || shift.status === 'handoff_pending'
                    ? 'shift_suspended'
                    : 'reconciliation_required'
              : 'shift_required',
          allowedActions: !policyUsable
            ? []
            : shift
              ? !sessionMatches
                ? ['resume']
                : shift.status === 'open'
                  ? ['movement', 'suspend', 'handoff', 'count', 'no_sale']
                  : shift.status === 'suspended' || shift.status === 'handoff_pending'
                    ? ['resume', 'count']
                    : handoffReady
                      ? ['handoff', 'reconcile', 'count']
                      : reconciliation
                        ? ['close']
                        : ['resolve_variance', 'reconcile', 'count']
              : mappedRegisters.length
                ? ['open_shift']
                : [],
          summary: closeSummary,
        };
      },
      branchId,
    );
  }

  async transition(
    client: PoolClient,
    tenantId: string,
    authorization: CashAuthorization,
    dto: ShiftTransitionRequest,
    target: 'suspended' | 'open',
  ) {
    const source =
      target === 'suspended'
        ? ['open']
        : [
            'open',
            'suspended',
            'handoff_pending',
            'counting',
            'reconciliation_required',
            'closing',
          ];
    const { rows } = await client.query<CashShift>(
      `UPDATE tenant.cash_shift
       SET status=CASE
             WHEN $7='open' AND status IN ('counting','reconciliation_required','closing')
               THEN status
             ELSE $7
           END,
           version=version+1,
           operator_session_id=CASE WHEN $7='open' THEN $9::uuid ELSE operator_session_id END,
           suspended_at=CASE WHEN $7='suspended' THEN now() ELSE NULL END
       WHERE id=$1::uuid AND business_id=$2::uuid AND branch_id=$3::uuid
         AND responsible_operator_id=$4::uuid AND device_id=$5::uuid
         AND version=$6 AND status=ANY($8::text[])
       RETURNING id::text,business_id::text AS "tenantId",branch_id::text AS "branchId",
                 register_id::text AS "registerId",device_id::text AS "deviceId",
                 device_credential_version AS "deviceCredentialVersion",
                 opening_operator_id::text AS "openingOperatorId",
                 responsible_operator_id::text AS "responsibleOperatorId",
                 operator_session_id::text AS "operatorSessionId",currency,
                 business_date::text AS "businessDate",status,
                 opening_command_id::text AS "openingCommandId",
                 opened_at::text AS "openedAt",suspended_at::text AS "suspendedAt",
                 closed_at::text AS "closedAt",ledger_sequence AS "ledgerSequence",version`,
      [
        dto.shiftId,
        tenantId,
        dto.branchId,
        authorization.operatorId,
        authorization.deviceId,
        dto.expectedShiftVersion,
        target,
        source,
        authorization.operatorSessionId,
      ],
    );
    if (!rows[0]) throw new Error('INVALID_SHIFT_TRANSITION');
    await client.query(
      `UPDATE tenant.physical_register SET status=$2,version=version+1
       WHERE id=$1::uuid`,
      [
        rows[0].registerId,
        rows[0].status === 'open'
          ? 'in_use'
          : rows[0].status === 'counting'
            ? 'counting'
            : rows[0].status === 'reconciliation_required' || rows[0].status === 'closing'
              ? 'reconciliation_required'
              : 'suspended',
      ],
    );
    return rows[0];
  }

  async incomingPinRecord(
    lookupHash: string,
    tenantId: string,
    branchId: string,
    actingOperatorSessionId: string,
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
       JOIN runtime.operator_session acting ON acting.id=$4::uuid
         AND acting.business_id=s.business_id AND acting.branch_id=$3::uuid
       JOIN umi.user_role ur ON ur.user_id=s.user_id
         AND (ur.business_id=s.business_id OR ur.business_id IS NULL)
         AND (ur.branch_id IS NULL OR ur.branch_id=$3::uuid)
       JOIN umi.role_permission rp ON rp.role_id=ur.role_id
       JOIN umi.permission p ON p.id=rp.permission_id AND p.key='cash.register.use'
       WHERE s.operator_pin_lookup_hash=$1 AND s.business_id=$2::uuid
         AND (s.branch_id IS NULL OR s.branch_id=$3::uuid) AND s.status='active'
         AND acting.user_id<>s.user_id AND acting.state='active'
       LIMIT 1`,
      [lookupHash, tenantId, branchId, actingOperatorSessionId],
    );
    return rows[0] ?? null;
  }

  async recordPinFailure(staffId: string): Promise<void> {
    await this.pg.worker.query(
      `UPDATE tenant.staff
       SET pin_failed_attempts=least(pin_failed_attempts+1,10),
           pin_locked_until=CASE WHEN pin_failed_attempts+1>=5
             THEN now()+interval '15 minutes' ELSE pin_locked_until END
       WHERE id=$1::uuid`,
      [staffId],
    );
  }

  async handoff(
    client: PoolClient,
    tenantId: string,
    authorization: CashAuthorization,
    incoming: { staffId: string; userId: string },
    dto: ShiftHandoffRequest,
  ): Promise<ShiftHandoff> {
    const shift = await client.query<{
      registerId: string;
      currency: string;
      sequence: string;
      status: 'open' | 'suspended' | 'reconciliation_required';
    }>(
      `SELECT register_id::text AS "registerId",currency,
              ledger_sequence::text AS sequence,status
       FROM tenant.cash_shift
       WHERE id=$1::uuid AND business_id=$2::uuid AND branch_id=$3::uuid
         AND responsible_operator_id=$4::uuid AND device_id=$5::uuid
         AND version=$6 AND status IN ('open','suspended','reconciliation_required')
       FOR UPDATE`,
      [
        dto.shiftId,
        tenantId,
        dto.branchId,
        authorization.operatorId,
        authorization.deviceId,
        dto.expectedShiftVersion,
      ],
    );
    const current = shift.rows[0];
    if (!current) throw new Error('SHIFT_NOT_HANDOFF_READY');
    const policy = await this.policy(client, tenantId, dto.branchId, current.currency);
    if (!policy.handoffAllowed) {
      throw new Error('CASH_HANDOFF_BLOCKED');
    }
    if (policy.handoffCountRequired) {
      const handoffCount = await client.query<{
        counted: string;
        resolutionId: string | null;
      }>(
        `SELECT c.counted_minor_units::text AS counted,
                r.id::text AS "resolutionId"
         FROM tenant.cash_count_attempt c
         LEFT JOIN tenant.cash_variance_resolution r ON r.count_attempt_id=c.id
         WHERE c.shift_id=$1::uuid AND c.ledger_sequence=$2
         ORDER BY c.attempt_number DESC LIMIT 1`,
        [dto.shiftId, current.sequence],
      );
      const count = handoffCount.rows[0];
      const expectedForCount = await this.expectedCash(client, dto.shiftId);
      const balanced =
        count && Number(count.counted) === expectedForCount.expectedDrawerCash.minorUnits;
      if (!count || (!balanced && !count.resolutionId)) {
        throw new Error('CASH_HANDOFF_REQUIRES_COUNT');
      }
    }
    const expected = await this.expectedCash(client, dto.shiftId);
    await client.query(
      `UPDATE runtime.operator_session
       SET state='ended',ended_at=now(),last_activity_at=now()
       WHERE id=$1::uuid AND state='active'`,
      [authorization.operatorSessionId],
    );
    const row = await client.query<{ id: string; completedAt: string }>(
      `INSERT INTO tenant.cash_shift_handoff
         (business_id,branch_id,shift_id,outgoing_operator_id,incoming_operator_id,
          expected_cash_snapshot,ledger_sequence,command_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8::uuid)
       RETURNING id::text,completed_at::text AS "completedAt"`,
      [
        tenantId,
        dto.branchId,
        dto.shiftId,
        authorization.operatorId,
        incoming.userId,
        JSON.stringify(expected),
        current.sequence,
        dto.commandId,
      ],
    );
    await client.query(
      `UPDATE tenant.cash_shift
       SET responsible_operator_id=$2::uuid,status='handoff_pending',
           suspended_at=now(),version=version+1
       WHERE id=$1::uuid`,
      [dto.shiftId, incoming.userId],
    );
    await client.query(
      `UPDATE tenant.physical_register
       SET status='suspended',version=version+1
       WHERE id=$1::uuid`,
      [current.registerId],
    );
    await client.query(
      `UPDATE tenant.staff SET pin_failed_attempts=0,pin_locked_until=NULL WHERE id=$1::uuid`,
      [incoming.staffId],
    );
    return {
      id: row.rows[0].id,
      shiftId: dto.shiftId,
      outgoingOperatorId: authorization.operatorId,
      incomingOperatorId: incoming.userId,
      expectedCash: expected,
      completedAt: row.rows[0].completedAt,
    };
  }

  async noSale(
    client: PoolClient,
    tenantId: string,
    authorization: CashAuthorization,
    dto: NoSaleDrawerRequest,
    correlationId: string,
  ): Promise<NoSaleDrawerEvent> {
    const shift = await client.query<{ registerId: string; currency: string }>(
      `SELECT register_id::text AS "registerId",currency
       FROM tenant.cash_shift
       WHERE id=$1::uuid AND business_id=$2::uuid AND branch_id=$3::uuid
         AND responsible_operator_id=$4::uuid AND device_id=$5::uuid AND status='open'
       FOR UPDATE`,
      [dto.shiftId, tenantId, dto.branchId, authorization.operatorId, authorization.deviceId],
    );
    if (!shift.rows[0]) throw new Error('SHIFT_NOT_OPEN');
    const policy = await this.policy(client, tenantId, dto.branchId, shift.rows[0].currency);
    if (!policy.noSaleDrawerAllowed) throw new Error('NO_SALE_DRAWER_DISABLED');
    const recent = await client.query<{ total: string }>(
      `SELECT count(*)::text AS total
       FROM tenant.no_sale_drawer_event
       WHERE shift_id=$1::uuid AND operator_id=$2::uuid
         AND requested_at>now()-interval '1 minute'`,
      [dto.shiftId, authorization.operatorId],
    );
    if (Number(recent.rows[0].total) >= 3) throw new Error('RATE_LIMITED');
    const { rows } = await client.query<{ id: string; requestedAt: string }>(
      `INSERT INTO tenant.no_sale_drawer_event
         (business_id,branch_id,register_id,shift_id,operator_id,reason_code,
          approval_id,command_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::uuid,$8::uuid)
       RETURNING id::text,requested_at::text AS "requestedAt"`,
      [
        tenantId,
        dto.branchId,
        shift.rows[0].registerId,
        dto.shiftId,
        authorization.operatorId,
        dto.reasonCode,
        dto.approvalId,
        dto.commandId,
      ],
    );
    return {
      id: rows[0].id,
      shiftId: dto.shiftId,
      status: 'requested',
      verifiedHardwareResult: false,
      requestedAt: rows[0].requestedAt,
      correlationId,
    };
  }

  private async consumeApproval(
    client: PoolClient,
    approvalId: string,
    input: {
      tenantId: string;
      branchId: string;
      permission: string;
      fingerprint: string;
      commandId: string;
    },
  ): Promise<void> {
    const { rowCount } = await client.query(
      `UPDATE runtime.elevation_grant
       SET consumed_at=now(),consumed_by_command_id=$6::uuid
       WHERE id=$1::uuid AND business_id=$2::uuid AND branch_id=$3::uuid
         AND permission_key=$4 AND command_fingerprint=$5
         AND method='manager_approval' AND expires_at>now() AND consumed_at IS NULL`,
      [
        approvalId,
        input.tenantId,
        input.branchId,
        input.permission,
        input.fingerprint,
        input.commandId,
      ],
    );
    if (rowCount !== 1) throw new Error('APPROVAL_INVALID');
  }
}
