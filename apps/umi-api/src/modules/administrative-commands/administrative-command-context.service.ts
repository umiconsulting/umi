import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { commandFingerprint } from '../integrity/canonical-json';
import { administrativeCommandPolicy } from './administrative-command.policy';
import { AdministrativeCommandRepository } from './administrative-command.repository';

export interface AdministrativeCommandInput {
  operation: string;
  locationId: string | null;
  targetAggregateId: string;
  targetVersion: number | null;
  commandId: string;
  idempotencyKey: string;
  parameters: unknown;
  approvalId: string | null;
}

export interface DashboardAdministrativeCommandContext {
  type: 'dashboard_administrative';
  actorUserId: string;
  membershipId: string;
  merchantId: string;
  locationId: string | null;
  sessionId: string;
  permission: string;
  operation: string;
  targetAggregateId: string;
  targetVersion: number | null;
  commandId: string;
  idempotencyKey: string;
  fingerprint: string;
  approvalId: string | null;
  origin: 'dashboard';
  issuedAt: string;
  expiresAt: string;
}

export interface PersistedDashboardAdministrativeCommandContext extends DashboardAdministrativeCommandContext {
  commandRecordId: string;
  correlationId: string;
}

@Injectable()
export class AdministrativeCommandContextService {
  constructor(private readonly repository: AdministrativeCommandRepository) {}

  async create(
    user: AuthUser,
    access: MerchantAccess,
    input: AdministrativeCommandInput,
  ): Promise<DashboardAdministrativeCommandContext> {
    if (!user?.id || !user.sessionId) {
      throw new UnauthorizedException({ code: 'AUTHENTICATION_REQUIRED' });
    }
    if (user.deviceId || user.commandContextType === 'pos_device') {
      throw new UnauthorizedException({ code: 'DASHBOARD_CONTEXT_REQUIRED' });
    }
    if (!access.membershipId) {
      throw new ForbiddenException({ code: 'EXPLICIT_MEMBERSHIP_REQUIRED' });
    }
    const policy = administrativeCommandPolicy(input.operation);
    if (!policy || !policy.contexts.includes('dashboard_administrative')) {
      throw new ForbiddenException({ code: 'COMMAND_CONTEXT_NOT_ALLOWED' });
    }
    if (!access.permissions.includes('*') && !access.permissions.includes(policy.permission)) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const parameters = objectParameters(input.parameters);
    if (
      policy.stepUp &&
      input.operation.endsWith('.approval') &&
      typeof parameters.managerPin !== 'string'
    ) {
      throw new ForbiddenException({ code: 'STEP_UP_REQUIRED' });
    }
    if (access.locationId && input.locationId !== access.locationId) {
      throw new ForbiddenException({ code: 'LOCATION_SCOPE_VIOLATION' });
    }
    if (!(await this.repository.assertDashboardSession(user.id, user.sessionId))) {
      throw new UnauthorizedException({ code: 'SESSION_REVOKED' });
    }

    const fingerprint = commandFingerprint(input.operation, {
      actorUserId: user.id,
      approvalId: input.approvalId,
      commandId: input.commandId,
      locationId: input.locationId,
      merchantId: access.merchantId,
      parameters: redactAdministrativeSecrets(input.parameters),
      targetAggregateId: input.targetAggregateId,
      targetVersion: input.targetVersion,
    });
    const prior = await this.repository.findCommand(
      access.merchantId,
      input.commandId,
      input.idempotencyKey,
    );
    if (prior && prior.fingerprint !== fingerprint) {
      throw new ConflictException({ code: 'ADMINISTRATIVE_COMMAND_FINGERPRINT_CONFLICT' });
    }

    const issuedAt = new Date();
    return {
      type: 'dashboard_administrative',
      actorUserId: user.id,
      membershipId: access.membershipId,
      merchantId: access.merchantId,
      locationId: input.locationId,
      sessionId: user.sessionId,
      permission: policy.permission,
      operation: input.operation,
      targetAggregateId: input.targetAggregateId,
      targetVersion: input.targetVersion,
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey,
      fingerprint,
      approvalId: input.approvalId,
      origin: 'dashboard',
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 5 * 60_000).toISOString(),
    };
  }

  async execute<T>(
    context: DashboardAdministrativeCommandContext,
    action: (context: PersistedDashboardAdministrativeCommandContext) => Promise<T>,
    persistedResult: (result: T) => unknown = (result) => result,
  ): Promise<T> {
    const correlationId = randomUUID();
    const claim = await this.repository.claimCommand({
      ...context,
      correlationId,
    });
    if (claim.row.fingerprint !== context.fingerprint) {
      throw new ConflictException({ code: 'ADMINISTRATIVE_COMMAND_FINGERPRINT_CONFLICT' });
    }
    if (!claim.owner) {
      if (claim.row.status === 'succeeded') return claim.row.result as T;
      throw new ConflictException({
        code: claim.row.failureCode ?? 'ADMINISTRATIVE_COMMAND_RECOVERY_REQUIRED',
      });
    }
    const persisted: PersistedDashboardAdministrativeCommandContext = {
      ...context,
      commandRecordId: claim.row.id,
      correlationId: claim.row.correlationId,
    };
    try {
      const result = await action(persisted);
      await this.repository.completeCommand(
        context,
        claim.row.id,
        'succeeded',
        persistedResult(result),
        null,
      );
      return result;
    } catch (error) {
      const failureCode = commandErrorCode(error);
      await this.repository.completeCommand(context, claim.row.id, 'failed', {}, failureCode);
      throw error;
    }
  }
}

function objectParameters(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const administrativeSecretKeys = new Set([
  'approvalToken',
  'deliveryToken',
  'managerPin',
  'password',
  'pin',
  'token',
]);

function redactAdministrativeSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAdministrativeSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !administrativeSecretKeys.has(key))
      .map(([key, child]) => [key, redactAdministrativeSecrets(child)]),
  );
}

function commandErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: unknown }).response;
    if (response && typeof response === 'object' && 'code' in response) {
      return String(response.code);
    }
  }
  return 'ADMINISTRATIVE_COMMAND_FAILED';
}
