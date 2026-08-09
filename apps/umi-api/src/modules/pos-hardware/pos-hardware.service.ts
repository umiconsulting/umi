import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  AssignHardwareRequest,
  ControlledReprintRequest,
  HardwareCommandRequest,
  HardwareCommandTransitionRequest,
  HardwareDiagnosticRequest,
  HardwareRecoveryQuery,
  HardwareRegistryQuery,
  RegisterHardwareRequest,
  UpdateHardwareRequest,
} from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import { IntegrityService } from '../integrity/integrity.service';
import type { CommandResult } from '../integrity/integrity.types';
import { hardwareCommandFingerprint } from './hardware-fingerprint';
import { PosHardwareRepository } from './pos-hardware.repository';

@Injectable()
export class PosHardwareService {
  constructor(
    private readonly repo: PosHardwareRepository,
    private readonly integrity: IntegrityService,
  ) {}

  async registry(user: AuthUser, merchantId: string, query: HardwareRegistryQuery) {
    await this.authorize(user, merchantId, query, 'hardware.read');
    return this.repo.snapshot(user.id, merchantId, query);
  }

  async register(user: AuthUser, merchantId: string, dto: RegisterHardwareRequest) {
    await this.authorize(user, merchantId, dto, 'hardware.manage');
    return this.mutation(
      merchantId,
      dto,
      'pos.hardware.register',
      async (client, correlationId) => {
        const result = await this.repo.register(client, merchantId, dto.operatorSessionId, dto);
        return {
          result,
          audit: {
            eventType: 'hardware_registered',
            entityType: 'hardware_device',
            entityId: result.id,
            publicData: { deviceType: result.type, transport: result.transport, correlationId },
          },
        };
      },
    );
  }

  async update(user: AuthUser, merchantId: string, hardwareId: string, dto: UpdateHardwareRequest) {
    await this.authorize(user, merchantId, dto, 'hardware.manage');
    return this.mutation(merchantId, dto, 'pos.hardware.update', async (client) => {
      const result = await this.repo.update(client, merchantId, hardwareId, dto);
      return {
        result,
        audit: {
          eventType: dto.enabled ? 'hardware_enabled' : 'hardware_disabled',
          entityType: 'hardware_device',
          entityId: result.id,
        },
      };
    });
  }

  async assign(user: AuthUser, merchantId: string, hardwareId: string, dto: AssignHardwareRequest) {
    await this.authorize(user, merchantId, dto, 'hardware.assign');
    return this.mutation(merchantId, dto, 'pos.hardware.assign', async (client) => {
      const result = await this.repo.assign(client, merchantId, hardwareId, dto);
      return {
        result,
        audit: {
          eventType: 'hardware_assigned',
          entityType: 'hardware_device',
          entityId: result.id,
          publicData: {
            registerId: result.registerId,
            assignedPosDeviceId: result.assignedPosDeviceId,
          },
        },
      };
    });
  }

  async command(user: AuthUser, merchantId: string, dto: HardwareCommandRequest) {
    await this.authorize(user, merchantId, dto, 'hardware.command.execute');
    const permission = this.commandPermission(dto.commandType);
    const authorization = await this.authorize(user, merchantId, dto, permission);
    if (
      dto.commandType === 'terminal_connect_foundation' ||
      dto.commandType === 'terminal_disconnect_foundation' ||
      dto.commandType === 'scale_read_foundation'
    ) {
      throw new ConflictException({ code: 'HARDWARE_CAPABILITY_UNSUPPORTED' });
    }
    this.validatePayload(dto);
    if (hardwareCommandFingerprint(dto) !== dto.payloadFingerprint) {
      throw new ConflictException({ code: 'HARDWARE_PAYLOAD_FINGERPRINT_MISMATCH' });
    }
    await this.mutation(
      merchantId,
      dto,
      `pos.hardware.${dto.commandType}`,
      async (client, correlationId) => {
        const result = await this.repo.createCommand(
          client,
          merchantId,
          authorization,
          dto,
          correlationId,
        );
        return {
          result,
          audit: {
            eventType: this.commandAuditEvent(dto.commandType),
            entityType: 'hardware_command',
            entityId: dto.commandId,
            publicData: {
              hardwareId: dto.targetHardwareId,
              sourceAggregateType: dto.sourceAggregateType,
              sourceAggregateId: dto.sourceAggregateId,
            },
          },
        };
      },
    );
    return this.repo.currentCommand(user.id, merchantId, dto.locationId, dto.commandId);
  }

  async transition(
    user: AuthUser,
    merchantId: string,
    commandId: string,
    dto: HardwareCommandTransitionRequest,
  ) {
    await this.authorize(user, merchantId, dto, 'hardware.command.execute');
    try {
      return await this.repo.transition(user.id, merchantId, commandId, dto);
    } catch (error) {
      throw this.hardwareError(error);
    }
  }

  async reprint(user: AuthUser, merchantId: string, jobId: string, dto: ControlledReprintRequest) {
    await this.authorize(user, merchantId, dto, 'hardware.printer.reprint');
    return this.mutation(
      merchantId,
      dto,
      'pos.hardware.controlled_reprint',
      async (client, correlationId) => {
        const result = await this.repo.reprint(client, merchantId, jobId, dto, correlationId);
        return {
          result,
          audit: {
            eventType: 'print_job_reprinted',
            entityType: 'hardware_print_job',
            entityId: result.job.jobId,
            publicData: { originalJobId: jobId, reason: dto.reason },
          },
        };
      },
    );
  }

