import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
  commandId: string;
  idempotencyKey: string;
  fingerprint: string;
  approvalId: string | null;
  origin: 'dashboard';
  issuedAt: string;
  expiresAt: string;
}

@Injectable()
export class AdministrativeCommandContextService {
  constructor(private readonly repository: AdministrativeCommandRepository) {}

  async create(
    user: AuthUser,
    access: MerchantAccess,
    input: AdministrativeCommandInput,
  ): Promise<DashboardAdministrativeCommandContext> {
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
      parameters: input.parameters,
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
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey,
      fingerprint,
      approvalId: input.approvalId,
      origin: 'dashboard',
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 5 * 60_000).toISOString(),
    };
  }
}
