import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  BeginReplayRequest, ReplayBatch, ReplayBatchResult,
  ReconcileRequest, ReconciliationSummary, ReplayContextQuery,
} from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import { PosOfflineRepository } from './pos-offline.repository';

@Injectable()
export class PosOfflineService {
  constructor(private readonly repo: PosOfflineRepository) {}

  async begin(user: AuthUser, tenantId: string, dto: BeginReplayRequest) {
    const context = await this.authorize(user, tenantId, dto.branchId, dto.operatorSessionId, dto.credentialVersion);
    const policy = await this.repo.policy(tenantId);
    return {
      replaySessionId: randomUUID(),
      cursor: this.cursor(user.deviceId!, dto.credentialVersion, context.lastAcceptedSequence),
      policy: {
        ...policy, issuedAt: policy.issuedAt.toISOString(), expiresAt: policy.expiresAt.toISOString(),
        cashSaleEnabled: false as const, webSensitiveJournalEnabled: false as const,
      },
    };
  }

  async batch(user: AuthUser, tenantId: string, batch: ReplayBatch): Promise<ReplayBatchResult> {
    const first = batch.commands[0];
    await this.authorize(user, tenantId, first.branchId, first.operatorSessionId, first.deviceCredentialVersion);
    const sorted = [...batch.commands].sort((a, b) => a.deviceSequence - b.deviceSequence);
    if (sorted.some((command, index) =>
      command.tenantId !== tenantId || command.deviceId !== user.deviceId ||
      command.deviceSequence !== sorted[0].deviceSequence + index)) {
      throw new ForbiddenException({ code: 'REPLAY_SCOPE_INVALID' });
    }
    const results = [];
    let stopped = false;
    for (const command of sorted) {
      const result = await this.repo.replay(command);
      results.push(result);
      if (result.failure?.blocksFollowing) { stopped = true; break; }
    }
    const last = results.filter((r) => r.status === 'accepted' || r.status === 'duplicate')
      .reduce((value, result) => Math.max(value, result.deviceSequence), sorted[0].deviceSequence - 1);
    return {
      replaySessionId: batch.replaySessionId, results,
      cursor: this.cursor(user.deviceId!, first.deviceCredentialVersion, last),
      stopped,
    };
  }

  async reconcile(
    user: AuthUser, tenantId: string, branchId: string, operatorSessionId: string,
    credentialVersion: number, dto: ReconcileRequest,
  ): Promise<ReconciliationSummary> {
    const context = await this.authorize(user, tenantId, branchId, operatorSessionId, credentialVersion);
    const missing: number[] = [];
    for (let value = context.lastAcceptedSequence + 1; value <= dto.localLastAllocatedSequence && missing.length < 100; value++) missing.push(value);
    return {
      deviceId: user.deviceId!, credentialVersion,
      localLastAllocatedSequence: dto.localLastAllocatedSequence,
      localLastAcknowledgedSequence: dto.localLastAcknowledgedSequence,
      serverLastAcceptedSequence: context.lastAcceptedSequence,
      missingSequences: missing, duplicates: [], conflicts: [], provisionalMappings: [],
      reconciliationRequired: missing.length > 0 ||
        dto.localLastAcknowledgedSequence > context.lastAcceptedSequence,
    };
  }

  async readCursor(user: AuthUser, tenantId: string, query: ReplayContextQuery) {
    const context = await this.authorize(
      user, tenantId, query.branchId, query.operatorSessionId, query.credentialVersion,
    );
    return this.cursor(user.deviceId!, query.credentialVersion, context.lastAcceptedSequence);
  }

  async commandResult(
    user: AuthUser, tenantId: string, query: ReplayContextQuery, commandId: string,
  ) {
    await this.authorize(
      user, tenantId, query.branchId, query.operatorSessionId, query.credentialVersion,
    );
    return this.repo.commandResult(tenantId, user.deviceId!, commandId);
  }

  async diagnostics(user: AuthUser, tenantId: string, query: ReplayContextQuery) {
    await this.authorize(
      user, tenantId, query.branchId, query.operatorSessionId, query.credentialVersion,
    );
    const value = await this.repo.diagnostics(tenantId, user.deviceId!, query.credentialVersion);
    return {
      contractVersion: '1.5.0',
      serverLastAcceptedSequence: Number(value.lastAcceptedSequence),
      acceptedCount: Number(value.acceptedCount),
      conflictCount: 0,
      lastReplayAt: value.lastReplayAt?.toISOString() ?? null,
      lastSafeErrorCategory: null,
    };
  }

  async acknowledge(
    user: AuthUser, tenantId: string, query: ReplayContextQuery, reconciliationId: string,
  ) {
    await this.authorize(
      user, tenantId, query.branchId, query.operatorSessionId, query.credentialVersion,
    );
    return {
      acknowledged: await this.repo.acknowledge(tenantId, user.deviceId!, reconciliationId),
    };
  }

  private async authorize(
    user: AuthUser, tenantId: string, branchId: string,
    operatorSessionId: string, credentialVersion: number,
  ) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ALLOWED' });
    const context = await this.repo.context({
      userId: user.id, deviceId: user.deviceId, tenantId, branchId,
      operatorSessionId, credentialVersion,
    });
    if (!context || context.lifecycle !== 'active') throw new ForbiddenException({ code: 'DEVICE_REVOKED' });
    if (context.credentialVersion !== credentialVersion) throw new ForbiddenException({ code: 'DEVICE_CREDENTIAL_ROTATED' });
    if (!context.permissions.includes('*') && !context.permissions.includes('offline.replay')) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    return context;
  }

  private cursor(deviceId: string, credentialVersion: number, lastAcceptedSequence: number) {
    return {
      deviceId, credentialVersion, lastAcceptedSequence,
      reconciliationRequired: false, updatedAt: new Date().toISOString(),
    };
  }
}