  async diagnostic(user: AuthUser, merchantId: string, dto: HardwareDiagnosticRequest) {
    await this.authorize(user, merchantId, dto, this.diagnosticPermission(dto.diagnostic));
    return this.mutation(
      merchantId,
      dto,
      'pos.hardware.diagnostic',
      async (client, correlationId) => {
        const result = await this.repo.diagnostic(client, merchantId, dto, correlationId);
        return {
          result,
          audit: {
            eventType: 'hardware_diagnostic_run',
            entityType: 'hardware_device',
            entityId: dto.hardwareId,
            publicData: { diagnostic: dto.diagnostic, health: result.health },
          },
        };
      },
    );
  }

  recovery(user: AuthUser, merchantId: string, query: HardwareRecoveryQuery) {
    return this.registry(user, merchantId, {
      ...query,
      registerId: undefined,
      includeDisabled: true,
    });
  }

  private async authorize(
    user: AuthUser,
    merchantId: string,
    input: { locationId: string; operatorSessionId: string },
    permission: string,
  ) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    const authorization = await this.repo.authorize(
      user.id,
      user.sessionId,
      merchantId,
      input.locationId,
      input.operatorSessionId,
      user.deviceId,
      permission,
    );
    if (!authorization) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    return authorization;
  }

  private commandPermission(commandType: HardwareCommandRequest['commandType']): string {
    switch (commandType) {
      case 'print_receipt':
        return 'hardware.printer.print';
      case 'controlled_reprint':
        return 'hardware.printer.reprint';
      case 'print_test_page':
        return 'hardware.printer.test';
      case 'open_drawer':
        return 'hardware.drawer.open';
      case 'test_drawer':
        return 'hardware.drawer.test';
      case 'begin_scanner_session':
      case 'end_scanner_session':
        return 'hardware.scanner.use';
      case 'update_customer_display':
      case 'clear_customer_display':
        return 'hardware.customer_display.use';
      default:
        return 'hardware.diagnostics';
    }
  }

  private validatePayload(dto: HardwareCommandRequest) {
    if (dto.commandType === 'print_receipt' && dto.printPayload === null) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED' });
    }
    if (dto.commandType === 'open_drawer' && dto.drawer === null) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED' });
    }
    if (dto.commandType === 'update_customer_display' && dto.display === null) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED' });
    }
  }

  private commandAuditEvent(commandType: HardwareCommandRequest['commandType']): string {
    if (commandType.startsWith('print_')) return 'print_job_created';
    if (commandType === 'open_drawer') return 'drawer_open_requested';
    if (commandType === 'begin_scanner_session') return 'scanner_connected';
    if (commandType === 'end_scanner_session') return 'scanner_disconnected';
    if (commandType === 'update_customer_display') return 'customer_display_connected';
    if (commandType === 'clear_customer_display') return 'customer_display_disconnected';
    return 'hardware_command_created';
  }

  private diagnosticPermission(diagnostic: HardwareDiagnosticRequest['diagnostic']): string {
    switch (diagnostic) {
      case 'printer_test_page':
        return 'hardware.printer.test';
      case 'drawer_test':
        return 'hardware.drawer.test';
      case 'scanner_test_session':
        return 'hardware.scanner.test';
      case 'customer_display_test':
        return 'hardware.customer_display.test';
      default:
        return 'hardware.diagnostics';
    }
  }

  private async mutation<T>(
    merchantId: string,
    dto: { locationId: string; commandId: string; idempotencyKey: string },
    commandType: string,
    operation: (
      client: PoolClient,
      correlationId: string,
    ) => Promise<{
      result: T;
      audit: {
        eventType: string;
        entityType: string;
        entityId: string;
        publicData?: Record<string, unknown>;
      };
    }>,
  ): Promise<T> {
    try {
      return await this.unwrap(
        this.integrity.execute(
          {
            merchantId,
            locationId: dto.locationId,
            commandId: dto.commandId,
            idempotencyKey: dto.idempotencyKey,
            commandType,
            payload: dto,
          },
          async (context) => {
            const value = await operation(context.client, context.correlationId);
            await context.appendAudit({ ...value.audit, outcome: 'success' });
            return { ok: true, value: value.result };
          },
        ),
      );
    } catch (error) {
      throw this.hardwareError(error);
    }
  }

  private async unwrap<T>(promise: Promise<CommandResult<T>>): Promise<T> {
    const result = await promise;
    if (result.status === 'succeeded' && result.result !== null) return result.result;
    throw new ConflictException({
      code: result.failureCode ?? 'HARDWARE_COMMAND_FAILED',
      correlationId: result.correlationId,
    });
  }

  private hardwareError(error: unknown) {
    if (error instanceof BadRequestException || error instanceof ConflictException) return error;
    const message = error instanceof Error ? error.message : String(error);
    const mapping: Record<string, string> = {
      HARDWARE_NOT_FOUND: 'HARDWARE_NOT_FOUND',
      HARDWARE_DISABLED: 'HARDWARE_DISABLED',
      HARDWARE_NOT_ASSIGNED: 'HARDWARE_NOT_ASSIGNED',
      HARDWARE_CAPABILITY_UNSUPPORTED: 'HARDWARE_CAPABILITY_UNSUPPORTED',
      HARDWARE_CONFIGURATION_STALE: 'HARDWARE_CONFIGURATION_STALE',
      HARDWARE_IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
      HARDWARE_LOCATION_SCOPE: 'LOCATION_SCOPE_VIOLATION',
      HARDWARE_FOUNDATION_ONLY: 'HARDWARE_CAPABILITY_UNSUPPORTED',
    };
    const code = Object.entries(mapping).find(([source]) => message.includes(source))?.[1];
    return new ConflictException({ code: code ?? 'HARDWARE_COMMAND_FAILED' });
  }
}
